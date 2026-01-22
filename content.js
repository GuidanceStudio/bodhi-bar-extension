/**
 * CONTENT.JS - Bodhi Bar Entry Point
 *
 * This file orchestrates the tab bar UI.
 */

// State variables (shared across modules)
let navigationState = NAV_LEVELS.LEVEL_1;
let currentViewedGroupId = null;
let cachedTabGroups = [];
let cachedAllTabs = [];
let suppressClickUntil = 0;

const STORAGE_KEY_HIDDEN_BY_TAB = 'tz_hidden_by_tab';
window.__tzCurrentTabId = null;

function getThisTabId() {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ action: 'GET_TAB_ID' }, (resp) => {
        const err = chrome.runtime?.lastError;
        if (err) return resolve(null);
        resolve(resp?.tabId ?? null);
      });
    } catch {
      resolve(null);
    }
  });
}

// Tab action handlers
function handleCloseTab(tabId) {
  safeRuntimeSendMessageWithRetry({ action: "CLOSE_TAB", tabId }, 2).then(() => requestTabList());
}

function handleTabClick(tabId) {
  if (Date.now() < suppressClickUntil) return;
  safeRuntimeSendMessageWithRetry({ action: "SWITCH_TAB", tabId }, 3).then(() => {
    navigationState = NAV_LEVELS.LEVEL_1;
    currentViewedGroupId = null;
    searchExpanded = false; // Ensure search is closed
    requestTabList();
  });
}

function handleUngroup(tabId) { return safeRuntimeSendMessageWithRetry({ action: 'UNGROUP_TAB', tabId }, 3); }

function handleNewTab() {
  safeRuntimeSendMessageWithRetry({ action: "OPEN_NEW_TAB" }, 2);
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

function navigateBack() {
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

    window.__tzCurrentTabId = response.currentTabId ?? null;

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

// Event hooks
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

 // Boot
let _tzDidBoot = false;

/**
 * Helper to check if the current URL matches a pattern with wildcards.
 * Example: "docs.google.com/spreadsheets/*" matches "docs.google.com/spreadsheets/d/123"
 */
function matchesPattern(url, pattern) {
  if (!url || !pattern) return false;
  try {
    // 1. Convert pattern to valid Regex
    // Escape special regex characters except the asterisk *
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    // Replace * with .* (any character, any number of times)
    const regexStr = '^' + escaped.replace(/\*/g, '.*') + '$';

    // 2. Test case-insensitive
    return new RegExp(regexStr, 'i').test(url);
  } catch (e) {
    // If pattern is invalid, return false (safe)
    return false;
  }
}

async function boot() {
  if (_tzDidBoot) return;
  _tzDidBoot = true;

  try {
    const tabId = await getThisTabId();
    let isHidden = false;

    if (tabId != null) {
      // 1. Check explicit per-tab visibility first
      const data = await chrome.storage.local.get(STORAGE_KEY_HIDDEN_BY_TAB);
      const map = data?.[STORAGE_KEY_HIDDEN_BY_TAB] || {};
      const explicitSetting = map[String(tabId)];

      if (explicitSetting !== undefined) {
        // Use explicit setting if it exists
        isHidden = explicitSetting;
      } else {
        // 2. Otherwise, check default hidden sites list (with wildcard support)
        const defaultData = await chrome.storage.local.get('tz_default_hidden_sites');
        const hiddenSites = defaultData?.['tz_default_hidden_sites'] || [];
        const currentUrl = window.location.href;

        // Use the new matchesPattern function
        if (hiddenSites.some(site => matchesPattern(currentUrl, site))) {
          isHidden = true;
        }
      }
    }

    captureBaseDPR();
    safeConnectPort();
    const bar = ensureBar();
    
    if (isHidden) {
      bar.style.setProperty('display', 'none', 'important');
    }

    // Ensure page shift state matches initial visibility
    if (typeof applyPageShift === 'function') applyPageShift();

    applyZoomCompensatedMetrics(true);
    requestTabList();
  } catch {
    renderDisconnectedBar('boot failed');
  }
}

hookViewportEvents();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    applyZoomCompensatedMetrics(true);
    boot();
  }, { once: true });
} else {
  boot();
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'SET_VISIBILITY') {
    const bar = document.getElementById(TZ_BAR_ID);
    if (bar) {
      if (request.hidden) {
        bar.style.setProperty('display', 'none', 'important');
      } else {
        bar.style.display = '';
        requestTabList();
      }
      if (typeof applyPageShift === 'function') applyPageShift();
    }
    sendResponse({ success: true });
  }
});
