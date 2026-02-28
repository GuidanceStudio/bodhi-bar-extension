# AIDER.md

## What this repo is
Bodhi Bar: Chromium extension (MV3) for stable tab management, in-page tab bar, and workspace snapshots. Enforces predictable tab order (pinned → groups → ungrouped) and provides a fast UI for navigation and workspace management.

## Invariants / pitfalls
- **UI Injection**: bar only injected into `http(s)` pages, not `chrome://` or `about:`.
- **Service Worker**: MV3 service workers can go inactive; messaging uses retry logic — don't bypass it.
- **Tab Order**: background script continuously enforces tab order; don't rely on manual ordering.
- **Auto-ungrouping**: new tabs opened inside groups are automatically ungrouped to keep groups "clean".
- **Group Collapsing**: native tab groups are collapsed/expanded on tab activation.
- **Zoom**: bar uses zoom-compensated metrics; ensure `zoom.js` is called on resize/zoom events.
- **Visibility**: per-tab visibility stored in `chrome.storage.local` (`tz_visibility_mode`); rules in `tz_visibility_rules`.
- **Overrides**: CSS overrides stored in `tz_site_overrides`, applied dynamically by `site_overrides.js`.
- **Group metadata**: after workspace restore, `reapplyGroupMeta()` fires after ~10s to re-apply titles/colors — Brave does not persist extension-set group metadata across restarts.
