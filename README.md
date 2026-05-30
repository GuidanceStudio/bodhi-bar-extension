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
  - The UI is injected at the top of normal web pages as a floating overlay and provides quick access to your tabs without relying on the browser tab strip.
  - **Leaf chip + hover + pin**: by default the bar is collapsed to a small **leaf** chip in the top-left corner. Hovering the leaf peeks the full bar open; clicking it **pins** the bar open for that tab. The pinned state is saved **per tab**. The page is never reflowed — the bar always floats over content.
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
    - **Edit**: Open the saved workspace in a full-page editor. Supports renaming the workspace and groups, changing group colors, drag-and-drop reordering of groups and tabs (including pinned), creating new groups, adding and deleting tabs (in groups or pinned), and editing tab URLs. Changes are buffered in memory; click **Save** (or Cmd/Ctrl+S) to persist, or **Discard** to revert. The editor warns before closing with unsaved changes and surfaces a conflict prompt if the workspace was modified externally.
    - **Rename**: Give the workspace a new name.
    - **Export**: Download the workspace as a JSON file for backup or sharing.
    - **Delete**: Remove the workspace from storage.
  - **Import**: Restore workspaces from JSON files. If the imported workspace name already exists, Bodhi asks you to choose a different name.
  - **Versioning**: Exported files include a workspace version field (`wv`, currently `1.0`). Import validates the version to ensure compatibility.
  - **Group metadata persistence**: After every workspace restore, the extension persists a `url → { title, color }` map (`tz_group_meta`) so that on the next browser startup it can re-apply group titles and colors to session-restored groups (Brave does not persist extension-set metadata across restarts). Re-apply runs automatically ~10 s after startup, once session restore is complete. Note: the visual label in Brave's sidebar/Quick Access still requires a manual click on the group to repaint — this is a Brave rendering limitation not addressable via extension API.
- **Drag & drop reordering**:
  - Reorder pinned tabs among pinned tabs
  - Reorder ungrouped web tabs among web tabs, and system tabs among system tabs
  - Reorder tabs within the same group (Level 3)
  - Reorder groups (Level 2)
- **Zoom + layout resilience**:
  - Zoom-compensated sizing (keeps the bar usable across browser zoom levels)
  - The bar floats as an overlay and never reflows the page

## Bar visibility: leaf + hover + pin

The Bodhi Bar always floats over the page as an overlay — it never pushes or reflows page content. It has a single behavior with two states per tab:

1. **Collapsed (default)**: only a small **leaf** chip is shown in the top-left corner. Minimal footprint.
2. **Hover**: moving the pointer over the leaf peeks the full bar open; it collapses again when the pointer leaves.
3. **Pinned**: clicking the leaf pins the bar open for that tab, so it stays expanded regardless of hover. Clicking again unpins it.

The pin state is stored **per tab** in `chrome.storage.local` (`tz_pinned_by_tab`); a tab is pinned only if explicitly stored, so the default is the collapsed leaf. When a tab closes, its entry is dropped.

> Note: earlier versions had three visibility modes (Push / Overlay / Hidden), per-URL rules and per-site CSS overrides. These were removed in favor of the single overlay + leaf/pin model. Workspaces saved by older versions still import correctly — the obsolete `visibilityMode` / `siteOverrides` / `visibilityRules` fields are simply ignored.

---

## Technical Implementation Details (for Developers)
*   **State Management**:
    *   `tz_pinned_by_tab` tracks the per-tab pin state (`{ [tabId]: true }`; absent = collapsed).
    *   `tz_group_meta` stores a `url → { title, color }` map written after each workspace restore, used to re-apply group metadata on the next startup.
*   **Layout**: the bar is `position: fixed` and floats over the page. Collapsed/expanded is pure CSS: `#…:not(.tz-pinned):not(:hover)` shows only the leaf chip; `:hover` or `.tz-pinned` expands it. `page-shift.js` is now a no-op (`applyPageShift`) kept only so existing call sites stay valid.
*   **Workspace file format**: Exported JSON includes a workspace version field (`wv`, currently `1.0`). Import validates the version and basic schema before saving; obsolete fields from older versions are accepted and ignored.

## Important
- The UI is injected only on normal websites (`http(s)://...`). It will not run on browser-restricted/system pages (e.g., `chrome://extensions`), where content scripts cannot be injected.
- “System tabs” (e.g., `chrome://`, `brave://`, `about:`) are still managed by the background layout rules, but they are shown in the bar only as a separate “system” section when the bar is injected on a normal website.

## Project Structure
Our codebase is organized into specialized components:
- **background.js**: service worker enforcing tab layout + handling UI actions (switch/close/move/group/ungroup) + **workspace payload generation and JSON downloads**.
- **popup.js**: extension action popup handling **workspace management (save/import/export/delete)**.
- **content.js**: UI entry point + navigation state + refresh handling.
- **render.js**: bar rendering (Level 1/2/3), the leaf chip + pin toggle, and dynamic layout updates.
- **search.js**: search state + search popover trigger.
- **popover.js**: group picker popover + search results popover.
- **drag-drop.js**: drag & drop for tabs and groups.
- **page-shift.js**: overlay-only layout (no-op `applyPageShift`; the page is never reflowed).
- **zoom.js**: zoom-compensated CSS variables and metric updates.
- **messaging.js**: port handshake + robust message retry.
- **constants.js**: shared UI constants, IDs, the inline leaf glyph, and pin-state helpers.
- **content.css**: all UI styling (bar, tiles, popovers).
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
