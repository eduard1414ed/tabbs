import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bindingKey,
  parseBindings,
  tabUrl,
  findTabForUrl,
  resolveClick,
  planOpenAll,
  restoreBindings,
  staleBindings,
  bookmarksOfTab,
  activeLinkId,
  linkState,
} from '../extension/lib/binding.js';

// Shaped like chrome.tabs.Tab.
const tab = (id, windowId, url, extra = {}) => ({ id, windowId, index: 0, url, active: false, ...extra });

test('bindings are stored one key per bookmark and parsed back', () => {
  assert.equal(bindingKey('42'), 'tab:42');
  const bindings = parseBindings({ 'tab:42': 7, 'tab:43': 8, restoreUntil: 123, 'tab:bad': 'x' });
  assert.deepEqual([...bindings], [['42', 7], ['43', 8]]);
  assert.equal(parseBindings(undefined).size, 0);
});

test('tabUrl prefers the address that is loading', () => {
  assert.equal(tabUrl(tab(1, 1, 'https://a.com/', { pendingUrl: 'https://b.com/' })), 'https://b.com/');
  assert.equal(tabUrl(tab(1, 1, 'https://a.com/')), 'https://a.com/');
  assert.equal(tabUrl(tab(1, 1, '')), '');
  assert.equal(tabUrl(undefined), '');
});

test('findTabForUrl prefers the given window and skips excluded tabs', () => {
  const tabs = [tab(1, 10, 'https://vk.com/'), tab(2, 20, 'https://vk.com'), tab(3, 20, 'https://ya.ru/')];
  assert.equal(findTabForUrl('https://vk.com/', tabs, { windowId: 20 }).id, 2);
  assert.equal(findTabForUrl('https://vk.com/', tabs, { windowId: 30 }).id, 1);
  assert.equal(findTabForUrl('https://vk.com/', tabs, { exclude: new Set([2]), windowId: 20 }).id, 1);
  assert.equal(findTabForUrl('https://vk.com/', tabs, { exclude: new Set([1, 2]) }), null);
  assert.equal(findTabForUrl('https://none.com/', tabs), null);
});

test('click on a link with a live tab switches to it, even in another window', () => {
  const tabs = [tab(1, 10, 'https://other.com/'), tab(2, 20, 'https://vk.com/')];
  const result = resolveClick({ bookmarkId: 'b', url: 'https://vk.com/', bindings: new Map([['b', 2]]), tabs, windowId: 10 });
  assert.equal(result.action, 'switch');
  assert.equal(result.tab.id, 2);
});

test('click on a link that moved to another address still switches to its tab', () => {
  const tabs = [tab(5, 10, 'https://vk.com/feed')];
  const result = resolveClick({ bookmarkId: 'b', url: 'https://vk.com/', bindings: new Map([['b', 5]]), tabs, windowId: 10 });
  assert.equal(result.action, 'switch');
});

test('click binds an open unbound tab with the same address, current window first', () => {
  const tabs = [tab(1, 20, 'https://vk.com/'), tab(2, 10, 'https://vk.com/#feed')];
  const result = resolveClick({ bookmarkId: 'b', url: 'https://vk.com', bindings: new Map(), tabs, windowId: 10 });
  assert.equal(result.action, 'bind');
  assert.equal(result.tab.id, 2);
});

test('click with a stale binding falls back to the search', () => {
  const tabs = [tab(3, 10, 'https://vk.com/')];
  const result = resolveClick({ bookmarkId: 'b', url: 'https://vk.com/', bindings: new Map([['b', 99]]), tabs, windowId: 10 });
  assert.equal(result.action, 'bind');
  assert.equal(result.tab.id, 3);
});

test('click never takes a tab bound to another link', () => {
  const tabs = [tab(1, 10, 'https://vk.com/')];
  const result = resolveClick({ bookmarkId: 'b2', url: 'https://vk.com/', bindings: new Map([['b1', 1]]), tabs, windowId: 10 });
  assert.deepEqual(result, { action: 'create' });
});

test('click with nothing open creates a tab', () => {
  const result = resolveClick({ bookmarkId: 'b', url: 'https://vk.com/', bindings: new Map(), tabs: [], windowId: 10 });
  assert.deepEqual(result, { action: 'create' });
});

test('restoreBindings gives each link the first unbound tab with its address', () => {
  const links = [
    { id: 'drive', url: 'https://drive.google.com/' },
    { id: 'vk1', url: 'https://vk.com/' },
    { id: 'vk2', url: 'https://vk.com' },
    { id: 'vk3', url: 'https://vk.com/' },
    { id: 'closed', url: 'https://closed.com/' },
  ];
  const tabs = [
    tab(11, 1, 'https://vk.com/'),
    tab(12, 1, 'https://drive.google.com/drive/my-drive'), // moved away: not matched by address
    tab(13, 2, 'https://vk.com/#x'),
    tab(14, 2, 'https://drive.google.com'),
  ];
  const added = restoreBindings(links, tabs, new Map());
  assert.deepEqual([...added], [['drive', 14], ['vk1', 11], ['vk2', 13]]);
});

test('restoreBindings keeps live bindings and their tabs', () => {
  const links = [{ id: 'a', url: 'https://vk.com/' }, { id: 'b', url: 'https://vk.com/' }];
  const tabs = [tab(1, 1, 'https://vk.com/'), tab(2, 1, 'https://vk.com/')];
  const added = restoreBindings(links, tabs, new Map([['a', 1]]));
  assert.deepEqual([...added], [['b', 2]]);
});

test('restoreBindings replaces stale bindings and ignores bindings of removed links', () => {
  const links = [{ id: 'a', url: 'https://vk.com/' }];
  const tabs = [tab(5, 1, 'https://vk.com/')];
  // 'a' points to a closed tab; 'gone' (no longer a link) holds tab 5.
  const added = restoreBindings(links, tabs, new Map([['a', 99], ['gone', 5]]));
  assert.deepEqual([...added], [['a', 5]]);
});

test('restoreBindings matches tabs that are still loading or not loaded yet', () => {
  const links = [{ id: 'a', url: 'https://vk.com/' }];
  const tabs = [tab(5, 1, '', { pendingUrl: 'https://vk.com/' })];
  assert.deepEqual([...restoreBindings(links, tabs, new Map())], [['a', 5]]);
});

test('staleBindings drops closed tabs, removed links and duplicate tabs', () => {
  const bindings = new Map([['a', 1], ['b', 2], ['c', 1], ['gone', 3]]);
  assert.deepEqual(staleBindings(bindings, new Set([1, 3]), new Set(['a', 'b', 'c'])), ['b', 'c', 'gone']);
  assert.deepEqual(staleBindings(bindings, new Set([1, 2, 3])), ['c']);
});

test('bookmarksOfTab and activeLinkId', () => {
  const bindings = new Map([['a', 1], ['b', 2]]);
  assert.deepEqual(bookmarksOfTab(bindings, 2), ['b']);
  assert.deepEqual(bookmarksOfTab(bindings, 3), []);
  assert.equal(activeLinkId(bindings, 1), 'a');
  assert.equal(activeLinkId(bindings, 3), null);
  assert.equal(activeLinkId(bindings, undefined), null);
});

test('linkState: closed, open, active, moved', () => {
  const link = { id: 'a', url: 'https://vk.com/' };
  assert.deepEqual(linkState(link, undefined, 1), { open: false, active: false, moved: false });
  assert.deepEqual(linkState(link, tab(1, 1, 'https://vk.com/#x'), 2), { open: true, active: false, moved: false });
  assert.deepEqual(linkState(link, tab(1, 1, 'https://vk.com/'), 1), { open: true, active: true, moved: false });
  assert.deepEqual(linkState(link, tab(1, 1, 'https://vk.com/feed'), 1), { open: true, active: true, moved: true });
  // A brand-new tab without an address yet is not "moved".
  assert.deepEqual(linkState(link, tab(1, 1, ''), 1), { open: true, active: true, moved: false });
  // Going back to the bookmark: ↩ disappears as soon as loading starts.
  assert.equal(linkState(link, tab(1, 1, 'https://vk.com/feed', { pendingUrl: 'https://vk.com/' }), 1).moved, false);
});

const links = (...ids) => ids.map((id) => ({ id, url: `https://${id}.com/` }));

test('planOpenAll leaves open links alone and opens the rest in folder order', () => {
  const tabs = [tab(1, 1, 'https://a.com/')];
  const plan = planOpenAll(links('a', 'b', 'c'), new Map([['a', 1]]), tabs, 1);
  assert.equal(plan.bind.size, 0);
  assert.deepEqual(plan.create.map((link) => link.id), ['b', 'c']);
});

test('planOpenAll adopts an open unbound tab with the address, one tab for one link', () => {
  const tabs = [tab(5, 2, 'https://b.com/'), tab(6, 1, 'https://b.com/#top'), tab(7, 1, 'https://c.com/')];
  const twoB = [...links('b'), { id: 'b2', url: 'https://b.com' }, ...links('c')];
  const plan = planOpenAll(twoB, new Map([['x', 7]]), tabs, 1);
  // The panel's window first; the second link with the same address takes the other tab;
  // tab 7 belongs to another link.
  assert.deepEqual([...plan.bind], [['b', 6], ['b2', 5]]);
  assert.deepEqual(plan.create.map((link) => link.id), ['c']);
});

test('planOpenAll: a binding to a closed tab counts as not open', () => {
  const plan = planOpenAll(links('a'), new Map([['a', 99]]), [], 1);
  assert.deepEqual(plan.create.map((link) => link.id), ['a']);
});

test('planOpenAll on an empty folder does nothing', () => {
  const plan = planOpenAll([], new Map(), [tab(1, 1, 'https://a.com/')], 1);
  assert.equal(plan.bind.size, 0);
  assert.equal(plan.create.length, 0);
});
