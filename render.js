/**
 * RENDER.JS - Bar rendering functions
 */

// isInternalResize is declared in page-shift.js

function ensureBar() {
  // Add safe reference to zoom functions
  const zoomUtils = window.__tzZoomMetrics || {};
  const { ensureSizingStyle, applyZoomCompensatedMetrics } = zoomUtils;
  

  // Only call ensureSizingStyle in PUSH mode (it may add padding-related CSS)
  if (typeof ensureSizingStyle === 'function' && window.currentVisibilityMode === VISIBILITY_MODES.PUSH) {
    ensureSizingStyle();
  }
  if (typeof applyZoomCompensatedMetrics === 'function') {
    applyZoomCompensatedMetrics(true);
  }

  let bar = document.getElementById(TZ_BAR_ID);
  if (bar && !document.body?.contains(bar)) {
    try { bar.remove(); } catch {}
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

// Minimize button helpers
const STORAGE_KEY_MINIMIZED_BY_TAB = 'tz_minimized_by_tab';

function setBarMinimized(minimized) {
  const bar = document.getElementById(TZ_BAR_ID);
  if (!bar) return;
  if (minimized) bar.classList.add('tz-minimized');
  else bar.classList.remove('tz-minimized');
  syncMinimizeButtonUI();
  if (typeof applyPageShift === 'function') applyPageShift();
}

function syncMinimizeButtonUI() {
  const bar = document.getElementById(TZ_BAR_ID);
  if (!bar) return;
  const btn = bar.querySelector('.tz-minimize-btn');
  
  // If we are in PUSH mode but the button exists, we should probably refresh the bar
  // or just hide it. For consistency with the render functions:
  const mode = window.currentVisibilityMode || VISIBILITY_MODES.PUSH;
  if (mode === VISIBILITY_MODES.PUSH && btn) {
    btn.style.display = 'none';
    return;
  }
  
  if (!btn) return;
  btn.style.display = '';

  const minimized = bar.classList.contains('tz-minimized');

  if (mode === VISIBILITY_MODES.HIDDEN) {
    btn.textContent = '+';
    btn.title = 'Show bar (currently hidden)';
  } else if (mode === VISIBILITY_MODES.OVERLAY) {
    if (minimized) {
      btn.textContent = '›';
      btn.title = 'Expand bar (Overlay mode)';
    } else {
      btn.textContent = '‹';
      btn.title = 'Minimize bar (Overlay mode)';
    }
  } else {
    // PUSH mode (button should be hidden already)
    btn.textContent = '◻';
    btn.title = 'Switch to Overlay mode';
  }
}

function applyMinimizedState(tabId) {
  if (tabId == null) return;
  chrome.storage.local.get([STORAGE_KEY_MINIMIZED_BY_TAB], (obj) => {
    const map = obj?.[STORAGE_KEY_MINIMIZED_BY_TAB] || {};
    setBarMinimized(!!map[String(tabId)]);
  });
}

function applyVisibilityState(tabId) {
  if (tabId == null) return;
  chrome.storage.local.get([STORAGE_KEY_VISIBILITY_MODE], (obj) => {
    const map = obj?.[STORAGE_KEY_VISIBILITY_MODE] || {};
    const mode = map[String(tabId)] || window.currentVisibilityMode || VISIBILITY_MODES.PUSH;
    // Update the global mode variable
    if (typeof setVisibilityMode === 'function') {
      setVisibilityMode(mode);
    } else {
      window.currentVisibilityMode = mode;
    }

    const bar = document.getElementById(TZ_BAR_ID);
    if (bar) {
      // Update mode classes
      bar.classList.toggle('tz-mode-overlay', mode === VISIBILITY_MODES.OVERLAY);
      bar.classList.toggle('tz-mode-push', mode === VISIBILITY_MODES.PUSH);
      
      if (mode === VISIBILITY_MODES.HIDDEN) {
        bar.style.setProperty('display', 'none', 'important');
        // Reset minimized state when hidden
        bar.classList.remove('tz-minimized');
      } else {
        bar.style.display = '';
        bar.style.removeProperty('display');
        
        if (mode === VISIBILITY_MODES.OVERLAY) {
          // Check minimized state for OVERLAY mode
          chrome.storage.local.get([STORAGE_KEY_MINIMIZED_BY_TAB], (minObj) => {
            const minMap = minObj?.[STORAGE_KEY_MINIMIZED_BY_TAB] || {};
            if (minMap[String(tabId)]) {
              bar.classList.add('tz-minimized');
            } else {
              bar.classList.remove('tz-minimized');
            }
            // Update minimize button visibility
            syncMinimizeButtonUI();
            if (typeof applyPageShift === 'function') applyPageShift();
          });
          return;
        } else {
          // PUSH mode: never minimized
          bar.classList.remove('tz-minimized');
          syncMinimizeButtonUI();
        }
      }
    }
    if (typeof applyPageShift === 'function') applyPageShift();
  });
}

function toggleMinimizedState(tabId) {
  if (tabId == null) return;
  const bar = document.getElementById(TZ_BAR_ID);
  if (!bar) return;

  // Only allow minimizing in OVERLAY mode
  const mode = window.currentVisibilityMode || VISIBILITY_MODES.PUSH;
  if (mode !== VISIBILITY_MODES.OVERLAY) return;

  const next = !bar.classList.contains('tz-minimized');
  setBarMinimized(next);

  chrome.storage.local.get([STORAGE_KEY_MINIMIZED_BY_TAB], (obj) => {
    const map = obj?.[STORAGE_KEY_MINIMIZED_BY_TAB] || {};
    if (next) map[String(tabId)] = true;
    else delete map[String(tabId)];
    chrome.storage.local.set({ [STORAGE_KEY_MINIMIZED_BY_TAB]: map });
  });
}

function createMinimizeButton(tabId) {
  const btn = document.createElement('div');
  btn.className = 'tz-minimize-btn';

  // Check current minimized state to set initial icon
  const isMinimized = document.getElementById(TZ_BAR_ID)?.classList.contains('tz-minimized');
  if (isMinimized) {
    btn.textContent = '›'; // Expand icon
    btn.title = 'Expand bar';
  } else {
    btn.textContent = '‹'; // Minimize icon
    btn.title = 'Minimize bar';
  }

  btn.onclick = async (e) => {
    e.stopPropagation();
    const bar = document.getElementById(TZ_BAR_ID);
    if (!bar) return;

    // Toggle minimized state
    const nextMinimized = !bar.classList.contains('tz-minimized');
    if (nextMinimized) {
      bar.classList.add('tz-minimized');
      btn.textContent = '›';
      btn.title = 'Expand bar';
    } else {
      bar.classList.remove('tz-minimized');
      btn.textContent = '‹';
      btn.title = 'Minimize bar';
    }

    // Save to storage
    if (tabId != null) {
      const minData = await chrome.storage.local.get([STORAGE_KEY_MINIMIZED_BY_TAB]);
      const minMap = minData?.[STORAGE_KEY_MINIMIZED_BY_TAB] || {};
      if (nextMinimized) {
        minMap[String(tabId)] = true;
      } else {
        delete minMap[String(tabId)];
      }
      await chrome.storage.local.set({ [STORAGE_KEY_MINIMIZED_BY_TAB]: minMap });
    }
  };

  return btn;
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

  // Show minimize button ONLY in OVERLAY mode
  if (window.currentVisibilityMode === VISIBILITY_MODES.OVERLAY) {
    bar.appendChild(createMinimizeButton(currentTabId));
  }

  bar.appendChild(createSearchBar());

  // --- START CHANGE: Move Pinned Tabs here ---
  const pinnedSorted = [...(pinnedTabs || [])].sort((a, b) => a.index - b.index);
  pinnedSorted.forEach(tab => bar.appendChild(createPinnedFavicon(tab, tab.id === currentTabId)));
  // --- END CHANGE ---

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

function renderNavigationBar(data, currentGroupTitle = 'Groups List') {
  const bar = ensureBar();

  bar.innerHTML = '';

  // Show minimize button ONLY in OVERLAY mode
  if (window.currentVisibilityMode === VISIBILITY_MODES.OVERLAY) {
    bar.appendChild(createMinimizeButton(window.__tzCurrentTabId));
  }

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

  items.forEach(item => {
    const isLevel2Groups = (navigationState === NAV_LEVELS.LEVEL_2);
    const isLevel3GroupTabs = (navigationState === NAV_LEVELS.LEVEL_3);

    const itemBtn = document.createElement('div');
    itemBtn.title = item.title || item.url || "";

    if (isLevel2Groups) {
      itemBtn.className = 'tz-group-tile';
      const groupColorHex = GROUP_COLOR_MAP[item.color] || GROUP_COLOR_MAP.default;
      itemBtn.style.borderBottom = `var(--tz-ind-h) solid ${groupColorHex}`;
      itemBtn.style.color = groupColorHex;
      itemBtn.draggable = true;
      itemBtn.setAttribute('draggable', 'true');
      itemBtn.dataset.tzDraggable = 'group';
      itemBtn.dataset.groupid = String(item.id);

      const titleSpan = document.createElement('span');
      titleSpan.className = 'group-title';
      titleSpan.textContent = getDisplayedTitle(item.title || item.url);
      itemBtn.appendChild(titleSpan);

      const favs = Array.isArray(item.tabs) ? item.tabs : [];
      if (favs.length > 0) {
        const favRow = document.createElement('div');
        favRow.className = 'fav-row';

        favs.forEach(tab => {
          favRow.appendChild(createLevel2Favicon(tab));
        });

        itemBtn.appendChild(favRow);
      }

      itemBtn.onclick = (e) => {
        e.stopPropagation();
        currentViewedGroupId = item.id;
        navigationState = NAV_LEVELS.LEVEL_3;
        handleStateChange();
      };
    } else if (isLevel3GroupTabs) {
      itemBtn.className = 'tz-tab-btn tz-lvl3-tab';
      itemBtn.draggable = true;
      itemBtn.setAttribute('draggable', 'true');
      itemBtn.dataset.tzDraggable = 'tab';
      itemBtn.dataset.tabid = String(item.id);
      itemBtn.dataset.tzKind = 'group';
      itemBtn.dataset.groupid = String(item.groupId ?? currentViewedGroupId ?? '');

      itemBtn.appendChild(createLevel2Favicon(item, { interactive: false }));

      const label = document.createElement('span');
      label.className = 'tab-title';
      label.textContent = getDisplayedTitle(item.title || item.url);
      itemBtn.appendChild(label);

      const actions = document.createElement('div');
      actions.className = 'tab-actions';

      const menuBtn = createLevel3MenuButton(item.id);
      menuBtn.onclick = (e) => { e.stopPropagation(); e.preventDefault(); openGroupPopover(menuBtn, item.id, { includeUngroup: true, excludeGroupId: (item.groupId ?? currentViewedGroupId ?? null) }); };
      actions.appendChild(menuBtn);
      actions.appendChild(createCloseButton(item.id));
      itemBtn.appendChild(actions);
      itemBtn.onclick = (e) => { e.stopPropagation(); handleTabClick(item.id); };
    } else {
      const titleSpan = document.createElement('span');
      titleSpan.textContent = getDisplayedTitle(item.title || item.url);
      itemBtn.appendChild(titleSpan);
      itemBtn.onclick = (e) => { e.stopPropagation(); };
    }

    container.appendChild(itemBtn);
  });

  container.appendChild(createStickyPlus());
  bar.appendChild(container);

  updateDynamicLayout();
  applyVisibilityState(window.__tzCurrentTabId);
}
