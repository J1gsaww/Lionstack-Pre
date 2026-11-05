// ============================================================
// AUTH — login gate that runs BEFORE the app is shown.
//
// LOCAL mode (APP_MODE !== 'firebase', the default now):
//   • Employees log in with their ID (username) + password, verified
//     against the Employee Management store via window.empVerifyPassword
//     (salted-SHA-256, local placeholder).
//   • "Dev Login" button → mock: grants the Developer role and enters
//     the app. This is the bootstrap path (use it on first run to create
//     employees). Wired to REAL Firebase Auth when APP_MODE='firebase'.
//
// FIREBASE mode: real Email/Password auth (dynamic-imported so local
//   mode never depends on the gstatic SDK). There is NO "Dev Login"
//   button in Firebase mode. The Developer role is granted ONLY when the
//   email that unlocks the device matches the developer's (see below);
//   every other Firebase account goes to the ordinary employee gate.
//
// The app only renders after enterApp() fires `app-authenticated`
// (app.js awaits authReadyPromise). Until then the login screen shows.
// ============================================================

// ------------------------------------------------------------
// DEV IDENTITY. The Developer role in Firebase mode is unlocked only when
// the unlocking email matches the one below. The raw email is NEVER stored
// — only a salted SHA-256 of it lives here, so viewing the page source (F12)
// shows a hash, not the address. This removes the open "Dev Login" button.
// (Honest limit: a determined user in DevTools can still bypass any
// client-side check; this raises the bar, it is not a hard wall.)
// ------------------------------------------------------------
const DEV_SALT = '760d06de570f310fc216adc1c54a3285';
const DEV_EMAIL_HASH = '403529bb6b60917507446d45f37e534b485f66173ed12d09ae18d6c98e3fcdce';

async function sha256Hex(str){
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b=> b.toString(16).padStart(2, '0')).join('');
}
async function isDevEmail(email){
  if(!email) return false;
  const h = await sha256Hex(DEV_SALT + ':' + String(email).trim().toLowerCase());
  return h === DEV_EMAIL_HASH;
}

// ---- loading screen (index.html #appLoading) ----
function showLoading(text, sub){
  const el = document.getElementById('appLoading');
  if(!el) return;
  el.style.display = 'flex';
  const t = document.getElementById('appLoadingText'); if(t) t.textContent = text || '';
  const sb = document.getElementById('appLoadingSub'); if(sb) sb.textContent = sub || '';
  const bar = document.getElementById('appLoadingBar');
  if(bar){ bar.style.width = '0'; bar.parentElement.classList.remove('on'); }
  const ls = document.getElementById('loginScreen'); if(ls) ls.style.display = 'none';
}
function loadingProgress(done, total){
  const bar = document.getElementById('appLoadingBar');
  if(bar && total){ bar.parentElement.classList.add('on'); bar.style.width = Math.round(done / total * 100) + '%'; }
  const sb = document.getElementById('appLoadingSub');
  if(sb && total) sb.textContent = done + ' / ' + total;
}
function hideLoading(){
  const el = document.getElementById('appLoading');
  if(el) el.style.display = 'none';
}

function enterApp(label){
  hideLoading();
  const loginScreen = document.getElementById('loginScreen');
  const jigsawRoot = document.getElementById('jigsawRoot');
  if(loginScreen) loginScreen.style.display = 'none';
  if(jigsawRoot) jigsawRoot.style.display = 'block';
  document.body.classList.add('jigsaw-theme');

  const who = document.getElementById('jigsawLoggedInAs');
  if(who) who.textContent = label || '';
  window.currentUser = { name: label || '' };

  // Signal app.js that it's safe to render (authReadyPromise).
  window.dispatchEvent(new Event('app-authenticated'));
  if(typeof window.onJigsawRootShown === 'function') window.onJigsawRootShown();
  // On a re-login (after logout) the app is already initialised — refresh
  // the sidebar so it reflects the new session.
  if(typeof window.renderSidebar === 'function') window.renderSidebar();
}

function showLogin(){
  hideLoading();
  const loginScreen = document.getElementById('loginScreen');
  const jigsawRoot = document.getElementById('jigsawRoot');
  if(loginScreen) loginScreen.style.display = 'flex';
  if(jigsawRoot) jigsawRoot.style.display = 'none';
  document.body.classList.remove('jigsaw-theme');
}

function wireLogout(handler){
  document.querySelectorAll('.logout-btn').forEach(btn=> btn.addEventListener('click', handler));
}

// ---- LOCAL: employee id/pass + Dev Login ----
function initLocalLogin(){
  console.info('[auth] local mode — employee login gate');
  const form    = document.getElementById('loginForm');
  const userEl  = document.getElementById('loginUsername');
  const passEl  = document.getElementById('loginPassword');
  const errEl   = document.getElementById('loginError');
  const devBtn  = document.getElementById('loginDevBtn');
  const showErr = (msg)=>{ if(errEl){ errEl.textContent = msg; errEl.style.display = 'block'; } };

  showLogin();

  if(form){
    form.addEventListener('submit', async (e)=>{
      e.preventDefault();
      if(errEl) errEl.style.display = 'none';
      const username = userEl ? userEl.value.trim() : '';
      const password = passEl ? passEl.value : '';
      if(!username || !password){ showErr('กรุณากรอก ID และรหัสผ่านให้ครบค่ะ'); return; }
      if(typeof window.empVerifyPassword !== 'function'){ showErr('ระบบยังไม่พร้อม ลองรีเฟรชอีกครั้งค่ะ'); return; }
      const submitBtn = form.querySelector('[type="submit"]');
      if(submitBtn) submitBtn.disabled = true;
      try{
        const emp = await window.empVerifyPassword(username, password);
        if(!emp){ showErr('ID หรือรหัสผ่านไม่ถูกต้องค่ะ'); return; }
        window.currentRole = emp.roleKey;
        window.currentEmployee = emp;
        if(passEl) passEl.value = '';
        enterApp(((emp.name||'') + ' ' + (emp.surname||'')).trim() || emp.username);
      }finally{
        if(submitBtn) submitBtn.disabled = false;
      }
    });
  }

  // The Dev bootstrap button exists ONLY in local mode (localhost first-run
  // bootstrap). In Firebase (production) it is removed from the DOM entirely:
  // the Developer role comes from the dev-email match at device unlock, never
  // from a button anyone can press.
  if(devBtn){
    if(window.APP_MODE === 'firebase'){
      devBtn.remove();
    }else{
      devBtn.style.display = '';
      devBtn.addEventListener('click', ()=>{
        window.currentRole = 'developer';
        window.currentEmployee = { username:'dev', name:'Developer', roleKey:'developer' };
        if(passEl) passEl.value = '';
        enterApp('Developer (dev)');
      });
    }
  }

  wireLogout(()=>{
    window.currentRole = null;
    window.currentEmployee = null;
    if(passEl) passEl.value = '';
    showLogin();
  });
}

// ---- FIREBASE: two stages ----------------------------------------------
// Stage 1 — DEVICE UNLOCK: a Firebase email/password account signs the browser
//   in so Firestore rules (request.auth != null) accept reads and writes. These
//   accounts exist ONLY for the owner/developer; staff never get one.
// Stage 2 — EMPLOYEE GATE: the normal in-app login. Employees are created in
//   Employee Management, verified against their salted hash, and their ROLE
//   comes from their employee record — exactly as in local mode.
// The Firebase session persists in the browser, so a shop terminal is unlocked
// once and staff simply sign in and out on top of it all day.
function authErrorMessage(code){

  switch(code){
    case 'auth/invalid-email':          return 'อีเมลไม่ถูกต้องค่ะ';
    case 'auth/user-disabled':          return 'บัญชีนี้ถูกระงับการใช้งาน';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':     return 'อีเมลหรือรหัสผ่านไม่ถูกต้องค่ะ';
    case 'auth/too-many-requests':      return 'ลองผิดหลายครั้งเกินไป กรุณารอสักครู่';
    case 'auth/network-request-failed': return 'เชื่อมต่อเครือข่ายไม่ได้ ลองใหม่ค่ะ';
    default:                            return 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่ค่ะ';
  }
}


let employeeGateWired = false;

function loginHint(text){
  let el = document.getElementById('loginStageHint');
  if(!el){
    const form = document.getElementById('loginForm');
    if(!form) return;
    el = document.createElement('p');
    el.id = 'loginStageHint';
    el.className = 'login-hint';
    form.insertBefore(el, form.firstChild);
  }
  el.textContent = text || '';
  el.style.display = text ? '' : 'none';
}

// Set the login heading + the ID-field label per stage (device unlock vs employee).
// data-i18n is removed so a later i18n pass won't overwrite the stage-specific text.
function setLoginText(title, idLabel){
  const h = document.querySelector('#loginScreen [data-i18n="login.title"]') || document.querySelector('#loginScreen h2');
  if(h){ h.removeAttribute('data-i18n'); h.textContent = title; }
  const lbl = document.querySelector('#loginScreen .field label');   // first field label = the ID field
  if(lbl){ lbl.removeAttribute('data-i18n'); lbl.textContent = idLabel; }
}

// Stage look: 'device' (company code) vs 'employee' — different band, icon,
// step indicator, labels and button so the two screens can't be mistaken.
function setLoginStage(stage){
  const card = document.getElementById('loginCard');
  if(card){ card.classList.toggle('stage-device', stage === 'device'); card.classList.toggle('stage-employee', stage === 'employee'); }
  const band = document.getElementById('loginStageBand');
  const ico = document.getElementById('loginStageIco');
  const lbl = document.getElementById('loginStageLabel');
  const steps = document.getElementById('loginSteps');
  const pass = document.getElementById('loginPassLabel');
  const btn = document.getElementById('loginSubmitBtn');
  const foot = document.getElementById('loginFootHint');
  if(band) band.style.display = stage ? '' : 'none';
  if(steps){
    steps.style.display = stage ? '' : 'none';
    steps.querySelectorAll('.login-step').forEach(el=>{
      const n = el.dataset.step;
      el.classList.toggle('active', (stage === 'device' && n === '1') || (stage === 'employee' && n === '2'));
      el.classList.toggle('done', stage === 'employee' && n === '1');
      const i = el.querySelector('i'); if(i) i.textContent = (stage === 'employee' && n === '1') ? '\u2713' : n;
    });
  }
  if(stage === 'device'){
    if(ico) ico.textContent = '\u{1F3E2}';
    if(lbl) lbl.textContent = 'เชื่อมอุปกรณ์นี้กับบริษัท';
    if(pass){ pass.removeAttribute('data-i18n'); pass.textContent = 'รหัสผ่านบริษัท'; }
    if(btn){ btn.removeAttribute('data-i18n'); btn.textContent = 'เชื่อมต่ออุปกรณ์'; }
    if(foot) foot.textContent = 'ทำครั้งเดียวต่อเครื่อง — ขอโค้ดบริษัทได้จากเจ้าของร้าน';
  }else if(stage === 'employee'){
    if(ico) ico.textContent = '\u2705';
    if(lbl) lbl.textContent = 'อุปกรณ์นี้เชื่อมกับบริษัทแล้ว';
    if(pass){ pass.removeAttribute('data-i18n'); pass.textContent = 'รหัสผ่าน'; }
    if(btn){ btn.removeAttribute('data-i18n'); btn.textContent = 'เข้าสู่ระบบ'; }
    if(foot) foot.textContent = 'ล็อกอินด้วย ID พนักงานของคุณ';
  }
}

// Stage 1: unlock the browser against Firebase.
function stageDeviceUnlock(auth, signInWithEmailAndPassword){
  const form   = document.getElementById('loginForm');
  const userEl = document.getElementById('loginUsername');
  const passEl = document.getElementById('loginPassword');
  const errEl  = document.getElementById('loginError');
  const devBtn = document.getElementById('loginDevBtn');
  const showErr = (msg)=>{ if(errEl){ errEl.textContent = msg; errEl.style.display = 'block'; } };

  showLogin();
  setLoginStage('device');
  setLoginText('กรอกโค้ดบริษัท', 'โค้ดบริษัท');
  loginHint('');
  if(userEl){ userEl.type = 'text'; userEl.placeholder = 'โค้ดบริษัท'; }
  if(devBtn) devBtn.style.display = 'none';       // no local dev bypass when the DB is live

  if(form && !form.__fbWired){
    form.__fbWired = true;
    form.addEventListener('submit', async (e)=>{
      e.preventDefault();
      if(!window.__fbStage || window.__fbStage !== 'device') return;   // employee gate owns the form now
      if(errEl) errEl.style.display = 'none';
      const email = userEl ? userEl.value.trim() : '';
      const password = passEl ? passEl.value : '';
      if(!email || !password){ showErr('กรุณากรอกโค้ดบริษัทและรหัสผ่านให้ครบค่ะ'); return; }
      const btn = form.querySelector('[type="submit"]');
      const label = btn ? btn.textContent : '';
      if(btn){ btn.disabled = true; btn.textContent = 'กำลังตรวจสอบ…'; }
      try{
        await signInWithEmailAndPassword(auth, email, password);
        if(passEl) passEl.value = '';
        if(userEl) userEl.value = '';
        // onAuthStateChanged takes over from here and shows the loading screen.
      }catch(err){
        showErr(authErrorMessage(err && err.code));
      }finally{
        if(btn){ btn.disabled = false; btn.textContent = label; }
      }
    });
  }
  window.__fbStage = 'device';
}

// Stage 2: the ordinary employee login, with a way back out of the device session.
function stageEmployeeGate(signOut, auth, user){
  const userEl = document.getElementById('loginUsername');
  window.__fbStage = 'employee';
  if(userEl){ userEl.type = 'text'; userEl.placeholder = 'username'; }
  setLoginStage('employee');
  setLoginText('เข้าสู่ระบบพนักงาน', 'ID พนักงาน');
  // No Dev button on this screen anymore — a non-dev Firebase account can
  // never become Developer, so there is nothing to show here.
  const devBtn = document.getElementById('loginDevBtn');
  if(devBtn) devBtn.remove();
  loginHint('');

  if(!employeeGateWired){
    employeeGateWired = true;
    initLocalLogin();                       // same gate, same roles, same hashes

    // Leaving the device entirely (ends the Firebase session too).
    const form = document.getElementById('loginForm');
    if(form && !document.getElementById('loginSignOutDevice')){
      const link = document.createElement('button');
      link.type = 'button';
      link.id = 'loginSignOutDevice';
      link.className = 'btn btn-ghost';
      link.style.cssText = 'width:100%; margin-top:8px; font-size:12px; opacity:0.8;';
      link.textContent = 'ยกเลิกการเชื่อมอุปกรณ์นี้ (เปลี่ยนบริษัท)';
      link.addEventListener('click', async ()=>{
        try{ await signOut(auth); }catch(e){ console.error('signOut failed', e); }
        location.reload();
      });
      form.appendChild(link);
    }
  }else{
    showLogin();
  }
}

function fbFatal(msg){
  const errEl = document.getElementById('loginError');
  showLogin();
  loginHint('');
  if(errEl){ errEl.textContent = msg; errEl.style.display = 'block'; }
  const form = document.getElementById('loginForm');
  if(form) form.querySelectorAll('input,button').forEach(el=> el.disabled = true);
}

async function initFirebaseAuth(){
  // firebase-config.js boots asynchronously; without this the check below runs
  // first and every load looks like "Firebase unavailable".
  try{ if(window.__storeReady) await window.__storeReady; }catch(e){}
  const auth = window.firebaseAuth;

  if(!auth){
    // Deliberately NO fallback to the local gate: writes would go nowhere.
    console.error('[auth] Firebase auth unavailable');
    fbFatal('เชื่อมต่อ Firebase ไม่ได้ — รีเฟรชหน้าอีกครั้ง หรือตรวจอินเทอร์เน็ตก่อนใช้งาน');
    return;
  }

  // Same SDK build firebase-config.js already loaded (it exposes it) — importing
  // a different version here used to download the whole auth SDK a second time.
  const { signInWithEmailAndPassword, onAuthStateChanged, signOut } =
    window.__fbAuthMod || await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");

  onAuthStateChanged(auth, async (user)=>{
    if(user){
      showLoading('กำลังโหลดข้อมูลบริษัท…', '');
      if(window.__hydrateStore) await window.__hydrateStore(loadingProgress);   // rules need the session
      // Developer is unlocked ONLY when the unlocking email is the dev's.
      // The shared/central account (and any other) falls through to the
      // ordinary employee gate — no Dev button, no Dev role.
      if(await isDevEmail(user.email)){
        const db = document.getElementById('loginDevBtn'); if(db) db.remove();
        window.currentRole = 'developer';
        window.currentEmployee = { username:'dev', name:'Developer', roleKey:'developer' };
        if(!window.__devLogoutWired){
          window.__devLogoutWired = true;
          wireLogout(async ()=>{
            try{ await signOut(auth); }catch(e){ console.error('signOut failed', e); }
            location.reload();
          });
        }
        enterApp('Developer \u00B7 ' + user.email);
      }else{
        stageEmployeeGate(signOut, auth, user);
      }
    }else{
      stageDeviceUnlock(auth, signInWithEmailAndPassword);
    }
  });
}

function initAuth(){
  if(window.APP_MODE !== 'firebase'){ initLocalLogin(); return; }
  initFirebaseAuth();
}

if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', initAuth);
}else{
  initAuth();
}
