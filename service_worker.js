// service_worker.js (MV3) - Receiver for content.js (v2.4.x)
//
// NOTE: This file is now redundant because manifest.json uses background.js as the service worker.
// Keep it only if you plan to switch manifest background.service_worker back to service_worker.js.

const TZ_PORT_NAME = 'TZ_UI_PORT';

function isSystemUrl(url = '') {
  return (
    url.startsWith('chrome://') ||
    url.startsWith('edge://') ||
    url.startsWith('about:') ||
    url.startsWith('brave://') ||
    url.startsWith('opera://') ||
    url.startsWith('vivaldi://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('devtools://') ||
    url.startsWith('view-source:')
  );
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tabs && tabs.length ? tabs[0] : null;
}

async function getAllGroupsInWindow(windowId) {
  // chrome.tabGroups.query requires tabGroups permission
  const groups = await chrome.tabGroups.query({ windowId });
  return groups || [];
}

async function getTabsInWindow(windowId) {
  const tabs = await chrome.tabs.query({ windowId });
  return tabs || [];
}

async function buildUngroupedPayload() {
  const active = await getActiveTab();
  if (!active) {
    return {
      currentTabId: null,
      currentTabTitle: '',
      isCurrentTabGrouped: false,
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

  const webTabs = [];
  const systemTabs = [];

  for (const t of tabs) {
    const item = {
      id: t.id,
      index: t.index,
      title: t.title || '',
      url: t.url || '',
      favIconUrl: t.favIconUrl || ''
    };

    if (isSystemUrl(t.url || '')) systemTabs.push(item);
    else webTabs.push(item);
  }

  const allTabGroups = (groups || []).map(g => ({
    id: g.id,
    title: g.title || 'Group',
    color: g.color || 'default',
    collapsed: !!g.collapsed
  }));

  const isCurrentTabGrouped = typeof active.groupId === 'number' && active.groupId !== -1;

  return {
    currentTabId: active.id,
    currentTabTitle: active.title || '',
    isCurrentTabGrouped,
    webTabs,
    systemTabs,
    allTabGroups
  };
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

  const outTabs = (tabs || []).map(t => ({
    id: t.id,
    index: t.index,
    title: t.title || '',
    url: t.url || '',
    favIconUrl: t.favIconUrl || ''
  }));

  return { tabs: outTabs, groupTitle };
}

async function switchToTab(tabId) {
  if (!tabId && tabId !== 0) return;
  try {
    await chrome.tabs.update(tabId, { active: true });
  } catch {
    // ignore
  }
}

async function openNewTab() {
  await chrome.tabs.create({});
}

async function broadcastRefresh(windowId) {
  // Tell all content scripts to refresh their UI
  const tabs = await chrome.tabs.query({ windowId });
  for (const t of tabs) {
    if (!t.id) continue;
    try {
      await chrome.tabs.sendMessage(t.id, { action: 'REFRESH_BAR' });
    } catch {
      // ignore tabs where content script is not injected
    }
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (!port || port.name !== TZ_PORT_NAME) return;

  port.onMessage.addListener((msg) => {
    if (msg?.action === '__TZ_HANDSHAKE__') {
      try {
        port.postMessage({ action: '__TZ_HANDSHAKE_OK__' });
      } catch {
        // ignore
      }
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
        if (active?.windowId != null) await broadcastRefresh(active.windowId);
        sendResponse({ ok: true });
        return;
      }

      if (action === 'OPEN_NEW_TAB') {
        await openNewTab();
        const active = await getActiveTab();
        if (active?.windowId != null) await broadcastRefresh(active.windowId);
        sendResponse({ ok: true });
        return;
      }

      // Unknown action
      sendResponse(null);
    } catch (e) {
      sendResponse(null);
    }
  })();

  // Keep the message channel open for async response
  return true;
});
