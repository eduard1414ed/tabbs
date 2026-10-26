import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitWindowTabs, tabTitle, iconVersion, soundState, inSplit, placePairs, pairSoundState } from '../extension/lib/tabs.js';

// Shaped like chrome.tabs.Tab.
const tab = (id, windowId, index, extra = {}) => ({ id, windowId, index, url: `https://site${id}.com/`, ...extra });
const ids = (tabs) => tabs.map((t) => t.id);

// Every tab of the window shows up exactly once: on a link or below the divider.
function assertEachTabOnce(split, tabs, windowId) {
  const shown = [...split.inFolders.values(), ...split.loose].map((t) => t.id).sort();
  const expected = tabs.filter((t) => t.windowId === windowId).map((t) => t.id).sort();
  assert.deepEqual(shown, expected);
}

test('bound tabs go to their links, the rest below the divider in browser order', () => {
  const tabs = [tab(1, 1, 2), tab(2, 1, 0), tab(3, 1, 1), tab(4, 1, 3)];
  const bindings = new Map([['a', 3], ['b', 4]]);
  const split = splitWindowTabs(tabs, bindings, new Set(['a', 'b']), 1);
  assert.deepEqual([...split.inFolders].map(([id, t]) => [id, t.id]), [['a', 3], ['b', 4]]);
  assert.deepEqual(ids(split.loose), [2, 1]);
  assertEachTabOnce(split, tabs, 1);
});

test('only tabs of the given window are shown', () => {
  const tabs = [tab(1, 1, 0), tab(2, 2, 0), tab(3, 2, 1)];
  const bindings = new Map([['a', 2]]);
  const split = splitWindowTabs(tabs, bindings, new Set(['a']), 1);
  assert.equal(split.inFolders.size, 0); // the link's tab lives in another window
  assert.deepEqual(ids(split.loose), [1]);
  const other = splitWindowTabs(tabs, bindings, new Set(['a']), 2);
  assert.deepEqual(ids(other.loose), [3]);
  assert.equal(other.inFolders.get('a').id, 2);
});

test('a tab whose link was deleted goes below the divider', () => {
  const tabs = [tab(1, 1, 0), tab(2, 1, 1)];
  const split = splitWindowTabs(tabs, new Map([['gone', 1]]), new Set(['a']), 1);
  assert.deepEqual(ids(split.loose), [1, 2]);
  assertEachTabOnce(split, tabs, 1);
});

test('stale bindings to closed tabs change nothing', () => {
  const tabs = [tab(1, 1, 0)];
  const split = splitWindowTabs(tabs, new Map([['a', 99]]), new Set(['a']), 1);
  assert.equal(split.inFolders.size, 0);
  assert.deepEqual(ids(split.loose), [1]);
});

test('a tab claimed by two links is shown once, on the first', () => {
  const tabs = [tab(1, 1, 0)];
  const split = splitWindowTabs(tabs, new Map([['a', 1], ['b', 1]]), new Set(['a', 'b']), 1);
  assert.deepEqual([...split.inFolders.keys()], ['a']);
  assert.deepEqual(split.loose, []);
  assertEachTabOnce(split, tabs, 1);
});

test('browser-pinned tabs come first like any tabs with lower index', () => {
  const tabs = [tab(1, 1, 1), tab(2, 1, 0, { pinned: true })];
  assert.deepEqual(ids(splitWindowTabs(tabs, new Map(), new Set(), 1).loose), [2, 1]);
});

test('an empty window and no root folder', () => {
  assert.deepEqual(splitWindowTabs([], new Map(), new Set(), 1).loose, []);
  const tabs = [tab(1, 1, 0)];
  // Without the root folder there are no links: every tab is below the divider.
  assert.deepEqual(ids(splitWindowTabs(tabs, new Map([['a', 1]]), new Map(), 1).loose), [1]);
});

test('the input is not reordered in place', () => {
  const tabs = [tab(1, 1, 1), tab(2, 1, 0)];
  splitWindowTabs(tabs, new Map(), new Set(), 1);
  assert.deepEqual(ids(tabs), [1, 2]);
});

test('tabTitle falls back to the domain, then the address', () => {
  assert.equal(tabTitle({ title: ' YouTube ', url: 'https://www.youtube.com/' }), 'YouTube');
  assert.equal(tabTitle({ title: '', url: 'https://www.youtube.com/watch' }), 'youtube.com');
  assert.equal(tabTitle({ title: '', url: '', pendingUrl: 'https://vk.com/' }), 'vk.com');
  assert.equal(tabTitle({ url: 'about:blank' }), 'about:blank');
  assert.equal(tabTitle({}), '');
});

test('iconVersion changes with the page or the site icon only', () => {
  const base = { url: 'https://vk.com/', favIconUrl: 'https://vk.com/favicon.ico', title: 'VK' };
  assert.equal(iconVersion(base), iconVersion({ ...base, title: 'VK — лента' }));
  assert.notEqual(iconVersion(base), iconVersion({ ...base, favIconUrl: undefined }));
  assert.notEqual(iconVersion(base), iconVersion({ ...base, url: 'https://vk.com/feed' }));
  assert.match(iconVersion({}), /^[0-9a-z]+$/);
});

test('soundState: playing, muted (even when silent), or nothing', () => {
  assert.equal(soundState({ audible: true, mutedInfo: { muted: false } }), 'playing');
  assert.equal(soundState({ audible: true, mutedInfo: { muted: true } }), 'muted');
  assert.equal(soundState({ audible: false, mutedInfo: { muted: true } }), 'muted');
  assert.equal(soundState({ audible: false, mutedInfo: { muted: false } }), null);
  assert.equal(soundState({}), null);
  assert.equal(soundState(undefined), null);
});

// Pairs: tabs of window 1; bindings pin some of them to links.
const pairTabs = (...specs) => specs.map(([id, index, splitViewId = -1, windowId = 1]) => tab(id, windowId, index, { splitViewId }));
const layout = (tabs, bindings, hostIds) => placePairs(splitWindowTabs(tabs, new Map(bindings), new Set(bindings.map(([id]) => id)), 1), hostIds);
const shown = (items) => items.map((item) => (item.pair ? item.pair.map((t) => t.id) : item.id));

test('inSplit: only a real split view id counts', () => {
  assert.equal(inSplit({ splitViewId: 7 }), true);
  assert.equal(inSplit({ splitViewId: -1 }), false);
  assert.equal(inSplit({}), false);
  assert.equal(inSplit(undefined), false);
});

test('placePairs: two loose tabs show as one row in place of the left one', () => {
  const tabs = pairTabs([1, 0], [2, 1, 9], [3, 2, 9], [4, 3]);
  const result = layout(tabs, [], []);
  assert.deepEqual(shown(result.loose), [1, [2, 3], 4]);
  assert.equal(result.loose[1].splitViewId, 9);
  assert.equal(result.onLinks.size, 0);
});

test('placePairs: a pair with a tab on a link shows on the link; the other tab leaves the divider', () => {
  const tabs = pairTabs([1, 0], [2, 1, 9], [3, 2, 9]);
  const result = layout(tabs, [['a', 3]], ['a']);
  assert.deepEqual([...result.onLinks].map(([id, t]) => [id, t.id]), [['a', 2]]);
  assert.deepEqual(shown(result.loose), [1]);
});

test('placePairs: both on links — the first link in tree order shows the pair, the second stays', () => {
  const tabs = pairTabs([1, 0, 9], [2, 1, 9], [3, 2]);
  const result = layout(tabs, [['a', 1], ['b', 2]], ['b', 'a']);
  assert.deepEqual([...result.onLinks].map(([id, t]) => [id, t.id]), [['b', 1]]);
  assert.deepEqual(shown(result.loose), [3]);
});

test('placePairs: a tile cannot show a pair — its partner stays below the divider alone', () => {
  const tabs = pairTabs([1, 0, 9], [2, 1, 9]);
  const result = layout(tabs, [['tile', 1]], []);
  assert.equal(result.onLinks.size, 0);
  assert.deepEqual(shown(result.loose), [2]);
});

test('placePairs: half a pair (the other tab is gone or in another window) is an ordinary tab', () => {
  const tabs = pairTabs([1, 0, 9], [2, 1], [3, 0, 9, 2]);
  assert.deepEqual(shown(layout(tabs, [], []).loose), [1, 2]);
});

test('pairSoundState: playing wins, then muted', () => {
  const playing = { audible: true, mutedInfo: { muted: false } };
  const muted = { audible: false, mutedInfo: { muted: true } };
  const quiet = { audible: false, mutedInfo: { muted: false } };
  assert.equal(pairSoundState([quiet, playing]), 'playing');
  assert.equal(pairSoundState([muted, playing]), 'playing');
  assert.equal(pairSoundState([muted, quiet]), 'muted');
  assert.equal(pairSoundState([quiet, quiet]), null);
});
