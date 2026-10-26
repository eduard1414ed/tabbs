import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSpaceSession,
  isSpaceSessionKey,
  resolveSpaces,
  spaceIcon,
  linkSpaces,
  enableCandidates,
  planEnable,
  needsFirstSpace,
  neighborSpace,
  groupTitles,
  matchGroups,
  tabTargets,
  regroupPlan,
  windowSpace,
  pickSpaceTab,
  adjacentSpace,
  reorderSpaces,
  swipeStep,
  SWIPE,
  NO_GROUP,
} from '../extension/lib/spaces.js';
import { buildTree } from '../extension/lib/tree.js';

// Ed's tree after the Arc import: favorites, Work's links at the top, Watch and Japanese as folders.
const tree = buildTree({
  id: 'root',
  children: [
    { id: 'fav', title: 'Избранное', children: [{ id: 't1', title: 'Calendar', url: 'https://calendar.google.com/' }] },
    { id: 'drive', title: 'Drive', url: 'https://drive.google.com/' },
    { id: 'podcast', title: '❤️ Подкаст', children: [{ id: 'b1', title: 'Сайт', url: 'https://podcast.example.com/' }] },
    { id: 'watch', title: '🎬 Watch', children: [{ id: 'w1', title: 'YouTube', url: 'https://youtube.com/' }] },
    { id: 'jp', title: '🇯🇵 Japanese', children: [] },
  ],
});

// Shaped like chrome.tabs.Tab.
const tab = (id, index, extra = {}) => ({ id, windowId: 1, index, groupId: NO_GROUP, url: `https://site${id}.com/`, ...extra });

test('session records of spaces are read back; other keys are left alone', () => {
  const parsed = parseSpaceSession({
    'spaceGroup:17': 'watch',
    'spaceOf:3': 'work',
    'spaceTab:3:work': 42,
    lastSpace: 'work',
    'tab:drive': 5,
    'spaceGroup:x': 'bad',
  });
  assert.deepEqual([...parsed.groupSpace], [[17, 'watch']]);
  assert.deepEqual([...parsed.current], [[3, 'work']]);
  assert.deepEqual([...parsed.lastTabs], [['spaceTab:3:work', 42]]);
  assert.equal(parsed.last, 'work');
  assert.ok(isSpaceSessionKey('spaceOf:3'));
  assert.ok(isSpaceSessionKey('lastSpace'));
  assert.ok(!isSpaceSessionKey('tab:drive'));
});

test('spaces come in the stored order; gone folders and the favorites are skipped', () => {
  const { list, stray } = resolveSpaces(tree, ['jp', 'gone', 'watch', 'fav', 'drive'], 'fav');
  assert.deepEqual(list.map((space) => space.id), ['jp', 'watch']);
  assert.deepEqual(stray.map((node) => node.id), ['drive', 'podcast']);
});

test('a space icon is its pictogram, else the emoji of its name, else its first letter', () => {
  const [, , podcast] = tree.children;
  assert.deepEqual(spaceIcon(podcast, 'heart'), { pictogram: 'heart' });
  assert.deepEqual(spaceIcon({ title: 'дом', emoji: null }, 'house'), { pictogram: 'house' });
  assert.deepEqual(spaceIcon(podcast), { emoji: '❤️' });
  assert.deepEqual(spaceIcon({ title: 'дом', emoji: null }), { letter: 'Д' });
  assert.deepEqual(spaceIcon({ title: '', emoji: null }), { letter: '•' });
});

test('links belong to their space, stray links to the first one, tiles to none', () => {
  const spaces = resolveSpaces(tree, ['watch', 'podcast'], 'fav');
  const map = linkSpaces(spaces, tree.children[0].children);
  assert.equal(map.get('w1'), 'watch');
  assert.equal(map.get('b1'), 'podcast');
  assert.equal(map.get('drive'), 'watch'); // stray, at the top level
  assert.equal(map.get('t1'), null);
});

// ---------- Turning on

test('turning on: the ticked folders become spaces, the rest moves into a new first space', () => {
  assert.deepEqual(enableCandidates(tree, 'fav').map((node) => node.id), ['podcast', 'watch', 'jp']);
  const plan = planEnable(tree, 'fav', ['watch', 'jp']);
  assert.deepEqual(plan, { create: { index: 1 }, move: ['drive', 'podcast'], spaces: ['watch', 'jp'] });
  assert.ok(needsFirstSpace(tree, 'fav', ['watch', 'jp']));
});

test('turning on with everything ticked makes no new folder', () => {
  const onlyFolders = { id: 'root', children: tree.children.filter((node) => node.kind === 'folder') };
  const plan = planEnable(onlyFolders, 'fav', ['jp', 'podcast', 'watch']);
  assert.deepEqual(plan, { create: null, move: [], spaces: ['podcast', 'watch', 'jp'] }); // tree order
  assert.ok(!needsFirstSpace(onlyFolders, 'fav', ['jp', 'podcast', 'watch']));
});

test('turning on with nothing ticked or an empty root still makes the first space', () => {
  assert.deepEqual(planEnable(tree, 'fav', []), { create: { index: 1 }, move: ['drive', 'podcast', 'watch', 'jp'], spaces: [] });
  assert.deepEqual(planEnable({ id: 'root', children: [] }, null, []), { create: { index: 0 }, move: [], spaces: [] });
});

test('a removed space hands its tabs to the next one, the last — to the previous', () => {
  assert.equal(neighborSpace(['a', 'b', 'c'], 'a'), 'b');
  assert.equal(neighborSpace(['a', 'b', 'c'], 'c'), 'b');
  assert.equal(neighborSpace(['a'], 'a'), null);
});

// ---------- Groups

const spaces = [
  { id: 'work', name: '💼 Work' },
  { id: 'watch', name: '🎬 Watch' },
  { id: 'jp', name: '🇯🇵 Japanese' },
];
const titles = groupTitles(spaces, 'Untitled space');

test('group titles are the space names; the same name twice gets a number', () => {
  assert.equal(titles.get('watch'), '🎬 Watch');
  const twins = groupTitles([{ id: 'a', name: 'Work' }, { id: 'b', name: 'Work' }, { id: 'c', name: '' }, { id: 'd', name: 'Work 2' }], 'Untitled');
  assert.deepEqual([...twins.values()], ['Work', 'Work 2', 'Untitled', 'Work 2 2']);
});

test('after a restart groups are matched to spaces by title', () => {
  const groups = [
    { id: 101, title: '🎬 Watch' },
    { id: 102, title: '💼 Work' },
    { id: 103, title: 'Мои вкладки' },
  ];
  const match = matchGroups(groups, titles);
  assert.deepEqual([...match.groupOf], [['watch', 101], ['work', 102]]);
  assert.deepEqual(match.foreign, [103]);
  assert.equal(match.merge.size, 0);
  assert.equal(match.rename.size, 0);
});

test('a known group keeps its space after the space is renamed, and gets the new title', () => {
  const renamed = groupTitles([{ id: 'work', name: '💼 Работа' }, spaces[1]], 'Untitled');
  const match = matchGroups([{ id: 7, title: '💼 Work' }], renamed, new Map([[7, 'work']]));
  assert.deepEqual([...match.groupOf], [['work', 7]]);
  assert.deepEqual([...match.rename], [[7, '💼 Работа']]);
});

test('two groups of one space are merged into the first; same names stay apart by number', () => {
  const twins = groupTitles([{ id: 'a', name: 'Work' }, { id: 'b', name: 'Work' }], 'Untitled');
  const match = matchGroups(
    [{ id: 1, title: 'Work 2' }, { id: 2, title: 'Work' }, { id: 3, title: 'Work' }],
    twins,
  );
  assert.deepEqual([...match.groupOf], [['b', 1], ['a', 2]]);
  assert.deepEqual([...match.merge], [[3, 2]]);
  assert.equal(match.groupSpace.get(3), 'a');
});

test('a group whose space is gone is foreign', () => {
  const match = matchGroups([{ id: 5, title: 'Old' }], titles, new Map([[5, 'removed']]));
  assert.deepEqual(match.foreign, [5]);
});

// ---------- Tabs of a window

const linkSpace = new Map([['t1', null], ['drive', 'work'], ['w1', 'watch']]);

test('each tab belongs in a space: tiles and browser-pinned tabs in none', () => {
  const tabs = [
    tab(1, 0, { groupId: 11 }), // loose, in Work's group
    tab(2, 1, { groupId: 12 }), // loose, in Watch's group
    tab(3, 2), // a tile's tab
    tab(4, 3, { groupId: 11 }), // Watch's link, but in Work's group
    tab(5, 4), // new, opened from tab 2
    tab(6, 5), // new, nothing to go by
    tab(7, 6, { pinned: true }),
    tab(8, 7, { groupId: 99 }), // a foreign group
  ];
  tabs[4].openerTabId = 2;
  const targets = tabTargets(tabs, {
    linkSpace,
    bindings: new Map([['t1', 3], ['w1', 4]]),
    groupSpace: new Map([[11, 'work'], [12, 'watch']]),
    current: 'work',
  });
  assert.deepEqual([...targets], [[1, 'work'], [2, 'watch'], [3, null], [4, 'watch'], [5, 'watch'], [6, 'work'], [7, null], [8, 'work']]);
});

test('without a known space of the window, tabs out of groups stay undecided', () => {
  const targets = tabTargets([tab(1, 0), tab(2, 1, { groupId: 12 })], {
    linkSpace,
    bindings: new Map(),
    groupSpace: new Map([[12, 'watch']]),
    current: undefined,
  });
  assert.deepEqual([...targets], [[1, undefined], [2, 'watch']]);
});

test('a split pair stays together: with a tile out of groups, with a link in its space', () => {
  const tabs = [
    tab(1, 0, { splitViewId: 1 }), // tile
    tab(2, 1, { splitViewId: 1, groupId: 11 }),
    tab(3, 2, { splitViewId: 2, groupId: 11 }),
    tab(4, 3, { splitViewId: 2, groupId: 11 }), // Watch's link
  ];
  const targets = tabTargets(tabs, {
    linkSpace,
    bindings: new Map([['t1', 1], ['w1', 4]]),
    groupSpace: new Map([[11, 'work']]),
    current: 'work',
  });
  assert.deepEqual([...targets], [[1, null], [2, null], [3, 'watch'], [4, 'watch']]);
});

test('the plan moves only tabs that are not in their space group', () => {
  const tabs = [tab(1, 0, { groupId: 11 }), tab(2, 1), tab(3, 2, { groupId: 12 }), tab(4, 3, { groupId: 13 }), tab(5, 4)];
  const targets = new Map([[1, 'work'], [2, 'work'], [3, null], [4, 'watch'], [5, undefined]]);
  const plan = regroupPlan(tabs, targets, new Map([['work', 11]]));
  assert.deepEqual(plan.ungroup, [3]);
  assert.deepEqual([...plan.join], [['work', [2]], ['watch', [4]]]); // Watch has no group here yet
});

// ---------- Switching

test('the window space: stored, else the selected tab’s, else the last used, else the first', () => {
  const ids = ['work', 'watch', 'jp'];
  assert.equal(windowSpace({ stored: 'jp', activeTarget: 'watch', last: 'work', ids }), 'jp');
  assert.equal(windowSpace({ stored: 'gone', activeTarget: 'watch', last: 'work', ids }), 'watch');
  assert.equal(windowSpace({ stored: undefined, activeTarget: null, last: 'jp', ids }), 'jp');
  assert.equal(windowSpace({ ids }), 'work');
  assert.equal(windowSpace({ ids: [] }), null);
});

test('switching selects the last tab of the space, else its most recent, else none', () => {
  const tabs = [tab(1, 0, { lastAccessed: 10 }), tab(2, 1, { lastAccessed: 30 }), tab(3, 2, { lastAccessed: 20 }), tab(4, 3)];
  const targets = new Map([[1, 'watch'], [2, 'work'], [3, 'watch'], [4, null]]);
  assert.equal(pickSpaceTab(tabs, targets, 'watch', 1), 1);
  assert.equal(pickSpaceTab(tabs, targets, 'watch', 4), 4); // a tile's tab
  assert.equal(pickSpaceTab(tabs, targets, 'watch', 2), 3); // tab 2 is in Work now
  assert.equal(pickSpaceTab(tabs, targets, 'watch', 77), 3); // closed
  assert.equal(pickSpaceTab(tabs, targets, 'jp', undefined), null);
});

// ---------- Stage 8b

test('the next and previous space; none past either end', () => {
  const ids = ['work', 'watch', 'jp'];
  assert.equal(adjacentSpace(ids, 'work', 1), 'watch');
  assert.equal(adjacentSpace(ids, 'watch', -1), 'work');
  assert.equal(adjacentSpace(ids, 'jp', 1), null);
  assert.equal(adjacentSpace(ids, 'work', -1), null);
  assert.equal(adjacentSpace(ids, 'gone', 1), null);
});

test('icons are reordered by dropping one before or after another', () => {
  const ids = ['a', 'b', 'c'];
  assert.deepEqual(reorderSpaces(ids, 'c', 'a', 'before'), ['c', 'a', 'b']);
  assert.deepEqual(reorderSpaces(ids, 'a', 'c', 'after'), ['b', 'c', 'a']);
  assert.equal(reorderSpaces(ids, 'a', 'b', 'before'), null); // where it was
  assert.equal(reorderSpaces(ids, 'a', 'a', 'after'), null);
  assert.equal(reorderSpaces(ids, 'x', 'a', 'after'), null);
});

// A gesture: wheel events 16 ms apart.
function swipe(deltas, start = 0, state = null) {
  const steps = [];
  deltas.forEach(([dx, dy], i) => {
    const step = swipeStep(state, { dx, dy, time: start + i * 16 });
    state = step.state;
    steps.push(step);
  });
  return { steps, state, actions: steps.map((step) => step.action).filter(Boolean) };
}

test('swipe: fingers to the left past the threshold — the next space, once per gesture', () => {
  const { steps, actions } = swipe([[10, 1], [20, 0], [20, 2], [20, 0], [15, 0], [8, 0], [3, 0]]);
  assert.deepEqual(actions, ['next']); // momentum after the switch changes nothing
  assert.equal(steps[1].offset, -30); // the content follows the fingers
  assert.equal(steps[3].offset, 0); // switched
});

test('swipe: to the right — the previous space; below the threshold — nothing', () => {
  assert.deepEqual(swipe([[-30, 0], [-40, 0]]).actions, ['previous']);
  const short = swipe([[10, 0], [15, 0], [10, 0]]);
  assert.deepEqual(short.actions, []);
  assert.equal(short.steps.at(-1).offset, -35);
});

test('swipe: a mostly vertical gesture is a scroll, even if it drifts sideways later', () => {
  const { steps, actions } = swipe([[1, 8], [2, 20], [40, 10], [40, 0]]);
  assert.deepEqual(actions, []);
  assert.equal(steps.at(-1).axis, 'y');
  assert.equal(steps.at(-1).offset, 0);
});

test('swipe: after a pause a new gesture can switch again', () => {
  const first = swipe([[40, 0], [40, 0]]);
  const second = swipe([[40, 0], [40, 0]], 32 + SWIPE.gap + 1, first.state);
  assert.deepEqual([...first.actions, ...second.actions], ['next', 'next']);
});

test('swipe: right after a switch, swiping back works with no pause (the momentum is still coming)', () => {
  // Fingers left, lifted: the momentum fades; fingers touch again and go right.
  const { actions } = swipe([[30, 0], [40, 0], [25, 0], [12, 0], [5, 0], [1, 0], [-3, 0], [-20, 0], [-30, 0], [-25, 0]]);
  assert.deepEqual(actions, ['next', 'previous']);
});

test('swipe: right after a switch, a second push the same way switches again; a faster finger does not', () => {
  const again = swipe([[30, 0], [40, 0], [20, 0], [6, 0], [2, 0], [1, 0], [8, 0], [25, 0], [35, 0]]);
  assert.deepEqual(again.actions, ['next', 'next']);
  // One long swipe whose speed changes: still one switch.
  const one = swipe([[20, 0], [30, 0], [15, 0], [25, 0], [40, 0], [10, 0], [30, 0], [5, 0], [3, 0], [1, 0]]);
  assert.deepEqual(one.actions, ['next']);
});

test('swipe: a little jitter the other way in the momentum is not a new gesture', () => {
  const { actions } = swipe([[30, 0], [40, 0], [20, 0], [10, 0], [-1, 0], [4, 0], [2, 0]]);
  assert.deepEqual(actions, ['next']);
});
