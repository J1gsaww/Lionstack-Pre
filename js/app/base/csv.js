"use strict";
/* js/app/base/csv.js
   INTERFACE — CSV export / import (Base App)
   Extracted verbatim from the original app.js (same load order, shared
   global scope). Behaviour is unchanged. */
/* ============================================================
   INTERFACE — CSV export / import.

   Export writes one row per card. Statuses differ between rooms, so the
   sheet carries a `due_<Status>` / `time_<Status>` pair for every status
   found in the exported rooms; a card simply leaves the columns of other
   rooms' statuses blank.

   Import is all-or-nothing. A single bad row aborts the whole file rather
   than writing half a migration — a partially applied import is far harder
   to recover from than a rejected one.

   ============================================================ */
const IF_BASE_COLS = [
  'action','room_id','room_name','card_id','topic','details',
  'status','category','color_mode','custom_color',
  'text_mode','text_color',
  'notify_mode','notify_days','notify_hours'
];
const IF_REQUIRED_COLS = ['room_id','card_id','topic','status'];
const IF_ACTIONS = ['', 'update', 'delete'];

/* ---------------- CSV ---------------- */
function csvEscape(v){
  const s = (v == null) ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s;
}
function toCsv(rows){
  return rows.map(r=> r.map(csvEscape).join(',')).join('\r\n');
}
// RFC 4180-ish: doubled quotes escape a quote, CRLF or LF ends a record.
function parseCsv(text){
  const rows = [];
  let row = [], field = '', i = 0, inQuotes = false;
  while(i < text.length){
    const c = text[i];
    if(inQuotes){
      if(c === '"'){
        if(text[i+1] === '"'){ field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if(c === '"'){ inQuotes = true; i++; continue; }
    if(c === ','){ row.push(field); field = ''; i++; continue; }
    if(c === '\r'){ i++; continue; }
    if(c === '\n'){ row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if(inQuotes) throw new Error('unbalanced-quote');
  if(field.length || row.length){ row.push(field); rows.push(row); }
  return rows;
}

/* ---------------- Export ---------------- */
// Status order follows the rooms, first appearance wins, so a single-room
// export reads exactly like that room's board.
function exportStatusUnion(list){
  const seen = [];
  list.forEach(room=> room.statuses.forEach(s=>{ if(!seen.includes(s)) seen.push(s); }));
  return seen;
}
function exportHeader(statuses){
  const cols = IF_BASE_COLS.slice();
  statuses.forEach(s=>{ cols.push('due_' + s); cols.push('time_' + s); });
  return cols;
}
function buildExportCsv(roomIds){
  const list = roomIds.map(id=> BOARDS[id]).filter(Boolean);
  const statuses = exportStatusUnion(list);
  const header = exportHeader(statuses);
  const rows = [header];

  list.forEach(room=>{
    room.cards.forEach(c=>{
      const rule = c.notify && c.notify.mode === 'custom' ? c.notify : null;
      const base = [
        '',                                   // action — blank means update/create
        room.id, room.name, c.id,
        c.topic || '', c.details || '',
        c.status || '', c.category || '',
        c.colorMode || 'category', c.customColor || '',
        c.textMode === 'custom' ? 'custom' : 'default', c.textColor || '',
        rule ? 'custom' : 'default', rule ? rule.days : '', rule ? rule.hours : ''
      ];
      statuses.forEach(s=>{
        base.push((c.dueDates && c.dueDates[s]) || '');
        base.push((c.dueTimes && c.dueTimes[s]) || '');
      });
      rows.push(base);
    });
  });
  return { csv: toCsv(rows), count: rows.length - 1 };
}
// The BOM is what makes Excel read the Thai text as UTF-8 instead of mojibake.
// It must NOT go on the JSON file: JSON.parse chokes on a leading \uFEFF.
function downloadCsv(filename, csv){
  downloadFile(filename, '\uFEFF' + csv, 'text/csv;charset=utf-8;');
}
function downloadFile(filename, text, mime){
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(()=> URL.revokeObjectURL(url), 0);
}

/* ---------------- Validation helpers ---------------- */
function isIsoDate(s){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y,m,d] = s.split('-').map(Number);
  if(m < 1 || m > 12 || d < 1) return false;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();   // last day of month m
  return d <= dim;                                        // rejects 2026-02-31
}
function isHhMm(s){ return /^([01]\d|2[0-3]):[0-5]\d$/.test(s); }
function isHexColor(s){ return /^#[0-9a-fA-F]{6}$/.test(s); }

/* ---------------- JSON: full backup ----------------
   CSV carries cards and nothing else — not notes, not the Status/Category
   config that gives those cards meaning. Re-importing a CSV into an empty app
   would land every card on statuses that do not exist. JSON is the format that
   can actually restore this app, so it is a replace, not a merge: merging two
   room lists means reconciling two sets of Status names, and there is no answer
   to that which is not a guess.
   ---------------------------------------------------------------- */
const JSON_SCHEMA = 1;

function buildExportJson(){
  return JSON.stringify({
    app: 'task-management',
    schema: JSON_SCHEMA,
    exportedAt: new Date().toISOString(),
    rooms: rooms.map(roomToStored),
    globalNotes,
    settings: {
      lang: currentLang,
      timezone: loadTimezone(),
      theme: currentThemeId,
      themeMode,
      customSeeds: customTheme().seeds,
      ink: inkSettings,
      notify: notifySettings,
      home: homeSettings,
      logoStyle: loadLogoStyle(),
      logo: loadLogo() || ''
    },
    modules: collectModuleBackups()
  }, null, 2);
}

// Never mutates. Mirrors validateImport(): one fatal, or a list of errors that
// each name their path in the file.
function validateImportJson(text, fileName){
  const out = { kind:'json', fatal:null, errors:[], warnings:[], data:null, summary:{ rooms:0, cards:0, notes:0 } };
  const err = (msg)=> out.errors.push({ row: '—', msg });   // the table prints e.row

  let doc;
  try{ doc = JSON.parse(String(text).replace(/^\uFEFF/, '')); }
  catch(e){ out.fatal = t('if.err.jsonParse'); return out; }

  if(!doc || typeof doc !== 'object' || Array.isArray(doc)){ out.fatal = t('if.err.jsonShape'); return out; }
  if(doc.app !== 'task-management'){ out.fatal = t('if.err.jsonApp', { t: String(doc.app || '—') }); return out; }
  if(!Number.isInteger(doc.schema) || doc.schema > JSON_SCHEMA){ out.fatal = t('if.err.jsonSchema', { t: String(doc.schema) }); return out; }
  if(!Array.isArray(doc.rooms) || doc.rooms.length === 0){ out.fatal = t('if.err.jsonNoRooms'); return out; }

  const seenRoomIds = new Set();
  let cardCount = 0, noteCount = 0, completeMissing = 0;

  doc.rooms.forEach((r, ri)=>{
    const at = (extra)=> `rooms[${ri}]${extra || ''}`;
    if(!r || typeof r !== 'object'){ err(t('if.err.jsonRoom', { at: at() })); return; }
    if(typeof r.id !== 'string' || !r.id){ err(t('if.err.jsonField', { at: at('.id') })); return; }
    if(seenRoomIds.has(r.id)){ err(t('if.err.jsonDupRoom', { at: at('.id'), t: r.id })); return; }
    seenRoomIds.add(r.id);
    if(typeof r.name !== 'string' || !r.name.trim()) err(t('if.err.jsonField', { at: at('.name') }));

    if(!Array.isArray(r.statusConfig) || !r.statusConfig.length){ err(t('if.err.jsonField', { at: at('.statusConfig') })); return; }
    const statuses = [];
    r.statusConfig.forEach((st, si)=>{
      const sat = at(`.statusConfig[${si}]`);
      if(!st || typeof st.name !== 'string' || !st.name.trim()){ err(t('if.err.jsonField', { at: sat + '.name' })); return; }
      if(!isHexColor(st.color || '')) err(t('if.err.jsonColor', { at: sat + '.color', t: String(st.color) }));
      if(statuses.includes(st.name)) err(t('if.err.jsonDup', { at: sat + '.name', t: st.name }));
      statuses.push(st.name);
    });
    if(!r.statusConfig.some(st=> st && st.isComplete)){ completeMissing++; err(t('if.err.jsonNoComplete', { at: at() })); }

    const categories = [];
    if(r.categoryConfig != null){
      if(!Array.isArray(r.categoryConfig)) err(t('if.err.jsonField', { at: at('.categoryConfig') }));
      else r.categoryConfig.forEach((c, ci)=>{
        const cat = at(`.categoryConfig[${ci}]`);
        if(!c || typeof c.name !== 'string' || !c.name.trim()){ err(t('if.err.jsonField', { at: cat + '.name' })); return; }
        if(!isHexColor(c.color || '')) err(t('if.err.jsonColor', { at: cat + '.color', t: String(c.color) }));
        categories.push(c.name);
      });
    }

    if(!Array.isArray(r.cards)){ err(t('if.err.jsonField', { at: at('.cards') })); return; }
    const seenCardIds = new Set();
    r.cards.forEach((c, ci)=>{
      const cat = at(`.cards[${ci}]`);
      if(!c || typeof c !== 'object'){ err(t('if.err.jsonField', { at: cat })); return; }
      if(typeof c.id !== 'string' || !c.id){ err(t('if.err.jsonField', { at: cat + '.id' })); return; }
      if(seenCardIds.has(c.id)) err(t('if.err.jsonDup', { at: cat + '.id', t: c.id }));
      seenCardIds.add(c.id);
      if(typeof c.topic !== 'string' || !c.topic.trim()) err(t('if.err.jsonField', { at: cat + '.topic' }));
      if(!statuses.includes(c.status)) err(t('if.err.jsonStatus', { at: cat + '.status', t: String(c.status) }));
      if(c.category && !categories.includes(c.category)) err(t('if.err.jsonCategory', { at: cat + '.category', t: String(c.category) }));
      if(c.colorMode && !['category','status','custom'].includes(c.colorMode)) err(t('if.err.jsonEnum', { at: cat + '.colorMode', t: String(c.colorMode) }));
      if(c.colorMode === 'custom' && !isHexColor(c.customColor || '')) err(t('if.err.jsonColor', { at: cat + '.customColor', t: String(c.customColor) }));
      if(c.textMode && c.textMode !== 'custom') err(t('if.err.jsonEnum', { at: cat + '.textMode', t: String(c.textMode) }));
      if(c.textMode === 'custom' && !isHexColor(c.textColor || '')) err(t('if.err.jsonColor', { at: cat + '.textColor', t: String(c.textColor) }));

      Object.keys(c.dueDates || {}).forEach(k=>{
        if(!statuses.includes(k)) err(t('if.err.jsonStatus', { at: cat + '.dueDates', t: k }));
        else if(!isIsoDate(c.dueDates[k])) err(t('if.err.jsonDate', { at: `${cat}.dueDates["${k}"]`, t: String(c.dueDates[k]) }));
      });
      Object.keys(c.dueTimes || {}).forEach(k=>{
        if(!statuses.includes(k)) err(t('if.err.jsonStatus', { at: cat + '.dueTimes', t: k }));
        else if(!isHhMm(c.dueTimes[k])) err(t('if.err.jsonTime', { at: `${cat}.dueTimes["${k}"]`, t: String(c.dueTimes[k]) }));
      });
      if(c.notify != null){
        const n = c.notify;
        if(!n || n.mode !== 'custom' || !Number.isFinite(n.days) || !Number.isFinite(n.hours)){
          err(t('if.err.jsonField', { at: cat + '.notify' }));
        }
      }
      cardCount++;
    });

    if(r.notes != null && !Array.isArray(r.notes)) err(t('if.err.jsonField', { at: at('.notes') }));
    else noteCount += (r.notes || []).length;
  });

  if(doc.globalNotes != null && !Array.isArray(doc.globalNotes)) err(t('if.err.jsonField', { at: 'globalNotes' }));
  else noteCount += (doc.globalNotes || []).length;

  if(doc.schema < JSON_SCHEMA) out.warnings.push({ msg: t('if.warn.jsonOldSchema', { t: String(doc.schema) }) });
  if(!doc.settings) out.warnings.push({ msg: t('if.warn.jsonNoSettings') });

  out.data = doc;
  out.summary = { rooms: doc.rooms.length, cards: cardCount, notes: noteCount };
  return out;
}

function applyImportJson(result, withSettings){
  const doc = result.data;
  rooms = doc.rooms.map(normalizeStoredRoom);
  globalNotes = Array.isArray(doc.globalNotes) ? doc.globalNotes : [];
  currentRoomId = null;                 // rebuildBoards() re-picks the first room
  settingRoomId = null;
  saveRooms();
  saveGlobalNotes();
  // Before any setting is touched: applyLanguage() and applyTheme() repaint the
  // surfaces, and progressHtml() reads room.colors — a field only rebuildBoards()
  // puts there. Repainting first crashes on the freshly-parsed, underived rooms.
  rebuildBoards();

  const st = doc.settings;
  if(withSettings && st){
    if(st.home && typeof st.home === 'object'){ homeSettings = st.home; saveHomeSettings(); }
    if(st.notify && Number.isFinite(st.notify.days)){ notifySettings = st.notify; saveNotifySettings(); }
    if(typeof st.timezone === 'string') saveTimezone(st.timezone);
    if(st.ink && INK_MODES.includes(st.ink.mode)){ inkSettings = st.ink; saveInkSettings(); }
    if(st.customSeeds) { customTheme().seeds = st.customSeeds; saveCustomSeeds(); }
    if(THEME_MODES.includes(st.themeMode)){ themeMode = st.themeMode; saveThemeMode(); }
    if(typeof st.logoStyle === 'string') saveLogoStyle(st.logoStyle === 'original' ? 'original' : 'white');
    if(typeof st.logo === 'string'){ st.logo ? saveLogo(st.logo) : clearLogo(); }
    if(typeof st.theme === 'string') applyTheme(st.theme);
    applyLogo();
    if(st.lang === 'th' || st.lang === 'en') applyLanguage(st.lang);
  }else{
    homeSettings = { featured:null, modes:{} };
    saveHomeSettings();
  }

  // Module data rides in doc.modules; each registered module claims its slice.
  applyModuleBackups(doc.modules);
}

/* ---------------- Import ---------------- */
// Which cells of the row disagree with the stored card. Only *filled* cells
// are compared: a blank cell is "don't care", so a hand-written delete row can
// carry just a topic while an exported row matches on everything it carries.
function rowCardMismatches(card, room, get, has, dueCols, timeCols){
  const out = [];
  const cmp = (field, fileVal, storedVal, ci)=>{
    if(!has(field) || fileVal === '') return;              // blank = wildcard
    const a = ci ? fileVal.toLowerCase() : fileVal;
    const b = ci ? String(storedVal).toLowerCase() : String(storedVal);
    if(a !== b) out.push({ field, file: fileVal, stored: storedVal === '' ? '—' : storedVal });
  };
  const rule = (card.notify && card.notify.mode === 'custom') ? card.notify : null;

  cmp('topic',        get('topic'),        card.topic || '');
  cmp('details',      get('details'),      card.details || '');
  cmp('status',       get('status'),       card.status || '');
  cmp('category',     get('category'),     card.category || '');
  cmp('color_mode',   get('color_mode'),   card.colorMode || 'category', true);
  cmp('custom_color', get('custom_color'), card.customColor || '', true);
  cmp('text_mode',    get('text_mode'),    card.textMode === 'custom' ? 'custom' : 'default', true);
  cmp('text_color',   get('text_color'),   card.textColor || '', true);
  cmp('notify_mode',  get('notify_mode'),  rule ? 'custom' : 'default', true);
  cmp('notify_days',  get('notify_days'),  rule ? String(rule.days) : '');
  cmp('notify_hours', get('notify_hours'), rule ? String(rule.hours) : '');

  dueCols.forEach(st=>  cmp('due_'  + st, get('due_'  + st), (card.dueDates || {})[st] || ''));
  timeCols.forEach(st=> cmp('time_' + st, get('time_' + st), (card.dueTimes || {})[st] || ''));
  return out;
}
function mismatchLabel(list){
  const head = list.slice(0,3).map(m=> `${m.field} (${t('if.mm.file')}: ${m.file} · ${t('if.mm.stored')}: ${m.stored})`);
  return head.join(' · ') + (list.length > 3 ? ' …' : '');
}

// Returns { fatal, errors, warnings, changes, summary } — never mutates data.
function validateImport(text, fileName){
  const out = { fatal:null, errors:[], warnings:[], changes:[], summary:{ create:0, update:0, delete:0 } };

  if(/\.xlsx?$/i.test(fileName || '') || text.slice(0,2) === 'PK'){
    out.fatal = t('if.err.xlsx'); return out;
  }
  if(text.charCodeAt(0) === 0xFEFF) text = text.slice(1);   // strip BOM Excel adds
  if(!text.trim()){ out.fatal = t('if.err.empty'); return out; }

  let rows;
  try{ rows = parseCsv(text); }
  catch(e){ out.fatal = t('if.err.quote'); return out; }

  if(rows.length < 2){ out.fatal = t('if.err.noRows'); return out; }

  const header = rows[0].map(h=> h.trim());
  const missing = IF_REQUIRED_COLS.filter(c=> !header.includes(c));
  if(missing.length){ out.fatal = t('if.err.header', { t: missing.join(', ') }); return out; }

  const idx = {};
  header.forEach((h,i)=>{ if(!(h in idx)) idx[h] = i; });
  const dueCols  = header.filter(h=> h.startsWith('due_')).map(h=> h.slice(4));
  const timeCols = header.filter(h=> h.startsWith('time_')).map(h=> h.slice(5));
  const hasDueCols = dueCols.length > 0;

  const unknown = header.filter(h=> h && !IF_BASE_COLS.includes(h) && !h.startsWith('due_') && !h.startsWith('time_'));
  if(unknown.length) out.warnings.push(t('if.warn.unknownCols', { t: unknown.join(', ') }));

  // Every row that touches an existing card claims it. Two rows claiming the
  // same card (update+delete, or two topic-matched deletes) is a conflict, not
  // something to resolve by file order.
  const targeted = new Map();
  const has = c => c in idx;
  const get = (row, c) => has(c) ? String(row[idx[c]] ?? '').trim() : '';

  for(let r = 1; r < rows.length; r++){
    const row = rows[r];
    const sheetRow = r + 1;                       // what Excel shows in the gutter
    const err = m => out.errors.push({ row: sheetRow, msg: m });

    if(row.length === 1 && row[0].trim() === '') continue;   // blank line
    if(row.length !== header.length){
      err(t('if.err.cols', { n: row.length, m: header.length }));
      continue;
    }

    const action = get(row,'action').toLowerCase();
    if(!IF_ACTIONS.includes(action)){ err(t('if.err.action', { t: get(row,'action') })); continue; }

    const roomId = get(row,'room_id');
    const room = BOARDS[roomId];
    if(!room){ err(t('if.err.room', { t: roomId || '—' })); continue; }
    const roomName = get(row,'room_name');
    if(roomName && roomName !== room.name) out.warnings.push(t('if.warn.roomName', { r: sheetRow, a: roomName, b: room.name }));

    const cardId = get(row,'card_id');
    let existing = null;
    if(cardId){
      existing = room.cards.find(c=> c.id === cardId) || null;
      if(!existing){
        const elsewhere = rooms.find(x=> x.cards.some(c=> c.id === cardId));
        if(elsewhere){ err(t('if.err.cardOtherRoom', { t: cardId, r: elsewhere.name })); continue; }
        if(action === 'delete'){ err(t('if.err.delNoMatch', { t: cardId })); continue; }
        err(t('if.err.cardNotFound', { t: cardId })); continue;
      }
    }

    // Both branches below resolve to a card; claiming it twice is an error.
    const claim = (id, label)=>{
      const prev = targeted.get(id);
      if(prev){ err(t('if.err.dupTarget', { t: label, a: prev.row, b: sheetRow })); return false; }
      targeted.set(id, { row: sheetRow, action });
      return true;
    };
    const rowGet = c => get(row, c);

    /* ----- delete ----- */
    if(action === 'delete'){
      const topic = get(row,'topic');
      if(existing){
        // The row names a card. Every cell it filled in must agree with what is
        // stored, otherwise this is the wrong file or a hand-typed id.
        const mm = rowCardMismatches(existing, room, rowGet, has, dueCols, timeCols);
        if(mm.length){ err(t('if.err.delFieldMismatch', { t: mismatchLabel(mm) })); continue; }
      }else{
        if(!cardId && topic === ''){ err(t('if.err.delNeedKey')); continue; }
        // No id: the row's own data is the key. Matching on every filled cell
        // lets two cards that share a topic still be told apart.
        const hits = room.cards.filter(c=> rowCardMismatches(c, room, rowGet, has, dueCols, timeCols).length === 0);
        if(hits.length === 0){ err(t('if.err.delNoMatch', { t: topic || cardId })); continue; }
        if(hits.length > 1){ err(t('if.err.delAmbiguous', { t: topic, n: hits.length })); continue; }
        existing = hits[0];
      }
      if(!claim(existing.id, existing.topic)) continue;
      out.changes.push({ row: sheetRow, action:'delete', roomId: room.id, cardId: existing.id });
      out.summary.delete++;
      continue;
    }
    if(existing && !claim(existing.id, existing.topic)) continue;

    /* ----- create / update ----- */
    const isCreate = !existing;
    const patch = {};

    const topic = get(row,'topic');
    if(isCreate || has('topic')){
      if(!topic){ err(t('if.err.topic')); continue; }
      patch.topic = topic;
    }
    if(has('details')) patch.details = get(row,'details');

    const status = get(row,'status');
    if(isCreate || (has('status') && status !== '')){
      if(!room.statuses.includes(status)){ err(t('if.err.status', { t: status || '—', r: room.name })); continue; }
      patch.status = status;
    }
    const category = get(row,'category');
    if(has('category') && category !== ''){
      if(!room.categoryOptions.includes(category)){ err(t('if.err.category', { t: category, r: room.name })); continue; }
      patch.category = category;
    }else if(isCreate){
      patch.category = room.categoryOptions[0];
    }

    if(has('color_mode')){
      const cm = get(row,'color_mode').toLowerCase();
      if(cm !== ''){
        if(!['category','status','custom'].includes(cm)){ err(t('if.err.colorMode', { t: cm })); continue; }
        patch.colorMode = cm;
        if(cm === 'custom'){
          const cc = get(row,'custom_color');
          if(!isHexColor(cc)){ err(t('if.err.customColor', { t: cc || '—' })); continue; }
          patch.customColor = cc.toUpperCase();
        }
      }
    }

    if(has('text_mode')){
      const tm = get(row,'text_mode').toLowerCase();
      if(tm !== '' && !['default','custom'].includes(tm)){ err(t('if.err.textMode', { t: tm })); continue; }
      if(tm === 'custom'){
        const tc = get(row,'text_color');
        if(!isHexColor(tc)){ err(t('if.err.textColor', { t: tc || '—' })); continue; }
        patch.textMode = 'custom';
        patch.textColor = tc.toUpperCase();
      }else if(tm === 'default'){
        patch.textMode = null;   // drop the override
      }
    }

    if(has('notify_mode')){
      const nm = get(row,'notify_mode').toLowerCase();
      if(nm !== '' && !['default','custom'].includes(nm)){ err(t('if.err.notifyMode', { t: nm })); continue; }
      if(nm === 'custom'){
        const nd = Number(get(row,'notify_days')), nh = Number(get(row,'notify_hours'));
        if(!NOTIFY_VALUES.includes(nd) || !NOTIFY_VALUES.includes(nh)){
          err(t('if.err.notifyValue', { t: get(row,'notify_days') + '/' + get(row,'notify_hours') })); continue;
        }
        patch.notify = { mode:'custom', days:nd, hours:nh };
      }else if(nm === 'default'){
        patch.notify = null;   // drop the override
      }
    }

    /* ----- dates ----- */
    // Only touch dates if the sheet actually carries date columns; a trimmed
    // export must not silently wipe every deadline.
    if(hasDueCols){
      const dueDates = {}, dueTimes = {};
      let rowFailed = false;

      for(const s of dueCols){
        const v = get(row, 'due_' + s);
        if(v === '') continue;
        if(!room.statuses.includes(s)){ err(t('if.err.dueForeignStatus', { t: s, r: room.name })); rowFailed = true; break; }
        if(!isIsoDate(v)){ err(t('if.err.date', { c: 'due_' + s, t: v })); rowFailed = true; break; }
        dueDates[s] = v;
      }
      if(rowFailed) continue;

      for(const s of timeCols){
        const v = get(row, 'time_' + s);
        if(v === '') continue;
        if(!isHhMm(v)){ err(t('if.err.time', { c: 'time_' + s, t: v })); rowFailed = true; break; }
        if(!dueDates[s]){ err(t('if.err.timeNoDate', { t: s })); rowFailed = true; break; }
        dueTimes[s] = v;
      }
      if(rowFailed) continue;

      if(!dueDates[room.completeStatus]){
        err(t('if.err.completeDue', { t: room.completeStatus })); continue;
      }
      patch.dueDates = dueDates;
      patch.dueTimes = dueTimes;
    }else if(isCreate){
      err(t('if.err.noDueCols', { t: room.completeStatus })); continue;
    }

    out.changes.push({ row: sheetRow, action: isCreate ? 'create' : 'update', roomId: room.id, cardId: cardId || null, patch });
    if(isCreate) out.summary.create++; else out.summary.update++;
  }

  return out;
}

// Only ever called when validateImport() came back clean.
function applyImport(result){
  result.changes.forEach(ch=>{
    const room = BOARDS[ch.roomId];
    if(!room) return;
    if(ch.action === 'delete'){
      room.cards = room.cards.filter(c=> c.id !== ch.cardId);
      return;
    }
    if(ch.action === 'create'){
      const card = { id: cardUid(), details:'', dueDates:{}, dueTimes:{}, colorMode:'category', ...ch.patch };
      if(card.notify === null) delete card.notify;
      if(card.textMode === null){ delete card.textMode; delete card.textColor; }
      room.cards.push(card);
      return;
    }
    const card = room.cards.find(c=> c.id === ch.cardId);
    if(!card) return;
    Object.keys(ch.patch).forEach(k=>{
      if(k === 'notify' && ch.patch[k] === null) delete card.notify;
      else if(k === 'textMode' && ch.patch[k] === null){ delete card.textMode; delete card.textColor; }
      else card[k] = ch.patch[k];
    });
  });
  saveRooms();
  rooms = loadRooms();
  rebuildBoards();
}


/* ---------------- Storage bar ----------------
   Reads through Store.usage(), the async face — so this is the first real
   consumer proving the adapter works. When the backend becomes Firebase, the
   bar reflows to whatever unit/limit usage() returns without changes here. */

/* ---------------- Ink setting UI ---------------- */
function renderInkSetting(){
  const wrap = document.getElementById('inkModeToggle');
  if(!wrap) return;
  wrap.innerHTML = INK_MODES.map(m=>
    `<button type="button" class="ink-mode-btn ${m === inkSettings.mode ? 'active' : ''}" data-ink="${m}">${escapeHtml(t('ink.mode.' + m))}</button>`
  ).join('');
  wrap.querySelectorAll('.ink-mode-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      if(btn.dataset.ink === inkSettings.mode) return;
      inkSettings.mode = btn.dataset.ink;
      saveInkSettings();
      renderInkSetting();
      refreshAllSurfaces();     // ink is baked into inline styles at paint time
    });
  });

  const picker = document.getElementById('inkCustomWrap');
  if(picker) picker.style.display = (inkSettings.mode === 'custom') ? 'flex' : 'none';
  const input = document.getElementById('inkCustomColor');
  if(input) input.value = inkSettings.color;

  renderInkPreview();
}

function renderInkPreview(){
  const box = document.getElementById('inkPreview');
  if(!box) return;
  const audit = inkAudit();
  if(!audit.length){ box.innerHTML = ''; return; }

  const swatches = audit.slice(0, 12).map(a=>
    `<span class="pill" style="background:${a.color}; color:${a.ink}">${escapeHtml(a.name)}</span>`
  ).join('');

  const weak = audit.filter(a=> a.ratio < 4.5);
  const warn = weak.length
    ? `<p class="ink-warn">${escapeHtml(t('ink.warn', { n: weak.length }))}<br>` +
      weak.slice(0, 6).map(a=> `${escapeHtml(a.name)} ${a.color} — ${a.ratio.toFixed(2)}:1`).join(' · ') +
      (weak.length > 6 ? ' …' : '') + '</p>'
    : `<p class="ink-ok">${escapeHtml(t('ink.ok'))}</p>`;

  box.innerHTML = `<div class="ink-swatches">${swatches}</div>${warn}`;
}

/* ---------------- Interface page ---------------- */
let importResult = null;   // held between "validate" and "apply"

function refreshAllSurfaces(){
  renderSidebar();
  if(!currentView) return;
  if(currentView.type === 'home')        renderHomePage();
  else if(currentView.type === 'maincal') renderMainCalendar();
  else if(currentView.type === 'notify')  renderNotificationPage();
  else if(currentView.type === 'room'){
    const r = getCurrentRoom();
    if(r) refreshBoard(r);
  }
  runNotificationScan({ announceDays:false });
}

function doExportJson(){
  const safe = 'backup';
  downloadFile(`task-management-${safe}-${localIso()}.json`, buildExportJson(), 'application/json;charset=utf-8;');
  const note = document.getElementById('exportNote');
  if(note) note.textContent = t('if.export.jsonDone', { r: rooms.length });
}

function renderExportRooms(){
  const sel = document.getElementById('exportRoom');
  if(!sel) return;
  const wanted = sel.value;
  sel.innerHTML = `<option value="__all__">${escapeHtml(t('if.export.all'))}</option>` +
    rooms.map(r=>`<option value="${r.id}">${escapeHtml(roomLabel(r))}</option>`).join('');
  sel.value = (wanted && (wanted === '__all__' || BOARDS[wanted])) ? wanted : '__all__';
}

function doExport(){
  const sel = document.getElementById('exportRoom');
  const which = sel ? sel.value : '__all__';
  const ids = (which === '__all__') ? rooms.map(r=> r.id) : [which];
  if(!ids.length){ alert(t('if.err.nothingToExport')); return; }

  const { csv, count } = buildExportCsv(ids);
  const label = (which === '__all__') ? 'all' : (BOARDS[which] ? BOARDS[which].name : which);
  const safe = String(label).replace(/[^\w\u0E00-\u0E7F-]+/g,'-').slice(0,40) || 'room';
  downloadCsv(`task-management-${safe}-${localIso()}.csv`, csv);

  const note = document.getElementById('exportNote');
  if(note) note.textContent = t('if.export.done', { n: count });
}

function summaryChip(kind, n){
  return `<span class="if-chip if-chip-${kind}">${escapeHtml(t('if.chip.' + kind))} <b>${n}</b></span>`;
}

function doImportJsonApply(){
  const r = importResult, s = r.summary;
  const oldCards = rooms.reduce((n,x)=> n + x.cards.length, 0);
  if(!confirm(t('if.json.confirm', { or: rooms.length, oc: oldCards, nr: s.rooms, nc: s.cards }))) return;

  const withSettings = !!(document.getElementById('importSettings') || {}).checked;
  const snap = snapshotData();
  applyImportJson(r, withSettings);

  importResult = null;
  const input = document.getElementById('importFile');
  if(input) input.value = '';
  const wrap = document.getElementById('importSettingsWrap');
  if(wrap) wrap.style.display = 'none';
  renderImportReport();
  const note = document.getElementById('importNote');
  if(note) note.textContent = t('if.json.applied', { r: s.rooms, c: s.cards });

  navigateTo({ type:'home' });   // the room we were standing in may be gone
  renderExportRooms();
  offerUndo(t('undo.json', { r: s.rooms, c: s.cards }), snap);
}

function renderImportReport(){
  const wrap = document.getElementById('importReport');
  const applyBtn = document.getElementById('importApply');
  if(!wrap) return;

  if(!importResult){ wrap.innerHTML = ''; if(applyBtn) applyBtn.disabled = true; return; }
  const r = importResult;

  if(r.fatal){
    wrap.innerHTML = `<div class="if-fatal">${escapeHtml(r.fatal)}</div>`;
    if(applyBtn) applyBtn.disabled = true;
    return;
  }

  const s = r.summary;
  const isJson = (r.kind === 'json');
  const settingsWrap = document.getElementById('importSettingsWrap');
  if(settingsWrap) settingsWrap.style.display = isJson && !r.errors.length ? 'flex' : 'none';

  let html = isJson
    ? `<div class="if-summary">
         ${summaryChip('rooms', s.rooms)}${summaryChip('cards', s.cards)}${summaryChip('notes', s.notes)}
         ${summaryChip('error', r.errors.length)}
       </div>
       ${r.errors.length ? '' : `<div class="if-replace">${escapeHtml(t('if.json.replace', { r: rooms.length, c: rooms.reduce((n,x)=>n+x.cards.length,0) }))}</div>`}`
    : `<div class="if-summary">
         ${summaryChip('create', s.create)}${summaryChip('update', s.update)}${summaryChip('delete', s.delete)}
         ${summaryChip('error', r.errors.length)}
       </div>`;

  if(r.errors.length){
    html += `<div class="if-block">
      <div class="if-block-head">${escapeHtml(t('if.report.errors'))}</div>
      <table class="if-table"><thead><tr>
        <th>${escapeHtml(t('if.report.row'))}</th><th>${escapeHtml(t('if.report.problem'))}</th>
      </tr></thead><tbody>
      ${r.errors.slice(0,50).map(e=>`<tr><td class="if-row-no">${e.row}</td><td>${escapeHtml(e.msg)}</td></tr>`).join('')}
      </tbody></table>
      ${r.errors.length > 50 ? '<div class="if-more">' + escapeHtml(t('if.report.more',{n:r.errors.length-50})) + '</div>' : ''}
      <div class="if-abort">${escapeHtml(t('if.report.abort'))}</div>
    </div>`;
  }

  if(r.warnings.length){
    html += `<div class="if-block">
      <div class="if-block-head">${escapeHtml(t('if.report.warnings'))}</div>
      <ul class="if-warn-list">${r.warnings.slice(0,20).map(w=>`<li>${escapeHtml(w)}</li>`).join('')}</ul>
    </div>`;
  }

  if(!r.errors.length && r.changes.length === 0){
    html += `<div class="if-fatal">${escapeHtml(t('if.err.noChanges'))}</div>`;
  }

  wrap.innerHTML = html;
  if(applyBtn) applyBtn.disabled = !!r.errors.length || r.changes.length === 0;
}

function handleImportFile(file){
  const applyBtn = document.getElementById('importApply');
  if(applyBtn) applyBtn.disabled = true;
  importResult = null;

  const nameEl = document.getElementById('importFileName');
  if(nameEl) nameEl.textContent = file ? file.name : t('if.noFile');
  if(!file){ renderImportReport(); return; }
  if(!/\.(csv|txt|xlsx?|json)$/i.test(file.name)){
    importResult = { fatal: t('if.err.fileType', { t: file.name }), errors:[], warnings:[], changes:[], summary:{create:0,update:0,delete:0} };
    renderImportReport(); return;
  }
  const isJson = /\.json$/i.test(file.name);

  const reader = new FileReader();
  reader.onerror = ()=>{
    importResult = { fatal: t('if.err.read'), errors:[], warnings:[], changes:[], summary:{create:0,update:0,delete:0} };
    renderImportReport();
  };
  reader.onload = ()=>{
    try{
      importResult = isJson
        ? validateImportJson(String(reader.result || ''), file.name)
        : validateImport(String(reader.result || ''), file.name);
    }catch(e){
      logAppError('ตรวจไฟล์นำเข้าไม่สำเร็จ', e);
      importResult = { fatal: t('if.err.parse'), errors:[], warnings:[], changes:[], summary:{create:0,update:0,delete:0} };
    }
    renderImportReport();
  };
  reader.readAsText(file, 'UTF-8');
}

function doImportApply(){
  if(!importResult || importResult.fatal || importResult.errors.length) return;

  if(importResult.kind === 'json'){ doImportJsonApply(); return; }
  if(!importResult.changes.length) return;
  const s = importResult.summary;
  if(!confirm(t('if.confirm', { c:s.create, u:s.update, d:s.delete }))) return;

  const snap = snapshotData();
  applyImport(importResult);
  const done = t('if.applied', { c:s.create, u:s.update, d:s.delete });

  importResult = null;
  const input = document.getElementById('importFile');
  if(input) input.value = '';
  renderImportReport();
  const note = document.getElementById('importNote');
  if(note) note.textContent = done;

  refreshAllSurfaces();
  renderExportRooms();
  offerUndo(t('undo.import', { c:s.create, u:s.update, d:s.delete }), snap);
}

// Each module may expose a dataTools box for the Interface page: its own
// Export/Import controls (CSV + JSON of its data). Base App never names any
// module here — it just walks whatever registered. No module = no box.
function renderModuleDataTools(){
  const host = document.getElementById('moduleDataTools');
  if(!host) return;
  host.innerHTML = '';
  MODULES.forEach(m=>{
    if(!m.dataTools || typeof m.dataTools.render !== 'function') return;
    const section = document.createElement('div');
    section.className = 'panel settings-panel module-data-box';
    try{
      section.innerHTML = m.dataTools.render();   // module returns its box HTML
      host.appendChild(section);
      if(typeof m.dataTools.bind === 'function') m.dataTools.bind(section);
    }catch(e){ logAppError('module dataTools ล้มเหลว: ' + m.id, e); }
  });
}

function renderInterfacePage(){
  renderModuleDataTools();
  if(STORE_ONLY){
    // Store-only: the kanban card CSV/JSON panel is hidden — only the module
    // backup boxes are shown.
    const kp = document.getElementById('ifKanbanPanel');
    if(kp) kp.style.display = 'none';
    const crumb = document.querySelector('#page-interface .crumb');
    if(crumb) crumb.textContent = t('if.crumbStore');
    return;
  }
  renderExportRooms();
  const en = document.getElementById('exportNote');
  if(en) en.textContent = '';
  const inn = document.getElementById('importNote');
  if(inn && !importResult) inn.textContent = '';
  const cols = document.getElementById('ifColumnHint');
  if(cols) cols.textContent = t('if.columns', { t: IF_REQUIRED_COLS.join(', ') });
  renderImportReport();
}

/* ---------------- Time zone setting ---------------- */
// A curated fallback for engines without Intl.supportedValuesOf (ES2022).
const TZ_FALLBACK = [
  'Asia/Bangkok','Asia/Jakarta','Asia/Singapore','Asia/Kuala_Lumpur','Asia/Ho_Chi_Minh',
  'Asia/Manila','Asia/Hong_Kong','Asia/Shanghai','Asia/Taipei','Asia/Tokyo','Asia/Seoul',
  'Asia/Kolkata','Asia/Dubai','Europe/London','Europe/Paris','Europe/Berlin','Europe/Moscow',
  'America/New_York','America/Chicago','America/Denver','America/Los_Angeles','America/Sao_Paulo',
  'Australia/Sydney','Pacific/Auckland','UTC'
];
function timezoneList(){
  let list;
  try{
    list = (typeof Intl.supportedValuesOf === 'function') ? Intl.supportedValuesOf('timeZone') : null;
  }catch(e){ list = null; }
  if(!list || !list.length) list = TZ_FALLBACK.slice();
  // Whatever is currently selected must always be selectable.
  if(!list.includes(appTimezone)) list = [appTimezone, ...list];
  return list;
}

function renderTimezoneSetting(){
  const sel = document.getElementById('settingTimezone');
  if(!sel) return;
  if(sel.options.length === 0 || sel.dataset.built !== '1'){
    sel.innerHTML = timezoneList().map(tz=>`<option value="${escapeHtml(tz)}">${escapeHtml(tz)}</option>`).join('');
    sel.dataset.built = '1';
  }
  sel.value = appTimezone;
  const now = document.getElementById('settingTimezoneNow');
  if(now) now.textContent = t('setting.timezone.now', { t: currentZoneTimeLabel() });
}

// Changing the zone moves "today" and every deadline instant, so every
// time-derived surface has to be recomputed — not just the setting page.
function applyTimezone(tz){
  if(!isValidTimezone(tz)) return;
  appTimezone = tz;
  saveTimezone(tz);
  renderTimezoneSetting();

  const room = getCurrentRoom();
  if(room) refreshIfVisible(room);
  if(currentView && currentView.type === 'home') renderHomePage();
  if(currentView && currentView.type === 'maincal') renderMainCalendar();
  if(currentView && currentView.type === 'notify') renderNotificationPage();
  renderSidebar();                       // the Notification badge is deadline-driven
  runNotificationScan({ announceDays:false });
}

/* ---------------- Notification setting ---------------- */
function renderNotifySetting(){
  document.querySelectorAll('.notify-days-btn').forEach(b=>{
    b.classList.toggle('active', parseInt(b.dataset.notifydays,10) === notifySettings.days);
  });
  document.querySelectorAll('.notify-hours-btn').forEach(b=>{
    b.classList.toggle('active', parseInt(b.dataset.notifyhours,10) === notifySettings.hours);
  });
  const hint = document.getElementById('notifySettingHint');
  if(hint) hint.textContent = t('notify.setting.hint', { d:notifySettings.days, h:notifySettings.hours });
}
function applyNotifySetting(patch){
  notifySettings = { ...notifySettings, ...patch };
  saveNotifySettings();
  renderNotifySetting();
  renderSidebar();                                        // badge count shifts with the window
  if(currentView && currentView.type === 'notify') renderNotificationPage();
  // Widening a window can pull tasks in right away; don't make the user wait
  // for the next tick. The day ring stays silent — it only speaks at launch.
  runNotificationScan({ announceDays:false });
}

/* ---------------- Room picker (Setting) ---------------- */
function renderSettingRoomPicker(){
  const sel = document.getElementById('settingRoomSelect');
  if(!sel) return;
  const room = getSettingRoom();
  sel.innerHTML = rooms.map(r=>`<option value="${r.id}">${escapeHtml(roomLabel(r))}</option>`).join('');
  if(room) sel.value = room.id;
}

/* ---------------- Status ---------------- */
function addStatus(){
  const room = getSettingRoom(); if(!room) return;
  const idx = getCompleteIndex(room);
  room.statusConfig.splice(idx, 0, { name: uniqueName(room.statusConfig, t('status.newName')), color:'#5E958E', isComplete:false });
  saveRooms(); applyRoomDerived(room);
  refreshIfVisible(room); renderStatusEditor();
}
function recolorStatus(index, color){
  const room = getSettingRoom(); if(!room || !room.statusConfig[index]) return;
  room.statusConfig[index].color = color;
  saveRooms(); applyRoomDerived(room); refreshIfVisible(room);
}
function renameStatus(index, rawName){
  const room = getSettingRoom(); if(!room) return;
  const s = room.statusConfig[index]; if(!s) return;
  const newName = String(rawName).trim();
  const oldName = s.name;
  if(!newName){ renderStatusEditor(); return; }
  if(newName === oldName) return;
  if(room.statusConfig.some((x,i)=> i!==index && x.name === newName)){ alert(t('alert.dupStatus')); renderStatusEditor(); return; }
  room.cards.forEach(c=>{
    if(c.status === oldName) c.status = newName;
    if(c.dueDates && c.dueDates[oldName] !== undefined){ c.dueDates[newName] = c.dueDates[oldName]; delete c.dueDates[oldName]; }
    if(c.dueTimes && c.dueTimes[oldName] !== undefined){ c.dueTimes[newName] = c.dueTimes[oldName]; delete c.dueTimes[oldName]; }
  });
  s.name = newName;
  saveRooms(); applyRoomDerived(room); refreshIfVisible(room); renderStatusEditor();
}
function deleteStatus(index){
  const room = getSettingRoom(); if(!room) return;
  const s = room.statusConfig[index]; if(!s) return;
  if(s.isComplete){ alert(t('alert.cantDeleteComplete')); return; }
  const used = room.cards.filter(c=>c.status === s.name).length;
  const msg = used > 0 ? t('confirm.deleteStatusUsed',{n:used,s:s.name}) : t('confirm.deleteStatus',{s:s.name});
  if(!confirm(msg)) return;
  const removedName = s.name;
  room.statusConfig.splice(index, 1);
  applyRoomDerived(room);
  room.cards.forEach(c=>{
    if(!room.statuses.includes(c.status)) c.status = room.statuses[0];
    if(c.dueDates && c.dueDates[removedName] !== undefined) delete c.dueDates[removedName];
    if(c.dueTimes && c.dueTimes[removedName] !== undefined) delete c.dueTimes[removedName];
  });
  saveRooms(); refreshIfVisible(room); renderStatusEditor();
}
let dragFromIndex = null;
function reorderStatus(from, to){
  const room = getSettingRoom(); if(!room) return;
  const cfg = room.statusConfig;
  if(from === null || to === null || from === to) return;
  if(from < 0 || to < 0 || from >= cfg.length || to >= cfg.length) return;
  const [moved] = cfg.splice(from, 1);
  cfg.splice(to, 0, moved);
  saveRooms(); applyRoomDerived(room); refreshIfVisible(room); renderStatusEditor();
}

function renderStatusEditor(){
  const room = getSettingRoom();
  const list = document.getElementById('statusEditorList');
  if(!list || !room) return;
  const statusConfig = room.statusConfig;
  list.innerHTML = statusConfig.map((s,i)=>`
    <div class="status-editor-row" data-index="${i}" draggable="false">
      <span class="status-drag-handle" title="${t('status.dragHandle')}">⠿</span>
      <input type="color" class="status-color-input" value="${s.color}" title="${t('status.color')}">
      <input type="text" class="status-name-input" value="${escapeHtml(s.name)}" maxlength="40">
      ${s.isComplete
        ? '<span class="status-locked" title="'+escapeHtml(t('status.locked.title'))+'">🔒</span>'
        : '<button class="btn-icon status-del-btn" title="'+t('status.delete')+'">🗑️</button>'}
    </div>
  `).join('');

  list.querySelectorAll('.status-color-input').forEach(inp=>{
    inp.addEventListener('input', (e)=>{
      const i = parseInt(e.target.closest('.status-editor-row').dataset.index, 10);
      recolorStatus(i, e.target.value);
    });
  });
  list.querySelectorAll('.status-name-input').forEach(inp=>{
    inp.addEventListener('change', (e)=>{
      const i = parseInt(e.target.closest('.status-editor-row').dataset.index, 10);
      renameStatus(i, e.target.value);
    });
  });
  list.querySelectorAll('.status-del-btn').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      const i = parseInt(e.target.closest('.status-editor-row').dataset.index, 10);
      deleteStatus(i);
    });
  });

  list.querySelectorAll('.status-editor-row').forEach(row=>{
    const handle = row.querySelector('.status-drag-handle');
    handle.addEventListener('mousedown', ()=>{ row.draggable = true; });
    handle.addEventListener('touchstart', ()=>{ row.draggable = true; }, { passive:true });
    row.addEventListener('dragstart', (e)=>{
      dragFromIndex = parseInt(row.dataset.index, 10);
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(dragFromIndex));
    });
    row.addEventListener('dragend', ()=>{
      row.draggable = false;
      row.classList.remove('dragging');
      list.querySelectorAll('.status-editor-row').forEach(r=> r.classList.remove('drag-over'));
    });
    row.addEventListener('dragover', (e)=>{
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      row.classList.add('drag-over');
    });
    row.addEventListener('dragleave', ()=> row.classList.remove('drag-over'));
    row.addEventListener('drop', (e)=>{
      e.preventDefault();
      row.classList.remove('drag-over');
      const to = parseInt(row.dataset.index, 10);
      reorderStatus(dragFromIndex, to);
      dragFromIndex = null;
    });
  });
}

/* ---------------- Category ---------------- */
function addCategory(){
  const room = getSettingRoom(); if(!room) return;
  room.categoryConfig.push({ name: uniqueName(room.categoryConfig, t('category.newName')), color:'#8A7A6E' });
  saveRooms(); applyRoomDerived(room);
  refreshIfVisible(room); renderCategoryEditor();
}
function recolorCategory(index, color){
  const room = getSettingRoom(); if(!room || !room.categoryConfig[index]) return;
  room.categoryConfig[index].color = color;
  saveRooms(); applyRoomDerived(room); refreshIfVisible(room);
}
function renameCategory(index, rawName){
  const room = getSettingRoom(); if(!room) return;
  const c = room.categoryConfig[index]; if(!c) return;
  const newName = String(rawName).trim();
  const oldName = c.name;
  if(!newName){ renderCategoryEditor(); return; }
  if(newName === oldName) return;
  if(room.categoryConfig.some((x,i)=> i!==index && x.name === newName)){ alert(t('alert.dupCategory')); renderCategoryEditor(); return; }
  // Propagate the rename to every card that used it.
  room.cards.forEach(card=>{ if(card.category === oldName) card.category = newName; });
  c.name = newName;
  saveRooms(); applyRoomDerived(room); refreshIfVisible(room); renderCategoryEditor();
}
function deleteCategory(index){
  const room = getSettingRoom(); if(!room) return;
  const c = room.categoryConfig[index]; if(!c) return;
  // Every card carries a category, so one must always survive.
  if(room.categoryConfig.length <= 1){ alert(t('alert.cantDeleteLastCategory')); return; }
  const used = room.cards.filter(x=>x.category === c.name).length;
  const msg = used > 0 ? t('confirm.deleteCategoryUsed',{n:used,s:c.name}) : t('confirm.deleteCategory',{s:c.name});
  if(!confirm(msg)) return;
  room.categoryConfig.splice(index, 1);
  applyRoomDerived(room);
  // Rehome orphaned cards onto the first remaining category.
  room.cards.forEach(card=>{
    if(!room.categoryOptions.includes(card.category)) card.category = room.categoryOptions[0];
  });
  saveRooms(); refreshIfVisible(room); renderCategoryEditor();
}
let catDragFromIndex = null;
function reorderCategory(from, to){
  const room = getSettingRoom(); if(!room) return;
  const cfg = room.categoryConfig;
  if(from === null || to === null || from === to) return;
  if(from < 0 || to < 0 || from >= cfg.length || to >= cfg.length) return;
  const [moved] = cfg.splice(from, 1);
  cfg.splice(to, 0, moved);
  saveRooms(); applyRoomDerived(room); refreshIfVisible(room); renderCategoryEditor();
}

function renderCategoryEditor(){
  const room = getSettingRoom();
  const list = document.getElementById('categoryEditorList');
  if(!list || !room) return;
  const canDelete = room.categoryConfig.length > 1;

  list.innerHTML = room.categoryConfig.map((c,i)=>`
    <div class="category-editor-row" data-index="${i}" draggable="false">
      <span class="status-drag-handle" title="${t('status.dragHandle')}">⠿</span>
      <input type="color" class="status-color-input category-color-input" value="${c.color}" title="${t('status.color')}">
      <input type="text" class="status-name-input category-name-input" value="${escapeHtml(c.name)}" maxlength="40">
      ${canDelete
        ? '<button class="btn-icon category-del-btn" title="'+escapeHtml(t('category.delete'))+'">🗑️</button>'
        : '<span class="status-locked" title="'+escapeHtml(t('alert.cantDeleteLastCategory'))+'">🔒</span>'}
    </div>
  `).join('');

  list.querySelectorAll('.category-color-input').forEach(inp=>{
    inp.addEventListener('input', (e)=>{
      const i = parseInt(e.target.closest('.category-editor-row').dataset.index, 10);
      recolorCategory(i, e.target.value);
    });
  });
  list.querySelectorAll('.category-name-input').forEach(inp=>{
    inp.addEventListener('change', (e)=>{
      const i = parseInt(e.target.closest('.category-editor-row').dataset.index, 10);
      renameCategory(i, e.target.value);
    });
  });
  list.querySelectorAll('.category-del-btn').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      const i = parseInt(e.target.closest('.category-editor-row').dataset.index, 10);
      deleteCategory(i);
    });
  });

  list.querySelectorAll('.category-editor-row').forEach(row=>{
    const handle = row.querySelector('.status-drag-handle');
    handle.addEventListener('mousedown', ()=>{ row.draggable = true; });
    handle.addEventListener('touchstart', ()=>{ row.draggable = true; }, { passive:true });
    row.addEventListener('dragstart', (e)=>{
      catDragFromIndex = parseInt(row.dataset.index, 10);
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(catDragFromIndex));
    });
    row.addEventListener('dragend', ()=>{
      row.draggable = false;
      row.classList.remove('dragging');
      list.querySelectorAll('.category-editor-row').forEach(r=> r.classList.remove('drag-over'));
    });
    row.addEventListener('dragover', (e)=>{
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      row.classList.add('drag-over');
    });
    row.addEventListener('dragleave', ()=> row.classList.remove('drag-over'));
    row.addEventListener('drop', (e)=>{
      e.preventDefault();
      row.classList.remove('drag-over');
      const to = parseInt(row.dataset.index, 10);
      reorderCategory(catDragFromIndex, to);
      catDragFromIndex = null;
    });
  });
}

function getDueDateEligibleStatuses(board){
  return board.statuses.filter(s => !board.excludeDueDateStatuses.includes(s));
}
function getActiveDueDate(card, board){
  return (card.dueDates && card.dueDates[card.status]) || '';
}
// Times are optional metadata stored per status, parallel to dueDates.
// They never affect overdue logic (which is day-based) — only ordering + display.
function getActiveDueTime(card, board){
  return (card.dueTimes && card.dueTimes[card.status]) || '';
}
// Same day → earlier time first; a missing time sinks below any given time.
function compareByDateTime(dateA, timeA, dateB, timeB){
  if(!dateA && !dateB) return 0;
  if(!dateA) return 1;
  if(!dateB) return -1;
  if(dateA !== dateB) return dateA.localeCompare(dateB);
  if(!timeA && !timeB) return 0;
  if(!timeA) return 1;
  if(!timeB) return -1;
  return timeA.localeCompare(timeB);
}
// Chips inside one calendar cell are ordered by time, untimed ones last.
function sortDayInstances(list){
  return [...list].sort((a,b)=>{
    if(!a.time && !b.time) return 0;
    if(!a.time) return 1;
    if(!b.time) return -1;
    return a.time.localeCompare(b.time);
  });
}

let cardEditing = null;

function cardUid(){ return 'card_' + Date.now() + '_' + Math.random().toString(36).slice(2,8); }

function daysUntilDue(dateStr){
  return Math.round((isoToUtcNoon(dateStr) - isoToUtcNoon(localIso())) / 86400000);
}

