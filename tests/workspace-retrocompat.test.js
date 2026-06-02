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

// M17: be lenient — accept any version and ignore unknown fields, so older
// AND newer workspace files stay compatible.

test('a future version with unknown fields is accepted, extras preserved', () => {
  const { normalizeImportedWorkspaceJson } = loadValidator();

  const res = normalizeImportedWorkspaceJson({
    wv: '9.9',
    name: 'Future',
    payload: { pinnedTabs: [], allTabGroups: [], somethingNew: { a: 1 } },
  });

  assert.equal(res.ok, true, res.error || 'future versions must be accepted');
  assert.equal(res.payload.somethingNew.a, 1, 'unknown fields are passed through, not stripped');
});

test('a bare payload (no { wv, payload } wrapper) is accepted', () => {
  const { normalizeImportedWorkspaceJson } = loadValidator();

  const res = normalizeImportedWorkspaceJson({ pinnedTabs: [], allTabGroups: [] });

  assert.equal(res.ok, true, res.error || 'bare payload should be accepted');
  assert.ok(Array.isArray(res.payload.pinnedTabs));
});

test('a non-object (e.g. array or string) is still rejected', () => {
  const { normalizeImportedWorkspaceJson } = loadValidator();

  assert.equal(normalizeImportedWorkspaceJson('nope').ok, false);
  assert.equal(normalizeImportedWorkspaceJson([1, 2, 3]).ok, false);
});

// M33: custom tab labels edited in the editor are stored as `title` in the
// payload. Export serializes the payload verbatim, so the round-trip guarantee
// is that import preserves `title` on both pinned and grouped tabs untouched.

test('custom tab titles round-trip through import (pinned + grouped)', () => {
  const { normalizeImportedWorkspaceJson } = loadValidator();

  const exported = {
    wv: '1.0',
    name: 'Labelled',
    payload: {
      pinnedTabs: [{ url: 'https://mail.google.com', title: 'Inbox' }],
      allTabGroups: [
        { title: 'AI', color: 'purple', tabs: [{ url: 'https://chatgpt.com', title: 'My ChatGPT' }] },
      ],
    },
  };

  const res = normalizeImportedWorkspaceJson(exported);

  assert.equal(res.ok, true, res.error || 'should be accepted');
  assert.equal(res.payload.pinnedTabs[0].title, 'Inbox', 'pinned tab label preserved');
  assert.equal(res.payload.allTabGroups[0].tabs[0].title, 'My ChatGPT', 'grouped tab label preserved');
});
