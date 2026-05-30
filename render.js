/**
 * RENDER.JS - Bar rendering functions
 */

// isInternalResize is declared in page-shift.js

function ensureBar() {
  // Add safe reference to zoom functions
  const zoomUtils = window.__tzZoomMetrics || {};
  const { applyZoomCompensatedMetrics } = zoomUtils;

  if (typeof applyZoomCompensatedMetrics === 'function') {
    applyZoomCompensatedMetrics(true);
  }

  let bar = document.getElementById(TZ_BAR_ID);
  if (bar && !document.body?.contains(bar)) {
    safeRemove(bar);
    bar = null;
  }
  if (!bar) {
    bar = document.createElement('div');
    bar.id = TZ_BAR_ID;
    (document.body || document.documentElement).appendChild(bar);
  }
  installDragAndDropHandlers();
  return bar;
}

function updateDynamicLayout() {
  if (isInternalResize) return;

  const bar = document.getElementById(TZ_BAR_ID);
  if (!bar || bar.style.display === 'none') return;

  const scrollContainer = bar.querySelector('.scroll-container');
  const stickyPlus = bar.querySelector('.plus-sticky');
  const inlinePlus = bar.querySelector('.inline-plus-wrapper');

  if (scrollContainer && stickyPlus && inlinePlus) {
    const hasScroll = scrollContainer.scrollWidth > scrollContainer.clientWidth + 1;
    stickyPlus.style.display = hasScroll ? 'flex' : 'none';
    inlinePlus.style.display = hasScroll ? 'none' : 'flex';
  }

  applyPageShift();
}

function renderDisconnectedBar(reason = 'Disconnected') {
  const bar = ensureBar();
  bar.innerHTML = '';

  const msg = document.createElement('div');
  msg.className = 'tz-disconnected-msg';
  msg.textContent = `Tab bar: ${reason} (click to retry)`;
  msg.onclick = () => requestTabList();
  bar.appendChild(msg);

  applyPageShift();
}

// Leaf / pin helpers (STORAGE_KEY_PINNED_BY_TAB from constants.js).
// The bar is a collapsed leaf by default; hovering peeks it open (pure CSS)
// and clicking the leaf pins it open for that tab.

function setBarPinned(pinned) {
  const bar = document.getElementById(TZ_BAR_ID);
  if (!bar) return;
  bar.classList.toggle('tz-pinned', pinned);
  syncLeafUI();
}

function syncLeafUI() {
  const bar = document.getElementById(TZ_BAR_ID);
  if (!bar) return;
  const leaf = bar.querySelector('.tz-leaf');
  if (!leaf) return;
  const pinned = bar.classList.contains('tz-pinned');
  leaf.classList.toggle('active', pinned);
  leaf.title = pinned ? 'Unpin the bar' : 'Pin the bar open';
}

function applyVisibilityState(tabId) {
  if (tabId == null) return;
  const bar = document.getElementById(TZ_BAR_ID);
  if (!bar) return;

  bar.classList.add('tz-mode-overlay');
  bar.style.removeProperty('display');

  // Pin state is per-tab and stored separately; needs a storage read.
  chrome.storage.local.get([STORAGE_KEY_PINNED_BY_TAB], (obj) => {
    const map = obj?.[STORAGE_KEY_PINNED_BY_TAB] || {};
    bar.classList.toggle('tz-pinned', isTabPinned(map, tabId));
    syncLeafUI();
  });
}

function togglePinned(tabId) {
  if (tabId == null) return;
  const bar = document.getElementById(TZ_BAR_ID);
  if (!bar) return;

  chrome.storage.local.get([STORAGE_KEY_PINNED_BY_TAB], (obj) => {
    const map = obj?.[STORAGE_KEY_PINNED_BY_TAB] || {};
    const next = nextPinnedMap(map, tabId);
    setBarPinned(isTabPinned(next, tabId));
    chrome.storage.local.set({ [STORAGE_KEY_PINNED_BY_TAB]: next });
  });
}

// Double-click hides the bar entirely for this tab. There's no leaf left to
// click afterwards, so it's re-shown from the extension popup.
function hideTab(tabId) {
  if (tabId == null) return;
  const bar = document.getElementById(TZ_BAR_ID);
  if (bar) bar.classList.add('tz-hidden');
  chrome.storage.local.get([STORAGE_KEY_HIDDEN_BY_TAB], (obj) => {
    const map = obj?.[STORAGE_KEY_HIDDEN_BY_TAB] || {};
    chrome.storage.local.set({ [STORAGE_KEY_HIDDEN_BY_TAB]: nextHiddenMap(map, tabId, true) });
  });
}

function createLeaf(tabId) {
  const leaf = document.createElement('div');
  leaf.className = 'tz-leaf';
  leaf.setAttribute('role', 'button');
  leaf.innerHTML = TZ_LEAF_SVG;

  // Single click pins; double click hides. Disambiguate with a short timer:
  // the click action waits ~250ms and is cancelled if a dblclick arrives.
  let clickTimer = null;
  leaf.onclick = (e) => {
    e.stopPropagation();
    if (clickTimer) return; // part of a double-click in progress
    clickTimer = setTimeout(() => { clickTimer = null; togglePinned(tabId); }, 250);
  };
  leaf.ondblclick = (e) => {
    e.stopPropagation();
    if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
    hideTab(tabId);
  };

  // The active state and tooltip are set by syncLeafUI(), which always runs
  // via applyVisibilityState() at the end of every render.
  return leaf;
}

function createLevel2Favicon(tab, { interactive = true } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'tz-lvl2-fav-wrap';
  wrap.title = tab.title || tab.url || '';

  const fav = createFaviconElement(tab);
  
  if (interactive) {
    wrap.onmousedown = (e) => { e.stopPropagation(); e.preventDefault(); };
    wrap.onclick = (e) => { e.stopPropagation(); e.preventDefault(); handleTabClick(tab.id); };
  } else {
    wrap.style.pointerEvents = 'none';
    fav.style.pointerEvents = 'none';
  }

  wrap.appendChild(fav);

  return wrap;
}

function createPinnedFavicon(tab, isCurrent) {
  const wrap = document.createElement('div');
  wrap.className = 'tz-pin-fav-wrap';
  wrap.title = tab.title || tab.url || '';
  wrap.draggable = true;
  wrap.setAttribute('draggable', 'true');
  wrap.dataset.tzDraggable = 'tab';
  wrap.dataset.tabid = String(tab.id);
  wrap.dataset.tzKind = 'pinned';

  if (isCurrent) {
    wrap.classList.add('active');
  }

  const fav = createFaviconElement(tab);
  fav.style.pointerEvents = 'none';
  wrap.appendChild(fav);

  wrap.onmousedown = (e) => { e.stopPropagation(); };
  wrap.onclick = (e) => { e.stopPropagation(); e.preventDefault(); handleTabClick(tab.id); };

  return wrap;
}

function createTabButton(tab, isCurrent, kind = 'web', isLevel1 = false) {
  const btn = document.createElement('div');
  btn.className = 'tz-tab-btn' + (isCurrent ? ' active' : '');
  btn.title = tab.title || tab.url || "";
  btn.draggable = true;
  btn.setAttribute('draggable', 'true');
  btn.dataset.tzDraggable = 'tab';
  btn.dataset.tabid = String(tab.id);
  btn.dataset.tzKind = kind;

  const fav = createFaviconElement(tab);
  fav.style.pointerEvents = 'none';
  btn.appendChild(fav);

  const text = document.createElement('span');
  text.className = 'tab-title';
  text.textContent = getDisplayedTitle(tab.title || tab.url);
  btn.appendChild(text);

  const actions = document.createElement('div');
  actions.className = 'tab-actions';
  if (kind === 'web') actions.appendChild(createGroupButton(tab.id));
  actions.appendChild(createCloseButton(tab.id));
  
  btn.appendChild(actions);

  btn.onclick = () => handleTabClick(tab.id);
  return btn;
}

function renderFakeTabBar(currentTabId, pinnedTabs, webTabs, systemTabs, isCurrentTabGrouped, currentTabTitle, allTabGroups) {
  const bar = ensureBar();

  bar.innerHTML = '';

  // Leaf chip (top-left): hover peeks the bar open, click pins it open.
  bar.appendChild(createLeaf(currentTabId));

  bar.appendChild(createSearchBar());

  const pinnedSorted = [...(pinnedTabs || [])].sort((a, b) => a.index - b.index);
  pinnedSorted.forEach(tab => bar.appendChild(createPinnedFavicon(tab, tab.id === currentTabId)));

  // Check if there are any groups
  const hasGroups = allTabGroups && allTabGroups.length > 0;

  const trigger = document.createElement('div');
  // Add 'tz-no-groups' class if there are no groups to hide it via CSS
  trigger.className = 'tz-trigger' + (isCurrentTabGrouped ? ' active' : '') + (!hasGroups ? ' tz-no-groups' : '');

  const triggerLabel = isCurrentTabGrouped
    ? getDisplayedTitle(currentTabTitle)
    : (hasGroups ? 'Groups' : 'Bodhi Bar');

  const caret = document.createElement('span');
  caret.className = 'caret';
  caret.textContent = '▼';
  trigger.appendChild(caret);

  const lbl = document.createElement('span');
  lbl.className = 'label';
  lbl.textContent = triggerLabel;
  trigger.appendChild(lbl);

  trigger.onclick = () => {
    if (!hasGroups) return; // Do nothing if there are no groups
    if (allTabGroups.length === 1) {
      currentViewedGroupId = allTabGroups[0].id;
      navigationState = NAV_LEVELS.LEVEL_3;
    } else if (allTabGroups.length > 1) {
      navigationState = NAV_LEVELS.LEVEL_2;
    }
    handleStateChange();
  };

  bar.appendChild(trigger);

  const scrollContainer = document.createElement('div');
  scrollContainer.className = 'scroll-container';

  const webSorted = [...(webTabs || [])].sort((a, b) => a.index - b.index);
  const sysSorted = [...(systemTabs || [])].sort((a, b) => a.index - b.index);

  webSorted.forEach(tab => scrollContainer.appendChild(createTabButton(tab, tab.id === currentTabId, 'web', true)));

  scrollContainer.appendChild(createInlinePlusWrapper());

  if (sysSorted.length > 0) {
    scrollContainer.appendChild(createSeparator());
    sysSorted.forEach(tab => scrollContainer.appendChild(createTabButton(tab, tab.id === currentTabId, 'system', true)));
  }

  scrollContainer.appendChild(createStickyPlus());
  bar.appendChild(scrollContainer);

  updateDynamicLayout();
  applyVisibilityState(currentTabId);
}

function createLevel2GroupTile(item) {
  const tile = document.createElement('div');
  tile.className = 'tz-group-tile';
  tile.title = item.title || item.url || '';
  const groupColorHex = GROUP_COLOR_MAP[item.color] || GROUP_COLOR_MAP.default;
  tile.style.borderBottom = `var(--tz-ind-h) solid ${groupColorHex}`;
  tile.style.color = groupColorHex;
  tile.draggable = true;
  tile.setAttribute('draggable', 'true');
  tile.dataset.tzDraggable = 'group';
  tile.dataset.groupid = String(item.id);

  const titleSpan = document.createElement('span');
  titleSpan.className = 'group-title';
  titleSpan.textContent = getDisplayedTitle(item.title || item.url);
  tile.appendChild(titleSpan);

  const favs = Array.isArray(item.tabs) ? item.tabs : [];
  if (favs.length > 0) {
    const favRow = document.createElement('div');
    favRow.className = 'fav-row';
    favs.forEach(tab => favRow.appendChild(createLevel2Favicon(tab)));
    tile.appendChild(favRow);
  }

  tile.onclick = (e) => {
    e.stopPropagation();
    currentViewedGroupId = item.id;
    navigationState = NAV_LEVELS.LEVEL_3;
    handleStateChange();
  };
  return tile;
}

function createLevel3TabTile(item) {
  const tile = document.createElement('div');
  tile.className = 'tz-tab-btn tz-lvl3-tab';
  tile.title = item.title || item.url || '';
  tile.draggable = true;
  tile.setAttribute('draggable', 'true');
  tile.dataset.tzDraggable = 'tab';
  tile.dataset.tabid = String(item.id);
  tile.dataset.tzKind = 'group';
  tile.dataset.groupid = String(item.groupId ?? currentViewedGroupId ?? '');

  tile.appendChild(createLevel2Favicon(item, { interactive: false }));

  const label = document.createElement('span');
  label.className = 'tab-title';
  label.textContent = getDisplayedTitle(item.title || item.url);
  tile.appendChild(label);

  const actions = document.createElement('div');
  actions.className = 'tab-actions';
  const menuBtn = createLevel3MenuButton(item.id);
  menuBtn.onclick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    openGroupPopover(menuBtn, item.id, { includeUngroup: true, excludeGroupId: (item.groupId ?? currentViewedGroupId ?? null) });
  };
  actions.appendChild(menuBtn);
  actions.appendChild(createCloseButton(item.id));
  tile.appendChild(actions);

  tile.onclick = (e) => { e.stopPropagation(); handleTabClick(item.id); };
  return tile;
}

function renderNavigationBar(data, currentGroupTitle = 'Groups List') {
  const bar = ensureBar();

  bar.innerHTML = '';

  // Leaf chip (top-left): hover peeks the bar open, click pins it open.
  bar.appendChild(createLeaf(window.__tzCurrentTabId));

  const backBtn = document.createElement('div');
  backBtn.className = 'tz-back-btn';

  const arrow = document.createElement('span');
  arrow.className = 'arrow';
  arrow.textContent = BACK_ARROW;
  backBtn.appendChild(arrow);

  const lbl = document.createElement('span');
  lbl.className = 'label';
  lbl.textContent = getDisplayedTitle(currentGroupTitle);
  backBtn.appendChild(lbl);

  backBtn.onclick = (e) => { e.stopPropagation(); navigateBack(); };
  bar.appendChild(backBtn);

  const container = document.createElement('div');
  container.className = 'scroll-container';

  const items = Array.isArray(data) ? data : [];
  const isLevel2 = (navigationState === NAV_LEVELS.LEVEL_2);
  const isLevel3 = (navigationState === NAV_LEVELS.LEVEL_3);

  items.forEach(item => {
    let tile;
    if (isLevel2) {
      tile = createLevel2GroupTile(item);
    } else if (isLevel3) {
      tile = createLevel3TabTile(item);
    } else {
      tile = document.createElement('div');
      tile.title = item.title || item.url || '';
      const titleSpan = document.createElement('span');
      titleSpan.textContent = getDisplayedTitle(item.title || item.url);
      tile.appendChild(titleSpan);
      tile.onclick = (e) => { e.stopPropagation(); };
    }
    container.appendChild(tile);
  });

  container.appendChild(createStickyPlus());
  bar.appendChild(container);

  updateDynamicLayout();
  applyVisibilityState(window.__tzCurrentTabId);
}
