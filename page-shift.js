/**
 * PAGE-SHIFT.JS — overlay-only layout.
 *
 * The bar floats over the page as an overlay; the page is NEVER reflowed.
 * Historically this file also supported a PUSH mode that pushed content down:
 * body padding, injected safe-area CSS, fixed/sticky header shifting and
 * bottom-clipper padding. That machinery has been removed.
 *
 * `applyPageShift()` is kept as a no-op so the existing call sites in
 * content.js / render.js / zoom.js stay valid without churn.
 */

// Shared flag to prevent resize loops (read by content.js and render.js).
// Uses `var` because content scripts share a scope and `let`/`const` would
// throw on re-declaration if the script runs twice.
if (typeof isInternalResize === 'undefined') {
  var isInternalResize = false; // eslint-disable-line no-var
}

// Single behavior: the bar is always an overlay. Kept as a global because
// render.js / zoom.js still branch on it (removed in a later milestone).
window.currentVisibilityMode = VISIBILITY_MODES.OVERLAY;

// Retained as a no-op shim: callers (content.js message handler) may still
// invoke it, but there is only one mode now and currentVisibilityMode is
// already pinned to OVERLAY above, so there is nothing to do.
function setVisibilityMode() {}

// Overlay never reflows the page — there is nothing to shift.
function applyPageShift() {}
