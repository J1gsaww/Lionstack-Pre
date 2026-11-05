/* ============================================================================
 * Environment switch — loads FIRST, before anything else.
 *
 * ONE build runs everywhere. Which Firebase project it talks to is decided at
 * runtime, so the same zip can be pushed to the UAT repo and the production
 * repo without editing anything in between.
 *
 * Order of decision:
 *   1. a manual override saved on this device   (__setEnv('uat'|'prod'|'local'))
 *   2. the hostname / path of the page          (automatic, the normal case)
 *
 * TO GO LIVE: paste the production project's config into PROJECTS.prod below —
 * once. After that nothing in this file ever needs to change again.
 *
 * A Firebase web apiKey is not a secret: it only names the project. What
 * protects the data is Firestore Security Rules plus sign-in.
 * ==========================================================================*/
(function(){

  /* ---------------- 1. the projects ---------------- */
  const PROJECTS = {
    uat: {
      apiKey: "AIzaSyCFIvx4m-OksRMVQOg95fwPgPmzdEP4F-8",
      authDomain: "lionstack-17e94.firebaseapp.com",
      projectId: "lionstack-17e94",
      storageBucket: "lionstack-17e94.firebasestorage.app",
      messagingSenderId: "620776124334",
      appId: "1:620776124334:web:6b8a38d1f3e9590e50223f",
      measurementId: "G-1YEH2PYL4P"
    },

    prod: {
      apiKey: "AIzaSyAL-0MFQOScxGB1K1hC7SZhcLRI6trLymk",
      authDomain: "lionstack-pre.firebaseapp.com",
      projectId: "lionstack-pre",
      storageBucket: "lionstack-pre.firebasestorage.app",
      messagingSenderId: "1092455818261",
      appId: "1:1092455818261:web:b456d091bec5740ee11a1c",
      measurementId: "G-WDGW197QP4"
    }
  };

  /* ---------------- 2. which repo/host is which ---------------- */
  // Anything matching these is treated as UAT; everything else that is deployed
  // is treated as production.
  const UAT_MARKERS = ['lionstack-uat', 'uat.'];

  const host = (location.hostname || '').toLowerCase();
  const path = (location.pathname || '').toLowerCase();
  const isLocalHost = !host || host === 'localhost' || host === '127.0.0.1'
                      || host.startsWith('192.168.') || location.protocol === 'file:';

  let env;
  const override = (function(){ try{ return localStorage.getItem('lionstack_env'); }catch(e){ return null; } })();

  if(override === 'uat' || override === 'prod' || override === 'local'){
    env = override;
  }else if(isLocalHost){
    env = 'local';
  }else if(UAT_MARKERS.some(m=> host.startsWith(m) || path.includes(m))){
    env = 'uat';
  }else{
    env = 'prod';
  }

  // A production build with no project configured stays on localStorage rather
  // than quietly writing real data into the UAT database.
  let cfg = (env === 'local') ? null : PROJECTS[env];
  if(env === 'prod' && !cfg){
    console.warn('[env] production project is not configured yet — running on localStorage. Paste PROJECTS.prod in js/env.js.');
  }

  window.APP_ENV = env;
  window.FIREBASE_CONFIG = cfg || null;
  window.APP_MODE = cfg ? 'firebase' : 'local';

  /* ---------------- 3. switching by hand ---------------- */
  // In the console:  __setEnv('uat')  ·  __setEnv('prod')  ·  __setEnv(null) to
  // go back to automatic. Handy for testing UAT from a laptop, or for checking
  // production data from the UAT deployment.
  window.__setEnv = function(value){
    try{
      if(value) localStorage.setItem('lionstack_env', value);
      else localStorage.removeItem('lionstack_env');
    }catch(e){}
    location.reload();
  };
  window.__envInfo = ()=> ({ env, mode: window.APP_MODE, project: cfg ? cfg.projectId : null, override: override || null });

  console.info('[env] mode=' + window.APP_MODE + ' env=' + env + (cfg ? ' project=' + cfg.projectId : '')
               + (override ? ' (manual override)' : ''));

  /* ---------------- 4. a badge, so the two are never confused ---------------- */
  // Production shows nothing; anything else says so out loud.
  if(env !== 'prod'){
    const show = ()=>{
      if(document.getElementById('envBadge')) return;
      const b = document.createElement('div');
      b.id = 'envBadge';
      b.className = 'env-badge env-' + env;
      b.textContent = env.toUpperCase() + (cfg ? '' : ' · local data');
      b.title = 'คลิกเพื่อสลับสภาพแวดล้อม';
      b.addEventListener('click', ()=>{
        const next = prompt('สลับไปสภาพแวดล้อมไหน? (uat / prod / local / auto)', env);
        if(next) window.__setEnv(next === 'auto' ? null : next.trim().toLowerCase());
      });
      (document.body || document.documentElement).appendChild(b);
    };
    if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show);
    else show();
  }
})();

/* ============================================================================
 * ITEM COLLECTIONS — the collections that MANY people edit at once.
 *
 * Declared here (loads first) so both store.js and firebase-config.js share
 * ONE list. Each of these is stored one-document-per-record in Firestore, so
 * two people adding rows at the same time never overwrite each other. Every
 * record MUST carry a stable unique `id`.
 *
 * NOT listed here (kept as a single whole-blob document, last-write-wins):
 *   - mod_store_config       one settings object, edited by one admin at a time
 * ==========================================================================*/
window.__ITEM_COLLECTIONS = new Set([
  'mod_store_products',
  'mod_store_orders',
  'mod_store_deliveries',
  'mod_store_lots',
  'mod_store_stocklog',
  'mod_store_expenses',
  'mod_store_opex',
  'mod_store_promotions',
  'mod_store_orderlog',
  'mod_store_productlog',
  'mod_store_opexlog'
]);
// Flips true once the first hydrate finishes. Until then, item writes are
// blocked so a half-loaded page can't overwrite the cloud with a short list.
window.__ssHydrated = false;
