# Bodhi Bar

## Visibility Control (Hide/Show)

The Bodhi Bar can be toggled on or off globally via the extension's action menu. This allows you to reclaim full screen space on specific sites or during focused work without disabling the extension.

### How it works:
1.  **Extension Icon**: Click the Bodhi Bar icon in the Chrome toolbar.
2.  **Dynamic Toggle**: 
    *   If the bar is currently visible, the popup will show a **"Hide Bar"** button.
    *   If the bar is hidden, the popup will show a **"Show Bar"** button.
3.  **Instant Layout Adjustment**: When hidden, the extension automatically removes the `padding-top` and `margin` adjustments from the current webpage, allowing the site's original headers and content to return to their default positions.
4.  **Persistence**: Your visibility preference is saved in `chrome.storage.local`. If you hide the bar, it will remain hidden across browser restarts and on all new tabs until you choose to show it again.
5.  **Context Awareness**: The toggle sends a real-time message to the active tab to hide/show the bar instantly without requiring a page refresh.

---

## Technical Implementation Details (for Developers)
*   **State Management**: The `tz_hidden` key in storage tracks the UI state.
*   **Messaging**: `popup.js` communicates with `content.js` via `chrome.tabs.sendMessage` using the `SET_VISIBILITY` action.
*   **CSS Injection**: The bar is hidden using `display: none !important` to ensure it overrides site-specific styles.
*   **Reflow**: `page-shift.js` monitors the bar's visibility; if the bar is detected as hidden (via `getComputedStyle`), it triggers `restoreShiftedHeaders()` to clean up the DOM.
