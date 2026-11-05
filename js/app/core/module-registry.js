"use strict";
/* js/app/core/module-registry.js
   MODULE REGISTRY — window.* exposure for modules
   Extracted verbatim from the original app.js (same load order, shared
   global scope). Behaviour is unchanged. */
/* ============================================================
   MODULE REGISTRY

   A module is an optional feature (accounting, etc.) that lives in its own
   file and hangs itself onto the app through registerModule(). The Base App
   has no knowledge of any specific module — it only walks whatever has
   registered. Ship a build without a module by not including its <script>;
   the array stays empty and every hook below is a no-op. There is no on/off
   flag to flip and nothing to comment out.

   A module object:
     id       unique string, also its storage-key prefix
     navLabel { th, en }   sidebar label (falls back to id)
     pageId   'page-<id>'  the <div class="page"> it owns
     mount(container)      build the page DOM once (optional)
     render()              repaint on open (optional)
     onInit()              async setup at boot, e.g. warm a cache (optional)
     backup { export(), import(data) }   JSON hooks (optional)

   Modules reach storage through the async Store face, never localStorage —
   so the Firebase swap reaches them for free.
   ============================================================ */
const MODULES = [];

function registerModule(mod){
  if(!mod || !mod.id){ logAppError('registerModule: ไม่มี id', null); return; }
  if(MODULES.some(m=> m.id === mod.id)){ logAppError('registerModule: id ซ้ำ ' + mod.id, null); return; }
  MODULES.push(mod);
}
function getModule(id){ return MODULES.find(m=> m.id === id) || null; }

// app.js is an ES module, so a module file in its own <script> can't see these
// through scope. Expose the small surface a module needs on window. Everything
// else (Store internals, render pipeline) stays private.
window.registerModule = registerModule;
window.getModule = getModule;
window.escapeHtml = escapeHtml;
window.Store = Store;
window.localIso = localIso;                 // today/any date → YYYY-MM-DD in app zone
window.zoneTodayPointer = zoneTodayPointer; // a Date pointing at "today" in app zone
window.monthName = monthName;               // localized month label
window.appLang = ()=> currentLang;          // read current language
window.renderSidebar = renderSidebar;       // module can refresh the badge after posting
window.navigateToView = (v)=> navigateTo(v);
window.downloadFile = downloadFile;         // module CSV/JSON export
window.t = t;            // module can localize its Interface box
function moduleByPage(pageId){ return MODULES.find(m=> m.pageId === pageId) || null; }
function moduleNavLabel(mod){
  const l = mod.navLabel;
  if(!l) return mod.id;
  return (currentLang === 'en' ? l.en : l.th) || l.th || l.en || mod.id;
}

// Module i18n: kept separate from the core I18N object so a module ships its
// own strings in its own file. moduleI18n(id) returns a t()-like reader that
// follows the app's current language.
const MODULE_I18N = {};
function registerModuleI18n(id, dict){
  MODULE_I18N[id] = dict || {};
}
window.registerModuleI18n = registerModuleI18n;
window.moduleI18n = moduleI18n;
// A module calls this after mutating its own data to repaint its page.
window.getModuleRender = (id)=>{
  const m = getModule(id);
  return (m && typeof m.render === 'function') ? ()=> m.render() : ()=>{};
};
function moduleI18n(id, forceLang){
  return (key)=>{
    const d = MODULE_I18N[id];
    if(!d) return key;
    const useEn = forceLang ? (forceLang === 'en') : (currentLang === 'en');
    const lang = useEn ? d.en : d.th;
    return (lang && lang[key]) || (d.th && d.th[key]) || key;
  };
}
// A module page repaints on language switch like any core page.
function renderActiveModuleOnLangChange(){
  if(currentView && currentView.type === 'module'){
    const m = getModule(currentView.moduleId);
    if(m && typeof m.render === 'function'){
      try{ m.render(); }catch(e){ logAppError('module render (lang) ล้มเหลว: ' + m.id, e); }
    }
  }
}

// JSON export asks each module for a blob under its id. Modules that don't
// implement backup contribute nothing.
function collectModuleBackups(){
  const out = {};
  MODULES.forEach(m=>{
    if(!m.backup || typeof m.backup.export !== 'function') return;
    try{ out[m.id] = m.backup.export(); }
    catch(e){ logAppError('module backup export ล้มเหลว: ' + m.id, e); }
  });
  return out;
}
// On import, hand each registered module its own slice. A slice whose module
// isn't loaded in this build is skipped, not an error — importing a full
// backup into the Base App must not fail just because it carries module data.
function applyModuleBackups(modData){
  if(!modData || typeof modData !== 'object') return;
  MODULES.forEach(m=>{
    if(!m.backup || typeof m.backup.import !== 'function') return;
    if(!(m.id in modData)) return;
    try{ m.backup.import(modData[m.id]); }
    catch(e){ logAppError('module backup import ล้มเหลว: ' + m.id, e); }
  });
}

// Called once at boot, after core data is loaded. A module can warm its own
// Store-backed state here. Failure in one module must not sink the app.
async function initModules(){
  for(const m of MODULES){
    if(typeof m.onInit !== 'function') continue;
    try{ await m.onInit(); }
    catch(e){ logAppError('module onInit ล้มเหลว: ' + m.id, e); }
  }
}
// Build each module's page DOM once. The host page div is created here if the
// module didn't ship its own markup, so index.html stays module-free.
function mountModulePages(){
  // Module pages must live inside .main (the column beside the sidebar), the
  // same parent as every built-in page. Appending to #jigsawRoot instead drops
  // them outside the layout — the page renders but sits under the sidebar,
  // invisibly, which reads as a blank screen.
  const root = document.querySelector('#jigsawRoot .main')
            || document.getElementById('jigsawRoot')
            || document.body;
  MODULES.forEach(m=>{
    if(!m.pageId) return;
    let page = document.getElementById(m.pageId);
    if(!page){
      page = document.createElement('div');
      page.id = m.pageId;
      page.className = 'page';
      page.style.display = 'none';
      root.appendChild(page);
    }
    if(!ALL_PAGES.includes(m.pageId)) ALL_PAGES.push(m.pageId);
    if(typeof m.mount === 'function'){
      try{ m.mount(page); }
      catch(e){ logAppError('module mount ล้มเหลว: ' + m.id, e); }
    }
  });
}

function onJigsawRootShown(){
  navigateTo({ type:'home' });
}
window.onJigsawRootShown = onJigsawRootShown;


/* ---- live sync: another device changed data ----
   firebase-config.js fires 'store-remote-change' { keys } after applying a
   change from another device to the cache. Every module that wants it gets
   onRemoteChange(keys) to re-read its arrays, then the page on screen is
   redrawn. If someone is mid-edit (a form or popup is open, or they are typing
   in a box) the redraw waits until they're done, so nothing they typed is
   lost; a small note says new data is waiting. */
let __remotePending = null;          // Set of keys not yet applied to the screen
let __remoteTimer = null;
function __screenBusy(){
  if(document.querySelector('.art-modal-overlay, .modal-overlay.show')) return true;
  if(document.querySelector('#oSave, #pSave')) return true;           // bill / product form open
  const a = document.activeElement;
  if(a && a.closest && a.closest('.main') && /^(INPUT|TEXTAREA)$/.test(a.tagName)
     && !/^(checkbox|radio|button|submit|date|month)$/i.test(a.type || '')) return true;
  return false;
}
function __remoteNote(show){
  let el = document.getElementById('remoteNote');
  if(!show){ if(el) el.remove(); return; }
  if(el) return;
  el = document.createElement('div');
  el.id = 'remoteNote';
  el.className = 'remote-note';
  el.textContent = (typeof currentLang !== 'undefined' && currentLang === 'en')
    ? 'New data from another device — the page will update when you finish'
    : 'มีข้อมูลใหม่จากเครื่องอื่น — หน้าจอจะอัปเดตเมื่อกรอกเสร็จ';
  document.body.appendChild(el);
}
async function __applyRemoteToScreen(){
  __remoteTimer = null;
  if(!__remotePending) return;
  if(__screenBusy()){ __remoteNote(true); __remoteTimer = setTimeout(__applyRemoteToScreen, 1500); return; }
  const keys = [...__remotePending]; __remotePending = null;
  __remoteNote(false);
  for(const m of MODULES){
    if(typeof m.onRemoteChange !== 'function') continue;
    try{ await m.onRemoteChange(keys); }catch(e){ logAppError('live sync reload failed: ' + m.id, e); }
  }
  try{
    const main = document.querySelector('.main');
    const top = main ? main.scrollTop : 0;
    if(typeof currentView !== 'undefined' && currentView && currentView.type === 'module'){
      const m = getModule(currentView.moduleId);
      if(m && typeof m.render === 'function') m.render();
    }
    if(main) main.scrollTop = top;
    if(typeof renderSidebar === 'function') renderSidebar();
  }catch(e){ logAppError('live sync redraw failed', e); }
}
window.addEventListener('store-remote-change', (e)=>{
  const keys = (e && e.detail && e.detail.keys) || [];
  if(!__remotePending) __remotePending = new Set();
  keys.forEach(k=> __remotePending.add(k));
  if(!__remoteTimer) __remoteTimer = setTimeout(__applyRemoteToScreen, 50);
});
