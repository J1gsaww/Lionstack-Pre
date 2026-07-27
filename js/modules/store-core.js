/* ============================================================
   ARTISAN CRAB MODULE — handmade resin keycap business console

   Ported from the standalone Artisan Crab "Accounting" app into a Base App
   module. Sub-pages (built incrementally):
     expense · summary · revenue · orderStatus · invoiceStatus ·
     products · setting · backup

   This file owns only its own Store keys (mod_artisan_*). Tags and statuses
   are user-editable (see the Setting sub-page) and stored as config, so the
   old hard-coded TAGS / ORDER_STATUSES / INVOICE_STATUSES become defaults
   that seed the config the first time the module runs.
   ============================================================ */
(function(){
  const ID = 'simplestore';
  const esc = window.escapeHtml;
  const T = (k)=> window.moduleI18n(ID)(k);
  // Bilingual display: show item.nameEn when app lang = en (falls back to the canonical item.name, which stays the stored/matched value).
  const itemLabel = (it)=> { if(!it) return ''; const en=(window.appLang&&window.appLang())==='en'; return en ? (it.nameEn||it.name||'') : (it.nameTh||it.name||''); };
  const dispName = (groupKey, storedName)=>{ const it=(config[groupKey]||[]).find(x=> x.name===storedName); return it ? itemLabel(it) : storedName; };
  const _fmtEditedAt = (iso)=> iso ? (String(iso).slice(0,10)+' '+String(iso).slice(11,16)) : '';
  const editedLabel = (rec)=>{ const by=rec.editedBy||rec.createdBy||''; const at=rec.editedAt||rec.createdAt||''; if(!by && !at) return '-'; return (by||'-') + (at ? ' \u00B7 '+_fmtEditedAt(at) : ''); };
  // Colour of a sold line: stored on the item, with a lookup fallback for older orders.
  function itemColorLabel(it){
    if(!it) return '';
    if(it.colorName) return it.colorName;
    if(!it.colorId) return '';
    const p = products.find(x=> x.id === it.productId);
    const c = (p && Array.isArray(p.colors)) ? p.colors.find(x=> x.id === it.colorId) : null;
    return c ? (c.name || '') : '';
  }
  async function saveOpex(){ await window.Store.set(K_OPEX, opex); }
  async function saveOpexLog(){ await window.Store.set(K_OPEXLOG, opexLog); }
  const opexLabel = (e)=> (e.details || dispName('expenseCategories', e.category) || '-') + ' \u00B7 ' + fmt(e.amount||0);
  async function saveDeletedOrders(){ await window.Store.set(K_DELORDERS, deletedOrders); }
  async function saveDeletedProducts(){ await window.Store.set(K_DELPRODUCTS, deletedProducts); }
  // Deleting never destroys a record: it moves to the Deleted List, out of every
  // total, until someone with the right permission restores it.
  function toBin(rec){ return Object.assign(JSON.parse(JSON.stringify(rec)), { deletedAt: new Date().toISOString(), deletedBy: currentActorName() }); }
  async function saveOrderLog(){ await window.Store.set(K_ORDERLOG, orderLog); }
  async function saveProductLog(){ await window.Store.set(K_PRODUCTLOG, productLog); }
  function logRec(arr, saveFn, entityId, label, action, snapshot, extra){ arr.push(Object.assign({ id: rid(), entityId, label: label||entityId, action, at: new Date().toISOString(), by: currentActorName(), snapshot: snapshot ? JSON.parse(JSON.stringify(snapshot)) : null }, extra || {})); saveFn(); }
  // Which image files came and went between two product versions. Only the FILE
  // NAME (and the colour it belongs to) is kept — never the deleted image data.
  function imageChangeList(oldP, newP){
    const out = [];
    const cmp = (oldArr, oldNames, newArr, newNames, colorLabel)=>{
      const oa = oldArr || [], na = newArr || [];
      oa.forEach((src, i)=>{ if(na.indexOf(src) < 0) out.push({ act:'remove', name: (oldNames && oldNames[i]) || '', color: colorLabel || '' }); });
      na.forEach((src, i)=>{ if(oa.indexOf(src) < 0) out.push({ act:'add', name: (newNames && newNames[i]) || '', color: colorLabel || '' }); });
    };
    cmp(oldP && oldP.images, oldP && oldP.imageNames, newP && newP.images, newP && newP.imageNames, '');
    const oldCols = (oldP && Array.isArray(oldP.colors)) ? oldP.colors : [];
    const newCols = (newP && Array.isArray(newP.colors)) ? newP.colors : [];
    newCols.forEach(nc=>{ const oc = oldCols.find(c=> c.id === nc.id); cmp(oc && oc.images, oc && oc.imageNames, nc.images, nc.imageNames, nc.name || ''); });
    oldCols.forEach(oc=>{ if(!newCols.some(c=> c.id === oc.id)) cmp(oc.images, oc.imageNames, [], [], oc.name || ''); });
    return out;
  }

  /* ---- Store keys ---- */
  const K_EXPENSES = 'mod_store_expenses';
  const K_ORDERS   = 'mod_store_orders';
  const K_PRODUCTS = 'mod_store_products';
  const K_STOCKLOG = 'mod_store_stocklog';
  const K_LOTS     = 'mod_store_lots';
  const K_DELORDERS   = 'mod_store_deleted_orders';
  const K_DELPRODUCTS = 'mod_store_deleted_products';
  const K_OPEX     = 'mod_store_opex';   // day-to-day running costs (rent, ads, fees...)
  const K_OPEXLOG  = 'mod_store_opexlog';
  const K_STOCKPUB = 'mod_store_stockpublic'; // quantities only — safe for the public shop (no costs, no orders)
  const K_CONFIG   = 'mod_store_config';   // { expenseTags, revenueTags, orderStatuses, invoiceStatuses }
  const K_PROMOS   = 'mod_store_promotions'; // [{ id, name, effectiveDate, endDate, items:[{productId,percent}], closed, endedAck }]
  const K_ORDERLOG   = 'mod_store_orderlog';
  const K_PRODUCTLOG = 'mod_store_productlog';
  const K_DELIVERIES = 'mod_store_deliveries'; // [{ id, orderId, status, createdAt }]

  /* ---- Default tags / statuses (seed config on first run) ---- */
  const DEFAULT_EXPENSE_TAGS = [
    { name:'Product',         color:'#5B8FB0', role:'product', locked:true },
    { name:'Instrument',      color:'#7C6A55' },
    { name:'Fix Cost',        color:'#FDBD31' },
    { name:'Production Cost',  color:'#FB7562' },
    { name:'Convenience',     color:'#6B8F71' },
    { name:'Future usage',    color:'#9B8B78' },
    { name:'Waste',           color:'#C6432E' }
  ];
  // Sales channels. `fee` = the platform's commission in % — stored now, used by
  // the profit maths later.
  // Expense categories for the accounting side. Payroll is locked: other parts of
  // the app expect it to exist.
  const DEFAULT_EXPENSE_CATEGORIES = [
    { name:'Office & Administrative', color:'#5B8FB0' },
    { name:'Payroll',                 color:'#9B7BB5', role:'payroll', locked:true },
    { name:'Selling & Marketing',     color:'#C99A4E' },
    { name:'Professional Fee',        color:'#4FA5A0' },
    { name:'General Operations',      color:'#6B8F71' }
  ];
  const DEFAULT_PLATFORMS = [
    { name:'Storefront',   color:'#6B8F71', fee:0 },
    { name:'Line',         color:'#4FA5A0', fee:0 },
    { name:'Shopee',       color:'#FB7562', fee:12 },
    { name:'Lazada',       color:'#5B8FB0', fee:10 },
    { name:'TikTok Shop',  color:'#9B7BB5', fee:12 }
  ];
  const DEFAULT_PAYMENT_MODES = [
    { name:'Cash',           color:'#6B8F71', locked:true },
    { name:'Online Banking', color:'#5B8FB0', locked:true }
  ];
  const DEFAULT_REVENUE_TAGS = [
    { name:'From Stock', color:'#6B8F71', locked:true },
    { name:'Pre-Order',  color:'#FDBD31', locked:true }
  ];
  const DEFAULT_ORDER_STATUSES = [
    { name:'Quotation',        color:'#9B8B78' },
    { name:'Confirmed',        color:'#FDBD31' },
    { name:'Deposit Received', color:'#E0A100' },
    { name:'In Production',    color:'#FB7562' },
    { name:'Ready to Ship',    color:'#C97B4E' },
    { name:'Shipped',          color:'#7C6A55', role:'shipped', locked:true },
    { name:'Completed',        color:'#6B8F71', role:'complete', locked:true }
  ];
  const DEFAULT_INVOICE_STATUSES = [
    { name:'Draft',          color:'#9B8B78' },
    { name:'Sent',           color:'#FDBD31' },
    { name:'Partially paid', color:'#FB7562' },
    { name:'Paid',           color:'#6B8F71', role:'paid', locked:true }
  ];
  const DEFAULT_DELIVERY_STATUSES = [
    { name:'Wait for Delivery',  color:'#9B8B78', role:'waiting',    locked:true },
    { name:'Delivering',         color:'#FDBD31', role:'delivering', locked:true },
    { name:'Success',            color:'#6B8F71', role:'success',    locked:true },
    { name:'A Problem Occurred', color:'#C6432E', role:'problem',    locked:true },
    { name:'Returned',           color:'#7C6A55', role:'returned',   locked:true }
  ];
  // Shipping types: 'Our Driver' + 'Outsource Driver' are locked (rename-only, can't delete); more can be added.
  const DEFAULT_SHIPPING_TYPES = [
    { name:'Our Driver',       color:'#5B8FB0', role:'our',       locked:true },
    { name:'Outsource Driver', color:'#C99A4E', role:'outsource', locked:true },
  ];
  const DEFAULT_OUTSOURCES = [{name:'Shopee'},{name:'Flash'},{name:'Thai Delivery'},{name:'Delivery A'},{name:'Delivery B'}];
  const DEFAULT_BROUGHT_FROM = [{name:'Local Shop'},{name:'Shopee'},{name:'Lazada'}];
  const DEFAULT_PRODUCT_TYPES = [
    { name:'Type A', color:'#6B8F71' },
    { name:'Type B', color:'#FDBD31' },
    { name:'Type C', color:'#FB7562' }
  ];
  const DEFAULT_COST_ORIGINS = [
    { name:'Shop A', color:'#6B8F71' },
    { name:'Shop B', color:'#FDBD31' },
    { name:'Shop C', color:'#FB7562' }
  ];

  /* ---- State ---- */
  let subPage = 'expense';
  let config = null;   // { expenseTags:[], revenueTags:[], orderStatuses:[], invoiceStatuses:[] }
  let expenses = [];
  let expFilter = { from:'', to:'', tag:'all' };
  let expEditingId = null;
  let expEditingOrigDate = null;
  let orders = [];
  let deliveries = [];
  let delFilter = { from:'', to:'', province:'all', region:'all', status:'all' };
  let delCalDate = null;
  let delCalFilter = { type:'all', driver:'all' };
  let delCalColorBy = 'status';
  let shipRegion = null;
  let shipCat = null;
  let ordFilter = { from:'', to:'', orderStatus:'all', invoiceStatus:'all', tag:'all' };
  let ordEditingId = null;
  let products = [];
  let stockLog = [];
  let lots = [];
  let promotions = [];
  let orderLog = [];
  let opex = [];
  let opexLog = [];
  let deletedOrders = [];
  let deletedProducts = [];
  let productLog = [];
  let _ehDetail = null;
  let prodEditingId = null;
  let prodImageData = null;
  let prodBillData = null;
  // Product status is DERIVED from stock, never chosen by hand.
  const PRODUCT_TAGS = [
    { name:'In Stock',     color:'#6B8F71' },
    { name:'Out of Stock', color:'#C6432E' }
  ];
  // Thai display names for the built-in defaults (canonical English `name` stays the stored/matched key).
  const _NAME_TH = {
    'Instrument':'เครื่องมือ/อุปกรณ์','Fix Cost':'ต้นทุนคงที่','Production Cost':'ต้นทุนการผลิต','Convenience':'ค่าอำนวยความสะดวก','Future usage':'สำรองไว้ใช้อนาคต','Waste':'ของเสีย',
    'From Stock':'จากสต็อก','Pre-Order':'พรีออเดอร์','Cash':'เงินสด','Online Banking':'โอนผ่านธนาคาร','Storefront':'หน้าร้าน',
    'Quotation':'ใบเสนอราคา','Confirmed':'ยืนยันแล้ว','Deposit Received':'รับมัดจำแล้ว','In Production':'กำลังผลิต','Ready to Ship':'พร้อมส่ง','Shipped':'จัดส่งแล้ว','Completed':'เสร็จสมบูรณ์',
    'Draft':'ฉบับร่าง','Sent':'ส่งแล้ว','Partially paid':'ชำระบางส่วน','Paid':'ชำระแล้ว',
    'Wait for Delivery':'รอจัดส่ง','Delivering':'กำลังจัดส่ง','Success':'สำเร็จ','A Problem Occurred':'เกิดปัญหา','Returned':'ตีกลับ',
    'Our Driver':'คนขับของร้าน','Outsource Driver':'คนขับภายนอก',
    'Thai Delivery':'ไทยเดลิเวอรี่','Delivery A':'ขนส่ง A','Delivery B':'ขนส่ง B',
    'Local Shop':'ร้านค้าท้องถิ่น',
    'Type A':'ประเภท A','Type B':'ประเภท B','Type C':'ประเภท C',
    'Shop A':'ร้าน A','Shop B':'ร้าน B','Shop C':'ร้าน C',
    'In Stock':'มีสินค้า','Out of Stock':'สินค้าหมด'
  };
  [DEFAULT_EXPENSE_TAGS, DEFAULT_REVENUE_TAGS, DEFAULT_ORDER_STATUSES, DEFAULT_INVOICE_STATUSES, DEFAULT_DELIVERY_STATUSES, DEFAULT_SHIPPING_TYPES, DEFAULT_OUTSOURCES, DEFAULT_BROUGHT_FROM, DEFAULT_PRODUCT_TYPES, DEFAULT_COST_ORIGINS, DEFAULT_PAYMENT_MODES, DEFAULT_PLATFORMS, DEFAULT_EXPENSE_CATEGORIES, PRODUCT_TAGS].forEach(list=> list.forEach(it=>{ if(_NAME_TH[it.name] && !it.nameTh) it.nameTh = _NAME_TH[it.name]; }));

  const SUBPAGES = ['expense','summary','account','revenue','orderStatus','invoiceStatus','products','stockHistory','setting'];

  /* ---- Config load / save ---- */
  async function loadConfig(){
    const saved = await window.Store.get(K_CONFIG);
    if(saved && saved.expenseTags){ config = saved; migrateConfigRoles(); return; }
    // Seed once from defaults.
    config = {
      expenseTags: DEFAULT_EXPENSE_TAGS.map(x=> ({ id: rid(), ...x })),
      revenueTags: DEFAULT_REVENUE_TAGS.map(x=> ({ id: rid(), ...x })),
      orderStatuses: DEFAULT_ORDER_STATUSES.map(x=> ({ id: rid(), ...x })),
      invoiceStatuses: DEFAULT_INVOICE_STATUSES.map(x=> ({ id: rid(), ...x })),
      deliveryStatuses: DEFAULT_DELIVERY_STATUSES.map(x=> ({ id: rid(), ...x })),
      shippingTypes: DEFAULT_SHIPPING_TYPES.map(x=> ({ id: rid(), ...x })),
      outsources: DEFAULT_OUTSOURCES.map(o=> ({ id: rid(), color: '#8A8F80', ...o })),
      broughtFrom: DEFAULT_BROUGHT_FROM.map(o=> ({ id: rid(), ...o })),
      productTypes: DEFAULT_PRODUCT_TYPES.map(x=> ({ id: rid(), ...x })),
      costOrigins: DEFAULT_COST_ORIGINS.map(x=> ({ id: rid(), ...x })),
      prefixes: { expense: 'CSA', order: 'ATSC' },
      business: { name:'', nameEn:'', address:'', addressEn:'', phone:'', taxId:'', branch:'\u0E2A\u0E33\u0E19\u0E31\u0E01\u0E07\u0E32\u0E19\u0E43\u0E2B\u0E0D\u0E48', logo:'', signature:'', stamp:'', vatDefault:false }
    };
    await saveConfig();
  }
  // Ensure a locked "complete" order status and a locked "paid" invoice status
  // always exist — these drive stock accounting and must not be deletable.
  function migrateConfigRoles(){
    let changed = false;
    const os = config.orderStatuses || [];
    if(!os.some(s=> s.role === 'complete') && os.length){ os[os.length-1].role = 'complete'; os[os.length-1].locked = true; changed = true; }
    const is = config.invoiceStatuses || [];
    if(!is.some(s=> s.role === 'paid') && is.length){ is[is.length-1].role = 'paid'; is[is.length-1].locked = true; changed = true; }
    if(!os.some(s=> s.role === 'shipped')){ const sh = os.find(s=> s.name === 'Shipped'); if(sh){ sh.role = 'shipped'; sh.locked = true; changed = true; } }
    const et = config.expenseTags || [];
    if(!et.some(t=> t.role === 'product')){
      const exist = et.find(t=> t.name === 'Product');
      if(exist){ exist.role = 'product'; exist.locked = true; }
      else et.unshift({ id: rid(), name:'Product', nameTh:'\u0E2A\u0E34\u0E19\u0E04\u0E49\u0E32', color:'#5B8FB0', role:'product', locked:true });
      changed = true;
    }
    if(!config.paymentModes){ config.paymentModes = DEFAULT_PAYMENT_MODES.map(x=> ({ id: rid(), ...x })); changed = true; }
    if(!config.platforms){ config.platforms = DEFAULT_PLATFORMS.map(x=> ({ id: rid(), ...x })); changed = true; }
    if(!config.expenseCategories){ config.expenseCategories = DEFAULT_EXPENSE_CATEGORIES.map(x=> ({ id: rid(), ...x })); changed = true; }
    // Retro-lock the defaults that must never be deleted (existing installs).
    const LOCK_BY_NAME = {
      revenueTags:      ['From Stock', 'Pre-Order'],
      paymentModes:     ['Cash', 'Online Banking'],
      expenseCategories:['Payroll']
    };
    Object.keys(LOCK_BY_NAME).forEach(grp=>{
      (config[grp] || []).forEach(it=>{
        if(LOCK_BY_NAME[grp].indexOf(it.name) >= 0 && !it.locked){ it.locked = true; changed = true; }
      });
    });
    (config.deliveryStatuses || []).forEach(it=>{ if(!it.locked){ it.locked = true; changed = true; } });   // every delivery status is locked
    if(!config.commission){ config.commission = { mode:'pool', base:'goods', rates:{} }; changed = true; }
    // Every product category gets a rate; 5% unless the user changes it.
    (config.productTypes || []).forEach(t=>{
      if(config.commission.rates[t.name] == null){ config.commission.rates[t.name] = 5; changed = true; }
    });
    if(!config.deliveryStatuses){ config.deliveryStatuses = DEFAULT_DELIVERY_STATUSES.map(x=> ({ id: rid(), ...x })); changed = true; }
    if(!config.shippingTypes){ config.shippingTypes = DEFAULT_SHIPPING_TYPES.map(x=> ({ id: rid(), ...x })); changed = true; }
    if(!config.outsources){ config.outsources = DEFAULT_OUTSOURCES.map(o=> ({ id: rid(), color: '#8A8F80', ...o })); changed = true; }
    ['our','outsource'].forEach(rl=>{ if(config.shippingTypes && !config.shippingTypes.some(s=> s.role===rl)){ config.shippingTypes.push({ id: rid(), ...DEFAULT_SHIPPING_TYPES.find(x=> x.role===rl) }); changed = true; } });
    if(!config.broughtFrom){ config.broughtFrom = DEFAULT_BROUGHT_FROM.map(o=> ({ id: rid(), ...o })); changed = true; }
    if(!config.productTypes){ config.productTypes = DEFAULT_PRODUCT_TYPES.map(x=> ({ id: rid(), ...x })); changed = true; }
    if(!config.costOrigins){ config.costOrigins = DEFAULT_COST_ORIGINS.map(x=> ({ id: rid(), ...x })); changed = true; }
    if(!config.prefixes){ config.prefixes = { expense: 'CSA', order: 'ATSC' }; changed = true; }
    if(!config.business){ config.business = { name:'', nameEn:'', address:'', addressEn:'', phone:'', taxId:'', branch:'\u0E2A\u0E33\u0E19\u0E31\u0E01\u0E07\u0E32\u0E19\u0E43\u0E2B\u0E0D\u0E48', logo:'', signature:'', stamp:'', vatDefault:false }; changed = true; }
    if(config.business && config.business.branch == null){ config.business.branch = '\u0E2A\u0E33\u0E19\u0E31\u0E01\u0E07\u0E32\u0E19\u0E43\u0E2B\u0E0D\u0E48'; changed = true; }
    // General Stores profile — same fields minus taxId. Seeded from the existing
    // Organization profile so non-VAT documents keep printing what they did before.
    if(!config.businessGeneral){
      const _src = config.business || {};
      config.businessGeneral = { name:_src.name||'', nameEn:_src.nameEn||'', address:_src.address||'', addressEn:_src.addressEn||'', phone:_src.phone||'', branch:_src.branch||'', logo:_src.logo||'', signature:_src.signature||'', stamp:_src.stamp||'' };
      changed = true;
    }
    ['expenseTags','revenueTags','orderStatuses','invoiceStatuses','deliveryStatuses','shippingTypes','outsources','broughtFrom','productTypes','costOrigins'].forEach(gk=>{ (config[gk]||[]).forEach(it=>{ if(!it.nameTh && _NAME_TH[it.name]){ it.nameTh = _NAME_TH[it.name]; changed = true; } }); });
    if(changed) saveConfig();
  }
  function statusByRole(group, role){ return (config[group] || []).find(s=> s.role === role) || null; }
  // Accounting (Ledger / VAT / Monthly Report) only counts orders whose invoice
  // status is the LOCKED "paid" one — nothing enters the books before payment.
  function paidStatusName(){ const st = statusByRole('invoiceStatuses','paid'); return st ? st.name : null; }
  function isPaidOrder(o){ const pn = paidStatusName(); return !!pn && o.invoiceStatus === pn; }
  // Outstanding balance. A bill whose invoice status is the locked "paid" one is
  // settled by definition — whatever was typed in Partially Paid, nothing is due.
  // Ledger style: nothing there is a dash, not a zero.
  const fmtD = (n)=> (Number(n) || 0) === 0 ? '-' : fmt(n);
  function pendingOf(co){
    if(isPaidOrder(co)) return 0;
    return Math.max(0, (co.net || 0) - (co.paidAmount || 0));
  }
  async function saveConfig(){ await window.Store.set(K_CONFIG, config); }
  function rid(){ return 'a' + Math.random().toString(36).slice(2,10); }

  /* ---- Promotions ----
     A product is "on sale" only through an active promotion — there is no
     per-product flag. A promotion is active when today is within its
     [effectiveDate, endDate] window (app timezone). Because a client-only /
     Firestore setup runs no background jobs, expiry is enforced lazily: on app
     open, runPromoConditionCheck() closes any window that has passed and flags
     it for a one-time Base App notification. Until the owner reopens the app,
     an expired promo simply keeps running — their responsibility, by design. */
  async function savePromotions(){ await window.Store.set(K_PROMOS, promotions); }

  // Highest active discount % for a product today (0 = not on sale). If two live
  // promotions cover the same product, the bigger discount wins.
  function activePromoPercent(productId){
    const today = window.localIso();
    let best = 0;
    for(const p of promotions){
      if(p.effectiveDate && p.effectiveDate > today) continue;  // not started yet
      if(p.endDate && p.endDate < today) continue;              // already over
      const it = (p.items || []).find(x=> x.productId === productId);
      if(it && (it.percent || 0) > best) best = it.percent;
    }
    return best;
  }

  // Run once at app open: close any promo past its end date and flag it so the
  // notification provider announces it exactly once.
  async function runPromoConditionCheck(){
    const today = window.localIso();
    let changed = false;
    promotions.forEach(p=>{
      if(!p.closed && p.endDate && p.endDate < today){ p.closed = true; p.endedAck = false; changed = true; }
    });
    if(changed) await savePromotions();
  }

  /* ---- Module registration ---- */
  /* ============================================================
     MODULE SPLIT — the one "Simple Store" module became FOUR sidebar
     modules over a shared core (same data keys / helpers / renderers):
       Stock Management  : products, stockHistory
       Sell Management   : revenue, orderStatus, invoiceStatus
       Accounting        : expense, summary, account  (+ Import/Export box)
       Business Profile  : setting  (the old in-store Setting subpage)
     Each is a thin registration; the render functions below are untouched.
     ============================================================ */

  let _storeLoaded = false;
  async function ensureLoaded(){
    if(_storeLoaded) return;
    _storeLoaded = true;
    await loadConfig();
    expenses   = await window.Store.list(K_EXPENSES);
    orders     = await window.Store.list(K_ORDERS);
    products   = await window.Store.list(K_PRODUCTS);
    stockLog   = await window.Store.list(K_STOCKLOG);
    lots       = await window.Store.list(K_LOTS);
    deliveries = await window.Store.list(K_DELIVERIES);
    promotions = await window.Store.list(K_PROMOS);
    orderLog   = await window.Store.list(K_ORDERLOG);
    opex            = await window.Store.list(K_OPEX);
    opexLog         = await window.Store.list(K_OPEXLOG);
    deletedOrders   = await window.Store.list(K_DELORDERS);
    deletedProducts = await window.Store.list(K_DELPRODUCTS);
    productLog = await window.Store.list(K_PRODUCTLOG);
    await migrateStockLots();
    seedShippingCost();
    syncDeliveries();
    await runPromoConditionCheck();
    if(window.registerNotifyProvider){
      window.registerNotifyProvider(()=> promotions
        .filter(p=> p.closed && !p.endedAck)
        .map(p=>{
          const end = p.endDate ? new Date(p.endDate + 'T23:59:59') : new Date();
          return {
            id: 'promo:' + p.id, kind: 'promo', title: T('promo.endedTitle'),
            subtitle: (p.name || T('promo.untitled')) + ' \u00B7 ' + T('promo.endedOn') + ' ' + (p.endDate || '-'),
            tag: T('promo.navLabel'), msLeft: end.getTime() - Date.now(),
            color: '#C6432E', ink: '#FFFFFF',
            onClick: async ()=>{ p.endedAck = true; await savePromotions(); if(window.renderSidebar) window.renderSidebar(); }
          };
        })
      );
    }
  }

  function renderSubpage(id, body){
    if(id === 'profile') renderBusinessProfilePage(body, 'org');
    else if(id === 'profileGeneral') renderBusinessProfilePage(body, 'general');
    else if(id === 'stockConfig') renderStockConfig(body);
    else if(id === 'sellConfig') renderSellConfig(body);
    else if(id === 'revenue') renderRevenuePage(body);
    else if(id === 'products') renderProductsPage(body);
    else if(id === 'orderStatus') renderOrderKanban(body);
    else if(id === 'invoiceStatus') renderInvoiceKanban(body);
    else if(id === 'stockHistory') renderStockHistory(body);
    else if(id === 'deliveryList') renderDeliveryPage(body);
    else if(id === 'deliveryBoard') renderDeliveryKanban(body);
    else if(id === 'deliveryCalendar') renderDeliveryCalendar(body);
    else if(id === 'deliveryDrivers') renderDriverColors(body);
    else if(id === 'grouping') renderDeliveryConfig(body);
    else if(id === 'shippingCost') renderShippingCost(body);
    else if(id === 'productHistory') renderEditHistory('product', body);
    else if(id === 'orderHistory') renderEditHistory('order', body);
    else if(id === 'invoicing') renderBillsPage(body, 'invoicing');
    else if(id === 'receipts') renderBillsPage(body, 'receipts');
    else if(id === 'cogsTracking') renderCogsPage(body);
    else if(id === 'stockValue') renderStockValuation(body);
    else if(id === 'sellingExpenses') renderSellingExpenses(body);
    else if(id === 'apList') renderApPage(body);
    else if(id === 'opExpense') renderOpExpense(body);
    else if(id === 'finOverview') renderFinPage(body, 'overview');
    else if(id === 'pnl') renderFinPage(body, 'pnl');
    else if(id === 'cashFlow') renderFinPage(body, 'cash');
    else if(id === 'taxReport') renderFinPage(body, 'tax');
    else if(id === 'customerDoc') renderCustomerDoc(body);
    else if(id === 'opexHistory') renderEditHistory('opex', body);
    else if(id === 'commissionSetting') renderCommissionSetting(body);
    else if(id === 'accountingSetting') renderAccountingSetting(body);
    else body.innerHTML = `<div class="panel"><p class="setting-desc">${esc(T('soon'))}</p></div>`;
  }
  // One place that knows which log + which field list belongs to a record kind.
  function ehLogOf(kind){ return kind === 'order' ? orderLog : (kind === 'opex' ? opexLog : productLog); }
  function ehSaveOf(kind){ return kind === 'order' ? saveOrderLog : (kind === 'opex' ? saveOpexLog : saveProductLog); }
  function ehFieldsOf(kind){ return kind === 'order' ? orderDiffFields() : (kind === 'opex' ? opexDiffFields() : productDiffFields()); }
  function opexDiffFields(){ return [
    {key:'date', label:T('exp.date')},
    {key:'category', label:T('ox.category'), fmt:(v)=> dispName('expenseCategories', v)},
    {key:'details', label:T('ox.details')},
    {key:'method', label:T('pay.mode'), fmt:(v)=> dispName('paymentModes', v)},
    {key:'amount', label:T('ox.amount'), fmt:(v)=> fmt(v||0)}
  ]; }
  function ehActionText(a){ return T('eh.'+a); }
  function ehActionBadge(a){ const c = a==='create'?'#6B8F71':(a==='delete'?'#C6432E':'#E0A100'); return `<span class="art-pill" style="background:${c}">${esc(ehActionText(a))}</span>`; }
  function showRawSnapshot(ev){
    const ov = document.createElement('div'); ov.className='art-modal-overlay show';
    ov.innerHTML = `<div class="art-modal" style="max-width:680px;"><h3 class="art-modal-title">${esc(T('eh.rawTitle'))}</h3><p class="setting-desc" style="margin:-4px 0 10px;">${esc(ev.label||'')} \u00B7 ${esc(ehActionText(ev.action))} \u00B7 ${esc(_fmtEditedAt(ev.at))} \u00B7 ${esc(ev.by||'-')}</p><pre class="eh-raw-pre">${esc(ev.snapshot ? JSON.stringify(ev.snapshot, null, 2) : '-')}</pre><div class="art-modal-actions"><button class="btn btn-primary" id="ehClose">${esc(T('close'))}</button></div></div>`;
    document.body.appendChild(ov);
    const close=()=> ov.remove();
    ov.addEventListener('click', e=>{ if(e.target===ov) close(); });
    ov.querySelector('#ehClose').addEventListener('click', close);
  }
  function renderEditHistory(kind, body){
    if(_ehDetail && _ehDetail.kind===kind){ renderEditHistoryDetail(kind, body); return; }
    const log = ehLogOf(kind);
    const byId = {};
    log.forEach(e=>{ (byId[e.entityId] = byId[e.entityId] || []).push(e); });
    const records = Object.keys(byId).map(eid=>{
      const evs = byId[eid].slice().sort((a,b)=> String(b.at||'').localeCompare(String(a.at||'')));
      return { eid, label: evs[0].label, events: evs, last: evs[0] };
    }).sort((a,b)=> String(b.last.at||'').localeCompare(String(a.last.at||'')));
    body.innerHTML = `<div class="art-table-wrap"><table class="art-table"><thead><tr><th>${esc(T('eh.record'))}</th><th class="num">${esc(T('eh.changes'))}</th><th>${esc(T('eh.lastAction'))}</th><th>${esc(T('eh.lastEdited'))}</th></tr></thead><tbody>${records.length ? records.map(r=> `<tr class="eh-rec" data-eid="${esc(r.eid)}"><td>${esc(r.label||r.eid)}</td><td class="num">${r.events.length}</td><td>${ehActionBadge(r.last.action)}</td><td class="art-edited">${esc((r.last.by||'-')+' \u00B7 '+_fmtEditedAt(r.last.at))}</td></tr>`).join('') : `<tr><td colspan="4" class="art-empty">${esc(T('eh.empty'))}</td></tr>`}</tbody></table></div>`;
    body.querySelectorAll('.eh-rec').forEach(tr=> tr.addEventListener('click', ()=>{ const lg = ehLogOf(kind); const es = lg.filter(e=> e.entityId === tr.dataset.eid).slice().sort((a,b)=> String(b.at||'').localeCompare(String(a.at||''))); _ehDetail = { kind, eid: tr.dataset.eid, evId: es.length ? es[0].id : null }; renderEditHistory(kind, body); }));
  }
  function renderEditHistoryDetail(kind, body){
    const log = ehLogOf(kind);
    const evsDesc = log.filter(e=> e.entityId === _ehDetail.eid).slice().sort((a,b)=> String(b.at||'').localeCompare(String(a.at||'')));
    if(!evsDesc.length){ _ehDetail = null; renderEditHistory(kind, body); return; }
    if(!_ehDetail.evId || !evsDesc.some(e=> e.id===_ehDetail.evId)) _ehDetail.evId = evsDesc[0].id;
    const label = evsDesc[0].label;
    const asc = evsDesc.slice().reverse();
    const idx = asc.findIndex(x=> x.id===_ehDetail.evId);
    const ev = asc[idx];
    const prev = idx>0 ? asc[idx-1] : null;
    const oldObj = (ev.action==='create') ? null : (prev ? prev.snapshot : null);
    const newObj = (ev.action==='delete') ? null : ev.snapshot;
    const pills = evsDesc.map(e=> `<button type="button" class="eh-evpill ${e.id===_ehDetail.evId?'active':''}" data-id="${esc(e.id)}">${ehActionBadge(e.action)}<span class="eh-evpill-at">${esc(_fmtEditedAt(e.at))} \u00B7 ${esc(e.by||'-')}</span></button>`).join('');
    body.innerHTML = `<button type="button" class="btn btn-ghost" id="ehBack">\u2190 ${esc(T('eh.back'))}</button><div class="eh-diff-head-bar"><h3 class="art-form-section" style="margin:12px 0 2px;">${esc(label)}</h3><button type="button" class="btn btn-ghost" id="ehRawBtn">${esc(T('eh.viewRaw'))}</button></div>${evsDesc.length>1 ? `<div class="eh-evsel">${pills}</div>` : ''}${renderDiffView(kind, oldObj, newObj)}${imageChangesHtml(ev)}`;
    body.querySelector('#ehBack').addEventListener('click', ()=>{ _ehDetail = null; renderEditHistory(kind, body); });
    body.querySelector('#ehRawBtn').addEventListener('click', ()=> showRawSnapshot(ev));
    body.querySelectorAll('.eh-evpill').forEach(b=> b.addEventListener('click', ()=>{ _ehDetail.evId = b.dataset.id; renderEditHistoryDetail(kind, body); }));
  }
  function orderDiffFields(){ return [
    {key:'date', label:T('exp.date')},
    {key:'orderStatus', label:T('rev.orderStatus'), fmt:(v)=> dispName('orderStatuses', v)},
    {key:'invoiceStatus', label:T('rev.invoiceStatus'), fmt:(v)=> dispName('invoiceStatuses', v)},
    {key:'tag', label:T('exp.tag'), fmt:(v)=> dispName('revenueTags', v)},
    {key:'platform', label:T('rev.platform')},
    {key:'customerName', label:T('rev.customer')},
    {key:'phone', label:T('rev.phone')},
    {key:'deliveryMethod', label:T('rev.deliveryMethod'), fmt:(v)=> dispName('shippingTypes', v)},
    {key:'deliveryResponsible', label:T('rev.responsible')},
    {key:'address', label:T('rev.address')},
    {key:'shippingCost', label:T('rev.shippingCost'), fmt:(v)=> fmt(v||0)},
    {key:'overallDiscount', label:T('rev.overallDiscount'), fmt:(v)=> fmt(v||0)},
    {key:'note', label:T('eh.note')}
  ]; }
  function productDiffFields(){ return [
    {key:'sku', label:T('prod.sku')},
    {key:'name', label:T('prod.name')},
    {key:'productType', label:T('prod.ptype'), fmt:(v)=> dispName('productTypes', v)},
    {key:'description', label:T('prod.desc')},
    {key:'cost', label:T('prod.cost'), fmt:(v)=> fmt(v||0)},
    {key:'price', label:T('prod.price'), fmt:(v)=> fmt(v||0)},
    {key:'stock', label:T('prod.stock')},
    {key:'tag', label:T('prod.tag')}
  ]; }
  function _diffRow(label, ov, nv, changed){
    const o = (ov==null||ov==='') ? '\u2014' : esc(String(ov));
    const n = (nv==null||nv==='') ? '\u2014' : esc(String(nv));
    return `<div class="eh-diff-row ${changed?'eh-changed':''}"><div class="eh-diff-label">${esc(label)}</div><div class="eh-diff-old">${o}</div><div class="eh-diff-arrow">\u2192</div><div class="eh-diff-new">${n}</div></div>`;
  }
  // Document/VAT settings shown as their own block at the foot of the diff.
  function billDocFields(){ return [
    {key:'vatable', label:T('pay.vat'), fmt:(v)=> v ? T('pay.vatYes') : T('pay.vatNo')},
    {key:'docSplit', label:T('doc.splitMode'), fmt:(v)=> (v === 'split') ? T('doc.splitApart') : T('doc.splitTogether')},
    {key:'paymentMode', label:T('pay.mode'), fmt:(v)=> dispName('paymentModes', v)},
    {key:'platformFee', label:T('rev.platformFee'), fmt:(v)=> (v ? v + '%' : '-')}
  ]; }
  function _itemsDiff(oldObj, newObj){
    const f = (obj)=> (obj && obj.items ? obj.items : []).map(it=>{ const c = itemColorLabel(it); return esc((it.productName||'-')+(c?' ('+c+')':'')+' \u00B7 '+(it.qty||0)+'\u00D7'+fmt(it.price||0)+(it.discount?' -'+fmt(it.discount)+(it.discountType==='percent'?'%':''):'')); }).join('<br>') || '\u2014';
    const ov = oldObj ? f(oldObj) : null, nv = newObj ? f(newObj) : null;
    const changed = String(ov==null?'\u0000':ov) !== String(nv==null?'\u0000':nv);
    return `<div class="eh-diff-row ${changed?'eh-changed':''}"><div class="eh-diff-label">${esc(T('eh.items'))}</div><div class="eh-diff-old">${ov==null?'\u2014':ov}</div><div class="eh-diff-arrow">\u2192</div><div class="eh-diff-new">${nv==null?'\u2014':nv}</div></div>`;
  }
  function imageChangesHtml(ev){
    const ch = (ev && Array.isArray(ev.imageChanges)) ? ev.imageChanges : [];
    if(!ch.length) return '';
    return `<div class="eh-imgch"><div class="eh-imgch-title">${esc(T('eh.imgChanges'))}</div>` + ch.map(c=>
      `<div class="eh-imgch-row"><span class="eh-imgch-act ${c.act==='add'?'add':'rm'}">${esc(c.act==='add'?T('eh.imgAdded'):T('eh.imgRemoved'))}</span><span class="eh-imgch-name">${esc(c.name || T('eh.imgNoName'))}</span>${c.color ? `<span class="eh-imgch-color"><span class="pc-dot" style="background:transparent"></span>${esc(T('pc.colorLabel'))}: ${esc(c.color)}</span>` : ''}</div>`
    ).join('') + `</div>`;
  }
  function renderDiffView(kind, oldObj, newObj){
    const fields = ehFieldsOf(kind);
    const rows = fields.map(f=>{
      const ov = oldObj ? (f.fmt ? f.fmt(oldObj[f.key], oldObj) : (oldObj[f.key]==null?'':oldObj[f.key])) : null;
      const nv = newObj ? (f.fmt ? f.fmt(newObj[f.key], newObj) : (newObj[f.key]==null?'':newObj[f.key])) : null;
      const changed = String(ov==null?'\u0000':ov) !== String(nv==null?'\u0000':nv);
      return _diffRow(f.label, ov, nv, changed);
    }).join('');
    const items = kind==='order' ? _itemsDiff(oldObj, newObj) : '';
    const head = `<div class="eh-diff-row eh-diff-head"><div class="eh-diff-label"></div><div class="eh-diff-old">${esc(T('eh.old'))}</div><div class="eh-diff-arrow"></div><div class="eh-diff-new">${esc(T('eh.new'))}</div></div>`;
    let billBlock = '';
    if(kind === 'order'){
      const bRows = billDocFields().map(f=>{
        const ov2 = oldObj ? (f.fmt ? f.fmt(oldObj[f.key], oldObj) : (oldObj[f.key]==null?'':oldObj[f.key])) : null;
        const nv2 = newObj ? (f.fmt ? f.fmt(newObj[f.key], newObj) : (newObj[f.key]==null?'':newObj[f.key])) : null;
        const changed = String(ov2==null?'\u0000':ov2) !== String(nv2==null?'\u0000':nv2);
        return _diffRow(f.label, ov2, nv2, changed);
      }).join('');
      billBlock = `<div class="eh-diff-section">${esc(T('eh.billDetails'))}</div>${bRows}`;
    }
    return `<div class="eh-diff">${head}${rows}${items}${billBlock}</div>`;
  }

    const _dataTools = {
      render(){
        return `
          <div class="settings-section">
            <div class="settings-section-head">
              <h3 class="setting-title">${esc(T('io.exportTitle'))}</h3>
              <p class="setting-desc">${esc(T('io.exportDesc'))}</p>
            </div>
            <div class="if-row">
              <button class="btn btn-primary" id="storeExportJson">${esc(T('io.json'))}</button>
            </div>
            <p class="setting-desc" style="margin:12px 0 6px;">${esc(T('io.csvExportLabel'))}</p>
            <div class="if-row">
              <button class="btn btn-ghost" id="storeExportExpCsv">${esc(T('io.csvExp'))}</button>
              <button class="btn btn-ghost" id="storeExportOrdCsv">${esc(T('io.csvOrd'))}</button>
              <button class="btn btn-ghost" id="storeExportProdCsv">${esc(T('io.csvProd'))}</button>
            </div>
          </div>
          <div class="settings-section">
            <div class="settings-section-head">
              <h3 class="setting-title">${esc(T('io.importTitle'))}</h3>
              <p class="setting-desc">${esc(T('io.importDesc'))}</p>
              <p class="setting-desc art-io-note">${esc(T('io.importNote'))}</p>
            </div>
            <div class="if-row">
              <label class="file-picker">
                <input type="file" id="storeImportFile" accept=".json,.csv,application/json,text/csv">
                <span class="file-picker-btn">${esc(T('io.chooseFile'))}</span>
                <span class="file-picker-name" id="storeImportName">${esc(T('io.noFile'))}</span>
              </label>
              <button class="btn btn-primary" id="storeImportBtn" disabled>${esc(T('io.importBtn'))}</button>
              <span class="if-note" id="storeImportNote"></span>
            </div>
          </div>`;
      },
      bind(section){
        section.querySelector('#storeExportJson').addEventListener('click', exportStoreJson);
        section.querySelector('#storeExportExpCsv').addEventListener('click', exportExpensesCsv);
        section.querySelector('#storeExportOrdCsv').addEventListener('click', exportOrdersCsv);
        section.querySelector('#storeExportProdCsv').addEventListener('click', exportProductsCsv);
        const file = section.querySelector('#storeImportFile');
        const btn = section.querySelector('#storeImportBtn');
        const nameEl = section.querySelector('#storeImportName');
        let pending = null;
        file.addEventListener('change', ()=>{
          const f = file.files && file.files[0];
          if(!f){ btn.disabled = true; pending = null; nameEl.textContent = T('io.noFile'); return; }
          nameEl.textContent = f.name;
          const reader = new FileReader();
          reader.onload = ()=>{ pending = { name: f.name, text: String(reader.result) }; btn.disabled = false; };
          reader.readAsText(f);
        });
        btn.addEventListener('click', async ()=>{
          if(!pending) return;
          const note = section.querySelector('#storeImportNote');
          const isCsv = /\.csv$/i.test(pending.name) || (!/^\s*[\{\[]/.test(pending.text));
          try{
            if(isCsv){
              const r = await importCsvUpsert(pending.text);
              note.textContent = T('io.csvDone').replace('{t}', T('io.tbl_'+r.target)).replace('{c}', r.created).replace('{u}', r.updated).replace('{d}', r.deleted);
            }else{
              const counts = `${expenses.length} + ${orders.length} + ${products.length}`;
              if(!window.confirm(T('io.replaceWarn').replace('{n}', counts))) return;
              await importStoreJson(pending.text);
              note.textContent = T('io.importDone');
            }
            btn.disabled = true; file.value = ''; nameEl.textContent = T('io.noFile');
          }catch(e){ note.textContent = T('io.importFail'); }
        });
      }
    };

  const REGION_KEYS_4 = ['north','northeast','central','south'];
  const REGION_KEYS_6 = ['north','northeast','central','east','west','south'];
  function regionMode(){ return (config && config.regionMode === '4') ? '4' : '6'; }   // default 6 (official)
  function regionKeys(){ return regionMode()==='4' ? REGION_KEYS_4 : REGION_KEYS_6; }
  function regionOfProvince(c){
    c = +c;
    if(c>=30 && c<=49) return 'northeast';
    if(c>=80 && c<=96) return 'south';
    if(regionMode()==='4'){ return (c>=50 && c<=67) ? 'north' : 'central'; }
    if(c>=50 && c<=58) return 'north';
    if([20,21,22,23,24,25,27].includes(c)) return 'east';
    if([63,70,71,76,77].includes(c)) return 'west';
    return 'central';
  }
  function regionOfProvinceMode(c, m){
    c=+c;
    if(c>=30&&c<=49) return 'northeast';
    if(c>=80&&c<=96) return 'south';
    if(m==='4') return (c>=50&&c<=67)?'north':'central';
    if(c>=50&&c<=58) return 'north';
    if([20,21,22,23,24,25,27].includes(c)) return 'east';
    if([63,70,71,76,77].includes(c)) return 'west';
    return 'central';
  }
  // Auto shipping cost for a product category → delivery province, from config.shippingCost.byCat.
  function shipCostFor(catName, provinceCode){
    const sc=config.shippingCost; if(!sc||!sc.byCat||!provinceCode) return 0;
    const cs=sc.byCat[catName]; if(!cs) return 0;
    if(sc.mode==='province'){
      if(cs.prov && cs.prov[provinceCode]!=null) return +cs.prov[provinceCode]||0;
      if((sc.provMode||'exception')==='exception'){ const reg=regionOfProvinceMode(provinceCode, regionMode()); return +((regionMode()==='4'?cs.r4:cs.r6)[reg])||0; }
      return 0;
    }
    const reg=regionOfProvinceMode(provinceCode, sc.mode);
    return +((sc.mode==='4'?cs.r4:cs.r6)[reg])||0;
  }
  function syncDeliveries(){
    if(!config) return;
    const waitName  = (statusByRole('deliveryStatuses','waiting')    || {}).name;
    const delivName = (statusByRole('deliveryStatuses','delivering') || {}).name;
    const shipName  = (statusByRole('orderStatuses','shipped')       || {}).name;
    let changed = false;
    const before = deliveries.length;
    deliveries = deliveries.filter(d=> orders.some(o=> o.id === d.orderId));
    if(deliveries.length !== before) changed = true;
    orders.forEach(o=>{
      let d = deliveries.find(x=> x.orderId === o.id);
      if(!d){ d = { id: rid(), orderId: o.id, status: waitName || '', createdAt: new Date().toISOString() }; deliveries.push(d); changed = true; }
      if(shipName && o.orderStatus === shipName && waitName && d.status === waitName){ d.status = delivName || d.status; changed = true; }
    });
    if(changed) saveDeliveries();
  }
  // Shipping type + responsible, editable straight from the Delivery List row.
  // Which control the Responsible cell gets follows the shipping type's role,
  // exactly like the order form: 'our' -> driver roster, 'outsource' -> outsource
  // list, anything else -> free text.
  function delRespRoleOf(methodName){
    const t = (config.shippingTypes||[]).find(s=> s.name === methodName);
    return t ? (t.role||'') : '';
  }
  function delRespOptions(role){
    if(role === 'our') return (typeof window.employeesByRoleType==='function' ? window.employeesByRoleType('driver') : []).map(d=> d.name);
    if(role === 'outsource') return (config.outsources||[]).map(x=> x.name);
    return null;                       // free text
  }
  function delAssignCells(o){
    const canA = (typeof window.roleCanAccess !== 'function') || window.roleCanAccess(window.currentRole, 'editDeliveryAssign');
    if(!canA) return `<td>${esc(o.deliveryMethod || '-')}</td><td>${esc(o.deliveryResponsible || '-')}</td>`;
    const types = config.shippingTypes || [];
    const tCol = (types.find(st=> st.name === o.deliveryMethod) || {}).color || '#888';
    const typeCell = `<td><select class="del-ship art-inline-sel" data-oid="${esc(o.id)}" style="background:${tCol};"><option value="">-</option>${types.map(st=> `<option value="${esc(st.name)}" ${o.deliveryMethod===st.name?'selected':''}>${esc(itemLabel(st))}</option>`).join('')}</select></td>`;
    const opts = delRespOptions(delRespRoleOf(o.deliveryMethod));
    const respCell = (opts === null)
      ? `<td><input type="text" class="del-resp art-inline-date" data-oid="${esc(o.id)}" value="${esc(o.deliveryResponsible||'')}" placeholder="${esc(T('rev.respHint'))}"></td>`
      : `<td><select class="del-resp art-inline-date" data-oid="${esc(o.id)}"><option value="">${esc(T('rev.pickResp'))}</option>${opts.map(n=> `<option value="${esc(n)}" ${o.deliveryResponsible===n?'selected':''}>${esc(n)}</option>`).join('')}</select></td>`;
    return typeCell + respCell;
  }
  function deliveryRow(r, dStatuses){
    const o = r.o, d = r.d; const ap = o.addressParts || {};
    const reg = ap.provinceCode ? T('region.' + regionOfProvince(ap.provinceCode)) : '-';
    const col = (dStatuses.find(s=> s.name === d.status) || {}).color || '#888';
    const von = !!d.verified;
    const canV = (typeof window.roleCanAccess !== 'function') || window.roleCanAccess(window.currentRole, 'verifyDelivery');
    const vpill = `<span class="art-pill del-verify ${canV?'del-verify-btn':''}" data-vid="${d.id}" style="background:${von?'#6B8F71':'#C6432E'};">${esc(von?T('sh.verYes'):T('sh.verNo'))}</span>${(von && d.verifiedBy) ? ` <span class="sh-verify-by">${esc(d.verifiedBy)}</span>` : ''}`;
    const canDate = (typeof window.roleCanAccess !== 'function') || window.roleCanAccess(window.currentRole, 'setDeliveryDate');
    const ddCell = canDate ? `<input type="date" class="del-date art-inline-date" data-vid="${d.id}" value="${esc(d.deliveryDate||'')}">` : `<span>${esc(d.deliveryDate||'-')}</span>`;
    return `<tr>
      <td>${esc(o.date || '-')}</td>
      <td>${esc(o.invoiceNumber || '-')}</td>
      <td>${esc(o.customerName || '-')}</td>
      <td>${esc(ap.provinceName || '-')}</td>
      <td>${esc(reg)}</td>
      <td class="del-addr" title="${esc(o.address || '')}">${esc(o.address || '-')}</td>
      ${delAssignCells(o)}
      <td>${o.deliveryProof ? `<button type="button" class="acc-icon del-proof-btn" data-oid="${o.id}" title="${esc(T('del.proof'))}">\uD83D\uDCCE</button>` : '-'}</td>
      <td><select class="del-status art-inline-sel" data-id="${d.id}" style="background:${col};">${dStatuses.map(st=> `<option value="${esc(st.name)}" ${d.status===st.name?'selected':''}>${esc(itemLabel(st))}</option>`).join('')}</select></td>
      <td class="del-sticky-date">${ddCell}</td>
      <td class="del-sticky-ver">${vpill}</td>
    </tr>`;
  }
  function renderDeliveryPage(body){
    syncDeliveries();
    const dStatuses = config.deliveryStatuses || [];
    const all = deliveries.map(d=> ({ d, o: orders.find(x=> x.id === d.orderId) })).filter(r=> r.o);
    const provinces = [...new Set(all.map(r=> (r.o.addressParts||{}).provinceName).filter(Boolean))].sort();
    const filtered = all.filter(r=>{
      const ap = r.o.addressParts || {};
      if(delFilter.from && (r.o.date||'') < delFilter.from) return false;
      if(delFilter.to   && (r.o.date||'') > delFilter.to) return false;
      if(delFilter.province !== 'all' && ap.provinceName !== delFilter.province) return false;
      if(delFilter.region   !== 'all' && regionOfProvince(ap.provinceCode) !== delFilter.region) return false;
      if(delFilter.status   !== 'all' && r.d.status !== delFilter.status) return false;
      return true;
    });
    body.innerHTML = `
      <div class="panel">
        <div class="art-toolbar">
          <div class="art-field"><label>${esc(T('exp.from'))}</label><input type="date" id="delFrom" value="${esc(delFilter.from)}"></div>
          <div class="art-field"><label>${esc(T('exp.to'))}</label><input type="date" id="delTo" value="${esc(delFilter.to)}"></div>
          <div class="art-field"><label>${esc(T('del.province'))}</label>
            <select id="delFP"><option value="all">${esc(T('exp.all'))}</option>${provinces.map(pv=> `<option value="${esc(pv)}" ${delFilter.province===pv?'selected':''}>${esc(pv)}</option>`).join('')}</select>
          </div>
          <div class="art-field"><label>${esc(T('del.region'))}</label>
            <select id="delFR"><option value="all">${esc(T('exp.all'))}</option>${regionKeys().map(k=> `<option value="${k}" ${delFilter.region===k?'selected':''}>${esc(T('region.'+k))}</option>`).join('')}</select>
          </div>
          <div class="art-field"><label>${esc(T('del.status'))}</label>
            <select id="delFS"><option value="all">${esc(T('exp.all'))}</option>${dStatuses.map(st=> `<option value="${esc(st.name)}" ${delFilter.status===st.name?'selected':''}>${esc(itemLabel(st))}</option>`).join('')}</select>
          </div>
          <button class="btn btn-ghost" id="delClear">${esc(T('exp.clearFilter'))}</button>
        </div>
        <div class="del-table-wrap">
        <table class="art-table">
          <thead><tr>
            <th>${esc(T('exp.date'))}</th><th>${esc(T('del.orderNo'))}</th><th>${esc(T('del.recipient'))}</th>
            <th>${esc(T('del.province'))}</th><th>${esc(T('del.region'))}</th>
            <th>${esc(T('del.address'))}</th><th>${esc(T('del.shipType'))}</th><th>${esc(T('del.responsible'))}</th><th>${esc(T('del.proof'))}</th><th>${esc(T('del.status'))}</th><th class="del-sticky-date">${esc(T('del.deliveryDate'))}</th><th class="del-sticky-ver">${esc(T('del.verified'))}</th>
          </tr></thead>
          <tbody>${filtered.length ? filtered.map(r=> deliveryRow(r, dStatuses)).join('') : `<tr><td colspan="12" class="art-empty">${esc(T('del.empty'))}</td></tr>`}</tbody>
        </table>
        </div>
      </div>`;
    body.querySelector('#delFrom').addEventListener('change', e=>{ delFilter.from = e.target.value; renderDeliveryPage(body); });
    body.querySelector('#delTo').addEventListener('change', e=>{ delFilter.to = e.target.value; renderDeliveryPage(body); });
    body.querySelector('#delClear').addEventListener('click', ()=>{ delFilter = { from:'', to:'', province:'all', region:'all', status:'all' }; renderDeliveryPage(body); });
    body.querySelector('#delFP').addEventListener('change', e=>{ delFilter.province = e.target.value; renderDeliveryPage(body); });
    body.querySelector('#delFR').addEventListener('change', e=>{ delFilter.region   = e.target.value; renderDeliveryPage(body); });
    body.querySelector('#delFS').addEventListener('change', e=>{ delFilter.status   = e.target.value; renderDeliveryPage(body); });
    body.querySelectorAll('.del-status').forEach(sel=> sel.addEventListener('change', async ()=>{
      const d = deliveries.find(x=> x.id === sel.dataset.id); if(!d) return;
      d.status = sel.value; await saveDeliveries(); renderDeliveryPage(body);
    }));
    body.querySelectorAll('.del-date').forEach(inp=> inp.addEventListener('change', async ()=>{ const d = deliveries.find(x=> x.id === inp.dataset.vid); if(!d) return; d.deliveryDate = inp.value; await saveDeliveries(); }));
    // Changing the type can invalidate the current responsible, so clear it when
    // the new type's option list no longer contains it, then redraw the row set.
    body.querySelectorAll('.del-ship').forEach(sel=> sel.addEventListener('change', async ()=>{
      const o = orders.find(x=> x.id === sel.dataset.oid); if(!o) return;
      o.deliveryMethod = sel.value;
      const opts = delRespOptions(delRespRoleOf(o.deliveryMethod));
      if(opts !== null && o.deliveryResponsible && opts.indexOf(o.deliveryResponsible) < 0) o.deliveryResponsible = '';
      o.editedBy = currentActorName(); o.editedAt = new Date().toISOString();
      await saveOrders();
      logRec(orderLog, saveOrderLog, o.id, o.invoiceNumber, 'edit', o);
      renderDeliveryPage(body);
    }));
    body.querySelectorAll('.del-resp').forEach(el=> el.addEventListener('change', async ()=>{
      const o = orders.find(x=> x.id === el.dataset.oid); if(!o) return;
      o.deliveryResponsible = el.value;
      o.editedBy = currentActorName(); o.editedAt = new Date().toISOString();
      await saveOrders();
      logRec(orderLog, saveOrderLog, o.id, o.invoiceNumber, 'edit', o);
    }));
    body.querySelectorAll('.del-proof-btn').forEach(btn=> btn.addEventListener('click', ()=>{ const o=orders.find(x=> x.id===btn.dataset.oid); if(o && o.deliveryProof) openBill(o.deliveryProof); }));
    if((typeof window.roleCanAccess !== 'function') || window.roleCanAccess(window.currentRole, 'verifyDelivery')){
      body.querySelectorAll('.del-verify[data-vid]').forEach(el=> el.addEventListener('click', async ()=>{
        const d = deliveries.find(x=> x.id === el.dataset.vid); if(!d) return;
        d.verified = !d.verified; d.verifiedBy = d.verified ? currentActorName() : '';
        await saveDeliveries(); renderDeliveryPage(body);
      }));
    }
  }
  function deliveryCardHtml(r){
    const o = r.o, d = r.d; const ap = o.addressParts || {};
    return `<div class="kcard" draggable="true" data-id="${esc(d.id)}" data-oid="${esc(o.id)}"><div class="kcard-actions"><button class="kcard-edit" title="${esc(T('edit'))}">\u270E</button></div><div class="kcard-inv">${esc(o.invoiceNumber||'-')}</div><div class="kcard-cust">${esc(o.customerName||'-')}</div><div class="kcard-foot"><span>${esc(ap.provinceName||'-')}</span><span class="art-pill" style="background:#5B8FB0; font-size:10px;">${esc(dispName('shippingTypes', o.deliveryMethod)||o.deliveryMethod||'-')}</span></div></div>`;
  }
  function drawDeliveryKanban(body){
    const container = body.querySelector('#delKanban'); if(!container) return;
    const statuses = config.deliveryStatuses || [];
    const rows = deliveries.map(d=> ({ d, o: orders.find(x=> x.id === d.orderId) })).filter(r=> r.o).filter(r=>{
      const ap = r.o.addressParts || {};
      if(delFilter.from && (r.o.date||'') < delFilter.from) return false;
      if(delFilter.to && (r.o.date||'') > delFilter.to) return false;
      if(delFilter.province !== 'all' && ap.provinceName !== delFilter.province) return false;
      return true;
    });
    container.innerHTML = statuses.map(st=>{
      const cards = rows.filter(r=> r.d.status === st.name);
      return `<div class="kcol" data-status="${esc(st.name)}"><div class="kcol-head"><span class="kcol-dot" style="background:${esc(st.color)}"></span><span>${esc(itemLabel(st))}</span><span class="kcol-count">${cards.length}</span></div><div class="kcol-body">${cards.length===0 ? `<div class="kcol-empty">${esc(T('kb.empty'))}</div>` : cards.map(r=> deliveryCardHtml(r)).join('')}</div></div>`;
    }).join('');
    container.querySelectorAll('.kcard').forEach(el=>{
      el.addEventListener('dragstart', e=>{ e.dataTransfer.setData('text/plain', el.dataset.id); el.classList.add('dragging'); });
      el.addEventListener('dragend', ()=> el.classList.remove('dragging'));
      const eb = el.querySelector('.kcard-edit'); if(eb) eb.addEventListener('click', (e)=>{ e.stopPropagation(); const o = orders.find(x=> x.id===el.dataset.oid); if(o) openOrderModal(o, body, ()=> renderDeliveryKanban(body)); });
    });
    container.querySelectorAll('.kcol').forEach(col=>{
      col.addEventListener('dragover', e=>{ e.preventDefault(); col.classList.add('drag-over'); });
      col.addEventListener('dragleave', ()=> col.classList.remove('drag-over'));
      col.addEventListener('drop', async e=>{
        e.preventDefault(); col.classList.remove('drag-over');
        const id = e.dataTransfer.getData('text/plain');
        const newStatus = col.dataset.status;
        const d = deliveries.find(x=> x.id===id);
        if(d && d.status !== newStatus){ d.status = newStatus; await saveDeliveries(); drawDeliveryKanban(body); }
      });
    });
  }
  function renderDeliveryKanban(body){
    const all = deliveries.map(d=> ({ d, o: orders.find(x=> x.id === d.orderId) })).filter(r=> r.o);
    const provinces = [...new Set(all.map(r=> (r.o.addressParts||{}).provinceName).filter(Boolean))].sort();
    body.innerHTML = `<div class="panel"><div class="art-toolbar"><div class="art-field"><label>${esc(T('exp.from'))}</label><input type="date" id="dkFrom" value="${esc(delFilter.from)}"></div><div class="art-field"><label>${esc(T('exp.to'))}</label><input type="date" id="dkTo" value="${esc(delFilter.to)}"></div><div class="art-field"><label>${esc(T('del.province'))}</label><select id="dkProv"><option value="all">${esc(T('del.allProvinces'))}</option>${provinces.map(pv=> `<option value="${esc(pv)}" ${delFilter.province===pv?'selected':''}>${esc(pv)}</option>`).join('')}</select></div><button class="btn btn-ghost" id="dkClear">${esc(T('exp.clearFilter'))}</button></div><div class="art-kanban" id="delKanban"></div></div>`;
    body.querySelector('#dkFrom').addEventListener('change', e=>{ delFilter.from=e.target.value; drawDeliveryKanban(body); });
    body.querySelector('#dkTo').addEventListener('change', e=>{ delFilter.to=e.target.value; drawDeliveryKanban(body); });
    body.querySelector('#dkProv').addEventListener('change', e=>{ delFilter.province=e.target.value; drawDeliveryKanban(body); });
    body.querySelector('#dkClear').addEventListener('click', ()=>{ delFilter={from:'',to:'',province:'all',region:'all',status:'all'}; renderDeliveryKanban(body); });
    drawDeliveryKanban(body);
  }
  const _monthLabel = (date)=> window.monthLabel(window.monthKeyOf(date));   // shared helper — any year
  function _delMonthMatrix(date){
    const y=date.getFullYear(), m=date.getMonth();
    const dim=new Date(y,m+1,0).getDate();
    let off=new Date(y,m,1).getDay()-1; if(off<0) off=6;
    const cells=[];
    for(let i=0;i<off;i++) cells.push(null);
    for(let d=1; d<=dim; d++){ cells.push({ day:d, iso:`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}` }); }
    while(cells.length%7!==0) cells.push(null);
    return cells;
  }
  function drawDeliveryCalendar(body){
    const grid=body.querySelector('#delCalGrid'); if(!grid) return;
    const dStatuses = config.deliveryStatuses || [];
    const statusColor = (name)=> (dStatuses.find(sx=> sx.name===name)||{}).color || '#888';
    const chipColorOf = (r)=>{ if(delCalColorBy==='type'){ const st=(config.shippingTypes||[]).find(s=> s.name===r.o.deliveryMethod); return (st&&st.color)||'#888'; } if(delCalColorBy==='driver'){ return (config.driverColors||{})[r.o.deliveryResponsible] || '#8A8F80'; } return statusColor(r.d.status); };
    const all = deliveries.map(d=> ({ d, o: orders.find(x=> x.id === d.orderId) })).filter(r=> r.o).filter(r=>{
      if(delCalFilter.type!=='all' && r.o.deliveryMethod !== delCalFilter.type) return false;
      if(delCalFilter.driver!=='all' && r.o.deliveryResponsible !== delCalFilter.driver) return false;
      return true;
    });
    const scheduled = all.filter(r=> r.d.deliveryDate);
    const unsched = all.length - scheduled.length;
    const lbl=body.querySelector('#dcLabel'); if(lbl) lbl.textContent=_monthLabel(delCalDate);
    const un=body.querySelector('#dcUnsched'); if(un) un.textContent = unsched ? T('cal.unscheduled').replace('{n}', unsched) : '';
    const todayIso = (window.localIso ? window.localIso() : new Date().toISOString().slice(0,10));
    const canSet = (typeof window.roleCanAccess !== 'function') || window.roleCanAccess(window.currentRole, 'setDeliveryDate');
    grid.innerHTML = _delMonthMatrix(delCalDate).map(cell=>{
      if(!cell) return `<div class="cal-cell empty"></div>`;
      const items = scheduled.filter(r=> r.d.deliveryDate === cell.iso);
      return `<div class="cal-cell ${cell.iso===todayIso?'today':''}" data-iso="${cell.iso}"><div class="cal-daynum">${cell.day}</div><div class="cal-cell-chips">${items.map(r=> `<div class="cal-chip del-cal-chip" ${canSet?'draggable="true"':''} data-oid="${esc(r.o.id)}" data-vid="${esc(r.d.id)}" style="background:${chipColorOf(r)}" title="${esc(itemLabel(dStatuses.find(sx=> sx.name===r.d.status)))} \u00B7 ${esc(dispName('shippingTypes', r.o.deliveryMethod)||'')} \u00B7 ${esc(r.o.deliveryResponsible||'-')}"><div class="cal-chip-topic">${esc(r.o.invoiceNumber||'-')}</div><div class="cal-chip-sub">${esc(r.o.customerName||'-')}${r.o.deliveryResponsible?' \u00B7 '+esc(r.o.deliveryResponsible):''}</div></div>`).join('')}</div></div>`;
    }).join('');
    grid.querySelectorAll('.del-cal-chip').forEach(ch=>{
      ch.addEventListener('click', ()=>{ const o=orders.find(x=> x.id===ch.dataset.oid); if(o) openOrderModal(o, body, ()=> renderDeliveryCalendar(body)); });
      if(canSet){
        ch.addEventListener('dragstart', e=>{ e.dataTransfer.setData('text/plain', ch.dataset.vid); ch.classList.add('dragging'); });
        ch.addEventListener('dragend', ()=> ch.classList.remove('dragging'));
      }
    });
    if(canSet){
      grid.querySelectorAll('.cal-cell[data-iso]').forEach(cell=>{
        // Clicking empty space in a day opens the picker; clicking a chip still opens the order.
        cell.addEventListener('click', e=>{
          if(e.target.closest('.del-cal-chip')) return;
          openDayAssignPicker(cell.dataset.iso, body, all);
        });
        cell.addEventListener('dragover', e=>{ e.preventDefault(); cell.classList.add('drag-over'); });
        cell.addEventListener('dragleave', ()=> cell.classList.remove('drag-over'));
        cell.addEventListener('drop', async e=>{
          e.preventDefault(); cell.classList.remove('drag-over');
          const vid = e.dataTransfer.getData('text/plain');
          const d = deliveries.find(x=> x.id===vid);
          if(d && d.deliveryDate !== cell.dataset.iso){ d.deliveryDate = cell.dataset.iso; await saveDeliveries(); drawDeliveryCalendar(body); }
        });
      });
    }
  }
  // Pick an as-yet-unscheduled delivery and pin it to the clicked day.
  // `pool` is the calendar's already-filtered row set, so the picker agrees
  // with the "unscheduled: n" counter shown in the toolbar.
  function openDayAssignPicker(iso, body, pool){
    const pending = pool.filter(r=> !r.d.deliveryDate);
    const dayText = String(iso||'').split('-').reverse().join('/');
    const rows = pending.map(r=> `<button type="button" class="btn btn-ghost dcp-pick" data-vid="${esc(r.d.id)}" style="display:flex; flex-direction:column; align-items:flex-start; gap:2px; width:100%; text-align:left; margin-bottom:6px;">
        <span style="font-weight:600;">${esc(r.o.invoiceNumber||'-')}</span>
        <span class="setting-desc" style="margin:0;">${esc(r.o.customerName||'-')}${r.o.deliveryResponsible?' \u00B7 '+esc(r.o.deliveryResponsible):''}</span>
      </button>`).join('');
    const emptyMsg = pool.length === 0 ? T('cal.pickNone') : T('cal.pickAllAssigned');
    const ov = document.createElement('div'); ov.className='art-modal-overlay show';
    ov.innerHTML = `<div class="art-modal" style="max-width:520px;">
      <h3 class="art-modal-title">${esc(T('cal.pickTitle'))}</h3>
      <p class="setting-desc" style="margin:-4px 0 12px;">${esc(dayText)}</p>
      <div style="max-height:320px; overflow:auto;">${rows || `<p class="art-set-empty">${esc(emptyMsg)}</p>`}</div>
      <div class="art-modal-actions"><button class="btn btn-primary" id="dcpClose">${esc(T('close'))}</button></div>
    </div>`;
    document.body.appendChild(ov);
    const close = ()=> ov.remove();
    ov.addEventListener('click', e=>{ if(e.target===ov) close(); });
    ov.querySelector('#dcpClose').addEventListener('click', close);
    ov.querySelectorAll('.dcp-pick').forEach(btn=> btn.addEventListener('click', async ()=>{
      const d = deliveries.find(x=> x.id === btn.dataset.vid);
      if(d){ d.deliveryDate = iso; await saveDeliveries(); }
      close();
      drawDeliveryCalendar(body);
    }));
  }
  function renderDeliveryCalendar(body){
    if(!delCalDate){ const t=new Date(); delCalDate=new Date(t.getFullYear(), t.getMonth(), 1); }
    const en=(window.appLang&&window.appLang())==='en';
    const all = deliveries.map(d=> ({ d, o: orders.find(x=> x.id === d.orderId) })).filter(r=> r.o);
    const drivers = [...new Set(all.map(r=> r.o.deliveryResponsible).filter(Boolean))].sort();
    const types = config.shippingTypes || [];
    const _WEEKDAYS_TH = ['จ.','อ.','พ.','พฤ.','ศ.','ส.','อา.'];
    const _WEEKDAYS_EN = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const wk = (en?_WEEKDAYS_EN:_WEEKDAYS_TH).map(w=> `<span>${esc(w)}</span>`).join('');
    body.innerHTML = `<div class="panel">
      <div class="art-toolbar">
        <div class="art-field"><label>${esc(T('cal.driverType'))}</label><select id="dcType"><option value="all">${esc(T('cal.allTypes'))}</option>${types.map(st=> `<option value="${esc(st.name)}" ${delCalFilter.type===st.name?'selected':''}>${esc(itemLabel(st))}</option>`).join('')}</select></div>
        <div class="art-field"><label>${esc(T('cal.driver'))}</label><select id="dcDriver"><option value="all">${esc(T('cal.allDrivers'))}</option>${drivers.map(dv=> `<option value="${esc(dv)}" ${delCalFilter.driver===dv?'selected':''}>${esc(dv)}</option>`).join('')}</select></div>
        <div class="art-field"><label>${esc(T('cal.colorBy'))}</label><div class="del-seg" id="dcColorBy"><button type="button" class="del-seg-btn ${delCalColorBy==='status'?'active':''}" data-cb="status">${esc(T('cal.byStatus'))}</button><button type="button" class="del-seg-btn ${delCalColorBy==='type'?'active':''}" data-cb="type">${esc(T('cal.byType'))}</button><button type="button" class="del-seg-btn ${delCalColorBy==='driver'?'active':''}" data-cb="driver">${esc(T('cal.byDriver'))}</button></div></div>
        <button class="btn btn-ghost" id="dcClear">${esc(T('exp.clearFilter'))}</button>
      </div>
      <div class="cal-toolbar">
        <button class="btn btn-ghost" id="dcPrev">\u2039</button>
        <span class="cal-label" id="dcLabel"></span>
        <button class="btn btn-ghost" id="dcNext">\u203A</button>
        <button class="btn btn-ghost" id="dcToday">${esc(T('cal.today'))}</button>
        <span class="del-cal-unsched" id="dcUnsched"></span>
      </div>
      <div class="calendar-weekdays">${wk}</div>
      <div class="calendar-grid" id="delCalGrid"></div>
    </div>`;
    body.querySelector('#dcType').addEventListener('change', e=>{ delCalFilter.type=e.target.value; drawDeliveryCalendar(body); });
    body.querySelector('#dcDriver').addEventListener('change', e=>{ delCalFilter.driver=e.target.value; drawDeliveryCalendar(body); });
    body.querySelectorAll('#dcColorBy .del-seg-btn').forEach(btn=> btn.addEventListener('click', ()=>{ delCalColorBy=btn.dataset.cb; body.querySelectorAll('#dcColorBy .del-seg-btn').forEach(b=> b.classList.toggle('active', b.dataset.cb===delCalColorBy)); drawDeliveryCalendar(body); }));
    body.querySelector('#dcClear').addEventListener('click', ()=>{ delCalFilter={type:'all',driver:'all'}; renderDeliveryCalendar(body); });
    body.querySelector('#dcPrev').addEventListener('click', ()=>{ delCalDate=new Date(delCalDate.getFullYear(), delCalDate.getMonth()-1, 1); drawDeliveryCalendar(body); });
    body.querySelector('#dcNext').addEventListener('click', ()=>{ delCalDate=new Date(delCalDate.getFullYear(), delCalDate.getMonth()+1, 1); drawDeliveryCalendar(body); });
    body.querySelector('#dcToday').addEventListener('click', ()=>{ const t=new Date(); delCalDate=new Date(t.getFullYear(), t.getMonth(), 1); drawDeliveryCalendar(body); });
    drawDeliveryCalendar(body);
  }
  function renderDriverColors(body){
    const emps = (typeof window.employeesByRoleType==='function' ? window.employeesByRoleType('driver') : []);
    const outs = config.outsources || [];
    const dc = config.driverColors || {};
    const rows = emps.map(e=> ({ name:e.name, label:e.name, kind:'our' })).concat(outs.map(o=> ({ name:o.name, label:itemLabel(o), kind:'outsource' })));
    body.innerHTML = `<div class="panel"><h3 class="art-form-section" style="margin-top:0;">${esc(T('drv.title'))}</h3><p class="setting-desc" style="margin-bottom:14px;">${esc(T('drv.desc'))}</p>${rows.length ? `<div class="art-set-list">${rows.map(r=> `<div class="drv-row"><span class="art-set-swatch" style="background:${esc(dc[r.name]||'#8A8F80')}"></span><span class="drv-name">${esc(r.label||r.name)}</span><span class="drv-kind">${esc(r.kind==='our'?T('drv.our'):T('drv.outsource'))}</span><input type="color" class="drv-color" data-name="${esc(r.name)}" value="${esc(dc[r.name]||'#8A8F80')}"></div>`).join('')}</div>` : `<p class="art-set-empty">${esc(T('drv.empty'))}</p>`}</div>`;
    body.querySelectorAll('.drv-color').forEach(inp=> inp.addEventListener('input', async ()=>{ config.driverColors = config.driverColors || {}; config.driverColors[inp.dataset.name] = inp.value; const sw = inp.closest('.drv-row').querySelector('.art-set-swatch'); if(sw) sw.style.background = inp.value; await saveConfig(); }));
  }
  function renderDeliveryConfig(body){
    const rerender = ()=> renderDeliveryConfig(body);
    const mode = regionMode();
    const toggle = `<div class="del-regionmode">
      <div class="del-region-title">${esc(T('set.regionMode'))}</div>
      <div class="del-seg">
        <button type="button" class="del-seg-btn ${mode==='4'?'active':''}" data-mode="4">${esc(T('set.region4'))}</button>
        <button type="button" class="del-seg-btn ${mode==='6'?'active':''}" data-mode="6">${esc(T('set.region6'))}</button>
      </div>
      <p class="setting-desc" style="margin-top:8px;">${esc(T('set.regionModeHint'))}</p>
    </div>`;
    body.innerHTML = renderConfigShell(toggle + groupHtml('deliveryStatuses', T('set.deliveryStatuses')) + groupHtml('shippingTypes', T('set.shippingTypes')) + groupHtml('outsources', T('set.outsources')));
    body.querySelectorAll('.del-seg-btn').forEach(btn=> btn.addEventListener('click', async ()=>{ config.regionMode = btn.dataset.mode; await saveConfig(); rerender(); }));
    wireGroups(body.querySelector('#artSetGroups'), body, rerender);
  }
  function defaultCatPrices(){ return {
    r4:{ north:2500, northeast:2000, central:1500, south:2000 },
    r6:{ north:2500, northeast:2000, central:1500, east:1800, west:1800, south:2300 },
    prov:{} }; }
  function defaultShippingCost(){
    const sc = { mode:'6', provMode:'exception', byCat:{} };
    ((config && config.productTypes) || []).forEach(t=> sc.byCat[t.name] = defaultCatPrices());
    return sc;
  }
  // Per-category shipping prices. Migrates the old flat r4/r6/prov → byCat (each category inherits the flat values).
  function seedShippingCost(){
    if(!config) return;
    let changed = false;
    if(!config.shippingCost){ config.shippingCost = defaultShippingCost(); changed = true; }
    const sc = config.shippingCost;
    if(!sc.byCat){
      const flat = { r4: sc.r4||{}, r6: sc.r6||{}, prov: sc.prov||{} };
      const hasFlat = Object.keys(flat.r4).length || Object.keys(flat.r6).length || Object.keys(flat.prov).length;
      sc.byCat = {};
      ((config.productTypes)||[]).forEach(t=> sc.byCat[t.name] = hasFlat ? { r4:{...flat.r4}, r6:{...flat.r6}, prov:{...flat.prov} } : defaultCatPrices());
      delete sc.r4; delete sc.r6; delete sc.prov; changed = true;
    }
    if(!sc.mode) sc.mode = '6';
    if(!sc.provMode) sc.provMode = 'exception';
    if(changed){ config.shipCostSeeded = true; saveConfig(); }
  }
  function scCatStore(){
    const sc = config.shippingCost;
    if(!sc.byCat) sc.byCat = {};
    if(!sc.byCat[shipCat]) sc.byCat[shipCat] = defaultCatPrices();
    return sc.byCat[shipCat];
  }
  function renderShippingCost(body){
    if(!config.shippingCost) config.shippingCost = defaultShippingCost();
    const sc = config.shippingCost;
    const cats = config.productTypes || [];
    if(!shipCat || !cats.some(c=> c.name===shipCat)) shipCat = (cats[0]||{}).name || '';
    const cs = scCatStore();
    if(!shipRegion) shipRegion = regionKeys()[0];
    const lang = (window.appLang && window.appLang()) || 'th';
    const catSel = `<select id="scCat" class="shipcost-region-pick">${cats.map(c=> `<option value="${esc(c.name)}" ${shipCat===c.name?'selected':''}>${esc(itemLabel(c))}</option>`).join('')}</select>`;
    const modeBtns = [['4',T('set.region4')],['6',T('set.region6')],['province',T('set.shipByProvince')]]
      .map(([m,lbl])=> `<button type="button" class="del-seg-btn ${sc.mode===m?'active':''}" data-scmode="${m}">${esc(lbl)}</button>`).join('');
    let inner='';
    if(sc.mode==='province'){
      const pmBtns = [['exception',T('set.shipException')],['manual',T('set.shipManual')]]
        .map(([m,lbl])=> `<button type="button" class="del-seg-btn ${(sc.provMode||'exception')===m?'active':''}" data-scpm="${m}">${esc(lbl)}</button>`).join('');
      inner = `<div class="del-region-title">${esc(T('set.shipProvSwitch'))}</div><div class="del-seg">${pmBtns}</div>
        <div class="del-region-title" style="margin-top:16px;">${esc(T('set.shipPickRegion'))}</div>
        <select id="scRegion" class="shipcost-region-pick">${regionKeys().map(k=> `<option value="${k}" ${shipRegion===k?'selected':''}>${esc(T('region.'+k))}</option>`).join('')}</select>
        <div id="scProvList" style="margin-top:14px;">${esc(T('rev.loading'))}</div>`;
    } else {
      const keys = sc.mode==='4' ? REGION_KEYS_4 : REGION_KEYS_6;
      const store = sc.mode==='4' ? cs.r4 : cs.r6;
      inner = `<div class="shipcost-list">` + keys.map(k=> `<div class="shipcost-row">
          <span class="shipcost-name"><i class="th-swatch th-sw-${k}"></i>${esc(T('region.'+k))}</span>
          <input type="number" class="sc-region-inp" data-region="${k}" value="${store[k]!=null?store[k]:''}" placeholder="0" min="0">
          <span class="shipcost-unit">${esc(T('set.baht'))}</span></div>`).join('') + `</div>`;
    }
    body.innerHTML = `<div class="panel settings-panel"><div class="settings-section">
      <div class="settings-section-head"><h3 class="setting-title">${esc(T('set.shipCost'))}</h3><p class="setting-desc">${esc(T('set.shipCostDesc'))}</p></div>
      <div class="del-region-title">${esc(T('set.shipCategory'))}</div>${catSel}
      <div class="del-region-title" style="margin-top:16px;">${esc(T('set.shipMode'))}</div><div class="del-seg">${modeBtns}</div>
      <div id="scInner" style="margin-top:18px;">${inner}</div>
    </div></div>`;
    body.querySelector('#scCat').addEventListener('change', e=>{ shipCat=e.target.value; renderShippingCost(body); });
    body.querySelectorAll('[data-scmode]').forEach(b=> b.addEventListener('click', async ()=>{ sc.mode=b.dataset.scmode; await saveConfig(); renderShippingCost(body); }));
    body.querySelectorAll('.sc-region-inp').forEach(inp=> inp.addEventListener('change', async ()=>{ const st=sc.mode==='4'?cs.r4:cs.r6; const v=parseFloat(inp.value); if(v>0) st[inp.dataset.region]=v; else delete st[inp.dataset.region]; await saveConfig(); }));
    if(sc.mode==='province'){
      body.querySelectorAll('[data-scpm]').forEach(b=> b.addEventListener('click', async ()=>{ sc.provMode=b.dataset.scpm; await saveConfig(); renderShippingCost(body); }));
      const rp=body.querySelector('#scRegion'); if(rp) rp.addEventListener('change', ()=>{ shipRegion=rp.value; renderShippingCost(body); });
      ensureThGeo().then(()=> fillScProv(body));
    }
  }
  function fillScProv(body){
    const box=body.querySelector('#scProvList'); if(!box || !window.__thGeo) return;
    const cs=scCatStore(), sc=config.shippingCost, lang=(window.appLang && window.appLang())||'th';
    const reg=shipRegion||regionKeys()[0];
    const provs=window.__thGeo.p.filter(pp=> regionOfProvince(pp[0])===reg);
    const baseStore=regionMode()==='4'?cs.r4:cs.r6, base=baseStore[reg];
    let html='';
    if((sc.provMode||'exception')==='exception'){
      html += `<div class="shipcost-row shipcost-base"><span class="shipcost-name">${esc(T('set.shipRegionBase'))} · ${esc(T('region.'+reg))}</span>
        <input type="number" class="sc-base-inp" data-region="${reg}" value="${base!=null?base:''}" placeholder="0" min="0"><span class="shipcost-unit">${esc(T('set.baht'))}</span></div>`;
    }
    html += provs.map(pp=>{ const nm=lang==='en'?pp[2]:pp[1]; const ph=((sc.provMode||'exception')==='exception' && base!=null)?String(base):'0';
      return `<div class="shipcost-row"><span class="shipcost-name">${esc(nm)}</span><input type="number" class="sc-prov-inp" data-code="${pp[0]}" value="${cs.prov[pp[0]]!=null?cs.prov[pp[0]]:''}" placeholder="${esc(ph)}" min="0"><span class="shipcost-unit">${esc(T('set.baht'))}</span></div>`; }).join('');
    box.innerHTML=html;
    box.querySelectorAll('.sc-base-inp').forEach(inp=> inp.addEventListener('change', async ()=>{ const st=regionMode()==='4'?cs.r4:cs.r6; const v=parseFloat(inp.value); if(v>0) st[inp.dataset.region]=v; else delete st[inp.dataset.region]; await saveConfig(); fillScProv(body); }));
    box.querySelectorAll('.sc-prov-inp').forEach(inp=> inp.addEventListener('change', async ()=>{ const v=parseFloat(inp.value); if(v>0) cs.prov[inp.dataset.code]=v; else delete cs.prov[inp.dataset.code]; await saveConfig(); }));
  }
  // Which subpages this role may open. Granting the whole module (the old,
  // pre-subpage way) still means "all of them".
  function allowedSubs(cfg){
    if(typeof window.roleCanAccess !== 'function') return cfg.subpages;
    if(window.roleCanAccess(window.currentRole, cfg.id)) return cfg.subpages;
    return cfg.subpages.filter(sp=> window.roleCanAccess(window.currentRole, cfg.id + ':' + sp));
  }
  function makeStoreModule(cfg){
    let sub = cfg.subpages[0];
    const mod = {
      id: cfg.id,
      navLabel: cfg.navLabel,
      subpages: cfg.subpages,      // read by the sidebar to decide visibility
      pageId: 'page-' + cfg.id,
      async onInit(){ await ensureLoaded(); },
      mount(container){
        const lang = (window.appLang && window.appLang()) || 'th';
        container.innerHTML = `
          <div class="topbar">
            <h1>${esc(cfg.navLabel[lang] || cfg.navLabel.en)}</h1>
            <div class="crumb">${esc(T('crumb'))}</div>
          </div>
          <div class="content">
            <div class="acc-subnav store-subnav" id="${cfg.id}Subnav"></div>
            <div id="${cfg.id}Body"></div>
          </div>`;
        container.querySelector('#' + cfg.id + 'Subnav').addEventListener('click', (e)=>{
          const btn = e.target.closest('[data-subpage]');
          if(!btn) return;
          sub = btn.dataset.subpage;
          _ehDetail = null;
          mod.render();
        });
      },
      render(){
        const nav = document.querySelector('#' + cfg.id + 'Subnav');
        const body = document.querySelector('#' + cfg.id + 'Body');
        if(!nav || !body) return;
        const visible = allowedSubs(cfg);
        if(!visible.length){                      // role has no tab here at all
          nav.innerHTML = '';
          body.innerHTML = `<div class="panel"><p class="setting-desc">${esc(T('noAccess'))}</p></div>`;
          return;
        }
        if(visible.indexOf(sub) < 0) sub = visible[0];   // landed on a hidden tab
        nav.innerHTML = visible.length > 1
          ? visible.map(id=> `<button type="button" class="acc-subnav-btn ${id===sub?'active':''}" data-subpage="${id}">${esc(T('nav.'+id))}</button>`).join('')
          : '';
        renderSubpage(sub, body);
      }
    };
    if(cfg.dataTools) mod.dataTools = cfg.dataTools;
    return mod;
  }

  window.registerModule(makeStoreModule({ id:'stock',           navLabel:{ th:'จัดการสต๊อก', en:'Stock Management' },  subpages:['products','stockHistory','productHistory'], dataTools:_dataTools }));
  window.registerModule(makeStoreModule({ id:'accountingSetting', navLabel:{ th:'\u0E15\u0E31\u0E49\u0E07\u0E04\u0E48\u0E32\u0E1A\u0E31\u0E0D\u0E0A\u0E35', en:'Accounting Setting' }, subpages:['accountingSetting'] }));
  window.registerModule(makeStoreModule({ id:'commissionSetting', navLabel:{ th:'\u0E15\u0E31\u0E49\u0E07\u0E04\u0E48\u0E32\u0E04\u0E2D\u0E21\u0E21\u0E34\u0E0A\u0E0A\u0E31\u0E48\u0E19', en:'Commission Setting' }, subpages:['commissionSetting'] }));
  window.registerModule(makeStoreModule({ id:'customerDoc',      navLabel:{ th:'\u0E40\u0E2D\u0E01\u0E2A\u0E32\u0E23\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32', en:'Customer Document' }, subpages:['customerDoc'] }));
  window.registerModule(makeStoreModule({ id:'financialReport', navLabel:{ th:'\u0E23\u0E32\u0E22\u0E07\u0E32\u0E19\u0E01\u0E32\u0E23\u0E40\u0E07\u0E34\u0E19', en:'Financial Report' }, subpages:['finOverview','pnl','cashFlow','taxReport'] }));
  window.registerModule(makeStoreModule({ id:'expenseAp',       navLabel:{ th:'\u0E23\u0E32\u0E22\u0E08\u0E48\u0E32\u0E22 & \u0E40\u0E08\u0E49\u0E32\u0E2B\u0E19\u0E35\u0E49', en:'Expense & Account Payable' }, subpages:['sellingExpenses','apList','opExpense','opexHistory'] }));
  window.registerModule(makeStoreModule({ id:'cogsInventory',   navLabel:{ th:'\u0E15\u0E49\u0E19\u0E17\u0E38\u0E19\u0E02\u0E32\u0E22 & \u0E21\u0E39\u0E25\u0E04\u0E48\u0E32\u0E2A\u0E15\u0E4A\u0E2D\u0E01', en:'COGS & Inventory Valuation' }, subpages:['cogsTracking','stockValue'] }));
  window.registerModule(makeStoreModule({ id:'revenueAcct',     navLabel:{ th:'\u0E23\u0E32\u0E22\u0E44\u0E14\u0E49 & \u0E1A\u0E31\u0E0D\u0E0A\u0E35', en:'Revenue & Accounting' }, subpages:['invoicing','receipts'] }));
  window.registerModule(makeStoreModule({ id:'sell',            navLabel:{ th:'การขาย',       en:'Sell Management' },   subpages:['revenue','orderStatus','invoiceStatus','orderHistory'] }));
  window.registerModule(makeStoreModule({ id:'businessProfile', navLabel:{ th:'ข้อมูลธุรกิจ',   en:'Business Profile' },  subpages:['profileGeneral','profile'] }));
  window.registerModule(makeStoreModule({ id:'sellStockSetting', navLabel:{ th:'ตั้งค่า Sell/Stock', en:'Sell/Stock Setting' }, subpages:['sellConfig','stockConfig'] }));
  window.registerModule(makeStoreModule({ id:'delivery',        navLabel:{ th:'การจัดส่ง',      en:'Delivery' },         subpages:['deliveryList','deliveryBoard','deliveryCalendar','deliveryDrivers'] }));
  window.registerModule(makeStoreModule({ id:'deliverySetting', navLabel:{ th:'ตั้งค่าการจัดส่ง', en:'Delivery Setting' }, subpages:['grouping','shippingCost'] }));

  /* ================= Export / Import (JSON) ================= */
  function exportStoreJson(){
    const blob = { app:'simplestore', schema:1, config, expenses, orders, products, stockLog, lots, promotions };
    window.downloadFile('simplestore-backup-' + window.localIso() + '.json', JSON.stringify(blob, null, 2), 'application/json;charset=utf-8;');
  }
  async function importStoreJson(text){
    const data = JSON.parse(text);
    if(data.app !== 'simplestore' || !data.config) throw new Error('bad file');
    // Replace everything — this is a full restore, not a merge.
    config    = data.config;
    expenses  = Array.isArray(data.expenses)  ? data.expenses  : [];
    orders    = Array.isArray(data.orders)    ? data.orders    : [];
    products  = Array.isArray(data.products)  ? data.products  : [];
    stockLog  = Array.isArray(data.stockLog)  ? data.stockLog  : [];
    lots      = Array.isArray(data.lots)      ? data.lots      : [];
    promotions = Array.isArray(data.promotions) ? data.promotions : [];
    migrateConfigRoles();
    await migrateStockLots();
    await saveConfig();
    await window.Store.set(K_EXPENSES, expenses);
    await window.Store.set(K_ORDERS, orders);
    await window.Store.set(K_PRODUCTS, products);
    await window.Store.set(K_STOCKLOG, stockLog);
    await window.Store.set(K_LOTS, lots);
    await window.Store.set(K_PROMOS, promotions);
  }

  /* ---- CSV export/import (expenses + products only; orders are JSON-only) ---- */
  function csvEscape(v){
    const s = String(v == null ? '' : v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function parseCsvLine(line){
    const out = []; let cur = ''; let q = false;
    for(let i=0;i<line.length;i++){
      const c = line[i];
      if(q){ if(c === '"'){ if(line[i+1] === '"'){ cur += '"'; i++; } else q = false; } else cur += c; }
      else { if(c === '"') q = true; else if(c === ',') { out.push(cur); cur = ''; } else cur += c; }
    }
    out.push(cur); return out;
  }
  function csvToRows(text){
    const lines = text.replace(/^\ufeff/, '').split(/\r?\n/).filter(l=> l.trim() !== '');
    if(lines.length === 0) return { header:[], rows:[] };
    const header = parseCsvLine(lines[0]).map(h=> h.trim());
    const rows = lines.slice(1).map(l=>{ const cells = parseCsvLine(l); const o = {}; header.forEach((h,i)=> o[h] = cells[i] != null ? cells[i] : ''); return o; });
    return { header, rows };
  }
  function downloadCsv(name, header, rows){
    const lines = [header.join(',')];
    rows.forEach(r=> lines.push(header.map(h=> csvEscape(r[h])).join(',')));
    window.downloadFile(name, '\ufeff' + lines.join('\r\n'), 'text/csv;charset=utf-8;');
  }

  const EXPENSE_COLS = ['id','expenseId','date','details','tag','costPerPiece','amount','shippingFee','discount','purchaseFrom','note','action'];
  const PRODUCT_COLS = ['id','sku','name','productType','cost','price','stock','tag','action'];

  function exportExpensesCsv(){
    downloadCsv('simplestore-expenses-' + window.localIso() + '.csv', EXPENSE_COLS,
      expenses.map(e=> ({ ...e, action:'' })));
  }
  function exportProductsCsv(){
    downloadCsv('simplestore-products-' + window.localIso() + '.csv', PRODUCT_COLS,
      products.map(p=> ({ id:p.id, sku:p.sku, name:p.name, productType:p.productType||'', cost:p.cost, price:p.price, stock:p.stock, tag:p.tag, action:'' })));
  }
  // Orders CSV is view-only (items bind to productId) — export uses readable item text.
  function exportOrdersCsv(){
    const cols = ['invoiceNumber','date','customerName','address','platform','items','discount','net','tag','orderStatus','invoiceStatus','note'];
    downloadCsv('simplestore-orders-' + window.localIso() + '.csv', cols,
      orders.map(computeOrder).map(o=> ({ ...o, items: itemsSummary(o.items) })));
  }

  // Upsert CSV import: new id → create, existing id → update, action=delete → remove.
  async function importCsvUpsert(text){
    const { header, rows } = csvToRows(text);
    const hset = new Set(header);
    let target, key, cols;
    if(hset.has('expenseId') || (hset.has('costPerPiece') && hset.has('details'))){ target = 'expenses'; }
    else if(hset.has('sku') && hset.has('price') && hset.has('stock')){ target = 'products'; }
    else throw new Error('unknown csv');

    let created = 0, updated = 0, deleted = 0;
    const list = target === 'expenses' ? expenses : products;
    rows.forEach(r=>{
      const action = (r.action || '').trim().toLowerCase();
      const id = (r.id || '').trim();
      if(action === 'delete'){
        if(id){ const i = list.findIndex(x=> x.id === id); if(i >= 0){ list.splice(i,1); deleted++; } }
        return;
      }
      if(target === 'expenses'){
        const rec = {
          id: id || rid(), expenseId: r.expenseId || '', date: r.date || '', details: r.details || '',
          tag: r.tag || '', costPerPiece: parseFloat(r.costPerPiece)||0, amount: parseFloat(r.amount)||0,
          shippingFee: parseFloat(r.shippingFee)||0, discount: -Math.abs(parseFloat(r.discount)||0),
          purchaseFrom: r.purchaseFrom || '', note: r.note || ''
        };
        const computed = computeRow(rec);
        if(!rec.expenseId && rec.date && rec.tag) computed.expenseId = generateExpenseId(rec.date, rec.tag, rec.id);
        const i = list.findIndex(x=> x.id === computed.id);
        if(i >= 0){ list[i] = computed; updated++; } else { list.push(computed); created++; }
      }else{
        const rec = {
          id: id || rid(), sku: r.sku || '', name: r.name || '', productType: r.productType || '',
          cost: parseFloat(r.cost)||0, price: parseFloat(r.price)||0, stock: parseInt(r.stock)||0,
          tag: r.tag || 'In Stock', image: null
        };
        const i = list.findIndex(x=> x.id === rec.id);
        if(i >= 0){ rec.image = list[i].image || null; list[i] = rec; updated++; } else { list.push(rec); created++; }
      }
    });
    if(target === 'expenses'){ expenses = list; await window.Store.set(K_EXPENSES, expenses); }
    else { products = list; await window.Store.set(K_PRODUCTS, products); }
    return { target, created, updated, deleted };
  }

  /* ================= Expense page ================= */
  function fmt(n){
    n = Math.round((Number(n) + Number.EPSILON) * 100) / 100;
    return n.toLocaleString('en-US', { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 });
  }
  function computeRow(r){
    const sumItemsCost = r.costPerPiece * r.amount;
    const net = sumItemsCost + r.shippingFee + r.discount;
    return { ...r, sumItemsCost, net };
  }
  // Deterministic date → 2-letter + 2-digit code (Knuth multiplicative hash).
  function dateHashCode(day, month, year){
    const HASH_CONSTANT = 2654435761n, MOD32 = 4294967296n;
    const x = BigInt(year)*10000n + BigInt(month)*100n + BigInt(day);
    const h = (x * HASH_CONSTANT) % MOD32;
    const lettersPart = Number(h % 676n);
    const digitsPart = Number((h / 676n) % 100n);
    const l1 = String.fromCharCode(65 + Math.floor(lettersPart/26));
    const l2 = String.fromCharCode(65 + (lettersPart%26));
    return `${l1}${l2}${String(digitsPart).padStart(2,'0')}`;
  }
  // Tag → single-letter code from the first letter of the (config) tag name.
  function tagLetter(tagName){ return (tagName || 'X').trim().charAt(0).toUpperCase() || 'X'; }
  function generateExpenseId(dateStr, tag, excludeId){
    const [y,m,d] = dateStr.split('-').map(Number);
    const code = dateHashCode(d, m, y);
    const letter = tagLetter(tag);
    const prefix = (config.prefixes && config.prefixes.expense) || 'CSA';
    return `${prefix}-${code}-${letter}${String(nextSeq('expense', dateStr)).padStart(3,'0')}`;
  }
  function expTagColor(name){ return colorOf('expenseTags', name); }
  async function saveExpenses(){ await window.Store.set(K_EXPENSES, expenses); }

  function expenseFiltered(){
    return expenses.filter(e=>{
      if(expFilter.from && e.date < expFilter.from) return false;
      if(expFilter.to && e.date > expFilter.to) return false;
      if(expFilter.tag !== 'all' && e.tag !== expFilter.tag) return false;
      return true;
    }).sort((a,b)=> b.date.localeCompare(a.date));
  }

  /* ================= Revenue / Orders page ================= */
  // Discount amount for a base value — used by computeOrder AND the commission maths.
  const dAmt = (base, val, type)=> (type === 'percent' ? base * (Math.abs(val)||0) / 100 : Math.abs(val)||0);
  function computeOrder(o){
    const itemsTotal = (o.items||[]).reduce((s,it)=> s + (it.qty*it.price), 0);
    const itemsNet = (o.items||[]).reduce((s,it)=>{ const gr=(it.qty||0)*(it.price||0); return s + (gr - dAmt(gr, it.discount, it.discountType)); }, 0);
    const shipping = o.shippingCost||0;
    const sub = itemsNet + shipping;
    const overallAmt = dAmt(sub, o.overallDiscount, o.overallDiscountType);
    const netBase = sub - overallAmt;
    // Shipping billed SEPARATELY is outside the VAT base — only the goods are taxed.
    const goodsBase = Math.max(0, itemsNet - overallAmt);
    const split = o.docSplit === 'split';
    const vatBase = split ? goodsBase : netBase;
    const vat = o.vatable ? vatBase * 0.07 : 0;
    const net = netBase + vat;
    return { ...o, itemsTotal, itemsNet, itemDiscTotal: itemsTotal - itemsNet, shipping, overallAmt, goodsBase, netBase, vatBase, vat, net };
  }
  // Running numbers come from a COUNTER kept on config, never from "how many
  // records exist today" — deleting a record must not free its number for reuse.
  // The counter resets to 1 on a new date.
  function nextSeq(kind, dateStr){
    if(!config.counters) config.counters = {};
    const cur = config.counters[kind];
    const n = (cur && cur.date === dateStr) ? (cur.n || 0) + 1 : 1;
    config.counters[kind] = { date: dateStr, n };
    saveConfig();
    return n;
  }
  function generateInvoiceNumber(dateStr, excludeId){
    const [y,m,d] = dateStr.split('-').map(Number);
    const code = dateHashCode(d, m, y);
    const prefix = (config.prefixes && config.prefixes.order) || 'ATSC';
    return `${prefix}-${code}-${String(nextSeq('order', dateStr)).padStart(3,'0')}`;
  }
  // Cost of goods sold for one order = what the allocated cost lots actually cost.
  // Commission rate for a product category (percent).
  function commissionRateOf(cat){
    const c = config.commission || {};
    const r = (c.rates || {})[cat];
    return r == null ? 5 : (Number(r) || 0);
  }
  // Commission is paid on PROFIT, not on turnover: work the profit out first,
  // then apply the category's percentage to it.
  //
  // Per line: revenue - cost of those goods - its share of the bill-level
  // deductions (overall discount, platform fee, delivery fee). A line that ends
  // up at or below zero pays no commission — nobody earns a cut of a loss.
  function orderCommission(o){
    const c = config.commission || {};
    const co = computeOrder(o);
    const _se = sellExpOf(o);
    const deductions = orderPlatformFee(o) + _se.delivery + _se.other + (co.overallAmt || 0);
    const lines = (o.items || []).map(it=>{
      const gross = (it.qty||0) * (it.price||0);
      const net = gross - dAmt(gross, it.discount, it.discountType);
      const cost = (it.costAllocation || []).reduce((x,a)=> x + (Number(a.cost)||0) * (a.qty||0), 0);
      const prod = products.find(x=> x.id === it.productId);
      return { net, cost, cat: (prod && prod.productType) || '' };
    });
    const totalNet = lines.reduce((sm,l)=> sm + l.net, 0);
    let comm = 0, profitBase = 0;
    lines.forEach(l=>{
      const share = totalNet > 0 ? (l.net / totalNet) : 0;
      const profit = l.net - l.cost - deductions * share;
      if(profit <= 0) return;
      profitBase += profit;
      comm += profit * commissionRateOf(l.cat) / 100;
    });
    // Shipping counts only when the base includes it; with no real delivery cost
    // recorded yet, its whole charge is treated as margin.
    if(c.base === 'goodsShip' && co.shipping > 0){
      const avg = profitBase > 0 ? (comm / profitBase * 100) : 5;
      comm += co.shipping * avg / 100;
    }
    return comm;
  }
  // What the platform takes: the stored % of the bill plus any flat fee.
  function orderPlatformFee(o){
    const co = computeOrder(o);
    const base = co.netBase != null ? co.netBase : co.net;
    return base * ((Number(o.platformFee) || 0) / 100) + (Number(o.platformFeeAmount) || 0);
  }
  // Costs of selling a bill, entered by hand on the Selling Expenses page.
  function sellExpOf(o){
    const e = o.sellExpense || {};
    return { delivery: Number(e.delivery) || 0, other: Number(e.other) || 0, note: e.note || '' };
  }
  // Payroll asks for commission per month; it never re-implements the formula.
  // Returns the payout model plus the totals per seller for that month.
  window.payrollCommission = function(monthKey){
    const inMonth = (d)=> !monthKey || String(d||'').slice(0,7) === monthKey;
    const bySeller = {};
    let total = 0;
    orders.filter(o=> inMonth(o.date)).forEach(o=>{
      const c = orderCommission(o);
      if(c <= 0) return;
      total += c;
      const who = o.seller || o.createdByLabel || o.createdBy || '-';
      bySeller[who] = (bySeller[who] || 0) + c;
    });
    const cfg = config.commission || {};
    return { mode: cfg.mode || 'pool', base: cfg.base || 'goods', total, bySeller };
  };
  function orderCOGS(o){
    return (o.items||[]).reduce((sm,it)=>
      sm + (it.costAllocation||[]).reduce((x,a)=> x + (Number(a.cost)||0) * (a.qty||0), 0), 0);
  }
  // Gross profit: revenue on the bill minus that cost. Delivery fuel/labour is
  // NOT in here yet (parked in the To-Do list).
  function orderProfit(o){ const c = computeOrder(o); return (c.netBase != null ? c.netBase : c.net) - orderCOGS(o); }   // VAT is not income
  function itemsSummary(items){ return (items||[]).map(it=>{ const c = itemColorLabel(it); return `${it.productName}${c?' ('+c+')':''} x${it.qty}`; }).join(', '); }
  function ordColor(group, name){ return colorOf(group, name); }
  async function saveOrders(){ await window.Store.set(K_ORDERS, orders); syncDeliveries(); syncPublicStock(); }
  async function saveDeliveries(){ await window.Store.set(K_DELIVERIES, deliveries); }

  function ordersFiltered(){
    return orders.filter(o=>{
      if(ordFilter.from && o.date < ordFilter.from) return false;
      if(ordFilter.to && o.date > ordFilter.to) return false;
      if(ordFilter.orderStatus !== 'all' && o.orderStatus !== ordFilter.orderStatus) return false;
      if(ordFilter.invoiceStatus !== 'all' && o.invoiceStatus !== ordFilter.invoiceStatus) return false;
      if(ordFilter.tag !== 'all' && o.tag !== ordFilter.tag) return false;
      return true;
    }).sort((a,b)=> b.date.localeCompare(a.date));
  }

  function renderRevenuePage(body){
    const oStatuses = config.orderStatuses || [];
    const iStatuses = config.invoiceStatuses || [];
    const rTags = config.revenueTags || [];
    body.innerHTML = `
      <div class="panel">
        <div class="art-toolbar">
          <div class="art-field"><label>${esc(T('exp.from'))}</label><input type="date" id="ordFrom" value="${esc(ordFilter.from)}"></div>
          <div class="art-field"><label>${esc(T('exp.to'))}</label><input type="date" id="ordTo" value="${esc(ordFilter.to)}"></div>
          <div class="art-field"><label>${esc(T('rev.orderStatus'))}</label>
            <select id="ordOsFilter"><option value="all">${esc(T('exp.all'))}</option>${oStatuses.map(s=>`<option value="${esc(s.name)}" ${ordFilter.orderStatus===s.name?'selected':''}>${esc(itemLabel(s))}</option>`).join('')}</select>
          </div>
          <div class="art-field"><label>${esc(T('rev.invoiceStatus'))}</label>
            <select id="ordIsFilter"><option value="all">${esc(T('exp.all'))}</option>${iStatuses.map(s=>`<option value="${esc(s.name)}" ${ordFilter.invoiceStatus===s.name?'selected':''}>${esc(itemLabel(s))}</option>`).join('')}</select>
          </div>
          <div class="art-field"><label>${esc(T('exp.tag'))}</label>
            <select id="ordTagFilter"><option value="all">${esc(T('exp.all'))}</option>${rTags.map(t=>`<option value="${esc(t.name)}" ${ordFilter.tag===t.name?'selected':''}>${esc(itemLabel(t))}</option>`).join('')}</select>
          </div>
          <button class="btn btn-ghost" id="ordClearFilter">${esc(T('exp.clearFilter'))}</button>
          <div class="art-spacer"></div>
          <button class="btn btn-primary" id="ordAdd">${esc(T('rev.add'))}</button>
        </div>
        <div class="art-table-wrap">
          <table class="art-table sell-table" id="ordTable">
            <thead><tr>
              <th>${esc(T('exp.date'))}</th><th>${esc(T('rev.invoiceNo'))}</th><th>${esc(T('rev.customer'))}</th>
              <th>${esc(T('rev.platform'))}</th><th>${esc(T('rev.items'))}</th><th class="num">${esc(T('exp.discount'))}</th>
              <th class="num">${esc(T('exp.net'))}</th><th>${esc(T('exp.tag'))}</th>
              <th>${esc(T('rev.orderStatus'))}</th><th>${esc(T('rev.invoiceStatus'))}</th><th>${esc(T('pay.mode'))}</th><th class="num">${esc(T('pay.paid'))}</th><th class="num">${esc(T('pay.pending'))}</th><th>${esc(T('rev.deliveryMethod'))}</th><th>${esc(T('rev.responsible'))}</th><th>${esc(T('sell.seller'))}</th><th>${esc(T('col.lastEdited'))}</th><th class="c sell-sticky-vat">${esc(T('pay.vat'))}</th><th class="art-sticky-actions"></th>
            </tr></thead>
            <tbody id="ordTbody"></tbody>
            <tfoot><tr>
              <td colspan="5">${esc(T('rev.totalRows'))} (<span id="ordRowCount">0</span>)</td>
              <td class="num" id="ordFootDisc">0</td><td class="num" id="ordFootTotal">0</td><td colspan="3"></td>
            </tr></tfoot>
          </table>
        </div>
        <div id="ordEmpty" class="art-empty" style="display:none;"><div class="art-empty-ico">📦</div>${esc(T('rev.empty'))}</div>
      </div>`;
    body.querySelector('#ordFrom').addEventListener('change', e=>{ ordFilter.from=e.target.value; renderOrdersTable(body); });
    body.querySelector('#ordTo').addEventListener('change', e=>{ ordFilter.to=e.target.value; renderOrdersTable(body); });
    body.querySelector('#ordOsFilter').addEventListener('change', e=>{ ordFilter.orderStatus=e.target.value; renderOrdersTable(body); });
    body.querySelector('#ordIsFilter').addEventListener('change', e=>{ ordFilter.invoiceStatus=e.target.value; renderOrdersTable(body); });
    body.querySelector('#ordTagFilter').addEventListener('change', e=>{ ordFilter.tag=e.target.value; renderOrdersTable(body); });
    body.querySelector('#ordClearFilter').addEventListener('click', ()=>{ ordFilter={from:'',to:'',orderStatus:'all',invoiceStatus:'all',tag:'all'}; renderRevenuePage(body); });
    body.querySelector('#ordAdd').addEventListener('click', ()=> openOrderModal(null, body, ()=> renderRevenuePage(body)));
    renderOrdersTable(body);
  }

  // Donut built from stroke-dasharray segments — no arc maths, no DOM juggling.
  // items = [{ name, value, color }]
  function acctDonutHtml(items, centerMain, centerSub){
    const total = items.reduce((sm,i)=> sm + (i.value||0), 0);
    const R = 62, W = 22, C = 2 * Math.PI * R;
    let offset = 0;
    const segs = total > 0 ? items.filter(i=> i.value > 0).map(i=>{
      const len = C * (i.value / total);
      const seg = `<circle cx="80" cy="80" r="${R}" fill="none" stroke="${esc(i.color)}" stroke-width="${W}" stroke-dasharray="${len.toFixed(2)} ${(C-len).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 80 80)"></circle>`;
      offset += len;
      return seg;
    }).join('') : `<circle cx="80" cy="80" r="${R}" fill="none" stroke="var(--c-border)" stroke-width="${W}"></circle>`;
    return `<div class="acct-donut">
      <svg viewBox="0 0 160 160" class="acct-donut-svg">${segs}
        <text x="80" y="76" text-anchor="middle" dominant-baseline="central" class="acct-donut-main">${esc(centerMain)}</text>
        <text x="80" y="96" text-anchor="middle" dominant-baseline="central" class="acct-donut-sub">${esc(centerSub||'')}</text>
      </svg>
      <div class="acct-donut-legend">${items.map(i=> `<div class="art-leg-item"><span class="art-leg-dot" style="background:${esc(i.color)}"></span><span class="art-leg-name">${esc(i.name)}</span><span class="art-leg-val">${i.value}</span></div>`).join('') || `<span class="art-set-empty">${esc(T('inv.empty'))}</span>`}</div>
    </div>`;
  }
  const billFilters = { invoicing:{ from:'', to:'', vat:'all' }, receipts:{ from:'', to:'', vat:'all' } };
  // Only an admin (or the dev account) may verify a bill — this is a sign-off,
  // not an everyday edit.
  function isAdminActor(){
    const e = window.currentEmployee;
    if(!e) return false;
    if(e.roleKey === 'developer' || e.roleKey === 'admin') return true;
    return ((typeof window.roleTypeOf === 'function') ? window.roleTypeOf(e.roleKey) : '') === 'admin';
  }
  // Invoicing (not yet paid) and Receipts (paid) are the same READ-ONLY table over
  // different halves of the order list, so they share one renderer.
  // Frozen columns used to be positioned with hard-coded px offsets, which
  // overlapped or left gaps as soon as the content changed width. Measure the
  // real header widths (right to left) and pin each column to the running total.
  const STICKY_ORDER = ['art-sticky-actions', 'led-sticky-ver', 'led-sticky-vat', 'led-sticky-seller', 'sell-sticky-vat'];
  function syncStickyCols(table){
    if(!table || typeof table.querySelector !== 'function') return;
    let acc = 0;
    STICKY_ORDER.forEach(cls=>{
      const th = table.querySelector('th.' + cls);
      if(!th) return;
      const w = Math.round(th.getBoundingClientRect ? th.getBoundingClientRect().width : (th.offsetWidth || 0));
      table.querySelectorAll('th.' + cls + ', td.' + cls).forEach(cell=>{ cell.style.right = acc + 'px'; });
      acc += w;
    });
  }
  // Horizontal bars for small comparisons (paid vs unpaid, etc).
  function acctBarsHtml(items){
    const max = items.reduce((m,i)=> Math.max(m, i.value||0), 0) || 1;
    return `<div class="acct-bars">${items.map(i=> `
      <div class="acct-bar-row">
        <div class="acct-bar-label">${esc(i.name)}</div>
        <div class="acct-bar-track"><div class="acct-bar-fill" style="width:${Math.max(2, Math.round((i.value||0)/max*100))}%; background:${esc(i.color||'#5B8FB0')}"></div></div>
        <div class="acct-bar-val">${fmtD(i.value)}</div>
      </div>`).join('')}</div>`;
  }

  function renderAccountingSetting(body){
    const rerender = ()=> renderAccountingSetting(body);
    body.innerHTML = renderConfigShell(
      groupHtml('expenseCategories', T('set.expenseCategories')));
    wireGroups(body.querySelector('#artSetGroups'), body, rerender);
  }
  function renderCommissionSetting(body){
    const c = config.commission || (config.commission = { mode:'pool', base:'goods', rates:{} });
    const cats = config.productTypes || [];
    const sellers = (typeof window.employeesByRoleType === 'function' ? window.employeesByRoleType('salesperson') : []);
    body.innerHTML = `
      <div class="panel">
        <h4 class="art-form-section" style="margin-top:0;">${esc(T('comm.payout'))}</h4>
        <div class="del-seg" id="cmMode">
          <button type="button" class="del-seg-btn ${c.mode!=='person'?'active':''}" data-m="pool">${esc(T('comm.pool'))}</button>
          <button type="button" class="del-seg-btn ${c.mode==='person'?'active':''}" data-m="person">${esc(T('comm.person'))}</button>
        </div>
        <p class="setting-desc">${esc(T('comm.payoutHint'))} \u00B7 ${esc(T('comm.sellerCount'))}: <b>${sellers.length}</b></p>

        <h4 class="art-form-section">${esc(T('comm.base'))}</h4>
        <div class="del-seg" id="cmBase">
          <button type="button" class="del-seg-btn ${c.base!=='goodsShip'?'active':''}" data-b="goods">${esc(T('comm.baseGoods'))}</button>
          <button type="button" class="del-seg-btn ${c.base==='goodsShip'?'active':''}" data-b="goodsShip">${esc(T('comm.baseGoodsShip'))}</button>
        </div>

        <h4 class="art-form-section">${esc(T('comm.rates'))}</h4>
        <p class="setting-desc" style="margin-top:-6px;">${esc(T('comm.ratesHint'))}</p>
        <p class="setting-desc art-profit" style="margin-top:-2px;">${esc(T('comm.profitBase'))}</p>
        <div class="art-set-list">
          <div class="art-set-headrow">
            <span class="art-set-swatch" style="visibility:hidden;"></span>
            <span class="art-set-h art-set-h-name">${esc(T('prod.ptype'))}</span>
            <span class="art-set-h art-set-h-fee">%</span>
          </div>
          ${cats.length ? cats.map(t=> `
            <div class="cm-row">
              <span class="art-set-swatch" style="background:${esc(t.color||'#888')}"></span>
              <span class="cm-name">${esc(itemLabel(t))}</span>
              <span class="art-set-fee"><input type="number" class="art-set-feeinp cm-rate" data-cat="${esc(t.name)}" value="${commissionRateOf(t.name)}" step="0.1" min="0">%</span>
            </div>`).join('') : `<p class="art-set-empty">${esc(T('comm.noCats'))}</p>`}
        </div>
      </div>`;
    body.querySelectorAll('#cmMode [data-m]').forEach(b=> b.addEventListener('click', async ()=>{
      c.mode = b.dataset.m; await saveConfig(); renderCommissionSetting(body);
    }));
    body.querySelectorAll('#cmBase [data-b]').forEach(b=> b.addEventListener('click', async ()=>{
      c.base = b.dataset.b; await saveConfig(); renderCommissionSetting(body);
    }));
    body.querySelectorAll('.cm-rate').forEach(inp=> inp.addEventListener('change', async ()=>{
      c.rates[inp.dataset.cat] = parseFloat(inp.value) || 0;
      await saveConfig();
    }));
  }

  /* ================= Financial Report =================
   * Three views over one shared period: an Overview (where the business stands
   * today), a Profit & Loss statement (did we earn anything?) and a Cash Flow
   * list (did the money actually move?). Everything is derived from data the
   * app already holds — orders, cost lots, selling expenses, AP and opex.
   */
  let finFilter = { from:'', to:'' };
  const finMonthKey = (d)=> String(d||'').slice(0,7);
  function finInRange(dateStr){
    const f = finFilter;
    return (!f.from || (dateStr||'') >= f.from) && (!f.to || (dateStr||'') <= f.to);
  }
  // Everything one bill contributes, already netted of VAT.
  function finBill(o){
    const co = computeOrder(o);
    const rev = co.netBase != null ? co.netBase : co.net;
    const se = sellExpOf(o);
    const cogs = orderCOGS(o);
    const pfee = orderPlatformFee(o);
    const comm = orderCommission(o);
    return { o, co, rev, cogs, pfee, dfee: se.delivery, ofee: se.other, comm,
             gross: rev - cogs,
             net: rev - cogs - pfee - se.delivery - se.other - comm,
             vat: co.vat || 0,
             cashIn: isPaidOrder(o) ? co.net : (Number(o.paidAmount) || 0) };
  }
  // Stock purchases: what we owe suppliers and what we have actually paid them.
  function finStockIn(){
    return stockLog.filter(e=> (e.qty||0) > 0).map(e=>{
      const ap = e.ap || {};
      const amount = (Number(e.cost)||0) * (e.qty||0);
      const paid = ap.status === 'paid' ? amount : (Number(ap.paid) || 0);
      return { e, amount, paid, owed: Math.max(0, amount - paid) };
    });
  }
  function finTotals(){
    const bills = orders.filter(o=> finInRange(o.date)).map(finBill);
    const ox = opex.filter(e=> finInRange(e.date));
    const stock = finStockIn().filter(x=> finInRange(x.e.date));
    const sum = (arr, k)=> arr.reduce((s,x)=> s + (Number(x[k])||0), 0);
    const revenue = sum(bills,'rev');
    const cogs = sum(bills,'cogs');
    const pfee = sum(bills,'pfee'), dfee = sum(bills,'dfee'), ofee = sum(bills,'ofee'), comm = sum(bills,'comm');
    const selling = pfee + dfee + ofee + comm;
    const opexTotal = ox.reduce((s,e)=> s + (Number(e.amount)||0), 0);
    const gross = revenue - cogs;
    const net = gross - selling - opexTotal;
    return {
      bills, ox, stock, revenue, cogs, gross, pfee, dfee, ofee, comm, selling, opexTotal, net,
      margin: revenue ? (net / revenue * 100) : 0,
      grossMargin: revenue ? (gross / revenue * 100) : 0,
      vat: sum(bills,'vat'),
      cashIn: sum(bills,'cashIn'),
      cashOut: sum(stock,'paid') + opexTotal
    };
  }
  // Month buckets for the trend charts (n months back from the filter's end).
  function finMonths(n){
    const end = finFilter.to || (window.localIso ? window.localIso() : new Date().toISOString().slice(0,10));
    const d = new Date(end.slice(0,4), Number(end.slice(5,7)) - 1, 1);
    const out = [];
    for(let i = n - 1; i >= 0; i--){
      const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
      out.push(`${m.getFullYear()}-${String(m.getMonth()+1).padStart(2,'0')}`);
    }
    return out;
  }
  function finMonthStats(key){
    const bills = orders.filter(o=> finMonthKey(o.date) === key).map(finBill);
    const ox = opex.filter(e=> finMonthKey(e.date) === key).reduce((s,e)=> s + (Number(e.amount)||0), 0);
    const sum = (arr, k)=> arr.reduce((s,x)=> s + (Number(x[k])||0), 0);
    const revenue = sum(bills,'rev');
    const net = sum(bills,'net') - ox;
    return { key, revenue, net, cogs: sum(bills,'cogs'), opex: ox, cashIn: sum(bills,'cashIn') };
  }
  // Months that actually contain data, newest first, with the current month always present.
  function finMonthOptions(){
    const keys = new Set();
    orders.forEach(o=>{ if(o.date) keys.add(finMonthKey(o.date)); });
    opex.forEach(e=>{ if(e.date) keys.add(finMonthKey(e.date)); });
    stockLog.forEach(e=>{ if(e.date) keys.add(finMonthKey(e.date)); });
    // Plus a window around today so a month with no data yet — including the
    // months ahead — can still be selected, whatever the year.
    const here = window.thisMonthKey();
    for(let i = -11; i <= 3; i++) keys.add(window.monthShift(here, i));
    if(finFilter.from) keys.add(finMonthKey(finFilter.from));
    return [...keys].filter(Boolean).sort().reverse();   // newest first
  }
  const finMonthBounds = (key)=> window.monthBounds(key);
  // Which month is selected right now — '' = all time, 'custom' = a hand-made range.
  function finSelectedMonth(){
    if(!finFilter.from && !finFilter.to) return '';
    const k = finMonthKey(finFilter.from);
    const b = finMonthBounds(k || '');
    return (k && finFilter.from === b.from && finFilter.to === b.to) ? k : 'custom';
  }
  const finMonthLabel = (key)=> window.monthLabel(key);
  function finToolbar(){
    const sel = finSelectedMonth();
    return `
      <div class="art-toolbar">
        <div class="art-field"><label>${esc(T('fin.month'))}</label>
          <select id="finMonth">
            <option value="" ${sel===''?'selected':''}>${esc(T('fin.allTime'))}</option>
            ${sel==='custom' ? `<option value="custom" selected>${esc(T('fin.custom'))}</option>` : ''}
            ${finMonthOptions().map(k=> `<option value="${k}" ${sel===k?'selected':''}>${esc(finMonthLabel(k))}</option>`).join('')}
          </select>
        </div>
        <div class="art-field"><label>${esc(T('exp.from'))}</label><input type="date" id="finFrom" value="${esc(finFilter.from)}"></div>
        <div class="art-field"><label>${esc(T('exp.to'))}</label><input type="date" id="finTo" value="${esc(finFilter.to)}"></div>
        <button class="btn btn-ghost" id="finClear">${esc(T('exp.clearFilter'))}</button>
      </div>`;
  }
  function finWireToolbar(body, redraw){
    body.querySelector('#finFrom').addEventListener('change', e=>{ finFilter.from = e.target.value; redraw(); });
    body.querySelector('#finTo').addEventListener('change', e=>{ finFilter.to = e.target.value; redraw(); });
    body.querySelector('#finMonth').addEventListener('change', e=>{
      const v = e.target.value;
      if(v === 'custom') return;                    // leave the hand-made range alone
      finFilter = v ? finMonthBounds(v) : { from:'', to:'' };
      redraw();
    });
    body.querySelector('#finClear').addEventListener('click', ()=>{ finFilter = { from:'', to:'' }; redraw(); });
  }
  function renderFinPage(body, view){
    const redraw = ()=> renderFinPage(body, view);
    if(view === 'pnl') finPnl(body);
    else if(view === 'cash') finCash(body);
    else if(view === 'tax') finTax(body);
    else finOverview(body);
    finWireToolbar(body, redraw);
  }

  /* ---- Overview: where the business stands right now ---- */
  function finOverview(body){
    const t = finTotals();
    // Money owed in both directions — these ignore the period on purpose:
    // a debt is a debt no matter when it was raised.
    const arRows = orders.map(computeOrder).filter(o=> pendingOf(o) > 0);
    const arTotal = arRows.reduce((s,o)=> s + pendingOf(o), 0);
    const apRows = finStockIn().filter(x=> x.owed > 0);
    const apTotal = apRows.reduce((s,x)=> s + x.owed, 0);
    const stockVal = stockValuationRows().reduce((s,r)=> s + r.cost, 0);
    const lossBills = t.bills.filter(b=> b.net < 0);

    const byPlatform = {};
    t.bills.forEach(b=>{ const k = b.o.platform || T('sum.uncategorised'); byPlatform[k] = (byPlatform[k]||0) + b.rev; });
    const platItems = Object.keys(byPlatform).map(n=> ({ name: dispName('platforms', n) || n, value: Math.round(byPlatform[n]), color: colorOf('platforms', n) })).sort((a,b)=> b.value - a.value);
    const costItems = [
      { name: T('acct.cogs'),        value: Math.round(t.cogs),      color:'#7C6A55' },
      { name: T('cogs.pfee'),        value: Math.round(t.pfee),      color:'#5B8FB0' },
      { name: T('cogs.dfee'),        value: Math.round(t.dfee),      color:'#4FA5A0' },
      { name: T('se.other'),         value: Math.round(t.ofee),      color:'#9B7BB5' },
      { name: T('cogs.commission'),  value: Math.round(t.comm),      color:'#C99A4E' },
      { name: T('nav.opExpense'),    value: Math.round(t.opexTotal), color:'#C6432E' }
    ].filter(i=> i.value > 0);

    body.innerHTML = `
      <div class="panel">
        ${finToolbar()}
        <div class="art-sum-cards">
          <div class="art-stat-card"><div class="art-stat-label">${esc(T('cogs.revenue'))}</div><div class="art-stat-value">${fmtD(t.revenue)} ฿</div></div>
          <div class="art-stat-card"><div class="art-stat-label">${esc(T('cogs.profit'))}</div><div class="art-stat-value art-profit">${fmtD(t.gross)} ฿</div></div>
          <div class="art-stat-card"><div class="art-stat-label">${esc(T('fin.netProfit'))}</div><div class="art-stat-value ${t.net < 0 ? 'art-pending-due' : 'art-profit'}">${fmtD(t.net)} ฿</div></div>
          <div class="art-stat-card"><div class="art-stat-label">${esc(T('cogs.margin'))}</div><div class="art-stat-value">${t.revenue ? t.margin.toFixed(1)+'%' : '-'}</div></div>
          <div class="art-stat-card"><div class="art-stat-label">${esc(T('fin.cashIn'))}</div><div class="art-stat-value art-profit">${fmtD(t.cashIn)} ฿</div></div>
          <div class="art-stat-card"><div class="art-stat-label">${esc(T('fin.cashOut'))}</div><div class="art-stat-value art-pending-due">${fmtD(t.cashOut)} ฿</div></div>
          <div class="art-stat-card"><div class="art-stat-label">${esc(T('fin.ar'))}</div><div class="art-stat-value art-pending-due">${fmtD(arTotal)} ฿</div></div>
          <div class="art-stat-card"><div class="art-stat-label">${esc(T('fin.ap'))}</div><div class="art-stat-value art-pending-due">${fmtD(apTotal)} ฿</div></div>
        </div>

        <div class="acct-summary" style="grid-template-columns:1fr 1fr;">
          <div class="acct-summary-chart">
            <h4 class="art-form-section" style="margin-top:0;">${esc(T('fin.revByPlatform'))}</h4>
            ${acctDonutHtml(platItems, fmt(Math.round(t.revenue)), T('fin.revShort'))}
          </div>
          <div class="acct-summary-chart">
            <h4 class="art-form-section" style="margin-top:0;">${esc(T('fin.costMix'))}</h4>
            ${acctDonutHtml(costItems, fmt(Math.round(t.cogs + t.selling + t.opexTotal)), T('ox.short'))}
          </div>
        </div>

        <h4 class="art-form-section">${esc(T('fin.health'))}</h4>
        <p class="setting-desc" style="margin-top:-6px;">${esc(T('fin.healthHint'))}</p>
        <div class="art-table-wrap">
          <table class="art-table">
            <thead><tr><th>${esc(T('fin.item'))}</th><th class="num">${esc(T('fin.count'))}</th><th class="num">${esc(T('ox.amount'))}</th><th>${esc(T('fin.note'))}</th></tr></thead>
            <tbody>
              <tr><td>${esc(T('fin.hAr'))}</td><td class="num">${arRows.length}</td><td class="num art-pending-due">${fmtD(arTotal)}</td><td class="setting-desc">${esc(T('fin.hArNote'))}</td></tr>
              <tr><td>${esc(T('fin.hAp'))}</td><td class="num">${apRows.length}</td><td class="num art-pending-due">${fmtD(apTotal)}</td><td class="setting-desc">${esc(T('fin.hApNote'))}</td></tr>
              <tr><td>${esc(T('fin.hStock'))}</td><td class="num">-</td><td class="num">${fmtD(stockVal)}</td><td class="setting-desc">${esc(T('fin.hStockNote'))}</td></tr>
              <tr><td>${esc(T('fin.hLoss'))}</td><td class="num">${lossBills.length}</td><td class="num ${lossBills.length?'art-pending-due':''}">${fmtD(lossBills.reduce((s,b)=> s + b.net, 0))}</td><td class="setting-desc">${esc(T('fin.hLossNote'))}</td></tr>
              <tr><td>${esc(T('fin.hVat'))}</td><td class="num">-</td><td class="num">${fmtD(t.vat)}</td><td class="setting-desc">${esc(T('fin.hVatNote'))}</td></tr>
            </tbody>
          </table>
        </div>
      </div>`;
  }

  /* ---- Profit & Loss ---- */
  function finPnl(body){
    const t = finTotals();
    const pct = (v)=> t.revenue ? (v / t.revenue * 100).toFixed(1) + '%' : '-';
    const line = (label, value, opts)=>{
      const o = opts || {};
      return `<tr class="${o.cls||''}">
        <td class="${o.indent?'pnl-indent':''}">${esc(label)}</td>
        <td class="num ${o.neg?'art-pending-due':''}">${o.neg && value ? '-' : ''}${fmtD(Math.abs(value))}</td>
        <td class="num">${pct(value)}</td>
      </tr>`;
    };
    const opexByCat = {};
    t.ox.forEach(e=>{ const k = e.category || T('sum.uncategorised'); opexByCat[k] = (opexByCat[k]||0) + (Number(e.amount)||0); });

    const months = finMonths(6).map(finMonthStats);
    const revBars = months.map(m=> ({ name: m.key, value: Math.round(m.revenue), color:'#5B8FB0' }));
    const netBars = months.map(m=> ({ name: m.key, value: Math.round(m.net), color: m.net < 0 ? '#C6432E' : '#6B8F71' }));

    body.innerHTML = `
      <div class="panel">
        ${finToolbar()}
        <div class="art-sum-cards">
          <div class="art-stat-card"><div class="art-stat-label">${esc(T('cogs.revenue'))}</div><div class="art-stat-value">${fmtD(t.revenue)} ฿</div></div>
          <div class="art-stat-card"><div class="art-stat-label">${esc(T('cogs.profit'))}</div><div class="art-stat-value art-profit">${fmtD(t.gross)} ฿</div></div>
          <div class="art-stat-card"><div class="art-stat-label">${esc(T('fin.netProfit'))}</div><div class="art-stat-value ${t.net<0?'art-pending-due':'art-profit'}">${fmtD(t.net)} ฿</div></div>
          <div class="art-stat-card"><div class="art-stat-label">${esc(T('cogs.margin'))}</div><div class="art-stat-value">${t.revenue ? t.margin.toFixed(1)+'%' : '-'}</div></div>
        </div>

        <div class="art-table-wrap">
          <table class="art-table pnl-table">
            <thead><tr><th>${esc(T('fin.statement'))}</th><th class="num">${esc(T('ox.amount'))}</th><th class="num">${esc(T('fin.ofRevenue'))}</th></tr></thead>
            <tbody>
              ${line(T('fin.revenue'), t.revenue, { cls:'pnl-head' })}
              ${line(T('acct.cogs'), t.cogs, { indent:true, neg:true })}
              ${line(T('cogs.profit'), t.gross, { cls:'pnl-sub' })}
              <tr class="pnl-gap"><td colspan="3">${esc(T('fin.sellingExp'))}</td></tr>
              ${line(T('cogs.pfee'), t.pfee, { indent:true, neg:true })}
              ${line(T('cogs.dfee'), t.dfee, { indent:true, neg:true })}
              ${line(T('se.other'), t.ofee, { indent:true, neg:true })}
              ${line(T('cogs.commission'), t.comm, { indent:true, neg:true })}
              ${line(T('fin.afterSelling'), t.gross - t.selling, { cls:'pnl-sub' })}
              <tr class="pnl-gap"><td colspan="3">${esc(T('nav.opExpense'))}</td></tr>
              ${Object.keys(opexByCat).length
                  ? Object.keys(opexByCat).map(k=> line(dispName('expenseCategories', k) || k, opexByCat[k], { indent:true, neg:true })).join('')
                  : `<tr><td class="pnl-indent setting-desc" colspan="3">${esc(T('fin.noOpex'))}</td></tr>`}
              ${line(T('fin.netProfit'), t.net, { cls:'pnl-total' })}
            </tbody>
          </table>
        </div>

        <div class="acct-summary" style="grid-template-columns:1fr 1fr;">
          <div class="acct-summary-chart">
            <h4 class="art-form-section" style="margin-top:0;">${esc(T('fin.revTrend'))}</h4>
            ${acctBarsHtml(revBars)}
          </div>
          <div class="acct-summary-chart">
            <h4 class="art-form-section" style="margin-top:0;">${esc(T('fin.netTrend'))}</h4>
            ${acctBarsHtml(netBars)}
            <p class="setting-desc" style="margin:8px 0 0;">${esc(T('fin.trendHint'))}</p>
          </div>
        </div>

        <h4 class="art-form-section">${esc(T('fin.byMonth'))}</h4>
        <div class="art-table-wrap">
          <table class="art-table">
            <thead><tr><th>${esc(T('fin.month'))}</th><th class="num">${esc(T('cogs.revenue'))}</th><th class="num">${esc(T('acct.cogs'))}</th><th class="num">${esc(T('nav.opExpense'))}</th><th class="num">${esc(T('fin.netProfit'))}</th><th class="num">${esc(T('cogs.margin'))}</th></tr></thead>
            <tbody>${months.slice().reverse().map(m=> `
              <tr>
                <td>${esc(m.key)}</td>
                <td class="num">${fmtD(m.revenue)}</td>
                <td class="num">${fmtD(m.cogs)}</td>
                <td class="num">${fmtD(m.opex)}</td>
                <td class="num ${m.net<0?'art-pending-due':'art-profit'}">${fmtD(m.net)}</td>
                <td class="num">${m.revenue ? (m.net/m.revenue*100).toFixed(1)+'%' : '-'}</td>
              </tr>`).join('')}</tbody>
          </table>
        </div>
      </div>`;
  }

  /* ---- Cash Flow: when money actually moved ---- */
  function finCash(body){
    const t = finTotals();
    const moves = [];
    t.bills.forEach(b=>{ if(b.cashIn > 0) moves.push({ date: b.o.date, type:'in', label: T('fin.mCustomer') + ' \u00B7 ' + (b.o.invoiceNumber || ''), who: b.o.customerName || '', amount: b.cashIn }); });
    t.stock.forEach(x=>{ if(x.paid > 0) moves.push({ date: x.e.date, type:'out', label: T('fin.mSupplier') + ' \u00B7 ' + (x.e.productName || ''), who: x.e.origin || '', amount: x.paid }); });
    t.ox.forEach(e=> moves.push({ date: e.date, type:'out', label: (dispName('expenseCategories', e.category) || '') + (e.details ? ' \u00B7 ' + e.details : ''), who: dispName('paymentModes', e.method) || '', amount: Number(e.amount)||0 }));
    moves.sort((a,b)=> String(b.date||'').localeCompare(String(a.date||'')));
    const inTotal = moves.filter(m=> m.type==='in').reduce((s,m)=> s + m.amount, 0);
    const outTotal = moves.filter(m=> m.type==='out').reduce((s,m)=> s + m.amount, 0);

    const months = finMonths(6);
    const inBars = months.map(k=> ({ name:k, value: Math.round(orders.filter(o=> finMonthKey(o.date)===k).map(finBill).reduce((s,b)=> s + b.cashIn, 0)), color:'#6B8F71' }));
    const outBars = months.map(k=> {
      const st = finStockIn().filter(x=> finMonthKey(x.e.date)===k).reduce((s,x)=> s + x.paid, 0);
      const ox = opex.filter(e=> finMonthKey(e.date)===k).reduce((s,e)=> s + (Number(e.amount)||0), 0);
      return { name:k, value: Math.round(st + ox), color:'#C6432E' };
    });

    body.innerHTML = `
      <div class="panel">
        ${finToolbar()}
        <div class="art-sum-cards">
          <div class="art-stat-card"><div class="art-stat-label">${esc(T('fin.cashIn'))}</div><div class="art-stat-value art-profit">${fmtD(inTotal)} ฿</div></div>
          <div class="art-stat-card"><div class="art-stat-label">${esc(T('fin.cashOut'))}</div><div class="art-stat-value art-pending-due">${fmtD(outTotal)} ฿</div></div>
          <div class="art-stat-card"><div class="art-stat-label">${esc(T('fin.cashNet'))}</div><div class="art-stat-value ${(inTotal-outTotal)<0?'art-pending-due':'art-profit'}">${fmtD(inTotal-outTotal)} ฿</div></div>
          <div class="art-stat-card"><div class="art-stat-label">${esc(T('fin.vsProfit'))}</div><div class="art-stat-value" style="font-size:16px;">${fmtD((inTotal-outTotal) - t.net)} ฿</div></div>
        </div>

        <div class="acct-summary" style="grid-template-columns:1fr 1fr;">
          <div class="acct-summary-chart">
            <h4 class="art-form-section" style="margin-top:0;">${esc(T('fin.inTrend'))}</h4>
            ${acctBarsHtml(inBars)}
          </div>
          <div class="acct-summary-chart">
            <h4 class="art-form-section" style="margin-top:0;">${esc(T('fin.outTrend'))}</h4>
            ${acctBarsHtml(outBars)}
            <p class="setting-desc" style="margin:8px 0 0;">${esc(T('fin.cashHint'))}</p>
          </div>
        </div>

        <div class="art-table-wrap">
          <table class="art-table">
            <thead><tr><th>${esc(T('exp.date'))}</th><th>${esc(T('fin.movement'))}</th><th>${esc(T('fin.party'))}</th><th class="num">${esc(T('fin.in'))}</th><th class="num">${esc(T('fin.out'))}</th></tr></thead>
            <tbody>${moves.length ? moves.map(m=> `
              <tr>
                <td>${esc(m.date||'-')}</td>
                <td>${esc(m.label)}</td>
                <td>${esc(m.who)}</td>
                <td class="num art-profit">${m.type==='in' ? fmtD(m.amount) : '-'}</td>
                <td class="num art-pending-due">${m.type==='out' ? fmtD(m.amount) : '-'}</td>
              </tr>`).join('') : `<tr><td colspan="5" class="art-empty">${esc(T('fin.noMoves'))}</td></tr>`}
            </tbody>
            <tfoot><tr><td colspan="3">${esc(T('rev.totalRows'))} (${moves.length})</td><td class="num">${fmtD(inTotal)}</td><td class="num">${fmtD(outTotal)}</td></tr></tfoot>
          </table>
        </div>
      </div>`;
  }

  /* ---- Customer Document ----
   * A standing remark that is printed on EVERY document produced from Sell
   * Management (receipt, billing note, tax invoice…). Kept on the config so it
   * travels with the business profile.
   */
  function renderCustomerDoc(body){
    const note = (config.docNote != null) ? config.docNote : '';
    body.innerHTML = `
      <div class="panel">
        <h4 class="art-form-section" style="margin-top:0;">${esc(T('cd.noteTitle'))}</h4>
        <p class="setting-desc" style="margin-top:-6px;">${esc(T('cd.noteHint'))}</p>
        <textarea id="cdNote" rows="5" style="width:100%;" placeholder="${esc(T('cd.notePh'))}">${esc(note)}</textarea>
        <div class="art-modal-actions" style="justify-content:flex-start;">
          <button class="btn btn-primary" id="cdSave">${esc(T('save'))}</button>
          <span class="ap-dirty" id="cdSaved" style="display:none;">${esc(T('cd.saved'))}</span>
        </div>
        <h4 class="art-form-section">${esc(T('cd.previewTitle'))}</h4>
        <p class="setting-desc" style="margin-top:-6px;">${esc(T('cd.previewHint'))}</p>
        <div class="cd-preview" id="cdPreview">${note ? esc(note).replace(/\n/g,'<br>') : `<span class="setting-desc">${esc(T('cd.previewEmpty'))}</span>`}</div>
      </div>`;
    const ta = body.querySelector('#cdNote');
    ta.addEventListener('input', ()=>{
      const pv = body.querySelector('#cdPreview');
      pv.innerHTML = ta.value.trim() ? esc(ta.value).replace(/\n/g,'<br>') : `<span class="setting-desc">${esc(T('cd.previewEmpty'))}</span>`;
    });
    body.querySelector('#cdSave').addEventListener('click', async ()=>{
      config.docNote = ta.value.trim();
      await saveConfig();
      const flag = body.querySelector('#cdSaved');
      flag.style.display = '';
      setTimeout(()=>{ flag.style.display = 'none'; }, 1800);
    });
  }

  /* ---- Sales tax report ----
   * Only bills TICKED as VAT belong in the report; the untaxed ones are one
   * click away so nothing is invisible (and mis-ticks are easy to spot).
   */
  let finTaxMode = 'vat';   // 'vat' | 'novat'
  function finTax(body){
    const wantVat = finTaxMode === 'vat';
    const rows = orders
      .filter(o=> finInRange(o.date))
      .filter(o=> wantVat ? !!o.vatable : !o.vatable)
      .map(o=>{
        const co = computeOrder(o);
        const base = o.vatable
          ? (co.vatBase != null ? co.vatBase : co.netBase)
          : (co.netBase != null ? co.netBase : co.net);
        return { o, co, base, vat: co.vat || 0 };
      })
      .sort((a,b)=> String(a.o.date||'').localeCompare(String(b.o.date||'')));   // filing order: oldest first
    const totalBase = rows.reduce((s2,r)=> s2 + r.base, 0);
    const totalVat = rows.reduce((s2,r)=> s2 + r.vat, 0);

    // Month-by-month summary — the shape a filing form wants.
    const byMonth = {};
    rows.forEach(r=>{
      const k = finMonthKey(r.o.date);
      if(!byMonth[k]) byMonth[k] = { base:0, vat:0, n:0 };
      byMonth[k].base += r.base; byMonth[k].vat += r.vat; byMonth[k].n++;
    });
    const biz = config.business || {};

    body.innerHTML = `
      <div class="panel">
        ${finToolbar()}
        <div class="art-toolbar" style="padding-top:0;">
          <div class="del-seg" id="taxMode">
            <button type="button" class="del-seg-btn ${wantVat?'active':''}" data-m="vat">${esc(T('tax.modeVat'))}</button>
            <button type="button" class="del-seg-btn ${wantVat?'':'active'}" data-m="novat">${esc(T('tax.modeNoVat'))}</button>
          </div>
          <div class="art-spacer"></div>
          <span class="inv-summary">${esc(T('tax.issuer'))}: <b>${esc(biz.name || '-')}</b>${biz.taxId?' \u00B7 '+esc(biz.taxId):''}${biz.branch?' \u00B7 '+esc(biz.branch):''}</span>
        </div>

        <div class="art-sum-cards">
          <div class="art-stat-card"><div class="art-stat-label">${esc(wantVat ? T('tax.invoices') : T('tax.billsNoVat'))}</div><div class="art-stat-value">${rows.length}</div></div>
          <div class="art-stat-card"><div class="art-stat-label">${esc(T('tax.base'))}</div><div class="art-stat-value">${fmtD(totalBase)} ฿</div></div>
          <div class="art-stat-card"><div class="art-stat-label">${esc(T('tax.output'))}</div><div class="art-stat-value ${wantVat?'art-profit':''}">${fmtD(totalVat)} ฿</div></div>
          <div class="art-stat-card"><div class="art-stat-label">${esc(T('tax.grand'))}</div><div class="art-stat-value">${fmtD(totalBase + totalVat)} ฿</div></div>
        </div>
        <p class="setting-desc">${esc(wantVat ? T('tax.hint') : T('tax.hintNoVat'))}</p>

        ${wantVat && Object.keys(byMonth).length ? `
        <h4 class="art-form-section">${esc(T('tax.byMonth'))}</h4>
        <div class="art-table-wrap">
          <table class="art-table">
            <thead><tr><th>${esc(T('fin.month'))}</th><th class="num">${esc(T('tax.invoices'))}</th><th class="num">${esc(T('tax.base'))}</th><th class="num">${esc(T('tax.output'))}</th><th class="num">${esc(T('tax.grand'))}</th></tr></thead>
            <tbody>${Object.keys(byMonth).sort().map(k=> `
              <tr><td>${esc(k)}</td><td class="num">${byMonth[k].n}</td><td class="num">${fmtD(byMonth[k].base)}</td><td class="num">${fmtD(byMonth[k].vat)}</td><td class="num">${fmtD(byMonth[k].base + byMonth[k].vat)}</td></tr>`).join('')}</tbody>
          </table>
        </div>` : ''}

        <h4 class="art-form-section">${esc(wantVat ? T('tax.detail') : T('tax.detailNoVat'))}</h4>
        <div class="art-table-wrap">
          <table class="art-table">
            <thead><tr>
              <th class="num">#</th><th>${esc(T('exp.date'))}</th><th>${esc(T('rev.invoiceNo'))}</th>
              <th>${esc(T('rev.customer'))}</th><th>${esc(T('rev.platform'))}</th>
              <th class="num">${esc(T('tax.base'))}</th><th class="num">${esc(T('tax.output'))}</th><th class="num">${esc(T('tax.grand'))}</th>
              <th>${esc(T('fin.note'))}</th><th></th>
            </tr></thead>
            <tbody>${rows.length ? rows.map((r,i)=> `
              <tr data-id="${esc(r.o.id)}">
                <td class="num">${i+1}</td>
                <td>${esc(r.o.date||'-')}</td>
                <td class="art-id">${esc(r.o.invoiceNumber||'-')}</td>
                <td>${esc(r.o.customerName||'-')}</td>
                <td>${esc(dispName('platforms', r.o.platform) || '-')}</td>
                <td class="num">${fmtD(r.base)}</td>
                <td class="num ${r.vat?'art-profit':''}">${fmtD(r.vat)}</td>
                <td class="num" style="font-weight:700;">${fmtD(r.base + r.vat)}</td>
                <td>${r.o.docSplit === 'split' ? `<span class="art-pill" style="background:#9B8B78">${esc(T('doc.splitShort'))}</span>` : ''}</td>
                <td><button class="acc-icon tax-doc" title="${esc(T('doc.tx.title'))}">\u{1F4C4}</button></td>
              </tr>`).join('') : `<tr><td colspan="10" class="art-empty">${esc(T('tax.empty'))}</td></tr>`}
            </tbody>
            <tfoot><tr><td colspan="5">${esc(T('rev.totalRows'))} (${rows.length})</td><td class="num">${fmtD(totalBase)}</td><td class="num">${fmtD(totalVat)}</td><td class="num">${fmtD(totalBase+totalVat)}</td><td colspan="2"></td></tr></tfoot>
          </table>
        </div>
      </div>`;

    body.querySelectorAll('#taxMode [data-m]').forEach(btn=> btn.addEventListener('click', ()=>{
      finTaxMode = btn.dataset.m;
      renderFinPage(body, 'tax');
    }));
    body.querySelectorAll('tr[data-id]').forEach(tr=>{
      const o = orders.find(x=> x.id === tr.dataset.id);
      const btn = tr.querySelector('.tax-doc');
      if(o && btn) btn.addEventListener('click', ()=> openDocMaker(o, body, ()=> renderFinPage(body, 'tax')));
    });
  }

  // ---- Operational Expense -------------------------------------------------
  // A running list of day-to-day costs. Type a row, press Add, it is saved.
  let opexFilter = { from:'', to:'', cat:'all' };
  let opexEditing = null;   // id of the row currently open for editing
  function opexCatColor(name){ return ((config.expenseCategories||[]).find(c=> c.name === name) || {}).color || '#8A8F80'; }
  function renderOpExpense(body){
    const f = opexFilter;
    const cats = config.expenseCategories || [];
    const rows = opex
      .filter(e=> (!f.from || (e.date||'') >= f.from) && (!f.to || (e.date||'') <= f.to))
      .filter(e=> f.cat === 'all' || e.category === f.cat)
      .slice()
      .sort((a,b)=> String(b.date||'').localeCompare(String(a.date||'')) || String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
    const total = rows.reduce((sm,e)=> sm + (Number(e.amount)||0), 0);
    const byCat = {};
    rows.forEach(e=>{ const k = e.category || T('sum.uncategorised'); byCat[k] = (byCat[k]||0) + (Number(e.amount)||0); });
    const donutItems = Object.keys(byCat).map(n=> ({ name: dispName('expenseCategories', n) || n, value: Math.round(byCat[n]), color: opexCatColor(n) })).sort((a,b)=> b.value - a.value);
    const biggest = donutItems.length ? donutItems[0] : null;
    const today = (window.localIso ? window.localIso() : new Date().toISOString().slice(0,10));

    body.innerHTML = `
      <div class="panel">
        <div class="art-toolbar">
          <div class="art-field"><label>${esc(T('exp.from'))}</label><input type="date" id="oxFrom" value="${esc(f.from)}"></div>
          <div class="art-field"><label>${esc(T('exp.to'))}</label><input type="date" id="oxTo" value="${esc(f.to)}"></div>
          <div class="art-field"><label>${esc(T('ox.category'))}</label>
            <select id="oxCatFilter">
              <option value="all">${esc(T('exp.all'))}</option>
              ${cats.map(c=> `<option value="${esc(c.name)}" ${f.cat===c.name?'selected':''}>${esc(itemLabel(c))}</option>`).join('')}
            </select>
          </div>
          <button class="btn btn-ghost" id="oxClear">${esc(T('exp.clearFilter'))}</button>
        </div>

        <div class="art-sum-cards">
          <div class="art-stat-card"><div class="art-stat-label">${esc(T('ox.count'))}</div><div class="art-stat-value">${rows.length}</div></div>
          <div class="art-stat-card"><div class="art-stat-label">${esc(T('ox.total'))}</div><div class="art-stat-value art-pending-due">${fmtD(total)} \u0E3F</div></div>
          <div class="art-stat-card"><div class="art-stat-label">${esc(T('ox.avg'))}</div><div class="art-stat-value">${fmtD(rows.length ? total/rows.length : 0)} \u0E3F</div></div>
          <div class="art-stat-card"><div class="art-stat-label">${esc(T('ox.biggest'))}</div><div class="art-stat-value" style="font-size:16px;">${biggest ? esc(biggest.name) : '-'}</div></div>
        </div>

        <div class="acct-summary" style="grid-template-columns:minmax(260px,380px) 1fr;">
          <div class="acct-summary-chart">
            <h4 class="art-form-section" style="margin-top:0;">${esc(T('ox.byCat'))}</h4>
            ${acctDonutHtml(donutItems, fmt(Math.round(total)), T('ox.short'))}
          </div>
          <div class="acct-summary-stats">
            <h4 class="art-form-section" style="margin-top:0;">${esc(T('ox.addTitle'))}</h4>
            <div class="ox-add">
              <input type="date" id="oxNewDate" value="${esc(today)}">
              <select id="oxNewCat">${cats.map(c=> `<option value="${esc(c.name)}">${esc(itemLabel(c))}</option>`).join('')}</select>
              <input type="text" id="oxNewDesc" placeholder="${esc(T('ox.descPh'))}">
              <select id="oxNewPay">${(config.paymentModes||[]).map(m=> `<option value="${esc(m.name)}">${esc(itemLabel(m))}</option>`).join('')}</select>
              <input type="number" id="oxNewAmt" step="0.01" min="0" placeholder="0">
              <button class="btn btn-primary" id="oxAdd">${esc(T('ox.add'))}</button>
            </div>
            <p class="setting-desc">${esc(T('ox.addHint'))}</p>
          </div>
        </div>

        <div class="art-table-wrap">
          <table class="art-table">
            <thead><tr>
              <th>${esc(T('exp.date'))}</th><th>${esc(T('ox.category'))}</th><th>${esc(T('ox.details'))}</th>
              <th>${esc(T('pay.mode'))}</th><th class="num">${esc(T('ox.amount'))}</th>
              <th>${esc(T('ox.receipt'))}</th><th>${esc(T('ox.updatedBy'))}</th><th></th>
            </tr></thead>
            <tbody>${rows.length ? rows.map(e=>{
              const editing = opexEditing === e.id && !e.auto;
              return `
              <tr data-id="${esc(e.id)}" class="${editing?'ox-editing':''}">
                <td>${editing
                  ? `<input type="date" class="ox-inp ox-date" value="${esc(e.date||'')}">`
                  : esc(e.date||'-')}</td>
                <td>${editing
                  ? `<select class="art-inline-sel ox-cat" style="background:${opexCatColor(e.category)};">${cats.map(c=> `<option value="${esc(c.name)}" ${e.category===c.name?'selected':''}>${esc(itemLabel(c))}</option>`).join('')}</select>`
                  : `<span class="art-pill" style="background:${opexCatColor(e.category)}">${esc(dispName('expenseCategories', e.category) || '-')}</span>`}</td>
                <td>${editing
                  ? `<input type="text" class="ox-inp ox-desc" value="${esc(e.details||'')}" placeholder="${esc(T('ox.descPh'))}">`
                  : esc(e.details || '-')}</td>
                <td>${editing
                  ? `<select class="art-inline-sel ox-pay">${(config.paymentModes||[]).map(m=> `<option value="${esc(m.name)}" ${e.method===m.name?'selected':''}>${esc(itemLabel(m))}</option>`).join('')}</select>`
                  : esc(dispName('paymentModes', e.method) || '-')}</td>
                <td class="num">${editing
                  ? `<input type="number" class="se-inp ox-amt" value="${e.amount || ''}" step="0.01" min="0" placeholder="0">`
                  : `<b>${fmtD(e.amount)}</b>`}</td>
                <td><button class="acc-icon ox-proof ${(e.proofs&&e.proofs.length)?'has-proof':'is-empty'}" title="${esc(T('ox.receipt'))}">\u{1F4CE}${(e.proofs&&e.proofs.length)?' '+e.proofs.length:''}</button></td>
                <td class="art-edited">${esc(e.updatedBy || e.by || '-')}${e.updatedAt ? '<div class="ap-by">'+esc(_fmtEditedAt(e.updatedAt))+'</div>' : ''}</td>
                <td><div class="art-row-actions">
                  ${e.auto
                    ? `<span class="art-set-lock" title="${esc(T('ox.autoRow'))}">\u{1F512}</span>`
                    : (editing
                      ? `<button class="btn btn-primary btn-sm ox-save">${esc(T('save'))}</button><button class="acc-icon ox-cancel" title="${esc(T('cancel'))}">\u2715</button>`
                      : `<button class="acc-icon ox-edit" title="${esc(T('edit'))}">\u270E</button><button class="acc-icon ox-del" title="${esc(T('delete'))}">\u2715</button>`)}
                </div></td>
              </tr>`; }).join('') : `<tr><td colspan="8" class="art-empty">${esc(T('ox.empty'))}</td></tr>`}
            </tbody>
            <tfoot><tr><td colspan="4">${esc(T('rev.totalRows'))} (${rows.length})</td><td class="num">${fmtD(total)}</td><td colspan="3"></td></tr></tfoot>
          </table>
        </div>
      </div>`;

    const redraw = ()=> renderOpExpense(body);
    body.querySelector('#oxFrom').addEventListener('change', ev=>{ f.from = ev.target.value; redraw(); });
    body.querySelector('#oxTo').addEventListener('change', ev=>{ f.to = ev.target.value; redraw(); });
    body.querySelector('#oxCatFilter').addEventListener('change', ev=>{ f.cat = ev.target.value; redraw(); });
    body.querySelector('#oxClear').addEventListener('click', ()=>{ opexFilter = { from:'', to:'', cat:'all' }; redraw(); });

    const addRow = async ()=>{
      const amt = parseFloat(body.querySelector('#oxNewAmt').value) || 0;
      const desc = body.querySelector('#oxNewDesc').value.trim();
      if(amt <= 0){ alert(T('ox.errAmount')); return; }
      const rec = {
        id: rid(),
        date: body.querySelector('#oxNewDate').value || today,
        category: body.querySelector('#oxNewCat').value,
        details: desc,
        method: body.querySelector('#oxNewPay').value,
        amount: amt,
        proofs: [],
        by: sellerNameOf(),
        updatedBy: sellerNameOf(),
        updatedAt: new Date().toISOString(),
        createdAt: new Date().toISOString()
      };
      opex.push(rec);
      await saveOpex();
      logRec(opexLog, saveOpexLog, rec.id, opexLabel(rec), 'create', rec);
      body.querySelector('#oxNewDesc').value = '';
      body.querySelector('#oxNewAmt').value = '';
      redraw();
    };
    body.querySelector('#oxAdd').addEventListener('click', addRow);
    body.querySelector('#oxNewAmt').addEventListener('keydown', ev=>{ if(ev.key === 'Enter') addRow(); });
    body.querySelector('#oxNewDesc').addEventListener('keydown', ev=>{ if(ev.key === 'Enter') addRow(); });

    // A row is read-only until Edit is pressed; Save writes it and logs the change.
    body.querySelectorAll('tr[data-id]').forEach(tr=>{
      const e = opex.find(x=> x.id === tr.dataset.id);
      if(!e) return;
      const editBtn = tr.querySelector('.ox-edit');
      if(editBtn) editBtn.addEventListener('click', ()=>{ opexEditing = e.id; redraw(); });
      const cancelBtn = tr.querySelector('.ox-cancel');
      if(cancelBtn) cancelBtn.addEventListener('click', ()=>{ opexEditing = null; redraw(); });
      const saveBtn = tr.querySelector('.ox-save');
      if(saveBtn) saveBtn.addEventListener('click', async ()=>{
        const before = JSON.parse(JSON.stringify(e));
        e.date = tr.querySelector('.ox-date').value || e.date;
        e.category = tr.querySelector('.ox-cat').value;
        e.details = tr.querySelector('.ox-desc').value.trim();
        e.method = tr.querySelector('.ox-pay').value;
        e.amount = parseFloat(tr.querySelector('.ox-amt').value) || 0;
        e.updatedBy = sellerNameOf();
        e.updatedAt = new Date().toISOString();
        await saveOpex();
        if(JSON.stringify(before) !== JSON.stringify(e)) logRec(opexLog, saveOpexLog, e.id, opexLabel(e), 'edit', e);
        opexEditing = null;
        redraw();
      });
      tr.querySelector('.ox-proof').addEventListener('click', ()=> openOpexProof(e, redraw));
      const delBtn = tr.querySelector('.ox-del');
      if(delBtn) delBtn.addEventListener('click', ()=>{
        confirmModal(T('delete'), T('ox.delConfirm'), async ()=>{
          logRec(opexLog, saveOpexLog, e.id, opexLabel(e), 'delete', e);
          opex = opex.filter(x=> x.id !== e.id);
          await saveOpex();
          redraw();
        });
      });
    });
  }
  // Payroll posts its authorized months here as operating expenses. The entry is
  // keyed by `ref` so authorising twice updates one row instead of stacking rows,
  // and unauthorising removes it again.
  function payrollCategoryName(){
    const c = (config.expenseCategories || []).find(x=> x.role === 'payroll');
    return c ? c.name : 'Payroll';
  }
  window.postPayrollExpense = async function(monthKey, amount, by){
    const ref = 'payroll:' + monthKey;
    const date = window.monthBounds(monthKey).to;      // booked at month end
    const label = T('ox.payrollOf').replace('{m}', window.monthLabel(monthKey));
    const now = new Date().toISOString();
    const existing = opex.find(e=> e.ref === ref);
    if(existing){
      Object.assign(existing, { date, category: payrollCategoryName(), details: label, amount: Number(amount) || 0, updatedBy: by || '', updatedAt: now });
      logRec(opexLog, saveOpexLog, existing.id, opexLabel(existing), 'edit', existing);
    }else{
      const rec = { id: rid(), date, category: payrollCategoryName(), details: label, method: '',
                    amount: Number(amount) || 0, proofs: [], ref, auto: true,
                    by: by || '', updatedBy: by || '', updatedAt: now, createdAt: now };
      opex.push(rec);
      logRec(opexLog, saveOpexLog, rec.id, opexLabel(rec), 'create', rec);
    }
    await saveOpex();
  };
  window.removePayrollExpense = async function(monthKey){
    const ref = 'payroll:' + monthKey;
    const rec = opex.find(e=> e.ref === ref);
    if(!rec) return;
    logRec(opexLog, saveOpexLog, rec.id, opexLabel(rec), 'delete', rec);
    opex = opex.filter(e=> e.ref !== ref);
    await saveOpex();
  };
  function openOpexProof(entry, onDone){
    let list = Array.isArray(entry.proofs) ? entry.proofs.slice(0,5) : [];
    const ov = document.createElement('div');
    ov.className = 'art-modal-overlay show';
    ov.innerHTML = `<div class="art-modal" style="max-width:560px;">
      <h3 class="art-modal-title">${esc(T('ox.receipt'))}</h3>
      <p class="setting-desc" style="margin:-4px 0 12px;">${esc(T('pay.proofHint'))}</p>
      <div class="pi-grid" id="oxGrid"></div>
      <div class="art-modal-actions">
        <button class="btn btn-ghost" id="oxPfCancel">${esc(T('cancel'))}</button>
        <button class="btn btn-primary" id="oxPfOk">${esc(T('save'))}</button>
      </div>
    </div>`;
    document.body.appendChild(ov);
    const grid = ov.querySelector('#oxGrid');
    function draw(){
      grid.innerHTML = list.map((fl,i)=> `<span class="pi-thumb"><img src="${esc(fl.src)}" alt=""><button type="button" class="pi-rm" data-j="${i}">\u2715</button></span>`).join('')
        + (list.length < 5 ? `<label class="pi-add"><input type="file" class="ox-inp-file" accept="image/*" multiple><span>+</span></label>` : '');
      grid.querySelectorAll('.pi-rm').forEach(b=> b.addEventListener('click', ()=>{ list.splice(+b.dataset.j, 1); draw(); }));
      const inp = grid.querySelector('.ox-inp-file');
      if(inp) inp.addEventListener('change', (ev)=>{
        Array.from(ev.target.files || []).forEach(file=>{
          if(list.length >= 5) return;
          if(file.size > 256*1024){ alert(T('bill.tooBig')); return; }
          const rd = new FileReader();
          rd.onload = ()=>{ if(list.length < 5){ list.push({ src: rd.result, name: file.name || '' }); draw(); } };
          rd.readAsDataURL(file);
        });
      });
      grid.querySelectorAll('.pi-thumb img').forEach((im,i)=> im.addEventListener('click', ()=> openProofs([list[i]], entry.details)));
    }
    draw();
    const close = ()=> ov.remove();
    ov.addEventListener('click', ev=>{ if(ev.target === ov) close(); });
    ov.querySelector('#oxPfCancel').addEventListener('click', close);
    ov.querySelector('#oxPfOk').addEventListener('click', async ()=>{
      entry.proofs = list.slice(0,5);
      entry.updatedBy = sellerNameOf();
      entry.updatedAt = new Date().toISOString();
      await saveOpex();
      logRec(opexLog, saveOpexLog, entry.id, opexLabel(entry), 'edit', entry);
      close();
      if(typeof onDone === 'function') onDone();
    });
  }

  // ---- Accounts Payable ----------------------------------------------------
  // Every stock-in is money owed to a supplier. Edits here are held in a DRAFT
  // and only written to the stock log when the user presses Save.
  const AP_STATES = ['unpaid', 'partial', 'paid'];
  const AP_COLORS = { unpaid:'#C6432E', partial:'#E0A100', paid:'#6B8F71' };
  let apFilter = { from:'', to:'', status:'all', origin:'all', product:'all', cat:'all' };
  let apDraft = {};          // { [stockLogId]: { status, proofs } }
  const apAmountOf = (e)=> (Number(e.cost)||0) * (e.qty||0);
  function apOf(e){
    const d = apDraft[e.id];
    if(d) return d;
    const a = e.ap || {};
    return {
      status: a.status || 'unpaid',
      proofs: Array.isArray(a.proofs) ? a.proofs : [],
      paid: a.paid != null ? Number(a.paid) : (a.status === 'paid' ? apAmountOf(e) : 0),
      statusBy: a.statusBy || '',
      statusAt: a.statusAt || '',
      verified: !!e.verified,
      verifiedBy: e.verifiedBy || ''
    };
  }
  function apTouch(e, patch){
    apDraft[e.id] = Object.assign({}, apOf(e), patch);
  }
  function renderApPage(body){
    const f = apFilter;
    const rows = stockLog
      .filter(e=> (e.qty||0) > 0)                       // stock coming IN
      .filter(e=> (!f.from || (e.date||'') >= f.from) && (!f.to || (e.date||'') <= f.to))
      .filter(e=> f.status === 'all' || apOf(e).status === f.status)
      .filter(e=> f.origin === 'all' || (e.origin || '') === f.origin)
      .filter(e=> f.product === 'all' || (e.productName || '') === f.product)
      .filter(e=> f.cat === 'all' || (e.productType || '') === f.cat)
      .slice()
      .sort((a,b)=> String(b.createdAt||b.date||'').localeCompare(String(a.createdAt||a.date||'')));
    const dirty = Object.keys(apDraft).length > 0;
    const total = rows.reduce((sm,e)=> sm + apAmountOf(e), 0);
    const paidSum = rows.reduce((sm,e)=> sm + Math.min(apOf(e).paid || 0, apAmountOf(e)), 0);
    const owed = total - paidSum;
    const canVerify = (typeof window.roleCanAccess !== 'function') || window.roleCanAccess(window.currentRole, 'verifyStock');
    // Filter choices come from the entries themselves.
    const allIn = stockLog.filter(e=> (e.qty||0) > 0);
    const origins = [...new Set(allIn.map(e=> e.origin).filter(Boolean))].sort();
    const productNames = [...new Set(allIn.map(e=> e.productName).filter(Boolean))].sort();

    body.innerHTML = `
      <div class="panel">
        <div class="art-toolbar">
          <div class="art-field"><label>${esc(T('exp.from'))}</label><input type="date" id="apFrom" value="${esc(f.from)}"></div>
          <div class="art-field"><label>${esc(T('exp.to'))}</label><input type="date" id="apTo" value="${esc(f.to)}"></div>
          <div class="art-field"><label>${esc(T('ap.status'))}</label>
            <select id="apStatusFilter">
              <option value="all" ${f.status==='all'?'selected':''}>${esc(T('exp.all'))}</option>
              ${AP_STATES.map(st=> `<option value="${st}" ${f.status===st?'selected':''}>${esc(T('ap.'+st))}</option>`).join('')}
            </select>
          </div>
          <div class="art-field"><label>${esc(T('sh.origin'))}</label>
            <select id="apOrigin"><option value="all">${esc(T('exp.all'))}</option>${origins.map(o=> `<option value="${esc(o)}" ${f.origin===o?'selected':''}>${esc(o)}</option>`).join('')}</select>
          </div>
          <div class="art-field"><label>${esc(T('sh.product'))}</label>
            <select id="apProduct"><option value="all">${esc(T('exp.all'))}</option>${productNames.map(o=> `<option value="${esc(o)}" ${f.product===o?'selected':''}>${esc(o)}</option>`).join('')}</select>
          </div>
          <div class="art-field"><label>${esc(T('prod.ptype'))}</label>
            <select id="apCat"><option value="all">${esc(T('exp.all'))}</option>${(config.productTypes||[]).map(t=> `<option value="${esc(t.name)}" ${f.cat===t.name?'selected':''}>${esc(itemLabel(t))}</option>`).join('')}</select>
          </div>
          <button class="btn btn-ghost" id="apClear">${esc(T('exp.clearFilter'))}</button>
          <div class="art-spacer"></div>
          ${dirty ? `<span class="ap-dirty">${esc(T('ap.unsaved'))}</span>` : ''}
          <button class="btn btn-ghost" id="apMass" ${rows.length?'':'disabled'}>${esc(T('ap.mass'))} (${rows.length})</button>
          <button class="btn btn-primary" id="apSave" ${dirty?'':'disabled'}>${esc(T('save'))}</button>
        </div>

        <div class="art-sum-cards">
          <div class="art-stat-card"><div class="art-stat-label">${esc(T('ap.entries'))}</div><div class="art-stat-value">${rows.length}</div></div>
          <div class="art-stat-card"><div class="art-stat-label">${esc(T('ap.total'))}</div><div class="art-stat-value">${fmtD(total)} \u0E3F</div></div>
          <div class="art-stat-card"><div class="art-stat-label">${esc(T('ap.owed'))}</div><div class="art-stat-value art-pending-due">${fmtD(owed)} \u0E3F</div></div>
          <div class="art-stat-card"><div class="art-stat-label">${esc(T('ap.settled'))}</div><div class="art-stat-value art-profit">${fmtD(total - owed)} \u0E3F</div></div>
        </div>

        <div class="art-table-wrap">
          <table class="art-table">
            <thead><tr>
              <th>${esc(T('rst.date'))}</th><th>${esc(T('sh.product'))}</th><th>${esc(T('sh.ptype'))}</th>
              <th class="num">${esc(T('sh.qtyAdded'))}</th><th>${esc(T('sh.origin'))}</th>
              <th class="num">${esc(T('sh.cost'))}</th><th class="num">${esc(T('ap.amount'))}</th>
              <th>${esc(T('sh.signature'))}</th><th>${esc(T('sh.bill'))}</th><th>${esc(T('sh.verified'))}</th>
              <th>${esc(T('ap.proof'))}</th><th class="num">${esc(T('ap.paidAmount'))}</th><th>${esc(T('ap.status'))}</th>
            </tr></thead>
            <tbody>${rows.length ? rows.map(e=>{
              const ap = apOf(e);
              const amount = (Number(e.cost)||0) * (e.qty||0);
              const changed = !!apDraft[e.id];
              return `<tr data-id="${esc(e.id)}" class="${changed?'ap-changed':''}">
                <td>${esc(e.date||'-')}</td>
                <td>${esc(e.productName||'-')}</td>
                <td>${esc(dispName('productTypes', e.productType) || '-')}</td>
                <td class="num">${e.qty||0}</td>
                <td><span class="art-pill" style="background:${originColor(e.origin)}">${esc(e.origin||'-')}</span></td>
                <td class="num">${fmtD(e.cost)}</td>
                <td class="num" style="font-weight:700;">${fmtD(amount)}</td>
                <td>${esc(e.signature||'-')}</td>
                <td>${e.bill ? `<button class="acc-icon ap-bill" title="${esc(T('sh.bill'))}">\u{1F4CE}</button>` : '-'}</td>
                <td><span class="art-pill ap-verify ${canVerify?'ap-clickable':''}" style="background:${ap.verified?'#6B8F71':'#C6432E'}" title="${esc(T('ap.clickHint'))}">${esc(ap.verified?T('sh.verYes'):T('sh.verNo'))}</span>${(ap.verified && ap.verifiedBy) ? ` <span class="sh-verify-by">${esc(ap.verifiedBy)}</span>` : ''}</td>
                <td><button class="acc-icon ap-proof ${ap.proofs.length?'has-proof':'is-empty'}" title="${esc(T('ap.proof'))}">\u{1F4CE}${ap.proofs.length?' '+ap.proofs.length:''}</button></td>
                <td class="num">${ap.status === 'partial'
                    ? `<input type="number" class="se-inp ap-paid" value="${ap.paid || ''}" step="0.01" min="0" max="${amount}" placeholder="0">`
                    : (ap.status === 'paid' ? `<b>${fmtD(amount)}</b>` : '-')}</td>
                <td><span class="art-pill ap-state" style="background:${AP_COLORS[ap.status]}" title="${esc(T('ap.clickHint'))}">${esc(T('ap.'+ap.status))}</span>${ap.statusBy ? `<div class="ap-by">${esc(ap.statusBy)}${ap.statusAt ? ' \u00B7 ' + esc(_fmtEditedAt(ap.statusAt)) : ''}</div>` : ''}</td>
              </tr>`; }).join('') : `<tr><td colspan="13" class="art-empty">${esc(T('ap.empty'))}</td></tr>`}
            </tbody>
            <tfoot><tr><td colspan="6">${esc(T('sh.totalRows'))} (${rows.length})</td><td class="num">${fmtD(total)}</td><td colspan="4"></td><td class="num">${fmtD(paidSum)}</td><td></td></tr></tfoot>
          </table>
        </div>
      </div>`;

    const redraw = ()=> renderApPage(body);
    body.querySelector('#apFrom').addEventListener('change', ev=>{ f.from = ev.target.value; redraw(); });
    body.querySelector('#apTo').addEventListener('change', ev=>{ f.to = ev.target.value; redraw(); });
    body.querySelector('#apStatusFilter').addEventListener('change', ev=>{ f.status = ev.target.value; redraw(); });
    body.querySelector('#apOrigin').addEventListener('change', ev=>{ f.origin = ev.target.value; redraw(); });
    body.querySelector('#apProduct').addEventListener('change', ev=>{ f.product = ev.target.value; redraw(); });
    body.querySelector('#apCat').addEventListener('change', ev=>{ f.cat = ev.target.value; redraw(); });
    body.querySelector('#apClear').addEventListener('click', ()=>{ apFilter = { from:'', to:'', status:'all', origin:'all', product:'all', cat:'all' }; redraw(); });

    body.querySelectorAll('tr[data-id]').forEach(tr=>{
      const e = stockLog.find(x=> x.id === tr.dataset.id);
      if(!e) return;
      const billBtn = tr.querySelector('.ap-bill');
      if(billBtn) billBtn.addEventListener('click', ()=> openBill(e.bill));
      // Click the pill to cycle Unpaid -> Partially paid -> Paid.
      tr.querySelector('.ap-state').addEventListener('click', ()=>{
        const cur = apOf(e).status;
        const next = AP_STATES[(AP_STATES.indexOf(cur) + 1) % AP_STATES.length];
        // Paid means the whole amount; unpaid means nothing has gone out yet.
        const paid = next === 'paid' ? apAmountOf(e) : (next === 'unpaid' ? 0 : (apOf(e).paid || 0));
        apTouch(e, { status: next, paid, statusBy: sellerNameOf(), statusAt: new Date().toISOString() });
        redraw();
      });
      const paidInp = tr.querySelector('.ap-paid');
      if(paidInp) paidInp.addEventListener('change', ()=>{
        const v = Math.min(Math.max(parseFloat(paidInp.value) || 0, 0), apAmountOf(e));
        apTouch(e, { paid: v });
        redraw();
      });
      const verPill = tr.querySelector('.ap-verify');
      if(verPill && canVerify) verPill.addEventListener('click', ()=>{
        const cur = apOf(e);
        apTouch(e, { verified: !cur.verified, verifiedBy: !cur.verified ? currentActorName() : '' });
        redraw();
      });
      tr.querySelector('.ap-proof').addEventListener('click', ()=> openApProofEditor(e, redraw));
    });

    // Settle everything currently on screen (i.e. whatever the filters show).
    const massBtn = body.querySelector('#apMass');
    if(massBtn) massBtn.addEventListener('click', ()=> openApMass(rows, redraw));

    const saveBtn = body.querySelector('#apSave');
    if(saveBtn) saveBtn.addEventListener('click', ()=>{
      if(!Object.keys(apDraft).length) return;
      confirmModal(T('ap.confirmTitle'), T('ap.confirmBody').replace('{n}', Object.keys(apDraft).length), async ()=>{
        Object.keys(apDraft).forEach(id=>{
          const entry = stockLog.find(x=> x.id === id);
          if(!entry) return;
          const d = apDraft[id];
          entry.ap = { status: d.status, proofs: d.proofs, paid: d.paid || 0, statusBy: d.statusBy || '', statusAt: d.statusAt || '' };
          // Verified lives on the log entry itself, so Stock History shows the same thing.
          entry.verified = !!d.verified;
          entry.verifiedBy = d.verified ? (d.verifiedBy || currentActorName()) : '';
        });
        apDraft = {};
        await saveStockLog();
        redraw();
      });
    });
  }
  // Mark every filtered row as fully paid, optionally attaching the same payment
  // proof to all of them. Like every edit here it lands in the draft first.
  function openApMass(rows, onDone){
    let list = [];
    const totalAmt = rows.reduce((sm,e)=> sm + apAmountOf(e), 0);
    const ov = document.createElement('div');
    ov.className = 'art-modal-overlay show';
    ov.innerHTML = `<div class="art-modal" style="max-width:560px;">
      <h3 class="art-modal-title">${esc(T('ap.mass'))}</h3>
      <p class="setting-desc">${esc(T('ap.massBody').replace('{n}', rows.length).replace('{amt}', fmt(totalAmt)))}</p>
      <div class="art-img-label" style="margin:14px 0 6px;">${esc(T('ap.proof'))} <span class="pi-hint">${esc(T('ap.massProofHint'))}</span></div>
      <div class="pi-grid" id="amGrid"></div>
      <div class="art-modal-actions">
        <button class="btn btn-ghost" id="amCancel">${esc(T('cancel'))}</button>
        <button class="btn btn-primary" id="amOk">${esc(T('confirm'))}</button>
      </div>
    </div>`;
    document.body.appendChild(ov);
    const grid = ov.querySelector('#amGrid');
    function draw(){
      grid.innerHTML = list.map((fl,i)=> `<span class="pi-thumb"><img src="${esc(fl.src)}" alt=""><button type="button" class="pi-rm" data-j="${i}">\u2715</button></span>`).join('')
        + (list.length < 5 ? `<label class="pi-add"><input type="file" class="am-inp" accept="image/*" multiple><span>+</span></label>` : '');
      grid.querySelectorAll('.pi-rm').forEach(b=> b.addEventListener('click', ()=>{ list.splice(+b.dataset.j, 1); draw(); }));
      const inp = grid.querySelector('.am-inp');
      if(inp) inp.addEventListener('change', (ev)=>{
        Array.from(ev.target.files || []).forEach(file=>{
          if(list.length >= 5) return;
          if(file.size > 256*1024){ alert(T('bill.tooBig')); return; }
          const rd = new FileReader();
          rd.onload = ()=>{ if(list.length < 5){ list.push({ src: rd.result, name: file.name || '' }); draw(); } };
          rd.readAsDataURL(file);
        });
      });
    }
    draw();
    const close = ()=> ov.remove();
    ov.addEventListener('click', ev=>{ if(ev.target === ov) close(); });
    ov.querySelector('#amCancel').addEventListener('click', close);
    ov.querySelector('#amOk').addEventListener('click', ()=>{
      const who = sellerNameOf(), when = new Date().toISOString();
      rows.forEach(e=>{
        const cur = apOf(e);
        const proofs = list.length ? cur.proofs.concat(list).slice(0, 5) : cur.proofs;
        apTouch(e, {
          status: 'paid', paid: apAmountOf(e), proofs,
          statusBy: who, statusAt: when,
          verified: true, verifiedBy: cur.verifiedBy || who
        });
      });
      close();
      if(typeof onDone === 'function') onDone();
    });
  }
  // Draft-only proof picker (max 5) — nothing is stored until the page is saved.
  function openApProofEditor(entry, onDone){
    let list = apOf(entry).proofs.slice(0, 5);
    const ov = document.createElement('div');
    ov.className = 'art-modal-overlay show';
    ov.innerHTML = `<div class="art-modal" style="max-width:560px;">
      <h3 class="art-modal-title">${esc(T('ap.proof'))} \u00B7 ${esc(entry.productName||'')}</h3>
      <p class="setting-desc" style="margin:-4px 0 12px;">${esc(T('pay.proofHint'))}</p>
      <div class="pi-grid" id="apGrid"></div>
      <div class="art-modal-actions">
        <button class="btn btn-ghost" id="apPfCancel">${esc(T('cancel'))}</button>
        <button class="btn btn-primary" id="apPfOk">${esc(T('save'))}</button>
      </div>
    </div>`;
    document.body.appendChild(ov);
    const grid = ov.querySelector('#apGrid');
    function draw(){
      grid.innerHTML = list.map((fl,i)=> `<span class="pi-thumb"><img src="${esc(fl.src)}" alt=""><button type="button" class="pi-rm" data-j="${i}">\u2715</button></span>`).join('')
        + (list.length < 5 ? `<label class="pi-add"><input type="file" class="ap-inp" accept="image/*" multiple><span>+</span></label>` : '');
      grid.querySelectorAll('.pi-rm').forEach(b=> b.addEventListener('click', ()=>{ list.splice(+b.dataset.j, 1); draw(); }));
      const inp = grid.querySelector('.ap-inp');
      if(inp) inp.addEventListener('change', (ev)=>{
        Array.from(ev.target.files || []).forEach(file=>{
          if(list.length >= 5) return;
          if(file.size > 256*1024){ alert(T('bill.tooBig')); return; }
          const rd = new FileReader();
          rd.onload = ()=>{ if(list.length < 5){ list.push({ src: rd.result, name: file.name || '' }); draw(); } };
          rd.readAsDataURL(file);
        });
      });
      grid.querySelectorAll('.pi-thumb img').forEach((im,i)=> im.addEventListener('click', ()=> openProofs([list[i]], entry.productName)));
    }
    draw();
    const close = ()=> ov.remove();
    ov.addEventListener('click', ev=>{ if(ev.target === ov) close(); });
    ov.querySelector('#apPfCancel').addEventListener('click', close);
    ov.querySelector('#apPfOk').addEventListener('click', ()=>{
      apTouch(entry, { proofs: list.slice(0,5) });
      close();
      if(typeof onDone === 'function') onDone();
    });
  }
  // Small yes/no dialog used before writing a page's pending changes.
  function confirmModal(title, message, onYes){
    const ov = document.createElement('div');
    ov.className = 'art-modal-overlay show';
    ov.innerHTML = `<div class="art-modal" style="max-width:420px;">
      <h3 class="art-modal-title">${esc(title)}</h3>
      <p class="setting-desc">${esc(message)}</p>
      <div class="art-modal-actions">
        <button class="btn btn-ghost" id="cfNo">${esc(T('cancel'))}</button>
        <button class="btn btn-primary" id="cfYes">${esc(T('confirm'))}</button>
      </div>
    </div>`;
    document.body.appendChild(ov);
    const close = ()=> ov.remove();
    ov.addEventListener('click', e=>{ if(e.target === ov) close(); });
    ov.querySelector('#cfNo').addEventListener('click', close);
    ov.querySelector('#cfYes').addEventListener('click', async ()=>{ close(); await onYes(); });
  }

  let sellExpFilter = { from:'', to:'' };
  // Selling Expenses — starts as the full bill list; the costs of selling each
  // one get layered on top once the user specs them.
  function renderSellingExpenses(body){
    const f = sellExpFilter;
    const rows = orders
      .filter(o=> (!f.from || (o.date||'') >= f.from) && (!f.to || (o.date||'') <= f.to))
      .map(computeOrder)
      .sort((a,b)=> String(b.date||'').localeCompare(String(a.date||'')));
    const totalRev = rows.reduce((sm,o)=> sm + (o.netBase != null ? o.netBase : o.net), 0);
    const totalDel = rows.reduce((sm,o)=> sm + sellExpOf(o).delivery, 0);
    const totalOther = rows.reduce((sm,o)=> sm + sellExpOf(o).other, 0);
    body.innerHTML = `
      <div class="panel">
        <div class="art-toolbar">
          <div class="art-field"><label>${esc(T('exp.from'))}</label><input type="date" id="seFrom" value="${esc(f.from)}"></div>
          <div class="art-field"><label>${esc(T('exp.to'))}</label><input type="date" id="seTo" value="${esc(f.to)}"></div>
          <button class="btn btn-ghost" id="seClear">${esc(T('exp.clearFilter'))}</button>
          <div class="art-spacer"></div>
          <span class="inv-summary">${esc(T('cogs.bills'))}: <b>${rows.length}</b> \u00B7 ${esc(T('cogs.revenue'))}: <b>${fmtD(totalRev)}</b> \u0E3F</span>
        </div>
        <div class="art-table-wrap">
          <table class="art-table">
            <thead><tr>
              <th>${esc(T('exp.date'))}</th><th>${esc(T('rev.invoiceNo'))}</th><th>${esc(T('rev.customer'))}</th>
              <th>${esc(T('rev.platform'))}</th><th>${esc(T('rev.items'))}</th>
              <th>${esc(T('rev.invoiceStatus'))}</th><th>${esc(T('sell.seller'))}</th>
              <th class="num">${esc(T('exp.net'))}</th>
              <th class="num">${esc(T('se.delivery'))}</th><th class="num">${esc(T('se.other'))}</th>
              <th>${esc(T('exp.note'))}</th><th>${esc(T('se.status'))}</th>
            </tr></thead>
            <tbody>${rows.length ? rows.map(o=> `
              <tr data-id="${esc(o.id)}">
                <td>${esc(o.date||'-')}</td>
                <td class="art-id">${esc(o.invoiceNumber||'-')}</td>
                <td>${esc(o.customerName||'-')}</td>
                <td>${esc(dispName('platforms', o.platform) || '-')}</td>
                <td>${esc(itemsSummary(o.items))}</td>
                <td><span class="art-pill" style="background:${ordColor('invoiceStatuses', o.invoiceStatus)}">${esc(dispName('invoiceStatuses', o.invoiceStatus))}</span></td>
                <td>${esc(o.seller || o.createdBy || '-')}</td>
                <td class="num" style="font-weight:700;">${fmtD(o.netBase != null ? o.netBase : o.net)}</td>
                <td class="num"><input type="number" class="se-inp se-del" data-id="${esc(o.id)}" value="${sellExpOf(o).delivery || ''}" step="0.01" min="0" placeholder="0"></td>
                <td class="num"><input type="number" class="se-inp se-oth" data-id="${esc(o.id)}" value="${sellExpOf(o).other || ''}" step="0.01" min="0" placeholder="0"></td>
                <td><button type="button" class="acc-icon se-note ${sellExpOf(o).note?'has-note':''}" data-id="${esc(o.id)}" title="${esc(sellExpOf(o).note || T('se.addNote'))}">\u{1F4DD}</button></td>
                <td>${(sellExpOf(o).delivery || sellExpOf(o).other)
                    ? `<span class="art-pill" style="background:#6B8F71">${esc(T('se.added'))}</span>`
                    : `<span class="art-pill" style="background:#C6432E">${esc(T('se.none'))}</span>`}</td>
              </tr>`).join('') : `<tr><td colspan="12" class="art-empty">${esc(T('rev.empty'))}</td></tr>`}
            </tbody>
            <tfoot><tr><td colspan="7">${esc(T('rev.totalRows'))} (${rows.length})</td><td class="num">${fmtD(totalRev)}</td>
              <td class="num">${fmtD(totalDel)}</td><td class="num">${fmtD(totalOther)}</td><td colspan="2"></td></tr></tfoot>
          </table>
        </div>
      </div>`;
    const redraw = ()=> renderSellingExpenses(body);
    body.querySelector('#seFrom').addEventListener('change', e=>{ f.from = e.target.value; redraw(); });
    body.querySelector('#seTo').addEventListener('change', e=>{ f.to = e.target.value; redraw(); });
    body.querySelector('#seClear').addEventListener('click', ()=>{ sellExpFilter = { from:'', to:'' }; renderSellingExpenses(body); });
    const writeExp = async (id, field, value)=>{
      const o = orders.find(x=> x.id === id); if(!o) return;
      o.sellExpense = Object.assign({ delivery:0, other:0, note:'' }, o.sellExpense || {});
      o.sellExpense[field] = value;
      await saveOrders();
    };
    body.querySelectorAll('.se-del').forEach(inp=> inp.addEventListener('change', async ()=>{
      await writeExp(inp.dataset.id, 'delivery', parseFloat(inp.value) || 0);
      redraw();   // the status pill and the totals follow
    }));
    body.querySelectorAll('.se-oth').forEach(inp=> inp.addEventListener('change', async ()=>{
      await writeExp(inp.dataset.id, 'other', parseFloat(inp.value) || 0);
      redraw();
    }));
    body.querySelectorAll('.se-note').forEach(btn=> btn.addEventListener('click', ()=>{
      const o = orders.find(x=> x.id === btn.dataset.id); if(!o) return;
      const ov = document.createElement('div');
      ov.className = 'art-modal-overlay show';
      ov.innerHTML = `<div class="art-modal" style="max-width:520px;">
        <h3 class="art-modal-title">${esc(T('exp.note'))} \u00B7 ${esc(o.invoiceNumber||'')}</h3>
        <textarea id="seNoteTxt" rows="5" style="width:100%;">${esc(sellExpOf(o).note)}</textarea>
        <div class="art-modal-actions">
          <button class="btn btn-ghost" id="seNoteCancel">${esc(T('cancel'))}</button>
          <button class="btn btn-primary" id="seNoteSave">${esc(T('save'))}</button>
        </div>
      </div>`;
      document.body.appendChild(ov);
      const close = ()=> ov.remove();
      ov.addEventListener('click', e=>{ if(e.target === ov) close(); });
      ov.querySelector('#seNoteCancel').addEventListener('click', close);
      ov.querySelector('#seNoteSave').addEventListener('click', async ()=>{
        await writeExp(o.id, 'note', ov.querySelector('#seNoteTxt').value.trim());
        close(); redraw();
      });
    }));
  }

  let stockValFilter = { cat:'all', hideEmpty:true };
  // What is physically left, valued at what it actually cost.
  // Walks the LOTS (not the product's stock field) so每 lot's own cost is used,
  // and splits by colour the same way the Stock page does.
  function stockValuationRows(){
    const map = {};
    lots.forEach(l=>{
      const prod = products.find(x=> x.id === l.productId);
      if(!prod) return;
      const a = lotAlloc(l);
      const rem = (l.qtyIn||0) - a.reserved - a.sold;
      if(rem <= 0) return;
      const key = l.productId + '|' + (l.colorId || '');
      if(!map[key]){
        const col = (l.colorId && Array.isArray(prod.colors)) ? prod.colors.find(c=> c.id === l.colorId) : null;
        const price = (col && col.price != null && col.price !== '') ? Number(col.price) : (Number(prod.price) || 0);
        map[key] = { prod, col, price, qty:0, cost:0, byOrigin:{} };
      }
      const val = rem * (Number(l.cost) || 0);
      map[key].qty += rem;
      map[key].cost += val;
      const org = l.origin || T('sum.noOrigin');
      map[key].byOrigin[org] = (map[key].byOrigin[org] || 0) + val;
    });
    return Object.keys(map).map(k=> map[k]);
  }
  function renderStockValuation(body){
    const f = stockValFilter;
    let rows = stockValuationRows();
    if(f.cat !== 'all') rows = rows.filter(r=> (r.prod.productType || '') === f.cat);
    rows.sort((a,b)=> b.cost - a.cost);

    const totalQty   = rows.reduce((s,r)=> s + r.qty, 0);
    const totalCost  = rows.reduce((s,r)=> s + r.cost, 0);
    const totalRetail= rows.reduce((s,r)=> s + r.qty * r.price, 0);
    const potential  = totalRetail - totalCost;
    const margin     = totalRetail ? (potential / totalRetail * 100) : 0;
    const skuCount   = new Set(rows.map(r=> r.prod.id)).size;

    // Value split by category and by where the stock was bought.
    const byCat = {}, byOrigin = {};
    rows.forEach(r=>{
      const cat = r.prod.productType || T('sum.uncategorised');
      byCat[cat] = (byCat[cat] || 0) + r.cost;
      Object.keys(r.byOrigin).forEach(o=>{ byOrigin[o] = (byOrigin[o] || 0) + r.byOrigin[o]; });
    });
    const catItems = Object.keys(byCat).map(n=> ({ name: dispName('productTypes', n) || n, value: Math.round(byCat[n]), color: ptypeColor(n) })).sort((a,b)=> b.value-a.value);
    const orgItems = Object.keys(byOrigin).map(n=> ({ name: n, value: Math.round(byOrigin[n]), color: originColor(n) })).sort((a,b)=> b.value-a.value);
    const topItems = rows.slice(0, 5).map(r=> ({
      name: (r.prod.name || '-') + (r.col ? ' \u00B7 ' + (r.col.name || '') : ''),
      value: Math.round(r.cost),
      color: ptypeColor(r.prod.productType)
    }));

    body.innerHTML = `
      <div class="panel">
        <div class="art-toolbar">
          <div class="art-field"><label>${esc(T('prod.ptype'))}</label>
            <select id="svCat">
              <option value="all">${esc(T('exp.all'))}</option>
              ${(config.productTypes||[]).map(t=> `<option value="${esc(t.name)}" ${f.cat===t.name?'selected':''}>${esc(itemLabel(t))}</option>`).join('')}
            </select>
          </div>
          <button class="btn btn-ghost" id="svClear">${esc(T('exp.clearFilter'))}</button>
        </div>

        <div class="art-sum-cards">
          <div class="art-stat-card"><div class="art-stat-label">${esc(T('sv.skus'))}</div><div class="art-stat-value">${skuCount}</div></div>
          <div class="art-stat-card"><div class="art-stat-label">${esc(T('sv.units'))}</div><div class="art-stat-value">${totalQty}</div></div>
          <div class="art-stat-card"><div class="art-stat-label">${esc(T('sv.atCost'))}</div><div class="art-stat-value">${fmtD(totalCost)} \u0E3F</div></div>
          <div class="art-stat-card"><div class="art-stat-label">${esc(T('sv.atRetail'))}</div><div class="art-stat-value">${fmtD(totalRetail)} \u0E3F</div></div>
          <div class="art-stat-card"><div class="art-stat-label">${esc(T('sv.potential'))}</div><div class="art-stat-value art-profit">${fmtD(potential)} \u0E3F</div></div>
          <div class="art-stat-card"><div class="art-stat-label">${esc(T('sv.margin'))}</div><div class="art-stat-value">${totalRetail ? margin.toFixed(1)+'%' : '-'}</div></div>
        </div>

        <div class="acct-summary" style="grid-template-columns:1fr 1fr 1fr;">
          <div class="acct-summary-chart">
            <h4 class="art-form-section" style="margin-top:0;">${esc(T('sv.byCat'))}</h4>
            ${acctDonutHtml(catItems, fmt(Math.round(totalCost)), T('cogs.short'))}
          </div>
          <div class="acct-summary-chart">
            <h4 class="art-form-section" style="margin-top:0;">${esc(T('sv.byOrigin'))}</h4>
            ${acctDonutHtml(orgItems, fmt(Math.round(totalCost)), T('cogs.short'))}
          </div>
          <div class="acct-summary-chart">
            <h4 class="art-form-section" style="margin-top:0;">${esc(T('sv.top'))}</h4>
            ${topItems.length ? acctBarsHtml(topItems) : `<p class="art-set-empty">${esc(T('sv.empty'))}</p>`}
            <p class="setting-desc" style="margin:8px 0 0;">${esc(T('sv.topHint'))}</p>
          </div>
        </div>

        <div class="art-table-wrap">
          <table class="art-table">
            <thead><tr>
              <th>${esc(T('prod.sku'))}</th><th>${esc(T('prod.name'))}</th><th>${esc(T('prod.ptype'))}</th>
              <th>${esc(T('pc.colorLabel'))}</th><th class="num">${esc(T('sv.onHand'))}</th>
              <th class="num">${esc(T('sv.avgCost'))}</th><th class="num">${esc(T('sv.atCost'))}</th>
              <th class="num">${esc(T('prod.price'))}</th><th class="num">${esc(T('sv.atRetail'))}</th>
              <th class="num">${esc(T('sv.potential'))}</th>
            </tr></thead>
            <tbody>${rows.length ? rows.map(r=>{
              const retail = r.qty * r.price;
              return `<tr>
                <td class="art-id">${esc(r.prod.sku||'-')}</td>
                <td>${esc(r.prod.name||'-')}</td>
                <td>${esc(dispName('productTypes', r.prod.productType) || '-')}</td>
                <td>${r.col ? `<span class="pc-dot" style="background:${esc(r.col.hex||'#888')}"></span>${esc(r.col.name||'-')}` : '-'}</td>
                <td class="num" style="font-weight:700;">${r.qty}</td>
                <td class="num">${fmtD(r.qty ? r.cost / r.qty : 0)}</td>
                <td class="num">${fmtD(r.cost)}</td>
                <td class="num">${fmtD(r.price)}</td>
                <td class="num">${fmtD(retail)}</td>
                <td class="num ${(retail - r.cost) < 0 ? 'art-pending-due' : 'art-profit'}">${fmtD(retail - r.cost)}</td>
              </tr>`; }).join('') : `<tr><td colspan="10" class="art-empty">${esc(T('sv.empty'))}</td></tr>`}
            </tbody>
            <tfoot><tr>
              <td colspan="4">${esc(T('rev.totalRows'))} (${rows.length})</td>
              <td class="num">${totalQty}</td><td></td>
              <td class="num">${fmtD(totalCost)}</td><td></td>
              <td class="num">${fmtD(totalRetail)}</td>
              <td class="num art-profit">${fmtD(potential)}</td>
            </tr></tfoot>
          </table>
        </div>
      </div>`;
    body.querySelector('#svCat').addEventListener('change', e=>{ stockValFilter.cat = e.target.value; renderStockValuation(body); });
    body.querySelector('#svClear').addEventListener('click', ()=>{ stockValFilter = { cat:'all', hideEmpty:true }; renderStockValuation(body); });
  }

  let cogsFilter = { from:'', to:'', status:'all' };
  // COGS Tracking — every bill (paid or not) priced at what the goods cost us.
  function renderCogsPage(body){
    const f = cogsFilter;
    const rows = orders
      .filter(o=> (!f.from || (o.date||'') >= f.from) && (!f.to || (o.date||'') <= f.to))
      .filter(o=> f.status === 'all' || (f.status === 'paid' ? isPaidOrder(o) : !isPaidOrder(o)))
      .map(o=>{
        const co = computeOrder(o);
        const cogs = orderCOGS(o);
        const rev = (co.netBase != null ? co.netBase : co.net);
        const pfee = orderPlatformFee(o);
        const dfee = sellExpOf(o).delivery;   // both entered on Selling Expenses
        const ofee = sellExpOf(o).other;
        const comm = orderCommission(o);
        return { o, co, cogs, rev, pfee, dfee, ofee, comm,
                 gross: rev - cogs,
                 net: rev - cogs - pfee - dfee - ofee - comm };
      })
      .sort((a,b)=> String(b.o.date||'').localeCompare(String(a.o.date||'')));

    // Cost split by product category and by where the stock was bought.
    const byCat = {}, byOrigin = {};
    let missing = 0;
    rows.forEach(r=>{
      (r.o.items||[]).forEach(it=>{
        const alloc = it.costAllocation || [];
        if(!alloc.length && (it.qty||0) > 0) missing++;
        const prod = products.find(x=> x.id === it.productId);
        const cat = (prod && prod.productType) || T('sum.uncategorised');
        alloc.forEach(a=>{
          const val = (Number(a.cost)||0) * (a.qty||0);
          if(val <= 0) return;
          byCat[cat] = (byCat[cat]||0) + val;
          const org = a.origin || T('sum.noOrigin');
          byOrigin[org] = (byOrigin[org]||0) + val;
        });
      });
    });
    const catItems = Object.keys(byCat).map(n=> ({ name: dispName('productTypes', n) || n, value: Math.round(byCat[n]), color: ptypeColor(n) })).sort((a,b)=> b.value-a.value);
    const orgItems = Object.keys(byOrigin).map(n=> ({ name: n, value: Math.round(byOrigin[n]), color: originColor(n) })).sort((a,b)=> b.value-a.value);

    // Product ranking: gross profit per product (bill-level fees stay out of it,
    // they belong to the bill, not to any one product).
    const prodAgg = {};
    rows.forEach(r=>{
      (r.o.items || []).forEach(it=>{
        const gross = (it.qty||0) * (it.price||0);
        const net = gross - dAmt(gross, it.discount, it.discountType);
        const cost = (it.costAllocation || []).reduce((x,a)=> x + (Number(a.cost)||0) * (a.qty||0), 0);
        const prod = products.find(x=> x.id === it.productId);
        const key = it.productId || it.productName || '-';
        if(!prodAgg[key]) prodAgg[key] = { name: it.productName || (prod && prod.name) || '-', cat: (prod && prod.productType) || '', qty:0, rev:0, cost:0 };
        prodAgg[key].qty += (it.qty||0);
        prodAgg[key].rev += net;
        prodAgg[key].cost += cost;
      });
    });
    const topProducts = Object.keys(prodAgg).map(k=>{
      const t = prodAgg[k];
      return { ...t, profit: t.rev - t.cost };
    }).sort((a,b)=> b.profit - a.profit).slice(0, 10);

    const paidRows = rows.filter(r=> isPaidOrder(r.o));
    const unpaidRows = rows.filter(r=> !isPaidOrder(r.o));
    const sum = (list, key)=> list.reduce((s,r)=> s + (r[key] || 0), 0);
    const totalCogs = sum(rows,'cogs'), totalRev = sum(rows,'rev');
    const totalPfee = sum(rows,'pfee'), totalComm = sum(rows,'comm'), totalDfee = sum(rows,'dfee'), totalOfee = sum(rows,'ofee');
    const totalGross = sum(rows,'gross'), totalNet = sum(rows,'net');
    const margin = totalRev ? (totalNet / totalRev * 100) : 0;

    body.innerHTML = `
      <div class="panel">
        <div class="art-toolbar">
          <div class="art-field"><label>${esc(T('exp.from'))}</label><input type="date" id="cgFrom" value="${esc(f.from)}"></div>
          <div class="art-field"><label>${esc(T('exp.to'))}</label><input type="date" id="cgTo" value="${esc(f.to)}"></div>
          <div class="art-field"><label>${esc(T('rev.invoiceStatus'))}</label>
            <select id="cgStatus">
              <option value="all" ${f.status==='all'?'selected':''}>${esc(T('exp.all'))}</option>
              <option value="paid" ${f.status==='paid'?'selected':''}>${esc(T('cogs.paid'))}</option>
              <option value="unpaid" ${f.status==='unpaid'?'selected':''}>${esc(T('cogs.unpaid'))}</option>
            </select>
          </div>
          <button class="btn btn-ghost" id="cgClear">${esc(T('exp.clearFilter'))}</button>
        </div>

        <div class="art-sum-cards">
          <div class="art-stat-card"><div class="art-stat-label">${esc(T('cogs.bills'))}</div><div class="art-stat-value">${rows.length}</div></div>
          <div class="art-stat-card"><div class="art-stat-label">${esc(T('cogs.revenue'))}</div><div class="art-stat-value">${fmtD(totalRev)} \u0E3F</div></div>
          <div class="art-stat-card"><div class="art-stat-label">${esc(T('cogs.total'))}</div><div class="art-stat-value">${fmtD(totalCogs)} \u0E3F</div></div>
          <div class="art-stat-card"><div class="art-stat-label">${esc(T('cogs.profit'))}</div><div class="art-stat-value ${totalGross < 0 ? 'art-pending-due' : 'art-profit'}">${fmtD(totalGross)} \u0E3F</div></div>
          <div class="art-stat-card"><div class="art-stat-label">${esc(T('cogs.pfee'))}</div><div class="art-stat-value">${fmtD(totalPfee)} \u0E3F</div></div>
          <div class="art-stat-card"><div class="art-stat-label">${esc(T('cogs.commission'))}</div><div class="art-stat-value">${fmtD(totalComm)} \u0E3F</div></div>
          <div class="art-stat-card"><div class="art-stat-label">${esc(T('cogs.netProfit'))}</div><div class="art-stat-value ${totalNet < 0 ? 'art-pending-due' : 'art-profit'}">${fmtD(totalNet)} \u0E3F</div></div>
          <div class="art-stat-card"><div class="art-stat-label">${esc(T('cogs.margin'))}</div><div class="art-stat-value">${totalRev ? margin.toFixed(1)+'%' : '-'}</div></div>
        </div>
        ${missing ? `<p class="setting-desc art-pending-due" style="margin:10px 0 0;">\u26A0 ${esc(T('cogs.missing').replace('{n}', missing))}</p>` : ''}

        <div class="acct-summary" style="grid-template-columns:1fr 1fr 1fr;">
          <div class="acct-summary-chart">
            <h4 class="art-form-section" style="margin-top:0;">${esc(T('cogs.byCat'))}</h4>
            ${acctDonutHtml(catItems, fmt(Math.round(totalCogs)), T('cogs.short'))}
          </div>
          <div class="acct-summary-chart">
            <h4 class="art-form-section" style="margin-top:0;">${esc(T('cogs.byOrigin'))}</h4>
            ${acctDonutHtml(orgItems, fmt(Math.round(totalCogs)), T('cogs.short'))}
          </div>
          <div class="acct-summary-chart">
            <h4 class="art-form-section" style="margin-top:0;">${esc(T('cogs.byStatus'))}</h4>
            ${acctBarsHtml([
              { name: T('cogs.paid'),   value: Math.round(sum(paidRows,'cogs')),   color:'#6B8F71' },
              { name: T('cogs.unpaid'), value: Math.round(sum(unpaidRows,'cogs')), color:'#C6432E' }
            ])}
            <p class="setting-desc" style="margin:8px 0 0;">${esc(T('cogs.barHint'))}</p>
          </div>
        </div>

        <h4 class="art-form-section">${esc(T('cogs.top'))}</h4>
        <p class="setting-desc" style="margin-top:-6px;">${esc(T('cogs.topHint'))}</p>
        <div class="art-table-wrap">
          <table class="art-table">
            <thead><tr>
              <th class="num">#</th><th>${esc(T('prod.name'))}</th><th>${esc(T('prod.ptype'))}</th>
              <th class="num">${esc(T('cogs.sold'))}</th><th class="num">${esc(T('cogs.revenue'))}</th>
              <th class="num">${esc(T('acct.cogs'))}</th><th class="num">${esc(T('sv.avgCost'))}</th>
              <th class="num">${esc(T('cogs.profit'))}</th><th class="num">${esc(T('cogs.margin'))}</th>
            </tr></thead>
            <tbody>${topProducts.length ? topProducts.map((t,i)=> `
              <tr>
                <td class="num">${i+1}</td>
                <td>${esc(t.name)}</td>
                <td>${esc(dispName('productTypes', t.cat) || '-')}</td>
                <td class="num">${t.qty}</td>
                <td class="num">${fmtD(t.rev)}</td>
                <td class="num">${fmtD(t.cost)}</td>
                <td class="num">${fmtD(t.qty ? t.cost / t.qty : 0)}</td>
                <td class="num ${t.profit < 0 ? 'art-pending-due' : 'art-profit'}">${fmtD(t.profit)}</td>
                <td class="num">${t.rev ? (t.profit / t.rev * 100).toFixed(1)+'%' : '-'}</td>
              </tr>`).join('') : `<tr><td colspan="9" class="art-empty">${esc(T('rev.empty'))}</td></tr>`}
            </tbody>
          </table>
        </div>

        <h4 class="art-form-section">${esc(T('cogs.perBill'))}</h4>
        <div class="art-table-wrap">
          <table class="art-table">
            <thead><tr>
              <th>${esc(T('exp.date'))}</th><th>${esc(T('rev.invoiceNo'))}</th><th>${esc(T('rev.customer'))}</th>
              <th>${esc(T('rev.items'))}</th><th>${esc(T('rev.invoiceStatus'))}</th>
              <th class="num">${esc(T('cogs.revenue'))}</th><th class="num">${esc(T('acct.cogs'))}</th>
              <th class="num">${esc(T('cogs.pfee'))}</th><th class="num">${esc(T('cogs.dfee'))}</th>
              <th class="num">${esc(T('se.other'))}</th><th class="num">${esc(T('cogs.commission'))}</th>
              <th class="num">${esc(T('cogs.netProfit'))}</th><th class="num">${esc(T('cogs.margin'))}</th>
            </tr></thead>
            <tbody>${rows.length ? rows.map(r=>{
              const rev = r.rev;
              const mg = rev ? (r.net / rev * 100) : 0;
              return `<tr>
                <td>${esc(r.o.date||'-')}</td>
                <td class="art-id">${esc(r.o.invoiceNumber||'-')}</td>
                <td>${esc(r.o.customerName||'-')}</td>
                <td>${esc(itemsSummary(r.o.items))}</td>
                <td><span class="art-pill" style="background:${ordColor('invoiceStatuses', r.o.invoiceStatus)}">${esc(dispName('invoiceStatuses', r.o.invoiceStatus))}</span></td>
                <td class="num">${fmtD(rev)}</td>
                <td class="num">${fmtD(r.cogs)}</td>
                <td class="num">${fmtD(r.pfee)}</td>
                <td class="num">${fmtD(r.dfee)}</td>
                <td class="num">${fmtD(r.ofee)}</td>
                <td class="num">${fmtD(r.comm)}</td>
                <td class="num ${r.net < 0 ? 'art-pending-due' : 'art-profit'}">${fmtD(r.net)}</td>
                <td class="num">${rev ? mg.toFixed(1)+'%' : '-'}</td>
              </tr>`; }).join('') : `<tr><td colspan="13" class="art-empty">${esc(T('rev.empty'))}</td></tr>`}
            </tbody>
            <tfoot><tr>
              <td colspan="5">${esc(T('rev.totalRows'))} (${rows.length})</td>
              <td class="num">${fmtD(totalRev)}</td><td class="num">${fmtD(totalCogs)}</td>
              <td class="num">${fmtD(totalPfee)}</td><td class="num">${fmtD(totalDfee)}</td>
              <td class="num">${fmtD(totalOfee)}</td><td class="num">${fmtD(totalComm)}</td>
              <td class="num ${totalNet < 0 ? 'art-pending-due' : 'art-profit'}">${fmtD(totalNet)}</td>
              <td class="num">${totalRev ? margin.toFixed(1)+'%' : '-'}</td>
            </tr></tfoot>
          </table>
        </div>
      </div>`;
    const redraw = ()=> renderCogsPage(body);
    body.querySelector('#cgFrom').addEventListener('change', e=>{ f.from = e.target.value; redraw(); });
    body.querySelector('#cgTo').addEventListener('change', e=>{ f.to = e.target.value; redraw(); });
    body.querySelector('#cgStatus').addEventListener('change', e=>{ f.status = e.target.value; redraw(); });
    body.querySelector('#cgClear').addEventListener('click', ()=>{ cogsFilter = { from:'', to:'', status:'all' }; renderCogsPage(body); });
  }
  function renderBillsPage(body, kind){
    const paidName = paidStatusName();
    const wantPaid = kind === 'receipts';
    const f = billFilters[kind];
    const rows = orders
      .filter(o=> paidName ? ((o.invoiceStatus === paidName) === wantPaid) : !wantPaid)
      .filter(o=> (!f.from || (o.date||'') >= f.from) && (!f.to || (o.date||'') <= f.to))
      .filter(o=>{
        if(f.vat === 'all') return true;
        if(f.vat === 'none') return !o.vatable;
        if(f.vat === 'split') return !!o.vatable && o.docSplit === 'split';
        if(f.vat === 'combined') return !!o.vatable && o.docSplit !== 'split';
        return true;
      })
      .map(computeOrder)
      .sort((a,b)=> String(b.date||'').localeCompare(String(a.date||'')));
    const canV = isAdminActor();
    const totalNet = rows.reduce((sm,o)=> sm + o.net, 0);
    const totalDue = rows.reduce((sm,o)=> sm + pendingOf(o), 0);
    const totalPaid = rows.reduce((sm,o)=> sm + (o.paidAmount||0), 0);

    // Invoicing slices by invoice status; Receipts slices by how the money came in.
    const counts = {};
    const groupKey = wantPaid ? 'paymentModes' : 'invoiceStatuses';
    rows.forEach(o=>{ const k = (wantPaid ? o.paymentMode : o.invoiceStatus) || '-'; counts[k] = (counts[k]||0) + 1; });
    const donutItems = Object.keys(counts).map(name=> ({
      name: dispName(groupKey, name) || name,
      value: counts[name],
      color: ordColor(groupKey, name)
    })).sort((a,b)=> b.value - a.value);

    // Receipts are settled, so "deposits received" says nothing there — show the
    // average value per receipt instead.
    const avgPer = rows.length ? totalNet / rows.length : 0;
    const cards = wantPaid
      ? `<div class="art-stat-card"><div class="art-stat-label">${esc(T('rc.count'))}</div><div class="art-stat-value">${rows.length}</div></div>
         <div class="art-stat-card"><div class="art-stat-label">${esc(T('rc.total'))}</div><div class="art-stat-value">${fmtD(totalNet)} \u0E3F</div></div>
         <div class="art-stat-card"><div class="art-stat-label">${esc(T('rc.avg'))}</div><div class="art-stat-value">${fmtD(avgPer)} \u0E3F</div></div>`
      : `<div class="art-stat-card"><div class="art-stat-label">${esc(T('inv.unpaid'))}</div><div class="art-stat-value">${rows.length}</div></div>
         <div class="art-stat-card"><div class="art-stat-label">${esc(T('pay.pending'))}</div><div class="art-stat-value art-pending-due">${fmtD(totalDue)} \u0E3F</div></div>
         <div class="art-stat-card"><div class="art-stat-label">${esc(T('inv.billed'))}</div><div class="art-stat-value">${fmtD(totalNet)} \u0E3F</div></div>
         <div class="art-stat-card"><div class="art-stat-label">${esc(T('inv.deposit'))}</div><div class="art-stat-value">${fmtD(totalPaid)} \u0E3F</div></div>`;

    body.innerHTML = `
      <div class="panel">
        <div class="art-toolbar">
          <div class="art-field"><label>${esc(T('exp.from'))}</label><input type="date" id="billFrom" value="${esc(f.from)}"></div>
          <div class="art-field"><label>${esc(T('exp.to'))}</label><input type="date" id="billTo" value="${esc(f.to)}"></div>
          <div class="art-field"><label>${esc(T('pay.vat'))}</label>
            <select id="billVat">
              <option value="all" ${f.vat==='all'?'selected':''}>${esc(T('exp.all'))}</option>
              <option value="combined" ${f.vat==='combined'?'selected':''}>${esc(T('pay.vatYes'))}</option>
              <option value="split" ${f.vat==='split'?'selected':''}>${esc(T('pay.vatSeparated'))}</option>
              <option value="none" ${f.vat==='none'?'selected':''}>${esc(T('pay.vatNo'))}</option>
            </select>
          </div>
          <button class="btn btn-ghost" id="billClear">${esc(T('exp.clearFilter'))}</button>
        </div>
        <div class="acct-summary">
          <div class="acct-summary-chart">
            <h4 class="art-form-section" style="margin-top:0;">${esc(wantPaid ? T('rc.byMode') : T('inv.byStatus'))}</h4>
            ${acctDonutHtml(donutItems, String(rows.length), wantPaid ? T('rc.receipts') : T('inv.bills'))}
          </div>
          <div class="acct-summary-stats"><div class="art-sum-cards">${cards}</div></div>
        </div>
        <div class="art-table-wrap">
          <table class="art-table led-table">
            <thead><tr>
              <th>${esc(T('exp.date'))}</th><th>${esc(T('rev.invoiceNo'))}</th><th>${esc(T('rev.customer'))}</th>
              <th>${esc(T('rev.platform'))}</th><th>${esc(T('rev.items'))}</th><th class="num">${esc(T('exp.discount'))}</th>
              <th class="num">${esc(T('exp.net'))}</th><th>${esc(T('exp.tag'))}</th>
              <th>${esc(T('rev.orderStatus'))}</th><th>${esc(T('rev.invoiceStatus'))}</th><th>${esc(T('pay.mode'))}</th>
              <th class="num">${esc(T('pay.paid'))}</th><th class="num">${esc(T('pay.pending'))}</th>
              <th>${esc(T('rev.deliveryMethod'))}</th><th>${esc(T('rev.responsible'))}</th><th>${esc(T('col.lastEdited'))}</th>
              <th class="led-sticky-seller">${esc(T('sell.seller'))}</th><th class="c led-sticky-vat">${esc(T('pay.vat'))}</th><th class="led-sticky-ver">${esc(T('del.verified'))}</th><th class="art-sticky-actions"></th>
            </tr></thead>
            <tbody>${rows.length ? rows.map(o=> `
              <tr data-id="${esc(o.id)}">
                <td>${esc(o.date||'-')}</td>
                <td class="art-id">${esc(o.invoiceNumber||'-')}</td>
                <td>${esc(o.customerName||'-')}</td>
                <td>${esc(dispName('platforms', o.platform) || '-')}</td>
                <td>${esc(itemsSummary(o.items))}</td>
                <td class="num">${fmtD(o.itemDiscTotal + o.overallAmt)}</td>
                <td class="num" style="font-weight:700;">${fmt(o.net)}</td>
                <td><span class="art-pill" style="background:${ordColor('revenueTags', o.tag)}">${esc(dispName('revenueTags', o.tag))}</span></td>
                <td><span class="art-pill" style="background:${ordColor('orderStatuses', o.orderStatus)}">${esc(dispName('orderStatuses', o.orderStatus))}</span></td>
                <td><span class="art-pill" style="background:${ordColor('invoiceStatuses', o.invoiceStatus)}">${esc(dispName('invoiceStatuses', o.invoiceStatus))}</span></td>
                <td>${esc(dispName('paymentModes', o.paymentMode) || '-')}</td>
                <td class="num">${fmtD(o.paidAmount)}</td>
                <td class="num ${pendingOf(o) > 0 ? 'art-pending-due' : ''}">${fmtD(pendingOf(o))}</td>
                <td>${esc(o.deliveryMethod||'-')}</td>
                <td>${esc(o.deliveryResponsible||'-')}</td>
                <td class="art-edited">${esc(editedLabel(o))}</td>
                <td class="led-sticky-seller">${esc(o.seller || o.createdBy || '-')}</td>
                <td class="c led-sticky-vat">${vatPill(o)}</td>
                <td class="led-sticky-ver">${ledgerVerifyPill(o, canV)}</td>
                <td class="art-sticky-actions"><div class="art-row-actions">
                  <button class="acc-icon inv-doc" title="${esc(T('doc.rv.title'))}">\u{1F4C4}</button>
                  <button class="acc-icon inv-proof ${(o.paymentProofs && o.paymentProofs.length) ? 'has-proof' : 'is-empty'}" title="${esc(T('pay.proof'))}">\u{1F4CE}</button>
                </div></td>
              </tr>`).join('') : `<tr><td colspan="20" class="art-empty">${esc(wantPaid ? T('rc.empty') : T('inv.empty'))}</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>`;
    syncStickyCols(body.querySelector('table.art-table'));
    const redraw = ()=> renderBillsPage(body, kind);
    body.querySelector('#billFrom').addEventListener('change', e=>{ f.from = e.target.value; redraw(); });
    body.querySelector('#billTo').addEventListener('change', e=>{ f.to = e.target.value; redraw(); });
    body.querySelector('#billVat').addEventListener('change', e=>{ f.vat = e.target.value; redraw(); });
    body.querySelector('#billClear').addEventListener('click', ()=>{ f.from = ''; f.to = ''; f.vat = 'all'; redraw(); });
    body.querySelectorAll('tr[data-id]').forEach(tr=>{
      const id = tr.dataset.id;
      const doc = tr.querySelector('.inv-doc');
      if(doc) doc.addEventListener('click', ()=> openDocMaker(orders.find(o=> o.id === id), body, redraw));
      const pf = tr.querySelector('.inv-proof');
      if(pf) pf.addEventListener('click', ()=>{
        const o = orders.find(x=> x.id === id);
        if(!o) return;
        if(o.paymentProofs && o.paymentProofs.length) openProofs(o.paymentProofs, o.invoiceNumber);
        else alert(T('pay.noProof'));
      });
      const vp = tr.querySelector('.led-verify-btn');
      if(vp) vp.addEventListener('click', async ()=>{
        const o = orders.find(x=> x.id === id); if(!o) return;
        o.verified = !o.verified; o.verifiedBy = o.verified ? currentActorName() : '';
        await saveOrders(); redraw();
      });
    });
  }
  // VAT at a glance: green when charged (saying whether the bill is split),
  // red when it isn't.
  function vatPill(o){
    if(!o.vatable) return `<span class="art-pill" style="background:#C6432E">${esc(T('pay.vatNo'))}</span>`;
    const sep = o.docSplit === 'split';
    return `<span class="art-pill" style="background:#6B8F71">${esc(sep ? T('pay.vatSeparated') : T('pay.vatYes'))}</span>`;
  }
  function ledgerVerifyPill(o, can){
    const on = !!o.verified;
    return `<span class="art-pill led-verify ${can?'led-verify-btn':''}" style="background:${on?'#6B8F71':'#C6432E'};">${esc(on?T('sh.verYes'):T('sh.verNo'))}</span>${(on && o.verifiedBy) ? ` <span class="sh-verify-by">${esc(o.verifiedBy)}</span>` : ''}`;
  }
  function renderOrdersTable(body){
    const list = ordersFiltered().map(computeOrder);
    const tbody = body.querySelector('#ordTbody');
    const table = body.querySelector('#ordTable');
    const empty = body.querySelector('#ordEmpty');
    if(!tbody) return;
    const oStatuses = config.orderStatuses || [];
    const iStatuses = config.invoiceStatuses || [];
    const rTags = config.revenueTags || [];
    if(list.length === 0){
      tbody.innerHTML=''; table.style.display='none'; empty.style.display='block';
    }else{
      table.style.display=''; empty.style.display='none';
      tbody.innerHTML = list.map(o=>{
        const d = new Date(o.date+'T00:00:00');
        const dateLabel = isNaN(d) ? o.date : (String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+d.getFullYear());
        const tagC = ordColor('revenueTags', o.tag), osC = ordColor('orderStatuses', o.orderStatus), isC = ordColor('invoiceStatuses', o.invoiceStatus);
        return `<tr data-id="${o.id}">
          <td>${dateLabel}</td>
          <td class="art-id">${esc(o.invoiceNumber||'-')}</td>
          <td>${esc(o.customerName||'-')}</td>
          <td>${esc(dispName('platforms', o.platform) || '-')}</td>
          <td>${esc(itemsSummary(o.items))}</td>
          <td class="num">${fmtD((o.itemDiscTotal||0) + (o.overallAmt||0))}</td>
          <td class="num" style="font-weight:700;">${fmt(o.net)}</td>
          <td><select class="art-inline-sel" data-field="tag" style="background:${tagC}">${rTags.map(t=>`<option value="${esc(t.name)}" ${t.name===o.tag?'selected':''}>${esc(itemLabel(t))}</option>`).join('')}</select></td>
          <td><select class="art-inline-sel" data-field="orderStatus" style="background:${osC}">${oStatuses.map(s=>`<option value="${esc(s.name)}" ${s.name===o.orderStatus?'selected':''}>${esc(itemLabel(s))}</option>`).join('')}</select></td>
          <td><select class="art-inline-sel" data-field="invoiceStatus" style="background:${isC}">${iStatuses.map(s=>`<option value="${esc(s.name)}" ${s.name===o.invoiceStatus?'selected':''}>${esc(itemLabel(s))}</option>`).join('')}</select></td>
          <td>${esc(dispName('paymentModes', o.paymentMode) || '-')}</td>
          <td class="num">${fmtD(o.paidAmount)}</td>
          <td class="num ${pendingOf(o) > 0 ? 'art-pending-due' : ''}">${fmtD(pendingOf(o))}</td>
          <td>${esc(o.deliveryMethod||'-')}</td>
          <td>${esc(o.deliveryResponsible||'-')}</td>
          <td>${esc(o.seller || o.createdBy || '-')}</td>
          <td class="art-edited">${esc(editedLabel(o))}</td>
          <td class="c sell-sticky-vat">${vatPill(o)}</td>
          <td class="art-sticky-actions"><div class="art-row-actions">
            <button class="acc-icon art-ord-doc" title="${esc(T('doc.rv.title'))}">📄</button>
            <button class="acc-icon art-ord-proof ${(o.paymentProofs && o.paymentProofs.length) ? 'has-proof' : ''}" title="${esc(T('pay.proof'))}">\u{1F4CE}</button>
            <button class="acc-icon art-ord-edit" title="${esc(T('edit'))}">✎</button>
            <button class="acc-icon art-ord-del" title="${esc(T('delete'))}">✕</button>
          </div></td>
        </tr>`;
      }).join('');
      syncStickyCols(tbody.closest('table'));
      tbody.querySelectorAll('tr').forEach(tr=>{
        const id = tr.dataset.id;
        tr.querySelectorAll('.art-inline-sel').forEach(sel=>{
          sel.addEventListener('change', async (e)=>{
            const o = orders.find(x=> x.id===id); if(!o) return;
            o[e.target.dataset.field] = e.target.value;
            await saveOrders();
            renderOrdersTable(body);
          });
        });
        tr.querySelector('.art-ord-doc').addEventListener('click', ()=> openDocMaker(orders.find(o=>o.id===id), body, ()=> renderOrdersTable(body)));
        const _pf = tr.querySelector('.art-ord-proof');
        if(_pf) _pf.addEventListener('click', ()=>{ const o = orders.find(x=> x.id===id); if(o) openProofEditor(o, ()=> renderOrdersTable(body)); });
        tr.querySelector('.art-ord-edit').addEventListener('click', ()=> openOrderModal(orders.find(o=>o.id===id), body, ()=> renderRevenuePage(body)));
        tr.querySelector('.art-ord-del').addEventListener('click', async ()=>{
          if(!window.confirm(T('rev.delConfirm'))) return;
          const _od = orders.find(o=> o.id === id);
          if(_od){ logRec(orderLog, saveOrderLog, id, _od.invoiceNumber, 'delete', _od); deletedOrders.push(toBin(_od)); await saveDeletedOrders(); }
          orders = orders.filter(o=> o.id !== id);
          await saveOrders();
          renderOrdersTable(body);
        });
      });
    }
    body.querySelector('#ordRowCount').textContent = list.length;
    body.querySelector('#ordFootDisc').textContent = fmt(list.reduce((s,o)=> s+(o.discount||0), 0));
    body.querySelector('#ordFootTotal').textContent = fmt(list.reduce((s,o)=> s+o.net, 0));
  }

  /* ================= Financial documents (PDF via print) ================= */
  // Amount → Thai baht words, e.g. 1,250.50 → "หนึ่งพันสองร้อยห้าสิบบาทห้าสิบสตางค์".
  function bahtText(amount){
    amount = Math.round((amount + Number.EPSILON) * 100) / 100;
    const nums = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
    const units = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];
    function group(n){   // n: 0..999999
      let out = '', s = String(n), len = s.length;
      for(let i = 0; i < len; i++){
        const d = +s[i], pos = len - i - 1;
        if(d === 0) continue;
        if(pos === 1 && d === 1) out += 'สิบ';
        else if(pos === 1 && d === 2) out += 'ยี่สิบ';
        else if(pos === 0 && d === 1 && len > 1) out += 'เอ็ด';
        else out += nums[d] + units[pos];
      }
      return out;
    }
    function conv(n){
      if(n === 0) return 'ศูนย์';
      let out = '';
      const m = Math.floor(n / 1000000), rest = n % 1000000;
      if(m > 0) out += conv(m) + 'ล้าน';
      if(rest > 0) out += group(rest);
      return out;
    }
    const baht = Math.floor(amount), satang = Math.round((amount - baht) * 100);
    if(baht === 0 && satang === 0) return 'ศูนย์บาทถ้วน';
    let text = '';
    if(baht > 0) text += conv(baht) + 'บาท';
    if(satang > 0) text += group(satang) + 'สตางค์';
    else if(baht > 0) text += 'ถ้วน';
    return text;
  }
  // YYYY-MM-DD → "11 กรกฎาคม 2568" (Buddhist year).
  function thaiDate(iso){
    const M = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
    const d = new Date(iso + 'T00:00:00');
    if(isNaN(d)) return iso || '-';
    return d.getDate() + ' ' + M[d.getMonth()] + ' ' + (d.getFullYear() + 543);
  }
  function money2(n){ return Number(n||0).toLocaleString('en-US', { minimumFractionDigits:2, maximumFractionDigits:2 }); }

  // Per-document-type differences. The layout/engine is shared; only labels,
  // number prefix, party wording, signature captions and a statement differ.
  const DOCDEF = {
    rv:      { title:'doc.rv.title', prefix:'RV-', party:'doc.receivedFrom', signL:'doc.payer',        signR:'doc.payee',  showPay:true,  statement:'doc.st.received' },
    bn:      { title:'doc.bn.title', prefix:'BN-', party:'doc.billTo',       signL:'doc.billReceiver', signR:'doc.biller', showPay:false, statement:'doc.st.pleasePay' },
    receipt: { title:'doc.rc.title', prefix:'RE-', party:'doc.receivedFrom', signL:'doc.payer',        signR:'doc.payee',  showPay:true,  statement:'doc.st.received' },
    tax:     { title:'doc.tx.title', prefix:'TX-', party:'doc.billTo',       signL:'doc.payer',        signR:'doc.payee',  showPay:true,  statement:'doc.st.received', taxInvoice:true },
    deposit: { title:'doc.dp.title', prefix:'DP-', party:'doc.receivedFrom', signL:'doc.payer',        signR:'doc.payee',  showPay:true,  statement:'doc.st.deposit',  deposit:true }
  };

  // Options step: pick document type + VAT + payment method, then generate.
  function openDocMaker(order, body, onDone){
    // A deposit receipt only makes sense while money is still outstanding.
    const _dpPending = pendingOf(computeOrder(order));
    const b = ((order && order.vatable) ? config.business : config.businessGeneral) || config.business || {};
    let type = 'rv';
    const ov = document.createElement('div');
    ov.className = 'art-modal-overlay show';
    ov.innerHTML = `
      <div class="art-modal">
        <h3 class="art-modal-title">${esc(T('doc.makeTitle'))}</h3>
        <p class="setting-desc" style="margin:-4px 0 12px;">${esc(T('doc.optsDesc'))}</p>
        ${(!b.name) ? `<p class="setting-desc" style="color:var(--c-danger);margin-bottom:12px;">${esc(T('doc.noProfile'))}</p>` : ''}
        <div class="doc-type-picker" id="dvType">
          <button type="button" class="doc-type-btn active" data-dtype="rv">${esc(T('doc.rv.title'))}</button>
          <button type="button" class="doc-type-btn" data-dtype="bn">${esc(T('doc.bn.title'))}</button>
          <button type="button" class="doc-type-btn" data-dtype="receipt">${esc(T('doc.rc.title'))}</button>
          <button type="button" class="doc-type-btn" data-dtype="tax">${esc(T('doc.tx.title'))}</button>
          <button type="button" class="doc-type-btn" data-dtype="deposit" ${_dpPending > 0 ? '' : 'disabled'} title="${esc(_dpPending > 0 ? T('doc.dp.title') : T('doc.dp.disabled'))}">${esc(T('doc.dp.title'))}</button>
        </div>
        <label class="doc-check" style="display:flex; gap:9px; padding:10px 0;"><input type="checkbox" id="dvVatChk" ${order&&order.vatable?'checked':''}> <span>${esc(T('doc.vatCalc'))}</span></label>
        <div id="dvTaxFields" style="display:none;">
          <h4 class="art-form-section" style="margin-top:14px;">${esc(T('doc.taxCustomer'))}</h4>
          <p class="setting-desc" style="margin-top:-6px;">${esc(T('doc.taxCustomerHint'))}</p>
          <div class="art-form-grid">
            <label class="art-form-full">${esc(T('doc.custCompany'))}<input type="text" id="dvTaxName" value="${esc((order.taxCustomer&&order.taxCustomer.name)||order.customerName||'')}"></label>
            <label class="art-form-full">${esc(T('doc.custAddress'))}<textarea id="dvTaxAddr" rows="2">${esc((order.taxCustomer&&order.taxCustomer.address)||order.address||'')}</textarea></label>
            <label class="art-form-full">${esc(T('doc.custTaxId'))}<input type="text" id="dvTaxId" value="${esc((order.taxCustomer&&order.taxCustomer.taxId)||'')}"></label>
          </div>
        </div>
        <div class="doc-opt-block">
          <span class="doc-opt-label">${esc(T('doc.splitMode'))}</span>
          <div class="del-seg" id="dvSplit">
            <button type="button" class="del-seg-btn ${(order.docSplit||'all')!=='split'?'active':''}" data-split="all">${esc(T('doc.splitTogether'))}</button>
            <button type="button" class="del-seg-btn ${(order.docSplit||'all')==='split'?'active':''}" data-split="split">${esc(T('doc.splitApart'))}</button>
          </div>
          <p class="setting-desc" style="margin:6px 0 0;">${esc(T('doc.splitHint'))}</p>
        </div>
        <div class="doc-opt-block">
          <span class="doc-opt-label">${esc(T('doc.showDiscounts'))}</span>
          <label class="doc-check"><input type="checkbox" id="dvDiscItem" checked> ${esc(T('doc.discItem'))}</label>
          <label class="doc-check"><input type="checkbox" id="dvDiscShip" checked> ${esc(T('doc.discShip'))}</label>
          <label class="doc-check"><input type="checkbox" id="dvDiscOverall" checked> ${esc(T('doc.discOverall'))}</label>
        </div>
        <div class="doc-field">
          <label for="dvLang">${esc(T('doc.language'))}</label>
          <select id="dvLang">
            <option value="th" ${((window.appLang&&window.appLang())!=='en')?'selected':''}>${esc(T('doc.langTh'))}</option>
            <option value="en" ${((window.appLang&&window.appLang())==='en')?'selected':''}>${esc(T('doc.langEn'))}</option>
          </select>
        </div>
        <p class="setting-desc" style="margin:2px 0 0;">${esc(T('doc.payFromOrder'))}: <b>${esc(dispName('paymentModes', order.paymentMode) || '-')}</b></p>
        <div class="art-modal-actions">
          <button class="btn btn-ghost" id="dvCancel">${esc(T('cancel'))}</button>
          <button class="btn btn-ghost" id="dvSave">${esc(T('save'))}</button>
          <button class="btn btn-primary" id="dvMake">${esc(T('doc.make'))}</button>
          <button class="btn btn-primary" id="dvMakeGoods" style="display:none;">${esc(T('doc.makeGoods'))}</button>
          <button class="btn btn-primary" id="dvMakeShip" style="display:none;">${esc(T('doc.makeShip'))}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const close = ()=> ov.remove();
    ov.addEventListener('click', e=>{ if(e.target===ov) close(); });
    ov.querySelector('#dvCancel').addEventListener('click', close);
    ov.querySelectorAll('.doc-type-btn').forEach(btn=> btn.addEventListener('click', ()=>{
      type = btn.dataset.dtype;
      ov.querySelectorAll('.doc-type-btn').forEach(x=> x.classList.toggle('active', x===btn));
      ov.querySelector('#dvTaxFields').style.display = (type === 'tax') ? '' : 'none';
    }));
    // The VAT decision lives on the ORDER: ticking here flips the icon in the table.
    const vatChk = ov.querySelector('#dvVatChk');
    // Goods and shipping on one document, or one document each.
    let splitMode = order.docSplit || 'all';
    const btnAll = ov.querySelector('#dvMake');
    const btnGoods = ov.querySelector('#dvMakeGoods');
    const btnShip = ov.querySelector('#dvMakeShip');
    const paintSplit = ()=>{
      const apart = splitMode === 'split';
      ov.querySelectorAll('#dvSplit [data-split]').forEach(x=> x.classList.toggle('active', x.dataset.split === splitMode));
      btnAll.style.display = apart ? 'none' : '';
      btnGoods.style.display = apart ? '' : 'none';
      btnShip.style.display = apart ? '' : 'none';
    };
    paintSplit();
    // The layout belongs to the BILL: it changes the VAT base, so it is saved,
    // not re-chosen every time a document is printed.
    ov.querySelectorAll('#dvSplit [data-split]').forEach(b=> b.addEventListener('click', ()=>{
      splitMode = b.dataset.split;
      paintSplit();
    }));
    // One explicit Save — it stores the bill settings, logs the change and closes.
    ov.querySelector('#dvSave').addEventListener('click', async ()=>{
      const before = JSON.parse(JSON.stringify(order));
      order.vatable = vatChk.checked;
      order.docSplit = splitMode;
      order.editedBy = currentActorName();
      order.editedAt = new Date().toISOString();
      await saveOrders();
      if(before.vatable !== order.vatable || (before.docSplit||'all') !== (order.docSplit||'all')){
        logRec(orderLog, saveOrderLog, order.id, order.invoiceNumber, 'edit', order);
      }
      close();
      if(typeof onDone === 'function') onDone();
    });
    const generate = (scope)=>{
      const taxCustomer = {
        name: (ov.querySelector('#dvTaxName').value || '').trim(),
        address: (ov.querySelector('#dvTaxAddr').value || '').trim(),
        taxId: (ov.querySelector('#dvTaxId').value || '').trim()
      };
      if(type === 'tax'){ order.taxCustomer = taxCustomer; saveOrders(); }   // remember for the next print
      const opts = {
        type, scope, taxCustomer,
        vat: vatChk.checked,
        lang: ov.querySelector('#dvLang').value,
        showItemDisc: ov.querySelector('#dvDiscItem').checked,
        showShipDisc: ov.querySelector('#dvDiscShip').checked,
        showOverallDisc: ov.querySelector('#dvDiscOverall').checked
      };
      const html = buildDocumentHtml(order, opts);
      const w = window.open('', '_blank');
      if(!w){ alert(T('doc.popupBlocked')); return; }
      w.document.open(); w.document.write(html); w.document.close();
      close();
    };
    btnAll.addEventListener('click', ()=> generate('all'));
    btnGoods.addEventListener('click', ()=> generate('goods'));
    btnShip.addEventListener('click', ()=> generate('shipping'));
  }

  function buildDocumentHtml(order, opts){
    const def = DOCDEF[opts.type] || DOCDEF.rv;
    const T = window.moduleI18n(ID, opts.lang);   // TH/EN doc-language override
    // VAT ticked -> Organization (carries the tax ID); not ticked -> General Stores.
    const b = ((opts && opts.vat) ? config.business : config.businessGeneral) || config.business || {};
    const bName = (opts.lang==='en' && b.nameEn) ? b.nameEn : (b.name||'');
    const bAddress = (opts.lang==='en' && b.addressEn) ? b.addressEn : (b.address||'');
    const co = computeOrder(order);
    let shipGross = co.shipping;
    if(order.shippingOverride == null){
      const cats=[...new Set((order.items||[]).map(it=>{ const pr=products.find(x=> x.id===it.productId); return pr?(pr.productType||''):''; }).filter(Boolean))];
      const inc = new Set(order.shipInclude || cats);
      shipGross = cats.filter(c=> inc.has(c)).reduce((s,c)=> s + shipCostFor(c, (order.addressParts||{}).provinceCode), 0);
    }
    const shipDiscTotal = shipGross - co.shipping;
    const totalDisc = (co.itemDiscTotal||0) + shipDiscTotal + (co.overallAmt||0);
    const anyDisc = opts.showItemDisc || opts.showShipDisc || opts.showOverallDisc;
    // scope: 'all' (goods + shipping), 'goods' (products only) or 'shipping'.
    // VAT is charged on whatever THIS document actually covers.
    const scope = opts.scope || 'all';
    // A tax invoice bills the customer's COMPANY, so those details replace the
    // everyday recipient block when they were filled in.
    const taxCust = (def.taxInvoice && opts.taxCustomer) ? opts.taxCustomer : {};
    const goodsBase = Math.max(0, (co.itemsNet||0) - (co.overallAmt||0));   // overall discount sits with the goods
    const shipBase = co.shipping || 0;
    const splitBill = (order.docSplit === 'split');
    const beforeVat = scope === 'goods' ? goodsBase : (scope === 'shipping' ? shipBase : goodsBase + shipBase);
    // On a split bill the shipping side carries no VAT, so a shipping document
    // (or a combined print of a split bill) only taxes the goods.
    const vatBase = scope === 'shipping' ? (splitBill ? 0 : shipBase) : (scope === 'goods' ? goodsBase : (splitBill ? goodsBase : beforeVat));
    const vatOn = !!opts.vat;
    const vatAmt = vatOn ? vatBase * 0.07 : 0;
    const grand = beforeVat + vatAmt;
    const docNo = def.prefix + (order.invoiceNumber || String(order.id).slice(-6));
    const payLabel = dispName('paymentModes', order.paymentMode) || '-';   // set on the order, not per document
    const esc2 = (s)=> esc(String(s == null ? '' : s));
    const nl2br = (s)=> esc2(s).replace(/\n/g, '<br>');

    const shipLabel = esc(T('doc.shipping'));
    const rows = scope === 'shipping'
      ? '<tr><td class="c">1</td><td>-</td><td>'+shipLabel+'</td><td class="c">1</td><td class="r">'+money2(shipBase)+'</td><td class="r">'+money2(shipBase)+'</td></tr>'
      : (order.items || []).map((it, i)=>{
      const amt = (it.qty || 0) * (it.price || 0);
      const saleNote = it.salePercent ? ` <span style="color:#C6432E;">(-${it.salePercent}%)</span>` : '';
      const _col = itemColorLabel(it);
      const colNote = _col ? ' <span style="color:#666;">\u00B7 '+esc2(_col)+'</span>' : '';
      const prodRef = products.find(x=> x.id === it.productId);
      return '<tr>'+
        '<td class="c">'+(i+1)+'</td>'+
        '<td>'+esc2((prodRef && prodRef.sku) || '-')+'</td>'+
        '<td>'+esc2(it.productName)+colNote+saleNote+'</td>'+
        '<td class="c">'+(it.qty||0)+'</td>'+
        '<td class="r">'+money2(it.price)+'</td>'+
        '<td class="r">'+money2(amt)+'</td>'+
      '</tr>';
    }).join('');
    const totalsRows =
      (scope === 'shipping'
        ? '<tr><td class="tl">'+esc(T('doc.shipping'))+'</td><td class="r">'+money2(shipBase)+'</td></tr>'
        : '<tr><td class="tl">'+esc(T('doc.subtotal'))+'</td><td class="r">'+money2(co.itemsTotal)+'</td></tr>'+
          (scope === 'all' ? '<tr><td class="tl">'+esc(T('doc.shipping'))+'</td><td class="r">'+money2(shipGross)+'</td></tr>' : ''))+
      (scope !== 'shipping' && opts.showItemDisc && co.itemDiscTotal ? '<tr><td class="tl">'+esc(T('doc.itemDiscount'))+'</td><td class="r">-'+money2(co.itemDiscTotal)+'</td></tr>' : '')+
      (scope !== 'goods' && opts.showShipDisc && shipDiscTotal ? '<tr><td class="tl">'+esc(T('doc.shipDiscount'))+'</td><td class="r">-'+money2(shipDiscTotal)+'</td></tr>' : '')+
      (scope !== 'shipping' && opts.showOverallDisc && co.overallAmt ? '<tr><td class="tl">'+esc(T('doc.overallDiscount'))+'</td><td class="r">-'+money2(co.overallAmt)+'</td></tr>' : '')+
      (anyDisc && totalDisc ? '<tr class="disc-total"><td class="tl">'+esc(T('doc.totalDiscount'))+'</td><td class="r">-'+money2(totalDisc)+'</td></tr>' : '')+
      (vatOn && vatAmt ? '<tr><td class="tl">'+esc(T('doc.beforeVat'))+'</td><td class="r">'+money2(beforeVat)+'</td></tr><tr><td class="tl">'+esc(T('doc.vat7'))+'</td><td class="r">'+money2(vatAmt)+'</td></tr>' : '')+
      '<tr class="grand"><td class="tl">'+esc(T('doc.grand'))+'</td><td class="r">฿'+money2(grand)+'</td></tr>'+
      (def.deposit
        ? '<tr><td class="tl">'+esc(T('doc.dp.paid'))+'</td><td class="r">฿'+money2(Number(order.paidAmount)||0)+'</td></tr>'+
          '<tr class="grand"><td class="tl">'+esc(T('doc.dp.balance'))+'</td><td class="r">฿'+money2(Math.max(0, grand - (Number(order.paidAmount)||0)))+'</td></tr>'
        : '');

    const logo = b.logo ? '<img class="biz-logo" src="'+esc2(b.logo)+'" alt="">' : '';
    const sign = b.signature ? '<img class="sig-img" src="'+esc2(b.signature)+'" alt="">' : '';
    // Whoever issued this bill signs on the left; the shop's own signature/stamp stays on the right.
    const sellerSign = order.sellerSignature ? '<img class="sig-img" src="'+esc2(order.sellerSignature)+'" alt="">' : '';
    const sellerName = order.seller ? esc2(order.seller) : '';
    const creatorName = order.createdByLabel || order.createdBy || '';
    const stamp = b.stamp ? '<img class="stamp-img" src="'+esc2(b.stamp)+'" alt="">' : '';

    return '<!DOCTYPE html><html lang="'+(opts.lang==='en'?'en':'th')+'"><head><meta charset="utf-8">'+
      '<title>'+esc(T(def.title))+' '+esc2(docNo)+(scope==='goods'?' ('+esc(T('doc.goodsOnly'))+')':(scope==='shipping'?' ('+esc(T('doc.shipOnly'))+')':''))+'</title>'+
      '<link rel="preconnect" href="https://fonts.googleapis.com">'+
      '<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet">'+
      '<style>'+
        '*{box-sizing:border-box;margin:0;padding:0;font-family:Sarabun,sans-serif;}'+
        'body{background:#ececec;color:#1a1a1a;font-size:13px;}'+
        '.toolbar{position:sticky;top:0;background:#2B2E26;color:#fff;padding:10px 16px;display:flex;justify-content:center;gap:10px;}'+
        '.toolbar button{padding:8px 18px;border:none;border-radius:8px;background:#6B7F58;color:#fff;font-size:14px;font-weight:600;cursor:pointer;}'+
        '.page{width:210mm;min-height:297mm;margin:16px auto;background:#fff;padding:18mm 16mm;box-shadow:0 2px 16px rgba(0,0,0,0.15);}'+
        '.head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #333;padding-bottom:14px;margin-bottom:18px;}'+
        '.biz{display:flex;gap:12px;align-items:flex-start;max-width:60%;}'+
        '.doc-remark{margin:14px 0 4px;padding:10px 12px;border:1px solid #ddd;border-radius:6px;font-size:12px;line-height:1.6;color:#444;}'+
        '.biz-logo{width:64px;height:64px;object-fit:contain;}'+
        '.biz-name{font-size:18px;font-weight:700;}'+
        '.biz-meta{font-size:12px;color:#444;line-height:1.5;margin-top:2px;}'+
        '.doc-title{text-align:right;}'+
        '.doc-title h1{font-size:22px;font-weight:700;}'+
        '.doc-meta{font-size:12.5px;color:#333;margin-top:6px;line-height:1.6;}'+
        '.party{background:#f6f6f2;border:1px solid #e2e2da;border-radius:8px;padding:12px 14px;margin-bottom:18px;}'+
        '.party .lbl{font-size:12px;color:#666;}'+
        '.party .nm{font-size:15px;font-weight:600;}'+
        '.party .ad{font-size:12.5px;color:#444;line-height:1.5;margin-top:2px;}'+
        'table.items{width:100%;border-collapse:collapse;margin-bottom:14px;}'+
        'table.items th{background:#333;color:#fff;font-size:12.5px;font-weight:600;padding:8px 10px;text-align:left;}'+
        'table.items td{padding:8px 10px;border-bottom:1px solid #eee;font-size:12.5px;}'+
        'table.items .c{text-align:center;}table.items .r{text-align:right;}'+
        '.bottom{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;}'+
        '.words{flex:1;background:#f6f6f2;border:1px dashed #bbb;border-radius:8px;padding:12px 14px;font-size:13px;}'+
        '.words .lbl{font-size:11.5px;color:#666;}'+
        '.words .val{font-weight:700;margin-top:2px;}'+
        '.words .pay{font-size:12px;color:#444;margin-top:8px;}'+
        'table.totals{width:270px;border-collapse:collapse;}'+
        'table.totals td{padding:6px 8px;font-size:12.5px;}'+
        'table.totals .tl{color:#555;}table.totals .r{text-align:right;}'+
        'table.totals tr.grand td{border-top:2px solid #333;font-size:15px;font-weight:700;padding-top:8px;}'+
        '.signs{display:flex;justify-content:space-between;gap:40px;margin-top:48px;}'+
        '.sign-box{flex:1;text-align:center;}'+
        '.sign-space{height:70px;position:relative;display:flex;align-items:flex-end;justify-content:center;}'+
        '.sig-img{max-height:60px;max-width:180px;object-fit:contain;}'+
        '.stamp-img{position:absolute;right:20px;bottom:0;max-height:80px;opacity:0.85;}'+
        '.sign-line{border-top:1px dotted #333;padding-top:6px;font-size:12.5px;color:#333;}'+
        '.note{font-size:11px;color:#888;text-align:center;margin-top:24px;}'+
        '@media print{ body{background:#fff;} .toolbar{display:none;} .page{margin:0;box-shadow:none;width:auto;min-height:auto;padding:14mm;} @page{size:A4;margin:0;} }'+
      '</style></head><body>'+
      '<div class="toolbar"><button onclick="window.print()">🖨️ '+esc(T('doc.print'))+'</button></div>'+
      '<div class="page">'+
        '<div class="head">'+
          '<div class="biz">'+logo+'<div><div class="biz-name">'+(bName?esc2(bName):esc(T('doc.yourStore')))+'</div>'+
            '<div class="biz-meta">'+nl2br(bAddress)+(b.phone?'<br>โทร. '+esc2(b.phone):'')+(b.taxId?'<br>เลขประจำตัวผู้เสียภาษี '+esc2(b.taxId):'')+(b.branch?'<br>'+esc(T('bp.branch'))+' '+esc2(b.branch):'')+'</div></div>'+
          '</div>'+
          '<div class="doc-title"><h1>'+esc(T(def.title))+'</h1>'+
            '<div class="doc-meta">'+esc(T('doc.no'))+' '+esc2(docNo)+'<br>'+esc(T('doc.date'))+' '+esc2(thaiDate(order.date))+
              (sellerName ? '<br>'+esc(T('doc.reference'))+' '+sellerName : '')+
              (creatorName ? '<br>'+esc(T('doc.createdBy'))+' '+esc2(creatorName) : '')+
            '</div></div>'+
        '</div>'+
        '<div class="party"><div class="lbl">'+esc(T(def.party))+'</div>'+
          '<div class="nm">'+esc2(taxCust.name || order.customerName || '-')+'</div>'+
          '<div class="ad">'+
            nl2br(taxCust.address || order.address)+
            (taxCust.taxId ? '<br>'+esc(T('doc.custTaxId'))+' '+esc2(taxCust.taxId) : '')+
            (order.phone ? '<br>'+esc(T('doc.custPhone'))+' '+esc2(order.phone) : '')+
            (order.invoiceNumber?'<br>'+esc(T('doc.ref'))+' '+esc2(order.invoiceNumber):'')+
          '</div></div>'+
        '<table class="items"><thead><tr><th class="c" style="width:6%;">'+esc(T('doc.col.no'))+'</th><th style="width:16%;">'+esc(T('doc.col.code'))+'</th><th>'+esc(T('doc.col.item'))+'</th><th class="c" style="width:9%;">'+esc(T('doc.col.qty'))+'</th><th class="r" style="width:16%;">'+esc(T('doc.col.unit'))+'</th><th class="r" style="width:18%;">'+esc(T('doc.col.amount'))+'</th></tr></thead><tbody>'+
          (rows || '<tr><td colspan="6" class="c" style="color:#999;padding:18px;">-</td></tr>')+
        '</tbody></table>'+
        '<div class="bottom">'+
          '<div class="words"><div class="lbl">'+esc(T('doc.amountWords'))+'</div><div class="val">( '+esc2(bahtText(grand))+' )</div>'+
            '<div class="pay">'+esc(T(def.statement))+'</div>'+
            (def.showPay ? '<div class="pay">'+esc(T('doc.payMethod'))+' : '+esc2(payLabel)+'</div>' : '')+'</div>'+
          '<table class="totals">'+totalsRows+'</table>'+
        '</div>'+
        (function(){
          // The remark belongs to the bill. config.docNote is only the default a
          // new bill starts from — older bills that predate the field fall back to it.
          const rk = (order.remark != null) ? order.remark : (config.docNote || '');
          return rk ? '<div class="doc-remark"><b>'+esc(T('cd.remark'))+'</b><br>'+nl2br(rk)+'</div>' : '';
        })()+
        '<div class="signs">'+
          '<div class="sign-box"><div class="sign-space"></div><div class="sign-line">'+esc(T(def.signL))+'</div></div>'+
          '<div class="sign-box"><div class="sign-space">'+(sellerSign||sign)+stamp+'</div><div class="sign-line">'+esc(T(def.signR))+(sellerName?' \u00B7 '+sellerName:(bName?' · '+esc2(bName):''))+'</div></div>'+
        '</div>'+
        '<div class="note">'+esc(T('doc.footNote'))+'</div>'+
      '</div></body></html>';
  }

  function openOrderModal(row, body, onDone){
    if(!row && products.length === 0){ alert(T('rev.noProducts')); return; }
    ordEditingId = row ? row.id : null;
    // Declared up here on purpose: updatePreview() runs during setup and reads it,
    // and a `let` declared further down would still be in its temporal dead zone
    // (even `typeof` throws), which silently killed every listener wired after it.
    let oSplitMode = (row && row.docSplit === 'split') ? 'split' : 'all';
    const oStatuses = config.orderStatuses || [];
    const iStatuses = config.invoiceStatuses || [];
    const rTags = config.revenueTags || [];
    const today = new Date().toISOString().slice(0,10);
    let items = row ? row.items.map(it=> ({ ...it, costAllocation: (it.costAllocation||[]).map(a=>({...a})) })) : [{ productName:'', qty:1, price:0, colorId:null, colorName:'', costAllocation:[] }];
    let shipInclude = (row && Array.isArray(row.shipInclude)) ? new Set(row.shipInclude) : null;
    let shipOverride = (row && row.shippingOverride!=null) ? row.shippingOverride : null;
    let shipDiscByCat = (row && row.shipDiscByCat) ? JSON.parse(JSON.stringify(row.shipDiscByCat)) : {};
    const discTypeOpts = (sel)=> ['baht','percent'].map(t=> `<option value="${t}" ${(sel||'baht')===t?'selected':''}>${t==='baht'?'฿':'%'}</option>`).join('');
    // Structured delivery address (parts + composed string). Legacy orders had a free-text string → put it in line1.
    let addr = { line1:'', pCode:null, dCode:null, sCode:null, postal:'' };
    let delMethod = (row && row.deliveryMethod) || (((config.shippingTypes||[])[0]||{}).name || '');
    let delResp = (row && row.deliveryResponsible) || '';
    let deliveryProof = (row && row.deliveryProof) || null;
    if(row && row.addressParts){ const ap = row.addressParts; addr = { line1: ap.line1||'', pCode: ap.provinceCode||null, dCode: ap.districtCode||null, sCode: ap.subdistrictCode||null, postal: ap.postalCode||'' }; }
    else if(row && row.address){ addr.line1 = row.address; }

    body.innerHTML = `
      <div class="panel art-order-form-page">
        <div class="art-order-form-head">
          <button type="button" class="btn btn-ghost" id="oBack">← ${esc(T('rev.back'))}</button>
          <h3 class="art-modal-title">${esc(row ? T('rev.editTitle') : T('rev.addTitle'))}</h3>
          <div class="art-modal-invoice"><span class="art-modal-invoice-label">${esc(T('rev.invoiceNo'))}</span><span id="ordInvPreview" class="art-modal-invoice-no">-</span></div>
        </div>
        <h4 class="art-form-section">${esc(T('sec.order'))}</h4>
        <div class="art-form-grid">
          <label>${esc(T('exp.date'))} <span class="art-req">*</span><input type="date" id="oDate" value="${row?esc(row.date):today}"></label>
          <label>${esc(T('rev.orderStatus'))}<select id="oOs" ${canChange('changeOrderStatus')?'':'disabled'}>${oStatuses.map(s=>`<option value="${esc(s.name)}" ${row&&row.orderStatus===s.name?'selected':''}>${esc(itemLabel(s))}</option>`).join('')}</select></label>
          <label>${esc(T('exp.tag'))}<select id="oTag" ${canChange('changeRevenueTag')?'':'disabled'}>${rTags.map(t=>`<option value="${esc(t.name)}" ${row&&row.tag===t.name?'selected':''}>${esc(itemLabel(t))}</option>`).join('')}</select></label>
          <label>${esc(T('rev.platform'))}<select id="oPlatform">${(config.platforms||[]).map(pl=> `<option value="${esc(pl.name)}" ${row&&row.platform===pl.name?'selected':''}>${esc(itemLabel(pl))}${pl.fee ? ' \u00B7 '+pl.fee+'%' : ''}</option>`).join('')}</select></label>
          <label>${esc(T('rev.platformFee'))}<span class="art-fee-pair">
            <span class="art-fee-inp"><input type="number" id="oFeePct" value="${row&&row.platformFee?row.platformFee:''}" step="0.01" min="0" placeholder="0">%</span>
            <span class="art-fee-inp"><input type="number" id="oFeeAmt" value="${row&&row.platformFeeAmount?row.platformFeeAmount:''}" step="0.01" min="0" placeholder="0">฿</span>
          </span></label>
        </div>
        <h4 class="art-form-section">${esc(T('sec.customer'))}</h4>
        <div class="art-form-grid">
          <label class="art-form-full">${esc(T('rev.customer'))} <span class="art-req">*</span><input type="text" id="oCustomer" value="${row?esc(row.customerName||''):''}" placeholder="${esc(T('rev.customerHint'))}"></label>
          <label>${esc(T('rev.phone'))}<input type="tel" id="oPhone" value="${row?esc(row.phone||''):''}" placeholder="${esc(T('rev.phoneHint'))}"></label>
        </div>
        <h4 class="art-form-section">${esc(T('sec.delivery'))}</h4>
        <div class="art-cust-split">
        <div class="art-cust-left">
        <div class="art-form-grid">
          <label>${esc(T('rev.deliveryMethod'))}<select id="oDeliveryMethod">${(config.shippingTypes||[]).map(st=> `<option value="${esc(st.name)}" ${delMethod===st.name?'selected':''}>${esc(itemLabel(st))}</option>`).join('')}</select></label>
          <label>${esc(T('rev.responsible'))}<span id="oRespWrap" class="art-resp-wrap"></span></label>
        </div>
        <div id="oProofWrap"></div>
        <div class="art-form-grid art-cust-fields">
          <label class="art-form-full">${esc(T('rev.addrLine'))} <span class="art-req">*</span><textarea id="oAddrLine" rows="2" placeholder="${esc(T('rev.addrLineHint'))}"></textarea></label>
          <label>${esc(T('rev.province'))} <span class="art-req">*</span><select id="oProvince"><option value="">${esc(T('rev.loading'))}</option></select></label>
          <label>${esc(T('rev.district'))} <span class="art-req">*</span><select id="oDistrict" disabled><option value="">—</option></select></label>
          <label>${esc(T('rev.subdistrict'))} <span class="art-req">*</span><select id="oSubdistrict" disabled><option value="">—</option></select></label>
          <label>${esc(T('rev.postal'))}<input type="text" id="oPostal" inputmode="numeric" placeholder="${esc(T('rev.postalHint'))}"></label>
        </div>
        <h4 class="art-form-section art-inv-head">${esc(T('sec.inventory'))}</h4>
        <div class="art-item-cols"><span>${esc(T('rev.itemProduct'))}</span><span>${esc(T('rev.itemQty'))}</span><span>${esc(T('rev.itemPrice'))}</span><span>${esc(T('rev.itemDisc'))}</span><span></span><span>${esc(T('rev.itemNet'))}</span><span></span></div>
        <div id="oItems" class="art-items"></div>
        <button type="button" class="btn btn-ghost art-add-item" id="oAddItem">${esc(T('rev.addItem'))}</button>
        <h4 class="art-form-section art-ship-head">${esc(T('rev.shippingTitle'))}</h4>
        <div id="oShipList" class="art-ship-list"></div>
        <div class="art-ship-override"><label>${esc(T('rev.shippingOverride'))}<input type="number" id="oShipOverride" value="${row&&row.shippingOverride!=null?row.shippingOverride:''}" placeholder="${esc(T('rev.shipAuto'))}" min="0"></label></div>
        </div>
        <div class="art-cust-map"><div class="th-map-hint">${esc(T('rev.mapHint'))}</div><div id="oMap" class="th-map-box">${esc(T('rev.loading'))}</div><div class="th-map-selected" id="oMapSel"></div><div class="th-map-legend" id="oMapLegend"></div></div>
        </div>
        <h4 class="art-form-section">${esc(T('rev.discountsTitle'))}</h4>
        <div class="art-form-grid" style="margin-top:6px;">
          <label>${esc(T('rev.overallDiscount'))}<span class="art-disc-inp"><input type="number" id="oOverallDisc" value="${row&&row.overallDiscount?row.overallDiscount:0}" step="0.01" min="0"><select id="oOverallDiscType">${discTypeOpts(row?row.overallDiscountType:'baht')}</select></span></label>
        </div>
        <h4 class="art-form-section">${esc(T('sec.vat'))}</h4>
        <div class="art-vat-block">
          <label class="pc-switch"><input type="checkbox" id="oVat" ${row&&row.vatable?'checked':''}><span>${esc(T('pay.vatable'))}</span></label>
          <div class="art-vat-mode">
            <span class="art-vat-mode-label">${esc(T('doc.splitMode'))}</span>
            <div class="del-seg" id="oSplit">
              <button type="button" class="del-seg-btn ${(row&&row.docSplit==='split')?'':'active'}" data-split="all">${esc(T('doc.splitTogether'))}</button>
              <button type="button" class="del-seg-btn ${(row&&row.docSplit==='split')?'active':''}" data-split="split">${esc(T('doc.splitApart'))}</button>
            </div>
          </div>
          <p class="setting-desc" style="margin:6px 0 0;">${esc(T('doc.splitHint'))}</p>
        </div>
        <h4 class="art-form-section">${esc(T('sec.payment'))}</h4>
        <div class="art-form-grid">
          <label>${esc(T('rev.invoiceStatus'))}<select id="oIs" ${canChange('changeInvoiceStatus')?'':'disabled'}>${iStatuses.map(s=>`<option value="${esc(s.name)}" ${row&&row.invoiceStatus===s.name?'selected':''}>${esc(itemLabel(s))}</option>`).join('')}</select></label>
          <label>${esc(T('pay.mode'))}<select id="oPayMode">${(config.paymentModes||[]).map(m=> `<option value="${esc(m.name)}" ${row&&row.paymentMode===m.name?'selected':''}>${esc(itemLabel(m))}</option>`).join('')}</select></label>
          <label>${esc(T('pay.paid'))}<input type="number" id="oPaid" value="${row&&row.paidAmount?row.paidAmount:''}" step="0.01" min="0" placeholder="0"></label>
          <label>${esc(T('pay.pending'))}<span class="art-pending-box"><b id="oPending">0</b> ฿</span></label>
          <div class="art-form-full art-proof-field">
            <div class="art-img-label">${esc(T('pay.proof'))} <span class="pi-hint">${esc(T('pay.proofHint'))}</span></div>
            <div class="pi-grid" id="oPayProofs"></div>
          </div>
        </div>
        <h4 class="art-form-section">${esc(T('sec.seller'))} <span class="art-req">*</span></h4>
        <div class="art-seller">
          <div class="art-seller-who">
            <div class="art-seller-label">${esc(T('sell.issuedBy'))}</div>
            <div class="art-seller-name" id="oSellerName">${esc(row && row.seller ? row.seller : sellerNameOf())}</div>
          </div>
          <div class="art-seller-sign">
            <div class="art-seller-label">${esc(T('sell.signature'))}</div>
            <canvas id="oSignPad" class="art-sign-pad" width="520" height="150"></canvas>
            <div class="art-sign-actions">
              <button type="button" class="btn btn-ghost" id="oSignClear">${esc(T('sell.clear'))}</button>
              <label class="file-picker">
                <input type="file" id="oSignFile" accept="image/*">
                <span class="file-picker-btn">${esc(T('sell.upload'))}</span>
              </label>
              <span class="pi-hint">${esc(T('sell.signHint'))}</span>
            </div>
          </div>
        </div>
        <label class="art-form-note">${esc(T('cd.remark'))} <span class="pi-hint">${esc(T('rev.remarkHint'))}</span><textarea id="oRemark" rows="3">${esc(row ? (row.remark != null ? row.remark : (config.docNote||'')) : (config.docNote||''))}</textarea></label>
        <label class="art-form-note">${esc(T('exp.note'))} <span class="pi-hint">${esc(T('rev.noteHint'))}</span><textarea id="oNote" rows="2">${row?esc(row.note||''):''}</textarea></label>
        <div class="art-modal-preview">
          <span>${esc(T('rev.itemsTotal'))}: <b id="oPvItems">0</b></span>
          <span>${esc(T('rev.shippingCost'))}: <b id="oPvShip">0</b></span>
          <span>${esc(T('rev.totalDiscount'))}: <b id="oPvDisc">0</b></span>
          <span>${esc(T('doc.vat7'))}: <b id="oPvVat">0</b></span>
          <span>${esc(T('exp.net'))}: <b id="oPvNet">0</b></span>
        </div>
        <div class="art-modal-actions">
          <button class="btn btn-ghost" id="oCancel">${esc(T('cancel'))}</button>
          <button class="btn btn-primary" id="oSave">${esc(T('save'))}</button>
        </div>
      </div>`;
    const g = (id)=> body.querySelector('#'+id);

    // ---- cost-lot allocation helpers (per order item) ----
    const colorsOf = (pid)=>{ const p = products.find(x=> x.id === pid); return (p && p.hasColors && Array.isArray(p.colors)) ? p.colors : []; };
    // A coloured product's lots are scoped to the item's chosen colour.
    const lotsForItem = (it)=>{ const cols = colorsOf(it.productId); return lots.filter(l=> l.productId===it.productId && (cols.length ? (l.colorId||null) === (it.colorId||null) : true)); };
    const originsOf = (it)=> [...new Set(lotsForItem(it).map(l=> l.origin))];
    const usedByOtherOrders = (lotId)=>{ let u=0; orders.forEach(o=>{ if(o.id===ordEditingId) return; (o.items||[]).forEach(it=> (it.costAllocation||[]).forEach(a=>{ if(a.lotId===lotId) u+=(a.qty||0); })); }); return u; };
    const formUsedExcept = (lotId, xi, xai)=>{ let u=0; items.forEach((it,ii)=> (it.costAllocation||[]).forEach((a,ai)=>{ if(ii===xi && ai===xai) return; if(a.lotId===lotId) u+=(a.qty||0); })); return u; };
    const lotAvail = (lot, xi, xai)=> (lot.qtyIn||0) - usedByOtherOrders(lot.id) - formUsedExcept(lot.id, xi, xai);
    const allocSum = (it)=> (it.costAllocation||[]).reduce((sm,a)=> sm+(a.qty||0), 0);
    const lotOptionsFor = (it, origin, xi, xai, selId)=> lotsForItem(it).filter(l=> l.origin===origin).map(l=>{
      const av = lotAvail(l, xi, xai);
      if(av <= 0 && l.id !== selId) return '';
      return `<option value="${l.id}" ${l.id===selId?'selected':''}>฿${fmt(l.cost)} · ${esc(T('alloc.left'))} ${av}</option>`;
    }).filter(Boolean).join('');
    function allocHtml(it, i){
      if(!it.productId) return '';
      if(colorsOf(it.productId).length && !it.colorId){
        return `<div class="art-alloc" data-i="${i}"><div class="art-alloc-hint">${esc(T('rev.pickColorFirst'))}</div></div>`;
      }
      const sum = allocSum(it), ok = sum === (it.qty||0);
      const rows = (it.costAllocation||[]).map((a,ai)=> `
        <div class="art-alloc-row" data-i="${i}" data-ai="${ai}">
          <select class="art-alloc-f" data-f="origin">
            <option value="">${esc(T('alloc.pickOrigin'))}</option>
            ${originsOf(it).map(o=> `<option value="${esc(o)}" ${a.origin===o?'selected':''}>${esc(o)}</option>`).join('')}
          </select>
          <select class="art-alloc-f" data-f="lotId" ${!a.origin?'disabled':''}>
            <option value="">${esc(T('alloc.pickLot'))}</option>
            ${lotOptionsFor(it, a.origin, i, ai, a.lotId)}
          </select>
          <input type="number" class="art-alloc-f art-alloc-qty" data-f="qty" value="${a.qty||''}" min="1" step="1" placeholder="${esc(T('alloc.qty'))}">
          <button type="button" class="acc-icon art-alloc-del">✕</button>
        </div>`).join('');
      return `<div class="art-alloc" data-i="${i}">
        <div class="art-alloc-head"><span>${esc(T('alloc.title'))}</span><span class="art-alloc-sum ${ok?'':'art-alloc-bad'}">${sum}/${it.qty||0}</span></div>
        ${rows}
        <button type="button" class="btn btn-ghost art-alloc-add">${esc(T('alloc.add'))}</button>
      </div>`;
    }
    function colorHtml(it, i){
      const cols = colorsOf(it.productId);
      if(!cols.length) return '';
      const prod = products.find(x=> x.id === it.productId);
      const sel = cols.find(c=> c.id === it.colorId);
      return `<div class="art-item-colorbar" data-i="${i}">
        <span class="pc-dot" style="background:${esc(sel ? (sel.hex||'#888') : 'transparent')}"></span>
        <span class="art-item-colorlabel">${esc(T('pc.colorLabel'))}</span>
        <select class="art-item-color" data-f="colorId">
          <option value="">${esc(T('pc.pickColor'))}</option>
          ${cols.map(c=> `<option value="${esc(c.id)}" ${it.colorId===c.id?'selected':''}>${esc(c.name||'-')} \u00B7 ${esc(T('alloc.left'))} ${stockOfColor(prod, c.id).remaining}${c.price!=null?' \u00B7 \u0E3F'+fmt(c.price):''}</option>`).join('')}
        </select>
      </div>`;
    }
    function drawItems(){
      const opts = (id)=> products.map(p=> `<option value="${p.id}" ${p.id===id?'selected':''}>${esc(p.name)}${p.sku?` (${esc(p.sku)})`:''} · ฿${fmt(p.price)}</option>`).join('');
      g('oItems').innerHTML = items.map((it,i)=> `
        <div class="art-item-row" data-i="${i}">
          <select class="art-item-select" data-f="productId">
            <option value="">${esc(T('rev.pickProduct'))}</option>
            ${opts(it.productId)}
          </select>
          <input type="number" class="art-item-qty" data-f="qty" value="${it.qty}" step="1" min="1">
          <input type="number" class="art-item-price" data-f="price" value="${it.price}" step="0.01" placeholder="${esc(T('rev.itemPrice'))}">
          <input type="number" class="art-item-disc" data-f="discount" value="${it.discount||0}" step="0.01" min="0">
          <select class="art-item-disctype" data-f="discountType">${discTypeOpts(it.discountType)}</select>
          <span class="art-item-net" data-net="${i}">${fmt(itemNet(it))}${it.salePercent?` <i class="art-item-sale">-${it.salePercent}%</i>`:''}</span>
          <button type="button" class="acc-icon art-item-del" ${items.length<=1?'disabled':''}>✕</button>
        </div>${colorHtml(it,i)}${allocHtml(it,i)}`).join('');
      g('oItems').querySelectorAll('.art-item-row').forEach(r=>{
        const i = parseInt(r.dataset.i,10);
        // Product select: pick from catalog → fills productId, name, price.
        r.querySelector('.art-item-select').addEventListener('change', (e)=>{
          const p = products.find(x=> x.id === e.target.value);
          if(p){
            items[i].productId = p.id; items[i].productName = p.name;
            const pct = activePromoPercent(p.id);
            if(pct > 0){
              // Auto-apply the active promotion: fill the discounted unit price and
              // stamp the % on the line so the bill shows a tag. Price stays
              // editable afterward for manual tweaks.
              items[i].salePercent = pct;
              items[i].price = Math.round(p.price * (1 - pct/100) * 100) / 100;
            }else{
              items[i].salePercent = 0;
              items[i].price = p.price;
            }
            items[i].colorId = null; items[i].colorName = '';
          }
          else { items[i].productId = null; items[i].productName = ''; items[i].salePercent = 0; items[i].colorId = null; items[i].colorName = ''; }
          items[i].costAllocation = [];   // product changed → clear cost-lot allocation
          drawItems(); updatePreview();
        });
        r.querySelectorAll('[data-f="discount"]').forEach(inp=> inp.addEventListener('input', ()=>{ items[i].discount = parseFloat(inp.value)||0; updatePreview(); }));
        r.querySelectorAll('[data-f="discountType"]').forEach(sel=> sel.addEventListener('change', ()=>{ items[i].discountType = sel.value; updatePreview(); }));
        // qty / price: update state + preview (price stays editable for special deals).
        r.querySelectorAll('[data-f="qty"], [data-f="price"]').forEach(inp=> inp.addEventListener('input', ()=>{
          items[i][inp.dataset.f] = parseFloat(inp.value)||0;
          if(inp.dataset.f==='qty'){ const b = g('oItems').querySelector(`.art-alloc[data-i="${i}"] .art-alloc-sum`); if(b){ const sm=allocSum(items[i]); b.textContent=sm+'/'+(items[i].qty||0); b.classList.toggle('art-alloc-bad', sm!==(items[i].qty||0)); } }
          updatePreview();
        }));
        r.querySelector('.art-item-del').addEventListener('click', ()=>{ if(items.length>1){ items.splice(i,1); drawItems(); updatePreview(); } });
      });
      g('oItems').querySelectorAll('.art-item-colorbar').forEach(bar=>{
        const i = parseInt(bar.dataset.i,10);
        bar.querySelector('.art-item-color').addEventListener('change', (e)=>{
          const cid = e.target.value || null;
          const c = colorsOf(items[i].productId).find(x=> x.id === cid);
          items[i].colorId = cid;
          items[i].colorName = c ? (c.name||'') : '';
          if(c && c.price != null){
            const pct = items[i].salePercent || 0;
            items[i].price = pct > 0 ? Math.round(c.price * (1 - pct/100) * 100) / 100 : Number(c.price);
          }
          items[i].costAllocation = [];   // colour changed → its lots differ
          drawItems(); updatePreview();
        });
      });
      g('oItems').querySelectorAll('.art-alloc').forEach(al=>{
        const i = parseInt(al.dataset.i,10);
        al.querySelectorAll('.art-alloc-row').forEach(rr=>{
          const ai = parseInt(rr.dataset.ai,10);
          rr.querySelector('[data-f="origin"]').addEventListener('change', (e)=>{
            const a = items[i].costAllocation[ai]; a.origin = e.target.value; a.lotId = ''; a.cost = 0;
            drawItems();
          });
          const lotSel = rr.querySelector('[data-f="lotId"]');
          if(lotSel) lotSel.addEventListener('change', (e)=>{
            const lot = lots.find(l=> l.id===e.target.value); const a = items[i].costAllocation[ai];
            a.lotId = e.target.value; a.cost = lot ? lot.cost : 0; if(lot) a.origin = lot.origin;
            drawItems();
          });
          const q = rr.querySelector('[data-f="qty"]');
          if(q) q.addEventListener('input', ()=>{
            items[i].costAllocation[ai].qty = parseInt(q.value)||0;
            const b = al.querySelector('.art-alloc-sum'); const sm = allocSum(items[i]);
            if(b){ b.textContent = sm+'/'+(items[i].qty||0); b.classList.toggle('art-alloc-bad', sm!==(items[i].qty||0)); }
          });
          rr.querySelector('.art-alloc-del').addEventListener('click', ()=>{ items[i].costAllocation.splice(ai,1); drawItems(); });
        });
        al.querySelector('.art-alloc-add').addEventListener('click', ()=>{
          if(!items[i].costAllocation) items[i].costAllocation = [];
          items[i].costAllocation.push({ origin:'', lotId:'', cost:0, qty:0 });
          drawItems();
        });
      });
      if(g('oShipList')){ fillShipList(); updatePreview(); }
    }
    const catOfItem = (it)=>{ const pr=products.find(x=> x.id===it.productId); return pr ? (pr.productType||'') : ''; };
    const discAmt = (base, val, type)=> (type==='percent' ? base*(Math.abs(val)||0)/100 : Math.abs(val)||0);
    const itemGross = (it)=> (it.qty||0)*(it.price||0);
    const itemNet = (it)=> itemGross(it) - discAmt(itemGross(it), it.discount||0, it.discountType||'baht');
    function shipRows(){ const cats=[...new Set(items.map(catOfItem).filter(Boolean))]; return cats.map(c=> ({ cat:c, cost: shipCostFor(c, addr.pCode) })); }
    function shipNetOf(r){ const d=shipDiscByCat[r.cat]||{}; return r.cost - discAmt(r.cost, d.v||0, d.type||'baht'); }
    function computeShipping(){
      if(shipOverride!=null && shipOverride!=='') return Math.abs(parseFloat(shipOverride))||0;
      const rows=shipRows();
      if(shipInclude===null) shipInclude=new Set(rows.map(r=> r.cat));
      return rows.filter(r=> shipInclude.has(r.cat)).reduce((s,r)=> s+shipNetOf(r), 0);
    }
    function fillShipList(){
      const box=g('oShipList'); if(!box) return;
      const rows=shipRows();
      if(shipInclude===null) shipInclude=new Set(rows.map(r=> r.cat));
      if(!rows.length){ box.innerHTML = `<p class="art-ship-empty">${esc(T('rev.shipNoCat'))}</p>`; return; }
      const header = `<div class="art-ship-cols"><span></span><span></span><span></span><span>${esc(T('rev.itemDisc'))}</span><span></span><span>${esc(T('rev.itemNet'))}</span></div>`;
      box.innerHTML = header + rows.map(r=>{ const d=shipDiscByCat[r.cat]||{}; return `<div class="art-ship-row"><input type="checkbox" class="art-ship-cb" data-cat="${esc(r.cat)}" ${shipInclude.has(r.cat)?'checked':''}><span class="art-ship-cat">${esc(dispName('productTypes', r.cat))}</span><span class="art-ship-cost">${fmt(r.cost)}</span><input type="number" class="art-ship-disc" data-cat="${esc(r.cat)}" value="${d.v||0}" step="0.01" min="0"><select class="art-ship-disctype" data-cat="${esc(r.cat)}">${discTypeOpts(d.type)}</select><span class="art-ship-net" data-shipnet="${esc(r.cat)}">${fmt(shipNetOf(r))}</span></div>`; }).join('');
      box.querySelectorAll('.art-ship-cb').forEach(cb=> cb.addEventListener('change', ()=>{ if(cb.checked) shipInclude.add(cb.dataset.cat); else shipInclude.delete(cb.dataset.cat); updatePreview(); }));
      box.querySelectorAll('.art-ship-disc').forEach(inp=> inp.addEventListener('input', ()=>{ const c=inp.dataset.cat; shipDiscByCat[c]=shipDiscByCat[c]||{}; shipDiscByCat[c].v=parseFloat(inp.value)||0; updatePreview(); }));
      box.querySelectorAll('.art-ship-disctype').forEach(sel=> sel.addEventListener('change', ()=>{ const c=sel.dataset.cat; shipDiscByCat[c]=shipDiscByCat[c]||{}; shipDiscByCat[c].type=sel.value; updatePreview(); }));
    }
    function updatePreview(){
      const itemsGross = items.reduce((s,it)=> s+itemGross(it), 0);
      const itemsNet = items.reduce((s,it)=> s+itemNet(it), 0);
      const shipping = computeShipping();
      const srows = shipRows();
      const shipGross = (shipOverride!=null && shipOverride!=='') ? shipping : srows.filter(r=> shipInclude && shipInclude.has(r.cat)).reduce((a,r)=> a+(r.cost||0), 0);
      const sub = itemsNet + shipping;
      const overallAmt = discAmt(sub, parseFloat(g('oOverallDisc').value)||0, g('oOverallDiscType')?g('oOverallDiscType').value:'baht');
      const net = sub - overallAmt;
      const totalDisc = (itemsGross - itemsNet) + (shipGross - shipping) + overallAmt;
      g('oPvItems').textContent = fmt(itemsNet);
      if(g('oPvShip')) g('oPvShip').textContent = fmt(shipping);
      if(g('oPvDisc')) g('oPvDisc').textContent = fmt(totalDisc);
      const vatOn = g('oVat') ? g('oVat').checked : false;
      const splitNow = oSplitMode === 'split';
      const vatBase = splitNow ? Math.max(0, itemsNet - overallAmt) : net;   // shipping is outside a split bill's VAT
      const vatAmt = vatOn ? vatBase * 0.07 : 0;
      const netWithVat = net + vatAmt;
      const pvVat = g('oPvVat');
      if(pvVat) pvVat.parentElement.style.display = vatOn ? '' : 'none';
      if(pvVat) pvVat.textContent = fmt(vatAmt);
      g('oPvNet').textContent = fmt(netWithVat);
      const paid = parseFloat(g('oPaid') ? g('oPaid').value : 0) || 0;
      const pendEl = g('oPending');
      if(pendEl){
        const _pn = paidStatusName();
        const _isPaid = !!_pn && g('oIs') && g('oIs').value === _pn;
        const pend = _isPaid ? 0 : (netWithVat - paid);
        pendEl.textContent = fmt(pend);
        pendEl.classList.toggle('art-pending-clear', pend <= 0 && net > 0);
      }
      const box=g('oItems'); if(box) items.forEach((it,i)=>{ const el=box.querySelector('.art-item-net[data-net="'+i+'"]'); if(el) el.innerHTML = fmt(itemNet(it)) + (it.salePercent?` <i class="art-item-sale">-${it.salePercent}%</i>`:''); });
      const sbox=g('oShipList'); if(sbox){ const srows=shipRows(); sbox.querySelectorAll('.art-ship-net').forEach(el=>{ const r=srows.find(x=> x.cat===el.dataset.shipnet); if(r) el.textContent=fmt(shipNetOf(r)); }); }
    }
    function updateInv(){
      const date = g('oDate').value;
      if(!date){ g('ordInvPreview').textContent='-'; return; }
      if(ordEditingId && row && date === row.date){ g('ordInvPreview').textContent = row.invoiceNumber || '-'; }
      else g('ordInvPreview').textContent = generateInvoiceNumber(date, ordEditingId);
    }
    drawItems(); fillShipList(); updatePreview(); updateInv();
    g('oAddItem').addEventListener('click', ()=>{ items.push({ productName:'', qty:1, price:0, colorId:null, colorName:'', costAllocation:[] }); drawItems(); fillShipList(); updatePreview(); });
    // ---- payment slips: up to five images per bill ----
    let payProofs = (row && Array.isArray(row.paymentProofs)) ? row.paymentProofs.slice(0,5) : [];
    function drawPayProofs(){
      const wrap = g('oPayProofs'); if(!wrap) return;
      wrap.innerHTML = payProofs.map((f,i)=> `<span class="pi-thumb"><img src="${esc(f.src)}" alt=""><button type="button" class="pi-rm" data-j="${i}" title="${esc(T('delete'))}">\u2715</button></span>`).join('')
        + (payProofs.length < 5 ? `<label class="pi-add"><input type="file" id="oProofInput" accept="image/*" multiple><span>+</span></label>` : '');
      wrap.querySelectorAll('.pi-rm').forEach(b=> b.addEventListener('click', (e)=>{ e.preventDefault(); payProofs.splice(+b.dataset.j, 1); drawPayProofs(); }));
      const inp = wrap.querySelector('#oProofInput');
      if(inp) inp.addEventListener('change', (e)=>{
        Array.from(e.target.files || []).forEach(file=>{
          if(payProofs.length >= 5) return;
          if(file.size > 256*1024){ alert(T('bill.tooBig')); return; }
          const rd = new FileReader();
          rd.onload = ()=>{ if(payProofs.length < 5){ payProofs.push({ src: rd.result, name: file.name || '' }); drawPayProofs(); } };
          rd.readAsDataURL(file);
        });
      });
    }
    drawPayProofs();
    // ---- signature: draw with the mouse/finger, or upload an image ----
    let signData = row ? (row.sellerSignature || null) : null;
    let signDirty = !!signData;
    (function initSign(){
      const cv = g('oSignPad'); if(!cv) return;
      const ctx = cv.getContext('2d');
      ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = '#111';
      const paint = ()=>{
        ctx.clearRect(0,0,cv.width,cv.height);
        if(!signData) return;
        const img = new Image();
        img.onload = ()=>{
          const sc = Math.min(cv.width/img.width, cv.height/img.height, 1);
          const w = img.width*sc, h = img.height*sc;
          ctx.drawImage(img, (cv.width-w)/2, (cv.height-h)/2, w, h);
        };
        img.src = signData;
      };
      paint();
      let drawing = false;
      const pos = (e)=>{
        const r = cv.getBoundingClientRect();
        const p = (e.touches && e.touches[0]) ? e.touches[0] : e;
        return { x: (p.clientX - r.left) * (cv.width / r.width), y: (p.clientY - r.top) * (cv.height / r.height) };
      };
      const start = (e)=>{ e.preventDefault(); drawing = true; const q = pos(e); ctx.beginPath(); ctx.moveTo(q.x, q.y); };
      const move  = (e)=>{ if(!drawing) return; e.preventDefault(); const q = pos(e); ctx.lineTo(q.x, q.y); ctx.stroke(); };
      const end   = ()=>{ if(!drawing) return; drawing = false; signData = cv.toDataURL('image/png'); signDirty = true; };
      cv.addEventListener('mousedown', start); cv.addEventListener('mousemove', move);
      window.addEventListener('mouseup', end);
      cv.addEventListener('touchstart', start, { passive:false });
      cv.addEventListener('touchmove', move, { passive:false });
      cv.addEventListener('touchend', end);
      g('oSignClear').addEventListener('click', ()=>{ signData = null; signDirty = false; ctx.clearRect(0,0,cv.width,cv.height); });
      g('oSignFile').addEventListener('change', (e)=>{
        const file = e.target.files[0]; if(!file) return;
        if(file.size > 256*1024){ alert(T('bill.tooBig')); e.target.value=''; return; }
        const rd = new FileReader();
        rd.onload = ()=>{ signData = rd.result; signDirty = true; paint(); };
        rd.readAsDataURL(file);
      });
    })();
    g('oPlatform').addEventListener('change', ()=>{
      const pl = (config.platforms||[]).find(x=> x.name === g('oPlatform').value);
      g('oFeePct').value = (pl && pl.fee) ? pl.fee : '';
    });
    g('oPaid').addEventListener('input', updatePreview);
    g('oVat').addEventListener('change', updatePreview);
    g('oIs').addEventListener('change', updatePreview);   // settled bills owe nothing
    body.querySelectorAll('#oSplit [data-split]').forEach(btn=> btn.addEventListener('click', ()=>{
      oSplitMode = btn.dataset.split;
      body.querySelectorAll('#oSplit [data-split]').forEach(x=> x.classList.toggle('active', x.dataset.split === oSplitMode));
      updatePreview();
    }));
    g('oOverallDisc').addEventListener('input', updatePreview);
    g('oOverallDiscType').addEventListener('change', updatePreview);
    g('oShipOverride').addEventListener('input', ()=>{ const v=g('oShipOverride').value; shipOverride=(v===''?null:v); updatePreview(); });
    g('oDate').addEventListener('change', updateInv);

    // ---- structured address cascade (lazy TH geography) ----
    const geoP = ()=> (window.__thGeo ? window.__thGeo.p : []);
    const geoD = (pc)=> (window.__thGeo ? window.__thGeo.d.filter(d=> d[1]===pc) : []);
    const geoS = (dc)=> (window.__thGeo ? window.__thGeo.s.filter(x=> x[1]===dc) : []);
    const geoLang = ()=> (((window.appLang && window.appLang()) || 'th') === 'en' ? 'en' : 'th');
    const provName = (c)=>{ const p=geoP().find(x=> x[0]===c); return p ? (geoLang()==='en'?p[2]:p[1]) : ''; };
    function renderLegend(){ const lg=g('oMapLegend'); if(!lg) return; lg.innerHTML = regionKeys().map(k=> `<span class="th-legend-item"><i class="th-swatch th-sw-${k}"></i>${esc(T('region.'+k))}</span>`).join(''); }
    function updateSelectedLabel(){ const el=g('oMapSel'); if(!el) return; el.textContent = addr.pCode ? (T('rev.selProvince')+': '+provName(addr.pCode)) : T('rev.noProvince'); }
    function fillProvince(){ const sel=g('oProvince'); if(!sel) return; sel.innerHTML = `<option value="">— ${esc(T('rev.province'))} —</option>` + geoP().map(p=> `<option value="${p[0]}" ${addr.pCode===p[0]?'selected':''}>${esc(geoLang()==='en'?p[2]:p[1])}</option>`).join(''); }
    function fillDistrict(){ const sel=g('oDistrict'); if(!sel) return; sel.innerHTML = `<option value="">— ${esc(T('rev.district'))} —</option>` + geoD(addr.pCode).map(d=> `<option value="${d[0]}" ${addr.dCode===d[0]?'selected':''}>${esc(geoLang()==='en'?d[3]:d[2])}</option>`).join(''); sel.disabled = !addr.pCode; }
    function fillSubdistrict(){ const sel=g('oSubdistrict'); if(!sel) return; sel.innerHTML = `<option value="">— ${esc(T('rev.subdistrict'))} —</option>` + geoS(addr.dCode).map(x=> `<option value="${x[0]}" ${addr.sCode===x[0]?'selected':''}>${esc(geoLang()==='en'?x[3]:x[2])}</option>`).join(''); sel.disabled = !addr.dCode; }
    function initAddress(){ const ln=g('oAddrLine'); if(ln) ln.value=addr.line1||''; const pin=g('oPostal'); if(pin) pin.value=addr.postal||''; fillProvince(); fillDistrict(); fillSubdistrict(); }
    function highlightMap(){ const box=g('oMap'); if(!box) return; box.querySelectorAll('.th-prov-g').forEach(el=> el.classList.toggle('selected', parseInt(el.dataset.code,10)===addr.pCode)); updateSelectedLabel(); }
    function setProvince(pc){ addr.pCode = pc||null; addr.dCode=null; addr.sCode=null; addr.postal=''; const ps=g('oProvince'); if(ps) ps.value = pc||''; const pin=g('oPostal'); if(pin) pin.value=''; fillDistrict(); fillSubdistrict(); highlightMap(); }
    function renderMap(){
      const box=g('oMap'); if(!box) return;
      if(!window.__thMap){ box.textContent=''; return; }
      const m=window.__thMap;
      const provs = m.paths.map(pp=> `<g class="th-prov-g" data-code="${pp.c}"><path class="th-prov th-r-${regionOfProvince(pp.c)}" d="${pp.d}"><title>${esc(provName(pp.c))}</title></path><text class="th-prov-lbl" x="${pp.x}" y="${pp.y}">${esc(provName(pp.c))}</text></g>`).join('');
      const lines = (regionMode()==='4'?m.regions4:m.regions6).map(r=> `<path class="th-region-line" d="${r.d}"/>`).join('');
      box.innerHTML = `<svg viewBox="${m.viewBox}" class="th-map" xmlns="http://www.w3.org/2000/svg">${provs}${lines}</svg>`;
      box.querySelectorAll('.th-prov-g').forEach(el=> el.addEventListener('click', ()=> setProvince(parseInt(el.dataset.code,10))));
      renderLegend(); highlightMap();
    }
    g('oAddrLine').addEventListener('input', e=>{ addr.line1 = e.target.value; });
    g('oPostal').addEventListener('input', e=>{ addr.postal = e.target.value; });
    g('oProvince').addEventListener('change', e=>{ setProvince(e.target.value?parseInt(e.target.value,10):null); });
    g('oDistrict').addEventListener('change', e=>{ addr.dCode = e.target.value?parseInt(e.target.value,10):null; addr.sCode=null; addr.postal=''; g('oPostal').value=''; fillSubdistrict(); });
    g('oSubdistrict').addEventListener('change', e=>{ addr.sCode = e.target.value?parseInt(e.target.value,10):null; const x = geoS(addr.dCode).find(y=> y[0]===addr.sCode); addr.postal = x?String(x[4]):''; g('oPostal').value = addr.postal; });
    ensureThGeo().then(()=> initAddress());
    Promise.all([ensureThGeo(), ensureThMap()]).then(()=> renderMap());

    // ---- delivery method + responsible (conditional) ----
    function respRole(){ const t=(config.shippingTypes||[]).find(s=> s.name===delMethod); return t ? (t.role||'') : ''; }
    function renderResponsible(){
      const wrap=g('oRespWrap'); if(!wrap) return;
      const role=respRole();
      if(role==='our'){
        const drivers = (typeof window.employeesByRoleType==='function' ? window.employeesByRoleType('driver') : []);
        wrap.innerHTML = `<select id="oResp"><option value="">${esc(T('rev.pickResp'))}</option>${drivers.map(d=> `<option value="${esc(d.name)}" ${delResp===d.name?'selected':''}>${esc(d.name)}</option>`).join('')}</select>`;
      } else if(role==='outsource'){
        wrap.innerHTML = `<select id="oResp"><option value="">${esc(T('rev.pickResp'))}</option>${(config.outsources||[]).map(o=> `<option value="${esc(o.name)}" ${delResp===o.name?'selected':''}>${esc(o.name)}</option>`).join('')}</select>`;
      } else {
        wrap.innerHTML = `<input type="text" id="oResp" value="${esc(delResp)}" placeholder="${esc(T('rev.respHint'))}">`;
      }
      const el=g('oResp');
      if(el){ el.addEventListener('change', ()=>{ delResp=el.value; }); el.addEventListener('input', ()=>{ delResp=el.value; }); }
      renderProof();
    }
    function renderProof(){
      const box=g('oProofWrap'); if(!box) return;
      if(respRole()!=='outsource'){ box.innerHTML=''; return; }
      box.innerHTML = `<div class="art-proof-field"><label class="art-proof-lbl">${esc(T('rev.proofLabel'))}</label>
        <div class="art-proof-row">
          <label class="file-picker"><input type="file" id="oProofFile" accept="image/*,.pdf"><span class="file-picker-btn">${esc(T('rev.proofPick'))}</span></label>
          <span class="art-proof-name">${deliveryProof ? esc(T('rev.proofAttached')) : esc(T('rev.proofNone'))}</span>
          ${deliveryProof ? `<button type="button" class="acc-icon" id="oProofClear" title="${esc(T('delete'))}">\u2715</button>` : ''}
        </div></div>`;
      const fi=g('oProofFile');
      if(fi) fi.addEventListener('change', (e)=>{ const f=e.target.files[0]; if(!f) return; if(f.size>256*1024){ alert(T('bill.tooBig')); e.target.value=''; return; } const r=new FileReader(); r.onload=()=>{ deliveryProof=r.result; renderProof(); }; r.readAsDataURL(f); });
      const clr=g('oProofClear'); if(clr) clr.addEventListener('click', ()=>{ deliveryProof=null; renderProof(); });
    }
    const _dm=g('oDeliveryMethod');
    if(_dm) _dm.addEventListener('change', ()=>{ delMethod=_dm.value; delResp=''; renderResponsible(); });
    renderResponsible();

    const close = ()=> (typeof onDone === 'function' ? onDone() : renderRevenuePage(body));
    const backBtn = g('oBack'); if(backBtn) backBtn.addEventListener('click', close);
    g('oCancel').addEventListener('click', close);
    g('oSave').addEventListener('click', async ()=>{
      const date = g('oDate').value;
      const customerName = g('oCustomer').value.trim();
      if(!date){ alert(T('exp.errDate')); return; }
      if(!customerName){ alert(T('rev.errCustomer')); return; }
      addr.line1 = g('oAddrLine').value.trim(); addr.postal = g('oPostal').value.trim();
      const _prov = geoP().find(p=> p[0]===addr.pCode), _dist = geoD(addr.pCode).find(d=> d[0]===addr.dCode), _subd = geoS(addr.dCode).find(x=> x[0]===addr.sCode);
      if(!addr.line1){ alert(T('rev.errAddrLine')); return; }
      if(!_prov || !_dist || !_subd){ alert(T('rev.errAddrGeo')); return; }
      const _addr = {
        str: `${addr.line1} ต.${_subd[2]} อ.${_dist[2]} จ.${_prov[1]} ${addr.postal}`.trim(),
        parts: { line1:addr.line1, provinceCode:addr.pCode, provinceName:_prov[1], districtCode:addr.dCode, districtName:_dist[2], subdistrictCode:addr.sCode, subdistrictName:_subd[2], postalCode:addr.postal }
      };
      const cleanItems = items.filter(it=> it.productId || it.productName.trim());
      if(cleanItems.length === 0){ alert(T('rev.errItems')); return; }
      if(cleanItems.some(it=> !it.productId)){ alert(T('rev.errPickProduct')); return; }
      if(!signData){ alert(T('sell.errSign')); return; }
      const _noColor = cleanItems.find(it=> colorsOf(it.productId).length && !it.colorId);
      if(_noColor){ alert(T('rev.errPickColor').replace('{p}', _noColor.productName||'')); return; }
      // cost-lot allocation: each item must be fully allocated; no lot over-drawn.
      const perLot = {};
      for(const it of cleanItems){
        it.costAllocation = (it.costAllocation||[]).filter(a=> a.lotId && a.qty>0);
        const sm = it.costAllocation.reduce((x,a)=> x+(a.qty||0), 0);
        if(sm !== (it.qty||0)){ alert(T('alloc.errSum').replace('{p}', it.productName).replace('{a}', sm).replace('{q}', it.qty||0)); return; }
        it.costAllocation.forEach(a=> perLot[a.lotId] = (perLot[a.lotId]||0) + a.qty);
      }
      for(const lotId in perLot){
        const lot = lots.find(l=> l.id===lotId);
        const avail = (lot? (lot.qtyIn||0):0) - usedByOtherOrders(lotId);
        if(perLot[lotId] > avail){ alert(T('alloc.errOver').replace('{o}', lot?lot.origin:'').replace('{c}', lot?fmt(lot.cost):'')); return; }
      }
      const data = {
        id: ordEditingId || rid(), date, customerName, phone: (g('oPhone').value||'').trim(), address: _addr.str, addressParts: _addr.parts, deliveryMethod: delMethod, deliveryResponsible: delResp,
        platform: g('oPlatform').value.trim(),
        deliveryProof: deliveryProof,
        items: cleanItems,
        shipInclude: [...(shipInclude||[])],
        shippingOverride: (g('oShipOverride').value===''?null:Math.abs(parseFloat(g('oShipOverride').value)||0)),
        shippingCost: computeShipping(),
        shipDiscByCat: shipDiscByCat,
        remark: g('oRemark') ? g('oRemark').value.trim() : '',
        vatable: g('oVat') ? g('oVat').checked : false,
        docSplit: oSplitMode,
        paymentProofs: payProofs.slice(0,5),
        seller: (row && row.seller) ? row.seller : sellerNameOf(),
        sellerSignature: signData || null,
        platformFee: Math.abs(parseFloat(g('oFeePct').value)||0),
        platformFeeAmount: Math.abs(parseFloat(g('oFeeAmt').value)||0),
        paymentMode: g('oPayMode') ? g('oPayMode').value : '',
        paidAmount: Math.abs(parseFloat(g('oPaid').value)||0),
        overallDiscount: Math.abs(parseFloat(g('oOverallDisc').value)||0),
        overallDiscountType: g('oOverallDiscType').value,
        note: g('oNote').value.trim(),
        tag: g('oTag').value, orderStatus: g('oOs').value, invoiceStatus: g('oIs').value
      };
      if(ordEditingId && row && date === row.date){ data.invoiceNumber = row.invoiceNumber || generateInvoiceNumber(date, ordEditingId); }
      else data.invoiceNumber = generateInvoiceNumber(date, ordEditingId);
      const _now = new Date().toISOString();
      if(ordEditingId){
        data.createdBy = (row && row.createdBy) || currentActorName();
        data.createdByLabel = (row && row.createdByLabel) || sellerNameOf();
        data.createdAt = (row && row.createdAt) || _now;
        data.editedBy = currentActorName(); data.editedAt = _now;
      }else{
        data.createdBy = currentActorName();
        data.createdByLabel = sellerNameOf();   // employee name, or Admin/Developer
        data.createdAt = _now;
      }
      if(ordEditingId){ orders = orders.map(o=> o.id===ordEditingId ? data : o); logRec(orderLog, saveOrderLog, data.id, data.invoiceNumber, 'edit', data); }
      else { orders.push(data); logRec(orderLog, saveOrderLog, data.id, data.invoiceNumber, 'create', data); }
      await saveOrders();
      close();
    });
  }

  /* ================= Products page (PIN-gated) ================= */
  // Public stock snapshot for shop.html: remaining per product + per colour.
  // Quantities ONLY — cost lots and orders never leave the back office.
  async function syncPublicStock(){
    // Status follows stock, so refresh it here — this runs after every save that
    // can move stock (products, lots, orders). Written directly to avoid
    // recursing back into saveProducts().
    if(syncProductTags()) await window.Store.set(K_PRODUCTS, products);
    const snap = {};
    products.forEach(p=>{
      const entry = { total: stockOf(p).remaining, colors: {} };
      if(p.hasColors && Array.isArray(p.colors)) p.colors.forEach(c=>{ entry.colors[c.id] = stockOfColor(p, c.id).remaining; });
      snap[p.id] = entry;
    });
    await window.Store.set(K_STOCKPUB, snap);
  }
  // Buying stock IS an expense: every restock (and a new product's opening
  // stock) posts one row under the locked "Product" tag. Marked auto:true so
  // it's traceable back to the stock movement.
  function productTagName(){
    const t = (config.expenseTags||[]).find(x=> x.role === 'product');
    return t ? t.name : 'Product';
  }
  function postStockExpense(o){
    const qty = o.qty || 0, cost = o.cost || 0;
    if(qty <= 0 || cost <= 0) return null;
    const tag = productTagName();
    const rec = computeRow({
      id: rid(), date: o.date, details: o.details || '', tag,
      costPerPiece: cost, amount: qty, shippingFee: 0, discount: 0,
      purchaseFrom: o.origin || '', note: o.note || ''
    });
    rec.expenseId = generateExpenseId(o.date, tag, null);
    rec.auto = true;
    rec.autoSource = o.source || 'stock';
    rec.productId = o.productId || null;
    rec.colorId = o.colorId || null;
    expenses.push(rec);
    return rec;
  }
  async function saveProducts(){ await window.Store.set(K_PRODUCTS, products); await syncPublicStock(); }
  async function saveStockLog(){ await window.Store.set(K_STOCKLOG, stockLog); }
  async function saveLots(){ await window.Store.set(K_LOTS, lots); await syncPublicStock(); }
  function lotsOf(prod){ return lots.filter(l=> l.productId === prod.id); }
  // Colour is a subset of the product; a cost lot is a subset of the colour.
  function lotsOfColor(prod, colorId){ const cid = colorId || null; return lots.filter(l=> l.productId === prod.id && (l.colorId||null) === cid); }
  function stockOfColor(prod, colorId){
    const cid = colorId || null;
    const paidName = (statusByRole('invoiceStatuses','paid') || {}).name;
    let reserved = 0, sold = 0;
    orders.forEach(o=>{
      const qty = (o.items||[]).filter(it=> it.productId === prod.id && (it.colorId||null) === cid).reduce((sm,it)=> sm+(it.qty||0), 0);
      if(qty === 0) return;
      if(paidName && o.invoiceStatus === paidName) sold += qty; else reserved += qty;
    });
    const totalIn = lotsOfColor(prod, cid).reduce((sm,l)=> sm + (l.qtyIn||0), 0);
    return { reserved, sold, remaining: totalIn - reserved - sold };
  }
  function avgCostOfColor(prod, colorId){
    const ls = lotsOfColor(prod, colorId);
    const q = ls.reduce((sm,l)=> sm + (l.qtyIn||0), 0);
    if(!q) return 0;
    return ls.reduce((sm,l)=> sm + (Number(l.cost)||0) * (l.qtyIn||0), 0) / q;
  }
  function priceLabelOf(prod){
    const cols = (prod.hasColors && Array.isArray(prod.colors)) ? prod.colors.filter(c=> c.price != null && c.price !== '') : [];
    if(!cols.length) return fmt(prod.price);
    const ps = cols.map(c=> Number(c.price)||0);
    const mn = Math.min.apply(null, ps), mx = Math.max.apply(null, ps);
    return mn === mx ? fmt(mn) : fmt(mn) + ' - ' + fmt(mx);
  }
  // Per-lot reserved/sold from order costAllocation (all 0 until Lot 2 fills allocations,
  // then a sale that pulled from a lot shows up on that lot's detail row).
  function lotAlloc(lot){
    const paidName = (statusByRole('invoiceStatuses','paid') || {}).name;
    let reserved = 0, sold = 0;
    orders.forEach(o=>{
      let q = 0;
      (o.items||[]).forEach(it=> (it.costAllocation||[]).forEach(a=>{ if(a.lotId===lot.id) q += (a.qty||0); }));
      if(q === 0) return;
      if(paidName && o.invoiceStatus === paidName) sold += q; else reserved += q;
    });
    return { reserved, sold };
  }
  function lotRemaining(lot){ const a = lotAlloc(lot); return (lot.qtyIn||0) - a.reserved - a.sold; }
  // Weighted average unit cost across a product's lots — shown in the main row's Cost column.
  function avgCost(prod){
    const ls = lotsOf(prod);
    const totIn = ls.reduce((s,l)=> s + (l.qtyIn||0), 0);
    if(!totIn) return prod.cost || 0;
    return ls.reduce((s,l)=> s + (l.cost||0)*(l.qtyIn||0), 0) / totIn;
  }
  // Restock / opening stock: MERGE into an existing lot with the SAME origin+cost,
  // otherwise start a new lot row (new price from same origin, or a new origin).
  function addToLot(productId, origin, cost, qty, by, colorId){
    const cid = colorId || null;
    const existing = lots.find(l=> l.productId===productId && l.origin===origin && Number(l.cost)===Number(cost) && (l.colorId||null)===cid);
    if(existing){ existing.qtyIn = (existing.qtyIn||0) + qty; }
    else { lots.push({ id: rid(), productId, colorId: cid, origin, cost, qtyIn: qty, bill: null, date: new Date().toISOString().slice(0,10), by }); }
  }

  // One-time migration: legacy products (single stock/cost, no lots) → an opening
  // cost lot each. Guarded by config.lotsMigrated so it runs once.
  async function migrateStockLots(){
    if(!config || config.lotsMigrated) return;
    let changed = false;
    products.forEach(p=>{
      if((p.stock||0) > 0 && !lots.some(l=> l.productId === p.id)){
        lots.push({ id: rid(), productId: p.id, origin: 'ยกมา', cost: p.cost||0, qtyIn: p.stock, bill: null, date: new Date().toISOString().slice(0,10), by: '-' });
        changed = true;
      }
    });
    if(changed && config.costOrigins && !config.costOrigins.some(o=> o.name === 'ยกมา')){
      config.costOrigins.push({ id: rid(), name: 'ยกมา', color: '#8A8F80' });
    }
    config.lotsMigrated = true;
    if(changed) await saveLots();
    await saveConfig();
  }

  // "Who did this" — auto-stamped on stock actions from the logged-in employee.
  // Developer login (roleKey 'developer') is recorded literally as "Developer".
  function currentActorName(){
    const e = window.currentEmployee;
    if(!e) return '—';
    if(e.roleKey === 'developer') return 'Developer';
    const full = ((e.name || '') + ' ' + (e.surname || '')).trim();
    return full || e.username || 'Developer';
  }
  // Who is issuing the bill. A real seller shows their own name; system accounts
  // stay generic — an admin is just "Admin", the dev account just "Developer".
  function sellerNameOf(){
    const e = window.currentEmployee;
    if(!e) return '—';
    if(e.roleKey === 'developer') return 'Developer';
    const rt = (typeof window.roleTypeOf === 'function') ? window.roleTypeOf(e.roleKey) : '';
    if(rt === 'admin' || e.roleKey === 'admin') return 'Admin';
    const full = ((e.name || '') + ' ' + (e.surname || '')).trim();
    return full || e.username || 'Admin';
  }
  // Per-role permission to change a given status/tag type (system roles = allowed).
  function canChange(target){ return (typeof window.roleCanAccess !== 'function') || window.roleCanAccess(window.currentRole, target); }
  // Lazy-load the bundled TH geography data (province/district/subdistrict + postal) on first use.
  let _thGeoP = null;
  function ensureThGeo(){
    if(window.__thGeo) return Promise.resolve(window.__thGeo);
    if(_thGeoP) return _thGeoP;
    _thGeoP = new Promise((resolve)=>{
      const sc = document.createElement('script');
      sc.src = 'js/data/th-geo.js';
      sc.onload = ()=> resolve(window.__thGeo || null);
      sc.onerror = ()=> resolve(null);
      document.head.appendChild(sc);
    });
    return _thGeoP;
  }
  let _thMapP = null;
  function ensureThMap(){
    if(window.__thMap) return Promise.resolve(window.__thMap);
    if(_thMapP) return _thMapP;
    _thMapP = new Promise((resolve)=>{
      const sc = document.createElement('script'); sc.src = 'js/data/th-map.js';
      sc.onload = ()=> resolve(window.__thMap || null); sc.onerror = ()=> resolve(null);
      document.head.appendChild(sc);
    });
    return _thMapP;
  }
  function prodTagColor(name){ return (PRODUCT_TAGS.find(t=> t.name === name) || {}).color || '#999'; }
  // In Stock while anything is left, Out of Stock the moment it runs out.
  function productStatusOf(p){ return stockOf(p).remaining > 0 ? 'In Stock' : 'Out of Stock'; }
  function prodTagLabel(name){ const t = PRODUCT_TAGS.find(x=> x.name === name); return t ? itemLabel(t) : name; }
  // Keeps the stored tag in step with reality (the storefront and exports read p.tag).
  function syncProductTags(){
    let changed = false;
    products.forEach(p=>{
      const want = productStatusOf(p);
      if(p.tag !== want){ p.tag = want; changed = true; }
    });
    return changed;
  }
  function ptypeColor(name){ return ((config.productTypes||[]).find(t=> t.name === name) || {}).color || '#999'; }
  // Category is stored on the product as its permanent `name` key; show the
  // Thai or English label for the current app language instead of the raw key.
  function ptypeLabel(name){ const t=(config.productTypes||[]).find(x=> x.name === name); return t ? itemLabel(t) : name; }
  function originColor(name){ return ((config.costOrigins||[]).find(o=> o.name === name) || {}).color || '#8A8F80'; }
  // Stock accounting for a product across all orders (matched by productId).
  //  reserved  = qty in orders billed but NOT yet paid
  //  sold      = qty in orders whose invoice status reached "paid"
  //  remaining = entered stock minus reserved and sold (real count left)
  function stockOf(prod){
    const paidName = (statusByRole('invoiceStatuses','paid') || {}).name;
    let reserved = 0, sold = 0;
    orders.forEach(o=>{
      const qty = (o.items||[]).filter(it=> it.productId === prod.id).reduce((s,it)=> s+(it.qty||0), 0);
      if(qty === 0) return;
      const isSold = paidName && o.invoiceStatus === paidName;
      if(isSold) sold += qty; else reserved += qty;
    });
    const totalIn = lots.reduce((sum,l)=> l.productId === prod.id ? sum + (l.qtyIn||0) : sum, 0);
    return { reserved, sold, remaining: totalIn - reserved - sold };
  }

  function renderProductsPage(body){
    renderProductsContent(body);
  }

  function renderProductsContent(body){
    body.innerHTML = `
      <div class="panel">
        <div class="art-toolbar">
          <div class="art-spacer"></div>
          <button class="btn btn-ghost" id="prodPromo">${esc(T('promo.btn'))}</button>
          <button class="btn btn-ghost" id="prodRestock">${esc(T('prod.restock'))}</button>
          <button class="btn btn-primary" id="prodAdd">${esc(T('prod.add'))}</button>
        </div>
        <div class="art-table-wrap">
          <table class="art-table" id="prodTable">
            <thead><tr>
              <th>${esc(T('prod.image'))}</th><th>${esc(T('prod.sku'))}</th><th>${esc(T('prod.name'))}</th>
              <th class="num">${esc(T('prod.cost'))}</th><th class="num">${esc(T('prod.price'))}</th>
              <th class="num">${esc(T('prod.sale'))}</th>
              <th class="num">${esc(T('prod.stock'))}</th><th class="num">${esc(T('prod.reserved'))}</th>
              <th class="num">${esc(T('prod.sold'))}</th>
              <th>${esc(T('prod.ptype'))}</th><th>${esc(T('prod.tag'))}</th><th>${esc(T('col.lastEdited'))}</th><th></th></tr></thead>
            <tbody id="prodTbody"></tbody>
          </table>
        </div>
        <div id="prodEmpty" class="art-empty" style="display:none;"><div class="art-empty-ico">🏷️</div>${esc(T('prod.empty'))}</div>
      </div>`;
    body.querySelector('#prodAdd').addEventListener('click', ()=> openProductModal(null, body));
    body.querySelector('#prodRestock').addEventListener('click', ()=> openRestockModal(body));
    body.querySelector('#prodPromo').addEventListener('click', ()=> openPromoManager(body));
    renderProductsTable(body);
  }

  // One aligned detail <tr> per lot — columns line up with the main product table.
  function lotRowHtml(l, cls, dataAttr, indent){
    const a = lotAlloc(l);
    const rem = (l.qtyIn||0) - a.reserved - a.sold;
    return `<tr class="${cls}" ${dataAttr} style="display:none;">
        <td></td><td></td>
        <td class="${indent?'prod-sub2':''}"><span class="art-pill" style="background:${originColor(l.origin)}">${esc(l.origin||'-')}</span></td>
        <td class="num">${fmt(l.cost)}</td>
        <td></td><td></td>
        <td class="num">${rem}</td>
        <td class="num art-reserved">${a.reserved || '-'}</td>
        <td class="num art-sold">${a.sold || '-'}</td>
        <td></td><td></td><td></td><td></td>
      </tr>`;
  }
  function lotDetailRows(prod){
    const cols = (prod.hasColors && Array.isArray(prod.colors)) ? prod.colors : [];
    if(cols.length){
      const buckets = cols.map(c=> ({ id: c.id, label: c.name || '-', hex: c.hex || '#888', price: c.price }));
      if(lots.some(l=> l.productId === prod.id && !l.colorId)) buckets.push({ id: null, label: T('pc.noColor'), hex: '#6b6b6b', price: prod.price });
      return buckets.map(b=>{
        const st = stockOfColor(prod, b.id);
        const key = prod.id + '|' + (b.id || '_none');
        const ls = lotsOfColor(prod, b.id);
        const head = `<tr class="prod-lots-detail prod-color-row" data-lots="${prod.id}" data-ckey="${esc(key)}" style="display:none;">
        <td></td><td></td>
        <td class="prod-sub1"><span class="prod-color-toggle" data-ct="${esc(key)}">\u25B8</span><span class="pc-dot" style="background:${esc(b.hex)}"></span>${esc(b.label)}</td>
        <td class="num">${fmt(avgCostOfColor(prod, b.id))}</td>
        <td class="num">${b.price != null && b.price !== '' ? fmt(b.price) : '-'}</td>
        <td></td>
        <td class="num" style="font-weight:700;">${st.remaining}</td>
        <td class="num art-reserved">${st.reserved || '-'}</td>
        <td class="num art-sold">${st.sold || '-'}</td>
        <td></td><td></td><td></td><td></td>
      </tr>`;
        const lotRows = ls.length
          ? ls.map(l=> lotRowHtml(l, 'prod-clot-detail', `data-clots="${esc(key)}"`, true)).join('')
          : `<tr class="prod-clot-detail" data-clots="${esc(key)}" style="display:none;"><td></td><td></td><td colspan="11" class="prod-sub2" style="color:var(--c-muted); font-size:12.5px;">${esc(T('prod.noLots'))}</td></tr>`;
        return head + lotRows;
      }).join('');
    }
    const ls = lotsOf(prod);
    if(!ls.length){
      return `<tr class="prod-lots-detail" data-lots="${prod.id}" style="display:none;"><td></td><td></td><td colspan="11" style="color:var(--c-muted); font-size:12.5px;">${esc(T('prod.noLots'))}</td></tr>`;
    }
    return ls.map(l=> lotRowHtml(l, 'prod-lots-detail', `data-lots="${prod.id}"`, false)).join('');
  }
  function renderProductsTable(body){
    const tbody = body.querySelector('#prodTbody');
    const table = body.querySelector('#prodTable');
    const empty = body.querySelector('#prodEmpty');
    if(!tbody) return;
    if(products.length === 0){
      tbody.innerHTML=''; table.style.display='none'; empty.style.display='block';
    }else{
      table.style.display=''; empty.style.display='none';
      tbody.innerHTML = products.map(p=>{
        const thumb = p.image ? `<img class="art-prod-thumb" src="${p.image}" alt="">` : `<div class="art-prod-thumb art-prod-noimg">🏷️</div>`;
        const st = stockOf(p);
        const low = st.remaining <= 0;
        const salePct = activePromoPercent(p.id);
        return `<tr data-id="${p.id}">
          <td>${thumb}</td>
          <td class="art-id">${esc(p.sku)}</td>
          <td><span class="prod-lot-toggle" data-lt="${p.id}">▸</span>${esc(p.name)}</td>
          <td class="num">${fmt(avgCost(p))}</td>
          <td class="num">${priceLabelOf(p)}</td>
          <td class="num">${salePct ? `<span class="art-pill" style="background:var(--c-danger)">-${salePct}%</span>` : '<span style="color:var(--c-muted);">-</span>'}</td>
          <td class="num ${low?'art-neg':''}" style="font-weight:700;">${st.remaining}</td>
          <td class="num art-reserved">${st.reserved || '-'}</td>
          <td class="num art-sold">${st.sold || '-'}</td>
          <td>${p.productType ? `<span class="art-pill" style="background:${ptypeColor(p.productType)}">${esc(ptypeLabel(p.productType))}</span>` : '<span style="color:var(--c-muted);">-</span>'}</td>
          <td><span class="art-pill" style="background:${prodTagColor(productStatusOf(p))}">${esc(prodTagLabel(productStatusOf(p)))}</span></td>
          <td class="art-edited">${esc(editedLabel(p))}</td>
          <td><div class="art-row-actions">
            <button class="acc-icon art-prod-edit" title="${esc(T('edit'))}">✎</button>
            <button class="acc-icon art-prod-del" title="${esc(T('delete'))}">✕</button>
          </div></td>
        </tr>
        ${lotDetailRows(p)}`;
      }).join('');
      tbody.querySelectorAll('tr[data-id]').forEach(tr=>{
        const id = tr.dataset.id;
        tr.querySelector('.art-prod-edit').addEventListener('click', (e)=>{ e.stopPropagation(); openProductModal(products.find(p=>p.id===id), body); });
        tr.querySelector('.art-prod-del').addEventListener('click', async (e)=>{
          e.stopPropagation();
          if(!window.confirm(T('prod.delConfirm'))) return;
          const _pd = products.find(p=> p.id === id);
          if(_pd){
            logRec(productLog, saveProductLog, id, (_pd.name||'')+(_pd.sku?' ('+_pd.sku+')':''), 'delete', _pd);
            // Cost lots ride along with the product so Cost Summary only ever
            // reflects stock that really exists; restoring brings them back.
            const _bin = toBin(_pd);
            _bin._lots = lots.filter(l=> l.productId === id).map(l=> JSON.parse(JSON.stringify(l)));
            // The expenses this product's stock generated go with it, so the cost
            // donuts and the expense total keep telling the same story.
            _bin._expenses = expenses.filter(e=> e.auto && e.productId === id).map(e=> JSON.parse(JSON.stringify(e)));
            deletedProducts.push(_bin);
            lots = lots.filter(l=> l.productId !== id);
            expenses = expenses.filter(e=> !(e.auto && e.productId === id));
            await saveDeletedProducts(); await saveLots(); await saveExpenses();
          }
          products = products.filter(p=> p.id !== id);
          await saveProducts();
          renderProductsTable(body);
        });
        // Click anywhere on the row → toggle this product's lot detail rows.
        tr.addEventListener('click', ()=>{
          const rows = tbody.querySelectorAll(`.prod-lots-detail[data-lots="${id}"]`);
          if(!rows.length) return;
          const open = rows[0].style.display === 'none';
          rows.forEach(r=> r.style.display = open ? '' : 'none');
          if(!open){
            tbody.querySelectorAll(`.prod-clot-detail[data-clots^="${id}|"]`).forEach(r=> r.style.display = 'none');
            tbody.querySelectorAll(`.prod-color-toggle[data-ct^="${id}|"]`).forEach(c=> c.textContent = '\u25B8');
          }
          const car = tr.querySelector('.prod-lot-toggle');
          if(car) car.textContent = open ? '▾' : '▸';
        });
      });
      tbody.querySelectorAll('.prod-color-row').forEach(cr=> cr.addEventListener('click', (e)=>{
        e.stopPropagation();
        const key = cr.dataset.ckey;
        const rows = tbody.querySelectorAll(`.prod-clot-detail[data-clots="${key}"]`);
        if(!rows.length) return;
        const open = rows[0].style.display === 'none';
        rows.forEach(r=> r.style.display = open ? '' : 'none');
        const car = cr.querySelector('.prod-color-toggle');
        if(car) car.textContent = open ? '\u25BE' : '\u25B8';
      }));
    }
  }

  function openProductModal(row, body){
    prodEditingId = row ? row.id : null;
    prodImageData = row ? (row.image || null) : null;
    prodBillData = null;
    let pHasColors = !!(row && row.hasColors);
    let pColors = (row && Array.isArray(row.colors)) ? JSON.parse(JSON.stringify(row.colors)) : [];
    pColors.forEach(c=>{ if(!Array.isArray(c.images)) c.images = c.image ? [c.image] : []; if(!Array.isArray(c.imageNames)) c.imageNames = []; while(c.imageNames.length < c.images.length) c.imageNames.push(''); });
    let pImages = (row && Array.isArray(row.images) && row.images.length) ? row.images.slice(0,5) : (row && row.image ? [row.image] : []);
    let pImageNames = (row && Array.isArray(row.imageNames)) ? row.imageNames.slice(0,5) : [];
    while(pImageNames.length < pImages.length) pImageNames.push('');
    const ov = body;
    ov.innerHTML = `
      <div class="panel art-order-form-page">
        <div class="art-order-form-head">
          <button type="button" class="btn btn-ghost" id="pBack">\u2190 ${esc(T('rev.back'))}</button>
          <h3 class="art-modal-title">${esc(row ? T('prod.editTitle') : T('prod.addTitle'))}</h3>
        </div>
        <h4 class="art-form-section">${esc(T('sec.detail'))}</h4>
        <div class="art-form-grid">
          <label>${esc(T('prod.sku'))}<input type="text" id="pSku" value="${row?esc(row.sku):''}"></label>
          <label class="art-form-full">${esc(T('prod.name'))}<input type="text" id="pName" value="${row?esc(row.name):''}"></label>
          <label class="art-form-full">${esc(T('prod.ptype'))} <span class="art-req">*</span><select id="pType"><option value="">${esc(T('prod.pickType'))}</option>${(config.productTypes||[]).map(t=>`<option value="${esc(t.name)}" ${row&&row.productType===t.name?'selected':''}>${esc(itemLabel(t))}</option>`).join('')}</select></label>
          <label class="art-form-full">${esc(T('prod.desc'))}<textarea id="pDesc" rows="3" placeholder="${esc(T('prod.descPh'))}">${row?esc(row.description||''):''}</textarea></label>
        </div>
        <div class="art-img-field" id="pImgField" style="${pHasColors?'display:none;':''}">
          <label class="art-img-label">${esc(T('prod.image'))} <span class="pi-hint">${esc(T('img.max5'))}</span></label>
          <div class="pi-grid" id="pImgGrid"></div>
        </div>
        <h4 class="art-form-section">${esc(T('pc.section'))}</h4>
        <label class="pc-switch"><input type="checkbox" id="pHasColors" ${pHasColors?'checked':''}><span>${esc(T('pc.enable'))}</span></label>
        <div class="pc-list" id="pColorList" style="${pHasColors?'':'display:none;'}"></div>
        <div id="pSellFields" style="${pHasColors?'display:none;':''}">
        <h4 class="art-form-section">${esc(T('sec.selling'))}</h4>
        <div class="art-form-grid">
          <label>${esc(T('prod.price'))}<input type="number" id="pPrice" value="${row?row.price:0}" step="0.01"></label>
        </div>
        </div>
        <h4 class="art-form-section">${esc(T('sec.evidence'))}</h4>
        <div class="art-img-field">
          <label class="art-img-label">${esc(T('prod.bill'))}</label>
          <label class="file-picker">
            <input type="file" id="pBillInput" accept="image/*,application/pdf">
            <span class="file-picker-btn">${esc(T('io.chooseFile'))}</span>
            <span class="file-picker-name" id="pBillName">${esc(T('io.noFile'))}</span>
          </label>
        </div>
        <div class="art-modal-actions">
          <button class="btn btn-ghost" id="pCancel">${esc(T('cancel'))}</button>
          <button class="btn btn-primary" id="pSave">${esc(T('save'))}</button>
        </div>
      </div>`;
    const g = (id)=> ov.querySelector('#'+id);
    function addImageFiles(files, arr, names, done){
      Array.from(files || []).forEach(file=>{
        if(arr.length >= 5){ return; }
        if(file.size > 256*1024){ alert(T('bill.tooBig')); return; }
        const rd = new FileReader();
        rd.onload = ()=>{ if(arr.length < 5){ arr.push(rd.result); names.push(file.name || ''); done(); } };
        rd.readAsDataURL(file);
      });
    }
    function thumbsHtml(list, cls, attrs){
      return list.map((src,j)=> `<div class="pi-thumb ${cls}"><img src="${esc(src)}" alt=""><button type="button" class="pi-rm" ${attrs} data-j="${j}" title="${esc(T('pc.rmImage'))}">\u2715</button></div>`).join('');
    }
    function drawImages(){
      const wrap = g('pImgGrid'); if(!wrap) return;
      wrap.innerHTML = thumbsHtml(pImages, '', 'data-main="1"')
        + (pImages.length < 5 ? `<label class="pi-add"><input type="file" id="pImgInput" accept="image/*" multiple><span>+</span></label>` : '');
      wrap.querySelectorAll('.pi-rm').forEach(b=> b.addEventListener('click', ()=>{ const j = +b.dataset.j; pImages.splice(j, 1); pImageNames.splice(j, 1); drawImages(); }));
      const inp = wrap.querySelector('#pImgInput');
      if(inp) inp.addEventListener('change', (e)=> addImageFiles(e.target.files, pImages, pImageNames, drawImages));
    }
    function defaultColors(){
      const en = (window.appLang && window.appLang()) === 'en';
      return [
        { id: rid(), name: en?'Black':'\u0E14\u0E33', hex:'#000000', image:null, images:[], price:null, qty:'', cost:'' },
        { id: rid(), name: en?'Gray':'\u0E40\u0E17\u0E32',  hex:'#808080', image:null, images:[], price:null, qty:'', cost:'' },
        { id: rid(), name: en?'White':'\u0E02\u0E32\u0E27', hex:'#FFFFFF', image:null, images:[], price:null, qty:'', cost:'' }
      ];
    }
    function drawColors(){
      const wrap = g('pColorList'); if(!wrap) return;
      wrap.innerHTML = pColors.map((c,i)=>{
          if(!Array.isArray(c.images)) c.images = c.image ? [c.image] : [];
          if(!Array.isArray(c.imageNames)) c.imageNames = [];
          return `<div class="pc-row" data-i="${i}">
          <div class="pc-row-top">
            <input type="color" class="pc-hex" data-i="${i}" value="${esc(c.hex||'#000000')}">
            <input type="text" class="pc-name" data-i="${i}" value="${esc(c.name||'')}" placeholder="${esc(T('pc.namePh'))}">
            <input type="number" class="pc-num pc-price" data-i="${i}" value="${c.price!=null?c.price:''}" step="0.01" placeholder="${esc(T('prod.price'))}" title="${esc(T('prod.price'))}">
            <button type="button" class="pc-del" data-i="${i}" title="${esc(T('delete'))}">\u2715</button>
          </div>
          <div class="pi-grid pc-imgs">${thumbsHtml(c.images, 'sm', `data-ci="${i}"`)}${c.images.length < 5 ? `<label class="pi-add sm" title="${esc(T('pc.image'))}"><input type="file" class="pc-img" data-i="${i}" accept="image/*" multiple><span>+</span></label>` : ''}</div>
        </div>`; }).join('') + `<button type="button" class="btn btn-ghost pc-add" id="pcAdd">${esc(T('pc.add'))}</button>`;
      wrap.querySelectorAll('.pc-hex').forEach(inp=> inp.addEventListener('input', ()=>{ pColors[+inp.dataset.i].hex = inp.value; }));
      wrap.querySelectorAll('.pc-name').forEach(inp=> inp.addEventListener('input', ()=>{ pColors[+inp.dataset.i].name = inp.value; }));
      wrap.querySelectorAll('.pc-price').forEach(inp=> inp.addEventListener('input', ()=>{ pColors[+inp.dataset.i].price = inp.value === '' ? null : (parseFloat(inp.value)||0); }));
      wrap.querySelectorAll('.pc-img').forEach(inp=> inp.addEventListener('change', (e)=>{ const c = pColors[+inp.dataset.i]; if(!Array.isArray(c.imageNames)) c.imageNames = []; addImageFiles(e.target.files, c.images, c.imageNames, drawColors); }));
      wrap.querySelectorAll('.pc-imgs .pi-rm').forEach(btn=> btn.addEventListener('click', ()=>{ const c = pColors[+btn.dataset.ci], j = +btn.dataset.j; c.images.splice(j, 1); if(Array.isArray(c.imageNames)) c.imageNames.splice(j, 1); drawColors(); }));
      wrap.querySelectorAll('.pc-del').forEach(btn=> btn.addEventListener('click', ()=>{ pColors.splice(+btn.dataset.i, 1); drawColors(); }));
      const add = wrap.querySelector('#pcAdd');
      if(add) add.addEventListener('click', ()=>{ pColors.push({ id: rid(), name:'', hex:'#CCCCCC', image:null, images:[], imageNames:[], price:null, qty:'', cost:'' }); drawColors(); });
    }
    g('pHasColors').addEventListener('change', (e)=>{
      pHasColors = e.target.checked;
      if(pHasColors && pColors.length === 0) pColors = defaultColors();
      const wrap = g('pColorList'); if(wrap) wrap.style.display = pHasColors ? '' : 'none';
      const imgField = g('pImgField'); if(imgField) imgField.style.display = pHasColors ? 'none' : '';
      const sellFields = g('pSellFields'); if(sellFields) sellFields.style.display = pHasColors ? 'none' : '';
      drawColors();
    });
    drawColors();
    drawImages();
    const pbi = g('pBillInput');
    if(pbi) pbi.addEventListener('change', (e)=>{
      const file = e.target.files[0]; if(!file){ prodBillData=null; return; }
      if(file.size > 256*1024){ alert(T('bill.tooBig')); e.target.value=''; prodBillData=null; return; }
      const nm = ov.querySelector('#pBillName'); if(nm) nm.textContent = file.name;
      const reader2 = new FileReader();
      reader2.onload = ()=>{ prodBillData = reader2.result; };
      reader2.readAsDataURL(file);
    });
    const close = ()=> renderProductsPage(body);
    const backBtn = g('pBack'); if(backBtn) backBtn.addEventListener('click', close);
    g('pCancel').addEventListener('click', close);
    g('pSave').addEventListener('click', async ()=>{
      const sku = g('pSku').value.trim();
      const name = g('pName').value.trim();
      const productType = g('pType').value;
      if(!sku){ alert(T('prod.errSku')); return; }
      if(!name){ alert(T('prod.errName')); return; }
      if(!productType){ alert(T('prod.errType')); return; }
      const data = {
        id: prodEditingId || rid(), sku, name, productType,
        description: (g('pDesc') ? g('pDesc').value.trim() : ''),
        cost: row ? (row.cost || 0) : 0, price: parseFloat(g('pPrice').value)||0,
        stock: row ? (row.stock || 0) : 0, tag: (row ? (row.tag || 'In Stock') : 'Out of Stock'),
        image: pImages[0] || null, images: pImages.slice(0,5), imageNames: pImageNames.slice(0,5),
        hasColors: pHasColors,
        colors: pHasColors ? pColors.map(c=>{ const im = (Array.isArray(c.images)?c.images:[]).slice(0,5); return { id: c.id, name: c.name, hex: c.hex, price: (c.price === '' || c.price == null) ? null : Number(c.price), images: im, imageNames: (Array.isArray(c.imageNames)?c.imageNames:[]).slice(0,5), image: im[0] || null }; }) : []
      };
      if(pHasColors){
        const _ps = data.colors.map(c=> Number(c.price)||0).filter(v=> v > 0);
        data.price = _ps.length ? Math.min.apply(null, _ps) : 0;
      }
      const _pnow = new Date().toISOString();
      if(prodEditingId){
        const orig = products.find(p=> p.id === prodEditingId);
        data.createdBy = (orig && orig.createdBy) || currentActorName();   // keep the original creator
        data.createdAt = (orig && orig.createdAt) || _pnow;
        data.editedBy = currentActorName(); data.editedAt = _pnow;
        products = products.map(p=> p.id===prodEditingId ? data : p);
        logRec(productLog, saveProductLog, data.id, (data.name||'')+(data.sku?' ('+data.sku+')':''), 'edit', data, { imageChanges: imageChangeList(orig, data) });
      }else {
        data.createdBy = currentActorName(); data.createdAt = _pnow;
        products.push(data);
        logRec(productLog, saveProductLog, data.id, (data.name||'')+(data.sku?' ('+data.sku+')':''), 'create', data, { imageChanges: imageChangeList(null, data) });
        // A new product starts EMPTY: stock and cost only ever enter through Restock.
        const _iso = new Date().toISOString(), _day = _iso.slice(0,10);
        stockLog.push({ id: rid(), date: _day, productId: data.id, productName: data.name, productType: data.productType||'', qty: 0, signature: currentActorName(), type: 'new', origin: '', cost: 0, bill: prodBillData, createdAt: _iso });
        await saveStockLog();
      }
      await saveProducts();
      close();
      renderProductsTable(body);
    });
  }

  /* ================= Promotions (manager + editor) ================= */
  function promoStatus(p){
    const today = window.localIso();
    if(p.effectiveDate && p.effectiveDate > today) return 'scheduled';
    if(p.endDate && p.endDate < today) return 'ended';
    return 'active';
  }

  function openPromoManager(body){
    const ov = document.createElement('div');
    ov.className = 'art-modal-overlay show';
    ov.innerHTML = `
      <div class="art-modal art-modal-lg">
        <h3 class="art-modal-title">${esc(T('promo.title'))}</h3>
        <p class="setting-desc" style="margin:-4px 0 12px;">${esc(T('promo.desc'))}</p>
        <div id="promoList"></div>
        <button class="btn btn-primary" id="promoNew" style="margin-top:12px;">${esc(T('promo.new'))}</button>
        <div class="art-modal-actions">
          <button class="btn btn-ghost" id="promoClose">${esc(T('promo.close'))}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const close = ()=> ov.remove();
    ov.addEventListener('click', e=>{ if(e.target===ov) close(); });
    ov.querySelector('#promoClose').addEventListener('click', close);

    function drawList(){
      const wrap = ov.querySelector('#promoList');
      if(promotions.length === 0){
        wrap.innerHTML = `<div class="art-empty" style="padding:32px;"><div class="art-empty-ico">🏷️</div>${esc(T('promo.empty'))}</div>`;
        return;
      }
      const rank = { active:0, scheduled:1, ended:2 };
      const sorted = promotions.slice().sort((a,b)=> rank[promoStatus(a)] - rank[promoStatus(b)]);
      wrap.innerHTML = sorted.map(p=>{
        const stt = promoStatus(p);
        const cnt = (p.items || []).length;
        return `<div class="art-promo-row" data-id="${p.id}">
          <div class="art-promo-main">
            <div class="art-promo-name">${esc(p.name || T('promo.untitled'))}</div>
            <div class="art-promo-meta">${esc(p.effectiveDate||'-')} → ${esc(p.endDate||'-')} · ${cnt} ${esc(T('promo.itemsUnit'))}</div>
          </div>
          <span class="art-pill art-promo-${stt}">${esc(T('promo.status.'+stt))}</span>
          <div class="art-row-actions">
            <button class="acc-icon art-promo-edit" title="${esc(T('edit'))}">✎</button>
            <button class="acc-icon art-promo-del" title="${esc(T('delete'))}">✕</button>
          </div>
        </div>`;
      }).join('');
      wrap.querySelectorAll('.art-promo-row').forEach(rowEl=>{
        const id = rowEl.dataset.id;
        rowEl.querySelector('.art-promo-edit').addEventListener('click', ()=>{
          openPromoEditor(promotions.find(p=> p.id === id), ()=>{ drawList(); renderProductsTable(body); });
        });
        rowEl.querySelector('.art-promo-del').addEventListener('click', async ()=>{
          if(!window.confirm(T('promo.delConfirm'))) return;
          promotions = promotions.filter(p=> p.id !== id);
          await savePromotions();
          drawList(); renderProductsTable(body);
        });
      });
    }
    ov.querySelector('#promoNew').addEventListener('click', ()=>{
      openPromoEditor(null, ()=>{ drawList(); renderProductsTable(body); });
    });
    drawList();
  }

  function openPromoEditor(promo, onDone){
    const editing = !!promo;
    const today = window.localIso();
    const picked = {};   // productId -> percent (persists across category switches)
    if(promo && Array.isArray(promo.items)) promo.items.forEach(it=>{ picked[it.productId] = it.percent; });
    const cats = (config.productTypes || []).map(t=> t.name);
    let curCat = cats[0] || '';

    const ov = document.createElement('div');
    ov.className = 'art-modal-overlay show';
    ov.innerHTML = `
      <div class="art-modal art-modal-lg">
        <h3 class="art-modal-title">${esc(editing ? T('promo.editTitle') : T('promo.addTitle'))}</h3>
        <div class="art-form-grid">
          <label class="art-form-full">${esc(T('promo.name'))}<input type="text" id="prName" value="${promo?esc(promo.name||''):''}" placeholder="${esc(T('promo.namePh'))}"></label>
          <label>${esc(T('promo.effDate'))} <span class="art-req">*</span><input type="date" id="prEff" value="${promo?esc(promo.effectiveDate||today):today}"></label>
          <label>${esc(T('promo.endDate'))} <span class="art-req">*</span><input type="date" id="prEnd" value="${promo?esc(promo.endDate||''):''}"></label>
        </div>
        <div class="art-items-head">${esc(T('promo.pickProducts'))} <span class="art-req">*</span></div>
        <div class="art-promo-picker">
          <select id="prCat">${cats.length ? cats.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('') : `<option value="">${esc(T('promo.noCat'))}</option>`}</select>
          <select id="prProd"></select>
          <button type="button" class="btn btn-ghost" id="prAdd">${esc(T('promo.addItem'))}</button>
        </div>
        <div class="art-promo-count" id="prCount"></div>
        <div id="prPickedList" class="art-promo-picked"></div>
        <div class="art-modal-actions">
          <button class="btn btn-ghost" id="prCancel">${esc(T('cancel'))}</button>
          <button class="btn btn-primary" id="prSave">${esc(T('save'))}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const g = (id)=> ov.querySelector('#'+id);
    const close = ()=> ov.remove();
    ov.addEventListener('click', e=>{ if(e.target===ov) close(); });
    g('prCancel').addEventListener('click', close);

    function updateCount(){
      const n = Object.keys(picked).length;
      g('prCount').textContent = n ? (n + ' ' + T('promo.selected')) : '';
    }
    function nameOf(id){ const p = products.find(x=> x.id === id); return p ? p.name : id; }
    function catOf(id){ const p = products.find(x=> x.id === id); return p ? (p.productType || '') : ''; }
    function skuOf(id){ const p = products.find(x=> x.id === id); return p ? p.sku : ''; }

    // Product dropdown: only items in the chosen category that aren't picked yet.
    function fillProdDropdown(){
      const sel = g('prProd');
      const list = products.filter(p=> p.productType === curCat && picked[p.id] == null);
      sel.innerHTML = list.length === 0
        ? `<option value="">${esc(T('promo.noneLeft'))}</option>`
        : `<option value="">${esc(T('promo.pickProduct'))}</option>` +
          list.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}${p.sku?` (${esc(p.sku)})`:''}</option>`).join('');
      g('prAdd').disabled = list.length === 0;
    }
    // Picked list: what's in the promotion so far, with a per-item % and remove.
    function drawPicked(){
      const wrap = g('prPickedList');
      const ids = Object.keys(picked);
      if(ids.length === 0){
        wrap.innerHTML = `<div class="art-promo-noprod">${esc(T('promo.emptyPicked'))}</div>`;
        updateCount(); return;
      }
      wrap.innerHTML = ids.map(id=>`
        <div class="art-promo-picked-row" data-id="${id}">
          <div class="art-promo-picked-main">
            <span class="art-promo-picked-name">${esc(nameOf(id))}${skuOf(id)?` <span class="art-promo-sku">(${esc(skuOf(id))})</span>`:''}</span>
            <span class="art-promo-picked-cat">${esc(catOf(id))}</span>
          </div>
          <div class="art-promo-pct">
            <input type="number" data-pct="${id}" value="${picked[id]}" step="1" min="0" max="100">
            <span>% off</span>
          </div>
          <button type="button" class="acc-icon art-promo-remove" title="${esc(T('delete'))}">✕</button>
        </div>`).join('');
      wrap.querySelectorAll('[data-pct]').forEach(inp=> inp.addEventListener('input', (e)=>{
        const id = e.target.dataset.pct;
        if(picked[id] != null) picked[id] = Math.min(100, Math.max(0, parseFloat(e.target.value)||0));
      }));
      wrap.querySelectorAll('.art-promo-remove').forEach(btn=> btn.addEventListener('click', (e)=>{
        const id = e.currentTarget.closest('[data-id]').dataset.id;
        delete picked[id];
        drawPicked(); fillProdDropdown();
      }));
      updateCount();
    }
    g('prCat').addEventListener('change', ()=>{ curCat = g('prCat').value; fillProdDropdown(); });
    g('prAdd').addEventListener('click', ()=>{
      const id = g('prProd').value;
      if(!id || picked[id] != null) return;
      picked[id] = 0;   // default 0% — owner sets the discount in the picked list
      drawPicked(); fillProdDropdown();
    });
    fillProdDropdown(); drawPicked();

    g('prSave').addEventListener('click', async ()=>{
      const name = g('prName').value.trim();
      const effectiveDate = g('prEff').value;
      const endDate = g('prEnd').value;
      if(!effectiveDate || !endDate){ alert(T('promo.errDates')); return; }
      if(endDate < effectiveDate){ alert(T('promo.errRange')); return; }
      const items = Object.keys(picked).map(pid=> ({ productId: pid, percent: picked[pid] }));
      if(items.length === 0){ alert(T('promo.errItems')); return; }
      const closed = endDate < today;   // saving with a past end date = already over
      if(editing){
        promo.name = name; promo.effectiveDate = effectiveDate; promo.endDate = endDate; promo.items = items;
        promo.closed = closed; if(!closed) promo.endedAck = false;
        promotions = promotions.map(p=> p.id === promo.id ? promo : p);
      }else{
        promotions.push({ id: rid(), name, effectiveDate, endDate, items, closed, endedAck: false });
      }
      await savePromotions();
      close();
      if(onDone) onDone();
    });
  }

  /* ================= Order Status Kanban ================= */
  let kanbanFilter = { from:'', to:'', tag:'all' };
  // Kanban mode config — orderStatus vs invoiceStatus boards share all logic.
  const KANBAN_MODES = {
    order:   { group:'orderStatuses',   field:'orderStatus',   subPillGroup:'invoiceStatuses', subPillField:'invoiceStatus' },
    invoice: { group:'invoiceStatuses', field:'invoiceStatus', subPillGroup:'orderStatuses',   subPillField:'orderStatus'   }
  };

  function ordersForKanban(mode){
    const m = KANBAN_MODES[mode];
    const completeName = (statusByRole(m.group, mode==='order'?'complete':'paid') || {}).name;
    return orders.filter(o=>{
      if(o[m.field] === completeName) return false; // terminal-status orders leave the board
      if(kanbanFilter.from && o.date < kanbanFilter.from) return false;
      if(kanbanFilter.to && o.date > kanbanFilter.to) return false;
      if(kanbanFilter.tag !== 'all' && o.tag !== kanbanFilter.tag) return false;
      return true;
    });
  }

  function renderOrderKanban(body){ renderKanbanPage(body, 'order'); }
  function renderInvoiceKanban(body){ renderKanbanPage(body, 'invoice'); }

  function renderKanbanPage(body, mode){
    const rTags = config.revenueTags || [];
    body.innerHTML = `
      <div class="panel">
        <div class="art-toolbar">
          <div class="art-field"><label>${esc(T('exp.from'))}</label><input type="date" id="kbFrom" value="${esc(kanbanFilter.from)}"></div>
          <div class="art-field"><label>${esc(T('exp.to'))}</label><input type="date" id="kbTo" value="${esc(kanbanFilter.to)}"></div>
          <div class="art-field"><label>${esc(T('exp.tag'))}</label>
            <select id="kbTag"><option value="all">${esc(T('exp.all'))}</option>${rTags.map(t=>`<option value="${esc(t.name)}" ${kanbanFilter.tag===t.name?'selected':''}>${esc(itemLabel(t))}</option>`).join('')}</select>
          </div>
          <button class="btn btn-ghost" id="kbClear">${esc(T('exp.clearFilter'))}</button>
        </div>
        <div class="art-kanban" id="ordKanban"></div>
      </div>`;
    body.querySelector('#kbFrom').addEventListener('change', e=>{ kanbanFilter.from=e.target.value; drawKanban(body, mode); });
    body.querySelector('#kbTo').addEventListener('change', e=>{ kanbanFilter.to=e.target.value; drawKanban(body, mode); });
    body.querySelector('#kbTag').addEventListener('change', e=>{ kanbanFilter.tag=e.target.value; drawKanban(body, mode); });
    body.querySelector('#kbClear').addEventListener('click', ()=>{ kanbanFilter={from:'',to:'',tag:'all'}; renderKanbanPage(body, mode); });
    drawKanban(body, mode);
  }

  function drawKanban(body, mode){
    const container = body.querySelector('#ordKanban');
    if(!container) return;
    const m = KANBAN_MODES[mode];
    const statuses = config[m.group] || [];
    const terminalRole = mode==='order' ? 'complete' : 'paid';
    const list = ordersForKanban(mode).map(computeOrder);
    container.innerHTML = statuses.map(st=>{
      const isTerminal = st.role === terminalRole;
      const cards = isTerminal ? [] : list.filter(o=> o[m.field] === st.name);
      return `<div class="kcol" data-status="${esc(st.name)}">
        <div class="kcol-head">
          <span class="kcol-dot" style="background:${esc(st.color)}"></span>
          <span>${esc(st.name)}</span>
          <span class="kcol-count">${isTerminal ? '➜' : cards.length}</span>
        </div>
        ${isTerminal ? `<div class="kcol-hint">${esc(T(mode==='order'?'kb.completeHint':'kb.paidHint'))}</div>` : ''}
        <div class="kcol-body">
          ${cards.length===0 && !isTerminal ? `<div class="kcol-empty">${esc(T('kb.empty'))}</div>` : cards.map(o=> kanbanCardHtml(o, m)).join('')}
        </div>
      </div>`;
    }).join('');

    container.querySelectorAll('.kcard').forEach(el=>{
      el.addEventListener('dragstart', e=>{ e.dataTransfer.setData('text/plain', el.dataset.id); el.classList.add('dragging'); });
      el.addEventListener('dragend', ()=> el.classList.remove('dragging'));
      el.querySelector('.kcard-edit').addEventListener('click', (e)=>{ e.stopPropagation(); const o = orders.find(x=>x.id===el.dataset.id); openOrderModal(o, body, ()=> renderOrderKanban(body)); });
    });
    container.querySelectorAll('.kcol').forEach(col=>{
      col.addEventListener('dragover', e=>{ e.preventDefault(); col.classList.add('drag-over'); });
      col.addEventListener('dragleave', ()=> col.classList.remove('drag-over'));
      col.addEventListener('drop', async e=>{
        e.preventDefault(); col.classList.remove('drag-over');
        const id = e.dataTransfer.getData('text/plain');
        const newStatus = col.dataset.status;
        const o = orders.find(x=> x.id===id);
        if(o && o[m.field] !== newStatus){
          o[m.field] = newStatus;
          await saveOrders();
          drawKanban(body, mode);
        }
      });
    });
  }

  function kanbanCardHtml(o, m){
    const subC = ordColor(m.subPillGroup, o[m.subPillField]);
    return `<div class="kcard" draggable="true" data-id="${o.id}">
      <div class="kcard-actions"><button class="kcard-edit" title="${esc(T('edit'))}">✎</button></div>
      <div class="kcard-inv">${esc(o.invoiceNumber||'-')}</div>
      <div class="kcard-cust">${esc(o.customerName||'-')}</div>
      <div class="kcard-foot">
        <span class="kcard-net">${fmt(o.net)} ฿</span>
        <span class="art-pill" style="background:${subC}; font-size:10px;">${esc(o[m.subPillField])}</span>
      </div>
    </div>`;
  }

  // Restock: add quantity to a product's stock and record who did it.
  function openRestockModal(body){
    if(products.length === 0){ alert(T('rev.noProducts')); return; }
    const ov = document.createElement('div');
    ov.className = 'art-modal-overlay show';
    ov.innerHTML = `
      <div class="art-modal">
        <h3 class="art-modal-title">${esc(T('rst.title'))}</h3>
        <h4 class="art-form-section">${esc(T('sec.product'))}</h4>
        <div class="art-form-grid">
          <label class="art-form-full">${esc(T('rst.ptype'))}
            <select id="rsType"><option value="all">${esc(T('rst.allTypes'))}</option>${(config.productTypes||[]).map(t=>`<option value="${esc(t.name)}">${esc(itemLabel(t))}</option>`).join('')}</select>
          </label>
          <label class="art-form-full">${esc(T('rst.product'))} <span class="art-req">*</span>
            <select id="rsProduct"></select>
          </label>
          <label id="rsColorField" style="display:none;">${esc(T('pc.colorLabel'))} <span class="art-req">*</span>
            <span class="rs-color-row"><span class="rs-swatch" id="rsSwatch"></span><select id="rsColor"></select></span>
          </label>
          <label>${esc(T('rst.qty'))} <span class="art-req">*</span><input type="number" id="rsQty" value="1" step="1" min="1"></label>
          <label>${esc(T('rst.date'))}<input type="date" id="rsDate" value="${new Date().toISOString().slice(0,10)}"></label>
        </div>
        <h4 class="art-form-section">${esc(T('sec.cost'))}</h4>
        <div class="art-form-grid">
          <label>${esc(T('rst.origin'))} <span class="art-req">*</span><select id="rsOrigin">${(config.costOrigins||[]).map(o=>`<option value="${esc(o.name)}">${esc(o.name)}</option>`).join('')}</select></label>
          <label>${esc(T('rst.cost'))} <span class="art-req">*</span><input type="number" id="rsCost" value="0" step="0.01" min="0"></label>
        </div>
        <h4 class="art-form-section">${esc(T('sec.evidence'))}</h4>
        <div class="art-form-grid">
          <label class="art-form-full">${esc(T('rst.signature'))}<input type="text" value="${esc(currentActorName())}" readonly style="opacity:0.7; cursor:not-allowed;"></label>
          <label class="art-form-full">${esc(T('prod.bill'))}
            <label class="file-picker">
              <input type="file" id="rsBillInput" accept="image/*,application/pdf">
              <span class="file-picker-btn">${esc(T('io.chooseFile'))}</span>
              <span class="file-picker-name" id="rsBillName">${esc(T('io.noFile'))}</span>
            </label>
          </label>
        </div>
        <div class="art-modal-actions">
          <button class="btn btn-ghost" id="rsCancel">${esc(T('cancel'))}</button>
          <button class="btn btn-primary" id="rsSave">${esc(T('rst.confirm'))}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const g = (id)=> ov.querySelector('#'+id);
    let rsBillData = null;
    // Fill product dropdown, optionally filtered by the selected type.
    function fillProducts(){
      const type = g('rsType').value;
      const list = type === 'all' ? products : products.filter(p=> p.productType === type);
      g('rsProduct').innerHTML = list.length === 0
        ? `<option value="">${esc(T('rst.noneInType'))}</option>`
        : `<option value="">${esc(T('rev.pickProduct'))}</option>` + list.map(p=>`<option value="${p.id}">${esc(p.name)}${p.sku?` (${esc(p.sku)})`:''} · ${esc(T('prod.stock'))} ${stockOf(p).remaining}</option>`).join('');
    }
    function fillColors(){
      const prod = products.find(x=> x.id === g('rsProduct').value);
      const cols = (prod && prod.hasColors && Array.isArray(prod.colors)) ? prod.colors : [];
      const field = g('rsColorField');
      if(!cols.length){ field.style.display = 'none'; g('rsColor').innerHTML = ''; return; }
      field.style.display = '';
      g('rsColor').innerHTML = cols.map(c=> `<option value="${esc(c.id)}" data-hex="${esc(c.hex||'#888')}">${esc(c.name||'-')} \u00B7 ${esc(T('prod.stock'))} ${stockOfColor(prod, c.id).remaining}</option>`).join('');
      paintSwatch();
    }
    // Show the actual colour the user picked when the product was created.
    function paintSwatch(){
      const sel = g('rsColor'), sw = g('rsSwatch');
      if(!sel || !sw) return;
      const opt = sel.options[sel.selectedIndex];
      const hex = opt ? (opt.dataset.hex || '#888') : '#888';
      sw.style.background = hex;
      sw.title = opt ? opt.textContent : '';
    }
    g('rsType').addEventListener('change', ()=>{ fillProducts(); fillColors(); });
    g('rsProduct').addEventListener('change', fillColors);
    g('rsColor').addEventListener('change', paintSwatch);
    fillProducts();
    fillColors();
    const close = ()=> ov.remove();
    ov.addEventListener('click', e=>{ if(e.target===ov) close(); });
    g('rsCancel').addEventListener('click', close);
    const rbi = g('rsBillInput');
    if(rbi) rbi.addEventListener('change', (e)=>{
      const file = e.target.files[0]; if(!file){ rsBillData=null; return; }
      if(file.size > 256*1024){ alert(T('bill.tooBig')); e.target.value=''; rsBillData=null; return; }
      const nm = g('rsBillName'); if(nm) nm.textContent = file.name;
      const reader = new FileReader();
      reader.onload = ()=>{ rsBillData = reader.result; };
      reader.readAsDataURL(file);
    });
    g('rsSave').addEventListener('click', async ()=>{
      const productId = g('rsProduct').value;
      const qty = parseInt(g('rsQty').value)||0;
      const signature = currentActorName();
      const date = g('rsDate').value;
      if(!productId){ alert(T('rev.errPickProduct')); return; }
      if(qty <= 0){ alert(T('rst.errQty')); return; }
      const prod = products.find(p=> p.id === productId);
      const origin = g('rsOrigin').value;
      const cost = parseFloat(g('rsCost').value)||0;
      const colorId = (g('rsColorField').style.display === 'none') ? null : (g('rsColor').value || null);
      const colorName = colorId ? ((prod.colors||[]).find(c=> c.id === colorId)||{}).name || '' : '';
      addToLot(productId, origin, cost, qty, signature, colorId);
      stockLog.push({ id: rid(), date, productId, colorId, productName: prod.name + (colorName ? ' \u00B7 ' + colorName : ''), productType: prod.productType||'', qty, signature, type: 'restock', origin, cost, bill: rsBillData, createdAt: new Date().toISOString() });
      postStockExpense({ date, details: T('exp.restockOf').replace('{p}', prod.name + (colorName ? ' \u00B7 ' + colorName : '')), qty, cost, origin, productId, colorId, source:'restock' });
      await saveExpenses();
      await saveLots();
      await saveStockLog();
      close();
      renderProductsTable(body);
    });
  }

  /* ================= Stock History ================= */
  let stockHistFilter = { from:'', to:'', product:'all', qtyOp:'any', qtyVal:'', signature:'' };

  function stockHistFiltered(){
    return stockLog.filter(r=>{
      if(stockHistFilter.from && r.date < stockHistFilter.from) return false;
      if(stockHistFilter.to && r.date > stockHistFilter.to) return false;
      if(stockHistFilter.product !== 'all' && r.productId !== stockHistFilter.product) return false;
      if(stockHistFilter.signature && !(r.signature||'').toLowerCase().includes(stockHistFilter.signature.toLowerCase())) return false;
      if(stockHistFilter.qtyOp !== 'any' && stockHistFilter.qtyVal !== ''){
        const v = parseFloat(stockHistFilter.qtyVal);
        if(stockHistFilter.qtyOp === 'gt' && !(r.qty > v)) return false;
        if(stockHistFilter.qtyOp === 'lt' && !(r.qty < v)) return false;
        if(stockHistFilter.qtyOp === 'eq' && !(r.qty === v)) return false;
      }
      return true;
    }).sort((a,b)=> b.date.localeCompare(a.date));
  }

  function renderStockHistory(body){
    const f = stockHistFilter;
    body.innerHTML = `
      <div class="panel">
        <div class="art-toolbar">
          <div class="art-field"><label>${esc(T('exp.from'))}</label><input type="date" id="shFrom" value="${esc(f.from)}"></div>
          <div class="art-field"><label>${esc(T('exp.to'))}</label><input type="date" id="shTo" value="${esc(f.to)}"></div>
          <div class="art-field"><label>${esc(T('sh.product'))}</label>
            <select id="shProduct"><option value="all">${esc(T('exp.all'))}</option>${products.map(p=>`<option value="${p.id}" ${f.product===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select>
          </div>
          <div class="art-field"><label>${esc(T('sh.qty'))}</label>
            <select id="shQtyOp">
              <option value="any" ${f.qtyOp==='any'?'selected':''}>${esc(T('sh.any'))}</option>
              <option value="gt" ${f.qtyOp==='gt'?'selected':''}>${esc(T('sh.gt'))}</option>
              <option value="lt" ${f.qtyOp==='lt'?'selected':''}>${esc(T('sh.lt'))}</option>
              <option value="eq" ${f.qtyOp==='eq'?'selected':''}>${esc(T('sh.eq'))}</option>
            </select>
          </div>
          <div class="art-field"><label>&nbsp;</label><input type="number" id="shQtyVal" value="${esc(f.qtyVal)}" placeholder="${esc(T('sh.qtyVal'))}" style="width:90px;" ${f.qtyOp==='any'?'disabled':''}></div>
          <div class="art-field"><label>${esc(T('sh.signature'))}</label><input type="text" id="shSign" value="${esc(f.signature)}" placeholder="${esc(T('sh.signHint'))}"></div>
          <button class="btn btn-ghost" id="shClear">${esc(T('exp.clearFilter'))}</button>
        </div>
        <div class="art-table-wrap">
          <table class="art-table" id="shTable">
            <thead><tr>
              <th>${esc(T('rst.date'))}</th><th>${esc(T('sh.action'))}</th><th>${esc(T('sh.product'))}</th>
              <th>${esc(T('sh.ptype'))}</th><th class="num">${esc(T('sh.qtyAdded'))}</th>
              <th>${esc(T('sh.origin'))}</th><th class="num">${esc(T('sh.cost'))}</th>
              <th>${esc(T('sh.signature'))}</th><th>${esc(T('sh.bill'))}</th><th>${esc(T('sh.verified'))}</th>
            </tr></thead>
            <tbody id="shTbody"></tbody>
            <tfoot><tr><td colspan="4">${esc(T('sh.totalRows'))} (<span id="shCount">0</span>)</td><td class="num" id="shTotal">0</td><td colspan="5"></td></tr></tfoot>
          </table>
        </div>
        <div id="shEmpty" class="art-empty" style="display:none;"><div class="art-empty-ico">📦</div>${esc(T('sh.empty'))}</div>
      </div>`;
    const re = ()=> renderStockHistTable(body);
    body.querySelector('#shFrom').addEventListener('change', e=>{ f.from=e.target.value; re(); });
    body.querySelector('#shTo').addEventListener('change', e=>{ f.to=e.target.value; re(); });
    body.querySelector('#shProduct').addEventListener('change', e=>{ f.product=e.target.value; re(); });
    body.querySelector('#shQtyOp').addEventListener('change', e=>{ f.qtyOp=e.target.value; renderStockHistory(body); });
    body.querySelector('#shQtyVal').addEventListener('input', e=>{ f.qtyVal=e.target.value; re(); });
    body.querySelector('#shSign').addEventListener('input', e=>{ f.signature=e.target.value; re(); });
    body.querySelector('#shClear').addEventListener('click', ()=>{ stockHistFilter={from:'',to:'',product:'all',qtyOp:'any',qtyVal:'',signature:''}; renderStockHistory(body); });
    renderStockHistTable(body);
  }

  // Payment slips: shown together with per-file download links.
  // Attach/replace the payment slips without opening the whole order form.
  function openProofEditor(order, onDone){
    let list = Array.isArray(order.paymentProofs) ? order.paymentProofs.slice(0,5) : [];
    const ov = document.createElement('div');
    ov.className = 'art-modal-overlay show';
    ov.innerHTML = `<div class="art-modal" style="max-width:560px;">
      <h3 class="art-modal-title">${esc(T('pay.proof'))} \u00B7 ${esc(order.invoiceNumber||'')}</h3>
      <p class="setting-desc" style="margin:-4px 0 12px;">${esc(T('pay.proofHint'))}</p>
      <div class="pi-grid" id="peGrid"></div>
      <div class="art-modal-actions">
        <button class="btn btn-ghost" id="peCancel">${esc(T('cancel'))}</button>
        <button class="btn btn-primary" id="peSave">${esc(T('save'))}</button>
      </div>
    </div>`;
    document.body.appendChild(ov);
    const grid = ov.querySelector('#peGrid');
    function draw(){
      grid.innerHTML = list.map((f,i)=> `<span class="pi-thumb"><img src="${esc(f.src)}" alt=""><button type="button" class="pi-rm" data-j="${i}" title="${esc(T('delete'))}">\u2715</button></span>`).join('')
        + (list.length < 5 ? `<label class="pi-add"><input type="file" class="pe-input" accept="image/*" multiple><span>+</span></label>` : '');
      grid.querySelectorAll('.pi-rm').forEach(b=> b.addEventListener('click', ()=>{ list.splice(+b.dataset.j, 1); draw(); }));
      const inp = grid.querySelector('.pe-input');
      if(inp) inp.addEventListener('change', (e)=>{
        Array.from(e.target.files || []).forEach(file=>{
          if(list.length >= 5) return;
          if(file.size > 256*1024){ alert(T('bill.tooBig')); return; }
          const rd = new FileReader();
          rd.onload = ()=>{ if(list.length < 5){ list.push({ src: rd.result, name: file.name || '' }); draw(); } };
          rd.readAsDataURL(file);
        });
      });
      // Existing slips stay viewable from here too.
      grid.querySelectorAll('.pi-thumb img').forEach((im,i)=> im.addEventListener('click', ()=> openProofs([list[i]], order.invoiceNumber)));
    }
    draw();
    const close = ()=> ov.remove();
    ov.addEventListener('click', e=>{ if(e.target === ov) close(); });
    ov.querySelector('#peCancel').addEventListener('click', close);
    ov.querySelector('#peSave').addEventListener('click', async ()=>{
      order.paymentProofs = list.slice(0,5);
      await saveOrders();
      close();
      if(typeof onDone === 'function') onDone();
    });
  }
  function openProofs(list, label){
    const arr = (list||[]).filter(Boolean);
    if(!arr.length) return;
    const ov = document.createElement('div');
    ov.className = 'art-modal-overlay show';
    ov.innerHTML = `<div class="art-modal" style="max-width:720px;">
      <h3 class="art-modal-title">${esc(T('pay.proof'))}${label ? ' \u00B7 ' + esc(label) : ''}</h3>
      <div class="pf-list">${arr.map((f,i)=> `
        <div class="pf-item">
          <img src="${esc(f.src)}" alt="">
          <div class="pf-meta">
            <span class="pf-name">${esc(f.name || ('proof-' + (i+1)))}</span>
            <a class="btn btn-ghost" href="${esc(f.src)}" download="${esc(f.name || ('proof-' + (i+1) + '.png'))}">${esc(T('pay.download'))}</a>
          </div>
        </div>`).join('')}</div>
      <div class="art-modal-actions"><button class="btn btn-primary" id="pfClose">${esc(T('close'))}</button></div>
    </div>`;
    document.body.appendChild(ov);
    const close = ()=> ov.remove();
    ov.addEventListener('click', e=>{ if(e.target === ov) close(); });
    ov.querySelector('#pfClose').addEventListener('click', close);
  }
  function openBill(dataUrl){
    try{
      const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
      if(!m){ window.open(dataUrl, '_blank'); return; }
      const bin = atob(m[2]); const arr = new Uint8Array(bin.length);
      for(let i=0;i<bin.length;i++) arr[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([arr], { type: m[1] }));
      window.open(url, '_blank');
      setTimeout(()=> URL.revokeObjectURL(url), 60000);
    }catch(e){ try{ window.open(dataUrl, '_blank'); }catch(_){} }
  }
  function verifyCellHtml(r){
    const on = !!r.verified;
    const canV = (typeof window.roleCanAccess !== 'function') || window.roleCanAccess(window.currentRole, 'verifyStock');
    const pill = `<span class="art-pill sh-verify ${canV?'sh-verify-btn':''}" data-verify="${r.id}" style="background:${on?'#6B8F71':'#C6432E'};">${esc(on?T('sh.verYes'):T('sh.verNo'))}</span>`;
    const who = (on && r.verifiedBy) ? `<span class="sh-verify-by">${esc(r.verifiedBy)}</span>` : '';
    return pill + who;
  }
  function renderStockHistTable(body){
    const list = stockHistFiltered().slice().sort((a,b)=>{
      const ta = a.createdAt || (a.date + 'T00:00:00');
      const tb = b.createdAt || (b.date + 'T00:00:00');
      return tb.localeCompare(ta);   // newest first
    });
    const tbody = body.querySelector('#shTbody');
    const table = body.querySelector('#shTable');
    const empty = body.querySelector('#shEmpty');
    if(!tbody) return;
    if(list.length === 0){
      tbody.innerHTML=''; table.style.display='none'; empty.style.display='block';
    }else{
      table.style.display=''; empty.style.display='none';
      tbody.innerHTML = list.map(r=>{
        const d = new Date(r.date+'T00:00:00');
        const dateStr = isNaN(d) ? r.date : (String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+d.getFullYear());
        let timeStr = '';
        if(r.createdAt){ const ca = new Date(r.createdAt); if(!isNaN(ca)) timeStr = String(ca.getHours()).padStart(2,'0')+':'+String(ca.getMinutes()).padStart(2,'0'); }
        return `<tr>
          <td>${dateStr}${timeStr?` <span class="sh-time">${timeStr}</span>`:''}</td>
          <td><span class="art-pill" style="background:${r.type==='new'?'#6B8F71':'#C97B4E'}">${esc(r.type==='new'?T('sh.typeNew'):T('sh.typeRestock'))}</span></td>
          <td>${esc(r.productName)}</td>
          <td>${r.productType ? `<span class="art-pill" style="background:${ptypeColor(r.productType)}">${esc(ptypeLabel(r.productType))}</span>` : '<span style="color:var(--c-muted);">-</span>'}</td>
          <td class="num art-sold" style="font-weight:700;">+${r.qty}</td>
          <td>${r.origin ? `<span class="art-pill" style="background:${originColor(r.origin)}">${esc(r.origin)}</span>` : '<span style="color:var(--c-muted);">-</span>'}</td>
          <td class="num">${r.cost != null ? fmt(r.cost) : '-'}</td>
          <td>${esc(r.signature)}</td>
          <td>${r.bill ? `<button type="button" class="sh-bill" data-bill="${r.id}">📎</button>` : '<span style="color:var(--c-muted);">-</span>'}</td>
          <td>${verifyCellHtml(r)}</td>
        </tr>`;
      }).join('');
      tbody.querySelectorAll('.sh-bill[data-bill]').forEach(el=> el.addEventListener('click', ()=>{
        const entry = stockLog.find(x=> x.id === el.dataset.bill);
        if(entry && entry.bill) openBill(entry.bill);
      }));
      if((typeof window.roleCanAccess !== 'function') || window.roleCanAccess(window.currentRole, 'verifyStock')){
        tbody.querySelectorAll('.sh-verify[data-verify]').forEach(el=> el.addEventListener('click', async ()=>{
          const entry = stockLog.find(x=> x.id === el.dataset.verify);
          if(!entry) return;
          entry.verified = !entry.verified;
          entry.verifiedBy = entry.verified ? currentActorName() : '';
          await saveStockLog();
          renderStockHistTable(body);
        }));
      }
    }
    body.querySelector('#shCount').textContent = list.length;
    body.querySelector('#shTotal').textContent = '+' + list.reduce((s,r)=> s+r.qty, 0);
  }

  /* ================= Setting page ================= */
  // Four editable groups — expense tags, revenue tags, order statuses,
  // invoice statuses — each a list of {id,name,color} the user can
  // add / rename / recolour / delete, mirroring the Base App's room editor.
  // Business Profile page — ONLY the issuer info (was bundled with all the tag groups).
  function renderBusinessProfilePage(body, which){
    const rerender = ()=> renderBusinessProfilePage(body, which);
    body.innerHTML = `<div class="panel settings-panel">${businessProfileHtml(which)}</div>`;
    wireBusinessProfile(body, body, rerender, which);
  }

  // Per-module config pages — each module owns only its own tags/statuses,
  // wrapped in a padded .settings-section so nothing sits flush to the edge.
  function renderConfigShell(groupsHtml){
    return `<div class="panel settings-panel">
        <div class="settings-section">
          <div class="settings-section-head">
            <h3 class="setting-title">${esc(T('set.title'))}</h3>
            <p class="setting-desc">${esc(T('set.desc'))}</p>
          </div>
          <div id="artSetGroups">${groupsHtml}</div>
        </div>
      </div>`;
  }
  function renderStockConfig(body){
    const rerender = ()=> renderStockConfig(body);
    body.innerHTML = renderConfigShell(groupHtml('productTypes', T('set.productTypes')) + groupHtml('costOrigins', T('set.costOrigins')));
    wireGroups(body.querySelector('#artSetGroups'), body, rerender);
  }
  function renderSellConfig(body){
    const rerender = ()=> renderSellConfig(body);
    body.innerHTML = renderConfigShell(
      groupHtml('revenueTags',     T('set.revenueTags')) +
      groupHtml('orderStatuses',   T('set.orderStatuses')) +
      groupHtml('invoiceStatuses', T('set.invoiceStatuses')) +
      groupHtml('paymentModes',    T('set.paymentModes')) +
      groupHtml('platforms',       T('set.platforms'), { fee:true }));
    wireGroups(body.querySelector('#artSetGroups'), body, rerender);
  }

  /* ---- Business Profile (issuer info for financial documents) ---- */
  function businessProfileHtml(which){
    const isOrg = which !== 'general';
    const b = (isOrg ? config.business : config.businessGeneral) || {};
    const imgField = (key, label)=>{
      const src = b[key] || '';
      return `<div class="art-img-field">
        <label class="art-img-label">${esc(label)}</label>
        <div class="art-img-preview" style="${src?'':'display:none;'}">${src?`<img src="${esc(src)}" alt="">`:''}</div>
        <label class="file-picker">
          <input type="file" accept="image/*" data-bpfile="${key}">
          <span class="file-picker-btn">${esc(T('io.chooseFile'))}</span>
        </label>
        ${src?`<button type="button" class="acc-icon art-bp-clear" data-bpclear="${key}" title="${esc(T('bp.remove'))}">✕</button>`:''}
      </div>`;
    };
    return `
      <div class="settings-section art-bp-section">
        <div class="settings-section-head">
          <h3 class="setting-title">${esc(T(isOrg ? 'bp.title' : 'bp.titleGeneral'))}</h3>
          <p class="setting-desc">${esc(T(isOrg ? 'bp.descOrg' : 'bp.descGeneral'))}</p>
        </div>
        <div class="art-bp-grid">
          <label class="art-bp-full">${esc(T('bp.name'))}<input type="text" id="bpName" value="${esc(b.name||'')}"></label>
          <label class="art-bp-full">${esc(T('bp.nameEn'))}<input type="text" id="bpNameEn" value="${esc(b.nameEn||'')}"></label>
          <label class="art-bp-full">${esc(T('bp.address'))}<textarea id="bpAddress" rows="2">${esc(b.address||'')}</textarea></label>
          <label class="art-bp-full">${esc(T('bp.addressEn'))}<textarea id="bpAddressEn" rows="2">${esc(b.addressEn||'')}</textarea></label>
          <label>${esc(T('bp.phone'))}<input type="text" id="bpPhone" value="${esc(b.phone||'')}"></label>
          ${isOrg ? `<label>${esc(T('bp.taxId'))}<input type="text" id="bpTaxId" value="${esc(b.taxId||'')}"></label>` : ''}
          <label>${esc(T('bp.branch'))}<input type="text" id="bpBranch" value="${esc(b.branch != null ? b.branch : T('bp.branchDefault'))}"></label>
        </div>
        <div class="art-bp-imgs">
          ${imgField('logo', T('bp.logo'))}
          ${imgField('signature', T('bp.signature'))}
          ${imgField('stamp', T('bp.stamp'))}
        </div>
        ${isOrg ? `<div class="sf-inline-toggle" style="margin-top:14px;">
          <span>${esc(T('bp.vatDefault'))}</span>
          <button type="button" class="sf-toggle ${b.vatDefault?'on':'off'}" id="bpVat"><span class="sf-toggle-knob"></span></button>
        </div>` : ''}
      </div>`;
  }
  function wireBusinessProfile(host, body, rerender, which){
    const b = (which !== 'general' ? config.business : config.businessGeneral);
    const bind = (id, key)=>{ const el = host.querySelector('#'+id); if(el) el.addEventListener('input', async ()=>{ b[key] = el.value; await saveConfig(); }); };
    bind('bpName','name'); bind('bpNameEn','nameEn'); bind('bpAddress','address'); bind('bpAddressEn','addressEn'); bind('bpPhone','phone'); bind('bpTaxId','taxId'); bind('bpBranch','branch');
    const vat = host.querySelector('#bpVat');
    if(vat) vat.addEventListener('click', async ()=>{
      b.vatDefault = !b.vatDefault;
      vat.classList.toggle('on', b.vatDefault); vat.classList.toggle('off', !b.vatDefault);
      await saveConfig();
    });
    host.querySelectorAll('[data-bpfile]').forEach(inp=> inp.addEventListener('change', (e)=>{
      const key = inp.dataset.bpfile, file = e.target.files[0]; if(!file) return;
      const reader = new FileReader();
      reader.onload = async ()=>{ b[key] = reader.result; await saveConfig(); rerender(); };
      reader.readAsDataURL(file);
    }));
    host.querySelectorAll('[data-bpclear]').forEach(btn=> btn.addEventListener('click', async ()=>{
      b[btn.dataset.bpclear] = ''; await saveConfig(); rerender();
    }));
  }

  // Brought-From list (no colour) — where an expense was purchased.
  function broughtFromHtml(){
    const items = config.broughtFrom || [];
    const rows = items.map(it=> `
      <div class="art-set-row" data-bf="${it.id}">
        <input type="text" class="art-set-name" data-field="name" value="${esc(it.name)}">
        <button type="button" class="acc-icon art-bf-del" title="${esc(T('delete'))}">✕</button>
      </div>`).join('') || `<p class="art-set-empty">${esc(T('set.none'))}</p>`;
    return `
      <div class="art-set-group" data-bfgroup="1">
        <div class="art-set-group-head">
          <h4 class="diary-section-title">${esc(T('set.broughtFrom'))}</h4>
          <button type="button" class="btn btn-ghost art-bf-add">${esc(T('set.add'))}</button>
        </div>
        <div class="art-set-list">${rows}</div>
      </div>`;
  }

  // ID prefix editors (max 4 chars each).
  function prefixHtml(){
    const p = config.prefixes || { expense:'CSA', order:'ATSC' };
    return `
      <div class="art-set-group">
        <h4 class="diary-section-title">${esc(T('set.prefixTitle'))}</h4>
        <p class="setting-desc" style="margin:4px 0 12px;">${esc(T('set.prefixDesc'))}</p>
        <div class="art-prefix-row">
          <label class="art-prefix-field">${esc(T('set.prefixExpense'))}<input type="text" id="pfExpense" maxlength="4" value="${esc(p.expense)}"></label>
          <label class="art-prefix-field">${esc(T('set.prefixOrder'))}<input type="text" id="pfOrder" maxlength="4" value="${esc(p.order)}"></label>
        </div>
      </div>`;
  }

  function wireBroughtFrom(host, body, rerender){
    const group = host.querySelector('[data-bfgroup]');
    if(!group) return;
    group.querySelector('.art-bf-add').addEventListener('click', async ()=>{
      config.broughtFrom.push({ id: rid(), name: T('set.newItem') });
      await saveConfig(); rerender();
    });
    group.querySelectorAll('[data-bf]').forEach(rowEl=>{
      const id = rowEl.dataset.bf;
      const item = config.broughtFrom.find(x=> x.id === id);
      rowEl.querySelector('[data-field="name"]').addEventListener('change', async (e)=>{
        item.name = e.target.value.trim() || item.name; await saveConfig();
      });
      rowEl.querySelector('.art-bf-del').addEventListener('click', async ()=>{
        if(!window.confirm(T('set.delConfirm'))) return;
        config.broughtFrom = config.broughtFrom.filter(x=> x.id !== id);
        await saveConfig(); rerender();
      });
    });
  }

  function wirePrefix(host){
    const exp = host.querySelector('#pfExpense'), ord = host.querySelector('#pfOrder');
    if(!exp || !ord) return;
    const clean = (v)=> v.trim().toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,4);
    exp.addEventListener('change', async ()=>{ config.prefixes.expense = clean(exp.value) || 'CSA'; exp.value = config.prefixes.expense; await saveConfig(); });
    ord.addEventListener('change', async ()=>{ config.prefixes.order = clean(ord.value) || 'ATSC'; ord.value = config.prefixes.order; await saveConfig(); });
  }

  function groupHtml(groupKey, label, opts){
    const withFee = !!(opts && opts.fee);
    const items = config[groupKey] || [];
    const rows = items.map(it=> `
      <div class="art-set-row" data-item="${it.id}">
        <span class="art-set-swatch" style="background:${esc(it.color)}"></span>
        <input type="text" class="art-set-name" data-field="nameTh" value="${esc(it.nameTh||'')}" placeholder="${esc(it.name||T('set.nameTh'))}">
        <input type="text" class="art-set-name art-set-name-en" data-field="nameEn" value="${esc(it.nameEn||'')}" placeholder="${esc(it.name||T('set.nameEn'))}">
        ${it.locked ? `<span class="art-set-lock" title="${esc(T('set.lockedHint'))}">🔒</span>` : ''}
        ${withFee ? `<span class="art-set-fee" title="${esc(T('set.feeHint'))}"><input type="number" class="art-set-feeinp" data-field="fee" value="${it.fee!=null?it.fee:0}" step="0.01" min="0">%</span>` : ''}
        <input type="color" class="art-set-color" data-field="color" value="${esc(it.color)}">
        ${it.locked ? `<span class="art-set-del-placeholder"></span>` : `<button type="button" class="acc-icon art-set-del" title="${esc(T('delete'))}">✕</button>`}
      </div>`).join('') || `<p class="art-set-empty">${esc(T('set.none'))}</p>`;
    return `
      <div class="art-set-group" data-group="${groupKey}">
        <div class="art-set-group-head">
          <h4 class="diary-section-title">${esc(label)}</h4>
          <button type="button" class="btn btn-ghost art-set-add">${esc(T('set.add'))}</button>
        </div>
        <div class="art-set-list">
          ${items.length ? `<div class="art-set-headrow">
            <span class="art-set-swatch" style="visibility:hidden;"></span>
            <span class="art-set-h art-set-h-name">${esc(T('set.colTh'))}</span>
            <span class="art-set-h art-set-h-name">${esc(T('set.colEn'))}</span>
            ${withFee ? `<span class="art-set-h art-set-h-fee">${esc(T('set.colFee'))}</span>` : ''}
            <span class="art-set-h art-set-h-color">${esc(T('set.colColor'))}</span>
            <span class="art-set-h art-set-h-act"></span>
          </div>` : ''}
          ${rows}
        </div>
      </div>`;
  }

  function wireGroups(host, body, rerender){
    host.querySelectorAll('.art-set-group[data-group]').forEach(groupEl=>{
      const groupKey = groupEl.dataset.group;

      // Add
      groupEl.querySelector('.art-set-add').addEventListener('click', async ()=>{
        config[groupKey].push({ id: rid(), name: rid(), nameTh: T('set.newItem'), color: '#FDBD31' });
        await saveConfig();
        rerender();
      });

      // Per-row: rename, recolour, delete
      groupEl.querySelectorAll('.art-set-row').forEach(rowEl=>{
        const id = rowEl.dataset.item;
        const item = config[groupKey].find(x=> x.id === id);
        if(!item) return;

        const _th = rowEl.querySelector('[data-field="nameTh"]');
        if(_th) _th.addEventListener('change', async (e)=>{ item.nameTh = e.target.value.trim(); await saveConfig(); });
        const _en = rowEl.querySelector('[data-field="nameEn"]');
        if(_en) _en.addEventListener('change', async (e)=>{ item.nameEn = e.target.value.trim(); await saveConfig(); });
        const _fee = rowEl.querySelector('[data-field="fee"]');
        if(_fee) _fee.addEventListener('change', async (e)=>{ item.fee = parseFloat(e.target.value) || 0; await saveConfig(); });
        rowEl.querySelector('[data-field="color"]').addEventListener('input', async (e)=>{
          item.color = e.target.value;
          rowEl.querySelector('.art-set-swatch').style.background = e.target.value;
          await saveConfig();
        });
        const delBtn = rowEl.querySelector('.art-set-del');
        if(delBtn) delBtn.addEventListener('click', async ()=>{
          if(!window.confirm(T('set.delConfirm'))) return;
          config[groupKey] = config[groupKey].filter(x=> x.id !== id);
          await saveConfig();
          rerender();
        });
      });
    });
  }

  /* ---- Helpers other sub-pages will use (exported within module scope) ---- */
  // Colour lookup by name across a config group (used by tables/kanban later).
  function colorOf(groupKey, name){
    const it = (config[groupKey] || []).find(x=> x.name === name);
    return it ? it.color : '#999';
  }

  /* ================= i18n ================= */
  window.registerModuleI18n(ID, {
    th: {
      'title': 'ระบบจัดการร้านค้า', 'crumb': 'ระบบจัดการร้านค้า',
      'soon': 'กำลังพัฒนาส่วนนี้…',
      'delete': 'ลบ', 'edit': 'แก้ไข', 'save': 'บันทึก', 'cancel': 'ยกเลิก',
      'exp.from': 'จากวันที่', 'exp.to': 'ถึงวันที่', 'exp.tag': 'ป้ายกำกับ', 'exp.all': 'ทั้งหมด',
      'exp.restockOf':'\u0E40\u0E15\u0E34\u0E21\u0E2A\u0E15\u0E4A\u0E2D\u0E01 \u2014 {p}', 'exp.newStockOf':'\u0E2A\u0E15\u0E4A\u0E2D\u0E01\u0E15\u0E31\u0E49\u0E07\u0E15\u0E49\u0E19 \u2014 {p}', 'exp.auto':'\u0E23\u0E30\u0E1A\u0E1A\u0E25\u0E07\u0E43\u0E2B\u0E49', 'exp.clearFilter': 'ล้างตัวกรอง', 'exp.add': '+ เพิ่มรายการ', 'exp.addTitle': 'เพิ่มรายการรายจ่าย', 'exp.editTitle': 'แก้ไขรายการรายจ่าย',
      'exp.id': 'รหัส', 'exp.date': 'วันที่', 'exp.details': 'รายการ', 'exp.costPerPiece': 'ต้นทุน/ชิ้น', 'exp.amount': 'จำนวน',
      'exp.sumItems': 'รวมสินค้า', 'exp.shipping': 'ค่าส่ง', 'exp.discount': 'ส่วนลด', 'exp.net': 'สุทธิ',
      'exp.purchaseFrom': 'ร้าน/ที่ซื้อ', 'exp.pickFrom': '— เลือกแหล่งที่ซื้อ —', 'exp.note': 'หมายเหตุ', 'exp.totalRows': 'รวม', 'exp.empty': 'ยังไม่มีรายการรายจ่าย เริ่มเพิ่มรายการแรกได้เลย',
      'exp.delConfirm': 'ลบรายการนี้?',
      'sum.period': 'ช่วงเวลา', 'sum.allTime': 'ทั้งหมด', 'sum.tag': 'ป้ายกำกับ', 'sum.netTotal': 'ยอดสุทธิ', 'sum.percent': '% ของยอดรวม',
      'sum.sum': 'รวม', 'sum.totalNet': 'รวมรายจ่าย (สุทธิ)', 'sum.count': 'จำนวนรายการ', 'sum.avg': 'เฉลี่ยต่อรายการ', 'sum.byCategory':'\u0E15\u0E49\u0E19\u0E17\u0E38\u0E19\u0E15\u0E32\u0E21\u0E2B\u0E21\u0E27\u0E14\u0E2B\u0E21\u0E39\u0E48\u0E2A\u0E34\u0E19\u0E04\u0E49\u0E32', 'sum.byOrigin':'\u0E15\u0E49\u0E19\u0E17\u0E38\u0E19\u0E15\u0E32\u0E21\u0E41\u0E2B\u0E25\u0E48\u0E07\u0E17\u0E35\u0E48\u0E21\u0E32', 'sum.uncategorised':'\u0E44\u0E21\u0E48\u0E23\u0E30\u0E1A\u0E38\u0E2B\u0E21\u0E27\u0E14\u0E2B\u0E21\u0E39\u0E48', 'sum.noOrigin':'\u0E44\u0E21\u0E48\u0E23\u0E30\u0E1A\u0E38\u0E41\u0E2B\u0E25\u0E48\u0E07', 'sum.noData': 'ยังไม่มีข้อมูลในช่วงนี้',
      'rev.add': '+ เพิ่มออเดอร์', 'rev.addTitle': 'เพิ่มออเดอร์', 'rev.editTitle': 'แก้ไขออเดอร์',
      'rev.invoiceNo': 'เลขบิล', 'col.lastEdited':'แก้ล่าสุด', 'rev.customer': 'ชื่อผู้รับ', 'rev.customerHint': 'ชื่อ-นามสกุลผู้รับ', 'rev.back':'กลับ', 'rev.mapHint':'หรือกดเลือกจังหวัดจากแผนที่', 'rev.selProvince':'จังหวัดที่เลือก', 'rev.noProvince':'ยังไม่ได้เลือกจังหวัด', 'region.north':'ภาคเหนือ', 'region.central':'ภาคกลาง', 'region.northeast':'ภาคตะวันออกเฉียงเหนือ', 'region.east':'ภาคตะวันออก', 'region.west':'ภาคตะวันตก', 'region.south':'ภาคใต้', 'rev.address': 'ที่อยู่ผู้รับ', 'rev.addressHint': 'ที่อยู่สำหรับจัดส่ง', 'rev.addrLine':'ที่อยู่ (บ้านเลขที่/หมู่/ซอย/ถนน)', 'rev.addrLineHint':'บ้านเลขที่ หมู่ ตรอก/ซอย ถนน', 'rev.province':'จังหวัด', 'rev.district':'อำเภอ/เขต', 'rev.subdistrict':'ตำบล/แขวง', 'rev.postal':'รหัสไปรษณีย์', 'rev.postalHint':'อัตโนมัติ', 'rev.loading':'กำลังโหลด...', 'rev.errAddrLine':'กรุณากรอกที่อยู่ (บ้านเลขที่/ซอย/ถนน)', 'rev.errAddrGeo':'กรุณาเลือกจังหวัด/อำเภอ/ตำบลให้ครบ', 'sec.seller':'\u0E1C\u0E39\u0E49\u0E2D\u0E2D\u0E01\u0E1A\u0E34\u0E25 (Seller)', 'sell.issuedBy':'\u0E2D\u0E2D\u0E01\u0E1A\u0E34\u0E25\u0E42\u0E14\u0E22', 'sell.signature':'\u0E25\u0E32\u0E22\u0E40\u0E0B\u0E47\u0E19', 'sell.clear':'\u0E25\u0E49\u0E32\u0E07', 'sell.upload':'\u0E2D\u0E31\u0E1B\u0E42\u0E2B\u0E25\u0E14\u0E23\u0E39\u0E1B\u0E25\u0E32\u0E22\u0E40\u0E0B\u0E47\u0E19', 'sell.signHint':'\u0E27\u0E32\u0E14\u0E43\u0E19\u0E01\u0E23\u0E2D\u0E1A \u0E2B\u0E23\u0E37\u0E2D\u0E2D\u0E31\u0E1B\u0E42\u0E2B\u0E25\u0E14\u0E23\u0E39\u0E1B (\u0E44\u0E21\u0E48\u0E40\u0E01\u0E34\u0E19 256KB)', 'sell.errSign':'\u0E01\u0E23\u0E38\u0E13\u0E32\u0E40\u0E0B\u0E47\u0E19\u0E0A\u0E37\u0E48\u0E2D\u0E01\u0E48\u0E2D\u0E19\u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01', 'sell.seller':'\u0E1C\u0E39\u0E49\u0E2D\u0E2D\u0E01\u0E1A\u0E34\u0E25', 'rev.platformFee':'\u0E04\u0E48\u0E32\u0E18\u0E23\u0E23\u0E21\u0E40\u0E19\u0E35\u0E22\u0E21\u0E41\u0E1E\u0E25\u0E15\u0E1F\u0E2D\u0E23\u0E4C\u0E21', 'rev.platform': 'ขายผ่าน Platform', 'rev.platformHint': 'เช่น TikTok Shop', 'sec.delivery':'การจัดส่ง', 'sec.inventory':'รายการสินค้า (Inventory)', 'rev.phone':'เบอร์โทรติดต่อ', 'rev.phoneHint':'เบอร์โทรศัพท์ผู้รับ', 'rev.shippingTitle':'ค่าจัดส่ง', 'rev.shippingCost':'ค่าจัดส่ง', 'rev.shippingOverride':'ตั้งค่าส่งเอง (ทับ auto)', 'rev.shipAuto':'อัตโนมัติ', 'rev.shipNoCat':'ยังไม่มีสินค้า/หมวดหมู่', 'sec.vat':'\u0E01\u0E32\u0E23\u0E04\u0E33\u0E19\u0E27\u0E13 VAT', 'sec.payment':'\u0E01\u0E32\u0E23\u0E0A\u0E33\u0E23\u0E30\u0E40\u0E07\u0E34\u0E19', 'pay.mode':'\u0E27\u0E34\u0E18\u0E35\u0E0A\u0E33\u0E23\u0E30\u0E40\u0E07\u0E34\u0E19', 'pay.paid':'\u0E0A\u0E33\u0E23\u0E30\u0E41\u0E25\u0E49\u0E27 (\u0E21\u0E31\u0E14\u0E08\u0E33)', 'pay.vatable':'\u0E1A\u0E34\u0E25\u0E19\u0E35\u0E49\u0E04\u0E34\u0E14 VAT 7% (\u0E1A\u0E27\u0E01\u0E40\u0E1E\u0E34\u0E48\u0E21\u0E08\u0E32\u0E01\u0E22\u0E2D\u0E14\u0E2A\u0E38\u0E17\u0E18\u0E34)', 'pay.vat':'VAT', 'pay.vatSeparated':'\u0E41\u0E22\u0E01\u0E1A\u0E34\u0E25 (VAT 7%)', 'pay.vatYes':'VAT 7%', 'pay.noProof':'\u0E1A\u0E34\u0E25\u0E19\u0E35\u0E49\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E41\u0E19\u0E1A\u0E2B\u0E25\u0E31\u0E01\u0E10\u0E32\u0E19', 'pay.proof':'\u0E2B\u0E25\u0E31\u0E01\u0E10\u0E32\u0E19\u0E01\u0E32\u0E23\u0E0A\u0E33\u0E23\u0E30\u0E40\u0E07\u0E34\u0E19', 'pay.proofHint':'\u0E2A\u0E39\u0E07\u0E2A\u0E38\u0E14 5 \u0E44\u0E1F\u0E25\u0E4C (\u0E44\u0E21\u0E48\u0E40\u0E01\u0E34\u0E19 256KB \u0E15\u0E48\u0E2D\u0E44\u0E1F\u0E25\u0E4C)', 'pay.download':'\u0E14\u0E32\u0E27\u0E19\u0E4C\u0E42\u0E2B\u0E25\u0E14', 'pay.pending':'\u0E22\u0E2D\u0E14\u0E04\u0E49\u0E32\u0E07\u0E0A\u0E33\u0E23\u0E30', 'set.colTh':'\u0E0A\u0E37\u0E48\u0E2D\u0E20\u0E32\u0E29\u0E32\u0E44\u0E17\u0E22 (TH)', 'set.colEn':'\u0E0A\u0E37\u0E48\u0E2D\u0E20\u0E32\u0E29\u0E32\u0E2D\u0E31\u0E07\u0E01\u0E24\u0E29 (EN)', 'set.colFee':'\u0E04\u0E48\u0E32\u0E18\u0E23\u0E23\u0E21\u0E40\u0E19\u0E35\u0E22\u0E21 %', 'set.colColor':'\u0E2A\u0E35', 'set.expenseCategories':'\u0E2B\u0E21\u0E27\u0E14\u0E04\u0E48\u0E32\u0E43\u0E0A\u0E49\u0E08\u0E48\u0E32\u0E22 (Expense Category)', 'set.platforms':'\u0E0A\u0E48\u0E2D\u0E07\u0E17\u0E32\u0E07\u0E01\u0E32\u0E23\u0E02\u0E32\u0E22 (Platform)', 'set.feeHint':'\u0E04\u0E48\u0E32\u0E18\u0E23\u0E23\u0E21\u0E40\u0E19\u0E35\u0E22\u0E21\u0E41\u0E1E\u0E25\u0E15\u0E1F\u0E2D\u0E23\u0E4C\u0E21 (%)', 'set.paymentModes':'\u0E27\u0E34\u0E18\u0E35\u0E0A\u0E33\u0E23\u0E30\u0E40\u0E07\u0E34\u0E19', 'rev.discountsTitle':'ส่วนลด', 'rev.itemDiscount':'ส่วนลดสินค้า', 'rev.shippingDiscount':'ส่วนลดค่าส่ง', 'rev.overallDiscount':'ส่วนลดรวมทั้งบิล', 'rev.totalDiscount':'ส่วนลดรวม', 'rev.deliveryMethod':'วิธีจัดส่ง', 'rev.responsible':'ผู้รับผิดชอบ', 'rev.pickResp':'— เลือก —', 'rev.respHint':'ระบุผู้รับผิดชอบ', 'rev.proofLabel':'หลักฐานการจัดส่ง (Outsource)', 'rev.proofPick':'แนบไฟล์', 'rev.proofAttached':'แนบแล้ว', 'rev.proofNone':'ยังไม่ได้แนบ', 'rev.items': 'รายการสินค้า', 'del.allProvinces':'ทุกจังหวัด', 'del.allRegions':'ทุกภาค', 'del.allStatuses':'ทุกสถานะ', 'del.orderNo':'เลขที่ออเดอร์', 'del.recipient':'ผู้รับ', 'del.province':'จังหวัด', 'del.region':'ภาค', 'del.address':'ที่อยู่', 'del.status':'สถานะจัดส่ง', 'del.shipType':'วิธีจัดส่ง', 'del.responsible':'ผู้รับผิดชอบ', 'del.proof':'หลักฐาน', 'del.verified':'ยืนยัน', 'del.deliveryDate':'วันจัดส่ง', 'nav.productHistory':'ประวัติแก้ไข', 'nav.invoicing':'\u0E43\u0E1A\u0E41\u0E08\u0E49\u0E07\u0E2B\u0E19\u0E35\u0E49', 'nav.arStatus':'\u0E2A\u0E16\u0E32\u0E19\u0E30\u0E25\u0E39\u0E01\u0E2B\u0E19\u0E35\u0E49 (AR)', 'nav.receipts':'\u0E43\u0E1A\u0E40\u0E2A\u0E23\u0E47\u0E08', 'rc.avg':'\u0E40\u0E09\u0E25\u0E35\u0E48\u0E22\u0E15\u0E48\u0E2D\u0E43\u0E1A', 'inv.deposit':'\u0E21\u0E31\u0E14\u0E08\u0E33\u0E17\u0E35\u0E48\u0E23\u0E31\u0E1A\u0E21\u0E32\u0E41\u0E25\u0E49\u0E27', 'rc.count':'\u0E08\u0E33\u0E19\u0E27\u0E19\u0E43\u0E1A\u0E40\u0E2A\u0E23\u0E47\u0E08', 'rc.total':'\u0E22\u0E2D\u0E14\u0E23\u0E27\u0E21', 'rc.byMode':'\u0E41\u0E22\u0E01\u0E15\u0E32\u0E21\u0E0A\u0E48\u0E2D\u0E07\u0E17\u0E32\u0E07\u0E0A\u0E33\u0E23\u0E30', 'rc.receipts':'\u0E43\u0E1A\u0E40\u0E2A\u0E23\u0E47\u0E08', 'rc.empty':'\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E21\u0E35\u0E1A\u0E34\u0E25\u0E17\u0E35\u0E48\u0E0A\u0E33\u0E23\u0E30\u0E41\u0E25\u0E49\u0E27', 'se.delivery':'\u0E04\u0E48\u0E32\u0E2A\u0E48\u0E07\u0E08\u0E23\u0E34\u0E07', 'se.other':'\u0E04\u0E48\u0E32\u0E43\u0E0A\u0E49\u0E08\u0E48\u0E32\u0E22\u0E2D\u0E37\u0E48\u0E19', 'se.status':'\u0E2A\u0E16\u0E32\u0E19\u0E30', 'se.added':'\u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01\u0E41\u0E25\u0E49\u0E27', 'se.none':'\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01', 'se.addNote':'\u0E40\u0E1E\u0E34\u0E48\u0E21\u0E42\u0E19\u0E49\u0E15', 'nav.sellingExpenses':'\u0E04\u0E48\u0E32\u0E43\u0E0A\u0E49\u0E08\u0E48\u0E32\u0E22\u0E43\u0E19\u0E01\u0E32\u0E23\u0E02\u0E32\u0E22', 'ap.mass':'\u0E15\u0E31\u0E49\u0E07\u0E08\u0E48\u0E32\u0E22\u0E04\u0E23\u0E1A\u0E17\u0E31\u0E49\u0E07\u0E2B\u0E21\u0E14', 'ap.massBody':'\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23\u0E17\u0E31\u0E49\u0E07 {n} \u0E23\u0E32\u0E22\u0E01\u0E32\u0E23\u0E17\u0E35\u0E48\u0E01\u0E23\u0E2D\u0E07\u0E2D\u0E22\u0E39\u0E48\u0E15\u0E2D\u0E19\u0E19\u0E35\u0E49 \u0E08\u0E30\u0E16\u0E39\u0E01\u0E15\u0E31\u0E49\u0E07\u0E40\u0E1B\u0E47\u0E19 \u0E08\u0E48\u0E32\u0E22\u0E04\u0E23\u0E1A + \u0E22\u0E37\u0E19\u0E22\u0E31\u0E19 \u0E41\u0E25\u0E30\u0E2B\u0E25\u0E31\u0E01\u0E10\u0E32\u0E19\u0E17\u0E35\u0E48\u0E41\u0E19\u0E1A\u0E08\u0E30\u0E16\u0E39\u0E01\u0E43\u0E2A\u0E48\u0E43\u0E2B\u0E49\u0E17\u0E38\u0E01\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23 \u00B7 \u0E22\u0E31\u0E07\u0E15\u0E49\u0E2D\u0E07\u0E01\u0E14 Save \u0E2D\u0E35\u0E01\u0E04\u0E23\u0E31\u0E49\u0E07\u0E08\u0E36\u0E07\u0E08\u0E30\u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01', 'ap.paidAmount':'\u0E08\u0E48\u0E32\u0E22\u0E44\u0E1B\u0E41\u0E25\u0E49\u0E27', 'ap.mass':'\u0E15\u0E31\u0E49\u0E07\u0E08\u0E48\u0E32\u0E22\u0E04\u0E23\u0E1A\u0E17\u0E31\u0E49\u0E07\u0E2B\u0E21\u0E14', 'ap.massBody':'\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23\u0E17\u0E35\u0E48\u0E01\u0E23\u0E2D\u0E07\u0E44\u0E27\u0E49\u0E15\u0E2D\u0E19\u0E19\u0E35\u0E49 {n} \u0E23\u0E32\u0E22\u0E01\u0E32\u0E23 ({amt} \u0E3F) \u0E08\u0E30\u0E16\u0E39\u0E01\u0E15\u0E31\u0E49\u0E07\u0E40\u0E1B\u0E47\u0E19 \u0E08\u0E48\u0E32\u0E22\u0E04\u0E23\u0E1A \u0E41\u0E25\u0E30 \u0E22\u0E37\u0E19\u0E22\u0E31\u0E19\u0E41\u0E25\u0E49\u0E27 \u0E17\u0E31\u0E49\u0E07\u0E2B\u0E21\u0E14', 'ap.massProofHint':'\u0E44\u0E1F\u0E25\u0E4C\u0E17\u0E35\u0E48\u0E41\u0E19\u0E1A\u0E08\u0E30\u0E16\u0E39\u0E01\u0E43\u0E2A\u0E48\u0E43\u0E2B\u0E49\u0E17\u0E38\u0E01\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23 (\u0E44\u0E21\u0E48\u0E43\u0E2A\u0E48\u0E01\u0E47\u0E44\u0E14\u0E49)', 'ox.updatedBy':'\u0E2D\u0E31\u0E1B\u0E40\u0E14\u0E15\u0E42\u0E14\u0E22', 'nav.opexHistory':'\u0E1B\u0E23\u0E30\u0E27\u0E31\u0E15\u0E34\u0E41\u0E01\u0E49\u0E44\u0E02', 'nav.finOverview':'\u0E20\u0E32\u0E1E\u0E23\u0E27\u0E21', 'nav.pnl':'\u0E01\u0E33\u0E44\u0E23\u0E02\u0E32\u0E14\u0E17\u0E38\u0E19 (P&L)', 'nav.cashFlow':'\u0E01\u0E23\u0E30\u0E41\u0E2A\u0E40\u0E07\u0E34\u0E19\u0E2A\u0E14', 'nav.taxReport':'\u0E23\u0E32\u0E22\u0E07\u0E32\u0E19\u0E20\u0E32\u0E29\u0E35\u0E02\u0E32\u0E22', 'tax.modeVat':'\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23\u0E17\u0E35\u0E48\u0E04\u0E34\u0E14 VAT', 'tax.modeNoVat':'\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23\u0E17\u0E35\u0E48\u0E44\u0E21\u0E48\u0E04\u0E34\u0E14 VAT', 'tax.invoices':'\u0E43\u0E1A\u0E01\u0E33\u0E01\u0E31\u0E1A\u0E20\u0E32\u0E29\u0E35', 'tax.billsNoVat':'\u0E1A\u0E34\u0E25\u0E17\u0E35\u0E48\u0E44\u0E21\u0E48\u0E04\u0E34\u0E14 VAT', 'tax.base':'\u0E21\u0E39\u0E25\u0E04\u0E48\u0E32\u0E01\u0E48\u0E2D\u0E19 VAT', 'tax.output':'\u0E20\u0E32\u0E29\u0E35\u0E02\u0E32\u0E22 (VAT 7%)', 'tax.grand':'\u0E23\u0E27\u0E21\u0E17\u0E31\u0E49\u0E07\u0E2A\u0E34\u0E49\u0E19', 'tax.byMonth':'\u0E2A\u0E23\u0E38\u0E1B\u0E23\u0E32\u0E22\u0E40\u0E14\u0E37\u0E2D\u0E19 (\u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A\u0E22\u0E37\u0E48\u0E19)', 'tax.detail':'\u0E23\u0E32\u0E22\u0E25\u0E30\u0E40\u0E2D\u0E35\u0E22\u0E14\u0E43\u0E1A\u0E01\u0E33\u0E01\u0E31\u0E1A\u0E20\u0E32\u0E29\u0E35', 'tax.detailNoVat':'\u0E1A\u0E34\u0E25\u0E17\u0E35\u0E48\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E2D\u0E22\u0E39\u0E48\u0E43\u0E19\u0E23\u0E32\u0E22\u0E07\u0E32\u0E19', 'tax.issuer':'\u0E1C\u0E39\u0E49\u0E2D\u0E2D\u0E01\u0E43\u0E1A\u0E01\u0E33\u0E01\u0E31\u0E1A', 'tax.empty':'\u0E44\u0E21\u0E48\u0E21\u0E35\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23\u0E43\u0E19\u0E0A\u0E48\u0E27\u0E07\u0E19\u0E35\u0E49', 'tax.hint':'\u0E14\u0E36\u0E07\u0E40\u0E09\u0E1E\u0E32\u0E30\u0E1A\u0E34\u0E25\u0E17\u0E35\u0E48\u0E15\u0E34\u0E4A\u0E01 VAT \u0E44\u0E27\u0E49 \u00B7 \u0E1A\u0E34\u0E25\u0E17\u0E35\u0E48\u0E41\u0E22\u0E01\u0E04\u0E48\u0E32\u0E2A\u0E48\u0E07 \u0E04\u0E48\u0E32\u0E2A\u0E48\u0E07\u0E44\u0E21\u0E48\u0E2D\u0E22\u0E39\u0E48\u0E43\u0E19\u0E10\u0E32\u0E19\u0E20\u0E32\u0E29\u0E35 \u00B7 \u0E23\u0E32\u0E22\u0E07\u0E32\u0E19\u0E19\u0E35\u0E49\u0E40\u0E1B\u0E47\u0E19\u0E20\u0E32\u0E29\u0E35\u0E02\u0E32\u0E22\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E40\u0E14\u0E35\u0E22\u0E27 \u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E2B\u0E31\u0E01\u0E20\u0E32\u0E29\u0E35\u0E0B\u0E37\u0E49\u0E2D', 'tax.hintNoVat':'\u0E1A\u0E34\u0E25\u0E40\u0E2B\u0E25\u0E48\u0E32\u0E19\u0E35\u0E49\u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E19\u0E31\u0E1A\u0E43\u0E19\u0E23\u0E32\u0E22\u0E07\u0E32\u0E19\u0E20\u0E32\u0E29\u0E35\u0E02\u0E32\u0E22 \u2014 \u0E14\u0E39\u0E44\u0E27\u0E49\u0E40\u0E1C\u0E37\u0E48\u0E2D\u0E15\u0E23\u0E27\u0E08\u0E27\u0E48\u0E32\u0E25\u0E37\u0E21\u0E15\u0E34\u0E4A\u0E01 VAT \u0E2B\u0E23\u0E37\u0E2D\u0E44\u0E21\u0E48', 'cd.noteTitle':'\u0E2B\u0E21\u0E32\u0E22\u0E40\u0E2B\u0E15\u0E38\u0E1A\u0E19\u0E40\u0E2D\u0E01\u0E2A\u0E32\u0E23', 'cd.noteHint':'\u0E02\u0E49\u0E2D\u0E04\u0E27\u0E32\u0E21\u0E19\u0E35\u0E49\u0E40\u0E1B\u0E47\u0E19 \u0E04\u0E48\u0E32\u0E15\u0E31\u0E49\u0E07\u0E15\u0E49\u0E19 \u0E17\u0E35\u0E48\u0E08\u0E30\u0E16\u0E39\u0E01\u0E40\u0E15\u0E34\u0E21\u0E43\u0E2B\u0E49\u0E2D\u0E31\u0E15\u0E42\u0E19\u0E21\u0E31\u0E15\u0E34\u0E43\u0E19\u0E0A\u0E48\u0E2D\u0E07 \u0E2B\u0E21\u0E32\u0E22\u0E40\u0E2B\u0E15\u0E38 \u0E15\u0E2D\u0E19\u0E2A\u0E23\u0E49\u0E32\u0E1A\u0E34\u0E25\u0E43\u0E2B\u0E21\u0E48 \u2014 \u0E41\u0E01\u0E49\u0E23\u0E32\u0E22\u0E1A\u0E34\u0E25\u0E44\u0E14\u0E49 \u0E41\u0E25\u0E30\u0E40\u0E2D\u0E01\u0E2A\u0E32\u0E23\u0E08\u0E30\u0E1E\u0E34\u0E21\u0E1E\u0E4C\u0E15\u0E32\u0E21\u0E17\u0E35\u0E48\u0E23\u0E30\u0E1A\u0E38\u0E43\u0E19\u0E1A\u0E34\u0E25\u0E19\u0E31\u0E49\u0E19', 'cd.notePh':'\u0E40\u0E0A\u0E48\u0E19 \u0E40\u0E07\u0E37\u0E48\u0E2D\u0E19\u0E44\u0E02\u0E01\u0E32\u0E23\u0E23\u0E31\u0E1A\u0E1B\u0E23\u0E30\u0E01\u0E31\u0E19 \u0E27\u0E34\u0E18\u0E35\u0E14\u0E39\u0E41\u0E25\u0E2A\u0E34\u0E19\u0E04\u0E49\u0E32 \u0E0A\u0E48\u0E2D\u0E07\u0E17\u0E32\u0E07\u0E15\u0E34\u0E14\u0E15\u0E48\u0E2D', 'cd.saved':'\u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01\u0E41\u0E25\u0E49\u0E27', 'cd.previewTitle':'\u0E15\u0E31\u0E27\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E17\u0E35\u0E48\u0E08\u0E30\u0E41\u0E2A\u0E14\u0E07', 'cd.previewHint':'\u0E02\u0E49\u0E2D\u0E04\u0E27\u0E32\u0E21\u0E19\u0E35\u0E49\u0E08\u0E30\u0E27\u0E32\u0E07\u0E40\u0E2B\u0E19\u0E37\u0E2D\u0E0A\u0E48\u0E2D\u0E07\u0E25\u0E32\u0E22\u0E40\u0E0B\u0E47\u0E19\u0E43\u0E19\u0E40\u0E2D\u0E01\u0E2A\u0E32\u0E23', 'cd.previewEmpty':'\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E43\u0E2A\u0E48\u0E2B\u0E21\u0E32\u0E22\u0E40\u0E2B\u0E15\u0E38', 'rev.remarkHint':'\u0E1E\u0E34\u0E21\u0E1E\u0E4C\u0E1A\u0E19\u0E40\u0E2D\u0E01\u0E2A\u0E32\u0E23 \u00B7 \u0E40\u0E23\u0E34\u0E48\u0E21\u0E08\u0E32\u0E01\u0E04\u0E48\u0E32\u0E15\u0E31\u0E49\u0E07\u0E15\u0E49\u0E19\u0E43\u0E19\u0E2B\u0E19\u0E49\u0E32\u0E40\u0E2D\u0E01\u0E2A\u0E32\u0E23\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32 \u0E41\u0E01\u0E49\u0E44\u0E14\u0E49\u0E15\u0E48\u0E32\u0E07\u0E2B\u0E32\u0E01\u0E1A\u0E34\u0E25', 'rev.noteHint':'\u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01\u0E20\u0E32\u0E22\u0E43\u0E19 \u0E44\u0E21\u0E48\u0E02\u0E36\u0E49\u0E19\u0E1A\u0E19\u0E40\u0E2D\u0E01\u0E2A\u0E32\u0E23', 'noAccess':'\u0E1A\u0E17\u0E1A\u0E32\u0E17\u0E19\u0E35\u0E49\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E23\u0E31\u0E1A\u0E2A\u0E34\u0E17\u0E18\u0E34\u0E4C\u0E40\u0E02\u0E49\u0E32\u0E16\u0E36\u0E07\u0E2B\u0E19\u0E49\u0E32\u0E19\u0E35\u0E49', 'cd.remark':'\u0E2B\u0E21\u0E32\u0E22\u0E40\u0E2B\u0E15\u0E38', 'fin.allTime':'\u0E17\u0E31\u0E49\u0E07\u0E2B\u0E21\u0E14', 'fin.custom':'\u0E01\u0E33\u0E2B\u0E19\u0E14\u0E40\u0E2D\u0E07', 'fin.thisMonth':'\u0E40\u0E14\u0E37\u0E2D\u0E19\u0E19\u0E35\u0E49', 'fin.netProfit':'\u0E01\u0E33\u0E44\u0E23\u0E2A\u0E38\u0E17\u0E18\u0E34', 'fin.cashIn':'\u0E40\u0E07\u0E34\u0E19\u0E40\u0E02\u0E49\u0E32\u0E08\u0E23\u0E34\u0E07', 'fin.cashOut':'\u0E40\u0E07\u0E34\u0E19\u0E2D\u0E2D\u0E01\u0E08\u0E23\u0E34\u0E07', 'fin.cashNet':'\u0E40\u0E07\u0E34\u0E19\u0E2A\u0E14\u0E2A\u0E38\u0E17\u0E18\u0E34', 'fin.ar':'\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32\u0E04\u0E49\u0E32\u0E07\u0E08\u0E48\u0E32\u0E22', 'fin.ap':'\u0E2B\u0E19\u0E35\u0E49\u0E04\u0E49\u0E32\u0E07\u0E08\u0E48\u0E32\u0E22', 'fin.revByPlatform':'\u0E23\u0E32\u0E22\u0E44\u0E14\u0E49\u0E15\u0E32\u0E21\u0E0A\u0E48\u0E2D\u0E07\u0E17\u0E32\u0E07', 'fin.revShort':'\u0E23\u0E32\u0E22\u0E44\u0E14\u0E49', 'fin.costMix':'\u0E42\u0E04\u0E23\u0E07\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E15\u0E49\u0E19\u0E17\u0E38\u0E19', 'fin.health':'\u0E2A\u0E38\u0E02\u0E20\u0E32\u0E1E\u0E17\u0E32\u0E07\u0E01\u0E32\u0E23\u0E40\u0E07\u0E34\u0E19', 'fin.healthHint':'\u0E15\u0E31\u0E27\u0E40\u0E25\u0E02\u0E17\u0E35\u0E48\u0E04\u0E27\u0E23\u0E44\u0E25\u0E48\u0E15\u0E32\u0E21\u0E2D\u0E22\u0E39\u0E48\u0E40\u0E2A\u0E21\u0E2D (\u0E44\u0E21\u0E48\u0E02\u0E36\u0E49\u0E19\u0E01\u0E31\u0E1A\u0E0A\u0E48\u0E27\u0E07\u0E27\u0E31\u0E19\u0E17\u0E35\u0E48\u0E40\u0E25\u0E37\u0E2D\u0E01)', 'fin.item':'\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23', 'fin.count':'\u0E08\u0E33\u0E19\u0E27\u0E19', 'fin.note':'\u0E2B\u0E21\u0E32\u0E22\u0E40\u0E2B\u0E15\u0E38', 'fin.hAr':'\u0E1A\u0E34\u0E25\u0E17\u0E35\u0E48\u0E22\u0E31\u0E07\u0E40\u0E01\u0E47\u0E1A\u0E40\u0E07\u0E34\u0E19\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49', 'fin.hArNote':'\u0E15\u0E32\u0E21\u0E40\u0E01\u0E47\u0E1A\u0E17\u0E35\u0E48\u0E2B\u0E19\u0E49\u0E32\u0E43\u0E1A\u0E41\u0E08\u0E49\u0E07\u0E2B\u0E19\u0E35\u0E49', 'fin.hAp':'\u0E2B\u0E19\u0E35\u0E49\u0E04\u0E48\u0E32\u0E2A\u0E34\u0E19\u0E04\u0E49\u0E32\u0E17\u0E35\u0E48\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E08\u0E48\u0E32\u0E22', 'fin.hApNote':'\u0E08\u0E31\u0E14\u0E01\u0E32\u0E23\u0E17\u0E35\u0E48\u0E2B\u0E19\u0E49\u0E32 AP', 'fin.hStock':'\u0E21\u0E39\u0E25\u0E04\u0E48\u0E32\u0E2A\u0E15\u0E4A\u0E2D\u0E01\u0E04\u0E07\u0E40\u0E2B\u0E25\u0E37\u0E2D', 'fin.hStockNote':'\u0E40\u0E07\u0E34\u0E19\u0E17\u0E35\u0E48\u0E08\u0E21\u0E2D\u0E22\u0E39\u0E48\u0E01\u0E31\u0E1A\u0E02\u0E2D\u0E07', 'fin.hLoss':'\u0E1A\u0E34\u0E25\u0E17\u0E35\u0E48\u0E02\u0E32\u0E14\u0E17\u0E38\u0E19', 'fin.hLossNote':'\u0E14\u0E39\u0E23\u0E32\u0E22\u0E25\u0E30\u0E40\u0E2D\u0E35\u0E22\u0E14\u0E17\u0E35\u0E48\u0E2B\u0E19\u0E49\u0E32\u0E15\u0E49\u0E19\u0E17\u0E38\u0E19\u0E02\u0E32\u0E22', 'fin.hVat':'VAT \u0E17\u0E35\u0E48\u0E40\u0E01\u0E47\u0E1A\u0E08\u0E32\u0E01\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32', 'fin.hVatNote':'\u0E44\u0E21\u0E48\u0E43\u0E0A\u0E48\u0E23\u0E32\u0E22\u0E44\u0E14\u0E49\u0E02\u0E2D\u0E07\u0E23\u0E49\u0E32\u0E19', 'fin.statement':'\u0E07\u0E1A\u0E01\u0E33\u0E44\u0E23\u0E02\u0E32\u0E14\u0E17\u0E38\u0E19', 'fin.ofRevenue':'% \u0E02\u0E2D\u0E07\u0E23\u0E32\u0E22\u0E44\u0E14\u0E49', 'fin.revenue':'\u0E23\u0E32\u0E22\u0E44\u0E14\u0E49\u0E08\u0E32\u0E01\u0E01\u0E32\u0E23\u0E02\u0E32\u0E22', 'fin.sellingExp':'\u0E04\u0E48\u0E32\u0E43\u0E0A\u0E49\u0E08\u0E48\u0E32\u0E22\u0E43\u0E19\u0E01\u0E32\u0E23\u0E02\u0E32\u0E22', 'fin.afterSelling':'\u0E01\u0E33\u0E44\u0E23\u0E2B\u0E25\u0E31\u0E07\u0E2B\u0E31\u0E01\u0E04\u0E48\u0E32\u0E01\u0E32\u0E23\u0E02\u0E32\u0E22', 'fin.noOpex':'\u0E44\u0E21\u0E48\u0E21\u0E35\u0E04\u0E48\u0E32\u0E43\u0E0A\u0E49\u0E08\u0E48\u0E32\u0E22\u0E14\u0E33\u0E40\u0E19\u0E34\u0E19\u0E07\u0E32\u0E19\u0E43\u0E19\u0E0A\u0E48\u0E27\u0E07\u0E19\u0E35\u0E49', 'fin.revTrend':'\u0E23\u0E32\u0E22\u0E44\u0E14\u0E49\u0E22\u0E49\u0E2D\u0E19\u0E2B\u0E25\u0E31\u0E07 6 \u0E40\u0E14\u0E37\u0E2D\u0E19', 'fin.netTrend':'\u0E01\u0E33\u0E44\u0E23\u0E2A\u0E38\u0E17\u0E18\u0E34\u0E22\u0E49\u0E2D\u0E19\u0E2B\u0E25\u0E31\u0E07 6 \u0E40\u0E14\u0E37\u0E2D\u0E19', 'fin.trendHint':'\u0E16\u0E49\u0E32\u0E23\u0E32\u0E22\u0E44\u0E14\u0E49\u0E42\u0E15\u0E41\u0E15\u0E48\u0E01\u0E33\u0E44\u0E23\u0E44\u0E21\u0E48\u0E42\u0E15 \u0E41\u0E1B\u0E25\u0E27\u0E48\u0E32\u0E15\u0E49\u0E19\u0E17\u0E38\u0E19\u0E01\u0E33\u0E25\u0E31\u0E07\u0E01\u0E34\u0E19\u0E01\u0E33\u0E44\u0E23', 'fin.byMonth':'\u0E2A\u0E23\u0E38\u0E1B\u0E23\u0E32\u0E22\u0E40\u0E14\u0E37\u0E2D\u0E19', 'fin.month':'\u0E40\u0E14\u0E37\u0E2D\u0E19', 'fin.movement':'\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23', 'fin.party':'\u0E04\u0E39\u0E48\u0E04\u0E49\u0E32', 'fin.in':'\u0E40\u0E07\u0E34\u0E19\u0E40\u0E02\u0E49\u0E32', 'fin.out':'\u0E40\u0E07\u0E34\u0E19\u0E2D\u0E2D\u0E01', 'fin.mCustomer':'\u0E23\u0E31\u0E1A\u0E08\u0E32\u0E01\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32', 'fin.mSupplier':'\u0E08\u0E48\u0E32\u0E22\u0E04\u0E48\u0E32\u0E2A\u0E34\u0E19\u0E04\u0E49\u0E32', 'fin.noMoves':'\u0E44\u0E21\u0E48\u0E21\u0E35\u0E01\u0E32\u0E23\u0E40\u0E04\u0E25\u0E37\u0E48\u0E2D\u0E19\u0E44\u0E2B\u0E27\u0E02\u0E2D\u0E07\u0E40\u0E07\u0E34\u0E19', 'fin.inTrend':'\u0E40\u0E07\u0E34\u0E19\u0E40\u0E02\u0E49\u0E32\u0E23\u0E32\u0E22\u0E40\u0E14\u0E37\u0E2D\u0E19', 'fin.outTrend':'\u0E40\u0E07\u0E34\u0E19\u0E2D\u0E2D\u0E01\u0E23\u0E32\u0E22\u0E40\u0E14\u0E37\u0E2D\u0E19', 'fin.cashHint':'\u0E40\u0E07\u0E34\u0E19\u0E2A\u0E14\u0E15\u0E48\u0E32\u0E07\u0E08\u0E32\u0E01\u0E01\u0E33\u0E44\u0E23 \u2014 \u0E02\u0E32\u0E22\u0E44\u0E14\u0E49\u0E41\u0E15\u0E48\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E40\u0E01\u0E47\u0E1A\u0E40\u0E07\u0E34\u0E19 \u0E01\u0E47\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E40\u0E02\u0E49\u0E32\u0E01\u0E23\u0E30\u0E40\u0E1B\u0E4B\u0E32', 'fin.vsProfit':'\u0E15\u0E48\u0E32\u0E07\u0E08\u0E32\u0E01\u0E01\u0E33\u0E44\u0E23', 'ox.payrollOf':'\u0E40\u0E07\u0E34\u0E19\u0E40\u0E14\u0E37\u0E2D\u0E19\u0E1E\u0E19\u0E31\u0E01\u0E07\u0E32\u0E19 \u2014 {m}', 'ox.autoRow':'\u0E23\u0E30\u0E1A\u0E1A\u0E25\u0E07\u0E43\u0E2B\u0E49\u0E08\u0E32\u0E01\u0E01\u0E32\u0E23\u0E2D\u0E19\u0E38\u0E21\u0E31\u0E15\u0E34\u0E40\u0E07\u0E34\u0E19\u0E40\u0E14\u0E37\u0E2D\u0E19 \u2014 \u0E41\u0E01\u0E49\u0E17\u0E35\u0E48\u0E19\u0E35\u0E48\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49', 'ox.category':'\u0E2B\u0E21\u0E27\u0E14', 'ox.details':'\u0E23\u0E32\u0E22\u0E25\u0E30\u0E40\u0E2D\u0E35\u0E22\u0E14', 'ox.amount':'\u0E08\u0E33\u0E19\u0E27\u0E19\u0E40\u0E07\u0E34\u0E19', 'ox.receipt':'\u0E43\u0E1A\u0E40\u0E2A\u0E23\u0E47\u0E08/\u0E2B\u0E25\u0E31\u0E01\u0E10\u0E32\u0E19', 'ox.add':'+ \u0E40\u0E1E\u0E34\u0E48\u0E21\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23', 'ox.addTitle':'\u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01\u0E23\u0E32\u0E22\u0E08\u0E48\u0E32\u0E22\u0E43\u0E2B\u0E21\u0E48', 'ox.addHint':'\u0E01\u0E23\u0E2D\u0E01\u0E41\u0E25\u0E49\u0E27\u0E01\u0E14 Enter \u0E01\u0E47\u0E44\u0E14\u0E49 \u00B7 \u0E41\u0E01\u0E49\u0E43\u0E19\u0E15\u0E32\u0E23\u0E32\u0E07\u0E44\u0E14\u0E49\u0E40\u0E25\u0E22 \u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01\u0E17\u0E31\u0E19\u0E17\u0E35', 'ox.descPh':'\u0E08\u0E48\u0E32\u0E22\u0E04\u0E48\u0E32\u0E2D\u0E30\u0E44\u0E23', 'ox.count':'\u0E08\u0E33\u0E19\u0E27\u0E19\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23', 'ox.total':'\u0E23\u0E27\u0E21\u0E23\u0E32\u0E22\u0E08\u0E48\u0E32\u0E22', 'ox.avg':'\u0E40\u0E09\u0E25\u0E35\u0E48\u0E22\u0E15\u0E48\u0E2D\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23', 'ox.biggest':'\u0E2B\u0E21\u0E27\u0E14\u0E17\u0E35\u0E48\u0E08\u0E48\u0E32\u0E22\u0E21\u0E32\u0E01\u0E2A\u0E38\u0E14', 'ox.byCat':'\u0E23\u0E32\u0E22\u0E08\u0E48\u0E32\u0E22\u0E15\u0E32\u0E21\u0E2B\u0E21\u0E27\u0E14', 'ox.short':'\u0E23\u0E32\u0E22\u0E08\u0E48\u0E32\u0E22', 'ox.empty':'\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E21\u0E35\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23', 'ox.errAmount':'\u0E01\u0E23\u0E38\u0E13\u0E32\u0E43\u0E2A\u0E48\u0E08\u0E33\u0E19\u0E27\u0E19\u0E40\u0E07\u0E34\u0E19', 'ox.delConfirm':'\u0E25\u0E1A\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23\u0E19\u0E35\u0E49?', 'ap.status':'\u0E2A\u0E16\u0E32\u0E19\u0E30\u0E2B\u0E19\u0E35\u0E49', 'ap.unpaid':'\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E08\u0E48\u0E32\u0E22', 'ap.partial':'\u0E08\u0E48\u0E32\u0E22\u0E1A\u0E32\u0E07\u0E2A\u0E48\u0E27\u0E19', 'ap.paid':'\u0E08\u0E48\u0E32\u0E22\u0E04\u0E23\u0E1A', 'ap.proof':'\u0E2B\u0E25\u0E31\u0E01\u0E10\u0E32\u0E19\u0E01\u0E32\u0E23\u0E0A\u0E33\u0E23\u0E30\u0E2B\u0E19\u0E35\u0E49', 'ap.amount':'\u0E22\u0E2D\u0E14\u0E23\u0E27\u0E21', 'ap.entries':'\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23\u0E23\u0E31\u0E1A\u0E40\u0E02\u0E49\u0E32', 'ap.total':'\u0E21\u0E39\u0E25\u0E04\u0E48\u0E32\u0E23\u0E27\u0E21', 'ap.owed':'\u0E22\u0E2D\u0E14\u0E04\u0E49\u0E32\u0E07\u0E08\u0E48\u0E32\u0E22', 'ap.settled':'\u0E08\u0E48\u0E32\u0E22\u0E41\u0E25\u0E49\u0E27', 'ap.empty':'\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E21\u0E35\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23\u0E40\u0E15\u0E34\u0E21\u0E2A\u0E15\u0E4A\u0E2D\u0E01', 'ap.clickHint':'\u0E04\u0E25\u0E34\u0E01\u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19\u0E2A\u0E16\u0E32\u0E19\u0E30', 'ap.unsaved':'\u0E21\u0E35\u0E01\u0E32\u0E23\u0E41\u0E01\u0E49\u0E44\u0E02\u0E17\u0E35\u0E48\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01', 'ap.confirmTitle':'\u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01\u0E01\u0E32\u0E23\u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19\u0E41\u0E1B\u0E25\u0E07', 'ap.confirmBody':'\u0E22\u0E37\u0E19\u0E22\u0E31\u0E19\u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01 {n} \u0E23\u0E32\u0E22\u0E01\u0E32\u0E23?', 'confirm':'\u0E22\u0E37\u0E19\u0E22\u0E31\u0E19', 'nav.apList':'\u0E40\u0E08\u0E49\u0E32\u0E2B\u0E19\u0E35\u0E49 (AP)', 'nav.opExpense':'\u0E04\u0E48\u0E32\u0E43\u0E0A\u0E49\u0E08\u0E48\u0E32\u0E22\u0E14\u0E33\u0E40\u0E19\u0E34\u0E19\u0E07\u0E32\u0E19', 'nav.cogsTracking':'\u0E15\u0E34\u0E14\u0E15\u0E32\u0E21\u0E15\u0E49\u0E19\u0E17\u0E38\u0E19\u0E02\u0E32\u0E22', 'sv.skus':'\u0E08\u0E33\u0E19\u0E27\u0E19\u0E2A\u0E34\u0E19\u0E04\u0E49\u0E32', 'sv.units':'\u0E08\u0E33\u0E19\u0E27\u0E19\u0E0A\u0E34\u0E49\u0E19\u0E04\u0E07\u0E40\u0E2B\u0E25\u0E37\u0E2D', 'sv.atCost':'\u0E21\u0E39\u0E25\u0E04\u0E48\u0E32\u0E15\u0E32\u0E21\u0E15\u0E49\u0E19\u0E17\u0E38\u0E19', 'sv.atRetail':'\u0E21\u0E39\u0E25\u0E04\u0E48\u0E32\u0E15\u0E32\u0E21\u0E23\u0E32\u0E04\u0E32\u0E02\u0E32\u0E22', 'sv.potential':'\u0E01\u0E33\u0E44\u0E23\u0E17\u0E35\u0E48\u0E04\u0E32\u0E14\u0E27\u0E48\u0E32\u0E08\u0E30\u0E44\u0E14\u0E49', 'sv.margin':'\u0E2D\u0E31\u0E15\u0E23\u0E32\u0E01\u0E33\u0E44\u0E23', 'sv.byCat':'\u0E21\u0E39\u0E25\u0E04\u0E48\u0E32\u0E15\u0E32\u0E21\u0E2B\u0E21\u0E27\u0E14\u0E2A\u0E34\u0E19\u0E04\u0E49\u0E32', 'sv.byOrigin':'\u0E21\u0E39\u0E25\u0E04\u0E48\u0E32\u0E15\u0E32\u0E21\u0E41\u0E2B\u0E25\u0E48\u0E07\u0E17\u0E35\u0E48\u0E21\u0E32', 'sv.top':'\u0E2A\u0E34\u0E19\u0E04\u0E49\u0E32\u0E17\u0E35\u0E48\u0E08\u0E21\u0E17\u0E38\u0E19\u0E21\u0E32\u0E01\u0E17\u0E35\u0E48\u0E2A\u0E38\u0E14', 'sv.topHint':'\u0E40\u0E07\u0E34\u0E19\u0E01\u0E49\u0E2D\u0E19\u0E2D\u0E22\u0E39\u0E48\u0E17\u0E35\u0E48\u0E02\u0E2D\u0E07\u0E40\u0E2B\u0E25\u0E48\u0E32\u0E19\u0E35\u0E49\u0E21\u0E32\u0E01\u0E17\u0E35\u0E48\u0E2A\u0E38\u0E14 (5 \u0E2D\u0E31\u0E19\u0E14\u0E31\u0E1A\u0E41\u0E23\u0E01)', 'sv.onHand':'\u0E04\u0E07\u0E40\u0E2B\u0E25\u0E37\u0E2D', 'sv.avgCost':'\u0E15\u0E49\u0E19\u0E17\u0E38\u0E19/\u0E0A\u0E34\u0E49\u0E19', 'sv.empty':'\u0E44\u0E21\u0E48\u0E21\u0E35\u0E2A\u0E34\u0E19\u0E04\u0E49\u0E32\u0E04\u0E07\u0E40\u0E2B\u0E25\u0E37\u0E2D', 'nav.stockValue':'\u0E21\u0E39\u0E25\u0E04\u0E48\u0E32\u0E2A\u0E15\u0E4A\u0E2D\u0E01', 'cogs.pfee':'\u0E04\u0E48\u0E32\u0E18\u0E23\u0E23\u0E21\u0E40\u0E19\u0E35\u0E22\u0E21\u0E41\u0E1E\u0E25\u0E15\u0E1F\u0E2D\u0E23\u0E4C\u0E21', 'cogs.dfee':'\u0E04\u0E48\u0E32\u0E08\u0E31\u0E14\u0E2A\u0E48\u0E07\u0E08\u0E23\u0E34\u0E07', 'cogs.commission':'\u0E04\u0E48\u0E32\u0E04\u0E2D\u0E21', 'cogs.netProfit':'\u0E01\u0E33\u0E44\u0E23\u0E2B\u0E25\u0E31\u0E07\u0E2B\u0E31\u0E01\u0E04\u0E48\u0E32\u0E43\u0E0A\u0E49\u0E08\u0E48\u0E32\u0E22', 'comm.payout':'\u0E23\u0E39\u0E1B\u0E41\u0E1A\u0E1A\u0E01\u0E32\u0E23\u0E08\u0E48\u0E32\u0E22', 'comm.pool':'\u0E23\u0E27\u0E21\u0E41\u0E25\u0E49\u0E27\u0E2B\u0E32\u0E23\u0E40\u0E17\u0E48\u0E32\u0E01\u0E31\u0E19', 'comm.person':'\u0E41\u0E22\u0E01\u0E23\u0E32\u0E22\u0E1A\u0E38\u0E04\u0E04\u0E25', 'comm.payoutHint':'\u0E1C\u0E39\u0E01\u0E01\u0E31\u0E1A\u0E1E\u0E19\u0E31\u0E01\u0E07\u0E32\u0E19\u0E1B\u0E23\u0E30\u0E40\u0E20\u0E17 Salesperson', 'comm.sellerCount':'\u0E1E\u0E19\u0E31\u0E01\u0E07\u0E32\u0E19\u0E02\u0E32\u0E22\u0E02\u0E13\u0E30\u0E19\u0E35\u0E49', 'comm.base':'\u0E10\u0E32\u0E19\u0E01\u0E32\u0E23\u0E04\u0E33\u0E19\u0E27\u0E13', 'comm.baseGoods':'\u0E40\u0E09\u0E1E\u0E32\u0E30\u0E23\u0E32\u0E04\u0E32\u0E2A\u0E34\u0E19\u0E04\u0E49\u0E32', 'comm.baseGoodsShip':'\u0E23\u0E27\u0E21\u0E04\u0E48\u0E32\u0E2A\u0E48\u0E07', 'comm.rates':'\u0E2D\u0E31\u0E15\u0E23\u0E32\u0E15\u0E32\u0E21\u0E2B\u0E21\u0E27\u0E14\u0E2A\u0E34\u0E19\u0E04\u0E49\u0E32', 'comm.profitBase':'\u0E04\u0E33\u0E19\u0E27\u0E13\u0E08\u0E32\u0E01 \u0E01\u0E33\u0E44\u0E23 (\u0E22\u0E2D\u0E14\u0E02\u0E32\u0E22 \u2212 \u0E15\u0E49\u0E19\u0E17\u0E38\u0E19 \u2212 \u0E2A\u0E48\u0E27\u0E19\u0E25\u0E14 \u2212 \u0E04\u0E48\u0E32\u0E18\u0E23\u0E23\u0E21\u0E40\u0E19\u0E35\u0E22\u0E21) \u0E44\u0E21\u0E48\u0E43\u0E0A\u0E48\u0E22\u0E2D\u0E14\u0E02\u0E32\u0E22 \u00B7 \u0E23\u0E32\u0E22\u0E01\u0E32\u0E23\u0E17\u0E35\u0E48\u0E02\u0E32\u0E14\u0E17\u0E38\u0E19\u0E44\u0E21\u0E48\u0E04\u0E34\u0E14\u0E04\u0E48\u0E32\u0E04\u0E2D\u0E21', 'comm.ratesHint':'\u0E04\u0E48\u0E32\u0E40\u0E23\u0E34\u0E48\u0E21\u0E15\u0E49\u0E19 5% \u0E17\u0E38\u0E01\u0E2B\u0E21\u0E27\u0E14', 'comm.noCats':'\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E21\u0E35\u0E2B\u0E21\u0E27\u0E14\u0E2A\u0E34\u0E19\u0E04\u0E49\u0E32', 'cogs.top':'\u0E2A\u0E34\u0E19\u0E04\u0E49\u0E32\u0E17\u0E33\u0E01\u0E33\u0E44\u0E23\u0E2A\u0E39\u0E07\u0E2A\u0E38\u0E14 10 \u0E2D\u0E31\u0E19\u0E14\u0E31\u0E1A', 'cogs.topHint':'\u0E01\u0E33\u0E44\u0E23\u0E02\u0E31\u0E49\u0E19\u0E15\u0E49\u0E19\u0E15\u0E48\u0E2D\u0E2A\u0E34\u0E19\u0E04\u0E49\u0E32 (\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E2B\u0E31\u0E01\u0E04\u0E48\u0E32\u0E18\u0E23\u0E23\u0E21\u0E40\u0E19\u0E35\u0E22\u0E21/\u0E04\u0E48\u0E32\u0E2A\u0E48\u0E07/\u0E04\u0E48\u0E32\u0E04\u0E2D\u0E21 \u0E40\u0E1E\u0E23\u0E32\u0E30\u0E40\u0E1B\u0E47\u0E19\u0E04\u0E48\u0E32\u0E43\u0E0A\u0E49\u0E08\u0E48\u0E32\u0E22\u0E23\u0E30\u0E14\u0E31\u0E1A\u0E1A\u0E34\u0E25)', 'cogs.sold':'\u0E02\u0E32\u0E22\u0E44\u0E14\u0E49 (\u0E0A\u0E34\u0E49\u0E19)', 'cogs.perBill':'\u0E23\u0E32\u0E22\u0E25\u0E30\u0E40\u0E2D\u0E35\u0E22\u0E14\u0E23\u0E32\u0E22\u0E1A\u0E34\u0E25', 'cogs.bills':'\u0E08\u0E33\u0E19\u0E27\u0E19\u0E1A\u0E34\u0E25', 'cogs.revenue':'\u0E22\u0E2D\u0E14\u0E02\u0E32\u0E22 (\u0E01\u0E48\u0E2D\u0E19 VAT)', 'cogs.total':'\u0E15\u0E49\u0E19\u0E17\u0E38\u0E19\u0E02\u0E32\u0E22\u0E23\u0E27\u0E21', 'cogs.profit':'\u0E01\u0E33\u0E44\u0E23\u0E02\u0E31\u0E49\u0E19\u0E15\u0E49\u0E19', 'cogs.margin':'\u0E2D\u0E31\u0E15\u0E23\u0E32\u0E01\u0E33\u0E44\u0E23', 'cogs.byCat':'\u0E15\u0E49\u0E19\u0E17\u0E38\u0E19\u0E15\u0E32\u0E21\u0E2B\u0E21\u0E27\u0E14\u0E2A\u0E34\u0E19\u0E04\u0E49\u0E32', 'cogs.byOrigin':'\u0E15\u0E49\u0E19\u0E17\u0E38\u0E19\u0E15\u0E32\u0E21\u0E41\u0E2B\u0E25\u0E48\u0E07\u0E17\u0E35\u0E48\u0E21\u0E32', 'cogs.byStatus':'\u0E15\u0E49\u0E19\u0E17\u0E38\u0E19 \u0E0A\u0E33\u0E23\u0E30\u0E41\u0E25\u0E49\u0E27 vs \u0E04\u0E49\u0E32\u0E07\u0E0A\u0E33\u0E23\u0E30', 'cogs.paid':'\u0E0A\u0E33\u0E23\u0E30\u0E41\u0E25\u0E49\u0E27', 'cogs.unpaid':'\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E0A\u0E33\u0E23\u0E30', 'cogs.short':'\u0E15\u0E49\u0E19\u0E17\u0E38\u0E19', 'cogs.barHint':'\u0E15\u0E49\u0E19\u0E17\u0E38\u0E19\u0E17\u0E35\u0E48\u0E08\u0E21\u0E43\u0E19\u0E1A\u0E34\u0E25\u0E17\u0E35\u0E48\u0E22\u0E31\u0E07\u0E40\u0E01\u0E47\u0E1A\u0E40\u0E07\u0E34\u0E19\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49 = \u0E40\u0E07\u0E34\u0E19\u0E17\u0E35\u0E48\u0E08\u0E48\u0E32\u0E22\u0E44\u0E1B\u0E41\u0E25\u0E49\u0E27\u0E41\u0E15\u0E48\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E01\u0E25\u0E31\u0E1A\u0E21\u0E32', 'cogs.missing':'\u0E21\u0E35 {n} \u0E23\u0E32\u0E22\u0E01\u0E32\u0E23\u0E17\u0E35\u0E48\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E23\u0E30\u0E1A\u0E38 lot \u0E15\u0E49\u0E19\u0E17\u0E38\u0E19 \u2014 \u0E15\u0E49\u0E19\u0E17\u0E38\u0E19\u0E17\u0E35\u0E48\u0E41\u0E2A\u0E14\u0E07\u0E2D\u0E32\u0E08\u0E15\u0E48\u0E33\u0E01\u0E27\u0E48\u0E32\u0E08\u0E23\u0E34\u0E07', 'inv.byStatus':'\u0E41\u0E22\u0E01\u0E15\u0E32\u0E21\u0E2A\u0E16\u0E32\u0E19\u0E30\u0E1A\u0E34\u0E25', 'inv.bills':'\u0E1A\u0E34\u0E25', 'inv.billed':'\u0E22\u0E2D\u0E14\u0E23\u0E27\u0E21\u0E17\u0E35\u0E48\u0E2D\u0E2D\u0E01\u0E1A\u0E34\u0E25', 'inv.received':'\u0E23\u0E31\u0E1A\u0E21\u0E32\u0E41\u0E25\u0E49\u0E27 (\u0E21\u0E31\u0E14\u0E08\u0E33)', 'inv.unpaid':'\u0E1A\u0E34\u0E25\u0E17\u0E35\u0E48\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E23\u0E31\u0E1A\u0E0A\u0E33\u0E23\u0E30', 'inv.empty':'\u0E44\u0E21\u0E48\u0E21\u0E35\u0E1A\u0E34\u0E25\u0E04\u0E49\u0E32\u0E07\u0E0A\u0E33\u0E23\u0E30', 'nav.orderHistory':'ประวัติแก้ไข', 'eh.record':'รายการ', 'eh.changes':'จำนวนครั้ง', 'eh.lastAction':'ล่าสุด', 'eh.lastEdited':'แก้ล่าสุด', 'eh.when':'วันเวลา', 'eh.by':'ผู้ทำ', 'eh.action':'การกระทำ', 'eh.viewRaw':'ดูข้อมูลดิบ', 'eh.back':'กลับ', 'eh.empty':'ยังไม่มีประวัติ', 'eh.rawTitle':'ข้อมูล ณ ตอนนั้น (raw)', 'eh.create':'สร้าง', 'eh.edit':'แก้ไข', 'eh.delete':'ลบ', 'eh.imgChanges':'\u0E01\u0E32\u0E23\u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19\u0E41\u0E1B\u0E25\u0E07\u0E23\u0E39\u0E1B', 'eh.imgAdded':'\u0E40\u0E1E\u0E34\u0E48\u0E21\u0E23\u0E39\u0E1B', 'eh.imgRemoved':'\u0E25\u0E1A\u0E23\u0E39\u0E1B', 'eh.imgNoName':'(\u0E44\u0E21\u0E48\u0E17\u0E23\u0E32\u0E1A\u0E0A\u0E37\u0E48\u0E2D\u0E44\u0E1F\u0E25\u0E4C)', 'eh.old':'เดิม', 'eh.new':'ใหม่', 'eh.viewDetail':'ดูรายละเอียด', 'eh.items':'รายการสินค้า', 'eh.note':'หมายเหตุ', 'del.empty':'ยังไม่มีรายการจัดส่ง', 'set.deliveryStatuses':'สถานะการจัดส่ง', 'set.shippingTypes':'ประเภทการจัดส่ง (Shipping Type)', 'set.outsources':'ผู้ให้บริการ Outsource', 'set.regionMode':'รูปแบบการแบ่งภูมิภาค', 'nav.grouping':'การจัดกลุ่ม', 'nav.shippingCost':'ค่าจัดส่ง', 'nav.deliveryList':'รายการจัดส่ง', 'nav.deliveryBoard':'สถานะการจัดส่ง', 'nav.deliveryCalendar':'ปฏิทิน', 'nav.profile':'องค์กร', 'nav.profileGeneral':'ร้านค้าทั่วไป', 'bp.titleGeneral':'ข้อมูลร้านค้าทั่วไป (สำหรับออกเอกสาร)', 'bp.descGeneral':'ใช้เป็นหัวเอกสารของบิลที่ไม่ติ๊ก VAT — ไม่มีเลขประจำตัวผู้เสียภาษี', 'bp.descOrg':'ใช้เป็นหัวเอกสารของบิลที่ติ๊ก VAT (ใบกำกับภาษี)', 'cal.driverType':'ประเภทคนขับ', 'cal.driver':'คนขับ', 'cal.allTypes':'ทุกประเภท', 'cal.allDrivers':'ทุกคน', 'cal.today':'วันนี้', 'cal.unscheduled':'ยังไม่กำหนดวัน {n} รายการ', 'cal.pickTitle':'เลือกรายการที่จะส่งวันนี้', 'cal.pickNone':'ยังไม่มีรายการจัดส่งให้เลือก', 'cal.pickAllAssigned':'ทุกรายการถูกกำหนดวันไปหมดแล้ว', 'cal.colorBy':'สีตาม', 'cal.byStatus':'สถานะ', 'cal.byType':'ประเภทคนขับ', 'cal.byDriver':'ชื่อคนขับ', 'nav.deliveryDrivers':'คนขับ', 'drv.title':'สีของคนขับ', 'drv.desc':'ตั้งสีให้คนขับแต่ละคน — ใช้แสดงในปฏิทินเมื่อเลือกสีตามคนขับ', 'drv.our':'คนขับของร้าน', 'drv.outsource':'Outsource', 'drv.empty':'ยังไม่มีคนขับ (เพิ่มพนักงานประเภท Delivery Driver หรือ Outsource ก่อน)', 'set.shipCost':'ค่าจัดส่ง', 'set.shipCategory':'ประเภทสินค้า (Category)', 'set.shipCostDesc':'ตั้งราคาค่าจัดส่ง — ตามภาค (4/6) หรือรายจังหวัด', 'set.shipMode':'รูปแบบการคิดราคา', 'set.shipByProvince':'รายจังหวัด', 'set.shipProvSwitch':'วิธีตั้งราคารายจังหวัด', 'set.shipException':'ตามภาค + ยกเว้นบางจังหวัด', 'set.shipManual':'ตั้งเองทุกจังหวัด', 'set.shipPickRegion':'เลือกภาค (เพื่อตั้งราคาจังหวัดในภาคนั้น)', 'set.shipRegionBase':'ราคาฐานของภาค', 'set.baht':'บาท', 'set.region4':'4 ภาค', 'set.region6':'6 ภาค', 'set.regionModeHint':'เลือกวิธีแบ่งภูมิภาค — มีผลกับคอลัมน์/ตัวกรอง "ภาค" ในหน้าจัดส่ง และสีแบ่งภาคบนแผนที่ (ไม่ต้องเก็บข้อมูลซ้ำ เพราะภาคคำนวณจากรหัสจังหวัด)',
      'rev.orderStatus': 'สถานะออเดอร์', 'rev.invoiceStatus': 'สถานะใบเสร็จ', 'rev.totalRows': 'รวม',
      'rev.empty': 'ยังไม่มีออเดอร์ เริ่มเพิ่มออเดอร์แรกได้เลย', 'rev.delConfirm': 'ลบออเดอร์นี้?',
      'rev.addItem': '+ เพิ่มสินค้า', 'rev.itemName': 'ชื่อสินค้า', 'rev.itemProduct': 'สินค้า', 'rev.itemQty': 'จำนวน', 'rev.itemDisc': 'ส่วนลด', 'rev.itemNet': 'สุทธิ', 'rev.itemPrice': 'ราคา', 'rev.itemsTotal': 'รวมสินค้า',
      'rev.errCustomer': 'กรุณากรอกชื่อผู้รับ', 'rev.errAddress': 'กรุณากรอกที่อยู่ผู้รับ', 'rev.errItems': 'กรุณาเพิ่มรายการสินค้าอย่างน้อย 1 รายการ', 'rev.errPickProduct': 'กรุณาเลือกสินค้าจากรายการที่มีเท่านั้น', 'rev.pickProduct': '— เลือกสินค้า —', 'rev.noProducts': 'ยังไม่มีสินค้าในระบบ กรุณาเพิ่มสินค้าในหน้าจัดการสินค้าก่อนนะคะ',
      'prod.pinTitle': 'หน้านี้ต้องใส่ PIN', 'prod.pinDesc': 'กรอกรหัส PIN 6 หลักเพื่อจัดการสินค้า', 'prod.pinWrong': 'PIN ไม่ถูกต้องค่ะ ลองใหม่อีกครั้ง', 'prod.pinClear': 'ล้าง',
      'prod.restock': '+ เติมสต๊อก', 'prod.add': '+ เพิ่มสินค้า',
      'rst.title': 'เติมสต๊อกสินค้า', 'rst.ptype': 'หมวดหมู่', 'rst.allTypes': 'ทั้งหมด', 'rst.noneInType': 'ไม่มีสินค้าในหมวดหมู่นี้', 'rst.product': 'สินค้า', 'rst.qty': 'จำนวนที่เติม', 'rst.date': 'วันที่', 'rst.signature': 'ผู้เติม (Signature)', 'rst.signatureHint': 'พิมพ์ชื่อคุณ', 'rst.origin':'แหล่งต้นทุน', 'rst.cost':'ต้นทุน/ชิ้น', 'alloc.title':'ต้นทุนที่ใช้ (เลือกจาก lot)', 'alloc.add':'+ เพิ่มแหล่งต้นทุน', 'alloc.pickOrigin':'— แหล่ง —', 'alloc.pickLot':'— เลือกราคา —', 'alloc.qty':'จำนวน', 'alloc.left':'เหลือ', 'alloc.errSum':'สินค้า {p}: จำนวนต้นทุนที่เลือก ({a}) ไม่ตรงกับจำนวนขาย ({q})', 'alloc.errOver':'เลือกเกินจำนวนคงเหลือของ lot ({o} ฿{c})', 'rst.confirm': 'ยืนยันเติมสต๊อก',
      'rst.errQty': 'จำนวนต้องมากกว่า 0', 'rst.errSign': 'กรุณาพิมพ์ชื่อผู้เติม',
      'sh.product': 'สินค้า', 'sh.action': 'ประเภท', 'sh.ptype': 'หมวดหมู่', 'sh.type': 'ประเภท', 'sh.typeRestock': 'เติมสต๊อก', 'sh.typeNew': 'สินค้าใหม่', 'sh.qty': 'จำนวน', 'sh.any': 'ทั้งหมด', 'sh.gt': 'มากกว่า', 'sh.lt': 'น้อยกว่า', 'sh.eq': 'เท่ากับ', 'sh.qtyVal': 'จำนวน',
      'sh.origin':'แหล่ง', 'sh.cost':'ต้นทุน', 'sh.bill':'บิล', 'sh.verified':'ยืนยัน', 'sh.verYes':'ยืนยันแล้ว', 'sh.verNo':'ยังไม่ยืนยัน', 'sh.signature': 'ผู้เติม', 'sh.signHint': 'ค้นชื่อ', 'sh.qtyAdded': 'จำนวนที่เติม', 'sh.totalRows': 'รวม', 'sh.empty': 'ยังไม่มีประวัติการเติมสต๊อก',
      'io.exportTitle': 'ส่งออกข้อมูล Simple Store', 'io.exportDesc': 'ดาวน์โหลดข้อมูลทั้งหมด (รายจ่าย/ออเดอร์/สินค้า/ตั้งค่า/ประวัติสต๊อก) เป็นไฟล์ JSON — ไฟล์เดียวกู้กลับได้ครบ',
      'io.json': 'ดาวน์โหลด JSON (สำรองทั้งหมด)', 'io.importTitle': 'นำเข้าข้อมูล Simple Store', 'io.importDesc': 'อัปโหลดไฟล์ JSON ที่สำรองไว้ — จะแทนที่ข้อมูล Simple Store ทั้งหมด (ไม่ใช่การรวม)',
      'io.chooseFile': 'เลือกไฟล์', 'io.noFile': 'ยังไม่ได้เลือกไฟล์', 'io.importBtn': 'นำเข้า',
      'io.replaceWarn': 'การนำเข้าจะแทนที่ข้อมูล Simple Store ทั้งหมด (ปัจจุบันมี {n} รายการ) — ยืนยันหรือไม่?',
      'io.importDone': 'นำเข้าสำเร็จ', 'io.importFail': 'นำเข้าล้มเหลว — ไฟล์ไม่ถูกต้อง',
      'io.csvExportLabel': 'หรือส่งออกทีละตารางเป็น CSV (เปิดด้วย Excel ได้):', 'io.csvExp': 'CSV รายจ่าย', 'io.csvOrd': 'CSV ออเดอร์', 'io.csvProd': 'CSV สินค้า',
      'io.importNote': '⚠️ นำเข้า CSV ได้เฉพาะ รายจ่าย และ สินค้า เท่านั้น (รหัสใหม่=สร้าง · รหัสเดิม=แก้ไข · ใส่ delete ในคอลัมน์ action=ลบ) — ส่วนออเดอร์นำเข้าได้เฉพาะไฟล์ JSON (เพราะรายการสินค้าผูกกับรหัสสินค้า)',
      'io.csvDone': 'นำเข้า {t} สำเร็จ — สร้าง {c} · แก้ไข {u} · ลบ {d}', 'io.tbl_expenses': 'รายจ่าย', 'io.tbl_products': 'สินค้า', 'prod.addTitle': 'เพิ่มสินค้า', 'prod.editTitle': 'แก้ไขสินค้า',
      'img.max5':'\u0E2A\u0E39\u0E07\u0E2A\u0E38\u0E14 5 \u0E23\u0E39\u0E1B', 'pc.pickColor':'\u2014 \u0E40\u0E25\u0E37\u0E2D\u0E01\u0E2A\u0E35 \u2014', 'rev.pickColorFirst':'\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E2A\u0E35\u0E01\u0E48\u0E2D\u0E19 \u0E08\u0E36\u0E07\u0E08\u0E30\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E41\u0E2B\u0E25\u0E48\u0E07\u0E15\u0E49\u0E19\u0E17\u0E38\u0E19\u0E44\u0E14\u0E49', 'rev.errPickColor':'\u0E01\u0E23\u0E38\u0E13\u0E32\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E2A\u0E35\u0E02\u0E2D\u0E07 {p}', 'pc.noColor':'\u0E44\u0E21\u0E48\u0E23\u0E30\u0E1A\u0E38\u0E2A\u0E35', 'pc.colorLabel':'\u0E2A\u0E35', 'prod.desc':'\u0E23\u0E32\u0E22\u0E25\u0E30\u0E40\u0E2D\u0E35\u0E22\u0E14\u0E2A\u0E34\u0E19\u0E04\u0E49\u0E32', 'prod.descPh':'\u0E04\u0E33\u0E2D\u0E18\u0E34\u0E1A\u0E32\u0E22\u0E2A\u0E34\u0E19\u0E04\u0E49\u0E32 \u0E27\u0E31\u0E2A\u0E14\u0E38 \u0E02\u0E19\u0E32\u0E14 \u0E01\u0E32\u0E23\u0E14\u0E39\u0E41\u0E25 ฯลฯ', 'pc.section':'\u0E41\u0E1A\u0E1A\u0E2A\u0E35', 'pc.enable':'\u0E2A\u0E34\u0E19\u0E04\u0E49\u0E32\u0E19\u0E35\u0E49\u0E21\u0E35\u0E41\u0E1A\u0E1A\u0E2A\u0E35', 'pc.add':'+ \u0E40\u0E1E\u0E34\u0E48\u0E21\u0E2A\u0E35', 'pc.namePh':'\u0E0A\u0E37\u0E48\u0E2D\u0E2A\u0E35', 'pc.image':'\u0E23\u0E39\u0E1B\u0E02\u0E2D\u0E07\u0E2A\u0E35\u0E19\u0E35\u0E49', 'pc.rmImage':'\u0E40\u0E2D\u0E32\u0E23\u0E39\u0E1B\u0E2D\u0E2D\u0E01', 'prod.tagAuto':'\u0E15\u0E31\u0E49\u0E07\u0E43\u0E2B\u0E49\u0E2D\u0E31\u0E15\u0E42\u0E19\u0E21\u0E31\u0E15\u0E34\u0E15\u0E32\u0E21\u0E2A\u0E15\u0E4A\u0E2D\u0E01\u0E04\u0E07\u0E40\u0E2B\u0E25\u0E37\u0E2D', 'prod.image': 'รูป', 'sec.detail':'รายละเอียดสินค้า', 'sec.cost':'ต้นทุน', 'sec.selling':'การขาย', 'sec.evidence':'หลักฐาน', 'sec.product':'สินค้า', 'sec.order':'ออเดอร์', 'sec.customer':'ลูกค้า', 'prod.bill':'ใบซื้อ/บิล', 'bill.tooBig':'ไฟล์ใหญ่เกิน 256KB', 'prod.sku': 'รหัสสินค้า', 'prod.name': 'ชื่อสินค้า', 'prod.cost': 'ต้นทุน', 'prod.price': 'ราคาขาย',
      'prod.sale': 'ลดราคา',
      'promo.btn': 'โปรโมชั่น', 'promo.navLabel': 'โปรโมชัน',
      'promo.title': 'จัดการโปรโมชัน', 'promo.desc': 'ตั้งช่วงลดราคาตามหมวดหมู่/สินค้า · สินค้าจะลดอัตโนมัติเมื่อถึงช่วงเวลา และหยุดเองเมื่อพ้นวันสิ้นสุด (ตรวจตอนเปิดแอป)',
      'promo.new': '+ สร้างโปรโมชัน', 'promo.empty': 'ยังไม่มีโปรโมชัน', 'promo.close': 'ปิด',
      'promo.untitled': '(ไม่มีชื่อ)', 'promo.itemsUnit': 'รายการ', 'promo.selected': 'ที่เลือก',
      'promo.status.active': 'กำลังลด', 'promo.status.scheduled': 'ตั้งเวลาไว้', 'promo.status.ended': 'สิ้นสุดแล้ว',
      'promo.addTitle': 'สร้างโปรโมชัน', 'promo.editTitle': 'แก้ไขโปรโมชัน',
      'promo.name': 'ชื่อโปรโมชัน', 'promo.namePh': 'เช่น โปร 11.11, ลดหน้าร้อน',
      'promo.effDate': 'วันเริ่ม (Effective)', 'promo.endDate': 'วันสิ้นสุด (End)',
      'promo.pickProducts': 'เลือกสินค้าที่จะลด', 'promo.category': 'หมวดหมู่', 'promo.noCat': '— ไม่มีหมวดหมู่ —',
      'promo.addItem': 'เลือกชิ้นนี้', 'promo.pickProduct': '— เลือกสินค้า —', 'promo.noneLeft': 'ไม่มีสินค้าเหลือในหมวดนี้', 'promo.emptyPicked': 'ยังไม่ได้เลือกสินค้า',
      'promo.noProdInCat': 'ไม่มีสินค้าในหมวดนี้', 'promo.delConfirm': 'ลบโปรโมชันนี้ใช่ไหมคะ?',
      'promo.errDates': 'กรุณาใส่วันเริ่มและวันสิ้นสุด', 'promo.errRange': 'วันสิ้นสุดต้องไม่ก่อนวันเริ่ม', 'promo.errItems': 'กรุณาเลือกสินค้าอย่างน้อย 1 ชิ้น',
      'promo.endedTitle': 'โปรโมชันสิ้นสุดแล้ว', 'promo.endedOn': 'สิ้นสุด',
      'prod.stock': 'สต๊อก', 'prod.origin':'แหล่งต้นทุน (สต๊อกเปิด)', 'prod.noLots':'ยังไม่มี lot', 'prod.unit':'ชิ้น', 'prod.reserved': 'จองแล้ว', 'prod.sold': 'ขายแล้ว', 'prod.ptype': 'หมวดหมู่', 'prod.pickType': '— เลือกหมวดหมู่ —', 'prod.errType': 'กรุณาเลือกหมวดหมู่', 'prod.tag': 'สถานะ', 'prod.empty': 'ยังไม่มีสินค้าในระบบ เริ่มเพิ่มสินค้าแรกได้เลย',
      'prod.delConfirm': 'ลบสินค้านี้? (ออเดอร์เก่าจะยังเก็บชื่อ/ราคาไว้ตามเดิม)', 'prod.errSku': 'กรุณากรอกรหัสสินค้า', 'prod.errName': 'กรุณากรอกชื่อสินค้า', 'exp.errDetails': 'กรุณากรอกรายละเอียดรายการ', 'exp.errDate': 'กรุณาเลือกวันที่', 'exp.errAmount': 'จำนวนต้องมากกว่า 0',
      'nav.expense': 'รายจ่าย', 'nav.summary': 'สรุปต้นทุน', 'nav.revenue': 'รายรับ/ออกบิล',
      'nav.orderStatus': 'สถานะออเดอร์', 'nav.invoiceStatus': 'สถานะใบเสร็จ',
      'nav.products': 'จัดการสินค้า', 'nav.stockHistory': 'ประวัติเติมสต๊อก', 'nav.setting': 'ตั้งค่า', 'nav.stockConfig':'สต๊อก', 'nav.sellConfig':'การขาย', 'nav.acctConfig':'ตั้งค่า',
      'set.title': 'ตั้งค่า', 'set.desc': 'จัดการหัวข้อและสีของ Tag และสถานะต่าง ๆ — เพิ่ม แก้ไข เปลี่ยนสี หรือลบได้',
      'set.expenseTags': 'Tag รายจ่าย', 'set.revenueTags': 'Tag รายรับ/ออกบิล',
      'set.orderStatuses': 'สถานะออเดอร์', 'set.invoiceStatuses': 'สถานะใบเสร็จ',
      'set.add': '+ เพิ่ม', 'set.nameTh':'ชื่อ (TH)', 'set.nameEn':'ชื่อ (EN)', 'set.none': 'ยังไม่มีรายการ', 'set.newItem': 'รายการใหม่',
      'set.delConfirm': 'ลบรายการนี้?', 'set.lockedHint': 'สถานะนี้ใช้ตัดสต๊อก แก้ชื่อ/สีได้ แต่ลบไม่ได้',
      'set.broughtFrom': 'แหล่งที่ซื้อ (Brought From)', 'set.productTypes': 'หมวดหมู่สินค้า', 'set.costOrigins': 'แหล่งต้นทุน (Cost Origin)', 'set.prefixTitle': 'รหัสนำหน้า ID', 'set.prefixDesc': 'กำหนดตัวอักษรนำหน้ารหัส (ไม่เกิน 4 ตัว) สำหรับรายจ่ายและออเดอร์',
      'set.prefixExpense': 'นำหน้ารหัสรายจ่าย', 'set.prefixOrder': 'นำหน้าเลขบิลออเดอร์',
      'kb.empty': 'ไม่มีออเดอร์', 'kb.completeHint': 'ลากออเดอร์มาที่นี่ → ย้ายไปหน้า Completed อัตโนมัติ', 'kb.paidHint': 'ลากออเดอร์มาที่นี่ → ทำเครื่องหมายจ่ายครบ (ตัดสต๊อกเป็น Sold)',
      'bp.title': 'ข้อมูลร้าน (สำหรับออกเอกสาร)', 'bp.desc': 'ใช้เป็นหัวเอกสารการเงินทุกใบ (ใบสำคัญรับเงิน ฯลฯ)',
      'bp.name': 'ชื่อร้าน / ผู้ประกอบการ (TH)', 'bp.nameEn': 'ชื่อร้าน / ผู้ประกอบการ (EN)', 'bp.address': 'ที่อยู่ (TH)', 'bp.addressEn': 'ที่อยู่ (EN)', 'bp.phone': 'เบอร์ติดต่อ', 'bp.taxId': 'เลขประจำตัวผู้เสียภาษี (ถ้ามี)',
      'bp.logo': 'โลโก้', 'bp.signature': 'ลายเซ็น', 'bp.stamp': 'ตราประทับ', 'bp.vatDefault': 'ค่าเริ่มต้น: คำนวณ VAT 7%', 'bp.remove': 'ลบรูป',
      'doc.rv.title': 'ใบสำคัญรับเงิน', 'doc.optsDesc': 'เลือกตัวเลือกก่อนออกเอกสาร แล้วสั่งพิมพ์/บันทึกเป็น PDF',
      'doc.bn.title': 'ใบวางบิล', 'doc.rc.title': 'ใบเสร็จรับเงิน', 'doc.makeTitle': 'ออกเอกสาร',
      'doc.billTo': 'วางบิลถึง', 'doc.biller': 'ลายเซ็นพนักงานขาย', 'doc.billReceiver': 'ลงชื่อผู้รับวางบิล',
      'doc.st.received': 'ได้รับเงินไว้เป็นการถูกต้องเรียบร้อยแล้ว', 'doc.st.pleasePay': 'กรุณาชำระเงินตามยอดรวมข้างต้น',
      'doc.noProfile': '⚠ ยังไม่ได้กรอกข้อมูลร้านในหน้า Setting เอกสารจะไม่มีหัวร้าน', 'doc.reference':'\u0E2D\u0E49\u0E32\u0E07\u0E2D\u0E34\u0E07', 'doc.createdBy':'\u0E1C\u0E39\u0E49\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23', 'doc.custTaxId':'\u0E40\u0E25\u0E02\u0E1B\u0E23\u0E30\u0E08\u0E33\u0E15\u0E31\u0E27\u0E1C\u0E39\u0E49\u0E40\u0E2A\u0E35\u0E22\u0E20\u0E32\u0E29\u0E35', 'doc.custPhone':'\u0E42\u0E17\u0E23.', 'doc.col.code':'\u0E23\u0E2B\u0E31\u0E2A\u0E2A\u0E34\u0E19\u0E04\u0E49\u0E32', 'doc.taxCustomer':'\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E1C\u0E39\u0E49\u0E0B\u0E37\u0E49\u0E2D (\u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A\u0E43\u0E1A\u0E01\u0E33\u0E01\u0E31\u0E1A\u0E20\u0E32\u0E29\u0E35)', 'doc.taxCustomerHint':'\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E15\u0E23\u0E07\u0E19\u0E35\u0E49\u0E08\u0E30\u0E44\u0E1B\u0E41\u0E17\u0E19\u0E0A\u0E37\u0E48\u0E2D-\u0E17\u0E35\u0E48\u0E2D\u0E22\u0E39\u0E48\u0E1C\u0E39\u0E49\u0E23\u0E31\u0E1A\u0E1A\u0E19\u0E40\u0E2D\u0E01\u0E2A\u0E32\u0E23 \u00B7 \u0E23\u0E30\u0E1A\u0E1A\u0E08\u0E30\u0E08\u0E33\u0E44\u0E27\u0E49\u0E43\u0E2B\u0E49', 'doc.custCompany':'\u0E0A\u0E37\u0E48\u0E2D\u0E1A\u0E23\u0E34\u0E29\u0E31\u0E17\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32', 'doc.custAddress':'\u0E17\u0E35\u0E48\u0E2D\u0E22\u0E39\u0E48\u0E1A\u0E23\u0E34\u0E29\u0E31\u0E17\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32', 'doc.dp.title':'\u0E43\u0E1A\u0E23\u0E31\u0E1A\u0E21\u0E31\u0E14\u0E08\u0E33', 'doc.dp.disabled':'\u0E2D\u0E2D\u0E01\u0E44\u0E14\u0E49\u0E40\u0E09\u0E1E\u0E32\u0E30\u0E1A\u0E34\u0E25\u0E17\u0E35\u0E48\u0E22\u0E31\u0E07\u0E21\u0E35\u0E22\u0E2D\u0E14\u0E04\u0E49\u0E32\u0E07\u0E0A\u0E33\u0E23\u0E30', 'doc.dp.paid':'\u0E23\u0E31\u0E1A\u0E21\u0E31\u0E14\u0E08\u0E33\u0E41\u0E25\u0E49\u0E27', 'doc.dp.balance':'\u0E04\u0E07\u0E40\u0E2B\u0E25\u0E37\u0E2D\u0E15\u0E49\u0E2D\u0E07\u0E0A\u0E33\u0E23\u0E30', 'doc.st.deposit':'\u0E44\u0E14\u0E49\u0E23\u0E31\u0E1A\u0E40\u0E07\u0E34\u0E19\u0E21\u0E31\u0E14\u0E08\u0E33\u0E44\u0E27\u0E49\u0E40\u0E23\u0E35\u0E22\u0E1A\u0E23\u0E49\u0E2D\u0E22\u0E41\u0E25\u0E49\u0E27', 'doc.tx.title':'\u0E43\u0E1A\u0E01\u0E33\u0E01\u0E31\u0E1A\u0E20\u0E32\u0E29\u0E35', 'doc.vatCalc':'\u0E1A\u0E34\u0E25\u0E19\u0E35\u0E49\u0E04\u0E33\u0E19\u0E27\u0E13 VAT 7%', 'doc.splitHint':'\u0E23\u0E39\u0E1B\u0E41\u0E1A\u0E1A\u0E19\u0E35\u0E49\u0E1C\u0E39\u0E01\u0E01\u0E31\u0E1A\u0E1A\u0E34\u0E25 \u2014 \u0E16\u0E49\u0E32\u0E41\u0E22\u0E01\u0E1A\u0E34\u0E25 \u0E04\u0E48\u0E32\u0E2A\u0E48\u0E07\u0E08\u0E30\u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E04\u0E34\u0E14 VAT \u0E41\u0E25\u0E30 NET \u0E08\u0E30\u0E1B\u0E23\u0E31\u0E1A\u0E43\u0E2B\u0E49\u0E17\u0E31\u0E19\u0E17\u0E35', 'doc.splitShort':'\u0E41\u0E22\u0E01', 'doc.payFromOrder':'\u0E27\u0E34\u0E18\u0E35\u0E0A\u0E33\u0E23\u0E30\u0E40\u0E07\u0E34\u0E19 (\u0E15\u0E32\u0E21\u0E17\u0E35\u0E48\u0E23\u0E30\u0E1A\u0E38\u0E43\u0E19\u0E1A\u0E34\u0E25)', 'eh.billDetails':'\u0E23\u0E32\u0E22\u0E25\u0E30\u0E40\u0E2D\u0E35\u0E22\u0E14\u0E40\u0E01\u0E35\u0E48\u0E22\u0E27\u0E01\u0E31\u0E1A\u0E1A\u0E34\u0E25', 'doc.splitMode':'\u0E23\u0E39\u0E1B\u0E41\u0E1A\u0E1A\u0E1A\u0E34\u0E25', 'doc.splitTogether':'\u0E23\u0E27\u0E21\u0E2A\u0E34\u0E19\u0E04\u0E49\u0E32+\u0E04\u0E48\u0E32\u0E2A\u0E48\u0E07', 'doc.splitApart':'\u0E41\u0E22\u0E01\u0E1A\u0E34\u0E25', 'doc.makeGoods':'\u0E2D\u0E2D\u0E01\u0E1A\u0E34\u0E25\u0E2A\u0E34\u0E19\u0E04\u0E49\u0E32', 'doc.makeShip':'\u0E2D\u0E2D\u0E01\u0E1A\u0E34\u0E25\u0E04\u0E48\u0E32\u0E2A\u0E48\u0E07', 'doc.goodsOnly':'\u0E40\u0E09\u0E1E\u0E32\u0E30\u0E2A\u0E34\u0E19\u0E04\u0E49\u0E32', 'doc.shipOnly':'\u0E40\u0E09\u0E1E\u0E32\u0E30\u0E04\u0E48\u0E32\u0E2A\u0E48\u0E07', 'doc.taxId':'\u0E40\u0E25\u0E02\u0E1B\u0E23\u0E30\u0E08\u0E33\u0E15\u0E31\u0E27\u0E1C\u0E39\u0E49\u0E40\u0E2A\u0E35\u0E22\u0E20\u0E32\u0E29\u0E35', 'bp.branch':'\u0E2A\u0E32\u0E02\u0E32', 'bp.branchDefault':'\u0E2A\u0E33\u0E19\u0E31\u0E01\u0E07\u0E32\u0E19\u0E43\u0E2B\u0E0D\u0E48', 'pay.vatNo':'\u0E44\u0E21\u0E48\u0E04\u0E34\u0E14 VAT', 'doc.vat': 'คำนวณ VAT 7% (ราคารวม VAT แล้ว)',
      'doc.payMethod': 'วิธีชำระเงิน', 'doc.pay.cash': 'เงินสด', 'doc.pay.transfer': 'โอนเงิน', 'doc.pay.other': 'อื่น ๆ',
      'doc.make': 'ออกเอกสาร', 'doc.popupBlocked': 'เบราว์เซอร์บล็อกป๊อปอัป กรุณาอนุญาตแล้วลองใหม่', 'doc.print': 'พิมพ์ / บันทึก PDF',
      'doc.yourStore': '(ชื่อร้านของคุณ)', 'doc.no': 'เลขที่', 'doc.date': 'วันที่', 'doc.receivedFrom': 'ได้รับเงินจาก', 'doc.ref': 'อ้างอิงเลขที่',
      'doc.col.no': 'ลำดับ', 'doc.col.item': 'รายการ', 'doc.col.qty': 'จำนวน', 'doc.col.unit': 'ราคา/หน่วย', 'doc.col.amount': 'จำนวนเงิน',
      'doc.subtotal': 'รวมเป็นเงิน', 'doc.discount': 'ส่วนลด', 'doc.shipping':'ค่าจัดส่ง', 'doc.itemDiscount':'ส่วนลดสินค้า', 'doc.shipDiscount':'ส่วนลดค่าส่ง', 'doc.overallDiscount':'ส่วนลดรวมบิล', 'doc.totalDiscount':'ส่วนลดทั้งหมด', 'doc.showDiscounts':'แสดงส่วนลด', 'doc.discItem':'สินค้า', 'doc.discShip':'ค่าส่ง', 'doc.discOverall':'รวมบิล', 'doc.language':'ภาษาเอกสาร', 'doc.langTh':'ไทย', 'doc.langEn':'อังกฤษ', 'doc.beforeVat': 'มูลค่าก่อน VAT', 'doc.vat7': 'ภาษีมูลค่าเพิ่ม 7%', 'doc.grand': 'รวมทั้งสิ้น',
      'doc.amountWords': 'จำนวนเงิน (ตัวอักษร)', 'doc.payer': 'ลงชื่อผู้จ่ายเงิน', 'doc.payee': 'ลายเซ็นพนักงานขาย', 'doc.footNote': 'เอกสารนี้ออกจากระบบ Simple Store',
      'nav.account': 'รายงานรายเดือน', 'nav.deleted':'\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23\u0E17\u0E35\u0E48\u0E16\u0E39\u0E01\u0E25\u0E1A', 'bin.desc':'\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23\u0E17\u0E35\u0E48\u0E16\u0E39\u0E01\u0E25\u0E1A\u0E08\u0E30\u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E19\u0E31\u0E1A\u0E23\u0E27\u0E21\u0E43\u0E19\u0E22\u0E2D\u0E14\u0E43\u0E14 \u0E46 \u0E08\u0E19\u0E01\u0E27\u0E48\u0E32\u0E08\u0E30\u0E01\u0E39\u0E49\u0E04\u0E37\u0E19', 'bin.products':'\u0E2A\u0E34\u0E19\u0E04\u0E49\u0E32\u0E17\u0E35\u0E48\u0E16\u0E39\u0E01\u0E25\u0E1A', 'bin.orders':'\u0E1A\u0E34\u0E25\u0E17\u0E35\u0E48\u0E16\u0E39\u0E01\u0E25\u0E1A', 'bin.restore':'\u0E01\u0E39\u0E49\u0E04\u0E37\u0E19', 'bin.confirm':'\u0E01\u0E39\u0E49\u0E04\u0E37\u0E19\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23\u0E19\u0E35\u0E49\u0E01\u0E25\u0E31\u0E1A\u0E44\u0E1B\u0E23\u0E27\u0E21\u0E43\u0E19\u0E22\u0E2D\u0E14\u0E2B\u0E25\u0E31\u0E01?', 'bin.qty':'\u0E08\u0E33\u0E19\u0E27\u0E19\u0E04\u0E07\u0E40\u0E2B\u0E25\u0E37\u0E2D', 'bin.lotValue':'\u0E21\u0E39\u0E25\u0E04\u0E48\u0E32\u0E15\u0E49\u0E19\u0E17\u0E38\u0E19', 'bin.expenses':'\u0E23\u0E32\u0E22\u0E08\u0E48\u0E32\u0E22\u0E17\u0E35\u0E48\u0E1E\u0E48\u0E27\u0E07', 'bin.deletedBy':'\u0E25\u0E1A\u0E42\u0E14\u0E22', 'bin.empty':'\u0E44\u0E21\u0E48\u0E21\u0E35\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23', 'acct.cogs':'\u0E15\u0E49\u0E19\u0E17\u0E38\u0E19\u0E02\u0E32\u0E22', 'acct.profit':'\u0E01\u0E33\u0E44\u0E23\u0E15\u0E48\u0E2D\u0E1A\u0E34\u0E25', 'nav.vat':'\u0E04\u0E33\u0E19\u0E27\u0E13 VAT', 'vat.base':'\u0E01\u0E48\u0E2D\u0E19 VAT', 'vat.amount':'VAT 7%', 'vat.totalNet':'\u0E22\u0E2D\u0E14\u0E23\u0E27\u0E21', 'vat.totalBase':'\u0E23\u0E27\u0E21\u0E01\u0E48\u0E2D\u0E19 VAT', 'vat.totalVat':'VAT \u0E23\u0E27\u0E21', 'nav.ledger': 'สมุดบัญชี (Ledger)', 'acct.summary': 'สรุป', 'acct.table': 'รายการ (Table)', 'acct.monthlyTitle': 'รายรับรายจ่ายรายเดือน',
      'acct.year': 'ปี', 'acct.month': 'เดือน', 'acct.income': 'รายรับ', 'acct.expense': 'รายจ่าย', 'acct.net': 'คงเหลือสุทธิ', 'acct.yearNet': 'สุทธิทั้งปี',
      'acct.vatMode': 'การคำนวณ VAT', 'acct.vatAll': 'คิด VAT ทั้งหมด', 'acct.vatTicked': 'เฉพาะรายการที่ติ๊ก', 'acct.vatNone': 'ไม่คิด VAT',
      'acct.outVat': 'ภาษีขาย (จากรายรับ)', 'acct.inVat': 'ภาษีซื้อ (จากรายจ่าย)', 'acct.vatNet': 'VAT สุทธิ (ขาย−ซื้อ)', 'acct.byMonth': 'รายเดือน (ทั้งปี)',
      'acct.date': 'วันที่', 'acct.type': 'ประเภท', 'acct.item': 'รายการ', 'acct.amount': 'จำนวนเงิน', 'acct.vatable': 'คิด VAT',
      'acct.tableNote': 'ติ๊กเพื่อเลือกรายการที่จะคิด VAT (ใช้กับโหมด "เฉพาะรายการที่ติ๊ก")', 'acct.noItems': 'ยังไม่มีรายการ'
    },
    en: {
      'title': 'Simple Store Management', 'crumb': 'Store management console',
      'soon': 'This section is coming soon…',
      'delete': 'Delete', 'edit': 'Edit', 'save': 'Save', 'cancel': 'Cancel',
      'exp.from': 'From', 'exp.to': 'To', 'exp.tag': 'Tag', 'exp.all': 'All',
      'exp.restockOf':'Restock \u2014 {p}', 'exp.newStockOf':'Opening stock \u2014 {p}', 'exp.auto':'Auto', 'exp.clearFilter': 'Clear filter', 'exp.add': '+ Add entry', 'exp.addTitle': 'Add expense', 'exp.editTitle': 'Edit expense',
      'exp.id': 'ID', 'exp.date': 'Date', 'exp.details': 'Item', 'exp.costPerPiece': 'Cost/pc', 'exp.amount': 'Qty',
      'exp.sumItems': 'Items total', 'exp.shipping': 'Shipping', 'exp.discount': 'Discount', 'exp.net': 'Net',
      'exp.purchaseFrom': 'Bought from', 'exp.pickFrom': '— Select source —', 'exp.note': 'Note', 'exp.totalRows': 'Total', 'exp.empty': 'No expenses yet — add your first entry',
      'exp.delConfirm': 'Delete this entry?',
      'sum.period': 'Period', 'sum.allTime': 'All time', 'sum.tag': 'Tag', 'sum.netTotal': 'Net Total', 'sum.percent': '% of total',
      'sum.sum': 'Sum', 'sum.totalNet': 'Total expenses (net)', 'sum.count': 'Entries', 'sum.avg': 'Average per entry', 'sum.byCategory':'Cost by product category', 'sum.byOrigin':'Cost by cost origin', 'sum.uncategorised':'Uncategorised', 'sum.noOrigin':'No origin', 'sum.noData': 'No data in this period yet',
      'rev.add': '+ Add order', 'rev.addTitle': 'Add order', 'rev.editTitle': 'Edit order',
      'rev.invoiceNo': 'Invoice #', 'col.lastEdited':'Last edited', 'rev.customer': 'Recipient', 'rev.customerHint': 'Recipient full name', 'rev.back':'Back', 'rev.mapHint':'Or pick a province on the map', 'rev.selProvince':'Selected province', 'rev.noProvince':'No province selected', 'region.north':'North', 'region.central':'Central', 'region.northeast':'Northeast', 'region.east':'East', 'region.west':'West', 'region.south':'South', 'rev.address': 'Recipient address', 'rev.addressHint': 'Shipping address', 'rev.addrLine':'Address (no./soi/road)', 'rev.addrLineHint':'House no., moo, soi, road', 'rev.province':'Province', 'rev.district':'District', 'rev.subdistrict':'Subdistrict', 'rev.postal':'Postal code', 'rev.postalHint':'Auto', 'rev.loading':'Loading...', 'rev.errAddrLine':'Please enter the address line', 'rev.errAddrGeo':'Please select province/district/subdistrict', 'sec.seller':'Seller', 'sell.issuedBy':'Issued by', 'sell.signature':'Signature', 'sell.clear':'Clear', 'sell.upload':'Upload image', 'sell.signHint':'Draw in the box, or upload an image (max 256KB)', 'sell.errSign':'Please sign before saving', 'sell.seller':'Seller', 'rev.platformFee':'Platform fee', 'rev.platform': 'Sold via Platform', 'rev.platformHint': 'e.g. TikTok Shop', 'sec.delivery':'Delivery', 'sec.inventory':'Inventory', 'rev.phone':'Phone', 'rev.phoneHint':'Contact phone', 'rev.shippingTitle':'Shipping', 'rev.shippingCost':'Shipping', 'rev.shippingOverride':'Override shipping (manual)', 'rev.shipAuto':'Auto', 'rev.shipNoCat':'No products/categories yet', 'sec.vat':'VAT Management', 'sec.payment':'Payment', 'pay.mode':'Payment Method', 'pay.paid':'Partially Paid', 'pay.vatable':'This bill is charged VAT 7% (added on top of the net)', 'pay.vat':'VAT', 'pay.vatSeparated':'Separated', 'pay.vatYes':'VAT 7%', 'pay.noProof':'No payment proof attached to this bill', 'pay.proof':'Payment proof', 'pay.proofHint':'Up to 5 files (max 256KB each)', 'pay.download':'Download', 'pay.pending':'Amount Pending', 'set.colTh':'Thai name (TH)', 'set.colEn':'English name (EN)', 'set.colFee':'Fee %', 'set.colColor':'Colour', 'set.expenseCategories':'Expense Categories', 'set.platforms':'Sales Platforms', 'set.feeHint':'Platform fee (%)', 'set.paymentModes':'Payment Methods', 'rev.discountsTitle':'Discounts', 'rev.itemDiscount':'Item Discount', 'rev.shippingDiscount':'Shipping Discount', 'rev.overallDiscount':'Overall Discount', 'rev.totalDiscount':'Total Discount', 'rev.deliveryMethod':'Delivery Method', 'rev.responsible':'Responsible', 'rev.pickResp':'— select —', 'rev.respHint':'Enter responsible', 'rev.proofLabel':'Delivery proof (Outsource)', 'rev.proofPick':'Attach file', 'rev.proofAttached':'Attached', 'rev.proofNone':'No file', 'rev.items': 'Items', 'del.allProvinces':'All provinces', 'del.allRegions':'All regions', 'del.allStatuses':'All statuses', 'del.orderNo':'Order #', 'del.recipient':'Recipient', 'del.province':'Province', 'del.region':'Region', 'del.address':'Address', 'del.status':'Delivery status', 'del.shipType':'Shipping Type', 'del.responsible':'Responsible', 'del.proof':'Proof', 'del.verified':'Verified', 'del.deliveryDate':'Delivery Date', 'nav.productHistory':'Edit History', 'nav.invoicing':'Invoicing', 'nav.arStatus':'AR Status', 'nav.receipts':'Receipts', 'rc.avg':'Average per receipt', 'inv.deposit':'Deposits received', 'rc.count':'Receipts', 'rc.total':'Total', 'rc.byMode':'By payment mode', 'rc.receipts':'receipts', 'rc.empty':'Nothing paid yet', 'se.delivery':'Actual delivery fee', 'se.other':'Other expenses', 'se.status':'Status', 'se.added':'Added', 'se.none':'No expense', 'se.addNote':'Add a note', 'nav.sellingExpenses':'Selling Expenses', 'ap.mass':'Mass settle', 'ap.massBody':'All {n} entries currently in view will be set to Paid + verified, and the attached files copied onto each of them · you still need to press Save', 'ap.paidAmount':'Paid amount', 'ap.mass':'Mark all as paid', 'ap.massBody':'All {n} row(s) currently shown ({amt} ฿) will be set to Paid and Verified', 'ap.massProofHint':'Any file added here is copied to every row (optional)', 'ox.updatedBy':'Updated by', 'nav.opexHistory':'Edit History', 'nav.finOverview':'Overview', 'nav.pnl':'Profit & Loss', 'nav.cashFlow':'Cash Flow', 'nav.taxReport':'Sales Tax', 'tax.modeVat':'VAT bills', 'tax.modeNoVat':'Non-VAT bills', 'tax.invoices':'Tax invoices', 'tax.billsNoVat':'Bills without VAT', 'tax.base':'Value before VAT', 'tax.output':'Output VAT (7%)', 'tax.grand':'Total incl. VAT', 'tax.byMonth':'Monthly summary (for filing)', 'tax.detail':'Tax invoice detail', 'tax.detailNoVat':'Bills excluded from the report', 'tax.issuer':'Issuer', 'tax.empty':'Nothing in this period', 'tax.hint':'Only bills ticked as VAT are pulled in · on a split bill the shipping sits outside the tax base · output VAT only, input VAT is not deducted', 'tax.hintNoVat':'These bills are NOT counted in the sales tax report — listed here so a missed VAT tick is easy to spot', 'cd.noteTitle':'Remark on documents', 'cd.noteHint':'This is the DEFAULT remark filled into the Remark box of every new bill — each bill can then be edited on its own, and documents print whatever that bill says', 'cd.notePh':'e.g. warranty terms, care instructions, contact channels', 'cd.saved':'Saved', 'cd.previewTitle':'How it will look', 'cd.previewHint':'It appears just above the signature area', 'cd.previewEmpty':'No remark yet', 'rev.remarkHint':'Prints on the document · starts from the Customer Document default, editable per bill', 'rev.noteHint':'Internal note — never printed', 'noAccess':'This role has no access to any tab on this page', 'cd.remark':'Remark', 'fin.allTime':'All time', 'fin.custom':'Custom range', 'fin.thisMonth':'This month', 'fin.netProfit':'Net profit', 'fin.cashIn':'Cash in', 'fin.cashOut':'Cash out', 'fin.cashNet':'Net cash', 'fin.ar':'Receivables', 'fin.ap':'Payables', 'fin.revByPlatform':'Revenue by channel', 'fin.revShort':'revenue', 'fin.costMix':'Where the money goes', 'fin.health':'Financial health', 'fin.healthHint':'Figures that always deserve a look — these ignore the period filter', 'fin.item':'Item', 'fin.count':'Count', 'fin.note':'Note', 'fin.hAr':'Bills not yet collected', 'fin.hArNote':'Chase these on the Invoicing page', 'fin.hAp':'Stock bills not yet paid', 'fin.hApNote':'Managed on the AP page', 'fin.hStock':'Stock value on hand', 'fin.hStockNote':'Cash tied up in goods', 'fin.hLoss':'Bills sold at a loss', 'fin.hLossNote':'Check them in COGS Tracking', 'fin.hVat':'VAT collected from customers', 'fin.hVatNote':'Not your revenue', 'fin.statement':'Profit & loss statement', 'fin.ofRevenue':'% of revenue', 'fin.revenue':'Sales revenue', 'fin.sellingExp':'Selling expenses', 'fin.afterSelling':'Profit after selling costs', 'fin.noOpex':'No operating expenses in this period', 'fin.revTrend':'Revenue, last 6 months', 'fin.netTrend':'Net profit, last 6 months', 'fin.trendHint':'Revenue growing while profit does not usually means costs are eating the margin', 'fin.byMonth':'Month by month', 'fin.month':'Month', 'fin.movement':'Movement', 'fin.party':'Party', 'fin.in':'In', 'fin.out':'Out', 'fin.mCustomer':'From customer', 'fin.mSupplier':'To supplier', 'fin.noMoves':'No money moved in this period', 'fin.inTrend':'Cash in by month', 'fin.outTrend':'Cash out by month', 'fin.cashHint':'Cash differs from profit — a sale you have not been paid for brings in nothing', 'fin.vsProfit':'Cash vs profit', 'ox.payrollOf':'Payroll \u2014 {m}', 'ox.autoRow':'Posted automatically when the payroll month was authorized — not editable here', 'ox.category':'Category', 'ox.details':'Details', 'ox.amount':'Amount', 'ox.receipt':'Receipt', 'ox.add':'+ Add entry', 'ox.addTitle':'Record a new expense', 'ox.addHint':'Fill in and press Enter · rows can be edited in the table and save instantly', 'ox.descPh':'What was it for?', 'ox.count':'Entries', 'ox.total':'Total spent', 'ox.avg':'Average per entry', 'ox.biggest':'Biggest category', 'ox.byCat':'Spending by category', 'ox.short':'spent', 'ox.empty':'Nothing recorded yet', 'ox.errAmount':'Please enter an amount', 'ox.delConfirm':'Delete this entry?', 'ap.status':'AP Status', 'ap.unpaid':'Unpaid', 'ap.partial':'Partially Paid', 'ap.paid':'Paid', 'ap.proof':'Payment proof', 'ap.amount':'Amount', 'ap.entries':'Stock-in entries', 'ap.total':'Total value', 'ap.owed':'Still owed', 'ap.settled':'Settled', 'ap.empty':'No stock-in yet', 'ap.clickHint':'Click to change', 'ap.unsaved':'Unsaved changes', 'ap.confirmTitle':'Save changes', 'ap.confirmBody':'Save {n} change(s)?', 'confirm':'Confirm', 'nav.apList':'AP', 'nav.opExpense':'Operational Expense', 'nav.cogsTracking':'COGS Tracking', 'sv.skus':'Products', 'sv.units':'Units on hand', 'sv.atCost':'Value at cost', 'sv.atRetail':'Value at price', 'sv.potential':'Potential profit', 'sv.margin':'Margin', 'sv.byCat':'Value by category', 'sv.byOrigin':'Value by origin', 'sv.top':'Biggest holdings', 'sv.topHint':'Where most of the money is tied up (top 5)', 'sv.onHand':'On hand', 'sv.avgCost':'Cost/unit', 'sv.empty':'Nothing in stock', 'nav.stockValue':'Stock Valuation', 'cogs.pfee':'Platform fee', 'cogs.dfee':'Delivery fee', 'cogs.commission':'Commission', 'cogs.netProfit':'Profit after fees', 'comm.payout':'Payout model', 'comm.pool':'Split evenly', 'comm.person':'Per salesperson', 'comm.payoutHint':'Applies to employees with the Salesperson role type', 'comm.sellerCount':'Salespeople right now', 'comm.base':'Calculation base', 'comm.baseGoods':'Goods only', 'comm.baseGoodsShip':'Goods + shipping', 'comm.rates':'Rate per product category', 'comm.profitBase':'Calculated on PROFIT (revenue − cost − discounts − platform fee), not turnover · loss-making lines pay nothing', 'comm.ratesHint':'Defaults to 5% for every category', 'comm.noCats':'No product categories yet', 'cogs.top':'Top 10 products by profit', 'cogs.topHint':'Gross profit per product (bill-level platform/delivery/commission fees are excluded — they belong to the bill, not a product)', 'cogs.sold':'Sold (units)', 'cogs.perBill':'Per bill', 'cogs.bills':'Bills', 'cogs.revenue':'Revenue (excl. VAT)', 'cogs.total':'Total COGS', 'cogs.profit':'Gross profit', 'cogs.margin':'Margin', 'cogs.byCat':'Cost by product category', 'cogs.byOrigin':'Cost by origin', 'cogs.byStatus':'Cost: paid vs unpaid', 'cogs.paid':'Paid', 'cogs.unpaid':'Unpaid', 'cogs.short':'cost', 'cogs.barHint':'Cost sitting in unpaid bills = money already spent but not yet recovered', 'cogs.missing':'{n} line(s) have no cost lot selected — the cost shown may be understated', 'inv.byStatus':'By invoice status', 'inv.bills':'bills', 'inv.billed':'Total billed', 'inv.received':'Received so far', 'inv.unpaid':'Unpaid bills', 'inv.empty':'Nothing outstanding', 'nav.orderHistory':'Edit History', 'eh.record':'Record', 'eh.changes':'Changes', 'eh.lastAction':'Latest', 'eh.lastEdited':'Last edited', 'eh.when':'When', 'eh.by':'By', 'eh.action':'Action', 'eh.viewRaw':'View raw', 'eh.back':'Back', 'eh.empty':'No history yet', 'eh.rawTitle':'Snapshot (raw)', 'eh.create':'Created', 'eh.edit':'Edited', 'eh.delete':'Deleted', 'eh.imgChanges':'Image changes', 'eh.imgAdded':'Added', 'eh.imgRemoved':'Removed', 'eh.imgNoName':'(file name unknown)', 'eh.old':'Old', 'eh.new':'New', 'eh.viewDetail':'View detail', 'eh.items':'Items', 'eh.note':'Note', 'del.empty':'No deliveries yet', 'set.deliveryStatuses':'Delivery Statuses', 'set.shippingTypes':'Shipping Type', 'set.outsources':'Outsource providers', 'set.regionMode':'Region Grouping', 'nav.grouping':'Grouping', 'nav.shippingCost':'Shipping Cost', 'nav.deliveryList':'Delivery List', 'nav.deliveryBoard':'Delivery Status', 'nav.deliveryCalendar':'Calendar', 'nav.profile':'Organization', 'nav.profileGeneral':'General Stores', 'bp.titleGeneral':'General Stores (for documents)', 'bp.descGeneral':'Header for documents on bills WITHOUT the VAT tick — no tax ID.', 'bp.descOrg':'Header for documents on bills WITH the VAT tick (tax invoice).', 'cal.driverType':'Driver Type', 'cal.driver':'Driver', 'cal.allTypes':'All types', 'cal.allDrivers':'All drivers', 'cal.today':'Today', 'cal.unscheduled':'{n} unscheduled', 'cal.pickTitle':'Pick a delivery for this day', 'cal.pickNone':'No deliveries to pick yet', 'cal.pickAllAssigned':'Every delivery already has a date', 'cal.colorBy':'Color by', 'cal.byStatus':'Status', 'cal.byType':'Driver Type', 'cal.byDriver':'Driver', 'nav.deliveryDrivers':'Drivers', 'drv.title':'Driver colours', 'drv.desc':'Set a colour per driver — used in the calendar when colouring by driver', 'drv.our':'Our Driver', 'drv.outsource':'Outsource', 'drv.empty':'No drivers yet (add Delivery Driver employees or Outsources first)', 'set.shipCost':'Shipping Cost', 'set.shipCategory':'Product category', 'set.shipCostDesc':'Set shipping prices — by region (4/6) or per province', 'set.shipMode':'Pricing mode', 'set.shipByProvince':'Per province', 'set.shipProvSwitch':'Per-province method', 'set.shipException':'Region base + exceptions', 'set.shipManual':'Every province manually', 'set.shipPickRegion':'Pick a region (to set its provinces)', 'set.shipRegionBase':'Region base price', 'set.baht':'THB', 'set.region4':'4 regions', 'set.region6':'6 regions', 'set.regionModeHint':'How provinces group into regions — affects the Region column/filter in Delivery and the map colours (derived from province code, no duplicate data).',
      'rev.orderStatus': 'Order Status', 'rev.invoiceStatus': 'Invoice Status', 'rev.totalRows': 'Total',
      'rev.empty': 'No orders yet — add your first order', 'rev.delConfirm': 'Delete this order?',
      'rev.addItem': '+ Add item', 'rev.itemName': 'Product name', 'rev.itemProduct': 'Product', 'rev.itemQty': 'Qty', 'rev.itemDisc': 'Disc', 'rev.itemNet': 'Net', 'rev.itemPrice': 'Price', 'rev.itemsTotal': 'Items total',
      'rev.errCustomer': 'Please enter recipient name', 'rev.errAddress': 'Please enter recipient address', 'rev.errItems': 'Please add at least one item', 'rev.errPickProduct': 'Please pick products from the list only', 'rev.pickProduct': '— Select product —', 'rev.noProducts': 'No products yet — please add products first in the Products page',
      'prod.pinTitle': 'This page needs a PIN', 'prod.pinDesc': 'Enter your 6-digit PIN to manage products', 'prod.pinWrong': 'Wrong PIN, please try again', 'prod.pinClear': 'Clear',
      'prod.restock': '+ Restock', 'prod.add': '+ Add product',
      'rst.title': 'Restock product', 'rst.ptype': 'Category', 'rst.allTypes': 'All categories', 'rst.noneInType': 'No products in this category', 'rst.product': 'Product', 'rst.qty': 'Quantity added', 'rst.date': 'Date', 'rst.signature': 'Added by (Signature)', 'rst.signatureHint': 'Type your name', 'rst.origin':'Cost Origin', 'rst.cost':'Cost/unit', 'alloc.title':'Cost used (pick from lots)', 'alloc.add':'+ Add cost source', 'alloc.pickOrigin':'— Origin —', 'alloc.pickLot':'— Pick price —', 'alloc.qty':'Qty', 'alloc.left':'left', 'alloc.errSum':'{p}: allocated cost qty ({a}) does not match sold qty ({q})', 'alloc.errOver':'Exceeds lot remaining ({o} ฿{c})', 'rst.confirm': 'Confirm restock',
      'rst.errQty': 'Quantity must be greater than 0', 'rst.errSign': 'Please enter your name',
      'sh.product': 'Product', 'sh.action': 'Action', 'sh.ptype': 'Category', 'sh.type': 'Type', 'sh.typeRestock': 'Restock', 'sh.typeNew': 'New Product', 'sh.qty': 'Qty', 'sh.any': 'Any', 'sh.gt': 'Greater than', 'sh.lt': 'Less than', 'sh.eq': 'Equals', 'sh.qtyVal': 'Qty',
      'sh.origin':'Origin', 'sh.cost':'Cost', 'sh.bill':'Bill', 'sh.verified':'Verified', 'sh.verYes':'Verified', 'sh.verNo':'Unverified', 'sh.signature': 'Added by', 'sh.signHint': 'Search name', 'sh.qtyAdded': 'Qty added', 'sh.totalRows': 'Total', 'sh.empty': 'No restock history yet',
      'io.exportTitle': 'Export Simple Store data', 'io.exportDesc': 'Download everything (expenses/orders/products/settings/stock history) as a JSON file — one file restores it all',
      'io.json': 'Download JSON (full backup)', 'io.importTitle': 'Import Simple Store data', 'io.importDesc': 'Upload a JSON backup — this REPLACES all Simple Store data (not a merge)',
      'io.chooseFile': 'Choose file', 'io.noFile': 'No file chosen', 'io.importBtn': 'Import',
      'io.replaceWarn': 'Import will REPLACE all Simple Store data (currently {n} records) — continue?',
      'io.importDone': 'Import successful', 'io.importFail': 'Import failed — invalid file',
      'io.csvExportLabel': 'Or export a single table as CSV (opens in Excel):', 'io.csvExp': 'Expenses CSV', 'io.csvOrd': 'Orders CSV', 'io.csvProd': 'Products CSV',
      'io.importNote': '⚠️ CSV import works for Expenses and Products only (new id=create · existing id=update · action=delete to remove) — Orders can only be imported via JSON (items bind to product IDs)',
      'io.csvDone': 'Imported {t} — created {c} · updated {u} · deleted {d}', 'io.tbl_expenses': 'Expenses', 'io.tbl_products': 'Products', 'prod.addTitle': 'Add product', 'prod.editTitle': 'Edit product',
      'img.max5':'Up to 5 images', 'pc.pickColor':'\u2014 pick a colour \u2014', 'rev.pickColorFirst':'Pick a colour first to choose its cost lots', 'rev.errPickColor':'Please pick a colour for {p}', 'pc.noColor':'No colour', 'pc.colorLabel':'Colour', 'prod.desc':'Product description', 'prod.descPh':'Details, material, size, care instructions, etc.', 'pc.section':'Colour options', 'pc.enable':'This product comes in colours', 'pc.add':'+ Add colour', 'pc.namePh':'Colour name', 'pc.image':'Image for this colour', 'pc.rmImage':'Remove image', 'prod.tagAuto':'Set automatically from the remaining stock', 'prod.image': 'Image', 'sec.detail':'Product Detail', 'sec.cost':'Cost', 'sec.selling':'Selling', 'sec.evidence':'Evidence', 'sec.product':'Product', 'sec.order':'Order', 'sec.customer':'Customer', 'prod.bill':'Purchase bill', 'bill.tooBig':'File exceeds 256KB', 'prod.sku': 'SKU', 'prod.name': 'Product name', 'prod.cost': 'Cost', 'prod.price': 'Price',
      'prod.sale': 'Sale',
      'promo.btn': 'Promotion', 'promo.navLabel': 'Promotion',
      'promo.title': 'Manage Promotions', 'promo.desc': 'Schedule discounts by category/product · items go on sale automatically during the window and stop when it ends (checked on app open)',
      'promo.new': '+ New Promotion', 'promo.empty': 'No promotions yet', 'promo.close': 'Close',
      'promo.untitled': '(untitled)', 'promo.itemsUnit': 'items', 'promo.selected': 'selected',
      'promo.status.active': 'On Sale', 'promo.status.scheduled': 'Scheduled', 'promo.status.ended': 'Ended',
      'promo.addTitle': 'New Promotion', 'promo.editTitle': 'Edit Promotion',
      'promo.name': 'Promotion name', 'promo.namePh': 'e.g. 11.11 Sale, Summer Deal',
      'promo.effDate': 'Effective date', 'promo.endDate': 'End date',
      'promo.pickProducts': 'Pick products to discount', 'promo.category': 'Category', 'promo.noCat': '— No category —',
      'promo.addItem': 'Add this', 'promo.pickProduct': '— Select product —', 'promo.noneLeft': 'No products left in this category', 'promo.emptyPicked': 'No products selected yet',
      'promo.noProdInCat': 'No products in this category', 'promo.delConfirm': 'Delete this promotion?',
      'promo.errDates': 'Please set both start and end dates', 'promo.errRange': 'End date cannot be before start date', 'promo.errItems': 'Please pick at least one product',
      'promo.endedTitle': 'Promotion ended', 'promo.endedOn': 'ended',
      'prod.stock': 'Stock', 'prod.origin':'Cost Origin (opening)', 'prod.noLots':'No lots yet', 'prod.unit':'pcs', 'prod.reserved': 'Reserved', 'prod.sold': 'Sold', 'prod.ptype': 'Category', 'prod.pickType': '— Select category —', 'prod.errType': 'Please select a category', 'prod.tag': 'Status', 'prod.empty': 'No products yet — add your first one',
      'prod.delConfirm': 'Delete this product? (past orders keep their name/price)', 'prod.errSku': 'Please enter a SKU', 'prod.errName': 'Please enter a product name', 'exp.errDetails': 'Please enter item details', 'exp.errDate': 'Please pick a date', 'exp.errAmount': 'Quantity must be greater than 0',
      'nav.expense': 'Expenses', 'nav.summary': 'Cost Summary', 'nav.revenue': 'Revenue / Billing',
      'nav.orderStatus': 'Order Status', 'nav.invoiceStatus': 'Invoice Status',
      'nav.products': 'Products', 'nav.stockHistory': 'Stock History', 'nav.setting': 'Settings', 'nav.stockConfig':'Stock', 'nav.sellConfig':'Sell', 'nav.acctConfig':'Settings',
      'set.title': 'Settings', 'set.desc': 'Manage the labels and colours of your tags and statuses — add, rename, recolour or delete.',
      'set.expenseTags': 'Expense Tags', 'set.revenueTags': 'Revenue / Billing Tags',
      'set.orderStatuses': 'Order Statuses', 'set.invoiceStatuses': 'Invoice Statuses',
      'set.add': '+ Add', 'set.nameTh':'Name (TH)', 'set.nameEn':'Name (EN)', 'set.none': 'No items yet', 'set.newItem': 'New item',
      'set.delConfirm': 'Delete this item?', 'set.lockedHint': 'This status drives stock — rename/recolour allowed, but cannot be deleted',
      'set.broughtFrom': 'Brought From', 'set.productTypes': 'Categories', 'set.costOrigins': 'Cost Origin', 'set.prefixTitle': 'ID Prefixes', 'set.prefixDesc': 'Set the leading code (max 4 chars) for expenses and orders',
      'set.prefixExpense': 'Expense ID prefix', 'set.prefixOrder': 'Order invoice prefix',
      'kb.empty': 'No orders', 'kb.completeHint': 'Drop an order here → moves to Completed page automatically', 'kb.paidHint': 'Drop an order here → mark as paid (counts as Sold)',
      'bp.title': 'Business Profile (for documents)', 'bp.desc': 'Used as the header on every financial document (receipt voucher, etc.)',
      'bp.name': 'Store / business name (TH)', 'bp.nameEn': 'Store / business name (EN)', 'bp.address': 'Address (TH)', 'bp.addressEn': 'Address (EN)', 'bp.phone': 'Contact phone', 'bp.taxId': 'Tax ID (if any)',
      'bp.logo': 'Logo', 'bp.signature': 'Signature', 'bp.stamp': 'Stamp', 'bp.vatDefault': 'Default: calculate VAT 7%', 'bp.remove': 'Remove image',
      'doc.rv.title': 'Receipt Voucher', 'doc.optsDesc': 'Pick options, then print / save as PDF.',
      'doc.bn.title': 'Billing Note', 'doc.rc.title': 'Receipt', 'doc.makeTitle': 'Generate document',
      'doc.billTo': 'Bill to', 'doc.biller': 'Seller signature', 'doc.billReceiver': 'Received by signature',
      'doc.st.received': 'Received in full and in order.', 'doc.st.pleasePay': 'Please pay the grand total above.',
      'doc.noProfile': '⚠ No business profile set in Settings — the document will have no header.', 'doc.reference':'Reference', 'doc.createdBy':'Created by', 'doc.custTaxId':'Tax ID', 'doc.custPhone':'Tel.', 'doc.col.code':'Code', 'doc.taxCustomer':'Buyer details (for the tax invoice)', 'doc.taxCustomerHint':'These replace the recipient block on the document · they are remembered for next time', 'doc.custCompany':'Customer company name', 'doc.custAddress':'Customer company address', 'doc.dp.title':'Deposit Receipt', 'doc.dp.disabled':'Available only while a balance is outstanding', 'doc.dp.paid':'Deposit received', 'doc.dp.balance':'Balance due', 'doc.st.deposit':'Deposit received with thanks', 'doc.tx.title':'Tax Invoice', 'doc.vatCalc':'This bill is charged VAT 7%', 'doc.splitHint':'This layout belongs to the bill — with a separate shipping document, shipping is outside the VAT base and NET updates immediately', 'doc.splitShort':'split', 'doc.payFromOrder':'Payment method (from the bill)', 'eh.billDetails':'Bill details', 'doc.splitMode':'Document layout', 'doc.splitTogether':'Goods + shipping together', 'doc.splitApart':'Separate documents', 'doc.makeGoods':'Goods document', 'doc.makeShip':'Shipping document', 'doc.goodsOnly':'goods only', 'doc.shipOnly':'shipping only', 'doc.taxId':'Tax ID', 'bp.branch':'Branch', 'bp.branchDefault':'Head Office', 'pay.vatNo':'No VAT', 'doc.vat': 'Calculate VAT 7% (VAT-inclusive)',
      'doc.payMethod': 'Payment method', 'doc.pay.cash': 'Cash', 'doc.pay.transfer': 'Bank transfer', 'doc.pay.other': 'Other',
      'doc.make': 'Generate', 'doc.popupBlocked': 'Popup blocked — please allow popups and try again.', 'doc.print': 'Print / Save PDF',
      'doc.yourStore': '(Your store name)', 'doc.no': 'No.', 'doc.date': 'Date', 'doc.receivedFrom': 'Received from', 'doc.ref': 'Ref.',
      'doc.col.no': 'No.', 'doc.col.item': 'Description', 'doc.col.qty': 'Qty', 'doc.col.unit': 'Unit price', 'doc.col.amount': 'Amount',
      'doc.subtotal': 'Subtotal', 'doc.discount': 'Discount', 'doc.shipping':'Shipping', 'doc.itemDiscount':'Item Discount', 'doc.shipDiscount':'Shipping Discount', 'doc.overallDiscount':'Overall Discount', 'doc.totalDiscount':'Total Discount', 'doc.showDiscounts':'Show discounts', 'doc.discItem':'Item', 'doc.discShip':'Shipping', 'doc.discOverall':'Overall', 'doc.language':'Document language', 'doc.langTh':'Thai', 'doc.langEn':'English', 'doc.beforeVat': 'Before VAT', 'doc.vat7': 'VAT 7%', 'doc.grand': 'Grand total',
      'doc.amountWords': 'Amount in words', 'doc.payer': 'Payer signature', 'doc.payee': 'Seller signature', 'doc.footNote': 'Issued from Simple Store',
      'nav.account': 'Monthly Report', 'nav.deleted':'Deleted List', 'bin.desc':'Deleted records are excluded from every total until they are restored', 'bin.products':'Deleted products', 'bin.orders':'Deleted bills', 'bin.restore':'Restore', 'bin.confirm':'Restore this record back into the books?', 'bin.qty':'Qty held', 'bin.lotValue':'Cost value', 'bin.expenses':'Expenses held', 'bin.deletedBy':'Deleted by', 'bin.empty':'Nothing here', 'acct.cogs':'COGS', 'acct.profit':'Profit', 'nav.vat':'VAT Calculation', 'vat.base':'Before VAT', 'vat.amount':'VAT 7%', 'vat.totalNet':'Total', 'vat.totalBase':'Total before VAT', 'vat.totalVat':'Total VAT', 'nav.ledger': 'Ledger', 'acct.summary': 'Summary', 'acct.table': 'Table', 'acct.monthlyTitle': 'Monthly income & expense',
      'acct.year': 'Year', 'acct.month': 'Month', 'acct.income': 'Income', 'acct.expense': 'Expense', 'acct.net': 'Net', 'acct.yearNet': 'Year net',
      'acct.vatMode': 'VAT calculation', 'acct.vatAll': 'VAT on all', 'acct.vatTicked': 'Only ticked items', 'acct.vatNone': 'No VAT',
      'acct.outVat': 'Output VAT (income)', 'acct.inVat': 'Input VAT (expense)', 'acct.vatNet': 'Net VAT (out−in)', 'acct.byMonth': 'By month (full year)',
      'acct.date': 'Date', 'acct.type': 'Type', 'acct.item': 'Item', 'acct.amount': 'Amount', 'acct.vatable': 'VAT',
      'acct.tableNote': 'Tick items to include in VAT (used by the "Only ticked items" mode)', 'acct.noItems': 'No items yet'
    }
  });
})();
