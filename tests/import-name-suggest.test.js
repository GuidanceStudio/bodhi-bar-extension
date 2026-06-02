'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/harness');

// M34: on an import name collision, "Keep both" pre-fills the name field with
// the first free "<base> N". suggestFreeName is the pure helper behind that.

function loadHelper() {
  // readyState 'loading' so popup.js registers a DOMContentLoaded listener
  // instead of running initPopup() immediately.
  return load(['constants.js', 'popup.js'], ['suggestFreeName'], { readyState: 'loading' }).exports;
}

test('suggestFreeName: starts at "<base> 2" when only the base is taken', () => {
  const { suggestFreeName } = loadHelper();
  assert.equal(suggestFreeName('sead', { sead: {} }), 'sead 2');
});

test('suggestFreeName: skips taken numbered names', () => {
  const { suggestFreeName } = loadHelper();
  assert.equal(suggestFreeName('sead', { sead: {}, 'sead 2': {} }), 'sead 3');
});

test('suggestFreeName: tolerates an empty/whitespace base', () => {
  const { suggestFreeName } = loadHelper();
  assert.equal(suggestFreeName('   ', {}), 'Workspace 2');
});

test('suggestFreeName: a free base still returns a numbered suggestion (caller only uses it on conflict)', () => {
  const { suggestFreeName } = loadHelper();
  assert.equal(suggestFreeName('fresh', {}), 'fresh 2');
});
