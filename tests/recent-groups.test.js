'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/harness');

// M48: on tab activation the tab strip keeps the active tab's group AND the
// previously active tab's group expanded. The event plumbing (debounce, storage,
// tabGroups calls) is not reachable from the vm harness, so the two decisions it
// wraps are pulled out and tested directly.
function loadRecent() {
  return load(
    ['constants.js', 'background.js'],
    ['pushRecentGroup', 'planCollapse', 'RECENT_GROUPS_SESSION_KEY']
  ).exports;
}

const KEEP = 2;
const NONE = -1; // chrome.tabGroups.TAB_GROUP_ID_NONE

// The sources run inside a `vm` realm, so the arrays/objects they return carry
// that realm's prototypes and would fail a strict deep-equal on identity alone.
// Round-tripping through JSON re-creates them in this realm.
const plain = (value) => JSON.parse(JSON.stringify(value));

// --- pushRecentGroup: the per-window LRU of recently used groups -----------

test('pushRecentGroup: the active group goes first, the previous one stays', () => {
  const { pushRecentGroup } = loadRecent();

  const afterA = pushRecentGroup([], 7, KEEP);
  assert.deepEqual(plain(afterA), [7]);

  const afterB = pushRecentGroup(afterA, 3, KEEP);
  assert.deepEqual(plain(afterB), [3, 7], 'the group we came from must remain expanded');
});

test('pushRecentGroup: only the last KEEP groups survive', () => {
  const { pushRecentGroup } = loadRecent();

  const afterC = pushRecentGroup([3, 7], 9, KEEP);
  assert.deepEqual(plain(afterC), [9, 3], 'the third-oldest group collapses');
});

test('pushRecentGroup: re-activating the current group keeps the previous one', () => {
  const { pushRecentGroup } = loadRecent();

  // Clicking another tab inside the group you are already in must not push the
  // previous group out of the list.
  assert.deepEqual(plain(pushRecentGroup([3, 7], 3, KEEP)), [3, 7]);
});

test('pushRecentGroup: re-activating the previous group just swaps the order', () => {
  const { pushRecentGroup } = loadRecent();

  assert.deepEqual(plain(pushRecentGroup([3, 7], 7, KEEP)), [7, 3]);
});

test('pushRecentGroup: an ungrouped tab leaves the list alone', () => {
  const { pushRecentGroup } = loadRecent();

  // Pre-M48 this collapsed every group; now the group you came from stays open.
  assert.deepEqual(plain(pushRecentGroup([3, 7], NONE, KEEP)), [3, 7], 'TAB_GROUP_ID_NONE');
  assert.deepEqual(plain(pushRecentGroup([3, 7], undefined, KEEP)), [3, 7], 'missing groupId');
  assert.deepEqual(plain(pushRecentGroup([3, 7], 0, KEEP)), [3, 7], 'group ids are positive');
});

test('pushRecentGroup: a dirty stored list is sanitized and capped', () => {
  const { pushRecentGroup } = loadRecent();

  // storage.session survives worker restarts, so what comes back is not trusted.
  assert.deepEqual(plain(pushRecentGroup([3, 3, NONE, 'x', null, 7, 9], null, KEEP)), [3, 7]);
  assert.deepEqual(plain(pushRecentGroup('nope', null, KEEP)), []);
  assert.deepEqual(plain(pushRecentGroup(undefined, 5, KEEP)), [5]);
});

test('pushRecentGroup: a nonsensical cap falls back to a single group', () => {
  const { pushRecentGroup } = loadRecent();

  assert.deepEqual(plain(pushRecentGroup([3, 7], 9, 0)), [9]);
  assert.deepEqual(plain(pushRecentGroup([3, 7], 9, undefined)), [9]);
});

// --- planCollapse: which groups to collapse, which keep-ids are still alive -

const groups = (state) => Object.entries(state).map(([id, collapsed]) => ({ id: Number(id), collapsed }));

test('planCollapse: keeps the keep-list expanded and collapses the rest', () => {
  const { planCollapse } = loadRecent();

  const { keep, updates } = planCollapse(
    groups({ 3: true, 7: true, 9: false }),
    [3, 7]
  );

  assert.deepEqual(plain(keep), [3, 7]);
  assert.deepEqual(
    plain(updates).sort((a, b) => a.id - b.id),
    [{ id: 3, collapsed: false }, { id: 7, collapsed: false }, { id: 9, collapsed: true }]
  );
});

test('planCollapse: groups already in the wanted state are not touched', () => {
  const { planCollapse } = loadRecent();

  const { updates } = planCollapse(
    groups({ 3: false, 7: false, 9: true }),
    [3, 7]
  );

  assert.deepEqual(plain(updates), [], 'no redundant tabGroups.update calls');
});

test('planCollapse: ids of groups that no longer exist are dropped', () => {
  const { planCollapse } = loadRecent();

  // A closed group would otherwise hold one of the KEEP slots and leave a single
  // group expanded for the rest of the session.
  const { keep, updates } = planCollapse(groups({ 3: true }), [99, 3]);

  assert.deepEqual(plain(keep), [3]);
  assert.deepEqual(plain(updates), [{ id: 3, collapsed: false }]);
});

test('planCollapse: keep order follows recency, not the browser group order', () => {
  const { planCollapse } = loadRecent();

  const { keep } = planCollapse(groups({ 3: false, 7: false }), [7, 3]);
  assert.deepEqual(plain(keep), [7, 3], 'the pruned list is stored back as the LRU');
});

test('planCollapse: an empty keep-list collapses everything', () => {
  const { planCollapse } = loadRecent();

  const { keep, updates } = planCollapse(groups({ 3: false, 7: true }), []);

  assert.deepEqual(plain(keep), []);
  assert.deepEqual(plain(updates), [{ id: 3, collapsed: true }]);
});

test('planCollapse: malformed input is survivable', () => {
  const { planCollapse } = loadRecent();

  assert.deepEqual(plain(planCollapse(undefined, [3])), { keep: [], updates: [] });
  assert.deepEqual(plain(planCollapse([{ collapsed: true }, null], [3])), { keep: [], updates: [] });
  assert.deepEqual(plain(planCollapse(groups({ 3: false }), undefined)), { keep: [], updates: [{ id: 3, collapsed: true }] });
});

// --- The reported scenario, end to end over the two pure decisions ---------

test('walking A → B → C keeps two groups expanded at a time', () => {
  const { pushRecentGroup, planCollapse } = loadRecent();

  const live = { 1: true, 2: true, 3: true }; // A, B, C — all collapsed to start
  let recent = [];

  const activate = (gid) => {
    recent = pushRecentGroup(recent, gid, KEEP);
    const { keep, updates } = planCollapse(groups(live), recent);
    for (const u of updates) live[u.id] = u.collapsed;
    recent = keep;
    return Object.entries(live).filter(([, c]) => !c).map(([id]) => Number(id));
  };

  assert.deepEqual(activate(1), [1], 'first click: only A expanded');
  assert.deepEqual(activate(2), [1, 2], 'A stays expanded when moving to B');
  assert.deepEqual(activate(3), [2, 3], 'A collapses only when a third group is used');
  assert.deepEqual(activate(NONE), [2, 3], 'an ungrouped tab collapses nothing');
  assert.deepEqual(activate(2), [2, 3], 'going back to B keeps C expanded');
});

test('the session key is the one the service worker reads back', () => {
  const { RECENT_GROUPS_SESSION_KEY } = loadRecent();
  assert.equal(RECENT_GROUPS_SESSION_KEY, 'recentGroupsByWindow');
});
