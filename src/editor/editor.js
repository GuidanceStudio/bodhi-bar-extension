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
 * M11: (removed in M16) per-tab visibility mode select and site-overrides
 *     panel — the visibility-mode and site-override features no longer exist.
 * M12: switch from autosave to explicit Save/Discard. Mutations now
 *     update an in-memory editorState; the user commits to storage
 *     by clicking Save (or Cmd/Ctrl+S). Concurrency conflicts surface
 *     a discard-or-overwrite picker. beforeunload warns if dirty.
 * M13: add new tabs to any group or pinned list — the drop-end zone
 *     doubles as a "+ Add tab" inline form trigger.
 */

const els = {};

const editorState = {
  originalName: null,   // workspace key currently in storage
  name: null,           // workspace name in the editor (may differ if renamed)
  loadedSavedAt: null,  // savedAt at last load — used for concurrency check
  payload: null,        // working copy of the workspace payload
  dirty: false,
};

// True while commitSave is writing — used to ignore the storage echo of our own write.
let savingInFlight = false;

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
 * Apply a mutation to the in-memory editor state.
 *
 * `mutator(payload)` may return `false` to signal a no-op (skips
 * dirtying the state). Any other return value is treated as a
 * successful mutation. Errors thrown inside the mutator propagate.
 *
 * Always re-renders so the UI reflects the new payload.
 */
function applyMutation(mutator) {
  if (!editorState.payload) return false;
  const result = mutator(editorState.payload);
  if (result === false) {
    renderFromState();
    return false;
  }
  setDirty(true);
  renderFromState();
  return true;
}

/**
 * Toggle the dirty flag and refresh dependent UI (toolbar buttons,
 * dirty dot, document title).
 */
function setDirty(flag) {
  const next = !!flag;
  if (editorState.dirty === next) {
    syncDirtyUi();
    return;
  }
  editorState.dirty = next;
  syncDirtyUi();
}

function syncDirtyUi() {
  const dirty = !!editorState.dirty;
  if (els.saveBtn) els.saveBtn.disabled = !dirty;
  if (els.discardBtn) els.discardBtn.disabled = !dirty;
  if (els.dirtyDot) els.dirtyDot.classList.toggle('visible', dirty);
  if (editorState.name) {
    document.title = `${dirty ? '● ' : ''}Bodhi Bar — ${editorState.name}`;
  }
}

/**
 * Read the current workspace from storage and populate `editorState`.
 * Used at init and on Discard.
 */
async function loadFromStorage(name) {
  const targetName = name || editorState.originalName || readWorkspaceNameFromUrl();
  if (!targetName) {
    editorState.originalName = null;
    editorState.name = null;
    editorState.loadedSavedAt = null;
    editorState.payload = null;
    editorState.dirty = false;
    renderFromState();
    return;
  }

  const all = await storageGetWorkspaces();
  const entry = all[targetName];
  if (!entry) {
    editorState.originalName = targetName;
    editorState.name = targetName;
    editorState.loadedSavedAt = null;
    editorState.payload = null;
    editorState.dirty = false;
    renderFromState();
    return;
  }

  editorState.originalName = targetName;
  editorState.name = targetName;
  editorState.loadedSavedAt = entry.savedAt;
  editorState.payload = JSON.parse(JSON.stringify(entry.payload || {}));
  editorState.dirty = false;
  syncDirtyUi();
  setUrlWorkspaceName(targetName);
  renderFromState();
}

/**
 * Persist `editorState` to storage. Performs:
 *  - existence check on the original entry (deleted externally?)
 *  - savedAt concurrency check (modified externally?) — bypassed if `force`
 *  - rename collision check
 *
 * Returns { ok } on success, { ok: false, conflict, error } on conflict.
 * Conflict kinds: 'deleted' | 'modified' | 'rename'.
 */
async function commitSave(opts) {
  const force = !!(opts && opts.force);
  if (!editorState.payload) {
    return { ok: false, error: 'Nothing to save.' };
  }

  const all = await storageGetWorkspaces();
  const orig = editorState.originalName ? all[editorState.originalName] : null;

  if (editorState.originalName && !orig) {
    return { ok: false, conflict: 'deleted', error: 'Original workspace was deleted externally.' };
  }
  if (!force && orig && orig.savedAt !== editorState.loadedSavedAt) {
    return { ok: false, conflict: 'modified', error: 'Workspace was modified externally.' };
  }

  const isRename = editorState.name !== editorState.originalName;
  if (isRename && all[editorState.name]) {
    return { ok: false, conflict: 'rename', error: `Workspace "${editorState.name}" already exists.` };
  }

  const newSavedAt = Date.now();
  const newEntry = {
    name: editorState.name,
    savedAt: newSavedAt,
    payload: JSON.parse(JSON.stringify(editorState.payload)),
  };

  const nextMap = { ...all };
  if (isRename && editorState.originalName) {
    delete nextMap[editorState.originalName];
  }
  nextMap[editorState.name] = newEntry;

  savingInFlight = true;
  try {
    await storageSetWorkspaces(nextMap);
  } finally {
    savingInFlight = false;
  }

  editorState.originalName = editorState.name;
  editorState.loadedSavedAt = newSavedAt;
  setDirty(false);
  setUrlWorkspaceName(editorState.name);
  renderFromState();

  return { ok: true };
}

/**
 * Discard in-memory changes and reload from storage.
 */
async function discardChanges() {
  closeAllPopovers();
  clearExternalChangeBanner();
  await loadFromStorage(editorState.originalName);
  flashStatus('Changes discarded.', 'success');
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

// Make an inline-editable element behave like a button: clickable AND
// keyboard-activatable (Enter/Space), and announced as a button to assistive
// tech. getOpts() returns the startInlineEdit options, or null to skip (e.g.
// when there's nothing to edit yet).
function attachInlineEditTrigger(el, getOpts) {
  el.setAttribute('role', 'button');
  el.tabIndex = 0;
  const activate = (e) => {
    e.stopPropagation();
    const opts = getOpts();
    if (opts) startInlineEdit(el, opts);
  };
  el.addEventListener('click', activate);
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      activate(e);
    }
  });
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
    if (zoneEl.classList.contains('adding')) return;
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
    if (zoneEl.classList.contains('adding')) return;
    e.preventDefault();
    e.stopPropagation();
    clearDropIndicators();
    // Insert at end of list
    await commitTabMove(listType, listType === 'group' ? groupIdx : null, Number.MAX_SAFE_INTEGER);
  });
  zoneEl.addEventListener('click', (e) => {
    if (zoneEl.classList.contains('adding')) return;
    if (dragState.active) return;
    e.stopPropagation();
    showAddTabForm(zoneEl, listType, groupIdx);
  });
}

function showAddTabForm(zoneEl, listType, groupIdx) {
  zoneEl.classList.add('adding');
  zoneEl.innerHTML = '';

  const form = document.createElement('div');
  form.className = 'add-tab-form';

  const input = document.createElement('input');
  input.type = 'url';
  input.placeholder = 'https://example.com';
  input.className = 'inline-edit-input add-tab-input';
  input.draggable = false;

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'btn btn--primary btn--sm';
  add.textContent = 'Add';
  add.draggable = false;

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn btn--sm';
  cancel.textContent = 'Cancel';
  cancel.draggable = false;

  const closeForm = () => {
    zoneEl.classList.remove('adding');
    zoneEl.innerHTML = '';
    zoneEl.textContent = '+ Add tab';
  };

  const submit = () => {
    const url = String(input.value || '').trim();
    if (!isValidWebUrl(url)) {
      flashStatus('URL must start with http:// or https://', 'error', 4000);
      input.focus();
      input.select();
      return;
    }
    applyMutation((payload) => {
      const list = getTabList(payload, listType, groupIdx);
      if (!list) return false;
      list.push({ url, muted: false });
    });
    // renderFromState rebuilds; this drop-end is replaced with a fresh one.
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeForm(); }
  });
  add.addEventListener('click', (e) => { e.stopPropagation(); submit(); });
  cancel.addEventListener('click', (e) => { e.stopPropagation(); closeForm(); });

  form.appendChild(input);
  form.appendChild(add);
  form.appendChild(cancel);
  zoneEl.appendChild(form);
  input.focus();
}

function commitTabMove(dstListType, dstGroupIdx, dstInsertIdxRaw) {
  const src = {
    listType: dragState.sourceListType,
    groupIdx: dragState.sourceGroupIdxForTab,
    tabIdx: dragState.sourceTabIdx,
  };
  applyMutation((payload) => {
    const srcList = getTabList(payload, src.listType, src.groupIdx);
    const dstList = getTabList(payload, dstListType, dstGroupIdx);
    if (!srcList || !dstList) return false;
    if (src.tabIdx < 0 || src.tabIdx >= srcList.length) return false;

    let dstInsertIdx = Math.min(dstInsertIdxRaw, dstList.length);
    const sameList = (srcList === dstList);
    const [moved] = srcList.splice(src.tabIdx, 1);
    if (sameList && src.tabIdx < dstInsertIdx) dstInsertIdx -= 1;
    dstList.splice(dstInsertIdx, 0, moved);
  });
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

  cardEl.addEventListener('drop', (e) => {
    if (dragState.type !== 'group') return;
    e.preventDefault();
    e.stopPropagation();
    let insertIdx = groupIdx;
    if (cardEl.classList.contains('tz-drop-after')) insertIdx = groupIdx + 1;
    const sourceIdx = dragState.sourceGroupIdx;
    if (sourceIdx < insertIdx) insertIdx -= 1;
    clearDropIndicators();
    applyMutation((payload) => {
      const groups = payload.allTabGroups;
      if (!groups || !groups[sourceIdx]) return false;
      const [moved] = groups.splice(sourceIdx, 1);
      groups.splice(Math.min(insertIdx, groups.length), 0, moved);
    });
  });
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
  yes.className = 'btn btn--danger btn--sm';
  yes.textContent = 'Yes';
  yes.draggable = false;

  const no = document.createElement('button');
  no.type = 'button';
  no.className = 'btn btn--sm';
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

  // Title doubles as an editable label. NOTE: this label lives only in the
  // workspace/editor snapshot — on restore the browser uses the page's real
  // <title> (Chrome can't force a tab title), and re-saving from a live window
  // recaptures the real title. It does round-trip through export/import.
  const titleEl = document.createElement('span');
  titleEl.className = 'tab-title editable';
  titleEl.textContent = tabLabel(tab);
  titleEl.title = 'Click to edit label (saved in this workspace; the live page title is used when restored)';
  attachInlineEditTrigger(titleEl, () => ({
    initialValue: tab.title || '',
    maxLength: 200,
    inputClass: 'tab-title-input',
    onCommit: async (raw) => {
      const next = String(raw || '').trim();
      if (next === (tab.title || '')) return true;
      applyMutation((payload) => {
        const list = getTabList(payload, listType, groupIdx);
        if (!list || !list[tabIdx]) return false;
        if (next) list[tabIdx].title = next;
        else delete list[tabIdx].title; // empty clears the custom label
      });
      return true;
    }
  }));

  // Host line is the click target for editing the full URL.
  const hostEl = document.createElement('span');
  hostEl.className = 'tab-host editable';
  hostEl.textContent = hostFromUrl(tab.url) || tab.url || '';
  hostEl.title = tab.url || '';
  attachInlineEditTrigger(hostEl, () => ({
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
      applyMutation((payload) => {
        const list = getTabList(payload, listType, groupIdx);
        if (!list || !list[tabIdx]) return false;
        list[tabIdx].url = next;
      });
      return true;
    }
  }));

  label.appendChild(titleEl);
  label.appendChild(hostEl);

  const actions = document.createElement('div');
  actions.className = 'tab-actions';

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'icon-btn icon-btn--danger';
  delBtn.title = 'Delete tab';
  delBtn.draggable = false;
  delBtn.innerHTML = '&#128465;'; // 🗑
  delBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    inlineConfirm(delBtn, 'Delete?', () => {
      applyMutation((payload) => {
        const list = getTabList(payload, listType, groupIdx);
        if (!list || !list[tabIdx]) return false;
        list.splice(tabIdx, 1);
      });
    });
  });

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
  endZone.textContent = '+ Add tab';
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
    openColorPicker(colorBtn, group.color || 'grey', (newColor) => {
      applyMutation((payload) => {
        const g = payload.allTabGroups && payload.allTabGroups[groupIndex];
        if (!g) return false;
        if (g.color === newColor) return false;
        g.color = newColor;
      });
    });
  });

  const titleEl = document.createElement('span');
  titleEl.className = 'group-title editable';
  titleEl.textContent = group.title || 'Group';
  titleEl.title = 'Click to rename group';
  attachInlineEditTrigger(titleEl, () => ({
    initialValue: group.title || '',
    maxLength: 60,
    inputClass: 'group-title-input',
    onCommit: async (raw) => {
      const next = String(raw || '').trim();
      if (!next) {
        flashStatus('Group title cannot be empty.', 'error');
        return false;
      }
      if (next === (group.title || '')) return true;
      applyMutation((payload) => {
        const g = payload.allTabGroups && payload.allTabGroups[groupIndex];
        if (!g) return false;
        g.title = next;
      });
      return true;
    }
  }));

  const metaEl = document.createElement('span');
  metaEl.className = 'group-meta';
  const count = (group.tabs && group.tabs.length) || 0;
  metaEl.textContent = `${count} tab${count === 1 ? '' : 's'}`;

  const groupDelBtn = document.createElement('button');
  groupDelBtn.type = 'button';
  groupDelBtn.className = 'icon-btn icon-btn--danger';
  groupDelBtn.title = 'Delete group';
  groupDelBtn.draggable = false;
  groupDelBtn.innerHTML = '&#128465;'; // 🗑
  groupDelBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const question = count > 0 ? `Delete group + ${count} tab${count === 1 ? '' : 's'}?` : 'Delete group?';
    inlineConfirm(groupDelBtn, question, () => {
      applyMutation((payload) => {
        const groups = payload.allTabGroups;
        if (!groups || !groups[groupIndex]) return false;
        groups.splice(groupIndex, 1);
      });
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
  endZone.textContent = '+ Add tab';
  attachTabEndDropZone(endZone, 'group', groupIndex);
  tabsUl.appendChild(endZone);

  card.appendChild(header);
  card.appendChild(tabsUl);

  attachGroupDnD(card, groupIndex);
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
  save.className = 'btn btn--primary btn--sm';
  save.textContent = 'Add';
  save.draggable = false;

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn btn--sm';
  cancel.textContent = 'Cancel';
  cancel.draggable = false;

  const restore = () => populateAddGroupRow(rowEl);

  const submit = () => {
    const title = String(input.value || '').trim();
    if (!title) {
      flashStatus('Group title cannot be empty.', 'error');
      input.focus();
      return;
    }
    applyMutation((payload) => {
      const groups = payload.allTabGroups || (payload.allTabGroups = []);
      groups.push({ title, color: 'grey', tabs: [] });
    });
    // renderFromState rebuilds the groups list, replacing the form with a fresh "+ New group" row.
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

function renderHeader() {
  const name = editorState.name || '';
  els.wsName.textContent = name;
  els.wsName.title = 'Click to rename workspace';
  els.wsName.classList.add('editable');
  syncDirtyUi();
  const ts = editorState.loadedSavedAt ? new Date(editorState.loadedSavedAt) : null;
  if (ts && !isNaN(ts.getTime())) {
    els.wsMeta.textContent = `saved ${ts.toLocaleString()}`;
  } else {
    els.wsMeta.textContent = '';
  }
}

function attachWorkspaceNameRename() {
  attachInlineEditTrigger(els.wsName, () => {
    if (!editorState.name) return null;
    return {
      initialValue: editorState.name,
      maxLength: PRESET_NAME_MAX_LEN,
      inputClass: 'ws-name-input',
      onCommit: async (raw) => {
        const next = sanitizeWorkspaceName(raw);
        if (!next) {
          flashStatus('Workspace name cannot be empty.', 'error');
          return false;
        }
        if (next === editorState.name) return true;
        // Async collision check against storage (excluding originalName).
        const all = await storageGetWorkspaces();
        if (all[next] && next !== editorState.originalName) {
          flashStatus(`Workspace "${next}" already exists.`, 'error');
          return false;
        }
        editorState.name = next;
        setDirty(true);
        renderFromState();
        return true;
      }
    };
  });
}

function renderNotFound(name) {
  els.wsName.textContent = name || '(no workspace)';
  els.wsName.classList.remove('editable');
  els.wsMeta.textContent = '';
  els.pinnedSection.hidden = true;
  els.groupsList.innerHTML = '';
  syncDirtyUi();
  setStatus(`Workspace "${name}" not found. Open the popover to manage workspaces.`, 'error');
}

/**
 * Pure render function — uses editorState only. Never reads storage.
 */
function renderFromState() {
  if (!editorState.payload) {
    renderNotFound(editorState.name || readWorkspaceNameFromUrl() || '');
    return;
  }
  renderHeader();
  renderPinned(editorState.payload.pinnedTabs || []);
  renderGroups(editorState.payload.allTabGroups || []);
}

// --- Save / Discard handlers ----------------------------------------------

function showConflictPicker(conflict, onDiscard, onForce) {
  const banner = document.createElement('div');
  banner.className = 'conflict-banner';
  banner.dataset.banner = 'conflict';

  const msg = document.createElement('span');
  msg.className = 'conflict-msg';
  msg.textContent = conflict === 'deleted'
    ? 'Original workspace was deleted externally. Save will recreate it under the current name. Discard reloads the empty editor.'
    : 'Workspace was modified externally. Choose how to resolve:';

  const discard = document.createElement('button');
  discard.type = 'button';
  discard.className = 'btn btn--sm';
  discard.textContent = 'Discard my changes';
  discard.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    banner.remove();
    if (onDiscard) await onDiscard();
  });

  const force = document.createElement('button');
  force.type = 'button';
  force.className = 'btn btn--danger btn--sm';
  force.textContent = 'Force overwrite';
  force.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    banner.remove();
    if (onForce) await onForce();
  });

  banner.appendChild(msg);
  banner.appendChild(discard);
  banner.appendChild(force);
  if (els.banners) els.banners.innerHTML = '';
  if (els.banners) els.banners.appendChild(banner);
}

function clearExternalChangeBanner() {
  if (els.banners) {
    const b = els.banners.querySelector('[data-banner="external"]');
    if (b) b.remove();
  }
}

function showExternalChangeBanner() {
  if (!els.banners) return;
  if (els.banners.querySelector('[data-banner="external"]')) return;
  const banner = document.createElement('div');
  banner.className = 'external-banner';
  banner.dataset.banner = 'external';
  banner.textContent = 'Workspace was modified externally. Discard your changes to reload, or Save to overwrite.';
  els.banners.appendChild(banner);
}

async function handleSaveClick() {
  if (!editorState.dirty || !editorState.payload) return;
  const res = await commitSave();
  if (res.ok) {
    flashStatus('Saved.', 'success');
    return;
  }
  if (res.conflict === 'rename') {
    flashStatus(res.error, 'error', 4000);
    return;
  }
  if (res.conflict === 'modified' || res.conflict === 'deleted') {
    showConflictPicker(
      res.conflict,
      async () => { await discardChanges(); },
      async () => {
        const forced = await commitSave({ force: true });
        if (forced.ok) flashStatus('Saved (overwrite).', 'success');
        else flashStatus(forced.error || 'Save failed.', 'error', 4000);
      }
    );
    return;
  }
  flashStatus(res.error || 'Save failed.', 'error', 4000);
}

async function handleDiscardClick() {
  if (!editorState.dirty) return;
  await discardChanges();
}

function init() {
  els.status = document.getElementById('editor-status');
  els.wsName = document.getElementById('ws-name');
  els.wsMeta = document.getElementById('ws-meta');
  els.dirtyDot = document.getElementById('ws-dirty-dot');
  els.toolbar = document.getElementById('ws-toolbar');
  els.banners = document.getElementById('editor-banners');
  els.saveBtn = document.getElementById('ws-save-btn');
  els.discardBtn = document.getElementById('ws-discard-btn');
  els.pinnedSection = document.getElementById('pinned-section');
  els.pinnedList = document.getElementById('pinned-list');
  els.groupsSection = document.getElementById('groups-section');
  els.groupsList = document.getElementById('groups-list');

  if (els.saveBtn) els.saveBtn.addEventListener('click', (e) => { e.stopPropagation(); handleSaveClick(); });
  if (els.discardBtn) {
    els.discardBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      inlineConfirm(els.discardBtn, 'Discard?', () => handleDiscardClick());
    });
  }

  attachWorkspaceNameRename();
  loadFromStorage(readWorkspaceNameFromUrl());

  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (!changes[STORAGE_KEY_WORKSPACES]) return;
      if (savingInFlight) return;
      handleExternalStorageChange(changes[STORAGE_KEY_WORKSPACES].newValue || {});
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeAllPopovers();
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      handleSaveClick();
    }
  });

  window.addEventListener('beforeunload', (e) => {
    if (editorState.dirty) {
      e.preventDefault();
      // Modern browsers ignore custom messages but require returnValue set.
      e.returnValue = '';
      return '';
    }
  });

  // Global cleanup: clear drop indicators and reset drag state when a
  // drag ends, regardless of whether it was successful.
  document.addEventListener('dragend', () => {
    clearDropIndicators();
    document.querySelectorAll('.tz-dragging').forEach((el) => el.classList.remove('tz-dragging'));
    dragReset();
  });
}

/**
 * Decide what to do when storage changes externally:
 *  - If we have no editor state yet, just (re)load.
 *  - If not dirty: silently reload (keeps editor in sync).
 *  - If dirty: keep our edits, but check whether *our* entry changed
 *    under us — if so, surface a banner so the user can decide.
 */
function handleExternalStorageChange(newMap) {
  if (!editorState.payload) {
    loadFromStorage(editorState.originalName || readWorkspaceNameFromUrl());
    return;
  }
  if (!editorState.dirty) {
    loadFromStorage(editorState.originalName);
    return;
  }
  const ourEntry = editorState.originalName ? newMap[editorState.originalName] : null;
  if (!ourEntry) {
    showExternalChangeBanner();
    return;
  }
  if (ourEntry.savedAt !== editorState.loadedSavedAt) {
    showExternalChangeBanner();
  }
}

document.addEventListener('DOMContentLoaded', init);
