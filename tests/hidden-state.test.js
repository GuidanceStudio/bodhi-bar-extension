'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/harness');

function loadHidden() {
  return load(['constants.js'], ['isTabHidden', 'nextHiddenMap']).exports;
}

// See note in pin-state.test.js: values returned from the vm sandbox carry the
// sandbox's Object.prototype, so re-spread before structural comparison.
const plain = (obj) => ({ ...obj });

// M18: per-tab hidden state. A tab's bar is hidden only if explicitly stored
// `true`; the default (absent key) is visible. Set via double-click on the
// leaf; cleared from the popup toggle.

test('isTabHidden: only an explicit true counts as hidden', () => {
  const { isTabHidden } = loadHidden();
  assert.equal(isTabHidden({ 5: true }, 5), true);
  assert.equal(isTabHidden({ 5: true }, '5'), true, 'tabId coerced to string');
  assert.equal(isTabHidden({}, 5), false, 'absent key = visible (default)');
  assert.equal(isTabHidden({ 5: false }, 5), false);
  assert.equal(isTabHidden(null, 5), false, 'missing map = visible');
});

test('nextHiddenMap: explicit set stores true, clear deletes the key', () => {
  const { nextHiddenMap } = loadHidden();

  const hidden = nextHiddenMap({}, 7, true);
  assert.deepEqual(plain(hidden), { 7: true }, 'hiding stores true');

  const shown = nextHiddenMap(hidden, 7, false);
  assert.deepEqual(plain(shown), {}, 'showing deletes the key (default needs no storage)');
});

test('nextHiddenMap: pure (does not mutate input) and preserves other tabs', () => {
  const { nextHiddenMap } = loadHidden();
  const input = { 1: true };

  const out = nextHiddenMap(input, 2, true);

  assert.deepEqual(input, { 1: true }, 'input is not mutated');
  assert.deepEqual(plain(out), { 1: true, 2: true }, 'other hidden tabs preserved');
});
