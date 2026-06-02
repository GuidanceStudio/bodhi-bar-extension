# Bodhi Bar — Smart Tab Manager

A Chromium-based browser productivity layer that turns a browser window into a **repeatable workspace**.

Bodhi Bar enforces a stable tab structure (pinned → groups → ungrouped), adds a fast in-page horizontal tab bar, and introduces **Workspaces**: named snapshots of your window you can restore, export, and import. It's especially handy on browsers like **Brave** (including setups with a vertical tab strip), where you want a consistent "workspace" model independent of the native tab UI.

Works on Chromium-based browsers: Brave, Chrome, Edge, Vivaldi.

## Install

Bodhi Bar is distributed as source (not on the Chrome Web Store). To install it:

1. Download or clone this repository to a folder on your computer.
2. Open your browser's extensions page:
   - Brave: `brave://extensions`
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
3. Turn on **Developer mode** (toggle, usually top-right).
4. Click **Load unpacked** and select the folder you downloaded.
5. The Bodhi Bar icon (a green leaf) appears in your toolbar. Refresh any open web pages to activate the in-page bar.

> Keep the folder where it is — the browser loads the extension from that location. Deleting or moving it removes the extension.

## Quick start

1. Open a normal website. A small **leaf** chip appears in the top-left corner — that's the collapsed bar. Hover it to peek the full bar open.
2. Arrange your window the way you like it: pin tabs, create tab groups.
3. Click the toolbar icon to open the popup, type a name, and **Save current** to store your window as a Workspace.
4. Later, open the popup and click **Restore** on that Workspace to recreate all your pinned tabs and groups in one click.

## Recommended setup: vertical tabs

Bodhi Bar works best when your browser's native tab strip is set to **vertical tabs** (especially in Brave): you get a scalable overview of many tabs, while Bodhi Bar adds the fast "workspace layer" on top — stable ordering, group-focused navigation, and search. Optionally, hide/collapse the vertical panel when you're not using it for a cleaner UI.

- **Brave** — [enable vertical tabs](https://brave.com/blog/vertical-tabs/) · [hide the panel when minimized](https://brave.com/whats-new/hide-vertical-tabs/)
- **Edge** — [vertical tabs](https://www.microsoft.com/en-us/edge/features/vertical-tabs)
- **Vivaldi** — [move the tab bar to the side](https://help.vivaldi.com/desktop/tabs/tab-bar/) · [hide browser UI](https://help.vivaldi.com/desktop/appearance-customization/hide-browser-windows-user-interface/)

## Using the bar

The bar always **floats over the page as an overlay** — it never pushes or reflows your content. It has one behavior with a few states, saved **per tab**:

- **Collapsed (default)** — only a small leaf chip in the top-left corner.
- **Hover** — move the pointer over the leaf to peek the full bar open; it collapses again when you leave.
- **Pinned** — single-click the leaf to keep the bar open for that tab; click again to unpin.
- **Hidden** — double-click the leaf to hide the bar entirely for that tab. Since the leaf is then gone, re-show it from the toolbar popup's **"Hide / Show bar on this tab"** toggle (it takes effect live, no reload).

Inside the bar you can navigate three levels:

- **Level 1** — pinned favicons + ungrouped tabs (web and system tabs separated by a divider), plus a **Groups** trigger.
- **Level 2** — the list of groups, each with its color and the favicons of the tabs inside.
- **Level 3** — the tabs inside a selected group, with an **Ungroup / Move to group / New group…** menu.

**Quick actions**: close a tab (X), create a new tab (+), group an ungrouped web tab into an existing or new group, and ungroup a grouped tab.

**Search**: a popover searches across all tabs (pinned, ungrouped, grouped) with match highlighting and quick switch.

**Drag & drop**: reorder pinned tabs, ungrouped web/system tabs (within their section), tabs within a group, and groups themselves.

The bar uses zoom-compensated sizing so it stays usable across browser zoom levels.

## Workspaces

A Workspace is a named snapshot of your window — its pinned tabs and all tab groups (with titles and colors). Manage them from the toolbar popup:

- **Save current** — store the current window as a named Workspace.
- **Restore** — recreate the saved Workspace (opens all pinned tabs and rebuilds all groups with their original titles and colors).
- **Edit** — open the Workspace in a full-page editor: rename the workspace and groups, change group colors, drag-and-drop reorder groups and tabs (including pinned), create groups, add/delete tabs, and click a tab's URL or label to edit it inline. (A tab label is a name you give it inside the workspace; it survives export/import, but on restore the browser shows the live page's own title.) Changes are buffered in memory — **Save** (or Cmd/Ctrl+S) to persist, **Discard** to revert. The editor warns before closing with unsaved changes and flags conflicts if the workspace was modified elsewhere.
- **Rename** — give the workspace a new name.
- **Export** — download the workspace as a JSON file for backup or sharing.
- **Delete** — remove the workspace from storage.
- **Import** — load workspaces from JSON files. If the name already exists, Bodhi Bar asks you to pick a different one.

Exported files carry a version field (`wv`, currently `1.0`), validated on import for compatibility.

## How layout enforcement works

In the background, Bodhi Bar keeps your tabs in a predictable structure:

- **Stable ordering** — pinned tabs first, then tab groups (kept compact), then ungrouped tabs. Among ungrouped tabs, normal **web** tabs come before **system** tabs (`chrome://`, `brave://`, `about:`, …).
- **Clean groups** — if a newly created tab ends up inside a group, it's automatically removed from the group. This is event-driven (no periodic sweeps) and only applies to tabs with strong evidence of being user-created (e.g. link-opened tabs, or tabs created via the Bodhi Bar UI), so session restore isn't mass-ungrouped.
- **Group collapsing** — on each tab activation, all groups in the window collapse except the one containing the active tab. This affects the browser's native tab strip and is skipped during the startup/session-restore grace period.

> The in-page bar is injected only on normal `http(s)://` websites — not on browser-restricted pages like `chrome://extensions`, where content scripts can't run. System tabs are still managed by the background rules; they only appear in the bar (as a separate "system" section) when the bar is shown on a normal site.

---

# For developers

## Project structure

The codebase is plain Manifest V3 — content scripts are loaded as browser globals (no module bundler). Sources live under `src/`, grouped by surface; static assets under `assets/`. `manifest.json` stays at the repo root (required).

```
manifest.json           MV3 manifest and permissions
src/
  background.js         service worker
  constants.js          shared: UI constants, IDs, the inline leaf glyph, pin-state helpers
  content/              in-page bar (loaded as content scripts, in manifest order)
  popup/                toolbar popup
  editor/               full-page workspace editor
assets/icons/           extension icons (the green leaf)
tests/                  Node test runner suites + harness
```

| File | Responsibility |
| --- | --- |
| `src/background.js` | Service worker: tab-layout enforcement, UI actions (switch/close/move/group/ungroup), workspace payload generation and JSON downloads. |
| `src/constants.js` | Shared UI constants, IDs, the inline leaf glyph, pin-state helpers (used by content scripts, background, popup, editor). |
| `src/content/content.js` | UI entry point: navigation state and refresh handling. |
| `src/content/render.js` | Bar rendering (Levels 1/2/3), the leaf chip + pin toggle, dynamic layout. |
| `src/content/search.js` | Search state + search popover trigger. |
| `src/content/popover.js` | Group-picker popover + search-results popover. |
| `src/content/drag-drop.js` | Drag & drop for tabs and groups. |
| `src/content/zoom.js` | Zoom-compensated CSS variables and metric updates. |
| `src/content/dom-helpers.js` | Shared DOM construction helpers for the bar. |
| `src/content/messaging.js` | Port handshake + message retry. |
| `src/content/content.css` | All UI styling (bar, tiles, popovers). |
| `src/popup/` | Toolbar popup (`popup.html` / `popup.js` / `popup.css`): workspace management (save/import/export/delete). |
| `src/editor/` | Full-page workspace editor (`editor.html` / `editor.js` / `editor.css`). |
| `assets/icons/` | Extension icons (`leaf-{16,32,48,128}.png`). |

## State management

State lives in `chrome.storage.local`:

- `tz_pinned_by_tab` — per-tab pin state (`{ [tabId]: true }`; absent = collapsed). Dropped when the tab closes.
- `tz_hidden_by_tab` — per-tab hidden state (`{ [tabId]: true }`; absent = visible). Dropped when the tab closes.
- `tz_group_meta` — a `url → { title, color }` map written after each workspace restore. Brave doesn't persist extension-set group metadata across restarts, so on the next startup (≈10 s after session restore completes) Bodhi Bar re-applies group titles and colors to the restored groups. The label in Brave's sidebar/Quick Access may still need a manual click on the group to repaint — a Brave rendering limitation, not addressable via the extension API.

The collapsed/expanded/hidden bar states are pure CSS: `#…:not(.tz-pinned):not(:hover)` shows only the leaf chip; `:hover` or `.tz-pinned` expands it; `.tz-hidden` hides it. The popup→page sync has no message listener — `content.js` watches `chrome.storage.onChanged` for `tz_hidden_by_tab`, so the show/hide toggle takes effect immediately.

## Workspace file format

Exported JSON includes a workspace version field (`wv`, currently `1.0`). Import validates the version and basic schema before saving. Obsolete fields from older versions (e.g. `visibilityMode`, `siteOverrides`, `visibilityRules` from the removed Push/Overlay/Hidden model) are accepted and ignored, so older exports still import correctly.

## Tests

Unit tests run on Node's built-in test runner — no dependencies to install:

```
npm test
```

Because the content scripts are plain browser globals (no module system), the harness in `tests/helpers/harness.js` loads the real source files into a `vm` sandbox with a mocked `chrome` API and a minimal DOM, then exposes the requested top-level symbols for assertions. Test files live in `tests/` and are named `*.test.js`.

## Troubleshooting

**Service worker shows "Inactive"** — verify there are no import errors, confirm `manifest.json` points to `background.js` as the MV3 service worker, and check the extension's service-worker console for errors.

**Empty bar / "No receiver" message** — check the browser console for errors, reload the extension, and verify all files are present.

## Notes

- Manifest V3 service worker + content-script UI, fully MV3-compatible.
- Robust message retry + handshake to reduce "no receiver" issues.
- Best-effort handling for restricted pages and timing edges (BFCache / late injection).

## License

Released under the [MIT License](LICENSE) — © 2026 guidance.studio. Free to use, modify, and distribute.
