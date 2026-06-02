/**
 * DOM-HELPERS.JS - DOM element creation utilities
 */

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
  favicon.draggable = false;
  favicon.setAttribute('draggable', 'false');
  favicon.referrerPolicy = 'no-referrer';
  favicon.decoding = 'async';
  favicon.loading = 'lazy';

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

function createCloseButton(tabId) {
  const x = document.createElement('div');
  x.className = 'tz-close-x';
  x.textContent = '×';
  x.title = 'Close tab';
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
  b.onmousedown = (e) => { e.stopPropagation(); e.preventDefault(); };
  b.onclick = (e) => {
    e.stopPropagation(); e.preventDefault();
    openGroupPopover(b, tabId);
  };
  return b;
}

function createLevel3MenuButton(tabId) {
  const b = document.createElement('div');
  b.className = 'tz-group-btn tz-menu-btn';
  b.textContent = '-';
  b.title = 'Move / Ungroup';
  b.onmousedown = (e) => { e.stopPropagation(); e.preventDefault(); };
  return b;
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

function getDisplayedTitle(title) {
  if (!title) return "";
  return title.length > MAX_TITLE_LENGTH ? title.substring(0, MAX_TITLE_LENGTH) + "..." : title;
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

function safeRemove(el) {
  try { el?.remove(); } catch {}
}

function suppressClicks(ms = 700) {
  suppressClickUntil = Date.now() + ms;
}

function createPopoverIcon(symbol, color = INDICATOR_COLOR) {
  const ic = document.createElement('div');
  ic.className = 'popover-icon';
  ic.textContent = symbol;
  ic.style.color = color;
  return ic;
}
