"use strict";
/* js/app/core/theme.js
   SETTING TABS + THEME / INK / PALETTE
   Extracted verbatim from the original app.js (same load order, shared
   global scope). Behaviour is unchanged. */
/* ---------------- Setting page tabs ---------------- */
const SETTING_TABS = ['app','rooms','notify','theme'];
let settingTab = 'app';   // remembered for the session

function showSettingTab(tab){
  settingTab = SETTING_TABS.includes(tab) ? tab : 'app';
  SETTING_TABS.forEach(k=>{
    const pane = document.getElementById('setting-tab-' + k);
    if(pane) pane.style.display = (k === settingTab) ? 'block' : 'none';
  });
  document.querySelectorAll('.setting-tab-btn').forEach(b=>{
    b.classList.toggle('active', b.dataset.settab === settingTab);
  });
}

/* ---------------- Colour maths ----------------
   A palette gives four colours; the app needs fifteen tokens, and some of
   them carry hard legibility requirements (buttons print white text, the
   sidebar prints light text). So the four seeds are treated as intent and
   the tokens are derived, darkening a seed only as far as contrast demands.
   Ratios below are WCAG relative-luminance contrast.
   ---------------------------------------------------------------- */
function hexToRgb(hex){
  let h = String(hex).replace('#','');
  if(h.length === 3) h = h.split('').map(c=>c+c).join('');
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
}
function rgbToHex(rgb){
  return '#' + rgb.map(c=> Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2,'0')).join('').toUpperCase();
}
function rgbToHsl(rgb){
  const r = rgb[0]/255, g = rgb[1]/255, b = rgb[2]/255;
  const mx = Math.max(r,g,b), mn = Math.min(r,g,b), l = (mx+mn)/2;
  let h = 0, s = 0;
  if(mx !== mn){
    const d = mx - mn;
    s = l > 0.5 ? d/(2-mx-mn) : d/(mx+mn);
    if(mx === r)      h = (g-b)/d + (g < b ? 6 : 0);
    else if(mx === g) h = (b-r)/d + 2;
    else              h = (r-g)/d + 4;
    h *= 60;
  }
  return [h, s*100, l*100];
}
function hslToRgb(h, s, l){
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2*l - 1)) * s;
  const x = c * (1 - Math.abs(((h/60) % 2) - 1));
  const m = l - c/2;
  let rgb;
  if(h < 60)       rgb = [c,x,0];
  else if(h < 120) rgb = [x,c,0];
  else if(h < 180) rgb = [0,c,x];
  else if(h < 240) rgb = [0,x,c];
  else if(h < 300) rgb = [x,0,c];
  else             rgb = [c,0,x];
  return rgb.map(v=> (v+m) * 255);
}
function luminance(hex){
  return hexToRgb(hex).map(c=>{
    const v = c/255;
    return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4);
  }).reduce((a,v,i)=> a + v * [0.2126,0.7152,0.0722][i], 0);
}
function contrast(a, b){
  const l1 = luminance(a), l2 = luminance(b);
  return (Math.max(l1,l2) + 0.05) / (Math.min(l1,l2) + 0.05);
}
function mixHex(a, b, t){          // t = how much of `a`
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex([0,1,2].map(i=> B[i] + t * (A[i] - B[i])));
}
function setL(hex, L, S){
  const [h, s] = rgbToHsl(hexToRgb(hex));
  return rgbToHex(hslToRgb(h, S == null ? s : S, L));
}
// Walk the lightness down (or up) until the colour is readable against `other`.
function darkenUntil(hex, target, other){
  other = other || '#FFFFFF';
  let [h, s, l] = rgbToHsl(hexToRgb(hex));
  let out = rgbToHex(hslToRgb(h, s, l));
  while(l > 2 && contrast(out, other) < target){
    l -= 0.5;
    out = rgbToHex(hslToRgb(h, s, l));
  }
  return out;
}
function lightenUntil(hex, target, other){
  other = other || '#000000';
  let [h, s, l] = rgbToHsl(hexToRgb(hex));
  let out = rgbToHex(hslToRgb(h, s, l));
  while(l < 98 && contrast(out, other) < target){
    l += 0.5;
    out = rgbToHex(hslToRgb(h, s, l));
  }
  return out;
}

// Ink for a background we are not allowed to change — a Status or Category
// colour the user picked. Prefer a tinted near-black over flat #101010, but
// only if it actually reads; otherwise take whichever side wins.
function inkOn(bg){
  const [h, s] = rgbToHsl(hexToRgb(bg));
  const tinted = rgbToHex(hslToRgb(h, clamp(s, 0, 55), 14));
  if(contrast(bg, tinted)   >= 4.5) return tinted;
  if(contrast(bg, '#FFFFFF') >= 4.5) return '#FFFFFF';
  return contrast(bg, '#101010') >= contrast(bg, '#FFFFFF') ? '#101010' : '#FFFFFF';
}
// A data colour used as *text* on a surface: nudge it until it reads there.
function inkFor(color, surface){
  return luminance(surface) > 0.4
    ? darkenUntil(color, 4.5, surface)
    : lightenUntil(color, 4.5, surface);
}

// The notification badge is the one place --c-danger lands on --c-deep instead
// of on a panel. Brick red on Bubblegum's deep-rose sidebar is 1.85:1 — red on
// red. Push it off the sidebar colour, then pick ink for wherever it lands.
function badgeColors(){
  const tk = currentTokens();
  const deep = tk['--c-deep'];
  let bg = tk['--c-danger'];
  if(contrast(bg, deep) < 3.0){
    bg = luminance(deep) > 0.4 ? darkenUntil(bg, 3.0, deep) : lightenUntil(bg, 3.0, deep);
  }
  return { bg, ink: pickOnFill(bg) };
}

/* ---------------- Ink on Status / Category colours ----------------
   inkOn() guarantees legibility, but it takes the choice away: white text on a
   calendar chip is a look, and one this app used to have. So the automatic
   answer becomes one option among four rather than the only one.

   'theme' keeps inkOn(): the app's colour system decides per swatch.
   'dark' / 'light' / 'custom' pin the ink and accept whatever contrast follows —
   the setting screen names the swatches that go unreadable rather than silently
   overriding the choice.

   A card may override all of this for its own pills and chips.
   ---------------------------------------------------------------- */
const INK_STORAGE_KEY = 'app_ink_v1';
const INK_MODES = ['theme', 'dark', 'light', 'custom'];
const INK_DARK  = '#101010';
const INK_LIGHT = '#FFFFFF';
let inkSettings = { mode:'theme', color:'#FFFFFF' };

function loadInkSettings(){
  try{
    const raw = Store.getRaw(INK_STORAGE_KEY);
    if(!raw) return { mode:'theme', color:'#FFFFFF' };
    const p = JSON.parse(raw);
    return {
      mode:  INK_MODES.includes(p.mode) ? p.mode : 'theme',
      color: /^#[0-9a-fA-F]{6}$/.test(p.color) ? p.color.toUpperCase() : '#FFFFFF'
    };
  }catch(e){
    logAppError('โหลดสีตัวอักษรไม่สำเร็จ', e);
    return { mode:'theme', color:'#FFFFFF' };
  }
}
function saveInkSettings(){
  try{ Store.setRaw(INK_STORAGE_KEY, JSON.stringify(inkSettings)); }
  catch(e){ logAppError('บันทึกสีตัวอักษรไม่สำเร็จ', e); }
}

// `card` may be a card object or a calendar instance — both carry textMode/textColor.
function resolveInk(bg, card){
  if(card && card.textMode === 'custom' && /^#[0-9a-fA-F]{6}$/.test(card.textColor || '')){
    return card.textColor;
  }
  switch(inkSettings.mode){
    case 'dark':   return INK_DARK;
    case 'light':  return INK_LIGHT;
    case 'custom': return inkSettings.color;
    default:       return inkOn(bg);
  }
}

// Every distinct Status/Category colour across every room, with the ink the
// current setting would print on it. Used to warn, never to override.
function inkAudit(){
  const seen = new Map();
  rooms.forEach(r=>{
    (r.statusConfig || []).forEach(x=> seen.set(x.color.toUpperCase(), x.name));
    (r.categoryConfig || []).forEach(x=> seen.set(x.color.toUpperCase(), x.name));
  });
  return [...seen].map(([color, name])=>{
    const ink = resolveInk(color, null);
    return { color, name, ink, ratio: contrast(color, ink) };
  }).sort((a,b)=> a.ratio - b.ratio);
}

// The two halves of a progress bar sit edge to edge, so the unfinished half has
// to separate from the finished half — whose colour the user chose. No fixed
// token can promise that: --c-highlight collided with a Mulberry accent at
// 1.01:1, and the old beige sat at 1.09:1 against a yellow Done. So derive it.
// Keeps a trace of the Done hue, then walks away from it until 3:1 (WCAG 1.4.11).
function wipColor(done, panel){
  const light = luminance(panel) > 0.4;
  const base  = mixHex(done, panel, 0.18);
  let out = light ? lightenUntil(base, 3.0, done) : darkenUntil(base, 3.0, done);
  if(contrast(out, done) < 3.0){
    // Done is already at the surface's extreme; the only room left is the other way.
    out = light ? darkenUntil(base, 3.0, done) : lightenUntil(base, 3.0, done);
  }
  return out;
}

const clamp = (v, lo, hi)=> Math.min(Math.max(v, lo), hi);

// White first (cleanest), then the theme's own text colour, then near-black.
function pickOnAccent(fill, text){
  if(contrast(fill, '#FFFFFF') >= 4.5) return '#FFFFFF';
  if(contrast(fill, text)      >= 4.5) return text;
  if(contrast(fill, '#101010') >= 4.5) return '#101010';
  return null;
}
// For solid theme fills whose colour we control (deep, danger): whichever of
// white / near-black reads on them. Both always pass by construction.
function pickOnFill(bg){
  return contrast(bg, '#FFFFFF') >= contrast(bg, '#101010') ? '#FFFFFF' : '#101010';
}

// seeds = { deep, accent, pop, pale, button? } — the four colours of a palette.
// The same four seeds drive both modes; what changes is which direction each
// token is pushed. Dark mode is not "swap panel and text": the ink accent has
// to be *lightened* until it reads on a dark panel, danger too, while the fill
// accent stays as vivid as the palette intended.
function buildTheme(seeds, mode){
  return mode === 'dark' ? buildDarkTheme(seeds) : buildLightTheme(seeds);
}

function buildLightTheme(seeds){
  const deep   = darkenUntil(seeds.deep, 9.0);      // light text has to read on it
  const accent = darkenUntil(seeds.accent, 4.6);    // ink accent, read on a white panel
  const text   = darkenUntil(mixHex(accent, deep, 0.25), 11.0);
  const muted  = darkenUntil(mixHex(text, '#FFFFFF', 0.58), 3.4);

  // A near-grey pale colour has no meaningful hue (hue 0 reads as red once you
  // force saturation onto it), so borrow the accent's hue for the light tints.
  const paleSat = rgbToHsl(hexToRgb(seeds.pale))[1];
  const paleLit = rgbToHsl(hexToRgb(seeds.pale))[2];
  const tint = paleSat >= 6
    ? seeds.pale
    : rgbToHex(hslToRgb(rgbToHsl(hexToRgb(accent))[0], 40, paleLit));
  const ts = rgbToHsl(hexToRgb(tint))[1];
  const popSat = rgbToHsl(hexToRgb(seeds.pop))[1];

  const navText = setL(tint, 88, clamp(ts, 20, 55));
  const navStep = t => mixHex(navText, deep, t);

  // The fill accent keeps its seed as long as *some* text colour reads on it.
  // Only if white, the body text and near-black all fail do we darken it.
  let fill = seeds.button || seeds.accent;
  let onAccent = pickOnAccent(fill, text);
  if(!onAccent){
    fill = darkenUntil(fill, 4.6);
    onAccent = '#FFFFFF';
  }
  const danger = '#C6432E';   // 4.95:1 on white, both as ink and as a fill

  return {
    '--c-deep':        deep,
    '--c-on-deep':     pickOnFill(deep),
    '--c-magenta':     accent,
    '--c-accent':      fill,
    '--c-on-accent':   onAccent,
    '--c-cream':       setL(tint, 89, clamp(ts, 14, 34)),
    '--c-bg':          setL(tint, 95, Math.min(ts, 30)),
    '--c-panel':       '#FFFFFF',
    '--c-border':      setL(tint, 87, clamp(ts, 10, 26)),
    '--c-text':        text,
    '--c-muted':       muted,
    '--c-highlight':   setL(seeds.pop, 85, clamp(popSat, 18, 40)),
    '--c-danger':      danger,
    '--c-on-danger':   pickOnFill(danger),
    '--c-nav-text':    navText,
    '--c-nav-heading': navStep(0.86),
    '--c-nav-link':    navStep(0.78),
    '--c-nav-sublink': navStep(0.70),
    '--c-nav-footer':  navStep(0.62)
  };
}

function buildDarkTheme(seeds){
  const dHsl = rgbToHsl(hexToRgb(seeds.deep));
  const aHsl = rgbToHsl(hexToRgb(seeds.accent));
  const pHsl = rgbToHsl(hexToRgb(seeds.pale));

  // Surfaces carry the sidebar's hue at low saturation. A near-grey seed has no
  // usable hue, so fall back to the accent's — same trap as the light ramp.
  const surfHue = dHsl[1] >= 6 ? dHsl[0] : aHsl[0];
  const surfSat = clamp(dHsl[1], 8, 22);
  const surf = (L, sat)=> rgbToHex(hslToRgb(surfHue, sat == null ? surfSat : sat, L));

  const deep   = surf(8);     // sidebar, darkest
  const bg     = surf(12);    // page behind the panels
  const panel  = surf(17);    // the cards themselves
  const cream  = surf(22);    // hover surface
  const border = surf(28, Math.max(surfSat - 4, 6));

  const tintHue = pHsl[1] >= 6 ? pHsl[0] : surfHue;
  const text  = rgbToHex(hslToRgb(tintHue, 12, 93));
  const muted = lightenUntil(rgbToHex(hslToRgb(tintHue, 11, 60)), 3.4, panel);

  // The ink accent has to climb, not fall: it now sits on a dark panel.
  const accent = lightenUntil(seeds.accent, 4.5, panel);

  // A fill accent is a *shape* before it is a label: if it does not separate
  // from the panel it sits on, the button stops looking like a button no matter
  // how legible its text is. Ocean/Sangria/Mulberry all ship dark accents, which
  // vanish into a dark panel — so climb until the edge is visible. Lightening
  // only ever increases contrast against a dark panel, so the later ink check
  // cannot undo this.
  let fill = seeds.button || seeds.accent;
  if(contrast(fill, panel) < 3.0) fill = lightenUntil(fill, 3.0, panel);
  let onAccent = pickOnAccent(fill, '#101010');
  if(!onAccent){
    fill = lightenUntil(fill, 4.6, '#101010');
    onAccent = '#101010';
  }
  const danger = lightenUntil('#C6432E', 4.5, panel);

  const popSat = rgbToHsl(hexToRgb(seeds.pop))[1];
  const navText = rgbToHex(hslToRgb(tintHue, clamp(pHsl[1], 8, 28), 88));
  const navStep = t => mixHex(navText, deep, t);

  return {
    '--c-deep':        deep,
    '--c-on-deep':     pickOnFill(deep),
    '--c-magenta':     accent,
    '--c-accent':      fill,
    '--c-on-accent':   onAccent,
    '--c-cream':       cream,
    '--c-bg':          bg,
    '--c-panel':       panel,
    '--c-border':      border,
    '--c-text':        text,
    '--c-muted':       muted,
    '--c-highlight':   setL(seeds.pop, 31, clamp(popSat, 20, 45)),
    '--c-danger':      danger,
    '--c-on-danger':   pickOnFill(danger),
    '--c-nav-text':    navText,
    '--c-nav-heading': navStep(0.86),
    '--c-nav-link':    navStep(0.78),
    '--c-nav-sublink': navStep(0.70),
    '--c-nav-footer':  navStep(0.62)
  };
}

const THEME_STORAGE_KEY = 'app_theme_v1';

// --c-magenta is the *ink* accent: it must stay readable as text and borders on
// a white panel, so it can never be a vivid colour. --c-accent is the *fill*
// accent (buttons, the active nav pill) and may be as loud as the palette wants,
// because --c-on-accent carries whatever text colour that fill can support.
// Collapsing the two is what made Harbor's orange vanish into a drag-over tint.
const THEME_TOKENS = [
  '--c-deep', '--c-on-deep', '--c-magenta', '--c-accent', '--c-on-accent',
  '--c-cream', '--c-bg', '--c-panel', '--c-border', '--c-text', '--c-muted',
  '--c-highlight', '--c-danger', '--c-on-danger',
  '--c-nav-text', '--c-nav-heading', '--c-nav-link', '--c-nav-sublink', '--c-nav-footer'
];

const THEME_MODE_KEY = 'app_theme_mode_v1';
const THEME_MODES = ['light', 'dark'];
let themeMode = 'light';

const CUSTOM_SEED_KEY = 'app_theme_custom_v1';
const SEED_KEYS = ['deep','accent','pop','pale'];
const DEFAULT_CUSTOM_SEEDS = { deep:'#0B2733', accent:'#1F5C74', pop:'#5E958E', pale:'#DCEAE7' };

// Ocean carries explicit tokens: its sidebar ramp is hand-picked warm beige,
// which no derivation from its own four colours would ever produce. Every
// other preset is just the four colours the palette was published with.
const THEMES = [
  {
    // `lightTokens` pins the original palette exactly — its warm beige sidebar
    // ramp is hand-picked and no derivation from these seeds would reproduce it.
    // Dark mode has no such history, so it derives from the seeds like the rest.
    id: 'ocean', name: 'Ocean',
    seeds: { deep:'#0B2733', accent:'#1F5C74', pop:'#5E958E', pale:'#DCEAE7' },
    lightTokens: {
      '--c-deep':'#0B2733', '--c-on-deep':'#FFFFFF', '--c-magenta':'#1F5C74',
      '--c-accent':'#1F5C74', '--c-on-accent':'#FFFFFF',
      '--c-cream':'#DCEAE7', '--c-bg':'#F2F4F3',
      '--c-panel':'#FFFFFF', '--c-border':'#D8E3E1', '--c-text':'#16323D', '--c-muted':'#6E8B90',
      '--c-highlight':'#CFE3E0', '--c-danger':'#C6432E', '--c-on-danger':'#FFFFFF',
      '--c-nav-text':'#F0E6D8', '--c-nav-heading':'#D7CBB8', '--c-nav-link':'#C9BBA8',
      '--c-nav-sublink':'#B9AB96', '--c-nav-footer':'#A99B87'
    }
  },
  // Harbor's orange is the point of the palette, so it drives the fill accent
  // rather than the steel blue, which stays as the ink accent.
  { id:'harbor',    name:'Harbor',    seeds:{ deep:'#112B3C', accent:'#205375', pop:'#F66B0E', pale:'#EFEFEF', button:'#F66B0E' } },
  { id:'sangria',   name:'Sangria',   seeds:{ deep:'#5E244E', accent:'#AA1C41', pop:'#E68457', pale:'#FFE8B4' } },
  { id:'mulberry',  name:'Mulberry',  seeds:{ deep:'#56021F', accent:'#7D1C4A', pop:'#D17D98', pale:'#F4CCE9' } },
  { id:'fern',      name:'Fern',      seeds:{ deep:'#1A312C', accent:'#428475', pop:'#89D7B7', pale:'#FFF4E1' } },
  { id:'bubblegum', name:'Bubblegum', seeds:{ deep:'#FF90BB', accent:'#FF90BB', pop:'#8ACCD5', pale:'#F8F8E1' } },
  // --- extra palettes (derived from supplied swatches; tweak freely) ---
  { id:'terracotta', name:'Terracotta', seeds:{ deep:'#5E6A4E', accent:'#B96A4E', pop:'#E9D9C0', pale:'#F2E8DA' } },
  { id:'azure',      name:'Azure',      seeds:{ deep:'#2A3B86', accent:'#3E6FD1', pop:'#8FCBDE', pale:'#D3E7EC' } },
  { id:'blossom',    name:'Blossom',    seeds:{ deep:'#FF7CC4', accent:'#FF8FB3', pop:'#FFC79C', pale:'#FBF6C8' } },
  { id:'candy',      name:'Candy',      seeds:{ deep:'#C25E7E', accent:'#FBB6C7', pop:'#9AD4E0', pale:'#FCFAA8' } },
  { id:'sage',       name:'Sage',       seeds:{ deep:'#2C362E', accent:'#3E5045', pop:'#A17C5B', pale:'#DFDACD' } },
  { id:'plum',       name:'Plum',       seeds:{ deep:'#5C4453', accent:'#75505C', pop:'#9A8768', pale:'#D6A98B' } },
  { id:'amethyst',   name:'Amethyst',   seeds:{ deep:'#231145', accent:'#4B2160', pop:'#A0524F', pale:'#DDA05C' } },
  { id:'orchid',     name:'Orchid',     seeds:{ deep:'#3C2168', accent:'#5E3086', pop:'#E0559E', pale:'#FCA3B0' } },
  { id:'sunset',     name:'Sunset',     seeds:{ deep:'#F9515A', accent:'#FB8062', pop:'#FFBE7D', pale:'#FCF07A' } },
  { id:'sky',        name:'Sky',        seeds:{ deep:'#7FA9BA', accent:'#9DC7D6', pop:'#C0DDE4', pale:'#E3F3D9' } },
  { id:'espresso',   name:'Espresso',   seeds:{ deep:'#000000', accent:'#241810', pop:'#43301A', pale:'#E5DED0' } },
  { id:'cocoa',      name:'Cocoa',      seeds:{ deep:'#42292A', accent:'#575859', pop:'#E7D2C4', pale:'#F3E9E4' } },
  { id:'petal',      name:'Petal',      seeds:{ deep:'#C9A7C4', accent:'#FBE9EC', pop:'#FBD9DE', pale:'#F5C6D0' } },
  { id:'obsidian',   name:'Obsidian',   seeds:{ deep:'#2B2B2B', accent:'#552847', pop:'#8E3459', pale:'#F73758' } },
  { id:'crimson',    name:'Crimson',    seeds:{ deep:'#1B1717', accent:'#8B1A17', pop:'#D2402E', pale:'#EFEFEF' } },
  { id:'coral',      name:'Coral',      seeds:{ deep:'#0A1A38', accent:'#8B2144', pop:'#C13350', pale:'#E07A5F' } },
  { id:'custom',    nameKey:'theme.custom', custom:true, seeds:{ ...DEFAULT_CUSTOM_SEEDS } }
];

function themeName(th){ return th.nameKey ? t(th.nameKey) : th.name; }
function themeTokens(th, mode){
  mode = mode || themeMode;
  if(mode === 'light' && th.lightTokens) return th.lightTokens;
  return buildTheme(th.seeds, mode);
}
// Read by every render path that paints a user-chosen colour.
function currentTokens(){ return themeTokens(getTheme(currentThemeId)); }
function panelColor(){ return currentTokens()['--c-panel']; }
function fallbackColor(){ return currentTokens()['--c-muted']; }
function customTheme(){ return THEMES.find(th=> th.custom); }

function loadCustomSeeds(){
  try{
    const raw = Store.getRaw(CUSTOM_SEED_KEY);
    if(!raw) return { ...DEFAULT_CUSTOM_SEEDS };
    const p = JSON.parse(raw);
    const out = { ...DEFAULT_CUSTOM_SEEDS };
    SEED_KEYS.forEach(k=>{ if(/^#[0-9a-fA-F]{6}$/.test(p[k])) out[k] = p[k]; });
    return out;
  }catch(e){
    logAppError('โหลดธีมที่ปรับเองไม่สำเร็จ', e);
    return { ...DEFAULT_CUSTOM_SEEDS };
  }
}
function saveCustomSeeds(){
  try{ Store.setRaw(CUSTOM_SEED_KEY, JSON.stringify(customTheme().seeds)); }
  catch(e){ logAppError('บันทึกธีมที่ปรับเองไม่สำเร็จ', e); }
}

const DEFAULT_THEME_ID = THEMES[0].id;
let currentThemeId = DEFAULT_THEME_ID;

function getTheme(id){
  return THEMES.find(th=> th.id === id) || THEMES[0];
}
function loadThemeId(){
  try{
    const id = Store.getRaw(THEME_STORAGE_KEY);
    return THEMES.some(th=> th.id === id) ? id : DEFAULT_THEME_ID;
  }catch(e){
    logAppError('โหลดธีมไม่สำเร็จ', e);
    return DEFAULT_THEME_ID;
  }
}
function saveThemeId(id){
  try{ Store.setRaw(THEME_STORAGE_KEY, id); }
  catch(e){ logAppError('บันทึกธีมไม่สำเร็จ', e); }
}
function loadThemeMode(){
  try{
    const m = Store.getRaw(THEME_MODE_KEY);
    return THEME_MODES.includes(m) ? m : 'light';
  }catch(e){
    logAppError('โหลดโหมดธีมไม่สำเร็จ', e);
    return 'light';
  }
}
function saveThemeMode(){
  try{ Store.setRaw(THEME_MODE_KEY, themeMode); }
  catch(e){ logAppError('บันทึกโหมดธีมไม่สำเร็จ', e); }
}

function themeStyleEl(){
  let el = document.getElementById('themeVars');
  if(!el){
    el = document.createElement('style');
    el.id = 'themeVars';
    document.head.appendChild(el);   // after styles.css → same specificity, later wins
  }
  return el;
}

function applyTheme(id){
  const th = getTheme(id);
  const tokens = themeTokens(th, themeMode);
  const missing = THEME_TOKENS.filter(k=> !tokens[k]);
  if(missing.length){
    logAppError('ธีม "' + th.id + '" ขาดตัวแปร: ' + missing.join(', '), null);
    return;   // a half-applied palette looks broken; keep the previous one
  }
  currentThemeId = th.id;
  // Tell the browser how dark the palette is, so native controls (number-input
  // spinners, date pickers, dropdowns, scrollbars) render in a matching light/
  // dark style instead of the default white-on-dark clash. Derived per palette,
  // so it tracks all 22 presets + custom + the light/dark toggle automatically.
  const scheme = luminance(tokens['--c-bg']) < 0.4 ? 'dark' : 'light';
  themeStyleEl().textContent =
    'body.jigsaw-theme, .login-screen, .app-loading{\n' + THEME_TOKENS.map(k=> `  ${k}:${tokens[k]};`).join('\n') +
    '\n  color-scheme:' + scheme + ';\n}';
  saveThemeId(th.id);
}

// Ink for Status/Category colours is computed at paint time against the panel,
// so a mode switch has to redraw every surface, not just swap the CSS vars.
function setThemeMode(mode){
  if(!THEME_MODES.includes(mode) || mode === themeMode) return;
  themeMode = mode;
  saveThemeMode();
  applyTheme(currentThemeId);
  refreshAllSurfaces();
  renderInkPreview();     // 'theme' ink is derived from the palette
  renderThemeSetting();
  renderThemeCustomEditor();
}

/* ---------------- Setting ---------------- */
// The card is a shrunk-down picture of the app: dark sidebar, page background,
// two text lines, an accent button — so the palette is judged in context
// rather than as six disconnected squares.
const THEME_CHIPS = ['--c-deep', '--c-accent', '--c-magenta', '--c-highlight', '--c-cream', '--c-danger'];

function themeCardHtml(th){
  const active = th.id === currentThemeId;
  const tk = themeTokens(th);
  const chips = THEME_CHIPS.map(k=> `<span class="theme-chip" style="background:${tk[k]}"></span>`).join('');
  return `<button type="button" class="theme-card ${active ? 'active' : ''}" data-theme="${escapeHtml(th.id)}">
    <div class="theme-preview" style="background:${tk['--c-bg']}; border-color:${tk['--c-border']}">
      <div class="theme-preview-nav" style="background:${tk['--c-deep']}">
        <span class="theme-preview-navline accent" style="background:${tk['--c-accent']}"></span>
        <span class="theme-preview-navline short" style="background:${tk['--c-nav-link']}"></span>
        <span class="theme-preview-navline short" style="background:${tk['--c-nav-sublink']}"></span>
      </div>
      <div class="theme-preview-page">
        <div class="theme-preview-card" style="background:${tk['--c-panel']}; border-color:${tk['--c-border']}">
          <span class="theme-preview-line" style="background:${tk['--c-text']}"></span>
          <span class="theme-preview-line short" style="background:${tk['--c-muted']}"></span>
          <span class="theme-preview-btn" style="background:${tk['--c-accent']}"></span>
        </div>
      </div>
    </div>
    <div class="theme-card-foot">
      <span class="theme-name">${escapeHtml(themeName(th))}</span>
      ${active ? '<span class="theme-active-tag">' + escapeHtml(t('theme.active')) + '</span>' : ''}
    </div>
    <div class="theme-chips">${chips}</div>
  </button>`;
}

// Which seeds buildTheme() had to move to keep text legible. Surfacing this
// matters most in the custom editor: the picker will not always show what the
// app actually paints, and silently ignoring the difference feels like a bug.
function adjustedSeeds(seeds){
  const tk = buildTheme(seeds, themeMode);
  const moved = [];
  if(tk['--c-deep'].toUpperCase()    !== seeds.deep.toUpperCase())   moved.push({ label:t('theme.seed.deep'),   from:seeds.deep,   to:tk['--c-deep'] });
  if(tk['--c-magenta'].toUpperCase() !== seeds.accent.toUpperCase()) moved.push({ label:t('theme.seed.accent'), from:seeds.accent, to:tk['--c-magenta'] });
  return moved;
}

function renderThemeCustomEditor(){
  const wrap = document.getElementById('themeCustomEditor');
  if(!wrap) return;
  const th = customTheme();
  if(currentThemeId !== th.id){ wrap.innerHTML = ''; return; }

  wrap.innerHTML = `<div class="theme-custom">
    <div class="theme-custom-head">
      <h4 class="setting-subtitle">${escapeHtml(t('theme.custom.title'))}</h4>
      <button type="button" class="btn btn-ghost" id="themeCustomReset">${escapeHtml(t('theme.custom.reset'))}</button>
    </div>
    <p class="setting-desc">${escapeHtml(t('theme.custom.desc'))}</p>
    <div class="theme-seed-grid">
      ${SEED_KEYS.map(k=>`<label class="theme-seed">
        <span class="theme-seed-label">${escapeHtml(t('theme.seed.' + k))}</span>
        <input type="color" class="theme-seed-input" data-seed="${k}" value="${th.seeds[k]}">
        <span class="theme-seed-hex" data-hex="${k}">${escapeHtml(th.seeds[k].toUpperCase())}</span>
      </label>`).join('')}
    </div>
    <p class="theme-custom-note" id="themeCustomNote"></p>
  </div>`;

  updateCustomNote();

  wrap.querySelectorAll('.theme-seed-input').forEach(inp=>{
    // `input` fires while the picker is open — repaint live, but never rebuild
    // this editor or the open picker loses focus. Only the cards get redrawn.
    inp.addEventListener('input', ()=> updateCustomSeed(inp.dataset.seed, inp.value));
  });
  const reset = document.getElementById('themeCustomReset');
  if(reset) reset.addEventListener('click', ()=>{
    customTheme().seeds = { ...DEFAULT_CUSTOM_SEEDS };
    saveCustomSeeds();
    if(currentThemeId === 'custom') applyTheme('custom');
    renderThemeSetting();
    renderThemeCustomEditor();
  });
}

function updateCustomNote(){
  const note = document.getElementById('themeCustomNote');
  if(!note) return;
  const seeds = customTheme().seeds;
  const tk = buildTheme(seeds, themeMode);
  const lines = [];

  const moved = adjustedSeeds(seeds);
  if(moved.length){
    lines.push(t('theme.custom.adjusted', {
      t: moved.map(m=> `${m.label} ${m.from.toUpperCase()} → ${m.to}`).join(' · ')
    }));
  }
  // A pale fill keeps its colour but flips to dark text; say so, or the button
  // looks like it ignored the picker.
  if(tk['--c-on-accent'].toUpperCase() !== '#FFFFFF'){
    lines.push(t('theme.custom.darktext'));
  }

  note.style.display = lines.length ? 'block' : 'none';
  note.textContent = lines.join('  ·  ');
}

function updateCustomSeed(key, value){
  if(!SEED_KEYS.includes(key) || !/^#[0-9a-fA-F]{6}$/.test(value)) return;
  const th = customTheme();
  th.seeds[key] = value.toUpperCase();
  saveCustomSeeds();
  if(currentThemeId === th.id) applyTheme(th.id);   // CSS vars → the whole app repaints
  renderThemeSetting();                             // preview swatches follow
  const hex = document.querySelector(`.theme-seed-hex[data-hex="${key}"]`);
  if(hex) hex.textContent = value.toUpperCase();
  updateCustomNote();
}

function renderThemeMode(){
  const wrap = document.getElementById('themeModeToggle');
  if(!wrap) return;
  wrap.innerHTML = THEME_MODES.map(m=>
    `<button type="button" class="theme-mode-btn ${m === themeMode ? 'active' : ''}" data-mode="${m}">
       <span class="theme-mode-dot ${m}"></span>${escapeHtml(t('theme.mode.' + m))}
     </button>`).join('');
  wrap.querySelectorAll('.theme-mode-btn').forEach(btn=>{
    btn.addEventListener('click', ()=> setThemeMode(btn.dataset.mode));
  });
}

function renderThemeSetting(){
  renderThemeMode();
  const wrap = document.getElementById('themeList');
  if(!wrap) return;
  // Preset palettes go in the main list; the custom palette gets its own
  // section below the divider so users notice they can build their own.
  const presets = THEMES.filter(th=> !th.custom);
  const customs = THEMES.filter(th=> th.custom);
  wrap.innerHTML = presets.map(themeCardHtml).join('');
  const customWrap = document.getElementById('themeCustomList');
  if(customWrap) customWrap.innerHTML = customs.map(themeCardHtml).join('');
  document.querySelectorAll('#themeList .theme-card, #themeCustomList .theme-card').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      if(btn.dataset.theme === currentThemeId) return;
      applyTheme(btn.dataset.theme);
      renderThemeSetting();
      renderThemeCustomEditor();
    });
  });
}

/* ---------------- Save failures ----------------
   Card images were removed, so nothing here should ever come close to the
   ~5 MB origin quota — a text-only card costs roughly 750 bytes. This stays as
   depth: if a save ever does fail on quota, "try again" is the one piece of
   advice that cannot work, and offering it would send the user in circles.
   ---------------------------------------------------------------- */
function isQuotaError(e){
  if(!e) return false;
  return e.name === 'QuotaExceededError'
      || e.name === 'NS_ERROR_DOM_QUOTA_REACHED'
      || e.code === 22 || e.code === 1014;
}
function alertSaveFailure(e){
  alert(t(isQuotaError(e) ? 'alert.saveFull' : 'alert.saveFail'));
}
function formatBytes(n){
  if(n < 1024) return n + ' B';
  if(n < 1024*1024) return Math.round(n/1024) + ' KB';
  return (n/1024/1024).toFixed(2) + ' MB';
}

/* The logo is the only base64 blob left in storage. It renders at most 250px
   wide (login) and 170px (sidebar), so a 500px-wide asset already covers 2x
   screens — that is ~30 KB as a transparent PNG, or ~3 KB as SVG. The cap is
   set well above any sensible logo and well below a phone photo. base64 plus
   UTF-16 means 256 KB on disk becomes ~683 KB of the ~5 MB origin quota. */
const LOGO_MAX_BYTES = 256 * 1024;

