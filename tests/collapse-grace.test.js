'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/harness');

// M49: the group-collapse policy was skipped on the first tab click after every
// idle pause. The listener judged the startup grace synchronously, and in MV3
// that click is often the event that re-evaluates the service worker — at which
// point the in-memory clock has just been reset to "now" and the persisted one
// (M47) has not been read back yet. The guard now runs inside the debounced
// callback, after the clock resolves; the two decisions behind it are here.
function loadGrace() {
  return load(
    ['constants.js', 'background.js'],
    ['shouldApplyCollapsePolicy', 'resolveStartupAt', 'STARTUP_GRACE_MS']
  ).exports;
}

const VALID = { windowId: 12, tabId: 34 };

// --- shouldApplyCollapsePolicy -------------------------------------------

test('shouldApplyCollapsePolicy: runs on a normal activation outside the grace', () => {
  const { shouldApplyCollapsePolicy } = loadGrace();
  assert.equal(shouldApplyCollapsePolicy({ inGrace: false, ...VALID }), true);
});

test('shouldApplyCollapsePolicy: suspended during the startup grace', () => {
  const { shouldApplyCollapsePolicy } = loadGrace();

  // Session restore must not have its groups repainted while tabs are still
  // being recreated.
  assert.equal(shouldApplyCollapsePolicy({ inGrace: true, ...VALID }), false);
});

test('shouldApplyCollapsePolicy: rejects missing or sentinel ids', () => {
  const { shouldApplyCollapsePolicy } = loadGrace();

  assert.equal(shouldApplyCollapsePolicy({ inGrace: false, windowId: -1, tabId: 34 }), false, 'WINDOW_ID_NONE');
  assert.equal(shouldApplyCollapsePolicy({ inGrace: false, windowId: 12, tabId: -1 }), false, 'TAB_ID_NONE');
  assert.equal(shouldApplyCollapsePolicy({ inGrace: false, windowId: null, tabId: 34 }), false);
  assert.equal(shouldApplyCollapsePolicy({ inGrace: false, windowId: 12 }), false, 'no tabId');
  assert.equal(shouldApplyCollapsePolicy({ inGrace: false, windowId: '12', tabId: 34 }), false, 'not a number');
  assert.equal(shouldApplyCollapsePolicy(), false, 'no argument at all');
});

// --- when the grace is (re)started ---------------------------------------
//
// onStartup always restarts it — that is the real browser start. onInstalled
// also fires on a plain reload of the unpacked extension, so it keeps whatever
// storage.session already holds; the decision is resolveStartupAt's.

test('a service-worker wake-up leaves the policy running', () => {
  const { shouldApplyCollapsePolicy, resolveStartupAt, STARTUP_GRACE_MS } = loadGrace();

  const browserStart = 1_000_000;
  const click = browserStart + 5 * 60_000; // worker woken by the click, 5 min in

  const startupAt = resolveStartupAt(browserStart, click);
  const inGrace = (click - startupAt) < STARTUP_GRACE_MS;

  assert.equal(inGrace, false, 'the grace elapsed long ago; the wake-up must not restart it');
  assert.equal(shouldApplyCollapsePolicy({ inGrace, ...VALID }), true);
});

test('reloading the extension mid-session does not restart the grace', () => {
  const { shouldApplyCollapsePolicy, resolveStartupAt, STARTUP_GRACE_MS } = loadGrace();

  const browserStart = 1_000_000;
  const reload = browserStart + 2 * 60 * 60_000; // brave://extensions → reload, 2h in

  // onInstalled resolves against the stored timestamp instead of stamping "now",
  // so the freshly loaded build is testable immediately.
  const startupAt = resolveStartupAt(browserStart, reload);
  const inGrace = (reload - startupAt) < STARTUP_GRACE_MS;

  assert.equal(startupAt, browserStart);
  assert.equal(shouldApplyCollapsePolicy({ inGrace, ...VALID }), true, 'no 20s dead zone after a reload');
});

test('a real browser start still suspends the policy', () => {
  const { shouldApplyCollapsePolicy, resolveStartupAt, STARTUP_GRACE_MS } = loadGrace();

  const now = 1_000_000;

  // storage.session is cleared when the browser closes, so nothing is stored on
  // the first worker start of a session (and on a first install).
  const startupAt = resolveStartupAt(undefined, now);
  const duringRestore = now + 3_000;
  const inGrace = (duringRestore - startupAt) < STARTUP_GRACE_MS;

  assert.equal(startupAt, now);
  assert.equal(inGrace, true);
  assert.equal(
    shouldApplyCollapsePolicy({ inGrace, ...VALID }),
    false,
    'session-restore tabs keep the group state they were restored with'
  );
});

test('the grace ends on its own after STARTUP_GRACE_MS', () => {
  const { shouldApplyCollapsePolicy, STARTUP_GRACE_MS } = loadGrace();

  const startupAt = 1_000_000;
  const after = startupAt + STARTUP_GRACE_MS + 1;

  assert.equal(shouldApplyCollapsePolicy({ inGrace: (after - startupAt) < STARTUP_GRACE_MS, ...VALID }), true);
});
