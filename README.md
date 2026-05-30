# Bodhi Bar - Smart Tab Manager

A Chromium-based browser productivity layer that turns a browser window into a **repeatable workspace**.

Bodhi Bar enforces a stable tab structure (pinned → groups → ungrouped), adds a fast in-page horizontal tab bar, and introduces **Workspaces**: named snapshots of your window you can restore, export, and import. This is especially useful on browsers like **Brave** (including setups with a vertical tab strip), where you may want a consistent “workspace” model independent of the native tab UI.

## Recommended setup: Vertical tabs (Chromium-based browsers)

Bodhi Bar works best when you set your browser's native tab strip to **vertical tabs** (especially in Brave).
This gives you a scalable overview of many tabs, while Bodhi Bar provides the fast "workspace layer" on top:
stable ordering, group-focused navigation, and search.

Optionally, if you prefer a cleaner UI, you can also hide/collapse the vertical tabs panel when you're not using it.

### Brave (Chromium)
- Enable vertical tabs (official instructions): https://brave.com/blog/vertical-tabs/
- (Optional) Hide the vertical tabs panel completely when minimized: https://brave.com/whats-new/hide-vertical-tabs/

### Microsoft Edge (Chromium)
- Vertical tabs (official page + FAQ, including how to enable/disable): https://www.microsoft.com/en-us/edge/features/vertical-tabs

### Vivaldi (Chromium)
- Move the Tab Bar to the left/right (vertical) + Tab Bar visibility: https://help.vivaldi.com/desktop/tabs/tab-bar/
- (Optional) Hide browser UI / Tab Bar (includes "Hide the Tab Bar"): https://help.vivaldi.com/desktop/appearance-customization/hide-browser-windows-user-interface/

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
  - This affects the browser's native tab strip (not just the in-page bar) and is skipped during the startup/session-restore grace period.
- **Horizontal tab bar UI (in-page)**:
  - The UI is injected at the top of normal web pages and provides quick access to your tabs without relying on the browser tab strip.
  - **Minimize/Expand**: In **Overlay** mode, click the small arrow icon at the far left to collapse the bar to a tiny control. This state is saved **per tab**. (Note: The minimize button is hidden in Push mode).
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
  - Icons in the bar brighten slightly on hover for clearer affordance (applies across all levels).
- **Workspaces (Import/Export)**:
  - Save the current window state (pinned tabs and all tab groups) as a named Workspace.
  - **Save current**: Click the blue button to save your current workspace with a custom name.
  - **Actions**: Each workspace shows a row with its name and five flat action icons:
    - **Restore**: Instantly recreate the saved workspace (opens all pinned tabs and recreates all tab groups with their original titles and colors).
    - **Edit**: Open the saved workspace in a full-page editor. Supports renaming the workspace and groups, changing group colors, drag-and-drop reordering of groups and tabs (including pinned), creating new groups, adding and deleting tabs (in groups or pinned), editing tab URLs, changing per-tab visibility mode (push/overlay/hidden), and managing per-host CSS overrides saved with the workspace. Changes are buffered in memory; click **Save** (or Cmd/Ctrl+S) to persist, or **Discard** to revert. The editor warns before closing with unsaved changes and surfaces a conflict prompt if the workspace was modified externally.
    - **Rename**: Give the workspace a new name.
    - **Export**: Download the workspace as a JSON file for backup or sharing.
    - **Delete**: Remove the workspace from storage.
  - **Import**: Restore workspaces from JSON files. If the imported workspace name already exists, Bodhi asks you to choose a different name.
  - **Versioning**: Exported files include a workspace version field (`wv`, currently `1.0`). Import validates the version to ensure compatibility.
  - **Group metadata persistence**: After every workspace restore, the extension persists a `url → { title, color }` map (`tz_group_meta`) so that on the next browser startup it can re-apply group titles and colors to session-restored groups (Brave does not persist extension-set metadata across restarts). Re-apply runs automatically ~10 s after startup, once session restore is complete. Note: the visual label in Brave's sidebar/Quick Access still requires a manual click on the group to repaint — this is a Brave rendering limitation not addressable via extension API.
- **Smart Visibility Rules**: Create powerful rules to automatically set the bar mode (Push, Overlay, Hidden) based on URL patterns (e.g., `*google.com/*` or `*docs.google.com/spreadsheets/*`). Specific rules override generic ones.
- **Custom CSS Overrides**: Add per-site CSS patches directly from the popup to fix layout issues on tricky sites (e.g., shifting fixed headers). These overrides are applied only in **Push** mode.
- **Drag & drop reordering**:
  - Reorder pinned tabs among pinned tabs
  - Reorder ungrouped web tabs among web tabs, and system tabs among system tabs
  - Reorder tabs within the same group (Level 3)
  - Reorder groups (Level 2)
- **Zoom + layout resilience**:
  - Zoom-compensated sizing (keeps the bar usable across browser zoom levels)
  - Automatic page “safe area” padding + header collision shifting for fixed/sticky headers
  - Per-site overrides for known tricky layouts (e.g., YouTube header, Google Sheets bottom container)

## Visibility Control (Push / Overlay / Hidden)

The Bodhi Bar supports three visibility modes, togglable **per tab** via the extension's popup:

1. **Push (Default)**: The bar is fixed at the top and pushes the website content down so nothing is obscured. The minimize button is disabled in this mode to ensure layout stability.
2. **Overlay**: The bar floats over the website content. In this mode, a **minimize button** (arrow icon) appears on the left, allowing you to collapse the bar into a small floating trigger.
3. **Hidden**: The bar is completely removed from the DOM for that tab.

You can also configure **Smart Rules** in the popup to automate this behavior based on URL patterns.

### Priority Logic:
1.  **Explicit Toggle**: If you manually select a mode for a specific tab in the popup, that setting always wins for that tab session.
2.  **Smart Rules**: If no manual toggle exists, the extension checks your saved rules. The most specific matching rule (longest pattern) determines the mode.
3.  **Default**: If neither applies, the bar defaults to **Push** mode.

### How it works:
1.  **Extension Icon**: Click the Bodhi Bar icon in the Chrome toolbar.
2.  **Mode Selection**: Choose between Push, Overlay, or Hidden for the current tab.
3.  **Rules Management**:
    - **Add Rule**: Click `+` to add a rule for the current site.
    - **Edit Rule**: You can edit the pattern (e.g., change `*example.com/*` to `*example.com/app/*`) and the target mode (Push/Overlay/Hidden) for that rule.
    - **CSS Overrides**: Click `{}` to write custom CSS for the current site (applied only in Push mode).
4.  **Minimize (Overlay only)**: When in Overlay mode, use the `‹` icon to collapse the bar.
5.  **Instant Layout Adjustment**: When hidden, the extension automatically removes the `padding-top` and `margin` adjustments from the current webpage.
6.  **Persistence**: Your visibility preference is saved in `chrome.storage.local`.

---

## Technical Implementation Details (for Developers)
*   **State Management**:
    *   `tz_visibility_mode` tracks explicit mode per tabId.
    *   `tz_visibility_rules` stores the array of user-defined pattern rules.
    *   `tz_site_overrides` stores user-defined CSS patches per hostname.
    *   `tz_group_meta` stores a `url → { title, color }` map written after each workspace restore, used to re-apply group metadata on the next startup.
*   **Messaging**: `popup.js` communicates with `content.js` via `chrome.tabs.sendMessage` using the `SET_VISIBILITY_MODE` action.
*   **CSS Injection**: The bar is hidden using `display: none !important` to ensure it overrides site-specific styles.
*   **Reflow**: `page-shift.js` checks bar visibility and restores shifted headers / safe-area padding when the bar is hidden, then triggers a resize to let the page reflow.
*   **Layout behavior**: when minimized, the bar collapses to the minimize button and `page-shift.js` removes the safe-area padding / header shifting (treats minimized like hidden for page layout).
*   **Reflow**: `page-shift.js` monitors the bar's visibility; if the bar is detected as hidden (via `getComputedStyle`), it triggers `restoreShiftedHeaders()` to clean up the DOM.
*   **Workspace file format**: Exported JSON includes a workspace version field (`wv`, currently `1.0`). Import validates the version and basic schema before saving.

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
- **site_overrides.js**: dynamic CSS patch injector (reads from storage).
- **manifest.json**: MV3 manifest and permissions.

## Development Installation
1. Enable Developer Mode in Chrome extensions
2. Click "Load Unpacked Extension"
3. Select our source folder
4. Refresh normal websites to activate

## Tests
Unit tests run on Node's built-in test runner — no dependencies to install:

```
npm test
```

Because the content scripts are plain browser globals (no module system), the
harness in `tests/helpers/harness.js` loads the real source files into a `vm`
sandbox with a mocked `chrome` API and a minimal DOM, then exposes the
requested top-level symbols for assertions. Test files live in `tests/` and are
named `*.test.js`.

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
