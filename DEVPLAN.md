# Devplan — Fix workspace restore duplicating groups

## Problem

When restoring a workspace, tab groups get duplicated (tripled in the reported case).
The browser's tab strip shows e.g. Tech×3, Office×3, Comms×3 instead of one of each.

Root causes identified in `background.js` `APPLY_WORKSPACE` handler (lines 1127-1279):

1. **Placeholder tab never removed** — a "new tab" is created to prevent the window from reaching 0 tabs, but it's only moved to the end, never deleted.
2. **No verification that old tabs were actually closed** — `chrome.tabs.remove()` can fail silently (e.g. `beforeunload` dialogs), leaving old groups alive while new ones are created on top.
3. **No concurrency guard** — nothing prevents the restore from running multiple times in parallel if triggered rapidly.
4. **No retry/force-close loop** — if some tabs survive the first `remove()` call, nothing tries again.

---

## M1 — Add concurrency guard to APPLY_WORKSPACE ✅

- [x] Add a module-level `restoreInProgress` flag in `background.js`
- [x] At the start of `APPLY_WORKSPACE`, check the flag; if already running, respond with `{ ok: false, error: 'Restore already in progress' }` and return
- [x] Set the flag to `true` at the start, `false` in a `finally` block
- [x] In `popup.js`, disable the restore button after confirmation click to prevent double-sends

## M2 — Verify tab closure before creating new tabs ✅

- [x] After `chrome.tabs.remove(toClose)`, re-query tabs in the window
- [x] If any non-placeholder tabs still exist (survived `beforeunload` etc.), retry `chrome.tabs.remove()` once more
- [x] If tabs still survive after retry, abort the restore and respond with a clear error: `'Could not close existing tabs — close them manually and retry'`

## M3 — Clean up placeholder tab after restore ✅

- [x] After all groups are created and collapsed, remove the placeholder tab with `chrome.tabs.remove(placeholderTabId)`
- [x] Wrap in try/catch (it may already be gone if the browser auto-closed it)
- [x] This replaces the current "move placeholder to end" logic
