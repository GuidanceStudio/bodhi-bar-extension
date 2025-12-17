// --- CONFIGURATION & CONSTANTS ---
const REFERENCE_WIDTH = 1920; 

const TAB_WIDTH_VW_VAL = 0.075; 
const TAB_HEIGHT_VW_VAL = 0.017; 
const FONT_SIZE_VW_VAL = 0.007; 

const TAB_WIDTH_VW = `${TAB_WIDTH_VW_VAL * 100}vw`; 
const TAB_HEIGHT_VW = `${TAB_HEIGHT_VW_VAL * 100}vw`; 
const FONT_SIZE_VW = `${FONT_SIZE_VW_VAL * 100}vw`;

const MIN_TAB_WIDTH_PX = REFERENCE_WIDTH * TAB_WIDTH_VW_VAL; 
const MIN_TAB_HEIGHT_PX = REFERENCE_WIDTH * TAB_HEIGHT_VW_VAL; 
const MIN_FONT_SIZE_PX = REFERENCE_WIDTH * FONT_SIZE_VW_VAL; 

const MAX_TITLE_LENGTH = 30;
const INDICATOR_COLOR = '#0078d4';
const BACK_ARROW = '◀'; 
const GLOBAL_FONT = 'Arial, sans-serif'; 

const GROUP_COLOR_MAP = {
    'grey': '#5f6368', 'blue': '#8ab4f8', 'red': '#f28b82', 'yellow': '#fdd663', 
    'green': '#81c995', 'pink': '#ff80ab', 'purple': '#c589d7', 'cyan': '#78d9ec', 
    'orange': '#fcc934', 'default': '#505050' 
};

// --- GLOBAL NAVIGATION STATE ---
let navigationState = 'default'; 
let currentViewedGroupId = null;
let cachedTabGroups = []; 

// --- AUTO-REFRESH LOGIC ---
chrome.runtime.onMessage.addListener((request) => {
    if (request.action === "REFRESH_BAR") {
        requestTabList();
    }
});

window.addEventListener('focus', () => {
    requestTabList();
});

// --- DYNAMIC FONT SIZING LOGIC ---
function updateDynamicFontSize() {
    const bar = document.getElementById('ungroup-automatic-tab-bar');
    if (!bar) return;
    
    let currentSize = window.innerWidth * FONT_SIZE_VW_VAL;
    let finalSize = Math.max(currentSize, MIN_FONT_SIZE_PX);
    
    bar.style.fontSize = `${finalSize}px`;
    const textElements = bar.querySelectorAll('div, span');
    textElements.forEach(el => {
        el.style.fontSize = `${finalSize}px`;
        el.style.fontFamily = GLOBAL_FONT;
        if (!el.style.color || el.style.color === 'black' || el.style.color === 'rgb(0, 0, 0)') {
            el.style.color = '#cccccc';
        }
    });
}
window.onresize = updateDynamicFontSize;

// --- QUERY & STATE MANAGEMENT ---

function requestTabList(retry = 0) {
    if (!chrome.runtime.id) return; 
    
    chrome.runtime.sendMessage({ action: "GET_UNGROUPED_TABS" }, function(response) {
        if (chrome.runtime.lastError) {
            if (retry < 3) setTimeout(() => requestTabList(retry + 1), 200);
            return;
        }

        if (response && response.webTabs) {
            cachedTabGroups = response.allTabGroups || [];

            // LEVEL 1 logic: auto-open group if it's the only one
            if (!response.isCurrentTabGrouped && cachedTabGroups.length === 1 && navigationState === 'default') {
                currentViewedGroupId = cachedTabGroups[0].id;
                navigationState = 'group_tabs';
                handleStateChange(); 
                return;
            }
            
            if (navigationState === 'default') {
                renderFakeTabBar(response.currentTabId, response.webTabs, response.systemTabs, response.isCurrentTabGrouped, response.currentTabTitle, cachedTabGroups);
            } else {
                 handleStateChange();
            }
        }
    });
}

function handleStateChange() {
    if (navigationState === 'default') {
        requestTabList();
    } else if (navigationState === 'groups') {
        const sortedGroups = [...cachedTabGroups].sort((a, b) => a.index - b.index);
        renderNavigationBar(sortedGroups);
    } else if (navigationState === 'group_tabs' && currentViewedGroupId) {
        chrome.runtime.sendMessage({ action: "GET_GROUP_TABS", groupId: currentViewedGroupId }, function(response) {
            if (response && response.tabs) {
                 renderNavigationBar(response.tabs, response.groupTitle);
            }
        });
    }
}

function navigateBack() {
    if (navigationState === 'group_tabs') {
        navigationState = (cachedTabGroups.length <= 1) ? 'default' : 'groups';
    } else if (navigationState === 'groups') {
        navigationState = 'default';
    }
    currentViewedGroupId = null;
    handleStateChange();
}

function handleTabClick(tabId) {
    chrome.runtime.sendMessage({ action: "SWITCH_TAB", tabId: tabId }, () => {
        navigationState = 'default'; 
        currentViewedGroupId = null;
        requestTabList();
    });
}

// Function to trigger new tab creation via background script
function handleNewTab() {
    chrome.runtime.sendMessage({ action: "OPEN_NEW_TAB" });
}

// --- RENDERING HELPERS ---

function createFaviconElement(tab, isInteractive = false) {
    if (!tab.favIconUrl) return null;
    const favicon = document.createElement('img');
    favicon.src = tab.favIconUrl;
    favicon.title = tab.title || '';
    favicon.style.cssText = `width: 1em; height: 1em; margin: 0 0.2vw; vertical-align: middle; flex-shrink: 0; transition: transform 0.1s, filter 0.1s;`;

    if (isInteractive) {
        favicon.style.cursor = 'pointer';
        favicon.onmouseover = (e) => { e.stopPropagation(); favicon.style.filter = 'brightness(1.4)'; favicon.style.transform = 'scale(1.2)'; };
        favicon.onmouseout = () => { favicon.style.filter = 'none'; favicon.style.transform = 'scale(1)'; };
        favicon.onclick = (e) => { e.stopPropagation(); handleTabClick(tab.id); };
    }
    return favicon;
}

function getDisplayedTitle(title) {
    if (!title) return "";
    return title.length > MAX_TITLE_LENGTH ? title.substring(0, MAX_TITLE_LENGTH) + "..." : title;
}

function createTabButton(tab, isCurrent) {
    const btn = document.createElement('div');
    btn.title = tab.title || tab.url || "";
    btn.style.cssText = `
        padding: 0 0.4vw; margin: 0 1px; width: ${TAB_WIDTH_VW}; min-width: ${MIN_TAB_WIDTH_PX}px;
        height: 100%; display: flex; align-items: center; flex-shrink: 0; cursor: pointer;
        background: ${isCurrent ? '#3a3a3a' : '#282828'};
        border-bottom: ${isCurrent ? '2px solid ' + INDICATOR_COLOR : 'none'};
        color: ${isCurrent ? '#ffffff' : '#cccccc'}; box-sizing: border-box; font-family: ${GLOBAL_FONT};
    `;
    
    const icon = createFaviconElement(tab, false);
    if (icon) btn.appendChild(icon);
    
    const text = document.createElement('span');
    text.textContent = getDisplayedTitle(tab.title || tab.url);
    text.style.cssText = `overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-left: 0.3vw; color: inherit; font-family: inherit;`;
    btn.appendChild(text);
    
    btn.onclick = () => handleTabClick(tab.id);
    return btn;
}

// Create the fixed plus button
function createPlusButton() {
    const plusBtn = document.createElement('div');
    plusBtn.textContent = '+';
    plusBtn.title = 'New Tab';
    plusBtn.style.cssText = `
        flex-shrink: 0; width: 2vw; min-width: 35px; height: 100%;
        display: flex; align-items: center; justify-content: center;
        background: #282828; margin-left: 1px; cursor: pointer;
        font-size: 1.2em; color: ${INDICATOR_COLOR}; font-weight: bold;
    `;
    plusBtn.onmouseover = () => plusBtn.style.background = '#3a3a3a';
    plusBtn.onmouseout = () => plusBtn.style.background = '#282828';
    plusBtn.onclick = (e) => {
        e.stopPropagation();
        handleNewTab();
    };
    return plusBtn;
}

// --- MAIN RENDERING FUNCTIONS ---

function renderFakeTabBar(currentTabId, webTabs, systemTabs, isCurrentTabGrouped, currentTabTitle, allTabGroups) {
    const existingBar = document.getElementById('ungroup-automatic-tab-bar');
    if (existingBar) existingBar.remove();

    const bar = document.createElement('div');
    bar.id = 'ungroup-automatic-tab-bar';
    bar.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100vw; height: ${TAB_HEIGHT_VW}; min-height: ${MIN_TAB_HEIGHT_PX}px;
        background-color: #202020; border-bottom: 1px solid #111; z-index: 2147483647; 
        padding: 2px 0; display: flex; align-items: center; overflow: hidden; font-family: ${GLOBAL_FONT}; box-sizing: content-box;
    `;

    // 1. Trigger
    const trigger = document.createElement('div');
    trigger.style.cssText = `
        flex-shrink: 0; width: ${TAB_WIDTH_VW}; min-width: ${MIN_TAB_WIDTH_PX}px;
        height: 100%; display: flex; align-items: center; padding: 0 0.3vw;
        background: #282828; margin-right: 1px; cursor: pointer; box-sizing: border-box; font-family: inherit;
    `;
    const indicator = document.createElement('span');
    indicator.textContent = '▼';
    indicator.style.color = INDICATOR_COLOR;
    indicator.style.marginRight = '0.3vw';
    trigger.appendChild(indicator);
    const label = document.createElement('span');
    label.textContent = isCurrentTabGrouped ? getDisplayedTitle(currentTabTitle) : (allTabGroups.length > 0 ? 'Groups' : 'GD Manager');
    label.style.cssText = `overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #cccccc; font-family: inherit;`;
    trigger.appendChild(label);
    trigger.onclick = (e) => {
        e.stopPropagation();
        if (allTabGroups.length === 1) {
            currentViewedGroupId = allTabGroups[0].id;
            navigationState = 'group_tabs';
        } else if (allTabGroups.length > 1) {
            navigationState = 'groups';
        }
        handleStateChange();
    };
    bar.appendChild(trigger);

    // 2. Scrollable Middle
    const scrollContainer = document.createElement('div');
    scrollContainer.style.cssText = `display: flex; overflow-x: auto; flex-grow: 1; align-items: center; height: 100%; scrollbar-width: none;`;
    webTabs.forEach(tab => scrollContainer.appendChild(createTabButton(tab, tab.id === currentTabId)));
    if (systemTabs.length > 0) {
        const sep = document.createElement('div');
        sep.textContent = '|';
        sep.style.cssText = `margin: 0 8px; color: #555; font-weight: bold; flex-shrink: 0;`;
        scrollContainer.appendChild(sep);
        systemTabs.forEach(tab => scrollContainer.appendChild(createTabButton(tab, tab.id === currentTabId)));
    }
    bar.appendChild(scrollContainer);

    // 3. Plus Button
    bar.appendChild(createPlusButton());

    document.body.prepend(bar);
    updateDynamicFontSize();
    setTimeout(() => { document.body.style.marginTop = `${bar.offsetHeight + 5}px`; }, 50);

    document.addEventListener('click', (e) => {
        if (navigationState !== 'default' && !bar.contains(e.target)) {
            navigationState = 'default'; currentViewedGroupId = null; requestTabList();
        }
    }, { once: true });
}

function renderNavigationBar(data, currentGroupTitle = 'Groups List') {
    const existingBar = document.getElementById('ungroup-automatic-tab-bar');
    if (existingBar) existingBar.remove();

    const bar = document.createElement('div');
    bar.id = 'ungroup-automatic-tab-bar';
    bar.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100vw; height: ${TAB_HEIGHT_VW}; 
        min-height: ${MIN_TAB_HEIGHT_PX}px; background-color: #202020; z-index: 2147483647; 
        display: flex; align-items: center; padding: 2px 0; overflow: hidden; font-family: ${GLOBAL_FONT};
    `;

    // 1. Back Button
    const backBtn = document.createElement('div');
    backBtn.style.cssText = `
        flex-shrink: 0; width: ${TAB_WIDTH_VW}; min-width: ${MIN_TAB_WIDTH_PX}px;
        height: 100%; background: #3a3a3a; display: flex; align-items: center;
        padding: 0 0.5vw; margin-right: 1px; cursor: pointer; box-sizing: border-box; font-family: inherit;
    `;
    backBtn.innerHTML = `<span style="color:${INDICATOR_COLOR}; margin-right:0.4vw; font-family: inherit;">${BACK_ARROW}</span> 
                         <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color: #ffffff; font-family: inherit;">${getDisplayedTitle(currentGroupTitle)}</span>`;
    backBtn.onclick = (e) => { e.stopPropagation(); navigateBack(); };
    bar.appendChild(backBtn);

    // 2. Middle Items
    const itemsContainer = document.createElement('div');
    itemsContainer.style.cssText = `display: flex; overflow-x: auto; flex-grow: 1; align-items: center; height: 100%; scrollbar-width: none;`;

    data.forEach(item => {
        const itemBtn = document.createElement('div');
        itemBtn.title = item.title || item.url || "";
        const isLevel2 = (navigationState === 'groups');
        const widthStyle = isLevel2 
            ? `padding: 0 0.6vw; min-width: ${TAB_WIDTH_VW};` 
            : `width: ${TAB_WIDTH_VW}; min-width: ${MIN_TAB_WIDTH_PX}px; padding: 0 0.4vw;`;

        itemBtn.style.cssText = `
            ${widthStyle} margin: 0 1px; 
            height: 100%; display: flex; align-items: center; background: #282828;
            cursor: pointer; flex-shrink: 0; box-sizing: border-box; font-family: inherit;
        `;

        const titleSpan = document.createElement('span');
        titleSpan.textContent = getDisplayedTitle(item.title || item.url);
        titleSpan.style.cssText = `font-family: inherit; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
        
        if (isLevel2) {
            const groupColorHex = GROUP_COLOR_MAP[item.color] || GROUP_COLOR_MAP['default'];
            itemBtn.style.borderBottom = `2px solid ${groupColorHex}`;
            itemBtn.style.color = groupColorHex;
            titleSpan.style.marginRight = '0.8vw';
            itemBtn.appendChild(titleSpan);
            itemBtn.onclick = (e) => {
                e.stopPropagation();
                currentViewedGroupId = item.id; navigationState = 'group_tabs'; handleStateChange(); 
            };
            chrome.runtime.sendMessage({ action: "GET_GROUP_TABS", groupId: item.id }, (res) => {
                if (res && res.tabs) {
                    res.tabs.forEach(t => {
                        const icon = createFaviconElement(t, true);
                        if (icon) itemBtn.appendChild(icon);
                    });
                }
            });
        } else {
            const icon = createFaviconElement(item, false);
            if (icon) itemBtn.appendChild(icon);
            titleSpan.style.marginLeft = '0.3vw';
            titleSpan.style.color = '#ffffff';
            itemBtn.appendChild(titleSpan);
            itemBtn.onclick = () => handleTabClick(item.id);
        }
        itemsContainer.appendChild(itemBtn);
    });
    bar.appendChild(itemsContainer);

    // 3. Plus Button
    bar.appendChild(createPlusButton());

    document.body.prepend(bar);
    updateDynamicFontSize();
}

requestTabList();