/* ============================================================================
 * Firebase data layer.
 *
 * The app never talks to Firestore directly — js/app/core/store.js reads and
 * writes through a few globals, and this file fills them in:
 *
 *   window.__ssBackend  'firestore' once we are live
 *   window.__ssCache    { storageKey: rawJsonString }  — read synchronously
 *   window.__ssPersist  (key, rawStringOrNull) => void — write, fire and forget
 *   window.__storeReady  promise awaited by main.js before the first render
 *   window.__hydrateStore()  re-read everything (auth.js calls it after sign-in)
 *   window.firebaseAuth  the Auth instance auth.js signs in against
 *
 * Storage shape: collection `appdata`, one document per storage key, field `v`
 * holding the JSON string.
 *
 * EVERYTHING GOES TO FIREBASE. The only things that stay on the device are the
 * three personal preferences store.js keeps in LOCAL_ONLY_KEYS (language,
 * light/dark, ink colour) — those are per-employee, not shop data.
 *
 * A write is therefore never allowed to fail quietly:
 *   • Firestore keeps its own durable queue (persistent local cache), so a write
 *     made offline is sent as soon as the connection returns — even after a
 *     reload.
 *   • On top of that this file retries with backoff, keeps whatever still fails
 *     in a retry list, shows a visible status pill, and warns before the tab is
 *     closed while anything is unsaved.
 *   • If Firebase cannot start at all it does NOT pretend to work: the app is
 *     put in read-only mode with a red banner, because writing to localStorage
 *     instead would silently split the data across devices.
 *
 * Documents are capped at 1 MiB by Firestore. Images are picked in the UI as
 * base64 data URLs; right before a write, every data URL inside the value is
 * uploaded to Firebase Storage (content-addressed: media/<sha256>.<ext>) and
 * replaced by its download URL — see offloadMedia(). So a record carries short
 * links, not image bytes, and there is no cap on how many or how big. A value
 * that is still large is SPLIT across `v0..vN` with `parts` saying how many.
 * ==========================================================================*/

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
const CHUNK = 700000;              // ~700KB of JSON per field, under the 1MiB doc cap
const MAX_TRIES = 5;

window.__ssBackend = 'local';
window.__ssCache = window.__ssCache || {};

/* ---------------- status pill + banner (only in firebase mode) ------------- */
function ui(){
  let el = document.getElementById('fbStatus');
  if(!el){
    el = document.createElement('div');
    el.id = 'fbStatus';
    el.className = 'fb-status';
    el.style.display = 'none';
    (document.body || document.documentElement).appendChild(el);
  }
  return el;
}
function setStatus(state, text, onRetry){
  const el = ui();
  el.className = 'fb-status fb-' + state;
  el.style.display = '';
  el.innerHTML = '<span class="fb-dot"></span><span class="fb-text"></span>' +
    (onRetry ? '<button type="button" class="fb-retry">Retry</button>' : '');
  el.querySelector('.fb-text').textContent = text;
  const btn = el.querySelector('.fb-retry');
  if(btn) btn.addEventListener('click', onRetry);
}
function clearStatus(){ const el = document.getElementById('fbStatus'); if(el) el.style.display = 'none'; }

if(window.APP_MODE !== 'firebase' || !window.FIREBASE_CONFIG){
  // Local development: localStorage is synchronous and always ready, so the
  // hydrate gate is open from the start and item collections just fall through
  // to the normal whole-blob path (they only split per-record under Firestore).
  window.__ssHydrated = true;
  window.__storeReady = Promise.resolve();
  window.__hydrateStore = async ()=>{};
}else{
  let db = null, fsMod = null, ready = null, fbApp = null;
  const pending = new Map();   // key -> latest value waiting for its debounce
  const timers  = new Map();
  const failed  = new Map();   // key -> value that exhausted its retries
  const queued  = new Map();   // key -> waiting for the server, already safe on disk
  let inFlight = 0;
  const inFlightKeys = new Set();   // keys being written right now (incl. image upload)
  let signedIn = false;        // rules reject every write until someone signs in
  const SLOW_MS = 8000;        // after this a write is "queued", not "in progress"

  const sleep = (ms)=> new Promise(r=> setTimeout(r, ms));
  const joinParts = (data)=>{
    if(!data) return null;
    if(typeof data.parts === 'number' && data.parts > 0){
      let out = '';
      for(let i = 0; i < data.parts; i++) out += (data['v' + i] || '');
      return out;
    }
    return (typeof data.v === 'undefined') ? null : data.v;
  };

  function paint(){
    if(failed.size){
      setStatus('bad', 'ยังบันทึกขึ้น Firebase ไม่สำเร็จ ' + failed.size + ' รายการ', retryFailed);
      return;
    }
    // Firestore only resolves a write once the SERVER confirms it. Offline or on a
    // slow link that promise just sits there — the data is already safe in the
    // on-disk queue, so say "waiting to sync" instead of a spinner that never ends.
    if(!signedIn && pending.size){ setStatus('wait', 'รอเข้าสู่ระบบก่อนบันทึก ' + pending.size + ' รายการ'); return; }
    if(queued.size){ setStatus('wait', 'รอซิงก์ ' + queued.size + ' รายการ (ข้อมูลถูกเก็บไว้แล้ว)'); return; }
    if(inFlight || pending.size){ setStatus('busy', 'กำลังบันทึก…'); return; }
    clearStatus();
  }

  async function boot(){
    const [{ initializeApp }, fs, authMod] = await Promise.all([
      import(SDK + 'firebase-app.js'),
      import(SDK + 'firebase-firestore.js'),
      import(SDK + 'firebase-auth.js')
    ]);
    const app = initializeApp(window.FIREBASE_CONFIG);
    fbApp = app;
    // Persistent cache = Firestore keeps unsent writes on disk and replays them
    // after a reload, which is what makes "offline for a while" survivable.
    try{
      db = fs.initializeFirestore(app, {
        localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() })
      });
    }catch(e){
      console.warn('[firebase] persistent cache unavailable, using memory cache', e);
      db = fs.getFirestore(app);
    }
    fsMod = fs;
    window.__fs = fs;
    window.firebaseAuth = authMod.getAuth(app);
    window.__fbAuthMod = authMod;   // auth.js reuses this — same SDK build, no second download
    window.__ssBackend = 'firestore';
    // Writes made before sign-in would all bounce off the rules, so hold them
    // in the pending map and release them the moment a session exists.
    authMod.onAuthStateChanged(window.firebaseAuth, (user)=>{
      signedIn = !!user;
      window.__fbSignedIn = signedIn;
      if(signedIn) releaseHeld();
    });
  }

  const ITEM_COLLS = window.__ITEM_COLLECTIONS || new Set();

  /* ---- images → Firebase Storage ----
     Any `data:<mime>;base64,...` string in a value about to be written is
     uploaded once and swapped for its download URL. The path is the SHA-256 of
     the bytes, so the same picture is only ever stored once (retries, copies on
     several rows, other devices), and a re-save of an unchanged record reuses
     the URL from memory without touching the network. */
  const DATA_URL_RE = /data:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+);base64,[A-Za-z0-9+/=]+/g;
  const mediaUrlOf = new Map();          // data URL string -> download URL (this session)
  let storageApi = null, storage = null;
  // Set when Storage refuses us (rules not published, bucket not created…):
  // from then on images stay inline for this session instead of every save
  // waiting on an upload that can't succeed.
  let storageOff = false;
  const UPLOAD_TIMEOUT_MS = 20000;
  async function getStorageApi(){
    if(!storageApi){
      storageApi = await import(SDK + 'firebase-storage.js');
      storage = storageApi.getStorage(fbApp);
      try{ storage.maxUploadRetryTime = UPLOAD_TIMEOUT_MS; storage.maxOperationRetryTime = UPLOAD_TIMEOUT_MS; }catch(e){}
    }
    return storageApi;
  }
  async function uploadDataUrl(dataUrl){
    if(mediaUrlOf.has(dataUrl)) return mediaUrlOf.get(dataUrl);
    const comma = dataUrl.indexOf(',');
    const mime = dataUrl.slice(5, dataUrl.indexOf(';'));
    const bin = atob(dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(bin.length);
    for(let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const hash = Array.from(digest, b=> b.toString(16).padStart(2, '0')).join('');
    const ext = ((mime.split('/')[1] || 'bin').replace('jpeg', 'jpg').replace(/[^a-z0-9]/gi, '') || 'bin').slice(0, 5).toLowerCase();
    const S = await getStorageApi();
    const ref = S.ref(storage, 'media/' + hash.slice(0, 2) + '/' + hash + '.' + ext);
    await S.uploadBytes(ref, bytes, { contentType: mime, cacheControl: 'public, max-age=31536000, immutable' });
    const url = await S.getDownloadURL(ref);
    mediaUrlOf.set(dataUrl, url);
    return url;
  }
  // Never blocks a save: an image that can't be uploaded simply stays inline
  // (exactly how records were stored before Storage), so bills still save
  // even while Storage isn't set up.
  async function offloadMedia(value){
    if(storageOff || typeof value !== 'string' || value.indexOf('data:') < 0) return value;
    const found = [...new Set(value.match(DATA_URL_RE) || [])].filter(u=> u.length > 512);
    if(!found.length) return value;
    const withTimeout = (p)=> Promise.race([p, new Promise((_, rej)=> setTimeout(()=> rej(new Error('upload timeout')), UPLOAD_TIMEOUT_MS))]);
    const urls = await Promise.all(found.map(u=> withTimeout(uploadDataUrl(u)).catch(err=>{
      const code = (err && err.code) || '';
      if(!storageOff && /unauthorized|unauthenticated|bucket-not-found|project-not-found|unknown|Failed to fetch|import/i.test(code + ' ' + (err && err.message))){
        storageOff = true;
        console.warn('[firebase] Storage unavailable — images stay inline for this session (' + (code || err.message) + '). Publish storage.rules to enable.');
      }else{
        console.warn('[firebase] image upload failed, kept inline', err);
      }
      return null;
    })));
    let out = value;
    found.forEach((u, i)=>{ if(urls[i]) out = out.split(u).join(urls[i]); });
    return out;
  }

  // One-time move: an item collection still living as a legacy whole-blob
  // document under appdata/<key> is exploded into one document per record.
  // The legacy blob is copied aside to appdata_legacy/<key> (NOT deleted) so
  // there's always a way back if anything looks wrong after the switch.
  async function migrateLegacyBlob(key, legacyRaw){
    let arr;
    try{ arr = JSON.parse(legacyRaw); }catch(e){ return null; }
    if(!Array.isArray(arr) || !arr.length) return null;
    console.info('[firebase] migrating ' + arr.length + ' records of ' + key + ' to per-record docs');
    // Back the blob up first, then write the per-record docs.
    try{ await fsMod.setDoc(fsMod.doc(db, 'appdata_legacy', key), { v: legacyRaw, at: Date.now() }); }catch(e){}
    for(const rec of arr){
      if(!rec || rec.id == null) continue;
      await writeItemDoc(key, rec.id, JSON.stringify(rec));
    }
    // Neutralise the old blob so a later boot doesn't migrate it again, but
    // keep the backup copy above.
    try{ await fsMod.deleteDoc(fsMod.doc(db, 'appdata', key)); }catch(e){}
    return JSON.stringify(arr);
  }

  /* ---- LIVE SYNC ----
     Every collection is read through onSnapshot, not getDocs: the first server
     snapshot is the initial load (hydrate), and every snapshot after that is
     another device's change arriving within a second or two. Changes this
     device still has queued are skipped so a remote copy can't overwrite an
     edit that hasn't been sent yet. Each change is applied to the cache and
     announced with a 'store-remote-change' event; module-registry.js reloads
     the modules and redraws the page. */
  const unsubs = [];
  const localBusy = (key)=> pending.has(key) || queued.has(key) || failed.has(key) || inFlightKeys.has(key);
  let remoteKeys = new Set(), remoteTimer = null;
  function announceRemote(key){
    remoteKeys.add(key);
    if(remoteTimer) return;
    remoteTimer = setTimeout(()=>{
      const keys = [...remoteKeys]; remoteKeys = new Set(); remoteTimer = null;
      window.dispatchEvent(new CustomEvent('store-remote-change', { detail: { keys } }));
    }, 250);
  }
  function onRemoteItems(key, changes){
    let any = false;
    changes.forEach(c=>{
      const id = c.doc.id;
      if(localBusy(ITEM_PREFIX + key + ITEM_SEP + id)) return;
      const raw = c.type === 'removed' ? null : joinParts(c.doc.data());
      if(typeof window.__applyRemoteItem === 'function' && window.__applyRemoteItem(key, id, raw)) any = true;
    });
    if(any) announceRemote(key);
  }
  function onRemoteBlobs(changes){
    changes.forEach(c=>{
      const k = c.doc.id;
      if(ITEM_COLLS.has(k) || localBusy(k)) return;
      if(c.type === 'removed'){ if(k in window.__ssCache){ delete window.__ssCache[k]; announceRemote(k); } return; }
      const raw = joinParts(c.doc.data());
      if(raw == null || window.__ssCache[k] === raw) return;
      window.__ssCache[k] = raw;
      announceRemote(k);
    });
  }
  // Resolves with the first snapshot that came from the SERVER (a cached one is
  // only accepted if the server hasn't answered within 12 s — offline start).
  function listen(colRef, onLater){
    return new Promise((resolve, reject)=>{
      let first = true, cached = null;
      const fallback = setTimeout(()=>{ if(first && cached){ first = false; console.warn('[firebase] server slow — starting from the offline cache'); resolve(cached); } }, 12000);
      const unsub = fsMod.onSnapshot(colRef, { includeMetadataChanges: true }, (snap)=>{
        if(first){
          if(snap.metadata.fromCache){ cached = snap; return; }
          first = false; clearTimeout(fallback); resolve(snap); return;
        }
        // Skip our own not-yet-confirmed writes; metadata-only changes are excluded by default.
        const changes = snap.docChanges().filter(c=> !c.doc.metadata.hasPendingWrites);
        if(changes.length) onLater(changes);
      }, (err)=>{
        if(first){ first = false; clearTimeout(fallback); reject(err); }
        else console.warn('[firebase] live sync stopped', err);
      });
      unsubs.push(unsub);
    });
  }
  /* ---- server counter (bill numbers) ----
     counters/<name> = { n, at }. A Firestore TRANSACTION runs against the
     server, so when two devices ask at the same moment one of them retries and
     gets the next number — no two bills can share a number. `floor` is the
     highest number already in use (from the bill list) so a brand-new counter
     continues the existing sequence instead of restarting at 1. Rejects when it
     can't reach the server or the rules refuse — callers fall back. */
  window.__reserveSeq = async function(name, floor){
    if(!db) await ready;
    if(!db || !signedIn) throw new Error('not signed in');
    const ref = fsMod.doc(db, 'counters', String(name).replace(/\//g, '_'));
    const run = fsMod.runTransaction(db, async (tx)=>{
      const snap = await tx.get(ref);
      const cur = snap.exists() ? (Number(snap.data().n) || 0) : 0;
      const n = Math.max(cur, Number(floor) || 0) + 1;
      tx.set(ref, { n, at: Date.now() });
      return n;
    }, { maxAttempts: 8 });
    return Promise.race([run, new Promise((_, rej)=> setTimeout(()=> rej(new Error('counter timeout')), 10000))]);
  };

  window.__stopLiveSync = ()=>{ unsubs.splice(0).forEach(u=>{ try{ u(); }catch(e){} }); };

  // onProgress(done, total) is optional — auth.js uses it for the loading screen.
  window.__hydrateStore = async function(onProgress){
    try{
      if(!db) await ready;
      if(!db) return;
      if(!signedIn){ console.info('[firebase] not signed in yet — skipping hydrate'); return; }
      window.__stopLiveSync();   // a re-hydrate (new sign-in) starts fresh listeners
      const t0 = performance.now();
      const keys = [...ITEM_COLLS];
      const total = keys.length + 1;
      let done = 0;
      const tick = ()=>{ done++; if(typeof onProgress === 'function'){ try{ onProgress(done, total); }catch(e){} } };
      const toArrStr = (snap)=>{
        const arr = [];
        snap.forEach(d=>{
          const raw = joinParts(d.data());
          if(raw == null) return;
          try{ arr.push(JSON.parse(raw)); }catch(e){ /* skip a corrupt record, keep the rest */ }
        });
        return JSON.stringify(arr);
      };

      // All collections in parallel; each listener stays open afterwards.
      const appdataP = listen(fsMod.collection(db, 'appdata'), onRemoteBlobs).then(snap=>{ tick(); return snap; });
      const itemsP = Promise.all(keys.map(key=>
        listen(fsMod.collection(db, key), (ch)=> onRemoteItems(key, ch)).then(snap=>{ tick(); return toArrStr(snap); })
      ));
      const [snap, itemStrs] = await Promise.all([appdataP, itemsP]);

      // 1) whole-blob keys (config, base-app data) from appdata/*
      const next = {};
      const legacyBlobs = {};
      snap.forEach(d=>{
        const raw = joinParts(d.data());
        if(raw == null) return;
        if(ITEM_COLLS.has(d.id)) legacyBlobs[d.id] = raw;  // an item collection not yet migrated
        else next[d.id] = raw;
      });

      // 2) item collections: per-record docs, migrating any legacy blob first
      for(let i = 0; i < keys.length; i++){
        const key = keys[i];
        let arrStr = itemStrs[i];
        let arr; try{ arr = JSON.parse(arrStr); }catch(e){ arr = []; }
        if((!arr || !arr.length) && legacyBlobs[key]){
          const migrated = await migrateLegacyBlob(key, legacyBlobs[key]);
          if(migrated != null) arrStr = migrated;
        }
        next[key] = arrStr;
      }
      console.info('[firebase] hydrate took ' + Math.round(performance.now() - t0) + ' ms (live sync on)');

      // Replace in place — store.js holds a reference to this object.
      Object.keys(window.__ssCache).forEach(k=> delete window.__ssCache[k]);
      Object.assign(window.__ssCache, next);
      // Re-base each device snapshot to what we just loaded, then open the gate.
      if(typeof window.__rebuildItemSnaps === 'function') window.__rebuildItemSnaps();
      window.__ssHydrated = true;
      console.info('[firebase] hydrated ' + Object.keys(next).length + ' keys (item-aware)');
    }catch(e){
      console.error('[firebase] hydrate failed', e);
      setStatus('bad', 'อ่านข้อมูลจาก Firebase ไม่สำเร็จ — ลองรีเฟรช', ()=> location.reload());
    }
  };

  // Write (or delete, when value===null) a SINGLE record document at
  // <collectionKey>/<id>. Same chunking contract as writeOnce.
  async function writeItemDoc(collKey, id, value){
    const ref = fsMod.doc(db, collKey, String(id));
    if(value === null){ await fsMod.deleteDoc(ref); return; }
    value = await offloadMedia(value);
    if(value.length <= CHUNK){
      await fsMod.setDoc(ref, { v: value, parts: 0, at: Date.now() });
      return;
    }
    const payload = { parts: Math.ceil(value.length / CHUNK), v: '', at: Date.now() };
    for(let i = 0; i < payload.parts; i++) payload['v' + i] = value.slice(i * CHUNK, (i + 1) * CHUNK);
    await fsMod.setDoc(ref, payload);
  }

  // A per-record write is queued under a composite key so it rides the exact
  // same debounce / retry / offline machinery as the whole-blob writes.
  const ITEM_PREFIX = 'ITEMDOC\u0001';
  const ITEM_SEP = '\u0001';

  async function writeOnce(key, value){
    if(key.indexOf(ITEM_PREFIX) === 0){
      const rest = key.slice(ITEM_PREFIX.length);
      const sep = rest.indexOf(ITEM_SEP);
      const collKey = rest.slice(0, sep);
      const id = rest.slice(sep + 1);
      await writeItemDoc(collKey, id, value);
      return;
    }
    const ref = fsMod.doc(db, 'appdata', key);
    if(value === null){ await fsMod.deleteDoc(ref); return; }
    value = await offloadMedia(value);
    if(value.length <= CHUNK){
      await fsMod.setDoc(ref, { v: value, parts: 0, at: Date.now() });
      return;
    }
    const payload = { parts: Math.ceil(value.length / CHUNK), v: '', at: Date.now() };
    for(let i = 0; i < payload.parts; i++) payload['v' + i] = value.slice(i * CHUNK, (i + 1) * CHUNK);
    await fsMod.setDoc(ref, payload);
  }

  async function writeWithRetries(key, value){
    for(let attempt = 1; attempt <= MAX_TRIES; attempt++){
      try{
        if(!db) await ready;
        await writeOnce(key, value);
        return true;
      }catch(e){
        if(attempt === MAX_TRIES){
          console.error('[firebase] save failed for ' + key, e);
          if(typeof window.logAppError === 'function') window.logAppError('บันทึกขึ้น Firebase ไม่สำเร็จ: ' + key, e);
          throw e;
        }
        await sleep(400 * Math.pow(2, attempt));   // 0.8s, 1.6s, 3.2s, 6.4s
      }
    }
  }

  async function push(key, value){
    let settled = false;
    inFlight++; inFlightKeys.add(key); paint();
    // Stop calling it "in progress" once it is clearly just waiting for the network.
    const slow = setTimeout(()=>{
      if(settled) return;
      inFlight--;
      queued.set(key, true);
      paint();
    }, SLOW_MS);

    try{
      await writeWithRetries(key, value);
      failed.delete(key);
      return true;
    }catch(e){
      failed.set(key, value);
      return false;
    }finally{
      settled = true;
      inFlightKeys.delete(key);
      clearTimeout(slow);
      if(queued.has(key)) queued.delete(key); else inFlight--;
      paint();
    }
  }

  async function retryFailed(){
    const items = [...failed.entries()];
    failed.clear(); paint();
    for(const [k, v] of items) await push(k, v);
  }

  function flush(key){
    timers.delete(key);
    if(!pending.has(key)) return;
    if(!signedIn){ paint(); return; }        // keep it queued; released after sign-in
    const value = pending.get(key);
    pending.delete(key);
    push(key, value);
  }
  function releaseHeld(){
    [...pending.keys()].forEach(k=>{
      if(timers.has(k)){ clearTimeout(timers.get(k)); timers.delete(k); }
      const v = pending.get(k);
      pending.delete(k);
      push(k, v);
    });
    paint();
  }

  window.__ssPersist = function(key, value){
    if(window.__fbReadOnly){                      // never accept a write we can't send
      setStatus('bad', 'ยังไม่ได้เชื่อม Firebase — ข้อมูลจะไม่ถูกบันทึก', ()=> location.reload());
      return;
    }
    pending.set(key, value);
    paint();
    if(timers.has(key)) clearTimeout(timers.get(key));
    timers.set(key, setTimeout(()=> flush(key), 400));
  };

  // Persist / delete ONE record of an item collection. value===null deletes.
  // Routed through __ssPersist so it shares debounce, retry, offline queue and
  // the "waiting to sync" status — each record id debounces independently.
  window.__ssPersistItem = function(collKey, id, value){
    window.__ssPersist(ITEM_PREFIX + collKey + ITEM_SEP + id, value);
  };

  // Anything still in the debounce window goes out immediately; if something is
  // genuinely unsaved, say so instead of losing it silently.
  window.addEventListener('beforeunload', (e)=>{
    timers.forEach((t, k)=>{ clearTimeout(t); flush(k); });
    if(failed.size || inFlight || pending.size){
      e.preventDefault();
      e.returnValue = '';
      return '';
    }
  });
  // Type __fbStatus() in the console to see exactly what the pill is counting.
  window.__fbStatus = ()=> ({
    signedIn,
    debouncing: [...pending.keys()],
    inFlight,
    waitingForServer: [...queued.keys()],
    failed: [...failed.keys()]
  });
  window.addEventListener('online', ()=>{ if(failed.size) retryFailed(); });
  setInterval(()=>{ if(failed.size) retryFailed(); }, 30000);

  ready = boot().catch(e=>{
    // No silent fallback to localStorage: that would hide the shop's data on one
    // machine and look like it worked.
    console.error('[firebase] init failed', e);
    window.__fbReadOnly = true;
    window.__ssBackend = 'local';
    const show = ()=> setStatus('bad', 'เชื่อม Firebase ไม่ได้ — ห้ามบันทึกข้อมูลจนกว่าจะเชื่อมได้', ()=> location.reload());
    if(document.body) show(); else document.addEventListener('DOMContentLoaded', show);
  });
  window.__storeReady = ready;
}
