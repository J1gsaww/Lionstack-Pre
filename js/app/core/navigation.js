"use strict";
/* js/app/core/navigation.js
   PAGE/VIEW SWITCHING + NAVIGATION (sidebar, STORE_ONLY redirect)
   Extracted verbatim from the original app.js (same load order, shared
   global scope). Behaviour is unchanged. */
/* ============================================================
   PAGE / VIEW SWITCHING
   ============================================================ */
function switchView(boardKey, view){
  document.querySelectorAll(`.view-tab-btn[data-board="jigsaw"]`).forEach(b=>{
    b.classList.toggle('active', b.dataset.view === view);
  });
  document.getElementById('jigsaw-view-board').style.display = view==='board' ? 'block':'none';
  document.getElementById('jigsaw-view-list').style.display = view==='list' ? 'block':'none';
  document.getElementById('jigsaw-view-completed').style.display = view==='completed' ? 'block':'none';
  if(view==='list') renderCardList(boardKey);
  if(view==='completed') renderCompletedList(boardKey);
}

/* ============================================================
   NAVIGATION — the sidebar is rendered from `rooms`:
     Main Calendar → Note (global) → [rooms, each with Task /
     Calendar / Note] → Setting.
   currentView describes what is on screen.
   ============================================================ */
let currentView = { type:'maincal' };
let mainCalDate = zoneTodayPointer();

const ALL_PAGES = ['page-home','page-maincal','page-globalnote','page-notify','page-jigsawdiary','page-calendar','page-jigsawnotes','page-interface','page-setting','page-usersetting'];
function showOnlyPage(pageId){
  ALL_PAGES.forEach(p=>{
    const el = document.getElementById(p);
    if(el) el.style.display = (p===pageId) ? 'block' : 'none';
  });
}

function roomNavKey(view){
  if(view.type==='room') return view.roomId + ':' + view.page;
  if(view.type==='module') return 'mod:' + view.moduleId;
  return view.type;
}

// ---- Store-only mode (Phase 3): present just the Simple Store
// modules. The kanban (home / rooms / main calendar / global notes / notify) is
// kept in code but hidden from the sidebar and made unreachable via navigateTo.
// Flip STORE_ONLY to false to bring the full Base App back. ----
const STORE_ONLY = true;
const STORE_HOME_MODULE = 'stock';   // landing page in store mode (the old 'accounting' page was removed)
const KANBAN_VIEWS = new Set(['home', 'room', 'maincal', 'globalnote', 'notify']);

let navCollapsed = new Set();
function renderSidebar(){
  const nav = document.getElementById('sidebarNav');
  if(!nav) return;
  const activeKey = roomNavKey(currentView);
  let html = '';
  if(!STORE_ONLY){
    html += `<div class="nav-item ${activeKey==='home'?'active':''}" data-nav="home"><span class="dot"></span><span class="label">${t('nav.home')}</span></div>`;
    html += `<div class="nav-item ${activeKey==='maincal'?'active':''}" data-nav="maincal"><span class="dot"></span><span class="label">${t('nav.maincal')}</span></div>`;
    html += `<div class="nav-item ${activeKey==='globalnote'?'active':''}" data-nav="globalnote"><span class="dot"></span><span class="label">${t('nav.globalnote')}</span></div>`;
    const notifyCount = collectNotifications().length;
    const badge = badgeColors();
    html += `<div class="nav-item ${activeKey==='notify'?'active':''}" data-nav="notify"><span class="dot"></span><span class="label">${t('nav.notify')}</span>${notifyCount ? `<span class="nav-badge" style="background:${badge.bg}; color:${badge.ink}">${notifyCount}</span>` : ''}</div>`;
    html += `<div class="nav-sep"></div>`;
    rooms.forEach(r=>{
      const isCurrent = currentView.type==='room' && currentView.roomId===r.id;
      html += `<div class="nav-room ${isCurrent?'open':''}">
        <div class="nav-room-head ${isCurrent?'active':''}" data-nav="room" data-room="${r.id}" data-page="task">
          <span class="nav-room-caret">${isCurrent?'▾':'▸'}</span>
          <span class="nav-room-name">${escapeHtml(roomLabel(r))}</span>
        </div>
        <div class="nav-room-sub" style="display:${isCurrent?'block':'none'}">
          <div class="nav-subitem ${activeKey===r.id+':task'?'active':''}"     data-nav="room" data-room="${r.id}" data-page="task">${t('nav.task')}</div>
          <div class="nav-subitem ${activeKey===r.id+':calendar'?'active':''}" data-nav="room" data-room="${r.id}" data-page="calendar">${t('nav.calendar')}</div>
          <div class="nav-subitem ${activeKey===r.id+':note'?'active':''}"     data-nav="room" data-room="${r.id}" data-page="note">${t('nav.note')}</div>
        </div>
      </div>`;
    });
    html += `<div class="nav-sep"></div>`;
  }
  // Categorised nav — store modules + settings grouped under titles, ROLE-GATED.
  // A category's title only renders when >=1 of its items is visible to the role.
  // A page is visible when the page itself is granted OR any of its subpages is.
  const canSee = (target)=>{
    if(!target || typeof window.roleCanAccess !== 'function') return true;
    if(window.roleCanAccess(window.currentRole, target)) return true;
    const m = getModule(target);
    const subs = (m && Array.isArray(m.subpages)) ? m.subpages : [];
    return subs.some(sp=> window.roleCanAccess(window.currentRole, target + ':' + sp));
  };
  const modItem = (id)=>{
    const m = getModule(id);
    if(!m || !m.pageId || !canSee(id)) return '';
    return `<div class="nav-item ${activeKey===('mod:'+m.id)?'active':''}" data-nav="module" data-module="${m.id}"><span class="dot"></span><span class="label">${escapeHtml(moduleNavLabel(m))}</span></div>`;
  };
  const pageItem = (navKey, labelKey, target)=> canSee(target)
    ? `<div class="nav-item ${activeKey===navKey?'active':''}" data-nav="${navKey}"><span class="dot"></span><span class="label">${t(labelKey)}</span></div>`
    : '';
  const NAV_CATS = [
    ['nav.cat.inventory', [ modItem('stock'), modItem('sell'), modItem('delivery') ]],
    ['nav.cat.accounting',[ modItem('revenueAcct'), modItem('cogsInventory'), modItem('expenseAp'), modItem('financialReport') ]],
    ['nav.cat.hr',        [ modItem('payroll'), modItem('empCalendar') ]],
    ['nav.cat.org',       [ modItem('businessProfile'), modItem('employeeMgmt') ]],
    ['nav.cat.setting',   [ modItem('importExport'), pageItem('setting','nav.setting','setting'), pageItem('usersetting','nav.usersetting',null), modItem('rolesAccess'), modItem('sellStockSetting'), modItem('customerDoc'), modItem('accountingSetting'), modItem('deliverySetting'), modItem('commissionSetting') ]],
  ];
  NAV_CATS.forEach(([titleKey, items])=>{
    const shown = items.filter(Boolean);
    if(!shown.length) return;
    const col = navCollapsed.has(titleKey);
    html += `<div class="nav-cat-title ${col?'collapsed':''}" data-navcat="${titleKey}"><span class="nav-cat-caret">\u25be</span><span>${t(titleKey)}</span></div><div class="nav-cat-items ${col?'collapsed':''}" data-navcatitems="${titleKey}">${shown.join('')}</div>`;
  });
  nav.innerHTML = html;

  nav.querySelectorAll('[data-navcat]').forEach(el=>{
    el.addEventListener('click', ()=>{
      const key = el.dataset.navcat;
      const col = !navCollapsed.has(key);
      if(col) navCollapsed.add(key); else navCollapsed.delete(key);
      el.classList.toggle('collapsed', col);
      const box = nav.querySelector('[data-navcatitems="'+key+'"]');
      if(box) box.classList.toggle('collapsed', col);
    });
  });

  nav.querySelectorAll('[data-nav]').forEach(el=>{
    el.addEventListener('click', ()=>{
      const type = el.dataset.nav;
      if(type==='room'){
        navigateTo({ type:'room', roomId: el.dataset.room, page: el.dataset.page });
      }else if(type==='module'){
        navigateTo({ type:'module', moduleId: el.dataset.module });
      }else{
        navigateTo({ type });
      }
    });
  });
}

// Sidebar order, used to pick a landing page when the requested one is missing.
const NAV_MODULE_ORDER = ['importExport','stock','sell','delivery','revenueAcct','cogsInventory','expenseAp','financialReport','payroll','empCalendar','businessProfile','employeeMgmt','customerDoc','commissionSetting','accountingSetting'];
function firstAvailableModule(){
  for(const id of NAV_MODULE_ORDER){
    const m = getModule(id);
    if(m && m.pageId) return m;
  }
  return null;
}
function navigateTo(view){
  // Store-only mode: kanban views are hidden — send any such navigation (boot
  // default, error-path fallbacks) to the Simple Store module instead.
  if(STORE_ONLY && view && KANBAN_VIEWS.has(view.type)){
    view = { type:'module', moduleId: STORE_HOME_MODULE };
  }
  currentView = view;
  if(view.type==='home'){
    if(STORE_ONLY){ navigateTo({ type:'module', moduleId: STORE_HOME_MODULE }); return; }
    showOnlyPage('page-home');
    renderHomePage();
    renderSidebar();
    return;
  }
  if(view.type==='room'){
    if(BOARDS[view.roomId]) currentRoomId = view.roomId;
    const room = getCurrentRoom();
    if(view.page==='calendar'){
      showOnlyPage('page-calendar');
      if(room) renderCalendar(room);
    }else if(view.page==='note'){
      showOnlyPage('page-jigsawnotes');
      renderNotesList('room');
    }else{ // task
      showOnlyPage('page-jigsawdiary');
      if(room) refreshBoard(room);
    }
  }else if(view.type==='maincal'){
    showOnlyPage('page-maincal');
    renderMainCalendar();
  }else if(view.type==='globalnote'){
    showOnlyPage('page-globalnote');
    renderNotesList('global');
  }else if(view.type==='notify'){
    showOnlyPage('page-notify');
    renderNotificationPage();
  }else if(view.type==='interface'){
    showOnlyPage('page-interface');
    renderInterfacePage();
  }else if(view.type==='module'){
    const m = getModule(view.moduleId);
    if(m && m.pageId){
      showOnlyPage(m.pageId);
      if(typeof m.render === 'function'){
        try{ m.render(); }
        catch(e){ logAppError('module render ล้มเหลว: ' + m.id, e); }
      }
    }else{
      // Module unregistered (build without it) — land on the first sidebar entry
      // instead of the dormant Base App home page.
      const fm = firstAvailableModule();
      if(fm && fm.pageId){
        currentView = { type:'module', moduleId: fm.id };
        showOnlyPage(fm.pageId);
        if(typeof fm.render === 'function'){
          try{ fm.render(); }
          catch(e){ logAppError('module render ล้มเหลว: ' + fm.id, e); }
        }
      }else{
        showOnlyPage('page-setting');
      }
    }
  }else if(view.type==='setting'){
    showOnlyPage('page-setting');
    showSettingTab(settingTab);
    renderInkSetting();
    renderThemeSetting();
    renderThemeCustomEditor();
    renderTimezoneSetting();
    renderSettingLogoPreview();
    renderRoomsEditor();
    refreshSettingEditors();
    renderNotifySetting();
  }else if(view.type==='usersetting'){
    showOnlyPage('page-usersetting');
    renderThemeMode();
    renderInkSetting();
  }
  renderSidebar();
}

/* ---- Main Calendar: aggregates Task instances from every room ---- */
function renderMainCalendar(){
  const label = document.getElementById('maincal-cal-label');
  const grid = document.getElementById('maincal-calendar');
  if(!grid) return;
  const y = mainCalDate.getFullYear();
  const m = mainCalDate.getMonth();
  label.textContent = `${monthName(m+1)} ${y}`;

  const todayIso = localIso();
  const cells = getMonthMatrix(mainCalDate);

  // Gather instances from all rooms, tagged with their owning room.
  const instances = [];
  rooms.forEach(room=>{
    getCardTaskInstances(room).forEach(inst=>{
      instances.push({ ...inst, roomId: room.id, roomName: roomLabel(room), color: chipColor(inst, room) });
    });
  });

  grid.innerHTML = cells.map(cell=>{
    if(!cell) return `<div class="cal-cell empty"></div>`;
    const dayInstances = sortDayInstances(instances.filter(inst=> inst.date === cell.iso));
    const isToday = cell.iso === todayIso;
    return `<div class="cal-cell ${isToday?'today':''}" data-iso="${cell.iso}">
      <div class="cal-daynum">${cell.day}</div>
      <div class="cal-cell-chips">
      ${dayInstances.map(inst=>`
        <div class="cal-chip ${inst.overdue?'overdue':''}" draggable="true" style="background:${inst.color}; color:${resolveInk(inst.color, inst)}" data-id="${inst.cardId}" data-room="${inst.roomId}" data-task="${escapeHtml(inst.task)}" title="[${escapeHtml(inst.roomName)}] ${escapeHtml(inst.topic)} — ${t('chip.task')} ${escapeHtml(inst.task)} — Current Status: ${escapeHtml(inst.currentStatus)}${inst.overdue?' — '+t('chip.overdue'):''}">
          <div class="cal-chip-room">${escapeHtml(inst.roomName)}</div>
          <div class="cal-chip-topic">${inst.time ? '<span class="cal-chip-time">'+escapeHtml(inst.time)+'</span> ' : ''}${escapeHtml(inst.topic)}</div>
          <div class="cal-chip-status-row"><span class="cal-chip-status">${t('chip.task')} ${escapeHtml(inst.task)}</span></div>
          <div class="cal-chip-status-row">
            <span class="cal-chip-status">${t('chip.current')} ${escapeHtml(inst.currentStatus)}</span>
            ${inst.overdue ? '<span class="cal-chip-overdue-badge">'+t('chip.overdue')+'</span>' : ''}
          </div>
        </div>`).join('')}
      </div>
    </div>`;
  }).join('');

  // Click a chip → jump into that room's card modal. Drag it → move its due date.
  grid.querySelectorAll('.cal-chip').forEach(chip=>{
    chip.addEventListener('click', ()=>{
      const b = BOARDS[chip.dataset.room];
      if(!b) return;
      const card = b.cards.find(c=>c.id===chip.dataset.id);
      if(card) openCardModal(b, card);   // don't silently switch the current room
    });
    chip.addEventListener('dragstart', (e)=>{
      // roomId travels with the payload — chips here come from different rooms.
      e.dataTransfer.setData('text/plain', JSON.stringify({ id: chip.dataset.id, task: chip.dataset.task, roomId: chip.dataset.room }));
      e.dataTransfer.effectAllowed = 'move';
      chip.classList.add('dragging');
    });
    chip.addEventListener('dragend', ()=> chip.classList.remove('dragging'));
  });

  // Click the empty part of a day → create a card on that date. The modal shows
  // a Room picker because the Main Calendar spans every room.
  grid.querySelectorAll('.cal-cell[data-iso]').forEach(cell=>{
    cell.addEventListener('click', (e)=>{
      if(e.target.closest('.cal-chip')) return;
      const room = getCurrentRoom() || rooms[0];
      if(!room) return;
      openCardModal(room, null, null, { presetDate: cell.dataset.iso, allowRoomChange: true });
    });
    cell.addEventListener('dragover', (e)=>{ e.preventDefault(); e.dataTransfer.dropEffect='move'; cell.classList.add('drag-over'); });
    cell.addEventListener('dragleave', ()=> cell.classList.remove('drag-over'));
    cell.addEventListener('drop', (e)=>{
      e.preventDefault();
      cell.classList.remove('drag-over');
      let payload;
      try{ payload = JSON.parse(e.dataTransfer.getData('text/plain')); }catch(err){ return; }
      const room = BOARDS[payload.roomId];
      if(!room) return;
      const card = room.cards.find(c=>c.id===payload.id);
      const newIso = cell.dataset.iso;
      if(card && payload.task && card.dueDates && card.dueDates[payload.task] !== newIso){
        card.dueDates[payload.task] = newIso;
        saveRooms();
        refreshIfVisible(room);      // the room's own pages, if that room is open
        renderMainCalendar();
      }
    });
  });
}

// Called by the auth layer once the app becomes visible.
