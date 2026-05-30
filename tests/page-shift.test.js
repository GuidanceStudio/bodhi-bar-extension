'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/harness');

function loadPageShift() {
  return load(
    ['constants.js', 'page-shift.js'],
    ['applyPageShift', 'VISIBILITY_MODES', 'setVisibilityMode'],
  );
}

// M14 invariant: the bar is an overlay; the page is NEVER reflowed.
// These tests are written so they fail against the legacy PUSH machinery
// (red) and pass once applyPageShift becomes a no-op (green).

test('applyPageShift never reflows the body (no padding, no injected CSS)', () => {
  const tz = loadPageShift();
  // Force the legacy "push" global to prove no path can reflow the page.
  tz.window.currentVisibilityMode = (tz.exports.VISIBILITY_MODES || {}).PUSH || 'push';

  tz.exports.applyPageShift();

  assert.equal(tz.document.body.style.getPropertyValue('padding-top'), '');
  assert.equal(tz.document.body.style.getPropertyValue('padding-bottom'), '');
  assert.equal(tz.document.body.style.getPropertyValue('box-sizing'), '');
  // No safe-areas <style> (or anything else) injected into <head>.
  assert.equal(tz.document.head.children.length, 0, 'nothing injected into <head>');
});

test('applyPageShift never schedules header shifting or fires a resize', () => {
  const tz = loadPageShift();
  tz.window.currentVisibilityMode = (tz.exports.VISIBILITY_MODES || {}).PUSH || 'push';

  tz.exports.applyPageShift();

  assert.equal(tz.counters.raf, 0, 'no requestAnimationFrame (no header shift)');
  assert.equal(tz.counters.dispatched, 0, 'no synthetic resize event');
});
