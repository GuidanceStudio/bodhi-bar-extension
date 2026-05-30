'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/harness');

// M16: the visibility-mode / site-overrides / visibility-rules features were
// removed. Workspaces saved by older versions still carry those fields; import
// validation must ACCEPT them (and they are simply ignored on restore), never
// reject them.

function loadValidator() {
  // readyState 'loading' so popup.js registers a DOMContentLoaded listener
  // instead of running initPopup() immediately.
  return load(
    ['constants.js', 'popup.js'],
    ['normalizeImportedWorkspaceJson'],
    { readyState: 'loading' },
  ).exports;
}

test('a legacy workspace with siteOverrides + visibilityRules is accepted', () => {
  const { normalizeImportedWorkspaceJson } = loadValidator();

  const legacy = {
    wv: '1.0',
    name: 'Old WS',
    payload: {
      pinnedTabs: [{ url: 'https://a.test', visibilityMode: 'hidden' }],
      allTabGroups: [{ title: 'G', color: 'blue', tabs: [{ url: 'https://b.test', visibilityMode: 'overlay' }] }],
      siteOverrides: { 'a.test': '#x{display:none}' },
      visibilityRules: [{ pattern: '*a.test*', mode: 'hidden' }],
    },
  };

  const res = normalizeImportedWorkspaceJson(legacy);

  assert.equal(res.ok, true, res.error || 'should be accepted');
  assert.equal(res.payload.pinnedTabs.length, 1);
});

test('a current workspace without the removed fields is accepted', () => {
  const { normalizeImportedWorkspaceJson } = loadValidator();

  const res = normalizeImportedWorkspaceJson({
    wv: '1.0',
    payload: { pinnedTabs: [], allTabGroups: [] },
  });

  assert.equal(res.ok, true, res.error || 'should be accepted');
});
