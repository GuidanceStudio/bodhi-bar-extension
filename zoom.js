/**
 * ZOOM.JS - Zoom scale detection and metrics application
 */

let _lastScale = null;
let _metricsRAF = 0;
let _baseDPR = null;

function round3(n) { return Math.round(n * 1000) / 1000; }
function captureBaseDPR() { _baseDPR = window.devicePixelRatio || 1; }

function setInitialZoom(z) {
  if (z && z > 0) {
    const dpr = window.devicePixelRatio || 1;
    // Calculate what the DPR would be at 100% zoom (Monitor DPR)
    _baseDPR = dpr / z;
    if (typeof applyZoomCompensatedMetrics === 'function') {
      applyZoomCompensatedMetrics(true);
    }
  }
}

if (chrome?.runtime?.sendMessage) {
  chrome.runtime.sendMessage({ action: 'GET_ZOOM' }, (res) => {
    if (chrome.runtime.lastError) return;
    if (res && res.ok && res.zoom) {
      setInitialZoom(res.zoom);
    }
  });
}

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

window.addEventListener('resize', () => scheduleMetricsUpdate());

// Initial setup
captureBaseDPR();
scheduleMetricsUpdate();
