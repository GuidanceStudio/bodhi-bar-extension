# Bodhi Bar - Smart Tab Manager

Chrome extension that improves tab management by enforcing a stable tab layout (pinned → groups → ungrouped) and providing a horizontal in-page tab bar UI.

## Key Features
- **Stable tab layout enforcement (background service worker)**:
  - Pinned tabs are kept at the start
  - Tab groups are kept compact immediately after pinned tabs
  - Ungrouped tabs are kept after groups
  - Ungrouped **web** tabs are kept before ungrouped **system** tabs
- **Auto-ungrouping for *new* tabs**: newly created tabs that land inside a group are automatically ungrouped (with a startup/session-restore grace period to avoid accidental ungrouping).
- **Horizontal tab bar UI (in-page)**:
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
- **Drag & drop reordering**:
  - Reorder pinned tabs among pinned tabs
  - Reorder ungrouped web tabs among web tabs, and system tabs among system tabs
  - Reorder tabs within the same group (Level 3)
  - Reorder groups (Level 2)
- **Zoom + layout resilience**:
  - Zoom-compensated sizing (keeps the bar usable across browser zoom levels)
  - Automatic page “safe area” padding + header collision shifting for fixed/sticky headers
  - Per-site overrides for known tricky layouts (e.g., YouTube header, Google Sheets bottom container)

## Important
- The UI is injected only on normal websites (`http(s)://...`). It will not run on browser system pages like `chrome://extensions`.
- “System tabs” (e.g., `chrome://`, `brave://`, `about:`) are still managed by the background layout rules, but they are shown in the bar only as a separate “system” section when the bar is injected on a normal website.

## Project Structure
Our codebase is organized into specialized components:
- **background.js**: service worker enforcing tab layout + handling UI actions (switch/close/move/group/ungroup).
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

