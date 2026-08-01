'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/harness');

// M47: a tab opened from a link inside a group must be ejected from that group.
// The two decisions below are the ones that failed in the field, so they are
// pulled out of the event plumbing and tested directly.
function loadEject() {
  return load(
    ['constants.js', 'background.js'],
    ['resolveStartupAt', 'shouldEjectFromGroup', 'STARTUP_AT_SESSION_KEY']
  ).exports;
}

// resolveStartupAt decides whether the 20s startup grace restarts. In MV3 the
// service worker is re-evaluated on every wake-up, so restarting the grace there
// suppressed every ejection for 20s — the root cause of the M46 regression.

test('resolveStartupAt: a stored timestamp survives a service-worker wake-up', () => {
  const { resolveStartupAt } = loadEject();
  const browserStart = 1_000_000;
  const wakeUp = browserStart + 5 * 60_000; // worker restarts 5 min into the session

  assert.equal(
    resolveStartupAt(browserStart, wakeUp),
    browserStart,
    'the grace must keep elapsing from the real browser start, not from the wake-up'
  );
});

test('resolveStartupAt: no stored timestamp means this is the session start', () => {
  const { resolveStartupAt } = loadEject();
  const now = 1_000_000;

  assert.equal(resolveStartupAt(undefined, now), now, 'storage.session is cleared when the browser closes');
  assert.equal(resolveStartupAt(null, now), now);
});

test('resolveStartupAt: nonsensical stored values fall back to now', () => {
  const { resolveStartupAt } = loadEject();
  const now = 1_000_000;

  assert.equal(resolveStartupAt('nope', now), now, 'NaN');
  assert.equal(resolveStartupAt(0, now), now, 'zero');
  assert.equal(resolveStartupAt(-5, now), now, 'negative');
  assert.equal(resolveStartupAt(now + 60_000, now), now, 'in the future (clock change)');
  assert.equal(resolveStartupAt(String(now - 1000), now), now - 1000, 'numeric string is accepted');
});

// shouldEjectFromGroup: the guard that decides whether to call tabs.ungroup.

const grouped = { id: 1, groupId: 7, pinned: false };

test('shouldEjectFromGroup: an eligible grouped tab outside the grace is ejected', () => {
  const { shouldEjectFromGroup } = loadEject();
  assert.equal(shouldEjectFromGroup({ inGrace: false, eligible: true, tab: grouped }), true);
});

test('shouldEjectFromGroup: the startup grace protects restored session tabs', () => {
  const { shouldEjectFromGroup } = loadEject();
  assert.equal(shouldEjectFromGroup({ inGrace: true, eligible: true, tab: grouped }), false);
});

test('shouldEjectFromGroup: only tracked (opener-created) tabs are touched', () => {
  const { shouldEjectFromGroup } = loadEject();
  assert.equal(shouldEjectFromGroup({ inGrace: false, eligible: false, tab: grouped }), false);
});

test('shouldEjectFromGroup: ungrouped, pinned and missing tabs are left alone', () => {
  const { shouldEjectFromGroup } = loadEject();
  const base = { inGrace: false, eligible: true };

  assert.equal(shouldEjectFromGroup({ ...base, tab: { ...grouped, groupId: -1 } }), false, 'already ungrouped');
  assert.equal(shouldEjectFromGroup({ ...base, tab: { ...grouped, pinned: true } }), false, 'pinned');
  assert.equal(shouldEjectFromGroup({ ...base, tab: null }), false, 'tab gone');
  assert.equal(shouldEjectFromGroup({ ...base, tab: { ...grouped, groupId: undefined } }), false, 'no groupId');
});

test('shouldEjectFromGroup: honours the browser-provided "no group" id', () => {
  const { shouldEjectFromGroup } = loadEject();
  assert.equal(
    shouldEjectFromGroup({ inGrace: false, eligible: true, tab: { groupId: 0 }, noneGroupId: 0 }),
    false,
    'group id 0 is "none" when the browser says so'
  );
});
