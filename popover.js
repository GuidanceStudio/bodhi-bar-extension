/**
 * POPOVER.JS - Group picker and search popovers
 */

let activePopover = null;
let activePopoverTabId = null;
let activeSearchPopover = null;

function closeActivePopover() {
  if (!activePopover) return;
  try { activePopover.remove(); } catch {}
  activePopover = null;
  activePopoverTabId = null;
  document.removeEventListener('mousedown', onDocMouseDown, true);
  document.removeEventListener('keydown', onDocKeyDown, true);
}

function closeActiveSearchPopover() {
  if (!activeSearchPopover) return;
  try { activeSearchPopover.remove(); } catch {}
  activeSearchPopover = null;
  document.removeEventListener('mousedown', onDocSearchMouseDown, true);
  document.removeEventListener('keydown', onDocSearchKeyDown, true);
}

function onDocSearchMouseDown(e) {
  if (!activeSearchPopover) return;
  if (activeSearchPopover.contains(e.target)) return;
  closeActiveSearchPopover();
}

function onDocSearchKeyDown(e) {
  if (e.key === 'Escape') closeActiveSearchPopover();
}

function onDocMouseDown(e) {
  if (!activePopover) return;
  if (activePopover.contains(e.target)) return;
  closeActivePopover();
}

function onDocKeyDown(e) {
  if (e.key === 'Escape') closeActivePopover();
}

function openSearchPopover(anchorEl) {
  closeActiveSearchPopover();

  const pop = document.createElement('div');
  pop.dataset.tzPopover = '1';
  pop.style.width = 'min(980px, calc(100vw - 16px))';
  pop.style.visibility = 'hidden';
  pop.style.top = '0px';
  pop.style.left = '0px';
  pop.onmousedown = (e) => { e.stopPropagation(); };

  const list = document.createElement('div');
  list.style.cssText = `all: initial; display:block;`;
  pop.appendChild(list);

  const q = normalizeForSearch(searchQuery).trim();
  const results = q ? getSearchResults() : [];

  if (!q) {
    const empty = document.createElement('div');
    empty.className = 'tz-popover-empty';
    empty.textContent = 'Type to search tabs…';
    list.appendChild(empty);
  } else if (!results.length) {
    const empty = document.createElement('div');
    empty.className = 'tz-popover-empty';
    empty.textContent = 'No matches';
    list.appendChild(empty);
  } else {
    results.forEach(({ tab, domain }) => {
      const item = document.createElement('div');
      item.className = 'group-item';

      const favWrap = document.createElement('div');
      favWrap.className = 'tz-search-fav-wrap';
      const fav = createFaviconElement(tab);
      favWrap.appendChild(fav);

      const tx = document.createElement('div');
      const title = tab.title || '';
      const label = domain ? `${title} (${domain})` : title;
      tx.innerHTML = highlightMatchHtml(label, searchQuery);
      tx.className = 'tz-search-text';

      item.appendChild(favWrap);
      item.appendChild(tx);

      item.onmousedown = (e) => { e.stopPropagation(); e.preventDefault(); };
      item.onclick = (e) => {
        e.stopPropagation(); e.preventDefault();
        closeActiveSearchPopover();
        handleTabClick(tab.id);
      };

      list.appendChild(item);
    });
  }

  activeSearchPopover = pop;
  document.body.appendChild(pop);

  const r = anchorEl.getBoundingClientRect();
  const pr = pop.getBoundingClientRect();

  let left = r.left;
  let top = r.bottom + 6;
  const margin = 8;
  left = Math.max(margin, Math.min(left, window.innerWidth - pr.width - margin));
  if (top + pr.height + margin > window.innerHeight) {
    top = Math.max(margin, r.top - pr.height - 6);
  }

  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
  pop.style.visibility = 'visible';
  document.addEventListener('mousedown', onDocSearchMouseDown, true);
  document.addEventListener('keydown', onDocSearchKeyDown, true);
}

function openGroupPopover(anchorEl, tabId, { includeUngroup = false, excludeGroupId = null } = {}) {
  closeActivePopover();
  activePopoverTabId = tabId;

  const pop = document.createElement('div');
  pop.className = 'tz-popover';
  pop.dataset.tzPopover = '1';
  pop.onmousedown = (e) => { e.stopPropagation(); };

  pop.style.visibility = 'hidden';
  pop.style.top = '0px';
  pop.style.left = '0px';

  const groupsContainer = document.createElement('div');
  groupsContainer.className = 'tz-groups-container';
  pop.appendChild(groupsContainer);

  const groups = Array.isArray(cachedTabGroups) ? cachedTabGroups : [];

  if (includeUngroup) {
    const unItem = document.createElement('div');
    unItem.className = 'group-item';
    unItem.style.marginBottom = `${POPOVER_SECTION_GAP_PX}px`;
    const minus = createPopoverIcon('-');
    const tx = document.createElement('div');
    tx.className = 'tz-popover-label muted';
    tx.textContent = 'Ungroup';
    unItem.appendChild(minus);
    unItem.appendChild(tx);
    unItem.onclick = async (e) => {
      e.stopPropagation(); e.preventDefault();
      suppressClickUntil = Date.now() + 700;
      await handleUngroup(tabId);
      closeActivePopover();
      handleStateChange();
    };
    groupsContainer.appendChild(unItem);
  }

  groups
    .filter(g => (excludeGroupId == null) || String(g.id) !== String(excludeGroupId))
    .forEach(g => {
    const item = document.createElement('div');
    item.className = 'group-item';
    const sw = document.createElement('div');
    sw.className = 'swatch';
    sw.style.background = GROUP_COLOR_MAP[g.color] || GROUP_COLOR_MAP.default;
    const tx = document.createElement('div');
    tx.className = 'tz-popover-label';
    tx.textContent = g.title || 'Group';
    item.appendChild(sw);
    item.appendChild(tx);
    item.onclick = async (e) => {
      e.stopPropagation(); e.preventDefault();
      suppressClickUntil = Date.now() + 700;
      await safeRuntimeSendMessageWithRetry({ action: 'GROUP_TAB', tabId, groupId: g.id }, 3);
      closeActivePopover();
      handleStateChange();
    };
    groupsContainer.appendChild(item);
  });

  const newItem = document.createElement('div');
  newItem.className = 'group-item';
  newItem.style.marginTop = groups.length ? `${POPOVER_SECTION_GAP_PX}px` : '0';

  const plus = createPopoverIcon('+');

  const newTx = document.createElement('div');
  newTx.textContent = 'New group…';
  newTx.className = 'tz-popover-label';

  newItem.appendChild(plus);
  newItem.appendChild(newTx);
  groupsContainer.appendChild(newItem);

  const createPanel = document.createElement('div');
  createPanel.className = 'tz-popover-panel';

  const form = document.createElement('div');
  form.className = 'tz-popover-form';

  const inp = document.createElement('input');
  inp.type = 'text';
  inp.placeholder = 'New group title';

  const sel = document.createElement('select');
  const colors = ['grey','blue','red','yellow','green','pink','purple','cyan','orange'];
  colors.forEach(c => {
    const o = document.createElement('option');
    o.value = c; o.textContent = c;
    sel.appendChild(o);
  });

  const colorRow = document.createElement('div');
  colorRow.className = 'tz-color-row';

  const colorPreview = document.createElement('div');
  colorPreview.className = 'tz-color-preview';
  colorPreview.style.background = GROUP_COLOR_MAP[sel.value] || GROUP_COLOR_MAP.default;

  const updatePreview = () => { colorPreview.style.background = GROUP_COLOR_MAP[sel.value] || GROUP_COLOR_MAP.default; };
  sel.addEventListener('change', updatePreview);
  updatePreview();

  const createBtn = document.createElement('div');
  createBtn.className = 'btn btn-primary';
  createBtn.textContent = 'Create';
  createBtn.style.textAlign = 'center';
  createBtn.onclick = async (e) => {
    e.stopPropagation(); e.preventDefault();
    const t = (inp.value || '').trim();
    if (!t) return;
    suppressClickUntil = Date.now() + 700;
    await safeRuntimeSendMessageWithRetry({ action: 'GROUP_TAB_NEW', tabId, title: t, color: sel.value }, 3);
    closeActivePopover();
    handleStateChange();
  };

  const cancelBtn = document.createElement('div');
  cancelBtn.className = 'btn';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.textAlign = 'center';
  cancelBtn.onclick = (e) => {
    e.stopPropagation(); e.preventDefault();
    inp.value = '';
    createPanel.style.display = 'none';
    groupsContainer.style.display = 'block';
  };

  form.appendChild(inp);
  form.appendChild(colorRow); // Added this line
  colorRow.appendChild(colorPreview);
  colorRow.appendChild(sel);
  form.appendChild(createBtn);
  form.appendChild(cancelBtn);
  createPanel.appendChild(form);
  pop.appendChild(createPanel);

  newItem.onclick = (e) => {
    e.stopPropagation(); e.preventDefault();
    groupsContainer.style.display = 'none';
    createPanel.style.display = 'block';
    setTimeout(() => { try { inp.focus(); } catch {} }, 0);
  };

  activePopover = pop;
  document.body.appendChild(pop);

  const r = anchorEl.getBoundingClientRect();
  const pr = pop.getBoundingClientRect();

  let left = r.left;
  let top = r.bottom + 6;

  const margin = 8;
  left = Math.max(margin, Math.min(left, window.innerWidth - pr.width - margin));
  if (top + pr.height + margin > window.innerHeight) {
    top = Math.max(margin, r.top - pr.height - 6);
  }

  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
  pop.style.visibility = 'visible';
  document.addEventListener('mousedown', onDocMouseDown, true);
  document.addEventListener('keydown', onDocKeyDown, true);
}
