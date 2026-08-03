'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/harness');

// M48/M50: on tab activation the tab strip keeps the last two *activations*
// expanded. A slot is either a group or NO_GROUP — the whole ungrouped area,
// pinned tabs included — so landing on a free tab takes a slot like any group.
// The event plumbing (debounce, storage, tabGroups calls) is not reachable from
// the vm harness, so the two decisions it wraps are tested directly.
function loadRecent() {
  return load(
    ['constants.js', 'background.js'],
    ['pushRecentSlot', 'sanitizeSlots', 'planCollapse', 'NO_GROUP', 'RECENT_SLOTS_SESSION_KEY']
  ).exports;
}

const KEEP = 2;
const FREE = -1; // NO_GROUP: any ungrouped or pinned tab

// The sources run inside a `vm` realm, so the arrays/objects they return carry
// that realm's prototypes and would fail a strict deep-equal on identity alone.
// Round-tripping through JSON re-creates them in this realm.
const plain = (value) => JSON.parse(JSON.stringify(value));

// --- pushRecentSlot: the per-window LRU of recent activations --------------

test('pushRecentSlot: the active group goes first, the previous one stays', () => {
  const { pushRecentSlot } = loadRecent();

  const afterA = pushRecentSlot([], 7, KEEP);
  assert.deepEqual(plain(afterA), [7]);

  const afterB = pushRecentSlot(afterA, 3, KEEP);
  assert.deepEqual(plain(afterB), [3, 7], 'the group we came from must remain expanded');
});

test('pushRecentSlot: only the last KEEP activations survive', () => {
  const { pushRecentSlot } = loadRecent();

  const afterC = pushRecentSlot([3, 7], 9, KEEP);
  assert.deepEqual(plain(afterC), [9, 3], 'the third-oldest group collapses');
});

test('pushRecentSlot: re-activating the current slot keeps the previous one', () => {
  const { pushRecentSlot } = loadRecent();

  // Clicking another tab inside the group you are already in must not push the
  // previous slot out of the list.
  assert.deepEqual(plain(pushRecentSlot([3, 7], 3, KEEP)), [3, 7]);
  assert.deepEqual(plain(pushRecentSlot([FREE, 7], FREE, KEEP)), [FREE, 7], 'two free tabs in a row');
});

test('pushRecentSlot: re-activating the previous slot just swaps the order', () => {
  const { pushRecentSlot } = loadRecent();

  assert.deepEqual(plain(pushRecentSlot([3, 7], 7, KEEP)), [7, 3]);
});

test('pushRecentSlot: an ungrouped or pinned tab takes a slot of its own', () => {
  const { pushRecentSlot, NO_GROUP } = loadRecent();

  assert.equal(NO_GROUP, FREE);
  // Every way the browser can say "this tab is in no group" lands on one slot.
  assert.deepEqual(plain(pushRecentSlot([3, 7], FREE, KEEP)), [FREE, 3], 'TAB_GROUP_ID_NONE');
  assert.deepEqual(plain(pushRecentSlot([3, 7], undefined, KEEP)), [FREE, 3], 'missing groupId');
  assert.deepEqual(plain(pushRecentSlot([3, 7], 0, KEEP)), [FREE, 3], 'group ids are positive');
});

test('sanitizeSlots: a dirty stored list is cleaned without inventing a slot', () => {
  const { sanitizeSlots } = loadRecent();

  // storage.session survives worker restarts, so what comes back is not trusted.
  // Garbage is dropped rather than folded into NO_GROUP, which would fabricate a
  // free-tab activation that never happened.
  assert.deepEqual(plain(sanitizeSlots([3, 3, 'x', null, 7, 9], KEEP)), [3, 7]);
  assert.deepEqual(plain(sanitizeSlots([FREE, 'x', 7], KEEP)), [FREE, 7], 'the sentinel is a valid slot');
  assert.deepEqual(plain(sanitizeSlots('nope', KEEP)), []);
  assert.deepEqual(plain(sanitizeSlots(undefined, KEEP)), []);
});

test('pushRecentSlot: a nonsensical cap falls back to a single slot', () => {
  const { pushRecentSlot } = loadRecent();

  assert.deepEqual(plain(pushRecentSlot([3, 7], 9, 0)), [9]);
  assert.deepEqual(plain(pushRecentSlot([3, 7], 9, undefined)), [9]);
});

// --- planCollapse: what to store, what to expand, what to update -----------

const groups = (state) => Object.entries(state).map(([id, collapsed]) => ({ id: Number(id), collapsed }));

test('planCollapse: keeps the recent groups expanded and collapses the rest', () => {
  const { planCollapse } = loadRecent();

  const { recent, keep, updates } = planCollapse(
    groups({ 3: true, 7: true, 9: false }),
    [3, 7]
  );

  assert.deepEqual(plain(recent), [3, 7]);
  assert.deepEqual(plain(keep), [3, 7]);
  assert.deepEqual(
    plain(updates).sort((a, b) => a.id - b.id),
    [{ id: 3, collapsed: false }, { id: 7, collapsed: false }, { id: 9, collapsed: true }]
  );
});

test('planCollapse: the free-tab slot survives, so only one group stays expanded', () => {
  const { planCollapse } = loadRecent();

  const { recent, keep, updates } = planCollapse(
    groups({ 3: false, 7: false }),
    [FREE, 3]
  );

  // Pruning the sentinel here (it is not a live group) would erase the free-tab
  // step and let group 7 stay expanded on the next activation.
  assert.deepEqual(plain(recent), [FREE, 3], 'stored back with the sentinel');
  assert.deepEqual(plain(keep), [3], 'only real groups are expanded');
  assert.deepEqual(plain(updates), [{ id: 7, collapsed: true }]);
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
  const { recent, keep, updates } = planCollapse(groups({ 3: true }), [99, 3]);

  assert.deepEqual(plain(recent), [3]);
  assert.deepEqual(plain(keep), [3]);
  assert.deepEqual(plain(updates), [{ id: 3, collapsed: false }]);
});

test('planCollapse: slot order follows recency, not the browser group order', () => {
  const { planCollapse } = loadRecent();

  const { recent } = planCollapse(groups({ 3: false, 7: false }), [7, 3]);
  assert.deepEqual(plain(recent), [7, 3], 'the pruned list is stored back as the LRU');
});

test('planCollapse: an empty list collapses everything', () => {
  const { planCollapse } = loadRecent();

  const { keep, updates } = planCollapse(groups({ 3: false, 7: true }), []);

  assert.deepEqual(plain(keep), []);
  assert.deepEqual(plain(updates), [{ id: 3, collapsed: true }]);
});

test('planCollapse: malformed input is survivable', () => {
  const { planCollapse } = loadRecent();

  assert.deepEqual(plain(planCollapse(undefined, [3])), { recent: [], keep: [], updates: [] });
  assert.deepEqual(plain(planCollapse([{ collapsed: true }, null], [3])), { recent: [], keep: [], updates: [] });
  assert.deepEqual(
    plain(planCollapse(groups({ 3: false }), undefined)),
    { recent: [], keep: [], updates: [{ id: 3, collapsed: true }] }
  );
});

// --- The reported sequences, end to end over the two pure decisions --------

function walker(loaded, live) {
  const { pushRecentSlot, planCollapse } = loaded;
  let recent = [];

  // Returns the ids of the groups left expanded after activating `slot`.
  return (slot) => {
    recent = pushRecentSlot(recent, slot, KEEP);
    const plan = planCollapse(groups(live), recent);
    for (const u of plan.updates) live[u.id] = u.collapsed;
    recent = plan.recent;
    return Object.entries(live).filter(([, collapsed]) => !collapsed).map(([id]) => Number(id));
  };
}

test('walking A → B → C keeps two groups expanded at a time', () => {
  const activate = walker(loadRecent(), { 1: true, 2: true, 3: true });

  assert.deepEqual(activate(1), [1], 'first click: only A expanded');
  assert.deepEqual(activate(2), [1, 2], 'A stays expanded when moving to B');
  assert.deepEqual(activate(3), [2, 3], 'A collapses once a third group is used');
});

test('A → B → free tab collapses A', () => {
  const activate = walker(loadRecent(), { 1: true, 2: true });

  assert.deepEqual(activate(1), [1]);
  assert.deepEqual(activate(2), [1, 2]);
  assert.deepEqual(activate(FREE), [2], 'the free tab takes A out of the list');
});

test('A → free tab → B collapses A', () => {
  const activate = walker(loadRecent(), { 1: true, 2: true });

  assert.deepEqual(activate(1), [1]);
  assert.deepEqual(activate(FREE), [1], 'one step back is still A, so A stays open');
  assert.deepEqual(activate(2), [2], 'the second activation away from A collapses it');
});

test('staying among free tabs never collapses the last group', () => {
  const activate = walker(loadRecent(), { 1: true });

  assert.deepEqual(activate(1), [1]);
  assert.deepEqual(activate(FREE), [1]);
  assert.deepEqual(activate(FREE), [1], 'consecutive free tabs are one slot');
});

test('the session key is the one the service worker reads back', () => {
  const { RECENT_SLOTS_SESSION_KEY } = loadRecent();
  assert.equal(RECENT_SLOTS_SESSION_KEY, 'recentSlotsByWindow');
});
