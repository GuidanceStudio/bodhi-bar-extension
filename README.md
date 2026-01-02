# Bodhi Bar - Smart Tab Manager

Chrome extension that improves tab management by enforcing a stable tab layout (pinned → groups → ungrouped) and providing a horizontal in-page tab bar UI.

## Key Features
- **Stable tab layout enforcement (background service worker)**:
  - The extension continuously reorders tabs to keep a predictable structure:
    1) Pinned tabs first
    2) Then tab groups (kept compact)
    3) Then ungrouped tabs
  - Among ungrouped tabs, normal **web** tabs are kept before **system** tabs (`chrome://`, `brave://`, `about:`, etc.)
- **Keep groups “clean” (auto-ungrouping for new tabs)**:
  - If a newly created tab ends up inside an existing group, the extension automatically removes it from the group.
  - This is implemented in an event-driven way (no periodic “sweeps”) to avoid accidental mass-ungrouping during session restore.
  - Tabs are considered eligible for auto-ungrouping only when there is strong evidence they were user-created (e.g., link-opened tabs with `openerTabId`, plus tabs created via the extension UI).
- **Native tab strip group collapsing (opinionated)**:
  - On every tab activation, the extension collapses all tab groups in the current window.
  - If the active tab belongs to a group, that group is kept expanded while all other groups are collapsed.
  - This affects the browser’s native tab strip (not just the in-page bar) and is skipped during the startup/session-restore grace period.
- **Horizontal tab bar UI (in-page)**:
  - The UI is injected at the top of normal web pages and provides quick access to your tabs without relying on the browser tab strip.
  - Level 1: pinned favicons + ungrouped tabs (web + system separated by a divider)
  - “Groups” trigger to navigate into groups
- **Group navigation (multi-level)**:
  - Level 2: groups list with group color + favicons of tabs inside each group
  - Level 3: tabs inside a selected group, with an “Ungroup / Move to group / New group…” menu
- **Search (popover)**: search across all tabs (pinned, ungrouped, and grouped) with match highlighting and quick switch.
- **Quick actions**:
  - Close tab (X)
  - Create new tab (+)
  - Group an ungrouped web tab into an existing group or a new group
  - Ungroup a grouped tab (Level 3 menu)
- **Workspaces (Import/Export)**:
  - Save the current window state (pinned tabs and all tab groups) as a named Workspace.
  - **Save current**: Click the blue button to save your current workspace with a custom name.
  - **Actions**: Each workspace shows a row with its name and four flat action icons:
    - 🔄 **Restore**: Instantly recreate the saved workspace (opens all pinned tabs and recreates all tab groups with their original titles and colors).
    - ✏️ **Rename**: Give the workspace a new name.
    - 📤 **Export**: Download the workspace as a JSON file for backup or sharing.
    - 🗑️ **Delete**: Remove the workspace from storage.
  - **Import**: Restore workspaces from JSON files. The system prevents duplicates and allows overwriting existing workspaces.
  - **Versioning**: Exported files include a version (starting at `1.0`) to ensure compatibility. The extension validates the version during import to prevent data corruption.
- **Drag & drop reordering**:
  - Reorder pinned tabs among pinned tabs
  - Reorder ungrouped web tabs among web tabs, and system tabs among system tabs
  - Reorder tabs within the same group (Level 3)
  - Reorder groups (Level 2)
- **Zoom + layout resilience**:
  - Zoom-compensated sizing (keeps the bar usable across browser zoom levels)
  - Automatic page “safe area” padding + header collision shifting for fixed/sticky headers
  - Per-site overrides for known tricky layouts (e.g., YouTube header, Google Sheets bottom container)

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
*   **Reflow**: `page-shift.js` checks bar visibility and restores shifted headers / safe-area padding when the bar is hidden, then triggers a resize to let the page reflow.
*   **Reflow**: `page-shift.js` monitors the bar's visibility; if the bar is detected as hidden (via `getComputedStyle`), it triggers `restoreShiftedHeaders()` to clean up the DOM.
*   **Workspace Versioning**: The extension uses a `version` field in exported JSONs. Currently, version `1.0` is supported. The import logic in `popup.js` strictly validates this version to ensure the data schema is compatible with the current extension version.

## Important
- The UI is injected only on normal websites (`http(s)://...`). It will not run on browser-restricted/system pages (e.g., `chrome://extensions`), where content scripts cannot be injected.
- “System tabs” (e.g., `chrome://`, `brave://`, `about:`) are still managed by the background layout rules, but they are shown in the bar only as a separate “system” section when the bar is injected on a normal website.

## Project Structure
Our codebase is organized into specialized components:
- **background.js**: service worker enforcing tab layout + handling UI actions (switch/close/move/group/ungroup) + **workspace payload generation and JSON downloads**.
- **popup.js**: extension action popup handling visibility toggle and **workspace management (save/import/export/delete)**.
- **content.js**: UI entry point + navigation state + refresh handling.
- **render.js**: bar rendering (Level 1/2/3) and dynamic layout updates.
- **search.js**: search state + search popover trigger.
- **popover.js**: group picker popover + search results popover.
- **drag-drop.js**: drag & drop for tabs and groups.
- **page-shift.js**: safe-area padding + header collision shifting + bottom clipper handling.
- **zoom.js**: zoom-compensated CSS variables and metric updates.
- **messaging.js**: port handshake + robust message retry.
- **constants.js**: shared UI constants and IDs.
- **content.css**: all UI styling (bar, tiles, popovers).
- **site_overrides.js**: per-site exceptions (injected into all frames by the service worker).
- **manifest.json**: MV3 manifest and permissions.

## Development Installation
1. Enable Developer Mode in Chrome extensions
2. Click "Load Unpacked Extension"
3. Select our source folder
4. Refresh normal websites to activate

## Troubleshooting
### Service Worker "Inactive"
- Verify no import errors exist
- Confirm `manifest.json` points to `background.js` as the MV3 service worker
- Check the extension’s Service Worker console for errors

### Empty Bar with "No Receiver" Message
- Check browser console for errors
- Reload the extension
- Validate all files are present

## Technical Highlights
- Manifest V3 service worker + content-script UI
- Robust message retry + handshake to reduce “no receiver” issues
- Best-effort handling for restricted pages and timing edges (BFCache / late injection)
- Full Manifest V3 compatibility
- Ready for deployment to Chrome Web Store (packaged extension)

> Project lovingly maintained with modern development tools

