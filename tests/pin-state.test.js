'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/harness');

function loadPin() {
  return load(['constants.js'], ['isTabPinned', 'nextPinnedMap']).exports;
}

// Values returned by code running in the vm sandbox carry the sandbox's
// Object.prototype, which trips deepStrictEqual's realm check. Re-spread into
// this realm so structural comparison is what's actually tested.
const plain = (obj) => ({ ...obj });

// M15: per-tab pin state. A tab is pinned only if explicitly stored `true`;
// the default (absent key) is unpinned (collapsed leaf). Unpinning deletes the
// key so the common default costs no storage.

test('isTabPinned: only an explicit true counts as pinned', () => {
  const { isTabPinned } = loadPin();
  assert.equal(isTabPinned({ 5: true }, 5), true);
  assert.equal(isTabPinned({ 5: true }, '5'), true, 'tabId is coerced to string');
  assert.equal(isTabPinned({}, 5), false, 'absent key = unpinned (default)');
  assert.equal(isTabPinned({ 5: false }, 5), false);
  assert.equal(isTabPinned(null, 5), false, 'missing map = unpinned');
});

test('nextPinnedMap: toggles pinned, storing true and deleting on unpin', () => {
  const { nextPinnedMap } = loadPin();

  const pinned = nextPinnedMap({}, 7);
  assert.deepEqual(plain(pinned), { 7: true }, 'pinning stores true');

  const unpinned = nextPinnedMap(pinned, 7);
  assert.deepEqual(plain(unpinned), {}, 'unpinning deletes the key (default needs no storage)');
});

test('nextPinnedMap: pure (does not mutate input) and preserves other tabs', () => {
  const { nextPinnedMap } = loadPin();
  const input = { 1: true };

  const out = nextPinnedMap(input, 2);

  assert.deepEqual(input, { 1: true }, 'input is not mutated');
  assert.deepEqual(plain(out), { 1: true, 2: true }, 'other pinned tabs are preserved');
});
