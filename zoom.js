(function() {
  /**
   * ZOOM.JS - Zoom scale detection and metrics application
   */
  if (window.__tzZoomInited) return;
  window.__tzZoomInited = true;

  const DEBUG = false;
  function log(msg) {
    if (DEBUG) console.log(`[BodhiBar Zoom] ${msg}`);
  }

  if (typeof window.__tzBase === 'undefined') {
    window.__tzBase = {
      TAB_W: 148,
      BAR_H: 38,
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
      LVL2_FAV_ML: 6,
      GAP_MD: 4,
      GAP_LG: 8,
      SEARCH_PAD_Y: 0,
      SEARCH_MB: 0,
      SEARCH_ICN_Y: 2,
      POPOVER_W: 240,
      POPOVER_MAX_H: 300,
      POPOVER_RADIUS: 8,
      POPOVER_FONT: 13,
      INPUT_RADIUS: 6,
      INPUT_PAD_Y: 6,
      INPUT_PAD_X: 8,
      GROUP_ITEM_PAD: 6,
      SWATCH_RADIUS: 3,
      SEARCH_RADIUS: 8,
      SEARCH_FONT: 13,
      SEARCH_INPUT_PAD_R: 6,
      CLEAR_FONT: 16,
      CLEAR_PAD_Y: 2,
      CLEAR_PAD_X: 4,
      CLEAR_RADIUS: 4,
      TAB_ACTIONS_GAP: 6,
      TRIGGER_ML: 6,
      MENU_BTN_FONT: 18,
      POPOVER_ICON_W: 10,
      POPOVER_ICON_FONT: 16,
      FAV_WRAP_RADIUS: 4
    };
  }
  const BASE = window.__tzBase;

  let _lastScale = null;
  let _metricsRAF = 0;
  let _baseDPR = null;
  let _isZoomAuthoritative = false; // Protects _baseDPR from being overwritten

  function round3(n) { return Math.round(n * 1000) / 1000; }

  function captureBaseDPR() { 
    // If we have an authoritative zoom from background, ignore fallback calls
    if (_isZoomAuthoritative) {
      log('Ignoring captureBaseDPR: Zoom is authoritative.');
      return;
    }
    _baseDPR = window.devicePixelRatio || 1; 
    log(`Captured Base DPR (Fallback): ${_baseDPR}`);
  }

  function setInitialZoom(z) {
    if (z && z > 0) {
      const dpr = window.devicePixelRatio || 1;
      _baseDPR = dpr / z;
      _isZoomAuthoritative = true; // Lock it
      log(`Set Initial Zoom: ${z}. DPR: ${dpr}. Calculated BaseDPR: ${_baseDPR}`);
      if (typeof applyZoomCompensatedMetrics === 'function') {
        applyZoomCompensatedMetrics(true);
      }
    }
  }

  function requestZoomWithRetry(tries = 0) {
    // Increased retries to ~5 seconds total to handle slow Service Worker wakeup
    const MAX_TRIES = 15; 
    const DELAY_MS = 300;

    if (tries >= MAX_TRIES) {
      log('Max retries reached. Giving up and using fallback.');
      if (_baseDPR == null) {
        captureBaseDPR();
        if (typeof applyZoomCompensatedMetrics === 'function') {
          applyZoomCompensatedMetrics(true);
        }
      }
      return;
    }

    log(`Requesting zoom (try ${tries + 1}/${MAX_TRIES})...`);
    chrome.runtime.sendMessage({ action: 'GET_ZOOM' }, (res) => {
      const err = chrome.runtime.lastError;
      if (err) {
        log(`Runtime error: ${err.message}. Retrying...`);
        setTimeout(() => requestZoomWithRetry(tries + 1), DELAY_MS);
        return;
      }
      if (res && res.ok && typeof res.zoom === 'number' && res.zoom > 0) {
        log(`Got zoom response: ${res.zoom}`);
        setInitialZoom(res.zoom);
      } else {
        log(`Invalid response: ${JSON.stringify(res)}. Retrying...`);
        setTimeout(() => requestZoomWithRetry(tries + 1), DELAY_MS);
      }
    });
  }

  function initZoom() {
    log('Initializing Zoom...');
    if (chrome?.runtime?.sendMessage) {
      requestZoomWithRetry();
    } else {
      log('No runtime.sendMessage available. Using fallback.');
      captureBaseDPR();
    }
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
    // Only reset if something is wildly off (e.g. dragged to another monitor with different DPI)
    if (!isFinite(s) || s <= 0.1 || s >= 10) {
      log(`Recapturing Base DPR due to extreme scale change (s=${s})`);
      _isZoomAuthoritative = false; // Unlock to allow reset
      captureBaseDPR();
    }
  }

  function px(base, scale) {
    const v = base / (scale || 1);
    return `${Math.round(v * 1000) / 1000}px`;
  }

  function applyZoomCompensatedMetrics(force = false) {
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

    root.style.setProperty('--tz-search-icon', px(32, scale));
    root.style.setProperty('--tz-search-w', px(38, scale));
    root.style.setProperty('--tz-search-exp-w', px(260, scale));
    root.style.setProperty('--tz-search-mt', px(-4, scale));
    root.style.setProperty('--tz-act-h', px(18, scale));
    root.style.setProperty('--tz-btn-sm', px(18, scale));
    root.style.setProperty('--tz-btn-sm-font', px(16, scale));
    root.style.setProperty('--tz-search-diff', px(10, scale));
    root.style.setProperty('--tz-gap-sm', px(6, scale));
    root.style.setProperty('--tz-gap-xs', px(2, scale));
    root.style.setProperty('--tz-gap-md', px(BASE.GAP_MD, scale));
    root.style.setProperty('--tz-gap-lg', px(BASE.GAP_LG, scale));
    root.style.setProperty('--tz-popover-pad', px(6, scale));
    root.style.setProperty('--tz-popover-swatch', px(10, scale));
    root.style.setProperty('--tz-popover-preview', px(12, scale));
    root.style.setProperty('--tz-favicon-sm', px(16, scale));
    root.style.setProperty('--tz-search-icn-y', px(4, scale));
    root.style.setProperty('--tz-search-pad-y', px(BASE.SEARCH_PAD_Y, scale));
    root.style.setProperty('--tz-search-mb', px(BASE.SEARCH_MB, scale));

    root.style.setProperty('--tz-popover-w', px(BASE.POPOVER_W, scale));
    root.style.setProperty('--tz-popover-max-h', px(BASE.POPOVER_MAX_H, scale));
    root.style.setProperty('--tz-popover-radius', px(BASE.POPOVER_RADIUS, scale));
    root.style.setProperty('--tz-popover-font', px(BASE.POPOVER_FONT, scale));
    root.style.setProperty('--tz-input-radius', px(BASE.INPUT_RADIUS, scale));
    root.style.setProperty('--tz-input-pad-y', px(BASE.INPUT_PAD_Y, scale));
    root.style.setProperty('--tz-input-pad-x', px(BASE.INPUT_PAD_X, scale));
    root.style.setProperty('--tz-group-item-pad', px(BASE.GROUP_ITEM_PAD, scale));
    root.style.setProperty('--tz-swatch-radius', px(BASE.SWATCH_RADIUS, scale));
    root.style.setProperty('--tz-search-radius', px(BASE.SEARCH_RADIUS, scale));
    root.style.setProperty('--tz-search-font', px(BASE.SEARCH_FONT, scale));
    root.style.setProperty('--tz-search-input-pad-r', px(BASE.SEARCH_INPUT_PAD_R, scale));
    root.style.setProperty('--tz-clear-font', px(BASE.CLEAR_FONT, scale));
    root.style.setProperty('--tz-clear-pad-y', px(BASE.CLEAR_PAD_Y, scale));
    root.style.setProperty('--tz-clear-pad-x', px(BASE.CLEAR_PAD_X, scale));
    root.style.setProperty('--tz-clear-radius', px(BASE.CLEAR_RADIUS, scale));
    root.style.setProperty('--tz-tab-actions-gap', px(BASE.TAB_ACTIONS_GAP, scale));
    root.style.setProperty('--tz-trigger-ml', px(BASE.TRIGGER_ML, scale));
    root.style.setProperty('--tz-menu-btn-font', px(BASE.MENU_BTN_FONT, scale));
    root.style.setProperty('--tz-popover-icon-w', px(BASE.POPOVER_ICON_W, scale));
    root.style.setProperty('--tz-popover-icon-font', px(BASE.POPOVER_ICON_FONT, scale));
    root.style.setProperty('--tz-fav-wrap-radius', px(BASE.FAV_WRAP_RADIUS, scale));

    if (typeof applyPageShift === 'function') applyPageShift();
    if (typeof updateDynamicLayout === 'function') updateDynamicLayout();
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
  initZoom();
  scheduleMetricsUpdate();

  window.__tzZoomMetrics = {
    applyZoomCompensatedMetrics,
    scheduleMetricsUpdate,
    captureBaseDPR,
    setInitialZoom
  };
})();
