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
 * M9: HTML5 drag & drop — reorder groups, reorder tabs within a list,
 *     move tabs across groups (and to/from pinned).
 * M10: structural CRUD — add a new group, delete groups, delete tabs,
 *     edit a tab's URL inline (with WEB_URL_RE validation).
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
  input.draggable = false;
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

// --- Drag & drop state ----------------------------------------------------

const dragState = {
  active: false,
  type: null,            // 'group' | 'tab'
  // group source
  sourceGroupIdx: null,  // for type='group'
  // tab source
  sourceListType: null,  // 'pinned' | 'group'
  sourceGroupIdxForTab: null,
  sourceTabIdx: null,
};

function dragReset() {
  dragState.active = false;
  dragState.type = null;
  dragState.sourceGroupIdx = null;
  dragState.sourceListType = null;
  dragState.sourceGroupIdxForTab = null;
  dragState.sourceTabIdx = null;
}

function clearDropIndicators() {
  document.querySelectorAll('.tz-drop-before, .tz-drop-after, .tz-drop-into')
    .forEach((el) => el.classList.remove('tz-drop-before', 'tz-drop-after', 'tz-drop-into'));
}

function isSameTabSource(listType, groupIdx, tabIdx) {
  return dragState.type === 'tab'
    && dragState.sourceListType === listType
    && dragState.sourceGroupIdxForTab === groupIdx
    && dragState.sourceTabIdx === tabIdx;
}

function getTabList(payload, listType, groupIdx) {
  if (listType === 'pinned') return payload.pinnedTabs || (payload.pinnedTabs = []);
  const groups = payload.allTabGroups || (payload.allTabGroups = []);
  const g = groups[groupIdx];
  if (!g) return null;
  return g.tabs || (g.tabs = []);
}

function attachTabDnD(rowEl, listType, groupIdx, tabIdx) {
  rowEl.draggable = true;
  rowEl.dataset.listType = listType;
  if (groupIdx != null) rowEl.dataset.groupIdx = String(groupIdx);
  rowEl.dataset.tabIdx = String(tabIdx);

  rowEl.addEventListener('dragstart', (e) => {
    dragState.active = true;
    dragState.type = 'tab';
    dragState.sourceListType = listType;
    dragState.sourceGroupIdxForTab = (listType === 'group') ? groupIdx : null;
    dragState.sourceTabIdx = tabIdx;
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', 'tab'); } catch {}
    rowEl.classList.add('tz-dragging');
    e.stopPropagation();
  });

  rowEl.addEventListener('dragover', (e) => {
    if (dragState.type !== 'tab') return;
    if (isSameTabSource(listType, listType === 'group' ? groupIdx : null, tabIdx)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = rowEl.getBoundingClientRect();
    const placement = (e.clientY < rect.top + rect.height / 2) ? 'before' : 'after';
    clearDropIndicators();
    rowEl.classList.add(placement === 'before' ? 'tz-drop-before' : 'tz-drop-after');
  });

  rowEl.addEventListener('drop', async (e) => {
    if (dragState.type !== 'tab') return;
    e.preventDefault();
    e.stopPropagation();
    let insertIdx = tabIdx;
    if (rowEl.classList.contains('tz-drop-after')) insertIdx = tabIdx + 1;
    clearDropIndicators();
    await commitTabMove(listType, listType === 'group' ? groupIdx : null, insertIdx);
  });
}

function attachTabEndDropZone(zoneEl, listType, groupIdx) {
  zoneEl.addEventListener('dragover', (e) => {
    if (dragState.type !== 'tab') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clearDropIndicators();
    zoneEl.classList.add('tz-drop-into');
  });
  zoneEl.addEventListener('dragleave', () => {
    zoneEl.classList.remove('tz-drop-into');
  });
  zoneEl.addEventListener('drop', async (e) => {
    if (dragState.type !== 'tab') return;
    e.preventDefault();
    e.stopPropagation();
    clearDropIndicators();
    // Insert at end of list
    await commitTabMove(listType, listType === 'group' ? groupIdx : null, Number.MAX_SAFE_INTEGER);
  });
}

async function commitTabMove(dstListType, dstGroupIdx, dstInsertIdxRaw) {
  const src = {
    listType: dragState.sourceListType,
    groupIdx: dragState.sourceGroupIdxForTab,
    tabIdx: dragState.sourceTabIdx,
  };
  const res = await saveWorkspace({
    mutator: (entry) => {
      const payload = entry.payload || (entry.payload = {});
      const srcList = getTabList(payload, src.listType, src.groupIdx);
      const dstList = getTabList(payload, dstListType, dstGroupIdx);
      if (!srcList || !dstList) return false;
      if (src.tabIdx < 0 || src.tabIdx >= srcList.length) return false;

      let dstInsertIdx = Math.min(dstInsertIdxRaw, dstList.length);
      const sameList = (srcList === dstList);
      const [moved] = srcList.splice(src.tabIdx, 1);
      if (sameList && src.tabIdx < dstInsertIdx) dstInsertIdx -= 1;
      dstList.splice(dstInsertIdx, 0, moved);
    }
  });
  if (!res.ok) {
    flashStatus(res.error || 'Move failed.', 'error', 4000);
    if (res.stale) loadAndRender();
  }
}

function attachGroupDnD(cardEl, groupIdx) {
  cardEl.draggable = true;
  cardEl.dataset.groupIdx = String(groupIdx);

  cardEl.addEventListener('dragstart', (e) => {
    dragState.active = true;
    dragState.type = 'group';
    dragState.sourceGroupIdx = groupIdx;
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', 'group'); } catch {}
    cardEl.classList.add('tz-dragging');
    e.stopPropagation();
  });

  cardEl.addEventListener('dragover', (e) => {
    if (dragState.type !== 'group') return;
    if (groupIdx === dragState.sourceGroupIdx) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = cardEl.getBoundingClientRect();
    const placement = (e.clientY < rect.top + rect.height / 2) ? 'before' : 'after';
    clearDropIndicators();
    cardEl.classList.add(placement === 'before' ? 'tz-drop-before' : 'tz-drop-after');
  });

  cardEl.addEventListener('drop', async (e) => {
    if (dragState.type !== 'group') return;
    e.preventDefault();
    e.stopPropagation();
    let insertIdx = groupIdx;
    if (cardEl.classList.contains('tz-drop-after')) insertIdx = groupIdx + 1;
    const sourceIdx = dragState.sourceGroupIdx;
    if (sourceIdx < insertIdx) insertIdx -= 1;
    clearDropIndicators();
    const res = await saveWorkspace({
      mutator: (entry) => {
        const groups = entry.payload && entry.payload.allTabGroups;
        if (!groups || !groups[sourceIdx]) return false;
        const [moved] = groups.splice(sourceIdx, 1);
        groups.splice(Math.min(insertIdx, groups.length), 0, moved);
      }
    });
    if (!res.ok) {
      flashStatus(res.error || 'Reorder failed.', 'error', 4000);
      if (res.stale) loadAndRender();
    }
  });
}

// Stop dragover bubbling from inside group cards so groups don't fight tabs
function stopGroupContentsDragOver(cardEl) {
  // Tab rows handle their own dragover and the group card handles only group drags.
  // When dragging a TAB over the card body, prevent the group's dragover from
  // claiming the event by short-circuiting at the card level.
  cardEl.addEventListener('dragover', (e) => {
    if (dragState.type === 'tab') {
      // let tab rows / drop zones handle it
      e.stopPropagation();
    }
  }, true);
}

// --- Inline confirm helper -------------------------------------------------

/**
 * Replace a trigger element with an inline "question? Yes No" confirm
 * row. `onConfirm` runs on Yes; the trigger is restored on No or after
 * onConfirm completes (caller typically triggers a re-render that
 * recreates the row anyway).
 */
function inlineConfirm(triggerEl, question, onConfirm) {
  const wrap = document.createElement('span');
  wrap.className = 'inline-confirm';

  const q = document.createElement('span');
  q.className = 'inline-confirm-q';
  q.textContent = question;

  const yes = document.createElement('button');
  yes.type = 'button';
  yes.className = 'inline-confirm-btn yes';
  yes.textContent = 'Yes';
  yes.draggable = false;

  const no = document.createElement('button');
  no.type = 'button';
  no.className = 'inline-confirm-btn no';
  no.textContent = 'No';
  no.draggable = false;

  const restore = () => {
    if (wrap.parentNode) wrap.parentNode.replaceChild(triggerEl, wrap);
  };

  yes.addEventListener('click', async (e) => {
    e.stopPropagation();
    yes.disabled = true;
    no.disabled = true;
    try {
      await onConfirm();
    } catch (err) {
      flashStatus('Action failed.', 'error');
      restore();
    }
  });

  no.addEventListener('click', (e) => {
    e.stopPropagation();
    restore();
  });

  wrap.appendChild(q);
  wrap.appendChild(yes);
  wrap.appendChild(no);

  triggerEl.parentNode.replaceChild(wrap, triggerEl);
}

function isValidWebUrl(url) {
  try {
    if (!url || typeof url !== 'string') return false;
    const trimmed = url.trim();
    if (!WEB_URL_RE.test(trimmed)) return false;
    new URL(trimmed);
    return true;
  } catch {
    return false;
  }
}

function renderTabRow(tab, listType, groupIdx, tabIdx) {
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

  const actions = document.createElement('div');
  actions.className = 'tab-actions';

  const editUrlBtn = document.createElement('button');
  editUrlBtn.type = 'button';
  editUrlBtn.className = 'tab-action-btn edit';
  editUrlBtn.title = 'Edit URL';
  editUrlBtn.draggable = false;
  editUrlBtn.innerHTML = '&#9999;'; // ✏
  editUrlBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    startInlineEdit(hostEl, {
      initialValue: tab.url || '',
      maxLength: 2000,
      inputClass: 'tab-url-input',
      onCommit: async (raw) => {
        const next = String(raw || '').trim();
        if (!isValidWebUrl(next)) {
          flashStatus('URL must start with http:// or https://', 'error', 4000);
          return false;
        }
        if (next === (tab.url || '')) return true;
        const res = await saveWorkspace({
          mutator: (entry) => {
            const list = getTabList(entry.payload || {}, listType, groupIdx);
            if (!list || !list[tabIdx]) return false;
            list[tabIdx].url = next;
          }
        });
        if (!res.ok) {
          flashStatus(res.error || 'Save failed.', 'error', 4000);
          if (res.stale) loadAndRender();
          return false;
        }
        flashStatus('URL updated.', 'success');
        return true;
      }
    });
  });

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'tab-action-btn delete';
  delBtn.title = 'Delete tab';
  delBtn.draggable = false;
  delBtn.innerHTML = '&#128465;'; // 🗑
  delBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    inlineConfirm(delBtn, 'Delete?', async () => {
      const res = await saveWorkspace({
        mutator: (entry) => {
          const list = getTabList(entry.payload || {}, listType, groupIdx);
          if (!list || !list[tabIdx]) return false;
          list.splice(tabIdx, 1);
        }
      });
      if (!res.ok) {
        flashStatus(res.error || 'Delete failed.', 'error', 4000);
        if (res.stale) loadAndRender();
      } else {
        flashStatus('Tab deleted.', 'success');
      }
    });
  });

  actions.appendChild(editUrlBtn);
  actions.appendChild(delBtn);

  li.appendChild(dot);
  li.appendChild(label);
  li.appendChild(actions);

  attachTabDnD(li, listType, groupIdx, tabIdx);
  return li;
}

function renderPinned(pinnedTabs) {
  // Always shown so it can receive drops, even when empty.
  els.pinnedSection.hidden = false;
  els.pinnedList.innerHTML = '';
  const tabs = pinnedTabs || [];
  for (let i = 0; i < tabs.length; i++) {
    els.pinnedList.appendChild(renderTabRow(tabs[i], 'pinned', null, i));
  }
  const endZone = document.createElement('li');
  endZone.className = 'tab-drop-end';
  endZone.textContent = tabs.length ? '' : 'Drop a tab here to pin it';
  attachTabEndDropZone(endZone, 'pinned', null);
  els.pinnedList.appendChild(endZone);
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
  colorBtn.draggable = false;
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

  const groupDelBtn = document.createElement('button');
  groupDelBtn.type = 'button';
  groupDelBtn.className = 'group-action-btn delete';
  groupDelBtn.title = 'Delete group';
  groupDelBtn.draggable = false;
  groupDelBtn.innerHTML = '&#128465;'; // 🗑
  groupDelBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const question = count > 0 ? `Delete group + ${count} tab${count === 1 ? '' : 's'}?` : 'Delete group?';
    inlineConfirm(groupDelBtn, question, async () => {
      const res = await saveWorkspace({
        mutator: (entry) => {
          const groups = entry.payload && entry.payload.allTabGroups;
          if (!groups || !groups[groupIndex]) return false;
          groups.splice(groupIndex, 1);
        }
      });
      if (!res.ok) {
        flashStatus(res.error || 'Delete failed.', 'error', 4000);
        if (res.stale) loadAndRender();
      } else {
        flashStatus('Group deleted.', 'success');
      }
    });
  });

  header.appendChild(colorBtn);
  header.appendChild(titleEl);
  header.appendChild(metaEl);
  header.appendChild(groupDelBtn);

  const tabsUl = document.createElement('ul');
  tabsUl.className = 'group-tabs';
  const tabsArr = group.tabs || [];
  for (let i = 0; i < tabsArr.length; i++) {
    tabsUl.appendChild(renderTabRow(tabsArr[i], 'group', groupIndex, i));
  }
  const endZone = document.createElement('li');
  endZone.className = 'tab-drop-end';
  endZone.textContent = tabsArr.length ? '' : 'Drop a tab here';
  attachTabEndDropZone(endZone, 'group', groupIndex);
  tabsUl.appendChild(endZone);

  card.appendChild(header);
  card.appendChild(tabsUl);

  attachGroupDnD(card, groupIndex);
  stopGroupContentsDragOver(card);
  return card;
}

function renderGroups(groups) {
  els.groupsList.innerHTML = '';
  if (!groups || !groups.length) {
    const empty = document.createElement('li');
    empty.className = 'empty-note';
    empty.textContent = 'No groups in this workspace.';
    els.groupsList.appendChild(empty);
  } else {
    for (let i = 0; i < groups.length; i++) {
      els.groupsList.appendChild(renderGroupCard(groups[i], i));
    }
  }
  els.groupsList.appendChild(buildAddGroupRow());
}

function populateAddGroupRow(li) {
  li.innerHTML = '';
  li.className = 'add-group-row';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'add-group-btn';
  btn.textContent = '+ New group';
  btn.draggable = false;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    showAddGroupForm(li);
  });

  li.appendChild(btn);
}

function buildAddGroupRow() {
  const li = document.createElement('li');
  populateAddGroupRow(li);
  return li;
}

function showAddGroupForm(rowEl) {
  rowEl.innerHTML = '';

  const form = document.createElement('div');
  form.className = 'add-group-form';

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Group title';
  input.className = 'inline-edit-input';
  input.maxLength = 60;
  input.draggable = false;

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'inline-confirm-btn yes';
  save.textContent = 'Add';
  save.draggable = false;

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'inline-confirm-btn no';
  cancel.textContent = 'Cancel';
  cancel.draggable = false;

  const restore = () => populateAddGroupRow(rowEl);

  const submit = async () => {
    const title = String(input.value || '').trim();
    if (!title) {
      flashStatus('Group title cannot be empty.', 'error');
      input.focus();
      return;
    }
    save.disabled = true;
    cancel.disabled = true;
    const res = await saveWorkspace({
      mutator: (entry) => {
        const payload = entry.payload || (entry.payload = {});
        const groups = payload.allTabGroups || (payload.allTabGroups = []);
        groups.push({ title, color: 'grey', tabs: [] });
      }
    });
    if (!res.ok) {
      flashStatus(res.error || 'Add failed.', 'error', 4000);
      if (res.stale) loadAndRender();
      save.disabled = false;
      cancel.disabled = false;
      return;
    }
    flashStatus('Group added.', 'success');
    // The storage onChanged listener will trigger a full re-render.
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
    else if (e.key === 'Escape') { e.preventDefault(); restore(); }
  });
  save.addEventListener('click', (e) => { e.stopPropagation(); submit(); });
  cancel.addEventListener('click', (e) => { e.stopPropagation(); restore(); });

  form.appendChild(input);
  form.appendChild(save);
  form.appendChild(cancel);
  rowEl.appendChild(form);
  input.focus();
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

  // Global cleanup: clear drop indicators and reset drag state when a
  // drag ends, regardless of whether it was successful.
  document.addEventListener('dragend', () => {
    clearDropIndicators();
    document.querySelectorAll('.tz-dragging').forEach((el) => el.classList.remove('tz-dragging'));
    dragReset();
  });
}

document.addEventListener('DOMContentLoaded', init);
