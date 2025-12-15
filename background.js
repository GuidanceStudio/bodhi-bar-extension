// Listener for a new tab being created (e.g., when a link is middle-clicked or Ctrl+clicked)
chrome.tabs.onCreated.addListener(function(newTab) {
    
    // We wait a very short period (100ms) to ensure the browser has completed its
    // internal process of assigning the Group ID (if the tab was placed into a group).
    setTimeout(() => {
        
        // 1. Get the newly created tab's full data
        chrome.tabs.get(newTab.id, function(updatedTab) {
            
            // Check if the tab was automatically placed into a group.
            // A groupId of -1 means it is not in a group.
            if (updatedTab.groupId !== -1) {
                
                // 2. UNGROUP: Remove the tab from the group
                chrome.tabs.ungroup(updatedTab.id, () => {
                    if (chrome.runtime.lastError) {
                        // Handle potential errors
                        // console.error("Error during ungrouping:", chrome.runtime.lastError.message);
                        return; 
                    }
                    
                    // 3. REPOSITION: Move the ungrouped tab to the very end of the tab list.
                    // index: -1 is a special value that represents the last position in the window.
                    chrome.tabs.move(updatedTab.id, {
                        index: -1 
                    }, () => {
                        if (chrome.runtime.lastError) {
                            // console.error("Error during repositioning:", chrome.runtime.lastError.message);
                        } else {
                            // console.log("Tab successfully ungrouped and moved to the end.");
                        }
                    });
                });
            }
        });
    }, 100); 
});