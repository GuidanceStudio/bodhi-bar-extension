# AIDER.md

## Repo purpose
- Bodhi Bar: A Chromium extension for stable tab management, in-page tab bar, and workspace snapshots.
- Key goal: Enforce predictable tab order (pinned -> groups -> ungrouped) and provide a fast UI for navigation and workspace management.

## Run / build / test
- **Load Unpacked**: In Chrome/Brave, go to `chrome://extensions`, enable "Developer Mode", click "Load Unpacked", and select the project folder.
- **Test**: Open a normal website (e.g., `https://example.com`). The bar should appear at the top. Use the extension icon to toggle visibility and manage workspaces.
- **Verify Background**: Open the extension's service worker console (`chrome://extensions` -> Inspect views: service worker) to check for errors.

## Key code locations
- `background.js`: Service worker for tab layout enforcement, UI actions (move/close/group), and workspace logic (save/export/import).
- `content.js`: UI entry point, navigation state, and message handling.
- `render.js`: Renders the bar UI (Levels 1, 2, 3) and updates layout.
- `popup.js`: Extension popup for visibility toggle and workspace management UI.
- `search.js`: Search logic and popover trigger.
- `popover.js`: Renders search results and group pickers.
- `drag-drop.js`: Handles drag-and-drop for tabs and groups.
- `page-shift.js`: Manages page padding and header shifting to avoid overlap.
- `zoom.js`: Compensates for browser zoom levels in sizing.
- `messaging.js`: Robust message passing with retry logic.
- `constants.js`: Shared IDs and constants.
- `content.css`: All UI styles.
- `site_overrides.js`: Per-site CSS fixes injected by the service worker.
- `manifest.json`: MV3 manifest and permissions.

## Invariants / pitfalls
- **UI Injection**: The bar is only injected into normal `http(s)` pages, not system pages (`chrome://`, `about:`).
- **Service Worker**: Manifest V3 service workers can go inactive; messaging uses a retry mechanism to handle this.
- **Tab Order**: The background script continuously enforces tab order. Do not rely on manual tab ordering.
- **Auto-ungrouping**: New tabs opened inside existing groups are automatically ungrouped to keep groups "clean".
- **Group Collapsing**: Native tab groups are collapsed/expanded on tab activation for a cleaner UI.
- **Zoom**: The bar uses zoom-compensated metrics; ensure `zoom.js` is called on resize/zoom events.
- **Visibility**: Per-tab visibility is stored in `chrome.storage.local` (`tz_visibility_mode`). Rules are in `tz_visibility_rules`.
- **Overrides**: CSS overrides are stored in `tz_site_overrides` and applied dynamically by `site_overrides.js`.

## Docs
- See `README.md` for user-facing features and setup instructions.
- Code comments in `background.js` detail the workspace payload structure and tab layout rules.
- `content.css` contains comments for key UI components.
