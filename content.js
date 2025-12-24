/**
 * CONTENT.JS - UI Engine (v2.5.7)
 *
 * Fixes:
 * - Level 2 favicon guaranteed visible:
 *   - Uses --tz-lvl2-fav sizing (not --tz-fav)
 *   - Wrapper has min-width/min-height and flex-basis
 *   - Tooltip title on favicon wrapper
 *   - Clickable favicon (switch tab), hover highlight
 *
 * No logic/behavior change otherwise.
 *
 * --- Integrated: Level naming (Level 1/2/3) ---
 * Level 1: default (home)
 * Level 2: groups (list groups, each group shows ALL favicons inside the group; favicons clickable -> switch tab)
 * Level 3: group_tabs (tabs inside a group)
 */

const MAX_TITLE_LENGTH = 30;
const INDICATOR_COLOR = '#0078d4';
const BACK_ARROW = '◀';
const GLOBAL_FONT = 'Arial, sans-serif';

const GROUP_COLOR_MAP = {
  grey: '#5f6368', blue: '#8ab4f8', red: '#f28b82', yellow: '#fdd663',
  green: '#81c995', pink: '#ff80ab', purple: '#c589d7', cyan: '#78d9ec',
  orange: '#fcc934', default: '#505050'
};

const BASE = {
  BAR_H: 38,
  TAB_W: 148,
  FONT_PX: 14,
  FAV_PX: 16,
  PAD_X: 10,
  GAP_X: 2,
  PLUS_W: 26,
  SEP_W: 1,
  SEP_MX: 10,
  ICON_GAP: 8,
  INDICATOR_H: 2,
  GROUP_MIN_PAD_X: 12,
  LVL2_FAV_PX: 14,
  LVL2_FAV_ML: 6
};

// -------------------------------
// Navigation levels (requested naming)
// -------------------------------
const NAV_LEVELS = {
  LEVEL_1: 'default',
  LEVEL_2: 'groups',
  LEVEL_3: 'group_tabs'
};

let navigationState = NAV_LEVELS.LEVEL_1;
let currentViewedGroupId = null;
let cachedTabGroups = [];
let isInternalResize = false;
let suppressClickUntil = 0; // avoid accidental SWITCH_TAB right after drag end/drop
let activePopover = null;

// ---- Port/handshake state ----
let tzPort = null;
let tzPortReady = false;
let tzPortConnecting = false;

const TZ_PORT_NAME = 'TZ_UI_PORT';
const TZ_HANDSHAKE_MSG = { action: '__TZ_HANDSHAKE__' };

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// -------------------------------
// Zoom scale (robust) + metrics application
// -------------------------------
let _lastScale = null;
let _metricsRAF = 0;
let _baseDPR = null;

function round3(n) { return Math.round(n * 1000) / 1000; }
function captureBaseDPR() { _baseDPR = window.devicePixelRatio || 1; }

function getZoomScale() {
  const dpr = window.devicePixelRatio || 1;
  const base = _baseDPR || dpr || 1;
  let s = dpr / base;
  if (!isFinite(s) || s <= 0) s = 1;
  return round3(s);
}

function maybeRecaptureBaseDPR() {
  if (_baseDPR == null) return captureBaseDPR();
  const dpr = window.devicePixelRatio || 1;
  const s = dpr / _baseDPR;
  if (!isFinite(s) || s <= 0.1 || s >= 10) captureBaseDPR();
}

function px(base, scale) {
  const v = base / (scale || 1);
  return `${Math.round(v * 1000) / 1000}px`;
}

function ensureSizingStyle() {
  if (document.head?.querySelector('style[data-tz-px-zoom]')) return;

  const style = document.createElement('style');
  style.setAttribute('data-tz-px-zoom', 'true');
  style.textContent = `
    :root{
      --tz-tab-w: ${BASE.TAB_W}px;
      --tz-h: ${BASE.BAR_H}px;
      --tz-font: ${BASE.FONT_PX}px;
      --tz-fav: ${BASE.FAV_PX}px;
      --tz-pad-x: ${BASE.PAD_X}px;
      --tz-gap-x: ${BASE.GAP_X}px;
      --tz-plus-w: ${BASE.PLUS_W}px;
      --tz-sep-w: ${BASE.SEP_W}px;
      --tz-sep-mx: ${BASE.SEP_MX}px;
      --tz-icon-gap: ${BASE.ICON_GAP}px;
      --tz-ind-h: ${BASE.INDICATOR_H}px;

      --tz-group-min-pad-x: ${BASE.GROUP_MIN_PAD_X}px;
      --tz-lvl2-fav: ${BASE.LVL2_FAV_PX}px;
      --tz-lvl2-fav-ml: ${BASE.LVL2_FAV_ML}px;
    }
    #ungroup-automatic-tab-bar .scroll-container::-webkit-scrollbar{ display:none; }

    /* Close X: hidden by default; visible only when hovering the tab tile */
    #ungroup-automatic-tab-bar .tz-close-x{
      opacity:0 !important;
      pointer-events:none !important;
      background:transparent;
      color:#bdbdbd;
      transition:opacity 120ms ease, background 120ms ease, color 120ms ease, transform 120ms ease;
    }
    /* Group "+" button: same hover behavior as X */
    #ungroup-automatic-tab-bar .tz-group-btn{
      opacity:0 !important;
      pointer-events:none !important;
      background:transparent;
      color:#bdbdbd;
      transition:opacity 120ms ease, background 120ms ease, color 120ms ease, transform 120ms ease;
    }
    #ungroup-automatic-tab-bar .tz-tab-btn:hover .tz-close-x{
      opacity:1 !important;
      pointer-events:auto !important;
      background:#3a3a3a;
      color:#ffffff;
    }
    #ungroup-automatic-tab-bar .tz-tab-btn:hover .tz-group-btn{
      opacity:1 !important;
      pointer-events:auto !important;
      background:#3a3a3a;
      color:#ffffff;
    }
    #ungroup-automatic-tab-bar .tz-tab-btn:hover .tz-close-x:hover{
      background:#4a4a4a;
      transform:scale(1.03);
    }
    #ungroup-automatic-tab-bar .tz-tab-btn:hover .tz-group-btn:hover{
      background:#4a4a4a;
      transform:scale(1.03);
    }

    /* Level-2 favicon wrapper (guaranteed space + hover highlight) */
    #ungroup-automatic-tab-bar .tz-lvl2-fav-wrap{
      width:var(--tz-lvl2-fav);
      height:var(--tz-lvl2-fav);
      min-width:var(--tz-lvl2-fav);
      min-height:var(--tz-lvl2-fav);
      flex:0 0 var(--tz-lvl2-fav);
      display:flex;
      align-items:center;
      justify-content:center;
      border-radius:4px;
      cursor:pointer;
      user-select:none;
      transition:background 120ms ease, transform 120ms ease;
    }
    #ungroup-automatic-tab-bar .tz-tab-btn:hover .tz-lvl2-fav-wrap{
      background:#3a3a3a;
    }
    #ungroup-automatic-tab-bar .tz-lvl2-fav-wrap:hover{
      background:#4a4a4a;
      transform:scale(1.03);
    }

    /* NEW: Level-1 pinned favicon wrapper (favicon-only pinned tabs) */
    #ungroup-automatic-tab-bar .tz-pin-fav-wrap{
      width:var(--tz-fav);
      height:var(--tz-fav);
      min-width:var(--tz-fav);
      min-height:var(--tz-fav);
      flex:0 0 var(--tz-fav);
      display:flex;
      align-items:center;
      justify-content:center;
      border-radius:4px;
      cursor:pointer;
      user-select:none;
      margin:0 calc(var(--tz-gap-x) + 2px);
      transition:background 120ms ease, transform 120ms ease;
    }
    #ungroup-automatic-tab-bar .tz-pin-fav-wrap:hover{
      background:#3a3a3a;
      transform:scale(1.03);
    }

    /* Drag & drop indicators */
    #ungroup-automatic-tab-bar [data-tz-draggable="tab"].tz-dragging{
      opacity:0.65 !important;
    }
    #ungroup-automatic-tab-bar [data-tz-draggable="tab"].tz-drop-before{
      box-shadow: inset 0 2px 0 0 ${INDICATOR_COLOR} !important;
    }
    #ungroup-automatic-tab-bar [data-tz-draggable="tab"].tz-drop-after{
      box-shadow: inset 0 -2px 0 0 ${INDICATOR_COLOR} !important;
    }

    /* Make HTML5 dragging start reliably on Chromium/WebKit */
    #ungroup-automatic-tab-bar [data-tz-draggable="tab"]{
      -webkit-user-drag: element;
      user-drag: element;
    }

    /* Group picker popover */
    #ungroup-automatic-tab-bar .tz-popover{
      all: initial;
      position:fixed;
      z-index:2147483647;
      width:260px;
      max-height:320px;
      overflow:auto;
      background:#1f1f1f;
      border:1px solid #333;
      border-radius:8px;
      box-shadow:0 8px 30px rgba(0,0,0,0.45);
      padding:10px;
      font-family:${GLOBAL_FONT};
      color:#fff;
      box-sizing:border-box;
    }
    #ungroup-automatic-tab-bar .tz-popover .row{
      all: initial;
      display:flex;
      align-items:center;
      gap:8px;
      font-family:${GLOBAL_FONT};
      font-size:13px;
      color:#fff;
      box-sizing:border-box;
    }
    #ungroup-automatic-tab-bar .tz-popover input,
    #ungroup-automatic-tab-bar .tz-popover select{
      all: initial;
      font-family:${GLOBAL_FONT};
      font-size:13px;
      color:#fff;
      background:#2a2a2a;
      border:1px solid #444;
      border-radius:6px;
      padding:6px 8px;
      box-sizing:border-box;
    }
    #ungroup-automatic-tab-bar .tz-popover .btn{
      all: initial;
      font-family:${GLOBAL_FONT};
      font-size:13px;
      color:#fff;
      background:#2f2f2f;
      border:1px solid #444;
      border-radius:6px;
      padding:6px 8px;
      cursor:pointer;
      user-select:none;
      box-sizing:border-box;
    }
    #ungroup-automatic-tab-bar .tz-popover .btn:hover{ background:#3a3a3a; }
    #ungroup-automatic-tab-bar .tz-popover .group-item{
      all: initial;
      display:flex;
      align-items:center;
      gap:8px;
      padding:6px 6px;
      border-radius:6px;
      cursor:pointer;
      user-select:none;
      font-family:${GLOBAL_FONT};
      font-size:13px;
      color:#fff;
      box-sizing:border-box;
    }
    #ungroup-automatic-tab-bar .tz-popover .group-item:hover{ background:#333; }
    #ungroup-automatic-tab-bar .tz-popover .swatch{
      all: initial;
      width:10px;
      height:10px;
      border-radius:3px;
      flex:0 0 10px;
      box-sizing:border-box;
    }
  `;
  document.head?.appendChild(style);
}

function applyZoomCompensatedMetrics(force = false) {
  ensureSizingStyle();
  maybeRecaptureBaseDPR();

  const scale = getZoomScale();
  if (!force && _lastScale === scale) return;
  _lastScale = scale;

  const root = document.documentElement;
  if (!root) return;

  root.style.setProperty('--tz-tab-w', px(BASE.TAB_W, scale));
  root.style.setProperty('--tz-h', px(BASE.BAR_H, scale));
  root.style.setProperty('--tz-font', px(BASE.FONT_PX, scale));
  root.style.setProperty('--tz-fav', px(BASE.FAV_PX, scale));
  root.style.setProperty('--tz-pad-x', px(BASE.PAD_X, scale));
  root.style.setProperty('--tz-gap-x', px(BASE.GAP_X, scale));
  root.style.setProperty('--tz-plus-w', px(BASE.PLUS_W, scale));
  root.style.setProperty('--tz-sep-w', px(BASE.SEP_W, scale));
  root.style.setProperty('--tz-sep-mx', px(BASE.SEP_MX, scale));
  root.style.setProperty('--tz-icon-gap', px(BASE.ICON_GAP, scale));
  root.style.setProperty('--tz-ind-h', px(BASE.INDICATOR_H, scale));

  root.style.setProperty('--tz-group-min-pad-x', px(BASE.GROUP_MIN_PAD_X, scale));
  root.style.setProperty('--tz-lvl2-fav', px(BASE.LVL2_FAV_PX, scale));
  root.style.setProperty('--tz-lvl2-fav-ml', px(BASE.LVL2_FAV_ML, scale));

  applyPageShift();
  updateDynamicLayout();
}

function scheduleMetricsUpdate(force = false) {
  if (_metricsRAF) cancelAnimationFrame(_metricsRAF);
  _metricsRAF = requestAnimationFrame(() => {
    _metricsRAF = 0;
    applyZoomCompensatedMetrics(force);
  });
}

// -------------------------------
// Messaging helpers
// -------------------------------
function safeConnectPort() {
  if (tzPortReady || tzPortConnecting) return;
  if (!chrome?.runtime?.connect) return;

  tzPortConnecting = true;

  try {
    tzPort = chrome.runtime.connect({ name: TZ_PORT_NAME });

    tzPort.onDisconnect.addListener(() => {
      tzPort = null;
      tzPortReady = false;
      tzPortConnecting = false;
    });

    tzPort.onMessage.addListener((msg) => {
      if (msg?.action === '__TZ_HANDSHAKE_OK__') {
        tzPortReady = true;
        tzPortConnecting = false;
      }
    });

    try { tzPort.postMessage(TZ_HANDSHAKE_MSG); } catch { }
    setTimeout(() => { if (!tzPortReady) tzPortConnecting = false; }, 700);
  } catch {
    tzPort = null;
    tzPortReady = false;
    tzPortConnecting = false;
  }
}

async function safeRuntimeSendMessageWithRetry(msg, tries = 5) {
  for (let i = 0; i < tries; i++) {
    const resp = await safeRuntimeSendMessageOnce(msg);
    if (resp !== null) return resp;

    safeConnectPort();
    const backoff = Math.min(800, 80 * Math.pow(2, i));
    await sleep(backoff);
  }
  return null;
}

function safeRuntimeSendMessageOnce(msg) {
  return new Promise((resolve) => {
    try {
      if (!chrome?.runtime?.sendMessage) return resolve(null);

      chrome.runtime.sendMessage(msg, (resp) => {
        const err = chrome.runtime?.lastError;
        if (err) return resolve(null);
        resolve(resp ?? null);
      });
    } catch {
      resolve(null);
    }
  });
}

// -------------------------------
// DOM helpers
// -------------------------------
function getFallbackFaviconDataUrl() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">
      <rect width="16" height="16" rx="3" ry="3" fill="#3a3a3a"/>
      <path d="M5 3.5h4.8l1.7 1.9V12.5H5z" fill="#bdbdbd"/>
      <path d="M9.8 3.5v2.1h2" fill="#d8d8d8"/>
    </svg>
  `.trim();
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function createFaviconElement(tab) {
  const favicon = document.createElement('img');
  favicon.className = 'tab-favicon';
  // Prevent native image dragging from stealing the drag gesture from the tab tile.
  favicon.draggable = false;
  favicon.setAttribute('draggable', 'false');
  favicon.referrerPolicy = 'no-referrer';
  favicon.decoding = 'async';
  favicon.loading = 'lazy';

  favicon.style.cssText =
    `width:var(--tz-fav); height:var(--tz-fav);` +
    `flex:0 0 var(--tz-fav); display:block;`;

  const fallback = getFallbackFaviconDataUrl();
  favicon.src = fallback;

  if (tab.favIconUrl) {
    favicon.onerror = function () {
      favicon.onerror = null;
      favicon.src = fallback;
    };
    favicon.src = tab.favIconUrl;
  }
  return favicon;
}

function handleCloseTab(tabId) {
  safeRuntimeSendMessageWithRetry({ action: "CLOSE_TAB", tabId }, 2).then(() => requestTabList());
}

function handleTabClick(tabId) {
  if (Date.now() < suppressClickUntil) return;
  safeRuntimeSendMessageWithRetry({ action: "SWITCH_TAB", tabId }, 3).then(() => {
    navigationState = NAV_LEVELS.LEVEL_1;
    currentViewedGroupId = null;
    requestTabList();
  });
}

function handleNewTab() {
  safeRuntimeSendMessageWithRetry({ action: "OPEN_NEW_TAB" }, 2);
}

function createCloseButton(tabId) {
  const x = document.createElement('div');
  x.className = 'tz-close-x';
  x.textContent = '×';
  x.title = 'Close tab';

  x.style.cssText =
    `margin-left:auto; flex:0 0 auto;` +
    `display:flex; align-items:center; justify-content:center;` +
    `width:18px; height:18px; border-radius:4px;` +
    `font-family:${GLOBAL_FONT}; font-size:16px; line-height:1;` +
    `cursor:pointer; user-select:none;`;

  x.onmousedown = (e) => { e.stopPropagation(); e.preventDefault(); };
  x.onclick = (e) => { e.stopPropagation(); e.preventDefault(); handleCloseTab(tabId); };
  return x;
}

function createGroupButton(tabId) {
  const b = document.createElement('div');
  b.className = 'tz-group-btn';
  b.textContent = '+';
  b.title = 'Add to group';
  b.style.cssText =
    `margin-left:0; flex:0 0 auto;` +
    `display:flex; align-items:center; justify-content:center;` +
    `width:18px; height:18px; border-radius:4px;` +
    `font-family:${GLOBAL_FONT}; font-size:16px; line-height:1;` +
    `cursor:pointer; user-select:none;`;
  b.onmousedown = (e) => { e.stopPropagation(); e.preventDefault(); };
  b.onclick = (e) => { e.stopPropagation(); e.preventDefault(); openGroupPopover(b, tabId); };
  return b;
}

function createUngroupButton(tabId) {
  const b = document.createElement('div');
  b.className = 'tz-ungroup-btn';
  b.textContent = 'Ungroup';
  b.title = 'Remove from group';
  b.style.cssText =
    `all: initial; margin-left:auto; flex:0 0 auto;` +
    `display:flex; align-items:center; justify-content:center;` +
    `height:18px; padding:0 8px; border-radius:4px;` +
    `font-family:${GLOBAL_FONT}; font-size:12px; line-height:1;` +
    `cursor:pointer; user-select:none;` +
    `background:#2f2f2f; border:1px solid #444; color:#fff;`;
  b.onmouseover = () => { b.style.background = '#3a3a3a'; };
  b.onmouseout = () => { b.style.background = '#2f2f2f'; };
  b.onmousedown = (e) => { e.stopPropagation(); e.preventDefault(); };
  b.onclick = async (e) => {
    e.stopPropagation(); e.preventDefault();
    suppressClickUntil = Date.now() + 700;
    await safeRuntimeSendMessageWithRetry({ action: 'UNGROUP_TAB', tabId }, 3);
    handleStateChange();
  };
  return b;
}

function closeActivePopover() {
  if (!activePopover) return;
  try { activePopover.remove(); } catch {}
  activePopover = null;
  document.removeEventListener('mousedown', onDocMouseDown, true);
  document.removeEventListener('keydown', onDocKeyDown, true);
}

function onDocMouseDown(e) {
  if (!activePopover) return;
  if (activePopover.contains(e.target)) return;
  closeActivePopover();
}

function onDocKeyDown(e) {
  if (e.key === 'Escape') closeActivePopover();
}

function openGroupPopover(anchorEl, tabId) {
  closeActivePopover();

  const pop = document.createElement('div');
  pop.className = 'tz-popover';
  pop.onmousedown = (e) => { e.stopPropagation(); };

  // Position near the anchor
  const r = anchorEl.getBoundingClientRect();
  const top = Math.min(window.innerHeight - 340, Math.max(8, r.bottom + 6));
  const left = Math.min(window.innerWidth - 280, Math.max(8, r.left - 120));
  pop.style.top = `${top}px`;
  pop.style.left = `${left}px`;

  const title = document.createElement('div');
  title.className = 'row';
  title.style.marginBottom = '8px';
  title.textContent = 'Add to group';
  pop.appendChild(title);

  // New group UI
  const newRow = document.createElement('div');
  newRow.className = 'row';
  newRow.style.marginBottom = '10px';

  const inp = document.createElement('input');
  inp.type = 'text';
  inp.placeholder = 'New group title';
  inp.style.flex = '1 1 auto';

  const sel = document.createElement('select');
  const colors = ['grey','blue','red','yellow','green','pink','purple','cyan','orange'];
  colors.forEach(c => {
    const o = document.createElement('option');
    o.value = c; o.textContent = c;
    sel.appendChild(o);
  });

  const createBtn = document.createElement('div');
  createBtn.className = 'btn';
  createBtn.textContent = 'Create';
  createBtn.onclick = async (e) => {
    e.stopPropagation(); e.preventDefault();
    const t = (inp.value || '').trim();
    if (!t) return;
    suppressClickUntil = Date.now() + 700;
    await safeRuntimeSendMessageWithRetry({ action: 'GROUP_TAB_NEW', tabId, title: t, color: sel.value }, 3);
    closeActivePopover();
    handleStateChange();
  };

  newRow.appendChild(inp);
  newRow.appendChild(sel);
  newRow.appendChild(createBtn);
  pop.appendChild(newRow);

  const divider = document.createElement('div');
  divider.style.cssText = `all: initial; height:1px; background:#333; margin:8px 0; display:block;`;
  pop.appendChild(divider);

  const groups = Array.isArray(cachedTabGroups) ? cachedTabGroups : [];
  if (!groups.length) {
    const empty = document.createElement('div');
    empty.className = 'row';
    empty.style.opacity = '0.8';
    empty.textContent = 'No existing groups in this window.';
    pop.appendChild(empty);
  } else {
    groups.forEach(g => {
      const item = document.createElement('div');
      item.className = 'group-item';
      const sw = document.createElement('div');
      sw.className = 'swatch';
      sw.style.background = GROUP_COLOR_MAP[g.color] || GROUP_COLOR_MAP.default;
      const tx = document.createElement('div');
      tx.textContent = g.title || 'Group';
      tx.style.cssText = `all: initial; font-family:${GLOBAL_FONT}; font-size:13px; color:#fff; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;`;
      item.appendChild(sw);
      item.appendChild(tx);
      item.onclick = async (e) => {
        e.stopPropagation(); e.preventDefault();
        suppressClickUntil = Date.now() + 700;
        await safeRuntimeSendMessageWithRetry({ action: 'GROUP_TAB', tabId, groupId: g.id }, 3);
        closeActivePopover();
        handleStateChange();
      };
      pop.appendChild(item);
    });
  }

  activePopover = pop;
  document.body.appendChild(pop);
  document.addEventListener('mousedown', onDocMouseDown, true);
  document.addEventListener('keydown', onDocKeyDown, true);

  // Focus input for quick create
  setTimeout(() => { try { inp.focus(); } catch {} }, 0);
}

function createLevel2Favicon(tab, { interactive = true } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'tz-lvl2-fav-wrap';
  wrap.title = tab.title || tab.url || '';

  const fav = createFaviconElement(tab);
  // force Level-2 favicon size + do not capture pointer (wrapper does)
  fav.style.width = 'var(--tz-lvl2-fav)';
  fav.style.height = 'var(--tz-lvl2-fav)';
  fav.style.flex = '0 0 var(--tz-lvl2-fav)';
  
  if (interactive) {
    wrap.onmousedown = (e) => { e.stopPropagation(); e.preventDefault(); };
    wrap.onclick = (e) => { e.stopPropagation(); e.preventDefault(); handleTabClick(tab.id); };
  } else {
    // Let the parent tile handle click/drag.
    wrap.style.pointerEvents = 'none';
    fav.style.pointerEvents = 'none';
  }

  wrap.appendChild(fav);

  return wrap;
}

// NEW: Level-1 pinned favicon-only element
function createPinnedFavicon(tab, isCurrent) {
  const wrap = document.createElement('div');
  wrap.className = 'tz-pin-fav-wrap';
  wrap.title = tab.title || tab.url || '';
  wrap.draggable = true;
  wrap.setAttribute('draggable', 'true');
  wrap.dataset.tzDraggable = 'tab';
  wrap.dataset.tabId = String(tab.id);
  wrap.dataset.tzKind = 'pinned';

  if (isCurrent) {
    wrap.style.outline = `2px solid ${INDICATOR_COLOR}`;
    wrap.style.outlineOffset = '2px';
  }

  const fav = createFaviconElement(tab);
  fav.style.pointerEvents = 'none';
  wrap.appendChild(fav);

  wrap.onmousedown = (e) => { e.stopPropagation(); };
  wrap.onclick = (e) => { e.stopPropagation(); e.preventDefault(); handleTabClick(tab.id); };

  return wrap;
}

function getDisplayedTitle(title) {
  if (!title) return "";
  return title.length > MAX_TITLE_LENGTH ? title.substring(0, MAX_TITLE_LENGTH) + "..." : title;
}

// -------------------------------
// Level 1 helpers (unchanged)
// -------------------------------
function createTabButton(tab, isCurrent, kind = 'web') {
  const btn = document.createElement('div');
  btn.className = 'tz-tab-btn';
  btn.title = tab.title || tab.url || "";
  btn.draggable = true;
  btn.setAttribute('draggable', 'true');
  btn.dataset.tzDraggable = 'tab';
  btn.dataset.tabId = String(tab.id);
  btn.dataset.tzKind = kind;

  btn.style.cssText =
    `all: initial; box-sizing:border-box; font-family:${GLOBAL_FONT};` +
    `height:100%; width:var(--tz-tab-w); display:flex; align-items:center;` +
    `padding:0 var(--tz-pad-x); margin:0 var(--tz-gap-x);` +
    `flex:0 0 auto; overflow:hidden; cursor:pointer; user-select:none;` +
    `-webkit-user-drag:element;` +
    `background:${isCurrent ? '#3a3a3a' : '#282828'};` +
    `color:${isCurrent ? '#ffffff' : '#cccccc'};` +
    `border-bottom:var(--tz-ind-h) solid ${isCurrent ? INDICATOR_COLOR : 'transparent'};` +
    `transition:background 0.2s;`;

  btn.onmouseover = () => { if (!isCurrent) btn.style.background = '#333'; };
  btn.onmouseout = () => { if (!isCurrent) btn.style.background = '#282828'; };

  const fav = createFaviconElement(tab);
  fav.style.pointerEvents = 'none';
  btn.appendChild(fav);

  const text = document.createElement('span');
  text.textContent = getDisplayedTitle(tab.title || tab.url);
  text.style.cssText =
    `all: initial; margin-left:var(--tz-icon-gap); font-family:${GLOBAL_FONT};` +
    `font-size:var(--tz-font); line-height:1; color:inherit;` +
    `white-space:nowrap; overflow:hidden; text-overflow:ellipsis; display:block;`;
  text.style.pointerEvents = 'none';
  btn.appendChild(text);

  const actions = document.createElement('div');
  actions.style.cssText =
    `all: initial; margin-left:auto; flex:0 0 auto; display:flex; align-items:center; gap:6px;` +
    `height:18px;`;
  if (kind === 'web') actions.appendChild(createGroupButton(tab.id));
  actions.appendChild(createCloseButton(tab.id));
  btn.appendChild(actions);

  btn.onclick = () => handleTabClick(tab.id);
  return btn;
}

function createSeparator() {
  const sep = document.createElement('div');
  sep.style.cssText =
    `all: initial; width:var(--tz-sep-w); height:60%; background:#444;` +
    `margin:0 var(--tz-sep-mx); flex:0 0 auto; display:block;`;
  return sep;
}

function createInlinePlusWrapper() {
  const wrapper = document.createElement('div');
  wrapper.className = 'inline-plus-wrapper';
  wrapper.style.cssText = `all: initial; display:flex; align-items:center; height:100%; flex:0 0 auto;`;

  wrapper.appendChild(createSeparator());

  const btn = document.createElement('div');
  btn.textContent = '+';
  btn.style.cssText =
    `all: initial; width:var(--tz-plus-w); height:100%;` +
    `display:flex; align-items:center; justify-content:center;` +
    `cursor:pointer; user-select:none; font-family:${GLOBAL_FONT};` +
    `font-size:calc(var(--tz-font) * 1.6); color:${INDICATOR_COLOR}; font-weight:700;` +
    `transition:transform 0.2s;`;

  btn.onclick = (e) => { e.stopPropagation(); handleNewTab(); };
  btn.onmouseover = () => { btn.style.transform = 'scale(1.1)'; };
  btn.onmouseout = () => { btn.style.transform = 'scale(1.0)'; };

  wrapper.appendChild(btn);
  return wrapper;
}

function createStickyPlus() {
  const btn = document.createElement('div');
  btn.className = 'plus-sticky';
  btn.textContent = '+';
  btn.style.cssText =
    `all: initial; position:sticky; right:0; z-index:100;` +
    `flex:0 0 auto; width:var(--tz-plus-w); height:100%;` +
    `display:none; align-items:center; justify-content:center;` +
    `background:#202020; cursor:pointer; user-select:none;` +
    `border-left:var(--tz-sep-w) solid #333; font-family:${GLOBAL_FONT};` +
    `color:${INDICATOR_COLOR}; font-weight:700; font-size:calc(var(--tz-font) * 1.6);` +
    `transition:transform 0.2s;`;

  btn.onclick = handleNewTab;
  btn.onmouseover = () => { btn.style.transform = 'scale(1.1)'; };
  btn.onmouseout = () => { btn.style.transform = 'scale(1.0)'; };
  return btn;
}

function updateDynamicLayout() {
  if (isInternalResize) return;

  const bar = document.getElementById('ungroup-automatic-tab-bar');
  if (!bar) return;

  const scrollContainer = bar.querySelector('.scroll-container');
  const stickyPlus = bar.querySelector('.plus-sticky');
  const inlinePlus = bar.querySelector('.inline-plus-wrapper');

  if (scrollContainer && stickyPlus && inlinePlus) {
    const hasScroll = scrollContainer.scrollWidth > scrollContainer.clientWidth + 1;
    stickyPlus.style.display = hasScroll ? 'flex' : 'none';
    inlinePlus.style.display = hasScroll ? 'none' : 'flex';
  }

  applyPageShift();
}

// -------------------------------
// Page shift + collision handling (UNCHANGED from your provided file)
// -------------------------------

const TZ_BAR_ID = 'ungroup-automatic-tab-bar';
const TZ_SHIFT_ATTR = 'data-tz-top-shifted';
const TZ_SAFE_STYLE_ATTR = 'data-tz-safe-areas';
const TZ_MAX_SHIFT_TARGETS = 6;

let _tzShifted = new Map();
let _tzLastBarH = null;
let _tzShiftRAF = 0;

const TZ_CLIP_ATTR = 'data-tz-safe-bottom-clipper';
let _tzClipperEl = null;
let _tzClipperPrev = null;

function getOverrides() { return (window && window.__TZ_SITE_OVERRIDES__) ? window.__TZ_SITE_OVERRIDES__ : null; }

function getBarHeightPx() {
  const bar = document.getElementById(TZ_BAR_ID);
  if (!bar) return 0;
  const r = bar.getBoundingClientRect();
  return Math.round(r.height || 0);
}

function ensureSafeAreasStyle() {
  if (document.head?.querySelector(`style[${TZ_SAFE_STYLE_ATTR}]`)) return;

  const st = document.createElement('style');
  st.setAttribute(TZ_SAFE_STYLE_ATTR, 'true');
  st.textContent = `
    :root{ --tz-safe-top: var(--tz-h); --tz-safe-bottom: min(var(--tz-h), 48px); }
    body{
      padding-top: var(--tz-safe-top) !important;
      padding-bottom: var(--tz-safe-bottom) !important;
      box-sizing: border-box !important;
    }
  `;
  document.head.appendChild(st);
}

function setInlineSafeAreasFallback() {
  const body = document.body;
  if (!body) return;
  body.style.setProperty('padding-top', `var(--tz-h)`, 'important');
  body.style.setProperty('padding-bottom', `min(var(--tz-h), 48px)`, 'important');
  body.style.setProperty('box-sizing', 'border-box', 'important');
}

function restoreShiftedHeaders() {
  for (const [el, prev] of _tzShifted.entries()) {
    try {
      if (prev.top == null) el.style.removeProperty('top'); else el.style.top = prev.top;
      if (prev.marginTop == null) el.style.removeProperty('margin-top'); else el.style.marginTop = prev.marginTop;
      if (prev.transform == null) el.style.removeProperty('transform'); else el.style.transform = prev.transform;
      if (prev.willChange == null) el.style.removeProperty('will-change'); else el.style.willChange = prev.willChange;
      el.removeAttribute(TZ_SHIFT_ATTR);
    } catch {}
  }
  _tzShifted.clear();
}

function restoreSafeBottomClipper() {
  if (!_tzClipperEl) return;
  try {
    const prev = _tzClipperPrev || {};
    if (prev.paddingBottom == null) _tzClipperEl.style.removeProperty('padding-bottom'); else _tzClipperEl.style.paddingBottom = prev.paddingBottom;
    if (prev.boxSizing == null) _tzClipperEl.style.removeProperty('box-sizing'); else _tzClipperEl.style.boxSizing = prev.boxSizing;
    _tzClipperEl.removeAttribute(TZ_CLIP_ATTR);
  } catch {}
  _tzClipperEl = null;
  _tzClipperPrev = null;
}

function overlap(a, b) { return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom); }

function safeSel(el) {
  if (!el || el.nodeType !== 1) return '';
  const id = el.id ? `#${el.id}` : '';
  const cls = (el.className && typeof el.className === 'string')
    ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
    : '';
  return `${el.tagName.toLowerCase()}${id}${cls}`;
}

function findTopFixedHeaderCandidates(barRect, barH) {
  const vpW = window.innerWidth;
  const maxH = Math.max(80, Math.min(220, barH * 6));
  const els = Array.from(document.querySelectorAll('body *'));
  const out = [];

  for (const el of els) {
    try {
      if (el.id === TZ_BAR_ID) continue;
      const bar = document.getElementById(TZ_BAR_ID);
      if (bar && (el === bar || bar.contains(el))) continue;

      const cs = getComputedStyle(el);
      const pos = cs.position;
      if (pos !== 'fixed' && pos !== 'sticky') continue;

      const topCss = cs.top;
      const topPx = parseFloat(topCss);
      const topOk = topCss === '0px' || (isFinite(topPx) && topPx <= 1);
      if (!topOk) continue;

      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;

      const r = el.getBoundingClientRect();
      if (r.width < vpW * 0.6) continue;
      if (r.height < 20 || r.height > maxH) continue;

      if (r.top > barH + 6) continue;
      if (!overlap(r, barRect)) continue;

      const area = r.width * r.height;
      if (area > (vpW * maxH * 0.98)) continue;

      const z = cs.zIndex === 'auto' ? 0 : (parseInt(cs.zIndex, 10) || 0);
      out.push({ el, r, cs, z, selector: safeSel(el) });
    } catch {}
  }

  out.sort((a, b) => (b.z - a.z) || (a.r.top - b.r.top) || (a.r.height - b.r.height));
  return out.slice(0, TZ_MAX_SHIFT_TARGETS);
}

function applyShiftToCandidate(cand, barH) {
  const el = cand.el;
  const cs = cand.cs;
  if (_tzShifted.has(el)) return;

  const prev = {
    top: el.style.top || null,
    marginTop: el.style.marginTop || null,
    transform: el.style.transform || null,
    willChange: el.style.willChange || null
  };
  _tzShifted.set(el, prev);

  const overrides = getOverrides();
  const overrideMode = overrides?.headerShiftMode?.(el)?.mode || null;

  const topCss = cs.top;
  const topPx = parseFloat(topCss);
  const baseTop = (topCss === 'auto' || !isFinite(topPx)) ? 0 : topPx;

  const mustTransform = (cs.position === 'sticky') || (overrideMode === 'transform');
  if (mustTransform) {
    el.style.willChange = 'transform';
    el.style.transform = (prev.transform && prev.transform !== 'none')
      ? `translateY(${barH}px) ${prev.transform}`
      : `translateY(${barH}px)`;
  } else {
    el.style.top = `${baseTop + barH}px`;
  }

  el.setAttribute(TZ_SHIFT_ATTR, 'true');
}

function shiftOverlappingTopHeaders() {
  const bar = document.getElementById(TZ_BAR_ID);
  if (!bar) return;

  const barRect = bar.getBoundingClientRect();
  const barH = Math.round(barRect.height || 0);
  if (!barH) return;

  if (_tzLastBarH !== barH) {
    restoreShiftedHeaders();
    _tzLastBarH = barH;
  }

  const cands = findTopFixedHeaderCandidates(barRect, barH);
  for (const c of cands) applyShiftToCandidate(c, barH);
}

function findViewportBottomClipper() {
  const overrides = getOverrides();
  const forced = overrides?.getSafeBottomContainer?.();
  if (forced && forced.nodeType === 1) return forced;

  const cx = Math.floor(window.innerWidth / 2);
  const cy = Math.floor(window.innerHeight / 2);
  let el = document.elementFromPoint(cx, cy);
  if (!el) return null;

  const barH = getBarHeightPx();
  const vpBottom = window.innerHeight;
  const nearBottomPx = 6;

  for (let i = 0; el && i < 22; i++) {
    try {
      if (el.id === TZ_BAR_ID) { el = el.parentElement; continue; }
      const bar = document.getElementById(TZ_BAR_ID);
      if (bar && bar.contains(el)) { el = el.parentElement; continue; }

      const cs = getComputedStyle(el);
      const ovY = cs.overflowY;
      const ov = cs.overflow;
      const clips = (ovY === 'hidden' || ovY === 'clip' || ov === 'hidden' || ov === 'clip');
      if (!clips) { el = el.parentElement; continue; }

      const r = el.getBoundingClientRect();
      if (r.height < 200 || r.width < window.innerWidth * 0.4) { el = el.parentElement; continue; }

      const topOk = r.top >= (barH - 2) || el === document.documentElement;
      const bottomOk = Math.abs(r.bottom - vpBottom) <= nearBottomPx;

      if (topOk && bottomOk) return el;
    } catch {}
    el = el.parentElement;
  }

  return null;
}

function applySafeBottomToClipper() {
  const clipper = findViewportBottomClipper();
  if (!clipper) return restoreSafeBottomClipper();
  if (_tzClipperEl === clipper) return;

  restoreSafeBottomClipper();

  _tzClipperEl = clipper;
  _tzClipperPrev = {
    paddingBottom: clipper.style.paddingBottom || null,
    boxSizing: clipper.style.boxSizing || null
  };

  try {
    clipper.style.setProperty('box-sizing', 'border-box', 'important');
    clipper.style.setProperty('padding-bottom', 'var(--tz-safe-bottom)', 'important');
    clipper.setAttribute(TZ_CLIP_ATTR, 'true');
  } catch {}
}

function scheduleHeaderShift() {
  if (_tzShiftRAF) cancelAnimationFrame(_tzShiftRAF);
  _tzShiftRAF = requestAnimationFrame(() => {
    _tzShiftRAF = 0;
    shiftOverlappingTopHeaders();
    applySafeBottomToClipper();
  });
}

function applyPageShift() {
  const body = document.body;
  if (!body) return;

  try { ensureSafeAreasStyle(); } catch {}
  try { setInlineSafeAreasFallback(); } catch {}

  scheduleHeaderShift();

  isInternalResize = true;
  window.dispatchEvent(new Event('resize'));
  setTimeout(() => { isInternalResize = false; }, 80);
}

// -------------------------------
// Bar + rendering
// -------------------------------
function ensureBar() {
  ensureSizingStyle();
  applyZoomCompensatedMetrics(false);

  let bar = document.getElementById('ungroup-automatic-tab-bar');
  if (bar && !document.body?.contains(bar)) {
    try { bar.remove(); } catch {}
    bar = null;
  }
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'ungroup-automatic-tab-bar';
    (document.body || document.documentElement).appendChild(bar);
  }
  installDragAndDropHandlers();
  return bar;
}

function renderDisconnectedBar(reason = 'Disconnected') {
  const bar = ensureBar();

  bar.innerHTML = '';
  bar.style.cssText =
    `all: initial; position:fixed !important; top:0 !important; left:0 !important;` +
    `width:100% !important; height:var(--tz-h) !important; display:flex !important; align-items:center !important;` +
    `background:#202020 !important; border-bottom:1px solid #000 !important; z-index:2147483647 !important;` +
    `margin:0 !important; padding:0 var(--tz-group-min-pad-x) !important; overflow:hidden !important;` +
    `font-family:${GLOBAL_FONT} !important; color:#fff !important; font-size:var(--tz-font) !important;` +
    `box-sizing:border-box !important;`;

  const msg = document.createElement('div');
  msg.style.cssText =
    `all: initial; font-family:${GLOBAL_FONT}; font-size:var(--tz-font); color:#fff; cursor:pointer; user-select:none;`;
  msg.textContent = `Tab bar: ${reason} (click to retry)`;
  msg.onclick = () => requestTabList();
  bar.appendChild(msg);

  applyPageShift();
}

function renderFakeTabBar(currentTabId, pinnedTabs, webTabs, systemTabs, isCurrentTabGrouped, currentTabTitle, allTabGroups) {
  const bar = ensureBar();

  bar.innerHTML = '';
  bar.style.cssText =
    `all: initial; position:fixed !important; top:0 !important; left:0 !important;` +
    `width:100% !important; height:var(--tz-h) !important; display:flex !important; align-items:center !important;` +
    `background:#202020 !important; border-bottom:1px solid #000 !important; z-index:2147483647 !important;` +
    `margin:0 !important; padding:0 !important; overflow:hidden !important; font-family:${GLOBAL_FONT} !important;` +
    `box-sizing:border-box !important;`;

  const trigger = document.createElement('div');
  trigger.className = 'tz-tab-btn';
  trigger.style.cssText =
    `all: initial; box-sizing:border-box; flex:0 0 auto; width:var(--tz-tab-w); height:100%; display:flex; align-items:center;` +
    `padding:0 var(--tz-pad-x); margin-right:var(--tz-gap-x); cursor:pointer; user-select:none; overflow:hidden;` +
    `font-family:${GLOBAL_FONT}; font-size:var(--tz-font);` +
    `background:${isCurrentTabGrouped ? '#3a3a3a' : '#282828'};` +
    `border-bottom:var(--tz-ind-h) solid ${isCurrentTabGrouped ? INDICATOR_COLOR : 'transparent'}; transition:background 0.2s;`;

  const triggerLabel = isCurrentTabGrouped
    ? getDisplayedTitle(currentTabTitle)
    : (allTabGroups.length > 0 ? 'Groups' : 'GD Manager');

  const caret = document.createElement('span');
  caret.textContent = '▼';
  caret.style.cssText =
    `all: initial; color:${INDICATOR_COLOR}; margin-right:var(--tz-icon-gap); flex:0 0 auto; font-family:${GLOBAL_FONT}; font-size:var(--tz-font);`;
  trigger.appendChild(caret);

  const lbl = document.createElement('span');
  lbl.textContent = triggerLabel;
  lbl.style.cssText =
    `all: initial; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:${isCurrentTabGrouped ? '#fff' : '#ccc'};` +
    `font-family:${GLOBAL_FONT}; font-size:var(--tz-font);`;
  trigger.appendChild(lbl);

  if (isCurrentTabGrouped && currentTabId != null) trigger.appendChild(createCloseButton(currentTabId));

  trigger.onclick = () => {
    if (allTabGroups.length === 1) {
      currentViewedGroupId = allTabGroups[0].id;
      navigationState = NAV_LEVELS.LEVEL_3;
    } else if (allTabGroups.length > 1) {
      navigationState = NAV_LEVELS.LEVEL_2;
    }
    handleStateChange();
  };
  trigger.onmouseover = () => { trigger.style.background = '#444'; };
  trigger.onmouseout = () => { trigger.style.background = isCurrentTabGrouped ? '#3a3a3a' : '#282828'; };

  bar.appendChild(trigger);

  const scrollContainer = document.createElement('div');
  scrollContainer.className = 'scroll-container';
  scrollContainer.style.cssText =
    `all: initial; display:flex; flex:1 1 auto; min-width:0; align-items:center; height:100%;` +
    `overflow-x:auto; overflow-y:hidden; scrollbar-width:none; position:relative;`;

  const pinnedSorted = [...(pinnedTabs || [])].sort((a, b) => a.index - b.index);
  const webSorted = [...(webTabs || [])].sort((a, b) => a.index - b.index);
  const sysSorted = [...(systemTabs || [])].sort((a, b) => a.index - b.index);

  // CHANGED: pinned shown as favicon-only (not as tab tiles)
  pinnedSorted.forEach(tab => scrollContainer.appendChild(createPinnedFavicon(tab, tab.id === currentTabId)));

  webSorted.forEach(tab => scrollContainer.appendChild(createTabButton(tab, tab.id === currentTabId, 'web')));

  scrollContainer.appendChild(createInlinePlusWrapper());

  if (sysSorted.length > 0) {
    scrollContainer.appendChild(createSeparator());
    sysSorted.forEach(tab => scrollContainer.appendChild(createTabButton(tab, tab.id === currentTabId, 'system')));
  }

  scrollContainer.appendChild(createStickyPlus());
  bar.appendChild(scrollContainer);

  updateDynamicLayout();
}

function navigateBack() {
  // Level 3 -> Level 2 (if multiple groups), else Level 1
  navigationState = (navigationState === NAV_LEVELS.LEVEL_3 && cachedTabGroups.length > 1) ? NAV_LEVELS.LEVEL_2 : NAV_LEVELS.LEVEL_1;
  currentViewedGroupId = null;
  handleStateChange();
}

function requestTabList() {
  safeRuntimeSendMessageWithRetry({ action: "GET_UNGROUPED_TABS" }, 5).then((response) => {
    if (!response) {
      renderDisconnectedBar('no receiver in background (GET_UNGROUPED_TABS)');
      return;
    }

    cachedTabGroups = response.allTabGroups || [];

    if (navigationState === NAV_LEVELS.LEVEL_1) {
      renderFakeTabBar(
        response.currentTabId,
        response.pinnedTabs || [],
        response.webTabs || [],
        response.systemTabs || [],
        !!response.isCurrentTabGrouped,
        response.currentTabTitle || '',
        cachedTabGroups
      );
    } else {
      handleStateChange();
    }
  });
}

function handleStateChange() {
  if (navigationState === NAV_LEVELS.LEVEL_1) return requestTabList();

  const msg = (navigationState === NAV_LEVELS.LEVEL_2)
    ? { action: "GET_UNGROUPED_TABS" }
    : { action: "GET_GROUP_TABS", groupId: currentViewedGroupId };

  safeRuntimeSendMessageWithRetry(msg, 5).then((response) => {
    if (!response) return renderDisconnectedBar('no receiver in background');

    if (navigationState === NAV_LEVELS.LEVEL_2) {
      const groups = response.allTabGroups || cachedTabGroups || [];
      renderNavigationBar(groups);
    } else {
      const tabsSorted = [...(response.tabs || [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      renderNavigationBar(tabsSorted, response.groupTitle || 'Group');
    }
  });
}

function renderNavigationBar(data, currentGroupTitle = 'Groups List') {
  const bar = ensureBar();

  bar.innerHTML = '';
  bar.style.cssText =
    `all: initial; position:fixed !important; top:0 !important; left:0 !important;` +
    `width:100% !important; height:var(--tz-h) !important; display:flex !important; align-items:center !important;` +
    `background:#202020 !important; border-bottom:1px solid #000 !important; z-index:2147483647 !important;` +
    `margin:0 !important; padding:0 !important; overflow:hidden !important; font-family:${GLOBAL_FONT} !important;` +
    `box-sizing:border-box !important;`;

  const backBtn = document.createElement('div');
  backBtn.style.cssText =
    `all: initial; box-sizing:border-box; flex:0 0 auto; width:var(--tz-tab-w); height:100%; display:flex; align-items:center;` +
    `padding:0 var(--tz-pad-x); margin-right:var(--tz-gap-x); cursor:pointer; user-select:none; overflow:hidden;` +
    `font-family:${GLOBAL_FONT}; font-size:var(--tz-font); background:#3a3a3a; transition:background 0.2s;`;

  backBtn.innerHTML =
    `<span style="color:${INDICATOR_COLOR}; margin-right:var(--tz-icon-gap); flex:0 0 auto; font-family:${GLOBAL_FONT}; font-size:var(--tz-font);">${BACK_ARROW}</span>` +
    `<span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#fff; font-family:${GLOBAL_FONT}; font-size:var(--tz-font);">${getDisplayedTitle(currentGroupTitle)}</span>`;

  backBtn.onclick = (e) => { e.stopPropagation(); navigateBack(); };
  backBtn.onmouseover = () => { backBtn.style.background = '#444'; };
  backBtn.onmouseout = () => { backBtn.style.background = '#3a3a3a'; };
  bar.appendChild(backBtn);

  const container = document.createElement('div');
  container.className = 'scroll-container';
  container.style.cssText =
    `all: initial; display:flex; flex:1 1 auto; min-width:0; align-items:center; height:100%;` +
    `overflow-x:auto; overflow-y:hidden; scrollbar-width:none; position:relative;`;

  const items = Array.isArray(data) ? data : [];

  items.forEach(item => {
    const isLevel2Groups = (navigationState === NAV_LEVELS.LEVEL_2);
    const isLevel3GroupTabs = (navigationState === NAV_LEVELS.LEVEL_3);

    const itemBtn = document.createElement('div');
    itemBtn.title = item.title || item.url || "";

    const base =
      `all: initial; box-sizing:border-box; height:100%; display:flex; align-items:center;` +
      `background:#282828; cursor:pointer; user-select:none; overflow:hidden; transition:background 0.2s;` +
      `font-family:${GLOBAL_FONT}; font-size:var(--tz-font); margin:0 var(--tz-gap-x); flex:0 0 auto;`;

    itemBtn.style.cssText = isLevel2Groups
      ? `${base} padding:0 var(--tz-group-min-pad-x); min-width:var(--tz-tab-w);`
      : `${base} width:var(--tz-tab-w); padding:0 var(--tz-pad-x);`;

    itemBtn.onmouseover = () => { itemBtn.style.background = '#333'; };
    itemBtn.onmouseout = () => { itemBtn.style.background = '#282828'; };

    const titleSpan = document.createElement('span');
    titleSpan.textContent = getDisplayedTitle(item.title || item.url);
    titleSpan.style.cssText =
      `all: initial; font-family:${GLOBAL_FONT}; font-size:var(--tz-font); line-height:1;` +
      `white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:inherit;`;

    if (isLevel2Groups) {
      // -----------------------
      // Level 2: groups list
      // Requirement: show ALL favicons inside group tile; favicon is clickable and switches tab.
      // Note: Needs group.tabs from GET_UNGROUPED_TABS; if missing, we fall back to title-only.
      // -----------------------
      const groupColorHex = GROUP_COLOR_MAP[item.color] || GROUP_COLOR_MAP.default;
      itemBtn.style.borderBottom = `var(--tz-ind-h) solid ${groupColorHex}`;
      itemBtn.style.color = groupColorHex;

      itemBtn.appendChild(titleSpan);

      // Favicons container (no fixed width; only min-width on the whole tile)
      const favs = Array.isArray(item.tabs) ? item.tabs : [];
      if (favs.length > 0) {
        const favRow = document.createElement('div');
        favRow.style.cssText =
          `all: initial; display:flex; align-items:center; flex:0 0 auto;` +
          `margin-left:var(--tz-lvl2-fav-ml); gap:4px;`;

        favs.forEach(tab => {
          // Clickable favicon -> open directly the tab (switch)
          favRow.appendChild(createLevel2Favicon(tab));
        });

        itemBtn.appendChild(favRow);
      }

      // Click on group tile (not favicon) -> Level 3
      itemBtn.onclick = (e) => {
        e.stopPropagation();
        currentViewedGroupId = item.id;
        navigationState = NAV_LEVELS.LEVEL_3;
        handleStateChange();
      };
    } else if (isLevel3GroupTabs) {
      // -----------------------
      // Level 3: tabs inside group
      // (kept as in your file: shows favicon + title + close)
      // -----------------------
      itemBtn.className = 'tz-tab-btn';
      itemBtn.draggable = true;
      itemBtn.setAttribute('draggable', 'true');
      itemBtn.style.setProperty('-webkit-user-drag', 'element');
      itemBtn.dataset.tzDraggable = 'tab';
      itemBtn.dataset.tabId = String(item.id);
      itemBtn.dataset.tzKind = 'group';
      itemBtn.dataset.groupId = String(item.groupId ?? currentViewedGroupId ?? '');

      // IMPORTANT: favicon is ALWAYS inserted and forced visible
      itemBtn.appendChild(createLevel2Favicon(item, { interactive: false }));

      const label = titleSpan;
      label.style.marginLeft = 'var(--tz-icon-gap)';
      label.style.color = '#fff';
      label.style.pointerEvents = 'none';
      itemBtn.appendChild(label);

      itemBtn.appendChild(createUngroupButton(item.id));
      itemBtn.appendChild(createCloseButton(item.id));
      itemBtn.onclick = () => handleTabClick(item.id);
    } else {
      // Safety fallback (should not happen)
      itemBtn.appendChild(titleSpan);
      itemBtn.onclick = (e) => { e.stopPropagation(); };
    }

    container.appendChild(itemBtn);
  });

  container.appendChild(createStickyPlus());
  bar.appendChild(container);

  updateDynamicLayout();
}

// -------------------------------
// Drag & drop (tabs reorder only within same "nature")
// pinned <-> pinned, web <-> web, system <-> system, group tabs <-> same group
// -------------------------------
const dragState = {
  sourceTabId: null,
  sourceKind: null,   // 'pinned' | 'web' | 'system' | 'group'
  sourceGroupId: null,
  overEl: null,
  placement: null,    // 'before' | 'after'
};

function closestDraggableTabEl(node) {
  if (!node || !node.closest) return null;
  return node.closest('[data-tz-draggable="tab"][data-tab-id]');
}

function clearDropIndicator() {
  if (!dragState.overEl) return;
  dragState.overEl.classList.remove('tz-drop-before', 'tz-drop-after');
  dragState.overEl.style.boxShadow = '';
  dragState.overEl = null;
  dragState.placement = null;
}

function setDropIndicator(el, placement) {
  if (!el) return;
  if (dragState.overEl && dragState.overEl !== el) clearDropIndicator();
  dragState.overEl = el;
  dragState.placement = placement;
  el.classList.toggle('tz-drop-before', placement === 'before');
  el.classList.toggle('tz-drop-after', placement === 'after');
  el.style.boxShadow = (placement === 'before')
    ? `inset 0 2px 0 0 ${INDICATOR_COLOR}`
    : `inset 0 -2px 0 0 ${INDICATOR_COLOR}`;
}

function canDropOn(targetEl) {
  if (!targetEl) return false;
  const targetKind = targetEl.dataset.tzKind || '';
  if (!dragState.sourceTabId || !dragState.sourceKind) return false;
  if (targetEl.dataset.tabId === dragState.sourceTabId) return false;
  if (targetKind !== dragState.sourceKind) return false;
  if (dragState.sourceKind === 'group') {
    const tgtG = targetEl.dataset.groupId || '';
    return !!tgtG && tgtG === (dragState.sourceGroupId || '');
  }
  return true;
}

async function handleMoveTab(sourceTabId, targetTabId, placement) {
  suppressClickUntil = Date.now() + 700;
  await safeRuntimeSendMessageWithRetry({
    action: 'MOVE_TAB',
    tabId: Number(sourceTabId),
    targetTabId: Number(targetTabId),
    placement
  }, 3);
  handleStateChange(); // refresh current view (Level 1/2/3)
}

function installDragAndDropHandlers() {
  const bar = document.getElementById(TZ_BAR_ID);
  if (!bar) return;
  if (bar.dataset.tzDndInstalled === '1') return;
  bar.dataset.tzDndInstalled = '1';

  bar.addEventListener('dragstart', (e) => {
    const el = closestDraggableTabEl(e.target);
    if (!el) return;

    dragState.sourceTabId = el.dataset.tabId;
    dragState.sourceKind = el.dataset.tzKind || null;
    dragState.sourceGroupId = el.dataset.groupId || null;

    el.classList.add('tz-dragging');
    el.style.opacity = '0.65';
    suppressClickUntil = Date.now() + 700;

    try {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragState.sourceTabId);
    } catch { /* ignore */ }
  }, true);

  bar.addEventListener('dragover', (e) => {
    if (!dragState.sourceTabId) return;
    const el = closestDraggableTabEl(e.target);
    if (!el) return;
    if (!canDropOn(el)) return;

    e.preventDefault(); // required to allow drop

    const r = el.getBoundingClientRect();
    const mid = r.top + (r.height / 2);
    const placement = (e.clientY < mid) ? 'before' : 'after';
    setDropIndicator(el, placement);
  }, true);

  bar.addEventListener('drop', (e) => {
    if (!dragState.sourceTabId) return;
    const el = closestDraggableTabEl(e.target);
    if (!el || !canDropOn(el)) return;

    e.preventDefault();

    const targetTabId = el.dataset.tabId;
    const placement = dragState.placement || 'before';

    clearDropIndicator();
    handleMoveTab(dragState.sourceTabId, targetTabId, placement).catch(() => {});
  }, true);

  bar.addEventListener('dragend', () => {
    const dragging = bar.querySelector('.tz-dragging');
    if (dragging) {
      dragging.classList.remove('tz-dragging');
      dragging.style.opacity = '';
    }
    clearDropIndicator();
    dragState.sourceTabId = null;
    dragState.sourceKind = null;
    dragState.sourceGroupId = null;
    suppressClickUntil = Date.now() + 500;
  }, true);
}

// -------------------------------
// Event hooks (zoom/resize)
// -------------------------------
function hookViewportEvents() {
  let dprMQ = null;

  function installDprListener() {
    try {
      const dpr = window.devicePixelRatio || 1;
      dprMQ?.removeEventListener?.('change', onDprChange);
      dprMQ = window.matchMedia(`(resolution: ${dpr}dppx)`);
      dprMQ.addEventListener?.('change', onDprChange);
    } catch {}
  }

  function onDprChange() {
    scheduleMetricsUpdate(true);
    installDprListener();
  }

  window.addEventListener('resize', () => {
    if (!isInternalResize) scheduleMetricsUpdate(false);
  });

  window.addEventListener('focus', () => {
    scheduleMetricsUpdate(false);
    requestTabList();
    installDprListener();
  });

  const vv = window.visualViewport;
  if (vv && vv.addEventListener) {
    const onVV = () => scheduleMetricsUpdate(false);
    vv.addEventListener('resize', onVV, { passive: true });
    vv.addEventListener('scroll', onVV, { passive: true });
  }

  installDprListener();
}

// -------------------------------
// Boot
// -------------------------------
try {
  chrome?.runtime?.onMessage?.addListener((request) => {
    if (request.action === "REFRESH_BAR") requestTabList();
  });
} catch {}

function boot() {
  try {
    captureBaseDPR();
    safeConnectPort();
    ensureBar();
    applyZoomCompensatedMetrics(true);
    requestTabList();
  } catch {
    renderDisconnectedBar('boot failed');
  }
}

hookViewportEvents();
boot();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    applyZoomCompensatedMetrics(true);
    boot();
  }, { once: true });
}
