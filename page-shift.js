/**
 * PAGE-SHIFT.JS - Header collision detection and page shift
 */

// Shared flag to prevent resize loops (also used by render.js)
if (typeof isInternalResize === 'undefined') {
  var isInternalResize = false;
}

let _tzShifted = new Map();
let _tzLastBarH = null;
let _tzShiftRAF = 0;
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

  const bar = document.getElementById(TZ_BAR_ID);
  const isHidden = !bar || bar.style.display === 'none' || getComputedStyle(bar).display === 'none';

  if (isHidden) {
    // If bar is hidden, restore pages and remove added padding
    try { restoreShiftedHeaders(); } catch {}
    try {
      body.style.setProperty('padding-top', '0px', 'important');
      body.style.setProperty('padding-bottom', '0px', 'important');
    } catch {}
    return;
  }

  try { ensureSafeAreasStyle(); } catch {}
  try { setInlineSafeAreasFallback(); } catch {}

  scheduleHeaderShift();

  isInternalResize = true;
  window.dispatchEvent(new Event('resize'));
  setTimeout(() => { isInternalResize = false; }, 80);
}
