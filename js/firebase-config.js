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
 * holding the JSON string. shop.html reads the same documents directly.
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
 * Documents are capped at 1 MiB by Firestore and this app stores base64 images
 * inline, so a big value is SPLIT across `v0..vN` with `parts` saying how many.
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
  let db = null, fsMod = null, ready = null;
  const pending = new Map();   // key -> latest value waiting for its debounce
  const timers  = new Map();
  const failed  = new Map();   // key -> value that exhausted its retries
  const queued  = new Map();   // key -> waiting for the server, already safe on disk
  let inFlight = 0;
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

  // Read one item collection (one document per record) back into a JSON array
  // string, the same shape store.js caches for the whole-blob keys.
  async function hydrateItemCollection(key){
    const snap = await fsMod.getDocs(fsMod.collection(db, key));
    const arr = [];
    snap.forEach(d=>{
      const raw = joinParts(d.data());
      if(raw == null) return;
      try{ arr.push(JSON.parse(raw)); }catch(e){ /* skip a corrupt record, keep the rest */ }
    });
    return JSON.stringify(arr);
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

  window.__hydrateStore = async function(){
    try{
      if(!db) await ready;
      if(!db) return;
      if(!signedIn){ console.info('[firebase] not signed in yet — skipping hydrate'); return; }

      // 1) whole-blob keys (config, stockpublic, base-app data) from appdata/*
      const snap = await fsMod.getDocs(fsMod.collection(db, 'appdata'));
      const next = {};
      const legacyBlobs = {};
      snap.forEach(d=>{
        const raw = joinParts(d.data());
        if(raw == null) return;
        if(ITEM_COLLS.has(d.id)) legacyBlobs[d.id] = raw;  // an item collection not yet migrated
        else next[d.id] = raw;
      });

      // 2) item collections: read per-record docs, migrating any legacy blob first
      for(const key of ITEM_COLLS){
        let arrStr = await hydrateItemCollection(key);
        let arr; try{ arr = JSON.parse(arrStr); }catch(e){ arr = []; }
        if((!arr || !arr.length) && legacyBlobs[key]){
          const migrated = await migrateLegacyBlob(key, legacyBlobs[key]);
          if(migrated != null) arrStr = migrated;
        }
        next[key] = arrStr;
      }

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
    inFlight++; paint();
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
