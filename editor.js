/**
 * editor.js - Workspace editor (M7: read-only scaffolding)
 *
 * Loads a saved workspace by name from chrome.storage.local
 * (STORAGE_KEY_WORKSPACES) and renders a tree view:
 *   workspace -> [pinned] -> [groups -> tabs]
 *
 * Tab labels prefer the captured `title` field (added by
 * buildExportPayload), falling back to the URL hostname for
 * back-compat with older payloads.
 */

const els = {};
let currentWorkspaceName = null;

function readWorkspaceNameFromUrl() {
  const params = new URLSearchParams(location.search);
  const raw = params.get('ws');
  return raw ? decodeURIComponent(raw) : '';
}

function storageGetWorkspaces() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get([STORAGE_KEY_WORKSPACES], (obj) => {
        resolve((obj && obj[STORAGE_KEY_WORKSPACES]) || {});
      });
    } catch {
      resolve({});
    }
  });
}

function setStatus(text, kind) {
  if (!els.status) return;
  els.status.textContent = text || '';
  els.status.classList.remove('error', 'success');
  if (kind === 'error') els.status.classList.add('error');
  else if (kind === 'success') els.status.classList.add('success');
}

function hostFromUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function tabLabel(tab) {
  const raw = (tab && tab.title) ? String(tab.title).trim() : '';
  if (raw) return raw;
  const host = hostFromUrl(tab && tab.url);
  return host || (tab && tab.url) || 'Tab';
}

function renderTabRow(tab) {
  const li = document.createElement('li');
  li.className = 'tab-row';

  const dot = document.createElement('span');
  dot.className = 'tab-dot';
  dot.setAttribute('aria-hidden', 'true');

  const label = document.createElement('div');
  label.className = 'tab-label';

  const titleEl = document.createElement('span');
  titleEl.className = 'tab-title';
  titleEl.textContent = tabLabel(tab);
  titleEl.title = tab.url || '';

  const hostEl = document.createElement('span');
  hostEl.className = 'tab-host';
  hostEl.textContent = hostFromUrl(tab.url) || tab.url || '';

  label.appendChild(titleEl);
  label.appendChild(hostEl);

  li.appendChild(dot);
  li.appendChild(label);
  return li;
}

function renderPinned(pinnedTabs) {
  els.pinnedSection.hidden = !pinnedTabs || !pinnedTabs.length;
  els.pinnedList.innerHTML = '';
  for (const t of (pinnedTabs || [])) {
    els.pinnedList.appendChild(renderTabRow(t));
  }
}

function colorToHex(color) {
  const map = (typeof GROUP_COLOR_MAP !== 'undefined') ? GROUP_COLOR_MAP : null;
  if (map && map[color]) return map[color];
  return (map && map.default) || '#505050';
}

function renderGroupCard(group) {
  const card = document.createElement('li');
  card.className = 'group-card';

  const header = document.createElement('div');
  header.className = 'group-header';
  header.style.borderLeftColor = colorToHex(group.color || 'grey');

  const titleEl = document.createElement('span');
  titleEl.className = 'group-title';
  titleEl.textContent = group.title || 'Group';

  const metaEl = document.createElement('span');
  metaEl.className = 'group-meta';
  const count = (group.tabs && group.tabs.length) || 0;
  metaEl.textContent = `${count} tab${count === 1 ? '' : 's'}`;

  header.appendChild(titleEl);
  header.appendChild(metaEl);

  const tabsUl = document.createElement('ul');
  tabsUl.className = 'group-tabs';
  for (const t of (group.tabs || [])) {
    tabsUl.appendChild(renderTabRow(t));
  }
  if (!count) {
    const empty = document.createElement('li');
    empty.className = 'empty-note';
    empty.textContent = 'No tabs in this group.';
    tabsUl.appendChild(empty);
  }

  card.appendChild(header);
  card.appendChild(tabsUl);
  return card;
}

function renderGroups(groups) {
  els.groupsList.innerHTML = '';
  if (!groups || !groups.length) {
    const empty = document.createElement('li');
    empty.className = 'empty-note';
    empty.textContent = 'No groups in this workspace.';
    els.groupsList.appendChild(empty);
    return;
  }
  for (const g of groups) {
    els.groupsList.appendChild(renderGroupCard(g));
  }
}

function renderHeader(name, entry) {
  els.wsName.textContent = name;
  document.title = `Bodhi Bar — ${name}`;
  const ts = entry && entry.savedAt ? new Date(entry.savedAt) : null;
  if (ts && !isNaN(ts.getTime())) {
    els.wsMeta.textContent = `saved ${ts.toLocaleString()}`;
  } else {
    els.wsMeta.textContent = '';
  }
}

function renderNotFound(name) {
  els.wsName.textContent = name || '(no workspace)';
  els.wsMeta.textContent = '';
  els.pinnedSection.hidden = true;
  els.groupsList.innerHTML = '';
  setStatus(`Workspace "${name}" not found. Open the popover to manage workspaces.`, 'error');
}

async function loadAndRender() {
  const name = readWorkspaceNameFromUrl();
  currentWorkspaceName = name;

  if (!name) {
    renderNotFound('');
    return;
  }

  const all = await storageGetWorkspaces();
  const entry = all[name];
  if (!entry) {
    renderNotFound(name);
    return;
  }

  const payload = entry.payload || {};
  renderHeader(name, entry);
  renderPinned(payload.pinnedTabs || []);
  renderGroups(payload.allTabGroups || []);
  setStatus('');
}

function init() {
  els.status = document.getElementById('editor-status');
  els.wsName = document.getElementById('ws-name');
  els.wsMeta = document.getElementById('ws-meta');
  els.toolbar = document.getElementById('ws-toolbar');
  els.pinnedSection = document.getElementById('pinned-section');
  els.pinnedList = document.getElementById('pinned-list');
  els.groupsSection = document.getElementById('groups-section');
  els.groupsList = document.getElementById('groups-list');

  loadAndRender();

  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes[STORAGE_KEY_WORKSPACES]) loadAndRender();
    });
  }
}

document.addEventListener('DOMContentLoaded', init);
