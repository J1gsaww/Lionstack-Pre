/* ============================================================
   EMPLOYEE MANAGEMENT MODULE  (self-registers as `employeeMgmt`)

   A back-office people/access console. Runs LOCAL for now:
     • Employees — create an id (username) + password for each staff
       member. Password is salted-SHA-256 hashed via Web Crypto and
       stored locally (mod_emp_*). This is a PLACEHOLDER — real hashing
       + real enforcement belong server-side (Firebase Rules) later.
     • Roles & Access — create roles and tick which menus each role
       may open. (Enforcement — hiding menus / gating boot — is a
       SEPARATE later lot; this lot only manages the data.)
     • Dev Login — MOCK for now: grants the Developer role (full
       access) in-session. Wired to the real login screen + Firebase
       Auth in the next lot.

   ⚠️ Client-side id/pass + access = UI-gating, NOT a security boundary.
   ============================================================ */
(function(){
  const ID = 'employeeMgmt';
  const esc = window.escapeHtml || ((s)=> String(s==null?'':s));
  const T = (k)=> window.moduleI18n(ID)(k);

  const K_EMP    = 'mod_emp_employees';   // [{ id, username, name, salt, passwordHash, roleKey, active }]
  const K_ROLES  = 'mod_emp_roles';       // [{ key, name, system }]
  const K_ACCESS = 'mod_emp_access';      // { roleKey: [targetId, ...] }

  // Menus that a role can be granted access to. (Kept in sync with the
  // sidebar modules by hand for now; the enforcement lot can derive this
  // from the live module list.)
  // Menu access, laid out in the same sections as the sidebar. A page that owns
  // subpages is granted PER SUBPAGE (target id "module:subpage"); the page itself
  // disappears from the sidebar when none of its subpages are granted.
  const ACCESS_SECTIONS = [
    { key:'inventory', label:{ th:'สินค้า & การขาย', en:'Inventory & Sales' }, items:[
      { id:'stock', label:{ th:'จัดการสต๊อก', en:'Stock Management' }, subs:[
        { id:'products',       label:{ th:'สินค้า', en:'Products' } },
        { id:'stockHistory',   label:{ th:'ประวัติสต๊อก', en:'Stock History' } },
        { id:'productHistory', label:{ th:'ประวัติแก้ไข', en:'Edit History' } }
      ]},
      { id:'sell', label:{ th:'การขาย', en:'Sell Management' }, subs:[
        { id:'revenue',       label:{ th:'รายรับ / ออกบิล', en:'Revenue / Billing' } },
        { id:'orderStatus',   label:{ th:'สถานะออเดอร์', en:'Order Status' } },
        { id:'invoiceStatus', label:{ th:'สถานะบิล', en:'Invoice Status' } },
        { id:'orderHistory',  label:{ th:'ประวัติแก้ไข', en:'Edit History' } }
      ]},
      { id:'delivery', label:{ th:'การจัดส่ง', en:'Delivery' }, subs:[
        { id:'deliveryList',   label:{ th:'รายการจัดส่ง', en:'List' } },
        { id:'deliveryStatus', label:{ th:'สถานะ', en:'Status' } },
        { id:'deliveryCal',    label:{ th:'ปฏิทิน', en:'Calendar' } },
        { id:'deliveryDrivers',label:{ th:'คนขับ', en:'Drivers' } }
      ]}
    ]},
    { key:'accounting', label:{ th:'บัญชี', en:'Accounting' }, items:[
      { id:'revenueAcct', label:{ th:'รายได้ & บัญชี', en:'Revenue & Accounting' }, subs:[
        { id:'invoicing', label:{ th:'ใบแจ้งหนี้', en:'Invoicing' } },
        { id:'receipts',  label:{ th:'ใบเสร็จ', en:'Receipts' } }
      ]},
      { id:'cogsInventory', label:{ th:'ต้นทุนขาย & มูลค่าสต๊อก', en:'COGS & Inventory' }, subs:[
        { id:'cogsTracking', label:{ th:'ติดตามต้นทุนขาย', en:'COGS Tracking' } },
        { id:'stockValue',   label:{ th:'มูลค่าสต๊อก', en:'Stock Valuation' } }
      ]},
      { id:'expenseAp', label:{ th:'รายจ่าย & เจ้าหนี้', en:'Expense & Payable' }, subs:[
        { id:'sellingExpenses', label:{ th:'ค่าใช้จ่ายในการขาย', en:'Selling Expenses' } },
        { id:'apList',          label:{ th:'เจ้าหนี้ (AP)', en:'AP' } },
        { id:'opExpense',       label:{ th:'ค่าใช้จ่ายดำเนินงาน', en:'Operational Expense' } },
        { id:'opexHistory',     label:{ th:'ประวัติแก้ไข', en:'Edit History' } }
      ]},
      { id:'financialReport', label:{ th:'รายงานการเงิน', en:'Financial Report' }, subs:[
        { id:'finOverview', label:{ th:'ภาพรวม', en:'Overview' } },
        { id:'pnl',         label:{ th:'กำไรขาดทุน', en:'Profit & Loss' } },
        { id:'cashFlow',    label:{ th:'กระแสเงินสด', en:'Cash Flow' } },
        { id:'taxReport',   label:{ th:'รายงานภาษีขาย', en:'Sales Tax' } }
      ]}
    ]},
    { key:'hr', label:{ th:'จัดการพนักงาน', en:'Employee Management' }, items:[
      { id:'payroll', label:{ th:'เงินเดือน', en:'Payroll' }, subs:[
        { id:'empPayroll',     label:{ th:'เงินเดือนพนักงาน', en:'Employee Payroll' } },
        { id:'compensation',   label:{ th:'ค่าเงิน', en:'Compensation' } },
        { id:'authorizePayroll', label:{ th:'อนุมัติปิดงวดเงินเดือน', en:'Authorize Payroll' } }
      ]},
      { id:'empCalendar', label:{ th:'ปฏิทินพนักงาน', en:'Employee Calendar' } }
    ]},
    { key:'org', label:{ th:'องค์กร', en:'Organization' }, items:[
      { id:'businessProfile', label:{ th:'ข้อมูลธุรกิจ', en:'Business Profile' }, subs:[
        { id:'profileGeneral', label:{ th:'ร้านค้าทั่วไป', en:'General Stores' } },
        { id:'profile',        label:{ th:'องค์กร', en:'Organization' } }
      ]},
      { id:'employeeMgmt',    label:{ th:'พนักงาน', en:'Employees' } }
    ]},
    { key:'setting', label:{ th:'ตั้งค่า', en:'Setting' }, items:[
      { id:'importExport', label:{ th:'นำเข้า/ส่งออก', en:'Import / Export' }, subs:[
        { id:'ieOverall',   label:{ th:'ทั้งหมด', en:'Overall' } },
        { id:'ieStock',     label:{ th:'จัดการสต๊อก', en:'Stock' } },
        { id:'ieSell',      label:{ th:'การขาย', en:'Sell' } },
        { id:'ieDelivery',  label:{ th:'การจัดส่ง', en:'Delivery' } },
        { id:'ieRevenue',   label:{ th:'รายได้ & บัญชี', en:'Revenue & Accounting' } },
        { id:'ieCogs',      label:{ th:'ต้นทุนขาย', en:'COGS' } },
        { id:'ieExpense',   label:{ th:'รายจ่าย & เจ้าหนี้', en:'Expense & Payable' } },
        { id:'ieFinancial', label:{ th:'รายงานการเงิน', en:'Financial Report' } },
        { id:'iePayroll',   label:{ th:'เงินเดือน', en:'Payroll' } },
        { id:'ieCalendar',  label:{ th:'ปฏิทินพนักงาน', en:'Employee Calendar' } },
        { id:'ieEmployees', label:{ th:'พนักงาน & สิทธิ์', en:'Employees & Access' } },
        { id:'ieSetting',   label:{ th:'ตั้งค่าทั้งหมด', en:'All Settings' } }
      ]},
      { id:'setting',           label:{ th:'ตั้งค่าระบบ', en:'Admin App Setting' } },
      { id:'rolesAccess',       label:{ th:'บทบาท & สิทธิ์', en:'Roles & Access' } },
      { id:'sellStockSetting',  label:{ th:'ตั้งค่า Sell/Stock', en:'Sell/Stock Setting' } },
      { id:'customerDoc',       label:{ th:'เอกสารลูกค้า', en:'Customer Document' } },
      { id:'accountingSetting', label:{ th:'ตั้งค่าบัญชี', en:'Accounting Setting' } },
      { id:'deliverySetting',   label:{ th:'ตั้งค่าการจัดส่ง', en:'Delivery Setting' } },
      { id:'commissionSetting', label:{ th:'ตั้งค่าคอมมิชชั่น', en:'Commission Setting' } }
    ]}
  ];
  // Every grantable menu id, including the "module:subpage" ones.
  function allAccessIds(){
    const out = [];
    ACCESS_SECTIONS.forEach(sec=> sec.items.forEach(it=>{
      out.push(it.id);
      (it.subs || []).forEach(sp=> out.push(it.id + ':' + sp.id));
    }));
    return out;
  }
  // Action permissions (not menus) — grantable per role in Roles & Access.
  const ACCESS_PERMISSIONS = [
    { id:'verifyStock',         label:{ th:'ยืนยันประวัติสต๊อก', en:'Verify Stock History' } },
    { id:'verifyDelivery',      label:{ th:'ยืนยันการจัดส่ง', en:'Verify Delivery' } },
    { id:'setDeliveryDate',     label:{ th:'กำหนดวันจัดส่ง', en:'Set Delivery Date' } },
    { id:'editDeliveryAssign', label:{ th:'แก้วิธีจัดส่ง/ผู้รับผิดชอบ', en:'Edit Shipping Type & Responsible' } },
    { id:'verifyLedger',        label:{ th:'ยืนยันรายการในสมุดบัญชี', en:'Verify Ledger Entry' } },
    { id:'restoreDeleted',      label:{ th:'กู้คืนรายการที่ถูกลบ', en:'Restore Deleted Records' } },
    { id:'changeOrderStatus',   label:{ th:'เปลี่ยนสถานะออเดอร์',   en:'Change Order Status' } },
    { id:'changeInvoiceStatus', label:{ th:'เปลี่ยนสถานะบิล', en:'Change Invoice Status' } },
    { id:'changeRevenueTag',    label:{ th:'เปลี่ยนป้ายกำกับบิล',    en:'Change Billing Tag' } },
    { id:'changeExpenseTag',    label:{ th:'เปลี่ยนป้ายกำกับรายจ่าย',    en:'Change Expense Tag' } },
    { id:'changeProductStatus', label:{ th:'เปลี่ยนสถานะสินค้า', en:'Change Product Status' } },
  ];
  // Hardcoded Role Types (NOT app-configurable). 'admin' is reserved for the system Admin+Developer roles
  // and cannot be picked when creating a new role.
  const ROLE_TYPES = [
    { key:'admin',       label:'Admin' },
    { key:'hr',          label:'HR' },
    { key:'salesperson', label:'Salesperson' },
    { key:'driver',      label:'Delivery Driver' },
    { key:'technician',  label:'Technician' },
    { key:'employee',    label:'Employee' },
  ];
  const roleTypeLabel = (k)=> (ROLE_TYPES.find(rt=> rt.key===k) || {}).label || '';
  const targetLabel = (t)=> (t.label[(window.appLang && window.appLang()) || 'th'] || t.label.en);

  /* ---- state ---- */
  let employees = [], roles = [], access = {};
  let subPage = 'employees';
  let editingId = null;
  let form = { name:'', surname:'', employeeId:'', username:'', password:'', confirmPassword:'', roleKey:'', active:true, baseSalary:'' };

  const rid = ()=> 'emp_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);

  /* ---- password hashing (salted SHA-256 via Web Crypto — LOCAL placeholder) ---- */
  function makeSalt(){
    const a = new Uint8Array(16); crypto.getRandomValues(a);
    return [...a].map(b=> b.toString(16).padStart(2,'0')).join('');
  }
  async function hashPassword(password, salt){
    const data = new TextEncoder().encode(salt + ':' + password);
    const buf = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(buf)].map(b=> b.toString(16).padStart(2,'0')).join('');
  }
  // Exposed for the future login lot to verify a typed password.
  window.empVerifyPassword = async function(username, password){
    let list = employees;
    try{ list = await window.Store.list(K_EMP); }catch(e){}
    const emp = list.find(e=> e.username === username && e.active);
    if(!emp || !emp.passwordHash) return null;
    const h = await hashPassword(password, emp.salt);
    return h === emp.passwordHash ? { username: emp.username, name: emp.name, surname: emp.surname, roleKey: emp.roleKey } : null;
  };

  // Role-gating for the sidebar. System roles (Admin/Developer) = all access.
  window.roleCanAccess = function(roleKey, targetId){
    if(!roleKey) return true;
    const role = roles.find(r=> r.key === roleKey);
    if(role && role.system) return true;
    return (access[roleKey] || []).includes(targetId);
  };

  /* ---- data load + seed the special Developer role ---- */
  async function loadAll(){
    employees = await window.Store.list(K_EMP);
    roles     = await window.Store.list(K_ROLES);
    access    = (await window.Store.get(K_ACCESS)) || {};
    let _rchg = false;
    const _dev = roles.find(r=> r.key === 'developer');
    if(!_dev){ roles.push({ key:'developer', name:'Developer', system:true, hidden:true, roleType:'admin' }); _rchg = true; }
    else if(!_dev.hidden){ _dev.hidden = true; _dev.system = true; _rchg = true; }   // upgrade lot-1 data
    if(!roles.some(r=> r.key === 'admin')){ roles.unshift({ key:'admin', name:'Admin', system:true, roleType:'admin' }); _rchg = true; }
    roles.forEach(r=>{ if(r.system && !r.roleType){ r.roleType = 'admin'; _rchg = true; } });
    if(_rchg) await window.Store.set(K_ROLES, roles);
    if(!form.roleKey) form.roleKey = 'admin';
  }
  const saveEmployees = ()=> window.Store.set(K_EMP, employees);
  const saveRoles     = ()=> window.Store.set(K_ROLES, roles);
  const saveAccess    = ()=> window.Store.set(K_ACCESS, access);
  // Employees whose assigned role has the given roleType (e.g. 'driver') — used by the order form.
  // Payroll reads the roster through these so employees.js stays the only writer.
  window.employeesAll = function(){ return employees.map(e=> ({ ...e })); };
  window.employeeUpdate = async function(id, patch){
    const emp = employees.find(e=> e.id === id);
    if(!emp) return false;
    Object.assign(emp, patch || {});
    await saveEmployees();
    return true;
  };
  // What KIND of role is this (admin / salesperson / driver / ...)? Used by the
  // store to decide whether to show a person's name or just "Admin".
  window.roleTypeOf = function(roleKey){
    const r = (roles || []).find(x=> x.key === roleKey);
    return r ? (r.roleType || '') : '';
  };
  window.employeesByRoleType = function(rt){
    return (employees || []).filter(e=> e.active !== false)
      .filter(e=>{ const role = roles.find(r=> r.key === e.roleKey); return role && role.roleType === rt; })
      .map(e=> ({ id: e.id, name: ((e.name||'')+' '+(e.surname||'')).trim() || e.username || e.employeeId }));
  };
  const roleName = (key)=> (roles.find(r=> r.key === key) || {}).name || key || '—';

  /* ---- mock session (real login is a later lot) ---- */
  function currentRoleLabel(){
    const rk = window.currentRole;
    if(!rk) return T('emp.notLoggedIn');
    return roleName(rk);
  }

  /* ============================================================
     EMPLOYEES sub-page
     ============================================================ */
  function renderEmployees(body){
    const rerender = ()=> renderEmployees(body);
    const roleOpts = roles.filter(r=> !r.hidden).map(r=>
      `<option value="${esc(r.key)}"${r.key===form.roleKey?' selected':''}>${esc(r.name)}</option>`).join('');
    const rows = employees.map(e=> `
      <tr>
        <td>${esc(e.employeeId || '')}</td>
        <td>${esc(((e.name||'') + ' ' + (e.surname||'')).trim())}</td>
        <td>${esc(e.username)}</td>
        <td>${esc(roleName(e.roleKey))}</td>
        <td>${e.active ? T('emp.on') : T('emp.off')}</td>
        <td><div class="art-row-actions">
          <button class="acc-icon emp-edit" data-id="${esc(e.id)}" title="${esc(T('common.edit'))}">✎</button>
          <button class="acc-icon emp-del" data-id="${esc(e.id)}" title="${esc(T('common.delete'))}">✕</button>
        </div></td>
      </tr>`).join('') || `<tr><td colspan="6" class="art-set-empty">${esc(T('emp.noEmployees'))}</td></tr>`;

    body.innerHTML = `
      <div class="panel settings-panel">
        <div class="settings-section">
          <div class="settings-section-head">
            <h3 class="setting-title">${esc(T('emp.session'))}</h3>
            <p class="setting-desc">${esc(T('emp.sessionDesc'))}</p>
          </div>
          <div class="art-toolbar">
            <div>${esc(T('emp.currentRole'))}: <b id="empRoleNow">${esc(currentRoleLabel())}</b></div>
            <div class="art-spacer"></div>
            <button class="btn btn-ghost" id="empDevLogin">${esc(T('emp.devLogin'))}</button>
          </div>
          <p class="setting-desc" id="empDevMsg" style="margin-top:8px;"></p>
        </div>

        <div class="settings-section">
          <div class="settings-section-head">
            <h3 class="setting-title">${esc(editingId ? T('emp.editTitle') : T('emp.addTitle'))}</h3>
          </div>
          <div class="art-form-grid">
            <label>${esc(T('emp.name'))}<input type="text" id="empName" value="${esc(form.name)}"></label>
            <label>${esc(T('emp.surname'))}<input type="text" id="empSurname" value="${esc(form.surname)}"></label>
            <label>${esc(T('emp.employeeId'))}<input type="text" id="empEmployeeId" value="${esc(form.employeeId)}" autocomplete="off"></label>
            <label>${esc(T('emp.username'))}<input type="text" id="empUsername" value="${esc(form.username)}" autocomplete="off"></label>
            <label>${esc(T('emp.password'))}<input type="password" id="empPassword" autocomplete="new-password" placeholder="${esc(editingId ? T('emp.passwordKeep') : '')}"></label>
            <label>${esc(T('emp.confirmPassword'))}<input type="password" id="empConfirmPassword" autocomplete="new-password"></label>
            <label>${esc(T('emp.baseSalary'))}<input type="number" id="empBaseSalary" step="0.01" min="0" value="${esc(form.baseSalary)}" placeholder="0.00"></label>
            <label class="art-form-full">${esc(T('emp.role'))}<select id="empRole">${roleOpts}</select></label>
          </div>
          <div class="sf-inline-toggle" style="margin-top:12px;">
            <span>${esc(T('emp.active'))}</span>
            <button type="button" class="sf-toggle ${form.active?'on':'off'}" id="empActive"><span class="sf-toggle-knob"></span></button>
          </div>
          <div class="art-toolbar" style="margin-top:14px;">
            <button class="btn btn-primary" id="empSave">${esc(T('common.save'))}</button>
            ${editingId ? `<button class="btn btn-ghost" id="empCancel">${esc(T('common.cancel'))}</button>` : ''}
            <span class="if-note" id="empFormNote"></span>
          </div>
        </div>

        <div class="settings-section">
          <div class="settings-section-head">
            <h3 class="setting-title">${esc(T('emp.listTitle'))}</h3>
          </div>
          <div class="art-table-wrap">
            <table class="art-table">
              <thead><tr>
                <th>${esc(T('emp.employeeId'))}</th><th>${esc(T('emp.name'))}</th><th>${esc(T('emp.username'))}</th>
                <th>${esc(T('emp.role'))}</th><th>${esc(T('emp.active'))}</th><th></th>
              </tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>
      </div>`;

    // Dev Login (mock): grant Developer in-session, no rerender so form stays.
    body.querySelector('#empDevLogin').addEventListener('click', ()=>{
      window.currentRole = 'developer';
      window.currentEmployee = { username:'dev', name:'Developer', roleKey:'developer' };
      const now = body.querySelector('#empRoleNow'); if(now) now.textContent = roleName('developer');
      const msg = body.querySelector('#empDevMsg'); if(msg) msg.textContent = T('emp.devLoginDone');
      if(window.renderSidebar) window.renderSidebar();
    });

    body.querySelector('#empActive').addEventListener('click', (e)=>{
      form.active = !form.active;
      e.currentTarget.classList.toggle('on', form.active);
      e.currentTarget.classList.toggle('off', !form.active);
    });

    body.querySelector('#empSave').addEventListener('click', async ()=>{
      const note = body.querySelector('#empFormNote');
      const fail = (k)=>{ if(note) note.textContent = T(k); };
      const name = body.querySelector('#empName').value.trim();
      const surname = body.querySelector('#empSurname').value.trim();
      const employeeId = body.querySelector('#empEmployeeId').value.trim();
      const username = body.querySelector('#empUsername').value.trim();
      const password = body.querySelector('#empPassword').value;
      const confirmPassword = body.querySelector('#empConfirmPassword').value;
      const roleKey = body.querySelector('#empRole').value;
      if(!name){ return fail('emp.errNoName'); }
      if(!surname){ return fail('emp.errNoSurname'); }
      if(!employeeId){ return fail('emp.errNoEmployeeId'); }
      if(!username){ return fail('emp.errNoUsername'); }
      if(employees.some(e=> e.employeeId === employeeId && e.id !== editingId)){ return fail('emp.errDupEmployeeId'); }
      if(employees.some(e=> e.username === username && e.id !== editingId)){ return fail('emp.errDupUsername'); }
      if(!editingId && !password){ return fail('emp.errNoPassword'); }
      if(password && password !== confirmPassword){ return fail('emp.errPwMismatch'); }

      if(editingId){
        const emp = employees.find(e=> e.id === editingId);
        if(emp){
          emp.baseSalary = parseFloat((body.querySelector('#empBaseSalary')||{}).value) || 0;
          emp.name = name; emp.surname = surname; emp.employeeId = employeeId;
          emp.username = username; emp.roleKey = roleKey; emp.active = form.active;
          if(password){ emp.salt = makeSalt(); emp.passwordHash = await hashPassword(password, emp.salt); }
        }
      }else{
        const salt = makeSalt();
        employees.push({ id: rid(), employeeId, username, name, surname, salt,
          passwordHash: await hashPassword(password, salt), roleKey, active: form.active,
          baseSalary: parseFloat((body.querySelector('#empBaseSalary')||{}).value) || 0 });
      }
      await saveEmployees();
      editingId = null;
      form = { name:'', surname:'', employeeId:'', username:'', password:'', confirmPassword:'', roleKey: form.roleKey, active:true, baseSalary:'' };
      rerender();
    });

    const cancelBtn = body.querySelector('#empCancel');
    if(cancelBtn) cancelBtn.addEventListener('click', ()=>{
      editingId = null;
      form = { name:'', surname:'', employeeId:'', username:'', password:'', confirmPassword:'', roleKey: form.roleKey, active:true, baseSalary:'' };
      rerender();
    });

    body.querySelectorAll('.emp-edit').forEach(btn=> btn.addEventListener('click', ()=>{
      const emp = employees.find(e=> e.id === btn.dataset.id);
      if(!emp) return;
      editingId = emp.id;
      form = { name: emp.name || '', surname: emp.surname || '', employeeId: emp.employeeId || '', username: emp.username, password:'', confirmPassword:'', roleKey: emp.roleKey, active: emp.active !== false, baseSalary: (emp.baseSalary != null ? emp.baseSalary : '') };
      rerender();
    }));

    body.querySelectorAll('.emp-del').forEach(btn=> btn.addEventListener('click', async ()=>{
      if(!window.confirm(T('emp.delConfirm'))) return;
      employees = employees.filter(e=> e.id !== btn.dataset.id);
      await saveEmployees();
      if(editingId === btn.dataset.id){ editingId = null; form = { name:'', surname:'', employeeId:'', username:'', password:'', confirmPassword:'', roleKey: form.roleKey, active:true, baseSalary:'' }; }
      rerender();
    }));
  }

  /* ============================================================
     ROLES & ACCESS sub-page
     ============================================================ */
  function renderRolesAccess(body){
    const rerender = ()=> renderRolesAccess(body);
    const cards = roles.filter(r=> !r.hidden).map(r=>{
      const allowed = r.system ? [...allAccessIds(), ...ACCESS_PERMISSIONS.map(pm=> pm.id)] : (access[r.key] || []);
      const boxes = ACCESS_SECTIONS.map(sec=> `
        <div class="emp-access-sec">
          <div class="emp-access-sec-head">${esc(targetLabel(sec))}</div>
          ${sec.items.map(it=>{
            const subs = it.subs || [];
            const subIds = subs.map(sp=> it.id + ':' + sp.id);
            const allOn = subs.length ? subIds.every(id=> allowed.includes(id)) : allowed.includes(it.id);
            return `
            <div class="emp-access-mod">
              <label class="emp-access-item emp-access-main">
                <input type="checkbox" data-role="${esc(r.key)}" data-target="${esc(it.id)}"
                       data-kids="${esc(subIds.join(','))}" ${allOn?'checked':''} ${r.system?'disabled':''}>
                <span>${esc(targetLabel(it))}</span>
              </label>
              ${subs.length ? `<div class="emp-access-subs">${subs.map(sp=> `
                <label class="emp-access-item">
                  <input type="checkbox" data-role="${esc(r.key)}" data-target="${esc(it.id + ':' + sp.id)}"
                         ${allowed.includes(it.id + ':' + sp.id)?'checked':''} ${r.system?'disabled':''}>
                  <span>${esc(targetLabel(sp))}</span>
                </label>`).join('')}</div>` : ''}
            </div>`;
          }).join('')}
        </div>`).join('');
      const permBoxes = ACCESS_PERMISSIONS.map(pm=> `
        <label class="emp-access-item">
          <input type="checkbox" data-role="${esc(r.key)}" data-target="${esc(pm.id)}"
                 ${allowed.includes(pm.id)?'checked':''} ${r.system?'disabled':''}>
          <span>${esc(targetLabel(pm))}</span>
        </label>`).join('');
      return `
        <div class="settings-section">
          <div class="settings-section-head" style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
            <h4 class="setting-title" style="margin:0;">${esc(r.name)}${r.system?` <span class="setting-desc" style="font-weight:400;">(${esc(T('emp.systemRole'))})</span>`:''}${r.roleType?` <span class="emp-role-type">${esc(roleTypeLabel(r.roleType))}</span>`:''}</h4>
            ${r.system?'':`<button type="button" class="acc-icon emp-role-del" data-role="${esc(r.key)}" title="${esc(T('common.delete'))}">✕</button>`}
          </div>
          <div class="emp-access-grid">${boxes}</div>
          <div class="emp-perm-head">${esc(T('emp.permsTitle'))}</div>
          <div class="emp-access-grid">${permBoxes}</div>
        </div>`;
    }).join('');

    body.innerHTML = `
      <div class="panel settings-panel">
        <div class="settings-section">
          <div class="settings-section-head">
            <h3 class="setting-title">${esc(T('emp.rolesTitle'))}</h3>
            <p class="setting-desc">${esc(T('emp.rolesDesc'))}</p>
          </div>
          <div class="art-toolbar">
            <label class="art-field">${esc(T('emp.newRoleName'))}<input type="text" id="empNewRole"></label>
            <label class="art-field">${esc(T('emp.roleType'))}<select id="empNewType">${ROLE_TYPES.filter(rt=> rt.key!=='admin').map(rt=> `<option value="${esc(rt.key)}">${esc(rt.label)}</option>`).join('')}</select></label>
            <button class="btn btn-primary" id="empAddRole">${esc(T('emp.addRole'))}</button>
            <span class="if-note" id="empRoleNote"></span>
          </div>
        </div>
        ${cards}
      </div>`;

    body.querySelector('#empAddRole').addEventListener('click', async ()=>{
      const note = body.querySelector('#empRoleNote');
      const name = body.querySelector('#empNewRole').value.trim();
      const roleType = (body.querySelector('#empNewType') || {}).value || 'employee';
      if(!name){ if(note) note.textContent = T('emp.errNoRoleName'); return; }
      const key = name.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'') || ('role_'+Date.now());
      if(roles.some(r=> r.key === key)){ if(note) note.textContent = T('emp.errDupRole'); return; }
      roles.push({ key, name, roleType });
      access[key] = access[key] || [];
      await saveRoles(); await saveAccess();
      rerender();
    });

    body.querySelectorAll('.emp-access-main input[data-kids]').forEach(master=> master.addEventListener('change', ()=>{
      const kids = (master.dataset.kids || '').split(',').filter(Boolean);
      if(!kids.length) return;   // a page with no subpages toggles itself
      kids.forEach(id=>{
        const box = body.querySelector(`input[data-role="${master.dataset.role}"][data-target="${id}"]`);
        if(box && box.checked !== master.checked){ box.checked = master.checked; box.dispatchEvent(new Event('change')); }
      });
    }));
    body.querySelectorAll('.emp-access-item input').forEach(cb=> cb.addEventListener('change', async ()=>{
      const rk = cb.dataset.role, tid = cb.dataset.target;
      const set = new Set(access[rk] || []);
      if(cb.checked) set.add(tid); else set.delete(tid);
      access[rk] = [...set];
      await saveAccess();
    }));

    body.querySelectorAll('.emp-role-del').forEach(btn=> btn.addEventListener('click', async ()=>{
      const rk = btn.dataset.role;
      if(employees.some(e=> e.roleKey === rk)){ if(!window.confirm(T('emp.roleInUse'))) return; }
      else if(!window.confirm(T('emp.delRoleConfirm'))) return;
      roles = roles.filter(r=> r.key !== rk);
      delete access[rk];
      await saveRoles(); await saveAccess();
      rerender();
    }));
  }

  /* ============================================================
     module registration
     ============================================================ */
  const SUBPAGES = ['employees'];
  window.registerModule({
    id: ID,
    navLabel: { th:'พนักงาน', en:'Employees' },
    pageId: 'page-employeeMgmt',
    async onInit(){ await loadAll(); },
    async onRemoteChange(){ await loadAll(); },   // live sync: re-read from the updated cache
    mount(container){
      container.innerHTML = `
        <div class="topbar">
          <h1>${esc(T('title'))}</h1>
          <div class="crumb">${esc(T('crumb'))}</div>
        </div>
        <div class="content">
          <div class="acc-subnav store-subnav" id="empSubnav"></div>
          <div id="empBody"></div>
        </div>`;
      container.querySelector('#empSubnav').addEventListener('click', (e)=>{
        const btn = e.target.closest('[data-subpage]');
        if(!btn) return;
        subPage = btn.dataset.subpage;
        this.render();
      });
    },
    render(){
      const nav = document.querySelector('#empSubnav');
      const body = document.querySelector('#empBody');
      if(!nav || !body) return;
      nav.innerHTML = SUBPAGES.map(id=>
        `<button type="button" class="acc-subnav-btn ${id===subPage?'active':''}" data-subpage="${id}">${esc(T('nav.'+id))}</button>`
      ).join('');
      nav.style.display = SUBPAGES.length > 1 ? '' : 'none';
      renderEmployees(body);
    }
  });

  // Roles & Access — its OWN page (lives under the Setting nav category).
  window.registerModule({
    id: 'rolesAccess',
    navLabel: { th:'บทบาท & สิทธิ์', en:'Roles & Access' },
    pageId: 'page-rolesAccess',
    async onInit(){ await loadAll(); },
    async onRemoteChange(){ await loadAll(); },   // live sync: re-read from the updated cache
    mount(container){
      container.innerHTML = `
        <div class="topbar">
          <h1>${esc(T('emp.rolesTitle'))}</h1>
          <div class="crumb">${esc(T('crumb'))}</div>
        </div>
        <div class="content"><div id="raBody"></div></div>`;
    },
    render(){
      const body = document.querySelector('#raBody');
      if(body) renderRolesAccess(body);
    }
  });

  window.registerModuleI18n(ID, {
    th: {
      'title':'จัดการพนักงาน', 'crumb':'บัญชีผู้ใช้ · สิทธิ์การเข้าถึง',
      'nav.employees':'พนักงาน', 'nav.roles':'บทบาท & สิทธิ์',
      'emp.session':'เซสชันปัจจุบัน', 'emp.sessionDesc':'ตอนนี้ยังไม่บังคับล็อกอิน (โหมด local) — Dev Login เป็น mock ให้บทบาท Developer ไว้ทดสอบ',
      'emp.currentRole':'บทบาทปัจจุบัน', 'emp.notLoggedIn':'ยังไม่ได้เข้าสู่ระบบ',
      'emp.devLogin':'เข้าระบบ Dev (จำลอง)', 'emp.devLoginDone':'เข้าสู่ระบบเป็น Developer แล้ว (mock) — จะต่อกับ Firebase Auth จริงในลอตถัดไป',
      'emp.addTitle':'เพิ่มพนักงาน', 'emp.editTitle':'แก้ไขพนักงาน', 'emp.listTitle':'รายชื่อพนักงาน',
      'emp.username':'ไอดี (Username)', 'emp.name':'ชื่อ', 'emp.surname':'นามสกุล', 'emp.employeeId':'รหัสพนักงาน', 'emp.password':'รหัสผ่าน', 'emp.confirmPassword':'ยืนยันรหัสผ่าน', 'emp.passwordKeep':'เว้นว่างไว้ = ไม่เปลี่ยน',
      'emp.baseSalary':'เงินเดือนพื้นฐาน', 'emp.role':'บทบาท', 'emp.active':'เปิดใช้งาน', 'emp.on':'เปิด', 'emp.off':'ปิด',
      'emp.noEmployees':'ยังไม่มีพนักงาน',
      'emp.errNoName':'กรุณากรอกชื่อ', 'emp.errNoSurname':'กรุณากรอกนามสกุล', 'emp.errNoEmployeeId':'กรุณากรอกรหัสพนักงาน', 'emp.errDupEmployeeId':'รหัสพนักงานนี้มีอยู่แล้ว', 'emp.errNoUsername':'กรุณากรอกไอดี', 'emp.errDupUsername':'ไอดีนี้มีอยู่แล้ว', 'emp.errNoPassword':'กรุณาตั้งรหัสผ่าน', 'emp.errPwMismatch':'รหัสผ่านไม่ตรงกัน',
      'emp.delConfirm':'ลบพนักงานคนนี้?',
      'emp.rolesTitle':'บทบาท & สิทธิ์การเข้าถึง', 'emp.rolesDesc':'สร้างบทบาท แล้วติ๊กว่าบทบาทนั้นเข้าเมนูไหนได้บ้าง · Developer เข้าได้ทุกอย่าง (แก้ไม่ได้)',
      'emp.newRoleName':'ชื่อบทบาทใหม่', 'emp.roleType':'ประเภทบทบาท', 'emp.addRole':'+ เพิ่มบทบาท', 'emp.systemRole':'บทบาทระบบ', 'emp.permsTitle':'สิทธิ์การใช้งาน',
      'emp.errNoRoleName':'กรุณากรอกชื่อบทบาท', 'emp.errDupRole':'บทบาทนี้มีอยู่แล้ว',
      'emp.delRoleConfirm':'ลบบทบาทนี้?', 'emp.roleInUse':'มีพนักงานใช้บทบาทนี้อยู่ — ลบต่อไหม?',
      'common.save':'บันทึก', 'common.cancel':'ยกเลิก', 'common.edit':'แก้ไข', 'common.delete':'ลบ'
    },
    en: {
      'title':'Employee Management', 'crumb':'User accounts · access control',
      'nav.employees':'Employees', 'nav.roles':'Roles & Access',
      'emp.session':'Current session', 'emp.sessionDesc':'Login is not enforced yet (local mode) — Dev Login is a mock that grants the Developer role for testing',
      'emp.currentRole':'Current role', 'emp.notLoggedIn':'Not logged in',
      'emp.devLogin':'Dev Login (mock)', 'emp.devLoginDone':'Logged in as Developer (mock) — wired to real Firebase Auth in the next lot',
      'emp.addTitle':'Add employee', 'emp.editTitle':'Edit employee', 'emp.listTitle':'Employees',
      'emp.username':'ID (Username)', 'emp.name':'Name', 'emp.surname':'Surname', 'emp.employeeId':'Employee ID', 'emp.password':'Password', 'emp.confirmPassword':'Confirm Password', 'emp.passwordKeep':'Leave blank = keep current',
      'emp.baseSalary':'Base salary', 'emp.role':'Role', 'emp.active':'Active', 'emp.on':'On', 'emp.off':'Off',
      'emp.noEmployees':'No employees yet',
      'emp.errNoName':'Enter a first name', 'emp.errNoSurname':'Enter a surname', 'emp.errNoEmployeeId':'Enter an employee ID', 'emp.errDupEmployeeId':'That employee ID already exists', 'emp.errNoUsername':'Enter an ID', 'emp.errDupUsername':'That ID already exists', 'emp.errNoPassword':'Set a password', 'emp.errPwMismatch':'Passwords do not match',
      'emp.delConfirm':'Delete this employee?',
      'emp.rolesTitle':'Roles & Access', 'emp.rolesDesc':'Create roles, then tick which menus each role can open · Developer has full access (not editable)',
      'emp.newRoleName':'New role name', 'emp.roleType':'Role Type', 'emp.addRole':'+ Add role', 'emp.systemRole':'system role', 'emp.permsTitle':'Permissions',
      'emp.errNoRoleName':'Enter a role name', 'emp.errDupRole':'That role already exists',
      'emp.delRoleConfirm':'Delete this role?', 'emp.roleInUse':'Employees are using this role — delete anyway?',
      'common.save':'Save', 'common.cancel':'Cancel', 'common.edit':'Edit', 'common.delete':'Delete'
    }
  });
})();
