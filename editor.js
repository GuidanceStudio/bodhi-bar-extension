/**
 * editor.js - Workspace editor
 *
 * Loads a saved workspace by name from chrome.storage.local
 * (STORAGE_KEY_WORKSPACES) and renders a tree view:
 *   workspace -> [pinned] -> [groups -> tabs]
 *
 * M7: read-only render + tab.title fallback to hostname.
 * M8: inline rename (workspace + group), color picker, saveWorkspace
 *     helper with savedAt concurrency check.
 */

const els = {};
let currentWorkspaceName = null;
let loadedSavedAt = null;
let suppressNextReload = false;

function readWorkspaceNameFromUrl() {
  const params = new URLSearchParams(location.search);
  const raw = params.get('ws');
  return raw ? decodeURIComponent(raw) : '';
}

function setUrlWorkspaceName(name) {
  const url = new URL(location.href);
  url.searchParams.set('ws', name);
  history.replaceState(null, '', url.toString());
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

function storageSetWorkspaces(map) {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.set({ [STORAGE_KEY_WORKSPACES]: map || {} }, () => resolve(true));
    } catch {
      resolve(false);
    }
  });
}

function sanitizeWorkspaceName(name) {
  const s = String(name || '').trim().replace(/\s+/g, ' ');
  if (!s) return '';
  return s.slice(0, PRESET_NAME_MAX_LEN);
}

function setStatus(text, kind) {
  if (!els.status) return;
  els.status.textContent = text || '';
  els.status.classList.remove('error', 'success');
  if (kind === 'error') els.status.classList.add('error');
  else if (kind === 'success') els.status.classList.add('success');
}

let statusClearTimer = null;
function flashStatus(text, kind, ms) {
  setStatus(text, kind);
  if (statusClearTimer) clearTimeout(statusClearTimer);
  statusClearTimer = setTimeout(() => setStatus(''), ms || 2500);
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

function colorToHex(color) {
  const map = (typeof GROUP_COLOR_MAP !== 'undefined') ? GROUP_COLOR_MAP : null;
  if (map && map[color]) return map[color];
  return (map && map.default) || '#505050';
}

function colorList() {
  const map = (typeof GROUP_COLOR_MAP !== 'undefined') ? GROUP_COLOR_MAP : {};
  return Object.keys(map).filter((k) => k !== 'default');
}

/**
 * Save the workspace by re-reading the storage map, validating that
 * savedAt matches what we loaded, applying `mutator(entry)` on a deep
 * copy of the entry, optionally renaming the key, and writing back.
 *
 * Returns { ok, error?, newName? }.
 */
async function saveWorkspace(opts) {
  const mutator = opts.mutator || ((e) => e);
  const renameTo = opts.renameTo;

  const all = await storageGetWorkspaces();
  const entry = all[currentWorkspaceName];
  if (!entry) {
    return { ok: false, error: 'Workspace no longer exists.' };
  }
  if (loadedSavedAt != null && entry.savedAt !== loadedSavedAt) {
    return { ok: false, error: 'Workspace was modified externally. Reloading…', stale: true };
  }

  const next = JSON.parse(JSON.stringify(entry));
  const result = mutator(next);
  if (result === false) return { ok: false, error: 'No change.' };

  next.savedAt = Date.now();

  let nextName = currentWorkspaceName;
  if (renameTo && renameTo !== currentWorkspaceName) {
    if (all[renameTo]) {
      return { ok: false, error: `Name "${renameTo}" already exists.` };
    }
    nextName = renameTo;
    next.name = renameTo;
    delete all[currentWorkspaceName];
  }
  all[nextName] = next;

  suppressNextReload = true;
  await storageSetWorkspaces(all);

  currentWorkspaceName = nextName;
  loadedSavedAt = next.savedAt;
  if (renameTo) setUrlWorkspaceName(nextName);

  return { ok: true, newName: nextName };
}

/**
 * Replace `targetEl` with an inline input. Enter saves via onCommit;
 * Esc / blur cancels. onCommit is async and returns true on success
 * (the caller handles re-rendering); on false the input stays open.
 */
function startInlineEdit(targetEl, opts) {
  const initial = opts.initialValue != null ? opts.initialValue : targetEl.textContent;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = initial;
  input.className = 'inline-edit-input ' + (opts.inputClass || '');
  if (opts.maxLength) input.maxLength = opts.maxLength;

  const restore = () => {
    if (input.parentNode) input.parentNode.replaceChild(targetEl, input);
  };

  let committed = false;
  const commit = async () => {
    if (committed) return;
    committed = true;
    const raw = input.value;
    const ok = await opts.onCommit(raw);
    if (ok) {
      restore();
    } else {
      committed = false;
      input.focus();
      input.select();
    }
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      committed = true;
      restore();
    }
  });
  input.addEventListener('blur', () => {
    if (committed) return;
    commit();
  });

  targetEl.parentNode.replaceChild(input, targetEl);
  input.focus();
  input.select();
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

function buildColorSwatchPopover(currentColor, onPick) {
  const popover = document.createElement('div');
  popover.className = 'color-popover';
  popover.setAttribute('role', 'menu');

  for (const c of colorList()) {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'color-swatch';
    if (c === currentColor) swatch.classList.add('selected');
    swatch.style.background = colorToHex(c);
    swatch.title = c;
    swatch.addEventListener('click', (e) => {
      e.stopPropagation();
      onPick(c);
    });
    popover.appendChild(swatch);
  }
  return popover;
}

function openColorPicker(anchorEl, currentColor, onPick) {
  closeAllPopovers();
  const popover = buildColorSwatchPopover(currentColor, async (color) => {
    closeAllPopovers();
    await onPick(color);
  });
  popover.dataset.popover = 'color';
  document.body.appendChild(popover);
  const rect = anchorEl.getBoundingClientRect();
  popover.style.top = (rect.bottom + window.scrollY + 4) + 'px';
  popover.style.left = (rect.left + window.scrollX) + 'px';
  // Close on outside click (deferred so the opening click doesn't count)
  setTimeout(() => {
    const handler = (e) => {
      if (!popover.contains(e.target)) {
        closeAllPopovers();
        document.removeEventListener('click', handler, true);
      }
    };
    document.addEventListener('click', handler, true);
    popover._closer = () => document.removeEventListener('click', handler, true);
  }, 0);
}

function closeAllPopovers() {
  document.querySelectorAll('[data-popover]').forEach((p) => {
    if (p._closer) p._closer();
    p.remove();
  });
}

function renderGroupCard(group, groupIndex) {
  const card = document.createElement('li');
  card.className = 'group-card';
  card.dataset.groupIndex = String(groupIndex);

  const header = document.createElement('div');
  header.className = 'group-header';
  header.style.borderLeftColor = colorToHex(group.color || 'grey');

  const colorBtn = document.createElement('button');
  colorBtn.type = 'button';
  colorBtn.className = 'group-color-btn';
  colorBtn.style.background = colorToHex(group.color || 'grey');
  colorBtn.title = `Color: ${group.color || 'grey'} (click to change)`;
  colorBtn.setAttribute('aria-label', 'Change group color');
  colorBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openColorPicker(colorBtn, group.color || 'grey', async (newColor) => {
      const res = await saveWorkspace({
        mutator: (entry) => {
          const g = entry.payload && entry.payload.allTabGroups && entry.payload.allTabGroups[groupIndex];
          if (!g) return false;
          if (g.color === newColor) return false;
          g.color = newColor;
        }
      });
      if (!res.ok) {
        flashStatus(res.error || 'Save failed.', 'error', 4000);
        if (res.stale) loadAndRender();
      } else {
        flashStatus('Color updated.', 'success');
      }
    });
  });

  const titleEl = document.createElement('span');
  titleEl.className = 'group-title editable';
  titleEl.textContent = group.title || 'Group';
  titleEl.title = 'Click to rename group';
  titleEl.addEventListener('click', (e) => {
    e.stopPropagation();
    startInlineEdit(titleEl, {
      initialValue: group.title || '',
      maxLength: 60,
      inputClass: 'group-title-input',
      onCommit: async (raw) => {
        const next = String(raw || '').trim();
        if (!next) {
          flashStatus('Group title cannot be empty.', 'error');
          return false;
        }
        if (next === (group.title || '')) {
          // no-op, just close
          return true;
        }
        const res = await saveWorkspace({
          mutator: (entry) => {
            const g = entry.payload && entry.payload.allTabGroups && entry.payload.allTabGroups[groupIndex];
            if (!g) return false;
            g.title = next;
          }
        });
        if (!res.ok) {
          flashStatus(res.error || 'Save failed.', 'error', 4000);
          if (res.stale) loadAndRender();
          return false;
        }
        flashStatus('Group renamed.', 'success');
        return true;
      }
    });
  });

  const metaEl = document.createElement('span');
  metaEl.className = 'group-meta';
  const count = (group.tabs && group.tabs.length) || 0;
  metaEl.textContent = `${count} tab${count === 1 ? '' : 's'}`;

  header.appendChild(colorBtn);
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
  for (let i = 0; i < groups.length; i++) {
    els.groupsList.appendChild(renderGroupCard(groups[i], i));
  }
}

function renderHeader(name, entry) {
  els.wsName.textContent = name;
  els.wsName.title = 'Click to rename workspace';
  els.wsName.classList.add('editable');
  document.title = `Bodhi Bar — ${name}`;
  const ts = entry && entry.savedAt ? new Date(entry.savedAt) : null;
  if (ts && !isNaN(ts.getTime())) {
    els.wsMeta.textContent = `saved ${ts.toLocaleString()}`;
  } else {
    els.wsMeta.textContent = '';
  }
}

function attachWorkspaceNameRename() {
  els.wsName.addEventListener('click', (e) => {
    e.stopPropagation();
    startInlineEdit(els.wsName, {
      initialValue: currentWorkspaceName,
      maxLength: PRESET_NAME_MAX_LEN,
      inputClass: 'ws-name-input',
      onCommit: async (raw) => {
        const next = sanitizeWorkspaceName(raw);
        if (!next) {
          flashStatus('Workspace name cannot be empty.', 'error');
          return false;
        }
        if (next === currentWorkspaceName) return true;
        const res = await saveWorkspace({ renameTo: next, mutator: () => {} });
        if (!res.ok) {
          flashStatus(res.error || 'Rename failed.', 'error', 4000);
          if (res.stale) loadAndRender();
          return false;
        }
        flashStatus('Workspace renamed.', 'success');
        return true;
      }
    });
  });
}

function renderNotFound(name) {
  els.wsName.textContent = name || '(no workspace)';
  els.wsMeta.textContent = '';
  els.pinnedSection.hidden = true;
  els.groupsList.innerHTML = '';
  setStatus(`Workspace "${name}" not found. Open the popover to manage workspaces.`, 'error');
}

async function loadAndRender() {
  const name = currentWorkspaceName || readWorkspaceNameFromUrl();
  if (!currentWorkspaceName) currentWorkspaceName = name;

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

  loadedSavedAt = entry.savedAt;

  const payload = entry.payload || {};
  renderHeader(name, entry);
  renderPinned(payload.pinnedTabs || []);
  renderGroups(payload.allTabGroups || []);
  // Keep status messages alive across re-renders unless empty
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

  currentWorkspaceName = readWorkspaceNameFromUrl();
  attachWorkspaceNameRename();

  loadAndRender();

  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (!changes[STORAGE_KEY_WORKSPACES]) return;
      if (suppressNextReload) {
        suppressNextReload = false;
        loadAndRender();
        return;
      }
      loadAndRender();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAllPopovers();
  });
}

document.addEventListener('DOMContentLoaded', init);
