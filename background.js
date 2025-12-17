// --- 1. CONFIGURATION & UTILS ---

let isSorting = false; // Prevents infinite loops during tab movement

/**
 * Robust check for system/internal pages.
 */
function isSystemPage(url) {
    if (!url) return false;
    const systemPrefixes = [
        'chrome://', 
        'brave://', 
        'about:', 
        'chrome-extension://', 
        'edge://', 
        'devtools://'
    ];
    return systemPrefixes.some(prefix => url.startsWith(prefix));
}

/**
 * Map tab data for the UI.
 */
const mapTab = (tab) => ({
    id: tab.id,
    title: tab.title,
    url: tab.url,
    favIconUrl: tab.favIconUrl,
    groupId: tab.groupId,
    index: tab.index
});

/**
 * Notify all content scripts to refresh the UI bar.
 */
function notifyTabs() {
    chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
            if (tab.url && (tab.url.startsWith('http') || tab.url.startsWith('file'))) {
                chrome.tabs.sendMessage(tab.id, { action: "REFRESH_BAR" }).catch(() => {});
            }
        });
    });
}

// --- 2. CORE ENFORCEMENT LOGIC (THE WALL) ---

/**
 * Ensures that all Web tabs are on the left and all System tabs are on the right.
 * This is called on move, update, and creation.
 */
async function enforceTabOrder(windowId) {
    if (isSorting) return; // Skip if we are already moving tabs
    isSorting = true;

    chrome.tabs.query({ windowId: windowId }, (tabs) => {
        // 1. Sort tabs by their current index to understand current sequence
        tabs.sort((a, b) => a.index - b.index);

        // 2. Identify the boundary: find the index of the first system tab
        const firstSystemTab = tabs.find(t => isSystemPage(t.url));
        
        if (firstSystemTab) {
            const boundaryIndex = firstSystemTab.index;

            // Check if any Web tab is positioned AFTER the first system tab
            const misplacedWebTab = tabs.find(t => !isSystemPage(t.url) && t.index > boundaryIndex);

            if (misplacedWebTab) {
                // Move the misplaced web tab to the boundary position
                // This will push the system tabs to the right
                chrome.tabs.move(misplacedWebTab.id, { index: boundaryIndex }, () => {
                    isSorting = false;
                    enforceTabOrder(windowId); // Recursive check until order is perfect
                });
                return;
            }
        }
        
        // 3. Check if a System tab is misplaced (e.g., dragged to the start)
        // If a system tab is followed by a web tab, it's misplaced.
        const misplacedSystemTab = tabs.find((t, i) => 
            isSystemPage(t.url) && tabs[i + 1] && !isSystemPage(tabs[i + 1].url)
        );

        if (misplacedSystemTab) {
            chrome.tabs.move(misplacedSystemTab.id, { index: -1 }, () => {
                isSorting = false;
                enforceTabOrder(windowId);
            });
            return;
        }

        isSorting = false;
        notifyTabs(); // Refresh UI after sorting is done
    });
}

// --- 3. EVENT LISTENERS ---

// Handle new tab creation
chrome.tabs.onCreated.addListener((tab) => {
    // Ungroup immediately if necessary
    if (tab.groupId !== -1) chrome.tabs.ungroup(tab.id);
    
    // Give the browser a moment to resolve the URL before enforcing order
    setTimeout(() => {
        enforceTabOrder(tab.windowId);
    }, 200);
});

// Detect manual movement
chrome.tabs.onMoved.addListener((tabId, moveInfo) => {
    enforceTabOrder(moveInfo.windowId);
});

// Detect URL changes (e.g. if a site becomes 'brave://settings')
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url || changeInfo.status === 'complete') {
        enforceTabOrder(tab.windowId);
    }
});

// UI Sync only
chrome.tabs.onRemoved.addListener(notifyTabs);
chrome.tabs.onActivated.addListener(notifyTabs);

// --- 4. MESSAGE HANDLER (API) ---

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "GET_UNGROUPED_TABS") {
        const currentTab = sender.tab;
        if (!currentTab) return;

        chrome.tabs.query({ windowId: currentTab.windowId }, (allTabs) => {
            chrome.tabGroups.query({ windowId: currentTab.windowId }, (allGroups) => {
                const ungrouped = allTabs.filter(t => t.groupId === -1);
                sendResponse({
                    currentTabId: currentTab.id,
                    isCurrentTabGrouped: currentTab.groupId !== -1,
                    currentTabTitle: currentTab.title,
                    webTabs: ungrouped.filter(t => !isSystemPage(t.url)).map(mapTab),
                    systemTabs: ungrouped.filter(t => isSystemPage(t.url)).map(mapTab),
                    allTabGroups: allGroups
                });
            });
        });
        return true;
    }

    if (request.action === "GET_GROUP_TABS") {
        chrome.tabs.query({ groupId: request.groupId }, (tabs) => {
            chrome.tabGroups.get(request.groupId, (group) => {
                sendResponse({
                    tabs: tabs.map(mapTab),
                    groupTitle: group ? group.title : "Group Tabs",
                    groupColor: group ? group.color : "grey"
                });
            });
        });
        return true;
    }

    if (request.action === "SWITCH_TAB") {
        chrome.tabs.update(request.tabId, { active: true });
        return true;
    }

    if (request.action === "OPEN_NEW_TAB") {
        chrome.tabs.create({});
        return true;
    }

    if (request.action === "FOCUS_GROUP") {
        chrome.tabGroups.update(request.groupId, { collapsed: false });
        chrome.tabs.query({ groupId: request.groupId }, (tabs) => {
            if (tabs.length > 0) chrome.tabs.update(tabs[0].id, { active: true });
        });
        return true;
    }
});