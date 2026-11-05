/* ============================================================================
 * Payroll — sits under Accounting.
 *
 * Scaffolding only for now: nothing here CALCULATES a payslip yet. It stores the
 * building blocks so the maths can be added later without moving data around.
 *
 * Subpages:
 *   empPayroll  — roster with each employee's base salary; click a row to edit
 *   compensation — the pay components (earnings / deductions) used by payroll
 *   authorizePayroll — closes each month's payroll (see the rules there)
 *
 * The employee roster is NOT owned here: it is READ ONLY, through
 * window.employeesAll(). Base salary is edited under Organization > Employees,
 * so employees.js stays the single writer of mod_emp_employees.
 * ==========================================================================*/
(function(){
  const ID = 'payroll';
  const K_COMP = 'mod_payroll_components';   // [{ id, code, name, mode, pfss, tax, taxType }]
  const K_PERIOD = 'mod_payroll_periods';    // { 'YYYY-MM': { closed, by, at } }
  // Per-employee pay lines: which components apply to them, and the amount for
  // each month. The three locked components are automatic and live outside this.
  const K_EMPCOMP = 'mod_payroll_empcomp';   // { assign:{empId:[compId]}, amounts:{empId:{'YYYY-MM':{compId:number}}} }
  const SUBPAGES = ['empPayroll', 'compensation', 'authorizePayroll'];

  const esc = (v)=> String(v==null?'':v).replace(/[&<>"']/g, c=> ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const rid = ()=> 'pc_' + Math.random().toString(36).slice(2, 9);
  const T = (k)=> window.moduleI18n(ID)(k);
  const fmt = (n)=> Number(n||0).toLocaleString('en-US', { minimumFractionDigits:2, maximumFractionDigits:2 });

  let subPage = 'empPayroll';
  let components = [];
  let periods = {};
  let empComp = { assign:{}, amounts:{} };
  let compMode = 'earn';      // which side of the Compensation switch is showing
  let editingEmpId = null;    // employee being edited on the payroll page
  let payMonth = window.thisMonthKey();
  const monthLabel = (k)=> window.monthLabel(k);
  const fullNameOf = (e)=> ((e.name||'') + ' ' + (e.surname||'')).trim() || e.username || '-';
  const isSalesperson = (e)=> (typeof window.roleTypeOf === 'function') && window.roleTypeOf(e.roleKey) === 'salesperson';
  // One employee's numbers for a month — used by both the list and the detail.
  function payFigures(emp, monthKey){
    const base = Number(emp.baseSalary) || 0;
    let commission = 0;
    const comm = (typeof window.payrollCommission === 'function') ? window.payrollCommission(monthKey) : null;
    if(comm && isSalesperson(emp)){
      if(comm.mode === 'pool'){
        const heads = roster().filter(isSalesperson).length || 1;
        commission = comm.total / heads;
      }else{
        commission = comm.bySeller[fullNameOf(emp)] || 0;
      }
    }
    const leaveDays = (typeof window.hrLeaveDays === 'function') ? window.hrLeaveDays(emp.id, monthKey, true) : 0;
    const leaveCut = leaveDays * (base / 30);
    // Lines this employee was given, valued for this month.
    let extraEarn = 0, extraDeduct = 0;
    assignOf(emp.id).forEach(cid=>{
      const c = components.find(x=> x.id === cid);
      if(!c || isAuto(c)) return;
      const v = amountOf(emp.id, monthKey, cid);
      if(c.mode === 'deduct') extraDeduct += v; else extraEarn += v;
    });
    const earn = base + commission + extraEarn;
    const deduct = leaveCut + extraDeduct;
    return { base, commission, leaveDays, leaveCut, extraEarn, extraDeduct, earn, deduct, net: earn - deduct };
  }
  function monthPicker(){
    return `<div class="art-toolbar">
        <div class="art-field"><label>${esc(T('pay.month'))}</label>
          <span class="month-pick">
            <button type="button" class="btn btn-ghost" id="payMonthPrev" title="${esc(T('pay.prevMonth'))}">\u2039</button>
            <input type="month" id="payMonthSel" value="${esc(payMonth)}">
            <button type="button" class="btn btn-ghost" id="payMonthNext" title="${esc(T('pay.nextMonth'))}">\u203A</button>
            <span class="month-pick-label">${esc(monthLabel(payMonth))}</span>
          </span>
        </div>
      </div>`;
  }
  // Shared by both views so the arrows and the field always agree.
  function wireMonthPicker(body, redraw){
    const sel = body.querySelector('#payMonthSel');
    if(!sel) return;
    sel.addEventListener('change', ()=>{ if(sel.value){ payMonth = sel.value; redraw(); } });
    const step = (n)=>{ payMonth = window.monthShift(payMonth, n); redraw(); };
    body.querySelector('#payMonthPrev').addEventListener('click', ()=> step(-1));
    body.querySelector('#payMonthNext').addEventListener('click', ()=> step(1));
  }

  // Components the system fills in by itself. They can be renamed/recoloured but
  // never deleted, and their code + side are fixed because logic depends on them.
  const LOCKED_COMPONENTS = [
    { role:'salary',     code:'earn01',   name:'Salary',     mode:'earn',   pfss:true,  tax:true,  taxType:'40(1)' },
    { role:'commission', code:'earn02',   name:'Commission', mode:'earn',   pfss:false, tax:true,  taxType:'40(1)' },
    { role:'leave',      code:'deduct01', name:'Leave',      mode:'deduct', pfss:false, tax:false, taxType:'' }
  ];
  async function loadAll(){
    periods = (await window.Store.get(K_PERIOD)) || {};
    const ec = await window.Store.get(K_EMPCOMP);
    empComp = { assign: (ec && ec.assign) || {}, amounts: (ec && ec.amounts) || {} };
    components = await window.Store.list(K_COMP);
    let changed = false;
    LOCKED_COMPONENTS.forEach(def=>{
      const found = components.find(c=> c.role === def.role);
      if(found){ if(!found.locked){ found.locked = true; changed = true; } return; }
      components.push({ id: rid(), locked:true, ...def });
      changed = true;
    });
    if(changed) await saveComponents();
  }
  async function saveComponents(){ await window.Store.set(K_COMP, components); }
  async function savePeriods(){ await window.Store.set(K_PERIOD, periods); }
  async function saveEmpComp(){ await window.Store.set(K_EMPCOMP, empComp); }
  const isAuto = (c)=> !!c.role;                       // salary / commission / leave
  const assignOf = (empId)=> empComp.assign[empId] || [];
  const amountOf = (empId, monthKey, compId)=> Number((((empComp.amounts[empId] || {})[monthKey]) || {})[compId]) || 0;
  async function setAmount(empId, monthKey, compId, value){
    if(!empComp.amounts[empId]) empComp.amounts[empId] = {};
    if(!empComp.amounts[empId][monthKey]) empComp.amounts[empId][monthKey] = {};
    empComp.amounts[empId][monthKey][compId] = value;
    await saveEmpComp();
  }
  async function assignComp(empId, compId, on){
    const list = assignOf(empId).filter(id=> id !== compId);
    if(on) list.push(compId);
    empComp.assign[empId] = list;
    await saveEmpComp();
  }
  const isClosed = (key)=> !!(periods[key] && periods[key].closed);
  // Only the dev account may close months out of order.
  const isDev = ()=> !!(window.currentEmployee && window.currentEmployee.roleKey === 'developer');
  // Other roles must work forward: last month has to be closed first.
  const canClose = (key)=> isDev() || isClosed(window.monthShift(key, -1));
  // Reopening is blocked while a LATER month is already closed, so history
  // can't be rewritten underneath a closed period.
  const canReopen = (key)=> isDev() || !isClosed(window.monthShift(key, 1));
  // Other modules ask this before touching data that belongs to a closed month.
  window.payrollPeriodClosed = (key)=> isClosed(key);
  const roster = ()=> (typeof window.employeesAll === 'function' ? window.employeesAll() : []);

  // Codes run per side: earn01, earn02 … / deduct01, deduct02 …
  function nextCode(mode){
    const prefix = mode === 'deduct' ? 'deduct' : 'earn';
    let n = 0;
    components.filter(c=> c.mode === mode).forEach(c=>{
      const m = String(c.code||'').match(new RegExp('^' + prefix + '(\\d+)$'));
      if(m) n = Math.max(n, parseInt(m[1], 10));
    });
    return prefix + String(n + 1).padStart(2, '0');
  }

  /* ---------------- Employee Payroll ---------------- */
  function drawEmpPayroll(body){
    const list = roster();
    if(editingEmpId){ drawEmpPayrollDetail(body, editingEmpId); return; }
    const figs = list.map(e=> ({ e, f: payFigures(e, payMonth) }));
    const totalNet = figs.reduce((s2,x)=> s2 + x.f.net, 0);
    body.innerHTML = `
      <div class="panel">
        <p class="setting-desc" style="margin-top:0;">${esc(T('pay.listDesc'))}</p>
        ${monthPicker()}
        <div class="art-table-wrap">
          <table class="art-table">
            <thead><tr>
              <th>${esc(T('pay.empId'))}</th><th>${esc(T('pay.name'))}</th><th>${esc(T('pay.role'))}</th>
              <th class="num">${esc(T('pay.baseSalary'))}</th><th class="num">${esc(T('pay.commission'))}</th>
              <th class="num">${esc(T('pay.otherEarn'))}</th><th class="num">${esc(T('pay.leave'))}</th>
              <th class="num">${esc(T('pay.otherDeduct'))}</th><th class="num">${esc(T('pay.net'))}</th><th></th>
            </tr></thead>
            <tbody>${figs.length ? figs.map(({e,f})=> `
              <tr class="pay-row" data-id="${esc(e.id)}">
                <td class="art-id">${esc(e.employeeId||'-')}</td>
                <td>${esc(fullNameOf(e))}</td>
                <td>${esc(e.roleKey||'-')}</td>
                <td class="num">${fmt(f.base)}</td>
                <td class="num">${f.commission ? fmt(f.commission) : '-'}</td>
                <td class="num">${f.extraEarn ? fmt(f.extraEarn) : '-'}</td>
                <td class="num">${f.leaveCut ? '-' + fmt(f.leaveCut) : '-'}</td>
                <td class="num">${f.extraDeduct ? '-' + fmt(f.extraDeduct) : '-'}</td>
                <td class="num" style="font-weight:800;">${fmt(f.net)}</td>
                <td><button class="acc-icon pay-edit" title="${esc(T('common.edit'))}">\u270E</button></td>
              </tr>`).join('') : `<tr><td colspan="10" class="art-empty">${esc(T('pay.noEmp'))}</td></tr>`}
            </tbody>
            <tfoot><tr><td colspan="8">${esc(T('pay.totalNet'))}</td><td class="num" style="font-weight:800;">${fmt(totalNet)}</td><td></td></tr></tfoot>
          </table>
        </div>
      </div>`;
    wireMonthPicker(body, ()=> drawEmpPayroll(body));
    body.querySelectorAll('.pay-row').forEach(tr=>{
      const open = ()=>{ editingEmpId = tr.dataset.id; drawEmpPayroll(body); };
      tr.addEventListener('click', open);
    });
  }

  function drawEmpPayrollDetail(body, id){
    const emp = roster().find(e=> e.id === id);
    if(!emp){ editingEmpId = null; drawEmpPayroll(body); return; }
    const f = payFigures(emp, payMonth);
    const locked = isClosed(payMonth);

    // The three system components are always present and read-only; everything
    // else is added per employee and typed in by hand.
    const autoValue = (c)=>{
      if(c.role === 'salary') return { value: fmt(f.base), note: T('pay.fromEmployee') };
      if(c.role === 'commission') return isSalesperson(emp)
        ? { value: fmt(f.commission), note: T('pay.fromSales') + ' \u00B7 ' + payMonth }
        : { value: '\u2014', note: T('pay.notSales') };
      if(c.role === 'leave') return f.leaveDays
        ? { value: '-' + fmt(f.leaveCut), note: T('pay.fromLeave').replace('{n}', f.leaveDays) }
        : { value: '\u2014', note: T('pay.noLeave') };
      return null;
    };
    const mine = assignOf(emp.id);
    const linesFor = (mode)=>{
      const auto = components.filter(c=> c.mode === mode && isAuto(c));
      const picked = components.filter(c=> c.mode === mode && !isAuto(c) && mine.includes(c.id));
      const rows = auto.map(c=>{
        const a = autoValue(c) || { value:'\u2014', note:'' };
        return `<div class="pay-line is-auto">
          <span class="pay-line-code">${esc(c.code)}</span>
          <span class="pay-line-name">${esc(c.name)}<div class="comp-auto">${esc(a.note)}</div></span>
          <span class="pay-line-val">${esc(a.value)}</span>
          <span class="pay-line-act"><span class="art-set-lock" title="${esc(T('pay.autoLine'))}">\u{1F512}</span></span>
        </div>`;
      }).concat(picked.map(c=> `
        <div class="pay-line" data-comp="${esc(c.id)}">
          <span class="pay-line-code">${esc(c.code)}</span>
          <span class="pay-line-name">${esc(c.name)}</span>
          <span class="pay-line-val"><input type="number" class="se-inp pay-amt" data-comp="${esc(c.id)}" value="${amountOf(emp.id, payMonth, c.id) || ''}" step="0.01" placeholder="0" ${locked?'disabled':''}></span>
          <span class="pay-line-act">${locked?'':`<button class="acc-icon pay-rm" data-comp="${esc(c.id)}" title="${esc(T('pay.removeLine'))}">\u2715</button>`}</span>
        </div>`)).join('');
      const rest = components.filter(c=> c.mode === mode && !isAuto(c) && !mine.includes(c.id));
      const adder = (locked || !rest.length) ? '' : `
        <div class="pay-add">
          <select class="pay-add-sel" data-mode="${mode}">${rest.map(c=> `<option value="${esc(c.id)}">${esc(c.code)} \u00B7 ${esc(c.name)}</option>`).join('')}</select>
          <button class="btn btn-ghost pay-add-btn" data-mode="${mode}">${esc(T('pay.addLine'))}</button>
        </div>`;
      return (rows || `<p class="art-set-empty">${esc(T('pay.noComp'))}</p>`) + adder;
    };

    body.innerHTML = `
      <div class="panel">
        <div class="art-order-form-head">
          <button type="button" class="btn btn-ghost" id="payBack">\u2190 ${esc(T('common.back'))}</button>
          <h3 class="art-modal-title">${esc(fullNameOf(emp))}</h3>
        </div>
        ${monthPicker()}
        ${isClosed(payMonth) ? `<p class="setting-desc"><span class="art-pill" style="background:#6B8F71">${esc(T('auth.closed'))}</span> ${esc(T('auth.lockedNote'))}</p>` : ''}
        <div class="art-form-grid">
          <label>${esc(T('pay.empId'))}<input type="text" value="${esc(emp.employeeId||'')}" disabled></label>
          <label>${esc(T('pay.baseSalary'))}<input type="text" value="${esc(fmt(f.base))}" disabled title="${esc(T('pay.baseLocked'))}"></label>
          <div class="art-form-full"><p class="setting-desc" style="margin:0;">${esc(T('pay.baseLocked'))}</p></div>
        </div>

        <h4 class="art-form-section">${esc(T('pay.earnings'))}</h4>
        <div class="pay-lines">${linesFor('earn')}</div>
        <h4 class="art-form-section">${esc(T('pay.deductions'))}</h4>
        <div class="pay-lines">${linesFor('deduct')}</div>

        <div class="art-sum-cards" style="margin-top:18px;">
          <div class="art-stat-card"><div class="art-stat-label">${esc(T('pay.totalEarn'))}</div><div class="art-stat-value art-profit">${fmt(f.earn)} \u0E3F</div></div>
          <div class="art-stat-card"><div class="art-stat-label">${esc(T('pay.totalDeduct'))}</div><div class="art-stat-value art-pending-due">${f.deduct ? '-' + fmt(f.deduct) : '-'} \u0E3F</div></div>
          <div class="art-stat-card"><div class="art-stat-label">${esc(T('pay.net'))} \u00B7 ${esc(monthLabel(payMonth))}</div><div class="art-stat-value" style="font-size:24px;">${fmt(f.net)} \u0E3F</div></div>
        </div>
        <p class="setting-desc">${esc(T('pay.detailNote'))}</p>
      </div>`;

    wireMonthPicker(body, ()=> drawEmpPayrollDetail(body, id));
    body.querySelector('#payBack').addEventListener('click', ()=>{ editingEmpId = null; drawEmpPayroll(body); });
    const redraw = ()=> drawEmpPayrollDetail(body, id);
    body.querySelectorAll('.pay-add-btn').forEach(btn=> btn.addEventListener('click', async ()=>{
      const sel = body.querySelector(`.pay-add-sel[data-mode="${btn.dataset.mode}"]`);
      if(!sel || !sel.value) return;
      await assignComp(emp.id, sel.value, true);
      redraw();
    }));
    body.querySelectorAll('.pay-rm').forEach(btn=> btn.addEventListener('click', async ()=>{
      await assignComp(emp.id, btn.dataset.comp, false);
      redraw();
    }));
    body.querySelectorAll('.pay-amt').forEach(inp=> inp.addEventListener('change', async ()=>{
      await setAmount(emp.id, payMonth, inp.dataset.comp, parseFloat(inp.value) || 0);
      redraw();
    }));
  }

  /* ---------------- Compensation ---------------- */
  function drawCompensation(body){
    const list = components.filter(c=> c.mode === compMode);
    body.innerHTML = `
      <div class="panel">
        <div class="art-toolbar">
          <div class="del-seg" id="compSeg">
            <button type="button" class="del-seg-btn ${compMode==='earn'?'active':''}" data-mode="earn">${esc(T('comp.earn'))}</button>
            <button type="button" class="del-seg-btn ${compMode==='deduct'?'active':''}" data-mode="deduct">${esc(T('comp.deduct'))}</button>
          </div>
          <div class="art-spacer"></div>
          <button class="btn btn-primary" id="compAdd">${esc(T('comp.add'))}</button>
        </div>
        <div class="art-table-wrap">
          <table class="art-table">
            <thead><tr>
              <th>${esc(T('comp.code'))}</th><th>${esc(T('comp.name'))}</th><th>${esc(T('comp.mode'))}</th>
              <th class="c">${esc(T('comp.pfss'))}</th><th class="c">${esc(T('comp.tax'))}</th><th></th>
            </tr></thead>
            <tbody>${list.length ? list.map(c=> `
              <tr data-id="${esc(c.id)}">
                <td class="art-id">${esc(c.code)}</td>
                <td>${esc(c.name)}${c.role ? `<div class="comp-auto">${esc(T('comp.src.' + c.role))}</div>` : ''}</td>
                <td><span class="art-pill" style="background:${c.mode==='earn'?'#6B8F71':'#C6432E'}">${esc(c.mode==='earn'?T('comp.earn'):T('comp.deduct'))}</span></td>
                <td class="c">${c.pfss ? '\u2713' : '\u2014'}</td>
                <td class="c">${c.tax ? esc(c.taxType || '40(1)') : '\u2014'}</td>
                <td><div class="art-row-actions">
                  <button class="acc-icon comp-edit" title="${esc(T('common.edit'))}">\u270E</button>
                  ${c.locked ? `<span class="art-set-lock" title="${esc(T('comp.lockedHint'))}">\u{1F512}</span>` : `<button class="acc-icon comp-del" title="${esc(T('common.delete'))}">\u2715</button>`}
                </div></td>
              </tr>`).join('') : `<tr><td colspan="6" class="art-empty">${esc(T('comp.empty'))}</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>`;
    body.querySelectorAll('#compSeg [data-mode]').forEach(b=> b.addEventListener('click', ()=>{ compMode = b.dataset.mode; drawCompensation(body); }));
    body.querySelector('#compAdd').addEventListener('click', ()=> openCompEditor(body, null));
    body.querySelectorAll('tr[data-id]').forEach(tr=>{
      const id = tr.dataset.id;
      tr.querySelector('.comp-edit').addEventListener('click', ()=> openCompEditor(body, id));
      const delBtn = tr.querySelector('.comp-del');
      if(delBtn) delBtn.addEventListener('click', async ()=>{
        if(!window.confirm(T('comp.delConfirm'))) return;
        components = components.filter(c=> c.id !== id);
        await saveComponents();
        drawCompensation(body);
      });
    });
  }

  function openCompEditor(body, id){
    const rec = id ? components.find(c=> c.id === id) : null;
    const mode = rec ? rec.mode : compMode;
    const ov = document.createElement('div');
    ov.className = 'art-modal-overlay show';
    ov.innerHTML = `
      <div class="art-modal">
        <h3 class="art-modal-title">${esc(rec ? T('comp.editTitle') : T('comp.addTitle'))}</h3>
        <div class="art-form-grid">
          <label>${esc(T('comp.code'))}<input type="text" id="cCode" value="${esc(rec ? rec.code : nextCode(mode))}" ${rec && rec.locked ? 'disabled' : ''}></label>
          <label>${esc(T('comp.name'))}<input type="text" id="cName" value="${esc(rec ? rec.name : '')}" placeholder="${esc(T('comp.namePh'))}"></label>
        </div>
        <label class="art-img-label" style="display:block; margin:12px 0 6px;">${esc(T('comp.mode'))}</label>
        ${rec && rec.locked ? `<p class="setting-desc">${esc(T('comp.lockedHint'))}</p>` : ''}
        <div class="del-seg" id="cMode">
          <button type="button" class="del-seg-btn ${mode==='earn'?'active':''}" data-m="earn">${esc(T('comp.earn'))}</button>
          <button type="button" class="del-seg-btn ${mode==='deduct'?'active':''}" data-m="deduct">${esc(T('comp.deduct'))}</button>
        </div>
        <h4 class="art-form-section">${esc(T('comp.rules'))}</h4>
        <label class="pc-switch"><input type="checkbox" id="cPfss" ${rec && rec.pfss ? 'checked' : ''}><span>${esc(T('comp.pfssFull'))}</span></label>
        <label class="pc-switch" style="display:flex;"><input type="checkbox" id="cTax" ${rec && rec.tax ? 'checked' : ''}><span>${esc(T('comp.taxFull'))}</span></label>
        <div class="del-seg" id="cTaxType" style="margin-top:8px; ${rec && rec.tax ? '' : 'display:none;'}">
          <button type="button" class="del-seg-btn ${!rec || rec.taxType!=='40(2)' ? 'active':''}" data-tt="40(1)">40(1)</button>
          <button type="button" class="del-seg-btn ${rec && rec.taxType==='40(2)' ? 'active':''}" data-tt="40(2)">40(2)</button>
        </div>
        <div class="art-modal-actions">
          <button class="btn btn-ghost" id="cCancel">${esc(T('common.cancel'))}</button>
          <button class="btn btn-primary" id="cSave">${esc(T('common.save'))}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const g = (x)=> ov.querySelector('#'+x);
    let curMode = mode;
    let curTaxType = rec && rec.taxType ? rec.taxType : '40(1)';
    if(rec && rec.locked) ov.querySelectorAll('#cMode [data-m]').forEach(b=> b.disabled = true);
    ov.querySelectorAll('#cMode [data-m]').forEach(b=> b.addEventListener('click', ()=>{
      curMode = b.dataset.m;
      ov.querySelectorAll('#cMode [data-m]').forEach(x=> x.classList.toggle('active', x.dataset.m === curMode));
      if(!rec) g('cCode').value = nextCode(curMode);
    }));
    ov.querySelectorAll('#cTaxType [data-tt]').forEach(b=> b.addEventListener('click', ()=>{
      curTaxType = b.dataset.tt;
      ov.querySelectorAll('#cTaxType [data-tt]').forEach(x=> x.classList.toggle('active', x.dataset.tt === curTaxType));
    }));
    g('cTax').addEventListener('change', (e)=>{ g('cTaxType').style.display = e.target.checked ? '' : 'none'; });
    const close = ()=> ov.remove();
    ov.addEventListener('click', e=>{ if(e.target === ov) close(); });
    g('cCancel').addEventListener('click', close);
    g('cSave').addEventListener('click', async ()=>{
      const code = g('cCode').value.trim();
      const name = g('cName').value.trim();
      if(!code){ alert(T('comp.errCode')); return; }
      if(!name){ alert(T('comp.errName')); return; }
      const data = { name, pfss: g('cPfss').checked, tax: g('cTax').checked, taxType: g('cTax').checked ? curTaxType : '' };
      if(!(rec && rec.locked)){ data.code = code; data.mode = curMode; }   // fixed on system rows
      if(rec) Object.assign(rec, data);
      else components.push({ id: rid(), ...data });
      await saveComponents();
      compMode = curMode;
      close();
      drawCompensation(body);
    });
  }

  /* ---------------- Authorize Payroll ----------------
   * Closing a month freezes its payroll. Everyone except the dev account has to
   * close months in order, so a period can never be signed off while an older
   * one is still open.
   */
  function drawAuthorize(body){
    const closed = isClosed(payMonth);
    const rec = periods[payMonth] || {};
    const prev = window.monthShift(payMonth, -1);
    const list = roster();
    const figs = list.map(e=> ({ e, f: payFigures(e, payMonth) }));
    const totalNet = figs.reduce((s2,x)=> s2 + x.f.net, 0);
    const blockedBy = !closed && !canClose(payMonth);
    const blockedReopen = closed && !canReopen(payMonth);

    body.innerHTML = `
      <div class="panel">
        <p class="setting-desc" style="margin-top:0;">${esc(T('auth.desc'))}</p>
        ${monthPicker()}

        <div class="art-sum-cards">
          <div class="art-stat-card"><div class="art-stat-label">${esc(T('auth.status'))}</div>
            <div class="art-stat-value" style="font-size:18px;">
              <span class="art-pill" style="background:${closed ? '#6B8F71' : '#E0A100'}">${esc(closed ? T('auth.closed') : T('auth.open'))}</span>
            </div></div>
          <div class="art-stat-card"><div class="art-stat-label">${esc(T('pay.empId'))}</div><div class="art-stat-value">${list.length}</div></div>
          <div class="art-stat-card"><div class="art-stat-label">${esc(T('pay.totalNet'))}</div><div class="art-stat-value">${fmt(totalNet)} \u0E3F</div></div>
          <div class="art-stat-card"><div class="art-stat-label">${esc(T('auth.closedBy'))}</div>
            <div class="art-stat-value" style="font-size:14px;">${closed ? esc(rec.by || '-') + (rec.at ? '<div class="comp-auto">' + esc(String(rec.at).slice(0,16).replace('T',' ')) + '</div>' : '') : '-'}</div></div>
        </div>

        ${blockedBy ? `<p class="setting-desc art-pending-due">\u26A0 ${esc(T('auth.needPrev').replace('{m}', monthLabel(prev)))}</p>` : ''}
        ${blockedReopen ? `<p class="setting-desc art-pending-due">\u26A0 ${esc(T('auth.blockReopen').replace('{m}', monthLabel(window.monthShift(payMonth, 1))))}</p>` : ''}
        ${isDev() ? `<p class="setting-desc">${esc(T('auth.devNote'))}</p>` : ''}

        <div class="art-modal-actions" style="justify-content:flex-start;">
          ${closed
            ? `<button class="btn btn-ghost" id="authReopen" ${blockedReopen?'disabled':''}>${esc(T('auth.reopen'))}</button>`
            : `<button class="btn btn-primary" id="authClose" ${blockedBy?'disabled':''}>${esc(T('auth.close'))}</button>`}
          <span class="setting-desc" style="margin-left:10px;">${esc(T('auth.postsTo'))}</span>
        </div>

        <h4 class="art-form-section">${esc(T('auth.summary'))} \u00B7 ${esc(monthLabel(payMonth))}</h4>
        <div class="art-table-wrap">
          <table class="art-table">
            <thead><tr>
              <th>${esc(T('pay.empId'))}</th><th>${esc(T('pay.name'))}</th>
              <th class="num">${esc(T('pay.baseSalary'))}</th><th class="num">${esc(T('pay.commission'))}</th>
              <th class="num">${esc(T('pay.otherEarn'))}</th><th class="num">${esc(T('pay.leave'))}</th>
              <th class="num">${esc(T('pay.otherDeduct'))}</th><th class="num">${esc(T('pay.net'))}</th>
            </tr></thead>
            <tbody>${figs.length ? figs.map(({e,f})=> `
              <tr>
                <td class="art-id">${esc(e.employeeId||'-')}</td>
                <td>${esc(fullNameOf(e))}</td>
                <td class="num">${fmt(f.base)}</td>
                <td class="num">${f.commission ? fmt(f.commission) : '-'}</td>
                <td class="num">${f.extraEarn ? fmt(f.extraEarn) : '-'}</td>
                <td class="num">${f.leaveCut ? '-' + fmt(f.leaveCut) : '-'}</td>
                <td class="num">${f.extraDeduct ? '-' + fmt(f.extraDeduct) : '-'}</td>
                <td class="num" style="font-weight:800;">${fmt(f.net)}</td>
              </tr>`).join('') : `<tr><td colspan="8" class="art-empty">${esc(T('pay.noEmp'))}</td></tr>`}
            </tbody>
            <tfoot><tr><td colspan="7">${esc(T('pay.totalNet'))}</td><td class="num" style="font-weight:800;">${fmt(totalNet)}</td></tr></tfoot>
          </table>
        </div>
      </div>`;

    wireMonthPicker(body, ()=> drawAuthorize(body));
    const closeBtn = body.querySelector('#authClose');
    if(closeBtn) closeBtn.addEventListener('click', async ()=>{
      if(!canClose(payMonth)) return;
      if(!window.confirm(T('auth.confirmClose').replace('{m}', monthLabel(payMonth)))) return;
      const who = (typeof window.sellerNameOf === 'function') ? window.sellerNameOf() : ((window.currentEmployee && window.currentEmployee.username) || '-');
      periods[payMonth] = { closed:true, by: who, at: new Date().toISOString(), total: totalNet };
      await savePeriods();
      // An authorized month is money the business owes — book it as an operating expense.
      if(typeof window.postPayrollExpense === 'function') await window.postPayrollExpense(payMonth, totalNet, who);
      drawAuthorize(body);
    });
    const reopenBtn = body.querySelector('#authReopen');
    if(reopenBtn) reopenBtn.addEventListener('click', async ()=>{
      if(!canReopen(payMonth)) return;
      if(!window.confirm(T('auth.confirmReopen').replace('{m}', monthLabel(payMonth)))) return;
      delete periods[payMonth];
      await savePeriods();
      if(typeof window.removePayrollExpense === 'function') await window.removePayrollExpense(payMonth);
      drawAuthorize(body);
    });
  }

  /* ---------------- shell ---------------- */
  function drawSubnav(container){
    const nav = container.querySelector('#payrollSubnav');
    if(!nav) return;
    nav.innerHTML = SUBPAGES.map(sp=>
      `<button type="button" class="acc-subnav-btn ${sp===subPage?'active':''}" data-subpage="${sp}">${esc(T('sub.'+sp))}</button>`
    ).join('');
  }

  window.registerModuleI18n(ID, {
    th: {
      'title': 'เงินเดือน (Payroll)', 'crumb': 'ระบบจัดการค่าตอบแทนพนักงาน',
      'sub.empPayroll': 'เงินเดือนพนักงาน', 'sub.compensation': 'ค่าเงิน (Compensation)', 'sub.authorizePayroll': 'อนุมัติเงินเดือน',
      'auth.desc': 'อนุมัติเงินเดือนของแต่ละเดือน · เดือนที่อนุมัติแล้วจะแก้ไขไม่ได้จนกว่าจะยกเลิกอนุมัติ',
      'auth.status': 'สถานะ', 'auth.open': 'ยังไม่อนุมัติ', 'auth.closed': 'อนุมัติแล้ว', 'auth.closedBy': 'อนุมัติโดย',
      'auth.close': 'Authorize', 'auth.reopen': 'Unauthorize', 'auth.summary': 'สรุปเงินเดือนที่จะอนุมัติ', 'auth.postsTo': 'อนุมัติแล้วจะบันทึกเป็นค่าใช้จ่ายดำเนินงาน หมวด Payroll ให้อัตโนมัติ',
      'auth.needPrev': 'ต้องอนุมัติเดือน {m} ก่อน จึงจะอนุมัติเดือนนี้ได้',
      'auth.blockReopen': 'ยกเลิกอนุมัติไม่ได้ เพราะเดือน {m} อนุมัติไปแล้ว',
      'auth.devNote': 'บัญชี Developer อนุมัติ/ยกเลิกอนุมัติเดือนใดก็ได้ ไม่ต้องเรียงลำดับ',
      'auth.lockedNote': 'เดือนนี้อนุมัติแล้ว — ข้อมูลเงินเดือนของเดือนนี้ถือว่าสิ้นสุด',
      'auth.confirmClose': 'Authorize เงินเดือนเดือน {m}?', 'auth.confirmReopen': 'Unauthorize เดือน {m}?',
      'common.save': 'บันทึก', 'common.cancel': 'ยกเลิก', 'common.edit': 'แก้ไข', 'common.delete': 'ลบ', 'common.back': 'กลับ',
      'pay.listDesc': 'รายชื่อพนักงานทั้งหมด กดที่แถวเพื่อเข้าไปแก้ไขข้อมูลเงินเดือน',
      'pay.empId': 'รหัสพนักงาน', 'pay.name': 'ชื่อ-นามสกุล', 'pay.role': 'บทบาท', 'pay.baseSalary': 'เงินเดือนพื้นฐาน',
      'pay.noEmp': 'ยังไม่มีพนักงาน', 'pay.earnings': 'รายการเพิ่ม (Earn)', 'pay.deductions': 'รายการหัก (Deduct)',
      'pay.noComp': 'ยังไม่ได้สร้างค่าเงินในหมวดนี้',
      'pay.detailNote': 'เงินเดือนและค่าคอมดึงมาให้อัตโนมัติ · รายการอื่นยังรอสูตรคำนวณ',
      'pay.fromEmployee': 'ดึงจากเงินเดือนพื้นฐานของพนักงาน — แก้ที่ข้อมูลพนักงานเท่านั้น',
      'pay.fromSales': 'คำนวณจากยอดขายตามสูตรคอมมิชชั่น',
      'pay.notSales': 'เฉพาะพนักงานที่มีบทบาทฝ่ายขาย',
      'pay.fromLeave': 'ลาแบบหักเงิน {n} วัน (เงินเดือน ÷ 30 × วันลา)',
      'pay.noLeave': 'เดือนนี้ไม่มีวันลาแบบหักเงิน',
      'pay.month': 'เดือน', 'pay.prevMonth': 'เดือนก่อนหน้า', 'pay.nextMonth': 'เดือนถัดไป', 'pay.commission': 'ค่าคอม', 'pay.otherEarn': 'รายได้อื่น', 'pay.leave': 'หักวันลา', 'pay.otherDeduct': 'รายการหักอื่น',
      'pay.net': 'เงินสุทธิ', 'pay.totalNet': 'รวมเงินสุทธิทั้งหมด',
      'pay.totalEarn': 'รวมรายได้', 'pay.totalDeduct': 'รวมรายการหัก',
      'pay.baseLocked': 'เงินเดือนพื้นฐานแก้ที่นี่ไม่ได้ — ไปแก้ที่ Organization › พนักงาน',
      'pay.addLine': '+ เพิ่มค่าเงิน', 'pay.removeLine': 'เอาออกจากพนักงานคนนี้',
      'pay.autoLine': 'ระบบคำนวณให้อัตโนมัติ — แก้ตัวเลขที่นี่ไม่ได้',
      'comp.lockedHint': 'รายการที่ระบบใช้งาน — เปลี่ยนชื่อได้ แต่ลบไม่ได้ และแก้โค้ด/ประเภทไม่ได้',
      'comp.src.salary': 'ดึงจากเงินเดือนพื้นฐาน',
      'comp.src.commission': 'คำนวณจากยอดขาย',
      'comp.src.leave': 'หักตามวันลา (รอกำหนดสูตร)',
      'comp.earn': 'Earn (เพิ่ม)', 'comp.deduct': 'Deduct (หัก)', 'comp.add': '+ เพิ่มค่าเงิน',
      'comp.code': 'โค้ด', 'comp.name': 'ชื่อค่าเงิน', 'comp.namePh': 'เช่น ค่าล่วงเวลา, ค่าน้ำมัน',
      'comp.mode': 'ประเภท', 'comp.pfss': 'PF/SS', 'comp.tax': 'ภาษี',
      'comp.pfssFull': 'คิด PF / ประกันสังคม (SS)', 'comp.taxFull': 'คิดภาษี',
      'comp.rules': 'เงื่อนไขการคำนวณ', 'comp.empty': 'ยังไม่มีค่าเงินในหมวดนี้',
      'comp.addTitle': 'เพิ่มค่าเงิน', 'comp.editTitle': 'แก้ไขค่าเงิน', 'comp.delConfirm': 'ลบค่าเงินนี้?',
      'comp.errCode': 'กรุณาใส่โค้ด', 'comp.errName': 'กรุณาใส่ชื่อค่าเงิน',
      'proc.soon': 'ยังไม่เปิดใช้งาน — รอออกแบบรอบการจ่ายเงินเดือน'
    },
    en: {
      'title': 'Payroll', 'crumb': 'Employee compensation',
      'sub.empPayroll': 'Employee Payroll', 'sub.compensation': 'Compensation', 'sub.authorizePayroll': 'Authorized Payroll',
      'auth.desc': 'Authorize each month\'s payroll · an authorized month cannot be changed until it is unauthorized',
      'auth.status': 'Status', 'auth.open': 'Not authorized', 'auth.closed': 'Authorized', 'auth.closedBy': 'Authorized by',
      'auth.close': 'Authorize', 'auth.reopen': 'Unauthorize', 'auth.summary': 'Payroll being authorized', 'auth.postsTo': 'Authorizing posts the total to Operational Expense under the Payroll category',
      'auth.needPrev': '{m} must be authorized first',
      'auth.blockReopen': 'Cannot unauthorize — {m} is already authorized',
      'auth.devNote': 'The Developer account can authorize or unauthorize any month, in any order',
      'auth.lockedNote': 'This month is authorized — its payroll is final',
      'auth.confirmClose': 'Authorize payroll for {m}?', 'auth.confirmReopen': 'Unauthorize {m}?',
      'common.save': 'Save', 'common.cancel': 'Cancel', 'common.edit': 'Edit', 'common.delete': 'Delete', 'common.back': 'Back',
      'pay.listDesc': 'Everyone on the roster — click a row to edit their payroll',
      'pay.empId': 'Employee ID', 'pay.name': 'Name', 'pay.role': 'Role', 'pay.baseSalary': 'Base salary',
      'pay.noEmp': 'No employees yet', 'pay.earnings': 'Earnings', 'pay.deductions': 'Deductions',
      'pay.noComp': 'No components created on this side yet',
      'pay.detailNote': 'Salary and commission are filled in automatically · other lines still await their formula',
      'pay.fromEmployee': 'Pulled from the employee\'s base salary — edit it on the employee record',
      'pay.fromSales': 'Calculated from sales using the commission rules',
      'pay.notSales': 'Salesperson roles only',
      'pay.fromLeave': '{n} unpaid leave day(s) — base salary ÷ 30 × days',
      'pay.noLeave': 'No unpaid leave this month',
      'pay.month': 'Month', 'pay.prevMonth': 'Previous month', 'pay.nextMonth': 'Next month', 'pay.commission': 'Commission', 'pay.otherEarn': 'Other Earned', 'pay.leave': 'Leave', 'pay.otherDeduct': 'Other Deducted',
      'pay.net': 'Net pay', 'pay.totalNet': 'Total net pay',
      'pay.totalEarn': 'Total earnings', 'pay.totalDeduct': 'Total deductions',
      'pay.baseLocked': 'Base salary cannot be edited here — change it under Organization › Employees',
      'pay.addLine': '+ Add component', 'pay.removeLine': 'Remove from this employee',
      'pay.autoLine': 'Filled in by the app — not editable here',
      'comp.lockedHint': 'System component — renameable, but it cannot be deleted and its code/side are fixed',
      'comp.src.salary': 'From base salary',
      'comp.src.commission': 'From sales',
      'comp.src.leave': 'From leave days (formula pending)',
      'comp.earn': 'Earn', 'comp.deduct': 'Deduct', 'comp.add': '+ Add component',
      'comp.code': 'Code', 'comp.name': 'Name', 'comp.namePh': 'e.g. Overtime, Fuel allowance',
      'comp.mode': 'Type', 'comp.pfss': 'PF/SS', 'comp.tax': 'Tax',
      'comp.pfssFull': 'Counts toward PF / Social Security', 'comp.taxFull': 'Taxable',
      'comp.rules': 'Calculation rules', 'comp.empty': 'Nothing on this side yet',
      'comp.addTitle': 'Add component', 'comp.editTitle': 'Edit component', 'comp.delConfirm': 'Delete this component?',
      'comp.errCode': 'Please enter a code', 'comp.errName': 'Please enter a name',
      'proc.soon': 'Not built yet — the payroll run still needs designing'
    }
  });

  window.registerModule({
    id: ID,
    navLabel: { th: 'เงินเดือน', en: 'Payroll' },
    pageId: 'page-payroll',
    async onInit(){ await loadAll(); },
    async onRemoteChange(){ await loadAll(); },   // live sync: re-read from the updated cache
    async mount(container){
      if(!components.length) await loadAll();
      container.innerHTML = `
        <div class="topbar">
          <h1>${esc(T('title'))}</h1>
          <div class="crumb">${esc(T('crumb'))}</div>
        </div>
        <div class="content">
          <div class="acc-subnav store-subnav" id="payrollSubnav"></div>
          <div id="payrollBody"></div>
        </div>`;
      container.querySelector('#payrollSubnav').addEventListener('click', (e)=>{
        const btn = e.target.closest('[data-subpage]');
        if(!btn) return;
        subPage = btn.dataset.subpage;
        editingEmpId = null;
        this.render();
      });
      this.render();
    },
    render(){
      const container = document.getElementById('page-payroll');
      if(!container) return;
      const h1 = container.querySelector('.topbar h1');
      if(h1) h1.textContent = T('title');
      const crumb = container.querySelector('.crumb');
      if(crumb) crumb.textContent = T('crumb');
      drawSubnav(container);
      const body = container.querySelector('#payrollBody');
      if(!body) return;
      if(subPage === 'compensation') drawCompensation(body);
      else if(subPage === 'authorizePayroll') drawAuthorize(body);
      else drawEmpPayroll(body);
    }
  });
})();
