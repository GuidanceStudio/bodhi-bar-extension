/* eslint-disable no-unused-vars */
/**
 * BACKGROUND.JS - Bodhi Bar (v9.24)
 *
 * + Injects site_overrides.js into all frames on completed navigations
 *   so overrides are always available even when content_scripts ordering
 *   / injection is flaky in Brave.
 *
 * + CLOSE_TAB action for UI "X" button.
 *
 * --- Integrated for Level 2 UI (Groups with favicons) ---
 * GET_UNGROUPED_TABS now includes, for each group in allTabGroups, a "tabs" array
 * with the group's tabs (tabToItem shape). This enables Level 2 to render all
 * favicons inside each group tile without extra per-group requests.
 */

// Constants
const TZ_PORT_NAME = 'TZ_UI_PORT';
const TZ_HANDSHAKE_MSG = { action: '__TZ_HANDSHAKE__' };

const DEBUG = true;
const TAG = '[BodhiBar]';
const log = (...a) => DEBUG && console.log(TAG, ...a);
const warn = (...a) => DEBUG && console.warn(TAG, ...a);

const SYSTEM_PREFIXES = [
  'chrome://', 'brave://', 'about:',
  'chrome-extension://', 'brave-extension://',
  'edge://', 'devtools://', 'extension://'
];

const DEBOUNCE_MS = 80;
const DRAG_SETTLE_MS = 350;
const QUIET_MS = 450;
const COOLDOWN_MS = 250;

const STABLE = { SAMPLE_GAP_MS: 120, MAX_ATTEMPTS: 6, REQUIRED_MATCHES: 2 };

const RETRY_DELAYS_MS = [80, 160, 320, 640, 1200, 2000];
const UI_REFRESH_RETRY_MS = 450;

// NEW: Grace period after startup/enable to avoid ungrouping restored session tabs.
const STARTUP_GRACE_MS = 20000;

// ---- Overrides injection (site_overrides.js) ----
const OVERRIDES_FILE = 'site_overrides.js';
const overridesInjected = new Map(); // tabId -> lastInjectedUrl

function isHttpUrl(url = '') {
  return /^https?:\/\//i.test(url);
}

function effectiveUrl(tab) {
  return tab?.url || tab?.pendingUrl || '';
}

function canInjectIntoUrl(url = '') {
  if (!url) return false;
  if (!isHttpUrl(url)) return false;
  if (SYSTEM_PREFIXES.some(prefix => url.startsWith(prefix))) return false;
  return true;
}

function isSystemPage(tabOrUrl) {
  const url = (typeof tabOrUrl === 'string')
    ? tabOrUrl
    : (tabOrUrl?.url || tabOrUrl?.pendingUrl || '');
  if (!url) return false;
  return SYSTEM_PREFIXES.some(prefix => String(url).startsWith(prefix));
}

async function injectOverrides(tabId, url) {
  if (tabId == null) return;
  if (!canInjectIntoUrl(url)) return;

  if (overridesInjected.get(tabId) === url) return;

  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: [OVERRIDES_FILE]
    });
    overridesInjected.set(tabId, url);
    log('overrides injected', { tabId, url });
  } catch (e) {
    // Expected on some restricted pages / timing edges.
    warn('overrides inject failed', { tabId, url, message: String(e?.message || e) });
  }
}

chrome.tabs.onRemoved.addListener((tabId) => {
  overridesInjected.delete(tabId);
});

// ---- UI bridge / receiver (content.js) ----
// const TZ_PORT_NAME = 'TZ_UI_PORT'; // Moved to constants.js

// throttle REFRESH_BAR broadcasts (so we don't spam content scripts)
const UI_REFRESH_DEBOUNCE_MS = 120;
const uiRefreshTimers = new Map(); // windowId -> timerId

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function makeExportFilename() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  return `bodhi-workspace_${ts}.json`;
}

async function downloadJsonObject(obj, filename) {
  const safeName = String(filename || '').trim() || makeExportFilename();
  const json = JSON.stringify(obj ?? null, null, 2);
  const url = `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;

  const downloadId = await chrome.downloads.download({
    url,
    filename: safeName,
    saveAs: true
  });

  return { downloadId };
}

/*
  Helper additions for missing utilities:
  - queryOrderedTabs(windowId): returns tabs sorted by index for the window
  - waitForStableLayout(windowId): simple sampling-based stability check
  - isDraggingError(e): best-effort detection of edit-lock / dragging errors

  These are intentionally minimal and defensive: they avoid throwing and
  return sensible defaults so the service worker remains robust even on
  browsers with different error messages.
*/
async function queryOrderedTabs(windowId) {
  try {
    const tabs = await chrome.tabs.query({ windowId });
    return (tabs || []).slice().sort((a, b) => (Number(a.index) || 0) - (Number(b.index) || 0));
  } catch (e) {
    warn('queryOrderedTabs failed', { windowId, message: String(e?.message || e) });
    return [];
  }
}

async function waitForStableLayout(windowId) {
  // Sample the ordered tab ids a few times with a small gap. If we observe
  // the same ordering for STABLE.REQUIRED_MATCHES consecutive samples, treat
  // the layout as stable.
  try {
    let last = null;
    let consecutiveMatches = 0;

    for (let attempt = 0; attempt < STABLE.MAX_ATTEMPTS; attempt++) {
      const tabs = await queryOrderedTabs(windowId);
      const ids = tabs.map(t => String(t.id)).join(',');
      if (ids === last) {
        consecutiveMatches += 1;
        if (consecutiveMatches >= STABLE.REQUIRED_MATCHES) {
          return { stable: true, attempts: attempt + 1 };
        }
      } else {
        consecutiveMatches = 1;
      }
      last = ids;
      // small pause between samples
      await sleep(STABLE.SAMPLE_GAP_MS);
    }

    return { stable: false, attempts: STABLE.MAX_ATTEMPTS };
  } catch (e) {
    warn('waitForStableLayout failed', { windowId, message: String(e?.message || e) });
    return { stable: false, attempts: 0 };
  }
}

function isDraggingError(e) {
  if (!e) return false;
  const msg = String(e?.message || e).toLowerCase();
  // Best-effort pattern matching for common Chrome/Brave "locked/dragging" messages.
  return /drag|locked|being dragged|editing|cannot (?:complete|move|remove)|temporaril|tab is being/i.test(msg);
}

// ---------------- Scheduler state ----------------
const state = {
  isEnforcing: false,
  pendingWindows: new Set(),
  debounceTimers: new Map(),
  dragTimers: new Map(),
  startupDelayTimers: new Map(), // windowId -> timerId (delay enforcement until after startup grace)
  lastMotionAt: new Map(),
  lastEnforceAt: new Map(),
  retryState: new Map(),

  // NEW: used to suppress "new tab" degroup during session restore/startup.
  startupAt: Date.now(),
};

// Tabs eligible for "keep groups clean" auto-ungroup.
// We only add tabs when we have strong evidence they were user-created (or created by the extension UI).
const autoUngroupEligible = new Set(); // tabId

function markAutoUngroupEligible(tabId) {
  if (tabId == null) return;
  autoUngroupEligible.add(tabId);
}

function clearAutoUngroupEligible(tabId) {
  if (tabId == null) return;
  autoUngroupEligible.delete(tabId);
}

function inStartupGrace() {
  return (Date.now() - (state.startupAt || 0)) < STARTUP_GRACE_MS;
}

function remainingStartupGraceMs() {
  const elapsed = Date.now() - (state.startupAt || 0);
  return Math.max(0, STARTUP_GRACE_MS - elapsed);
}

function scheduleAfterStartupGrace(windowId, reason = 'startupGrace') {
  if (windowId == null || windowId === chrome.windows.WINDOW_ID_NONE) return;
  if (!inStartupGrace()) return;

  // Ensure only one pending timer per window.
  const prev = state.startupDelayTimers.get(windowId);
  if (prev) return;

  const delay = remainingStartupGraceMs() + 120; // small buffer past grace boundary
  log('gate:startupGrace', { windowId, delay, reason });

  const t = setTimeout(() => {
    state.startupDelayTimers.delete(windowId);
    schedule(windowId, `${reason}:afterGrace`);
  }, delay);

  state.startupDelayTimers.set(windowId, t);
}

function markMotion(windowId) {
  if (windowId == null || windowId === chrome.windows.WINDOW_ID_NONE) return;
  state.lastMotionAt.set(windowId, Date.now());
}

function msSinceMotion(windowId) {
  const t = state.lastMotionAt.get(windowId);
  return t ? (Date.now() - t) : Infinity;
}

function inCooldown(windowId) {
  const t = state.lastEnforceAt.get(windowId) || 0;
  return (Date.now() - t) < COOLDOWN_MS;
}

function schedule(windowId, reason) {
  if (windowId == null || windowId === chrome.windows.WINDOW_ID_NONE) return;
  state.pendingWindows.add(windowId);
  drain();
}

function scheduleDebounced(windowId, reason) {
  if (windowId == null || windowId === chrome.windows.WINDOW_ID_NONE) return;

  const prev = state.debounceTimers.get(windowId);
  if (prev) clearTimeout(prev);

  const t = setTimeout(() => {
    state.debounceTimers.delete(windowId);
    schedule(windowId, reason || 'debounced');
  }, DEBOUNCE_MS);

  state.debounceTimers.set(windowId, t);
}

function scheduleAfterDrag(windowId, reason) {
  if (windowId == null || windowId === chrome.windows.WINDOW_ID_NONE) return;

  const prev = state.dragTimers.get(windowId);
  if (prev) clearTimeout(prev);

  const t = setTimeout(() => {
    state.dragTimers.delete(windowId);
    schedule(windowId, reason || 'dragSettle');
  }, DRAG_SETTLE_MS);

  state.dragTimers.set(windowId, t);
}

function clearRetry(windowId) {
  const st = state.retryState.get(windowId);
  if (!st) return;
  if (st.timer != null) clearTimeout(st.timer);
  state.retryState.delete(windowId);
}

function scheduleRetry(windowId, reason) {
  if (windowId == null || windowId === chrome.windows.WINDOW_ID_NONE) return;

  const cur = state.retryState.get(windowId) || { tries: 0, timer: null };
  if (cur.timer != null) return;

  const delay = RETRY_DELAYS_MS[Math.min(cur.tries, RETRY_DELAYS_MS.length - 1)];
  cur.tries += 1;

  log('retry', { windowId, delay, tries: cur.tries, reason });

  cur.timer = setTimeout(() => {
    cur.timer = null;
    state.retryState.set(windowId, cur);
    schedule(windowId, `retry#${cur.tries}`);
  }, delay);

  state.retryState.set(windowId, cur);
}

// ---------------- UI refresh broadcast helpers ----------------
async function broadcastRefresh(windowId) {
  if (windowId == null || windowId === chrome.windows.WINDOW_ID_NONE) return;

  const tabs = await chrome.tabs.query({ windowId });
  for (const t of tabs) {
    if (!t?.id) continue;
    try {
      await chrome.tabs.sendMessage(t.id, { action: 'REFRESH_BAR' });
    } catch {
      // ignore: content script not injected (system pages / extension pages / restricted hosts)
    }
  }
}

async function broadcastRefreshWithRetry(windowId, reason = 'retry') {
  if (windowId == null || windowId === chrome.windows.WINDOW_ID_NONE) return;
  // First attempt immediately
  await broadcastRefresh(windowId);
  // Second attempt shortly after to catch BFCache / late-injected content scripts
  setTimeout(() => {
    broadcastRefresh(windowId).catch(() => {});
  }, UI_REFRESH_RETRY_MS);
}

function scheduleUiRefresh(windowId, reason) {
  if (windowId == null || windowId === chrome.windows.WINDOW_ID_NONE) return;

  const prev = uiRefreshTimers.get(windowId);
  if (prev) clearTimeout(prev);

  const t = setTimeout(() => {
    uiRefreshTimers.delete(windowId);
    broadcastRefreshWithRetry(windowId, reason).catch(() => {});
  }, UI_REFRESH_DEBOUNCE_MS);

  uiRefreshTimers.set(windowId, t);
}

// ---------------- Core enforcement drain ----------------
async function drain() {
  if (state.isEnforcing) return;

  const it = state.pendingWindows.size > 0 ? state.pendingWindows.values().next() : { done: true };
  if (it.done) return;

  const windowId = it.value;
  state.pendingWindows.delete(windowId);

  // During startup/session restore, Chrome may still be assigning groupId/index.
  // Avoid enforcing (moving tabs/groups) until after grace to prevent accidental ungrouping.
  if (inStartupGrace()) {
    scheduleAfterStartupGrace(windowId, 'drain');
    return;
  }

  if (inCooldown(windowId)) {
    setTimeout(() => schedule(windowId, 'cooldown'), COOLDOWN_MS);
    return;
  }

  const since = msSinceMotion(windowId);
  if (since < QUIET_MS) {
    const wait = Math.max(40, QUIET_MS - since);
    log('gate:quiet', { windowId, wait });
    setTimeout(() => schedule(windowId, 'quietGate'), wait);
    return;
  }

  const st = await waitForStableLayout(windowId);
  log('stableResult', { windowId, stable: st.stable });
  if (!st.stable) {
    setTimeout(() => schedule(windowId, 'unstable'), 220);
    return;
  }

  state.isEnforcing = true;
  try {
    state.lastEnforceAt.set(windowId, Date.now());

    const result = await enforceRound(windowId);
    if (result?.ok && !result?.locked) clearRetry(windowId);

    if ((result?.movedTabs || 0) + (result?.movedGroups || 0) > 0) {
      scheduleAfterDrag(windowId, 'followUp');
    }

    scheduleUiRefresh(windowId, 'afterEnforce');
  } finally {
    state.isEnforcing = false;
    if (state.pendingWindows.size) drain();
  }
}

// ---------------- Core enforcement ----------------
async function enforceRound(windowId) {
  log('ENFORCE begin', { windowId });

  let ordered = await queryOrderedTabs(windowId);
  const refresh = async () => { ordered = await queryOrderedTabs(windowId); };

  const isGrouped = (t) => t.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE;
  const isUngrouped = (t) => !t.pinned && !isGrouped(t);

  const isUngroupedWeb = (t) => isUngrouped(t) && !isSystemPage(t);
  const isUngroupedSystem = (t) => isUngrouped(t) && isSystemPage(t);

  const firstIndex = (pred) => {
    const idx = ordered.findIndex(pred);
    return idx === -1 ? ordered.length : idx;
  };

  async function moveTabSafe(tabId, index, reason) {
    const before = ordered.find(t => t.id === tabId);
    const beforeG = before?.groupId;

    log('MOVE', { reason, tabId, from: before?.index, to: index, beforeG });

    await chrome.tabs.move(tabId, { index });
    await refresh();

    const after = ordered.find(t => t.id === tabId);
    const afterG = after?.groupId;

    const becameGrouped =
      (beforeG === chrome.tabGroups.TAB_GROUP_ID_NONE) &&
      (afterG != null && afterG !== chrome.tabGroups.TAB_GROUP_ID_NONE);

    if (becameGrouped) {
      warn('AUTO-GROUP -> ungroup', { tabId, beforeG, afterG });
      await chrome.tabs.ungroup(tabId);
      await refresh();
    }
  }

  try {
    let movedTabs = 0;
    let movedGroups = 0;

    // 1) Pinned -> prefix
    {
      let firstNonPinnedPos = firstIndex(t => !t.pinned);

      for (let i = firstNonPinnedPos; i < ordered.length; i++) {
        const t = ordered[i];
        if (!t.pinned) continue;

        await moveTabSafe(t.id, firstNonPinnedPos, 'pinned->prefix');
        movedTabs += 1;

        firstNonPinnedPos = firstIndex(x => !x.pinned);
        i = firstNonPinnedPos;
      }
    }

    await refresh();
    const afterPinned = firstIndex(t => !t.pinned);

    // 2) Compact groups after pinned
    {
      const groupOrder = [];
      const seen = new Set();

      for (const t of ordered) {
        if (t.pinned || !isGrouped(t) || seen.has(t.groupId)) continue;
        seen.add(t.groupId);
        groupOrder.push(t.groupId);
      }

      let target = afterPinned;
      for (const gid of groupOrder) {
        const firstTabIdx = ordered.findIndex(t => t.groupId === gid);
        if (firstTabIdx === -1) continue;

        if (firstTabIdx !== target) {
          log('MOVE group', { groupId: gid, to: target });
          // Brave/Chromium variants may not expose tabGroups.index reliably.
          // Moving by tab index is still valid, but must be an integer.
          const safeTarget = Number.isInteger(target) ? target : 0;
          await chrome.tabGroups.move(gid, { index: safeTarget });
          movedGroups += 1;
          await refresh();
        }

        const size = ordered.filter(t => t.groupId === gid).length;
        target += size;
      }
    }

    await refresh();

    // 3) Eject ungrouped from group block
    {
      const groupedCount = ordered.filter(t => !t.pinned && isGrouped(t)).length;
      let endOfGroups = afterPinned + groupedCount;

      for (let i = afterPinned; i < endOfGroups && i < ordered.length; i++) {
        const t = ordered[i];
        if (!isUngrouped(t)) continue;

        await moveTabSafe(t.id, endOfGroups, 'ejectUngroupedFromGroupBlock');
        movedTabs += 1;

        await refresh();
        const groupedCount2 = ordered.filter(x => !t.pinned && isGrouped(x)).length;
        endOfGroups = afterPinned + groupedCount2;
        i = afterPinned - 1;
      }
    }

    // 4) Reorder ungrouped (web before system) after groups
    {
      const afterGroups = afterPinned + ordered.filter(t => !t.pinned && isGrouped(t)).length;

      const ungrouped = ordered.filter(t => isUngrouped(t));
      const desiredIds = [
        ...ungrouped.filter(isUngroupedWeb).map(t => t.id),
        ...ungrouped.filter(isUngroupedSystem).map(t => t.id),
      ];

      for (let k = 0; k < desiredIds.length; k++) {
        const wantId = desiredIds[k];
        const pos = afterGroups + k;
        if (ordered[pos]?.id === wantId) continue;

        await moveTabSafe(wantId, pos, 'ungrouped:webBeforeSystem');
        movedTabs += 1;
      }
    }

    log('ENFORCE end', { windowId, movedTabs, movedGroups });
    return { ok: true, locked: false, movedTabs, movedGroups };
  } catch (e) {
    if (isDraggingError(e)) {
      warn('ENFORCE lock', { windowId, message: String(e?.message || e) });
      scheduleRetry(windowId, 'edit-lock');
      return { ok: true, locked: true, movedTabs: 0, movedGroups: 0 };
    }
    warn('ENFORCE error', { windowId, message: String(e?.message || e) }, e);
    throw e;
  }
}

// ---------------- UI query helpers (for content.js) ----------------
async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tabs && tabs.length ? tabs[0] : null;
}

async function getAllGroupsInWindow(windowId) {
  const groups = await chrome.tabGroups.query({ windowId });
  return groups || [];
}

async function getTabsInWindow(windowId) {
  const tabs = await chrome.tabs.query({ windowId });
  return tabs || [];
}

function tabToItem(t) {
  return {
    id: t.id,
    index: t.index,
    title: t.title || '',
    url: t.url || t.pendingUrl || '',
    favIconUrl: t.favIconUrl || '',
    pinned: !!t.pinned,
    groupId: (typeof t.groupId === 'number' ? t.groupId : -1),
  };
}

async function buildUngroupedPayload() {
  const active = await getActiveTab();
  if (!active) {
    return {
      currentTabId: null,
      currentTabTitle: '',
      isCurrentTabGrouped: false,
      pinnedTabs: [],
      webTabs: [],
      systemTabs: [],
      allTabGroups: []
    };
  }

  const windowId = active.windowId;
  const [tabs, groups] = await Promise.all([
    getTabsInWindow(windowId),
    getAllGroupsInWindow(windowId)
  ]);

  const pinnedTabs = [];
  const webTabs = [];
  const systemTabs = [];

  // NEW: groupId -> array(tabItem)
  const groupTabsMap = new Map();

  for (const t of tabs) {
    const item = tabToItem(t);

    if (item.pinned) {
      pinnedTabs.push(item);
      continue;
    }

    // Collect grouped tabs for Level 2 (groups list with favicons)
    if (item.groupId != null && item.groupId !== -1) {
      if (!groupTabsMap.has(item.groupId)) groupTabsMap.set(item.groupId, []);
      groupTabsMap.get(item.groupId).push(item);
      continue;
    }

    // Only UNGROUPED in Level 1:
    if (isSystemPage(t)) systemTabs.push(item);
    else webTabs.push(item);
  }

  const allTabGroups = (groups || []).map(g => ({
    id: g.id,
    title: g.title || 'Group',
    color: g.color || 'default',
    collapsed: !!g.collapsed,
    // NEW: include tabs for this group (sorted)
    tabs: (groupTabsMap.get(g.id) || []).slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0)),
  }));

  const isCurrentTabGrouped = typeof active.groupId === 'number' && active.groupId !== -1;

  return {
    currentTabId: active.id,
    currentTabTitle: active.title || '',
    isCurrentTabGrouped,
    pinnedTabs: pinnedTabs.sort((a, b) => a.index - b.index),
    webTabs: webTabs.sort((a, b) => a.index - b.index),
    systemTabs: systemTabs.sort((a, b) => a.index - b.index),
    allTabGroups
  };
}

async function buildExportPayload() {
  const active = await getActiveTab();
  if (!active) return { pinnedTabs: [], allTabGroups: [] };

  const windowId = active.windowId;
  const [tabs, groups] = await Promise.all([
    getTabsInWindow(windowId),
    getAllGroupsInWindow(windowId)
  ]);

  const pinnedTabs = [];
  const groupTabsMap = new Map(); // groupId -> tabItem[]

  // minimal tab export helper
  const tabToExport = (t) => ({
    url: t.url || t.pendingUrl || ''
  });

  for (const t of tabs) {
    if (t?.pinned) {
      const ex = tabToExport(t);
      if (ex.url) pinnedTabs.push(ex);
      continue;
    }

    const gid = (typeof t?.groupId === 'number') ? t.groupId : -1;
    if (gid !== -1) {
      const ex = tabToExport(t);
      if (!ex.url) continue;
      if (!groupTabsMap.has(gid)) groupTabsMap.set(gid, []);
      groupTabsMap.get(gid).push(ex);
    }
  }

  const allTabGroups = (groups || []).map(g => ({
    title: g.title || 'Group',
    color: g.color || 'default',
    tabs: (groupTabsMap.get(g.id) || []).slice()
  }));

  return { pinnedTabs, allTabGroups };
}

async function buildGroupTabsPayload(groupId) {
  const active = await getActiveTab();
  if (!active) return { tabs: [], groupTitle: 'Group' };

  const windowId = active.windowId;

  const [tabs, groups] = await Promise.all([
    chrome.tabs.query({ windowId, groupId }),
    chrome.tabGroups.query({ windowId })
  ]);

  const group = (groups || []).find(g => g.id === groupId);
  const groupTitle = group?.title || 'Group';

  const outTabs = (tabs || []).map(tabToItem).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

  return { tabs: outTabs, groupTitle };
}

async function switchToTab(tabId) {
  if (tabId == null) return;
  try {
    await chrome.tabs.update(tabId, { active: true });
  } catch {
    // ignore
  }
}

async function openNewTab() {
  await chrome.tabs.create({});
}

// ---------------- Receiver: Port + Messages ----------------
chrome.runtime.onConnect.addListener((port) => {
  if (!port || port.name !== TZ_PORT_NAME) return;

  port.onMessage.addListener((msg) => {
    if (msg?.action === '__TZ_HANDSHAKE__') {
      try { port.postMessage({ action: '__TZ_HANDSHAKE_OK__' }); } catch { /* ignore */ }
    }
  });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    try {
      const action = request?.action;

      if (action === 'GET_UNGROUPED_TABS') {
        const payload = await buildUngroupedPayload();
        sendResponse(payload);
        return;
      }

      if (action === 'GET_GROUP_TABS') {
        const payload = await buildGroupTabsPayload(request.groupId);
        sendResponse(payload);
        return;
      }

      if (action === 'SWITCH_TAB') {
        await switchToTab(request.tabId);
        const active = await getActiveTab();
        if (active?.windowId != null) scheduleUiRefresh(active.windowId, 'SWITCH_TAB');
        sendResponse({ ok: true });
        return;
      }

      if (action === 'OPEN_NEW_TAB') {
        const created = await chrome.tabs.create({});
        if (created?.id != null) markAutoUngroupEligible(created.id);

        const active = await getActiveTab();
        if (active?.windowId != null) scheduleUiRefresh(active.windowId, 'OPEN_NEW_TAB');
        sendResponse({ ok: true });
        return;
      }

      if (action === 'CLOSE_TAB') {
        const tabId = request.tabId;
        if (tabId != null) {
          try { await chrome.tabs.remove(tabId); } catch { /* ignore */ }
        }
        const active = await getActiveTab();
        if (active?.windowId != null) scheduleUiRefresh(active.windowId, 'CLOSE_TAB');
        sendResponse({ ok: true });
        return;
      }

      if (action === 'MOVE_TAB') {
        const tabId = request.tabId;
        const targetTabId = request.targetTabId;
        const placement = request.placement; // 'before' | 'after'

        if (tabId == null || targetTabId == null) {
          sendResponse({ ok: false, error: 'Missing tabId/targetTabId' });
          return;
        }
        if (placement !== 'before' && placement !== 'after') {
          sendResponse({ ok: false, error: 'Invalid placement' });
          return;
        }

        try {
          const [src, tgt] = await Promise.all([
            chrome.tabs.get(tabId),
            chrome.tabs.get(targetTabId),
          ]);

          if (!src || !tgt || src.windowId == null || tgt.windowId == null || src.windowId !== tgt.windowId) {
            sendResponse({ ok: false, error: 'Tabs must be in the same window' });
            return;
          }

          // Enforce "same nature" even if UI tries to do something else.
          if (!!src.pinned !== !!tgt.pinned) {
            sendResponse({ ok: false, error: 'Pinned mismatch' });
            return;
          }

          const srcG = (typeof src.groupId === 'number') ? src.groupId : -1;
          const tgtG = (typeof tgt.groupId === 'number') ? tgt.groupId : -1;
          if (srcG !== tgtG) {
            sendResponse({ ok: false, error: 'Group mismatch' });
            return;
          }

          // If ungrouped + unpinned, enforce web/system separation.
          if (!src.pinned && srcG === chrome.tabGroups.TAB_GROUP_ID_NONE) {
            const srcSys = isSystemPage(src);
            const tgtSys = isSystemPage(tgt);
            if (srcSys !== tgtSys) {
              sendResponse({ ok: false, error: 'Category mismatch (web/system)' });
              return;
            }
          }

          // Compute destination index accounting for index shift when moving forward.
          let index = tgt.index + (placement === 'after' ? 1 : 0);
          if (typeof src.index === 'number' && typeof tgt.index === 'number' && src.index < index) index -= 1;
          if (index < 0) index = 0;

          await chrome.tabs.move(tabId, { index });

          // Re-apply rules after manual reorder.
          touch(src.windowId, 'MOVE_TAB', { motion: true, drag: true });
          scheduleUiRefresh(src.windowId, 'MOVE_TAB:postMove');

          sendResponse({ ok: true });
          return;
        } catch (e) {
          if (isDraggingError(e)) {
            try { scheduleRetry(sender?.tab?.windowId, 'MOVE_TAB lock'); } catch {}
            sendResponse({ ok: false, error: 'LOCKED' });
            return;
          }
          warn('MOVE_TAB error', { tabId, targetTabId, placement, message: String(e?.message || e) });
          sendResponse({ ok: false, error: 'MOVE_TAB failed' });
          return;
        }
      }

      if (action === 'MOVE_GROUP') {
        const groupId = request.groupId;
        const targetGroupId = request.targetGroupId;
        const placement = request.placement; // 'before' | 'after'

        if (groupId == null || targetGroupId == null) {
          sendResponse({ ok: false, error: 'Missing groupId/targetGroupId' });
          return;
        }
        if (placement !== 'before' && placement !== 'after') {
          sendResponse({ ok: false, error: 'Invalid placement' });
          return;
        }

        function toIntOrNull(v) {
          const n = Number(v);
          return Number.isInteger(n) ? n : null;
        }

        async function getGroupAnchorIndex(windowId, gid) {
          // Prefer group.index if present and integer; otherwise derive from first tab index.
          try {
            const groups = await chrome.tabGroups.query({ windowId });
            const g = (groups || []).find(x => x.id === gid);
            const gi = toIntOrNull(g?.index);
            if (gi != null) return gi;
          } catch { /* ignore */ }

          const tabs = await chrome.tabs.query({ windowId, groupId: gid });
          const first = (tabs || []).slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0))[0];
          const ti = toIntOrNull(first?.index);
          return ti != null ? ti : 0;
        }

        async function getGroupSize(windowId, gid) {
          const tabs = await chrome.tabs.query({ windowId, groupId: gid });
          return (tabs || []).length;
        }

        try {
          // Best-effort: infer window from sender tab; fallback to active tab.
          let windowId = sender?.tab?.windowId;
          if (windowId == null || windowId === chrome.windows.WINDOW_ID_NONE) {
            const active = await getActiveTab();
            windowId = active?.windowId;
          }
          if (windowId == null || windowId === chrome.windows.WINDOW_ID_NONE) {
            sendResponse({ ok: false, error: 'No window context' });
            return;
          }

          // Validate groups exist in this window (query is still useful for existence).
          const groups = await chrome.tabGroups.query({ windowId });
          const srcExists = (groups || []).some(g => g.id === groupId);
          const tgtExists = (groups || []).some(g => g.id === targetGroupId);
          if (!srcExists || !tgtExists) {
            sendResponse({ ok: false, error: 'Group not found in this window' });
            return;
          }

          const srcAnchor = await getGroupAnchorIndex(windowId, groupId);
          const tgtAnchor = await getGroupAnchorIndex(windowId, targetGroupId);
          const tgtSize = await getGroupSize(windowId, targetGroupId);

          // Place group before/after the target group's block of tabs.
          let index = tgtAnchor + (placement === 'after' ? tgtSize : 0);
          // If moving forward, account for removal of the source block.
          if (srcAnchor < index) {
            const srcSize = await getGroupSize(windowId, groupId);
            index -= srcSize;
          }
          if (!Number.isInteger(index) || index < 0) index = 0;

          // Extra safety: Brave sometimes returns undefined indices during/after BFCache restores.
          // Ensure we never pass NaN/float to the API.
          index = Math.trunc(index);
          if (!Number.isInteger(index) || index < 0) index = 0;

          await chrome.tabGroups.move(groupId, { index });
          touch(windowId, 'MOVE_GROUP', { motion: true, drag: true });
          scheduleUiRefresh(windowId, 'MOVE_GROUP:postMove');

          sendResponse({ ok: true });
          return;
        } catch (e) {
          if (isDraggingError(e)) {
            try { scheduleRetry(sender?.tab?.windowId, 'MOVE_GROUP lock'); } catch {}
            sendResponse({ ok: false, error: 'LOCKED' });
            return;
          }
          warn('MOVE_GROUP error', { groupId, targetGroupId, placement, message: String(e?.message || e) });
          sendResponse({ ok: false, error: 'MOVE_GROUP failed' });
          return;
        }
      }

      if (action === 'GROUP_TAB') {
        const tabId = request.tabId;
        const groupId = request.groupId;
        if (tabId == null || groupId == null) {
          sendResponse({ ok: false, error: 'Missing tabId/groupId' });
          return;
        }
        try {
          const tab = await chrome.tabs.get(tabId);
          if (!tab?.id || tab.windowId == null) {
            sendResponse({ ok: false, error: 'Tab not found' });
            return;
          }
          if (tab.pinned) {
            sendResponse({ ok: false, error: 'Pinned tabs cannot be grouped' });
            return;
          }
          if (isSystemPage(tab)) {
            sendResponse({ ok: false, error: 'System tabs cannot be grouped' });
            return;
          }

          // Ensure the group exists in the same window (avoid cross-window grouping).
          const groups = await chrome.tabGroups.query({ windowId: tab.windowId });
          const ok = (groups || []).some(g => g.id === groupId);
          if (!ok) {
            sendResponse({ ok: false, error: 'Group not found in this window' });
            return;
          }

          // Prevent auto-ungroup from undoing the user's explicit grouping.
          clearAutoUngroupEligible(tabId);

          await chrome.tabs.group({ tabIds: [tabId], groupId });
          touch(tab.windowId, 'GROUP_TAB', { motion: true, drag: true });
          sendResponse({ ok: true });
          return;
        } catch (e) {
          warn('GROUP_TAB error', { tabId, groupId, message: String(e?.message || e) });
          sendResponse({ ok: false, error: 'GROUP_TAB failed' });
          return;
        }
      }

      if (action === 'GROUP_TAB_NEW') {
        const tabId = request.tabId;
        const title = String(request.title || '').trim();
        const color = String(request.color || 'blue').trim();
        if (tabId == null || !title) {
          sendResponse({ ok: false, error: 'Missing tabId/title' });
          return;
        }
        try {
          const tab = await chrome.tabs.get(tabId);
          if (!tab?.id || tab.windowId == null) {
            sendResponse({ ok: false, error: 'Tab not found' });
            return;
          }
          if (tab.pinned) {
            sendResponse({ ok: false, error: 'Pinned tabs cannot be grouped' });
            return;
          }
          if (isSystemPage(tab)) {
            sendResponse({ ok: false, error: 'System tabs cannot be grouped' });
            return;
          }

          clearAutoUngroupEligible(tabId);

          const newGroupId = await chrome.tabs.group({ tabIds: [tabId] });
          try {
            await chrome.tabGroups.update(newGroupId, { title, color });
          } catch (e) {
            // If color invalid, at least set the title.
            try { await chrome.tabGroups.update(newGroupId, { title }); } catch {}
            warn('GROUP_TAB_NEW update failed', { newGroupId, message: String(e?.message || e) });
          }

          touch(tab.windowId, 'GROUP_TAB_NEW', { motion: true, drag: true });
          sendResponse({ ok: true, groupId: newGroupId });
          return;
        } catch (e) {
          warn('GROUP_TAB_NEW error', { tabId, message: String(e?.message || e) });
          sendResponse({ ok: false, error: 'GROUP_TAB_NEW failed' });
          return;
        }
      }

      if (action === 'UNGROUP_TAB') {
        const tabId = request.tabId;
        if (tabId == null) {
          sendResponse({ ok: false, error: 'Missing tabId' });
          return;
        }
        try {
          const tab = await chrome.tabs.get(tabId);
          if (!tab?.id || tab.windowId == null) {
            sendResponse({ ok: false, error: 'Tab not found' });
            return;
          }
          await chrome.tabs.ungroup(tabId);
          touch(tab.windowId, 'UNGROUP_TAB', { motion: true, drag: true });
          sendResponse({ ok: true });
          return;
        } catch (e) {
          warn('UNGROUP_TAB error', { tabId, message: String(e?.message || e) });
          sendResponse({ ok: false, error: 'UNGROUP_TAB failed' });
          return;
        }
      }

      if (action === 'GET_EXPORT_PAYLOAD') {
        try {
          const payload = await buildExportPayload();
          sendResponse({ ok: true, payload });
          return;
        } catch (e) {
          sendResponse({ ok: false, error: String(e?.message || e || 'GET_EXPORT_PAYLOAD failed') });
          return;
        }
      }

      if (action === 'APPLY_WORKSPACE') {
        try {
          const { payload } = request;
          const { pinnedTabs, allTabGroups } = payload;

          // Get current window
          const activeWindow = await chrome.windows.getLastFocused({});
          if (!activeWindow?.id) {
            sendResponse({ ok: false, error: 'No active window' });
            return;
          }

          // Create a placeholder new tab FIRST (so we never have 0 tabs)
          const blankTab = await chrome.tabs.create({ active: false });

          // Now close all existing tabs (except the blank one we just created)
          const existingTabs = await chrome.tabs.query({ windowId: activeWindow.id });
          const tabIds = existingTabs
            .map(t => t.id)
            .filter(id => id != null && id !== blankTab.id);
          if (tabIds.length > 0) {
            await chrome.tabs.remove(tabIds);
          }

          // Create pinned tabs
          for (const t of pinnedTabs) {
            await chrome.tabs.create({ url: t.url, pinned: true, minimized: true });
          }

          // Create groups and their tabs
          for (const g of allTabGroups) {
            const tabIds = [];
            for (const t of g.tabs) {
              const created = await chrome.tabs.create({ url: t.url, active: false, minimized: true });
              tabIds.push(created.id);
            }
            if (tabIds.length > 0) {
              const groupId = await chrome.tabs.group({ tabIds });
              await chrome.tabGroups.update(groupId, { title: g.title, color: g.color });
            }
          }

          // Move the blank tab to the end
          const allTabs = await chrome.tabs.query({ windowId: activeWindow.id });
          const lastIndex = allTabs.length - 1;
          const blankTabCurrent = allTabs.find(t => t.id === blankTab.id);
          if (blankTabCurrent && typeof blankTabCurrent.index === 'number' && blankTabCurrent.index !== lastIndex) {
            await chrome.tabs.move(blankTab.id, { index: lastIndex });
          }

          sendResponse({ ok: true });
          return;
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
          return;
        }
      }

      if (action === 'DOWNLOAD_JSON') {
        try {
          const payload = request?.payload;
          const filename = String(request?.filename || '').trim() || makeExportFilename();
          const res = await downloadJsonObject(payload, filename);
          sendResponse({ ok: true, ...res });
          return;
        } catch (e) {
          sendResponse({ ok: false, error: String(e?.message || e || 'DOWNLOAD_JSON failed') });
          return;
        }
      }

      if (action === 'EXPORT_TABS') {
        try {
          const payload = await buildExportPayload();
          const filename = makeExportFilename();
          const res = await downloadJsonObject(payload, filename);
          sendResponse({ ok: true, ...res });
          return;
        } catch (e) {
          sendResponse({ ok: false, error: String(e?.message || e || 'EXPORT_TABS failed') });
          return;
        }
      }

      if (action === 'GET_UNGROUPED_TABS') {
        const payload = await buildUngroupedPayload();
        sendResponse(payload);
        return;
      }

      sendResponse(null);
    } catch {
      sendResponse(null);
    }
  })();

  return true;
});

// ---------------- Events ----------------
function touch(windowId, reason, { motion = false, drag = false } = {}) {
  if (windowId == null || windowId === chrome.windows.WINDOW_ID_NONE) return;
  if (motion) markMotion(windowId);
  scheduleDebounced(windowId, reason);
  if (drag) scheduleAfterDrag(windowId, reason);

  scheduleUiRefresh(windowId, reason);
}

chrome.tabs.onCreated.addListener(tab => {
  const eligible = (tab?.openerTabId != null);
  if (eligible) markAutoUngroupEligible(tab.id);

  log('EV onCreated', {
    tabId: tab?.id,
    windowId: tab?.windowId,
    openerTabId: tab?.openerTabId,
    index: tab?.index,
    autoUngroupEligible: eligible
  });

  if (tab?.windowId != null) touch(tab.windowId, 'onCreated');
});

// Native tab strip: keep a "clean" groups state on every tab activation.
// Policy B: collapse all groups; if the active tab is grouped, expand its group.
const groupCollapsePolicy = {
  timers: new Map(), // windowId -> timerId
  lastKeyByWindow: new Map(), // windowId -> string key to avoid redundant work
  DEBOUNCE_MS: 120,
};

async function applyCleanGroupsState(windowId, activeGroupId) {
  if (windowId == null || windowId === chrome.windows.WINDOW_ID_NONE) return;

  try {
    const groups = await chrome.tabGroups.query({ windowId });
    const list = groups || [];

    const ops = [];
    for (const g of list) {
      if (g?.id == null) continue;

      const shouldCollapse = (activeGroupId == null || activeGroupId === chrome.tabGroups.TAB_GROUP_ID_NONE)
        ? true
        : (g.id !== activeGroupId);

      // Only update if it would change something.
      if (!!g.collapsed !== shouldCollapse) {
        ops.push(chrome.tabGroups.update(g.id, { collapsed: shouldCollapse }));
      }
    }

    if (ops.length) await Promise.allSettled(ops);
  } catch (e) {
    if (isDraggingError(e)) return; // ignore edit-lock periods
    warn('applyCleanGroupsState failed', { windowId, activeGroupId, message: String(e?.message || e) });
  }
}

chrome.tabs.onMoved.addListener((tabId, info) => {
  log('EV onMoved', { tabId, windowId: info.windowId, from: info.fromIndex, to: info.toIndex });
  touch(info.windowId, 'onMoved', { motion: true, drag: true });
});

chrome.tabs.onAttached.addListener((tabId, info) => {
  log('EV onAttached', { tabId, windowId: info.newWindowId, index: info.newPosition });
  touch(info.newWindowId, 'onAttached', { motion: true, drag: true });
});

chrome.tabs.onDetached.addListener((tabId, info) => {
  log('EV onDetached', { tabId, windowId: info.oldWindowId, index: info.oldPosition });
  touch(info.oldWindowId, 'onDetached', { motion: true, drag: true });
});

chrome.tabs.onRemoved.addListener((tabId, info) => {
  clearAutoUngroupEligible(tabId);

  if (info?.isWindowClosing) {
    groupCollapsePolicy.lastKeyByWindow.delete(info.windowId);
    const tm = groupCollapsePolicy.timers.get(info.windowId);
    if (tm) clearTimeout(tm);
    groupCollapsePolicy.timers.delete(info.windowId);
  }

  log('EV onRemoved', { tabId, windowId: info.windowId, isWindowClosing: info.isWindowClosing });
  touch(info.windowId, 'onRemoved');
});

chrome.tabs.onActivated.addListener((info) => {
  log('EV onActivated', { tabId: info.tabId, windowId: info.windowId });

  // Policy B: always collapse all groups; if active tab is grouped, keep its group expanded.
  if (!inStartupGrace() && info?.windowId != null && info?.tabId != null) {
    const windowId = info.windowId;

    const prev = groupCollapsePolicy.timers.get(windowId);
    if (prev) clearTimeout(prev);

    const t = setTimeout(async () => {
      groupCollapsePolicy.timers.delete(windowId);

      try {
        const tab = await chrome.tabs.get(info.tabId);
        const gid = (typeof tab?.groupId === 'number') ? tab.groupId : chrome.tabGroups.TAB_GROUP_ID_NONE;

        // Avoid redundant work if nothing changed (same active group vs ungrouped).
        const key = String(gid);
        const lastKey = groupCollapsePolicy.lastKeyByWindow.get(windowId);
        if (lastKey === key) return;
        groupCollapsePolicy.lastKeyByWindow.set(windowId, key);

        await applyCleanGroupsState(windowId, gid);
      } catch (e) {
        if (isDraggingError(e)) return;
        // ignore other errors
      }
    }, groupCollapsePolicy.DEBOUNCE_MS);

    groupCollapsePolicy.timers.set(windowId, t);
  }

  touch(info.windowId, 'onActivated');
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  log('EV onFocusChanged', { windowId });
  touch(windowId, 'onFocusChanged');
});

if (chrome.tabs?.onHighlighted?.addListener) {
  chrome.tabs.onHighlighted.addListener((info) => {
    log('EV onHighlighted', { windowId: info.windowId, tabIds: info.tabIds });
    touch(info.windowId, 'onHighlighted');
  });
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const interesting = !!(changeInfo.url || changeInfo.status || changeInfo.title || Object.prototype.hasOwnProperty.call(changeInfo || {}, 'groupId'));
  if (!interesting) return;

  log('EV onUpdated', { tabId, windowId: tab?.windowId, keys: Object.keys(changeInfo || {}) });

  // Keep groups clean: if an eligible "new" tab becomes grouped, immediately ungroup it.
  // Event-driven (no sweeps) to avoid session-restore wipeouts.
  if (!inStartupGrace() && Object.prototype.hasOwnProperty.call(changeInfo || {}, 'groupId')) {
    try {
      const gid = tab?.groupId;
      const isNowGrouped = (typeof gid === 'number' && gid !== chrome.tabGroups.TAB_GROUP_ID_NONE);

      if (isNowGrouped && autoUngroupEligible.has(tabId) && !tab?.pinned) {
        warn('DEGROUP new-tab (event)', { tabId, groupId: gid, url: effectiveUrl(tab) });
        clearAutoUngroupEligible(tabId);
        await chrome.tabs.ungroup(tabId);
      }
    } catch {
      // ignore: restricted/timing errors
    }
  }

  // Try to inject overrides on "complete" (best effort).
  if (changeInfo.status === 'complete') {
    injectOverrides(tabId, effectiveUrl(tab)).catch(() => {});
  }

  if (tab?.windowId != null) touch(tab.windowId, 'onUpdated');
});

if (chrome.tabGroups?.onMoved?.addListener) {
  chrome.tabGroups.onMoved.addListener((group) => {
    log('EV tabGroups.onMoved', { groupId: group?.id, windowId: group?.windowId, index: group?.index });
    touch(group?.windowId, 'tabGroups.onMoved', { motion: true, drag: true });
  });
}

if (chrome.tabGroups?.onUpdated?.addListener) {
  chrome.tabGroups.onUpdated.addListener((groupId, changeInfo) => {
    log('EV tabGroups.onUpdated', { groupId, changeKeys: Object.keys(changeInfo || {}) });
    chrome.windows.getAll({}, wins => wins.forEach(w => touch(w.id, 'tabGroups.onUpdated', { motion: true, drag: true })));
  });
}

chrome.runtime.onStartup.addListener(() => {
  state.startupAt = Date.now();
  log('EV onStartup');
  chrome.windows.getAll({}, wins => wins.forEach(w => scheduleDebounced(w.id, 'onStartup')));
});

chrome.runtime.onInstalled.addListener(() => {
  state.startupAt = Date.now();
  log('EV onInstalled');
  chrome.windows.getAll({}, wins => wins.forEach(w => scheduleDebounced(w.id, 'onInstalled')));
});
