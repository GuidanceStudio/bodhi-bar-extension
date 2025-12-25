/**
 * CONTENT.JS - Bodhi Bar UI Engine (v2.5.7)
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
const SEARCH_ICON = '⌕';

const GROUP_COLOR_MAP = {
  grey: '#5f6368', blue: '#8ab4f8', red: '#f28b82', yellow: '#fdd663',
  green: '#81c995', pink: '#ff80ab', purple: '#c589d7', cyan: '#78d9ec',
  orange: '#fcc934', default: '#505050'
};

const WEB_URL_RE = /^https?:\/\//i;

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
let cachedAllTabs = []; // for Level-1 search (includes grouped + ungrouped + pinned)
let searchQuery = '';
let searchExpanded = false;
let activeSearchPopover = null;
const POPOVER_SECTION_GAP_PX = 6;
let isInternalResize = false;
let suppressClickUntil = 0; // avoid accidental SWITCH_TAB right after drag end/drop
let activePopover = null;
let activePopoverTabId = null;

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
  // The CSS is now loaded from content.css, so we only need to ensure the style element exists
  // for dynamic updates of CSS variables.
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

  // Some sites (e.g. WhatsApp) block favicon fetches cross-origin; fall back cleanly.
  // (This may still log a network error in DevTools; UI will show the fallback icon.)
  favicon.addEventListener('error', () => { favicon.src = fallback; }, { once: true });
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

function handleUngroup(tabId) { return safeRuntimeSendMessageWithRetry({ action: 'UNGROUP_TAB', tabId }, 3); }
function handleNewTab() {
  safeRuntimeSendMessageWithRetry({ action: "OPEN_NEW_TAB" }, 2);
}

function createCloseButton(tabId) {
  const x = document.createElement('div');
  x.className = 'tz-close-x';
  x.textContent = '×';
  x.title = 'Close tab';
  x.style.cssText =
    `all: initial; width:18px; height:18px; border-radius:4px;` +
    `display:flex; align-items:center; justify-content:center;` +
    `font-family:${GLOBAL_FONT}; font-size:16px; line-height:1;` +
    `cursor:pointer; user-select:none;`;
  x.onmousedown = (e) => { e.stopPropagation(); e.preventDefault(); };
  x.onclick = (e) => {
    e.stopPropagation(); e.preventDefault();
    handleCloseTab(tabId);
  };
  return x;
}

function createGroupButton(tabId) {
  const b = document.createElement('div');
  b.className = 'tz-group-btn';
  b.textContent = '+';
  b.title = 'Move to group';
  b.style.cssText =
    `all: initial; width:18px; height:18px; border-radius:4px;` +
    `display:flex; align-items:center; justify-content:center;` +
    `font-family:${GLOBAL_FONT}; font-size:16px; font-weight:700; line-height:1;` +
    `cursor:pointer; user-select:none;`;
  b.onmousedown = (e) => { e.stopPropagation(); e.preventDefault(); };
  b.onclick = (e) => {
    e.stopPropagation(); e.preventDefault();
    openGroupPopover(b, tabId);
  };
  return b;
}

function createLevel3MenuButton(tabId) {
  // Level-3 menu button ("-") styled/behaving like Level-1 hover buttons
  const b = document.createElement('div');
  b.className = 'tz-group-btn';
  b.textContent = '-';
  b.title = 'Move / Ungroup';
  b.style.cssText =
    `all: initial; width:18px; height:18px; border-radius:4px;` +
    `display:flex; align-items:center; justify-content:center;` +
    `font-family:${GLOBAL_FONT}; font-size:18px; font-weight:700; line-height:1;` +
    `cursor:pointer; user-select:none; color:#bdbdbd;`;
  b.onmousedown = (e) => { e.stopPropagation(); e.preventDefault(); };
  // NOTE: onclick is assigned at call site to pass excludeGroupId correctly.
  return b;
}

function normalizeForSearch(s) {
  return String(s || '').toLowerCase();
}

function isWebUrl(url) {
  return WEB_URL_RE.test(String(url || ''));
}

function extractFullDomain(url) {
  try {
    const u = new URL(String(url || ''));
    return u.hostname || '';
  } catch {
    return '';
  }
}

function escapeHtml(s) {
  return String(s || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function highlightMatchHtml(text, query) {
  const t = String(text || '');
  const q = String(query || '').trim();
  if (!q) return escapeHtml(t);
  const lt = t.toLowerCase();
  const lq = q.toLowerCase();
  const idx = lt.indexOf(lq);
  if (idx === -1) return escapeHtml(t);
  const before = escapeHtml(t.slice(0, idx));
  const mid = escapeHtml(t.slice(idx, idx + q.length));
  const after = escapeHtml(t.slice(idx + q.length));
  return `${before}<b style="font-weight:900;">${mid}</b>${after}`;
}

function getSearchResults() {
  const q = normalizeForSearch(searchQuery).trim();
  if (!q) return [];
  const seen = new Set();
  const out = [];
  for (const t of (cachedAllTabs || [])) {
    if (!t?.id || seen.has(t.id)) continue;
    const url = t.url || t.pendingUrl || '';
    const domain = isWebUrl(url) ? extractFullDomain(url) : '';
    const hay = normalizeForSearch(`${t.title || ''} - ${domain}`);
    if (hay.includes(q)) {
      out.push({ tab: t, domain });
      seen.add(t.id);
    }
  }
  // Keep stable order by tab index when available
  out.sort((a, b) => ((a.tab?.index ?? 0) - (b.tab?.index ?? 0)));
  return out.slice(0, 12);
}

function buildAllTabsCacheFromPayload(payload) {
  const all = [];
  for (const t of (payload?.pinnedTabs || [])) all.push(t);
  for (const t of (payload?.webTabs || [])) all.push(t);
  for (const t of (payload?.systemTabs || [])) all.push(t);
  for (const g of (payload?.allTabGroups || [])) {
    for (const t of (g?.tabs || [])) all.push(t);
  }
  cachedAllTabs = all;
}

function closeActivePopover() {
  if (!activePopover) return;
  try { activePopover.remove(); } catch {}
  activePopover = null;
  activePopoverTabId = null;
  document.removeEventListener('mousedown', onDocMouseDown, true);
  document.removeEventListener('keydown', onDocKeyDown, true);
}

function closeActiveSearchPopover() {
  if (!activeSearchPopover) return;
  try { activeSearchPopover.remove(); } catch {}
  activeSearchPopover = null;
  document.removeEventListener('mousedown', onDocSearchMouseDown, true);
  document.removeEventListener('keydown', onDocSearchKeyDown, true);
}

function onDocSearchMouseDown(e) {
  if (!activeSearchPopover) return;
  if (activeSearchPopover.contains(e.target)) return;
  closeActiveSearchPopover();
}

function onDocSearchKeyDown(e) {
  if (e.key === 'Escape') closeActiveSearchPopover();
}

function onDocMouseDown(e) {
  if (!activePopover) return;
  if (activePopover.contains(e.target)) return;
  closeActivePopover();
}

function onDocKeyDown(e) {
  if (e.key === 'Escape') closeActivePopover();
}

function createPopoverIcon(symbol, color = INDICATOR_COLOR) {
  const ic = document.createElement('div');
  ic.textContent = symbol;
  ic.style.cssText =
    `all: initial; width:10px; text-align:center;` +
    `font-family:${GLOBAL_FONT}; font-size:16px; font-weight:700;` +
    `color:${color}; line-height:1;`;
  return ic;
}

function openSearchPopover(anchorEl) {
  closeActiveSearchPopover();

  const pop = document.createElement('div');
  pop.dataset.tzPopover = '1';
  pop.style.width = 'min(980px, calc(100vw - 16px))';
  pop.style.visibility = 'hidden';
  pop.style.top = '0px';
  pop.style.left = '0px';
  pop.onmousedown = (e) => { e.stopPropagation(); };

  const list = document.createElement('div');
  list.style.cssText = `all: initial; display:block;`;
  pop.appendChild(list);

  const q = normalizeForSearch(searchQuery).trim();
  const results = q ? getSearchResults() : [];

  if (!q) {
    const empty = document.createElement('div');
    empty.style.cssText = `all: initial; padding:8px 6px; font-family:${GLOBAL_FONT}; font-size:13px; color:#bdbdbd;`;
    empty.textContent = 'Type to search tabs…';
    list.appendChild(empty);
  } else if (!results.length) {
    const empty = document.createElement('div');
    empty.style.cssText = `all: initial; padding:8px 6px; font-family:${GLOBAL_FONT}; font-size:13px; color:#bdbdbd;`;
    empty.textContent = 'No matches';
    list.appendChild(empty);
  } else {
    results.forEach(({ tab, domain }) => {
      const item = document.createElement('div');
      item.className = 'group-item';

      const favWrap = document.createElement('div');
      favWrap.className = 'tz-lvl2-fav-wrap';
      favWrap.style.cssText =
        `width:16px; height:16px; min-width:16px; min-height:16px; flex:0 0 16px;` +
        `display:flex; align-items:center; justify-content:center; border-radius:4px;`;
      const fav = createFaviconElement(tab);
      fav.style.width = '16px';
      fav.style.height = '16px';
      fav.style.flex = '0 0 16px';
      fav.style.pointerEvents = 'none';
      favWrap.appendChild(fav);

      const tx = document.createElement('div');
      const title = tab.title || '';
      const label = domain ? `${title} (${domain})` : title;
      // Highlight match (bold) in the displayed label
      tx.innerHTML = highlightMatchHtml(label, searchQuery);
      tx.style.cssText =
        `all: initial; font-family:${GLOBAL_FONT}; font-size:13px; color:#fff;` +
        `overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1 1 auto; min-width:0;`;

      item.appendChild(favWrap);
      item.appendChild(tx);

      item.onmousedown = (e) => { e.stopPropagation(); e.preventDefault(); };
      item.onclick = (e) => {
        e.stopPropagation(); e.preventDefault();
        closeActiveSearchPopover();
        // Keep search open state; switching tab will return to Level 1 anyway.
        handleTabClick(tab.id);
      };

      list.appendChild(item);
    });
  }

  activeSearchPopover = pop;
  document.body.appendChild(pop);

  const r = anchorEl.getBoundingClientRect();
  const pr = pop.getBoundingClientRect();

  let left = r.left;
  let top = r.bottom + 6;
  const margin = 8;
  left = Math.max(margin, Math.min(left, window.innerWidth - pr.width - margin));
  if (top + pr.height + margin > window.innerHeight) {
    top = Math.max(margin, r.top - pr.height - 6);
  }

  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
  pop.style.visibility = 'visible';
  document.addEventListener('mousedown', onDocSearchMouseDown, true);
  document.addEventListener('keydown', onDocSearchKeyDown, true);
}

function openGroupPopover(anchorEl, tabId, { includeUngroup = false, excludeGroupId = null } = {}) {
  closeActivePopover();
  activePopoverTabId = tabId;

  const pop = document.createElement('div');
  pop.className = 'tz-popover';
  pop.dataset.tzPopover = '1';
  pop.onmousedown = (e) => { e.stopPropagation(); };

  // Anchor the menu to the "+" button (dropdown).
  // We append hidden first to measure size and clamp to viewport.
  pop.style.visibility = 'hidden';
  pop.style.top = '0px';
  pop.style.left = '0px';

  const groupsContainer = document.createElement('div');
  groupsContainer.style.cssText = `all: initial; display:block;`;
  pop.appendChild(groupsContainer);

  const groups = Array.isArray(cachedTabGroups) ? cachedTabGroups : [];

  // Optional: "Ungroup" action at top (Level 3 menu)
  if (includeUngroup) {
    const unItem = document.createElement('div');
    unItem.className = 'group-item';
    unItem.style.marginBottom = `${POPOVER_SECTION_GAP_PX}px`;
    const minus = createPopoverIcon('-');
    const tx = document.createElement('div');
    tx.textContent = 'Ungroup';
    tx.style.cssText = `all: initial; font-family:${GLOBAL_FONT}; font-size:13px; color:#bdbdbd;`;
    unItem.appendChild(minus);
    unItem.appendChild(tx);
    unItem.onclick = async (e) => {
      e.stopPropagation(); e.preventDefault();
      suppressClickUntil = Date.now() + 700;
      await handleUngroup(tabId);
      closeActivePopover();
      handleStateChange();
    };
    groupsContainer.appendChild(unItem);
  }

  groups
    .filter(g => (excludeGroupId == null) || String(g.id) !== String(excludeGroupId))
    .forEach(g => {
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
    groupsContainer.appendChild(item);
  });

  // Menu item: New group… (LAST option, with "+" only)
  const newItem = document.createElement('div');
  newItem.className = 'group-item';
  newItem.style.marginTop = groups.length ? `${POPOVER_SECTION_GAP_PX}px` : '0';

  const plus = createPopoverIcon('+');

  const newTx = document.createElement('div');
  newTx.textContent = 'New group…';
  newTx.style.cssText = `all: initial; font-family:${GLOBAL_FONT}; font-size:13px; color:#fff;`;

  newItem.appendChild(plus);
  newItem.appendChild(newTx);
  groupsContainer.appendChild(newItem);

  // New group panel (hidden until "New" is clicked)
  const createPanel = document.createElement('div');
  createPanel.style.cssText = `all: initial; display:none; margin-top:0; width:100%; box-sizing:border-box;`;

  // Vertical form: title, color (full-width dropdown), create (primary), cancel (secondary)
  const form = document.createElement('div');
  form.style.cssText = `all: initial; display:flex; flex-direction:column; gap:8px; width:100%; box-sizing:border-box;`;

  const inp = document.createElement('input');
  inp.type = 'text';
  inp.placeholder = 'New group title';
  inp.style.width = '100%';
  inp.style.boxSizing = 'border-box';

  const sel = document.createElement('select');
  sel.style.width = '100%';
  sel.style.boxSizing = 'border-box';
  const colors = ['grey','blue','red','yellow','green','pink','purple','cyan','orange'];
  colors.forEach(c => {
    const o = document.createElement('option');
    o.value = c; o.textContent = c;
    sel.appendChild(o);
  });

  // Inline selected-color preview square (left of the color picker)
  const colorRow = document.createElement('div');
  colorRow.className = 'row';
  colorRow.style.cssText = `all: initial; display:flex; align-items:center; gap:8px; width:100%; box-sizing:border-box;`;

  const colorPreview = document.createElement('div');
  colorPreview.className = 'swatch';
  colorPreview.style.cssText = `all: initial; width:12px; height:12px; border-radius:3px; flex:0 0 12px; box-sizing:border-box; background:${GROUP_COLOR_MAP[sel.value] || GROUP_COLOR_MAP.default};`;

  const updatePreview = () => { colorPreview.style.background = GROUP_COLOR_MAP[sel.value] || GROUP_COLOR_MAP.default; };
  sel.addEventListener('change', updatePreview);
  updatePreview();

  const createBtn = document.createElement('div');
  createBtn.className = 'btn btn-primary';
  createBtn.textContent = 'Create';
  createBtn.style.width = '100%';
  createBtn.style.boxSizing = 'border-sizing';
  createBtn.style.textAlign = 'center';
  createBtn.onclick = async (e) => {
    e.stopPropagation(); e.preventDefault();
    const t = (inp.value || '').trim();
    if (!t) return;
    suppressClickUntil = Date.now() + 700;
    await safeRuntimeSendMessageWithRetry({ action: 'GROUP_TAB_NEW', tabId, title: t, color: sel.value }, 3);
    closeActivePopover();
    handleStateChange();
  };

  const cancelBtn = document.createElement('div');
  cancelBtn.className = 'btn';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.width = '100%';
  cancelBtn.style.boxSizing = 'border-box';
  cancelBtn.style.textAlign = 'center';
  cancelBtn.onclick = (e) => {
    e.stopPropagation(); e.preventDefault();
    inp.value = '';
    createPanel.style.display = 'none';
    groupsContainer.style.display = 'block';
  };

  form.appendChild(inp);
  colorRow.appendChild(colorPreview);
  colorRow.appendChild(sel);
  form.appendChild(colorRow);
  form.appendChild(createBtn);
  form.appendChild(cancelBtn);
  createPanel.appendChild(form);
  pop.appendChild(createPanel);

  newItem.onclick = (e) => {
    e.stopPropagation(); e.preventDefault();
    groupsContainer.style.display = 'none';
    createPanel.style.display = 'block';
    setTimeout(() => { try { inp.focus(); } catch {} }, 0);
  };

  activePopover = pop;
  document.body.appendChild(pop);

  // Now that it's in the DOM, compute a tight dropdown position anchored to the "+".
  const r = anchorEl.getBoundingClientRect();
  const pr = pop.getBoundingClientRect();

  let left = r.left;
  let top = r.bottom + 6;

  // Clamp to viewport with small margins.
  const margin = 8;
  left = Math.max(margin, Math.min(left, window.innerWidth - pr.width - margin));
  // If not enough space below, open upward.
  if (top + pr.height + margin > window.innerHeight) {
    top = Math.max(margin, r.top - pr.height - 6);
  }

  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
  pop.style.visibility = 'visible';
  document.addEventListener('mousedown', onDocMouseDown, true);
  document.addEventListener('keydown', onDocKeyDown, true);

  // Menu-first UX: no auto-focus (only when user clicks "New")
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
  wrap.dataset.tabid = String(tab.id);
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
function createTabButton(tab, isCurrent, kind = 'web', isLevel1 = false) {
  const btn = document.createElement('div');
  btn.className = 'tz-tab-btn' + (isCurrent ? ' active' : '');
  btn.title = tab.title || tab.url || "";
  btn.draggable = true;
  btn.setAttribute('draggable', 'true');
  btn.dataset.tzDraggable = 'tab';
  btn.dataset.tabid = String(tab.id);
  btn.dataset.tzKind = kind;

  const fav = createFaviconElement(tab);
  fav.style.pointerEvents = 'none';
  btn.appendChild(fav);

  const text = document.createElement('span');
  text.className = 'tab-title';
  text.textContent = getDisplayedTitle(tab.title || tab.url);
  btn.appendChild(text);

  const actions = document.createElement('div');
  actions.className = 'tab-actions';
  if (kind === 'web') actions.appendChild(createGroupButton(tab.id));
  actions.appendChild(createCloseButton(tab.id));
  
  btn.appendChild(actions);

  btn.onclick = () => handleTabClick(tab.id);
  return btn;
}

function createSeparator() {
  const sep = document.createElement('div');
  sep.className = 'tz-separator';
  return sep;
}

function createInlinePlusWrapper() {
  const wrapper = document.createElement('div');
  wrapper.className = 'inline-plus-wrapper';

  wrapper.appendChild(createSeparator());

  const btn = document.createElement('div');
  btn.className = 'tz-plus-btn';
  btn.textContent = '+';
  btn.onclick = (e) => { e.stopPropagation(); handleNewTab(); };

  wrapper.appendChild(btn);
  return wrapper;
}

function createStickyPlus() {
  const btn = document.createElement('div');
  btn.className = 'plus-sticky';
  btn.textContent = '+';
  btn.onclick = handleNewTab;
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
  applyZoomCompensatedMetrics(true);

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

  const msg = document.createElement('div');
  msg.className = 'tz-disconnected-msg';
  msg.textContent = `Tab bar: ${reason} (click to retry)`;
  msg.onclick = () => requestTabList();
  bar.appendChild(msg);

  applyPageShift();
}

function createSearchBar() {
  const wrap = document.createElement('div');
  wrap.className = 'tz-search' + (searchExpanded ? ' expanded' : '');

  const icon = document.createElement('div');
  icon.className = 'icon';
  icon.textContent = SEARCH_ICON;
  // Match the minimal look of other controls (no emoji-like rendering)
  icon.style.cssText =
    // Keep the icon size at 32px regardless of expanded state.
    `all: initial; font-family:${GLOBAL_FONT}; font-size:32px; line-height:1;` +
    `color:${INDICATOR_COLOR}; flex:0 0 auto; user-select:none; cursor:pointer;`;
  if (!searchExpanded) {
    icon.style.marginTop = '-4px'; // Adjust icon position when collapsed
  }
  wrap.appendChild(icon);

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Search tabs…';
  input.value = searchQuery;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.style.display = searchExpanded ? 'block' : 'none';
  input.style.paddingRight = '6px';
  input.onmousedown = (e) => { e.stopPropagation(); };
  input.onclick = (e) => { e.stopPropagation(); };
  input.oninput = () => {
    searchQuery = input.value || '';
    if (searchExpanded) openSearchPopover(wrap);
  };
  input.onkeydown = (e) => {
    if (e.key === 'Escape') {
      searchQuery = '';
      searchExpanded = false;
      input.style.display = 'none';
      closeActiveSearchPopover();
      if (navigationState === NAV_LEVELS.LEVEL_1) requestTabList();
    }
  };
  wrap.appendChild(input);

  const clear = document.createElement('div');
  clear.className = 'clear';
  clear.textContent = '×';
  clear.title = 'Close search';
  // Visible whenever search is expanded (even if input is empty)
  clear.style.display = searchExpanded ? 'block' : 'none';
  clear.onmousedown = (e) => { e.stopPropagation(); e.preventDefault(); };
  clear.onclick = (e) => {
    e.stopPropagation(); e.preventDefault();
    // Close search (and clear query)
    searchQuery = '';
    input.value = '';
    searchExpanded = false;
    input.style.display = 'none';
    clear.style.display = 'none';
    closeActiveSearchPopover();
    if (navigationState === NAV_LEVELS.LEVEL_1) requestTabList();
  };
  wrap.appendChild(clear);

  // Expand/collapse behavior
  wrap.onmousedown = (e) => { e.stopPropagation(); };
  wrap.onclick = (e) => {
    e.stopPropagation();
    // If user clicks the magnifier while collapsed, treat it like a button.
    // (Also works if they click anywhere in the collapsed control.)
    if (!searchExpanded) {
      searchExpanded = true;
      wrap.classList.add('expanded');
      input.style.display = 'block';
      clear.style.display = 'block';
      setTimeout(() => { try { input.focus(); } catch {} }, 0);
      openSearchPopover(wrap);
    } else {
      // When expanded, clicking the magnifier acts as the single "-" behavior:
      // close + clear (one control instead of clear + collapse).
      searchQuery = '';
      input.value = '';
      searchExpanded = false;
      input.style.display = 'none';
      clear.style.display = 'none';
      closeActiveSearchPopover();
      if (navigationState === NAV_LEVELS.LEVEL_1) requestTabList();
    }
  };

  // Keep clear visibility in sync
  const syncClear = () => { clear.style.display = searchExpanded ? 'block' : 'none'; };
  input.addEventListener('input', syncClear);
  syncClear();

  return wrap;
}

function renderFakeTabBar(currentTabId, pinnedTabs, webTabs, systemTabs, isCurrentTabGrouped, currentTabTitle, allTabGroups) {
  const bar = ensureBar();

  bar.innerHTML = '';
  // bar.style.cssText is now handled by CSS class #ungroup-automatic-tab-bar

  // Level-1 search (leftmost)
  bar.appendChild(createSearchBar());

  const trigger = document.createElement('div');
  trigger.className = 'tz-trigger' + (isCurrentTabGrouped ? ' active' : '');
  // trigger.style.cssText is now handled by CSS class .tz-trigger

  const triggerLabel = isCurrentTabGrouped
    ? getDisplayedTitle(currentTabTitle)
    : (allTabGroups.length > 0 ? 'Groups' : 'Bodhi Bar');

  const caret = document.createElement('span');
  caret.className = 'caret';
  caret.textContent = '▼';
  trigger.appendChild(caret);

  const lbl = document.createElement('span');
  lbl.className = 'label';
  lbl.textContent = triggerLabel;
  trigger.appendChild(lbl);

  // Level 1: remove the "X" on the first tile (trigger).

  trigger.onclick = () => {
    if (allTabGroups.length === 1) {
      currentViewedGroupId = allTabGroups[0].id;
      navigationState = NAV_LEVELS.LEVEL_3;
    } else if (allTabGroups.length > 1) {
      navigationState = NAV_LEVELS.LEVEL_2;
    }
    handleStateChange();
  };
  // trigger.onmouseover and onmouseout are now handled by CSS class .tz-trigger:hover

  bar.appendChild(trigger);

  const scrollContainer = document.createElement('div');
  scrollContainer.className = 'scroll-container';
  // scrollContainer.style.cssText is now handled by CSS class .scroll-container

  const pinnedSorted = [...(pinnedTabs || [])].sort((a, b) => a.index - b.index);
  const webSorted = [...(webTabs || [])].sort((a, b) => a.index - b.index);
  const sysSorted = [...(systemTabs || [])].sort((a, b) => a.index - b.index);

  // CHANGED: pinned shown as favicon-only (not as tab tiles)
  pinnedSorted.forEach(tab => scrollContainer.appendChild(createPinnedFavicon(tab, tab.id === currentTabId)));

  webSorted.forEach(tab => scrollContainer.appendChild(createTabButton(tab, tab.id === currentTabId, 'web', true)));

  scrollContainer.appendChild(createInlinePlusWrapper());

  if (sysSorted.length > 0) {
    scrollContainer.appendChild(createSeparator());
    sysSorted.forEach(tab => scrollContainer.appendChild(createTabButton(tab, tab.id === currentTabId, 'system', true)));
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

    // If we are in Level 2, always prefer the fresh response ordering.
    // (cachedTabGroups can be stale if REFRESH_BAR messages were missed)
    // Sorting by first tab index is the most reliable proxy for group order.
    // NOTE: response.allTabGroups already includes tabs[] from background.js.
    cachedTabGroups = response.allTabGroups || [];
    cachedTabGroups = [...cachedTabGroups].sort((a, b) => (a.tabs?.[0]?.index ?? 1e9) - (b.tabs?.[0]?.index ?? 1e9));
    buildAllTabsCacheFromPayload(response);
    if (searchExpanded) closeActiveSearchPopover();
    if (activePopover && activePopoverTabId != null) closeActivePopover();

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
  if (searchExpanded) closeActiveSearchPopover();

  const msg = (navigationState === NAV_LEVELS.LEVEL_2)
    ? { action: "GET_UNGROUPED_TABS" }
    : { action: "GET_GROUP_TABS", groupId: currentViewedGroupId };

  safeRuntimeSendMessageWithRetry(msg, 5).then((response) => {
    if (!response) return renderDisconnectedBar('no receiver in background');

    if (navigationState === NAV_LEVELS.LEVEL_2) {
      // Keep cache in sync so subsequent UI actions (popover, etc.) see the new order.
      cachedTabGroups = response.allTabGroups || cachedTabGroups || [];
      cachedTabGroups = [...cachedTabGroups].sort((a, b) => (a.tabs?.[0]?.index ?? 1e9) - (b.tabs?.[0]?.index ?? 1e9));
      if (activePopover && activePopoverTabId != null) closeActivePopover();

      const groups = [...(response.allTabGroups || cachedTabGroups || [])]
        .sort((a, b) => (a.tabs?.[0]?.index ?? 1e9) - (b.tabs?.[0]?.index ?? 1e9));
      renderNavigationBar(groups);
    } else {
      const tabsSorted = [...(response.tabs || [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      renderNavigationBar(tabsSorted, response.groupTitle || 'Groups List');
    }
  });
}

function renderNavigationBar(data, currentGroupTitle = 'Groups List') {
  const bar = ensureBar();

  bar.innerHTML = '';
  // bar.style.cssText is now handled by CSS class #ungroup-automatic-tab-bar

  const backBtn = document.createElement('div');
  backBtn.className = 'tz-back-btn';

  const arrow = document.createElement('span');
  arrow.className = 'arrow';
  arrow.textContent = BACK_ARROW;
  backBtn.appendChild(arrow);

  const lbl = document.createElement('span');
  lbl.className = 'label';
  lbl.textContent = getDisplayedTitle(currentGroupTitle);
  backBtn.appendChild(lbl);

  backBtn.onclick = (e) => { e.stopPropagation(); navigateBack(); };
  // backBtn.onmouseover and onmouseout are now handled by CSS class .tz-back-btn:hover
  bar.appendChild(backBtn);

  const container = document.createElement('div');
  container.className = 'scroll-container';
  // container.style.cssText is now handled by CSS class .scroll-container

  const items = Array.isArray(data) ? data : [];

  items.forEach(item => {
    const isLevel2Groups = (navigationState === NAV_LEVELS.LEVEL_2);
    const isLevel3GroupTabs = (navigationState === NAV_LEVELS.LEVEL_3);

    const itemBtn = document.createElement('div');
    itemBtn.title = item.title || item.url || "";

    if (isLevel2Groups) {
      // -----------------------
      // Level 2: groups list
      // Requirement: show ALL favicons inside group tile; favicon is clickable and switches tab.
      // Note: Needs group.tabs from GET_UNGROUPED_TABS; if missing, we fall back to title-only.
      // -----------------------
      itemBtn.className = 'tz-group-tile';
      const groupColorHex = GROUP_COLOR_MAP[item.color] || GROUP_COLOR_MAP.default;
      itemBtn.style.borderBottom = `var(--tz-ind-h) solid ${groupColorHex}`;
      itemBtn.style.color = groupColorHex;
      itemBtn.draggable = true;
      itemBtn.setAttribute('draggable', 'true');
      itemBtn.dataset.tzDraggable = 'group';
      itemBtn.dataset.groupid = String(item.id);

      const titleSpan = document.createElement('span');
      titleSpan.className = 'group-title';
      titleSpan.textContent = getDisplayedTitle(item.title || item.url);
      itemBtn.appendChild(titleSpan);

      // Favicons container (no fixed width; only min-width on the whole tile)
      const favs = Array.isArray(item.tabs) ? item.tabs : [];
      if (favs.length > 0) {
        const favRow = document.createElement('div');
        favRow.className = 'fav-row';

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
      itemBtn.style.borderBottom = `var(--tz-ind-h) solid ${INDICATOR_COLOR}`;
      itemBtn.draggable = true;
      itemBtn.setAttribute('draggable', 'true');
      itemBtn.dataset.tzDraggable = 'tab';
      itemBtn.dataset.tabid = String(item.id);
      itemBtn.dataset.tzKind = 'group';
      itemBtn.dataset.groupid = String(item.groupId ?? currentViewedGroupId ?? '');

      // IMPORTANT: favicon is ALWAYS inserted and forced visible
      itemBtn.appendChild(createLevel2Favicon(item, { interactive: false }));

      const label = document.createElement('span');
      label.className = 'tab-title';
      label.textContent = getDisplayedTitle(item.title || item.url);
      label.style.color = '#fff';
      itemBtn.appendChild(label);

      // Actions container styled like Level 1 (right-aligned, hover-only buttons)
      const actions = document.createElement('div');
      actions.className = 'tab-actions';

      // Level-3 menu: "-" (on hover) opens the same menu as Level 1 plus "Ungroup"
      // Also: do NOT show the current group in the list.
      const menuBtn = createLevel3MenuButton(item.id);
      menuBtn.onclick = (e) => { e.stopPropagation(); e.preventDefault(); openGroupPopover(menuBtn, item.id, { includeUngroup: true, excludeGroupId: (item.groupId ?? currentViewedGroupId ?? null) }); };
      actions.appendChild(menuBtn);
      actions.appendChild(createCloseButton(item.id));
      itemBtn.appendChild(actions);
      itemBtn.onclick = (e) => { e.stopPropagation(); handleTabClick(item.id); };
    } else {
      // Safety fallback (should not happen)
      const titleSpan = document.createElement('span');
      titleSpan.textContent = getDisplayedTitle(item.title || item.url);
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
  sourceType: null,   // 'tab' | 'group'
  sourceTabId: null,
  sourceKind: null,   // 'pinned' | 'web' | 'system' | 'group'
  sourceGroupId: null,
  sourceGroupTileId: null, // Level-2 group tile drag
  overEl: null,
  placement: null,    // 'before' | 'after'
  lastTargetId: null,
};

function closestDraggableTabEl(node) {
  if (!node || !node.closest) return null;
  return node.closest(
    '[data-tz-draggable="tab"][data-tabid], [data-tz-draggable="group"][data-groupid]'
  );
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
  // Group reorder (Level 2)
  if (dragState.sourceType === 'group') {
    if (targetEl.dataset.groupid === dragState.sourceGroupTileId) return false;
    if (targetEl.dataset.tzDraggable !== 'group') return false;
    if (navigationState !== NAV_LEVELS.LEVEL_2) return false;
    const tgtId = targetEl.dataset.groupid || '';
    return !!tgtId && tgtId !== String(dragState.sourceGroupTileId || '');
  }

  // Tab reorder (Level 1 + Level 3)
  const targetKind = targetEl.dataset.tzKind || '';
  if (!dragState.sourceTabId || !dragState.sourceKind) return false;
  if (targetEl.dataset.tabid === dragState.sourceTabId) return false;
  if (targetKind !== dragState.sourceKind) return false;
  if (dragState.sourceKind === 'group') {
    const tgtG = targetEl.dataset.groupid || '';
    return !!tgtG && tgtG === (dragState.sourceGroupId || '');
  }
  return true;
}

async function handleMoveTab(sourceTabId, targetTabId, placement) {
  suppressClickUntil = Date.now() + 700;
  if (dragState.sourceType === 'group') {
    await safeRuntimeSendMessageWithRetry({
      action: 'MOVE_GROUP',
      groupId: Number(sourceTabId),
      targetGroupId: Number(targetTabId),
      placement
    }, 3);
  } else {
    await safeRuntimeSendMessageWithRetry({
      action: 'MOVE_TAB',
      tabId: Number(sourceTabId),
      targetTabId: Number(targetTabId),
      placement
    }, 3);
  }
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

    if (el.dataset.tzDraggable === 'group') {
      dragState.sourceType = 'group';
      dragState.sourceGroupTileId = el.dataset.groupid;
      dragState.sourceTabId = null;
      dragState.sourceKind = null;
      dragState.sourceGroupId = null;
    } else {
      dragState.sourceType = 'tab';
      dragState.sourceTabId = el.dataset.tabid;
      dragState.sourceKind = el.dataset.tzKind || null;
      dragState.sourceGroupId = el.dataset.groupid || null;
      dragState.sourceGroupTileId = null;
    }

    el.classList.add('tz-dragging');
    el.style.opacity = '0.65';
    suppressClickUntil = Date.now() + 700;

    try {
      e.dataTransfer.effectAllowed = 'move';
      const payload = (dragState.sourceType === 'group') ? (dragState.sourceGroupTileId || '') : (dragState.sourceTabId || '');
      e.dataTransfer.setData('text/plain', payload);
    } catch { /* ignore */ }
  }, true);

  bar.addEventListener('dragover', (e) => {
    if (!dragState.sourceTabId && !dragState.sourceGroupTileId) return;
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
    if (!dragState.sourceTabId && !dragState.sourceGroupTileId) return;
    const el = closestDraggableTabEl(e.target);
    if (!el || !canDropOn(el)) return;

    e.preventDefault();

    const targetTabId = (dragState.sourceType === 'group') ? el.dataset.groupid : el.dataset.tabid;
    const placement = dragState.placement || 'before';

    dragState.lastTargetId = targetTabId;
    clearDropIndicator();
    const sourceId = (dragState.sourceType === 'group') ? dragState.sourceGroupTileId : dragState.sourceTabId;
    handleMoveTab(sourceId, targetTabId, placement).catch(() => {});
  }, true);

  bar.addEventListener('dragend', () => {
    const dragging = bar.querySelector('.tz-dragging');
    if (dragging) {
      dragging.classList.remove('tz-dragging');
      dragging.style.opacity = '';
    }
    clearDropIndicator();
    dragState.sourceType = null;
    dragState.sourceTabId = null;
    dragState.sourceKind = null;
    dragState.sourceGroupId = null;
    dragState.sourceGroupTileId = null;
    dragState.lastTargetId = null;
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
