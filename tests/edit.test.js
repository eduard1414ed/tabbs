import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  snapshotSubtree,
  restoreSubtree,
  remapIds,
  restoredBindings,
  restoredPictograms,
  pinIndex,
  countContents,
} from '../extension/lib/edit.js';
import { buildTree } from '../extension/lib/tree.js';

// Shaped like chrome.bookmarks.getSubTree('f1')[0].
const folder = {
  id: 'f1', parentId: 'root', index: 2, title: '🎌 Подкаст', children: [
    { id: 'l1', parentId: 'f1', index: 0, title: 'VK', url: 'https://vk.com/podcast' },
    { id: 'f2', parentId: 'f1', index: 1, title: 'Архив', children: [
      { id: 'l2', parentId: 'f2', index: 0, title: '', url: 'https://boosty.to/podcast' },
    ] },
    { id: 'f3', parentId: 'f1', index: 2, title: 'Пусто', children: [] },
    { id: 'l3', parentId: 'f1', index: 3, title: 'YouTube', url: 'https://youtube.com/@podcast' },
  ],
};

// A fake chrome.bookmarks: folders by id with their children count, every create logged.
function fakeBookmarks(counts) {
  const calls = [];
  let next = 100;
  const sizes = new Map(Object.entries(counts));
  return {
    calls,
    create: async (details) => {
      calls.push(details);
      const id = String(next++);
      if (details.url === undefined) sizes.set(id, 0);
      sizes.set(details.parentId, (sizes.get(details.parentId) ?? 0) + 1);
      return { id };
    },
    childCount: async (id) => (sizes.has(id) ? sizes.get(id) : null),
  };
}

test('snapshotSubtree keeps titles, order and nesting, and only its own state', () => {
  const snapshot = snapshotSubtree(folder, {
    expanded: ['f1', 'f3', 'other'],
    bindings: new Map([['l1', 11], ['l2', 12], ['elsewhere', 13]]),
  });
  assert.equal(snapshot.parentId, 'root');
  assert.equal(snapshot.index, 2);
  assert.deepEqual(snapshot.node, {
    id: 'f1', title: '🎌 Подкаст', children: [
      { id: 'l1', title: 'VK', url: 'https://vk.com/podcast' },
      { id: 'f2', title: 'Архив', children: [{ id: 'l2', title: '', url: 'https://boosty.to/podcast' }] },
      { id: 'f3', title: 'Пусто', children: [] },
      { id: 'l3', title: 'YouTube', url: 'https://youtube.com/@podcast' },
    ],
  });
  assert.deepEqual(snapshot.expanded, ['f1', 'f3']);
  assert.deepEqual([...snapshot.bindings], [['l1', 11], ['l2', 12]]);
});

test('snapshotSubtree of a single link', () => {
  const link = { id: 'l9', parentId: 'f1', index: 4, title: 'Patreon', url: 'https://patreon.com/podcast' };
  const snapshot = snapshotSubtree(link, { expanded: ['f1'], bindings: new Map([['l9', 5]]) });
  assert.deepEqual(snapshot.node, { id: 'l9', title: 'Patreon', url: 'https://patreon.com/podcast' });
  assert.deepEqual(snapshot.expanded, []);
  assert.deepEqual([...snapshot.bindings], [['l9', 5]]);
});

test('restoreSubtree recreates the folder in its old place, children in order', async () => {
  const fake = fakeBookmarks({ root: 4 });
  const idMap = await restoreSubtree(snapshotSubtree(folder), { ...fake, fallbackParentId: 'root' });
  assert.deepEqual(fake.calls, [
    { parentId: 'root', index: 2, title: '🎌 Подкаст' },
    { parentId: '100', title: 'VK', url: 'https://vk.com/podcast' },
    { parentId: '100', title: 'Архив' },
    { parentId: '102', title: '', url: 'https://boosty.to/podcast' },
    { parentId: '100', title: 'Пусто' },
    { parentId: '100', title: 'YouTube', url: 'https://youtube.com/@podcast' },
  ]);
  assert.deepEqual([...idMap], [['f1', '100'], ['l1', '101'], ['f2', '102'], ['l2', '103'], ['f3', '104'], ['l3', '105']]);
});

test('restoreSubtree clamps the position when the parent got shorter', async () => {
  const fake = fakeBookmarks({ root: 1 });
  await restoreSubtree(snapshotSubtree(folder), { ...fake, fallbackParentId: 'root' });
  assert.equal(fake.calls[0].index, 1);
});

test('restoreSubtree puts it at the end of the root when the parent is gone', async () => {
  const link = { id: 'l9', parentId: 'gone', index: 3, title: 'Patreon', url: 'https://patreon.com/podcast' };
  const fake = fakeBookmarks({ root: 5 });
  const idMap = await restoreSubtree(snapshotSubtree(link), { ...fake, fallbackParentId: 'root' });
  assert.deepEqual(fake.calls, [{ parentId: 'root', index: 5, title: 'Patreon', url: 'https://patreon.com/podcast' }]);
  assert.deepEqual([...idMap], [['l9', '100']]);
});

test('restoreSubtree fails if there is nowhere to put it', async () => {
  const fake = fakeBookmarks({});
  await assert.rejects(restoreSubtree(snapshotSubtree(folder), { ...fake, fallbackParentId: 'root' }));
  assert.equal(fake.calls.length, 0);
});

test('remapIds moves expanded folders onto the new ids', () => {
  const idMap = new Map([['f1', '100'], ['f3', '104']]);
  assert.deepEqual(remapIds(['f1', 'f3', 'f2'], idMap), ['100', '104']);
  assert.deepEqual(remapIds([], idMap), []);
});

test('restoredBindings: only open tabs not pinned elsewhere meanwhile', () => {
  const snapshot = snapshotSubtree(folder, { bindings: new Map([['l1', 11], ['l2', 12], ['l3', 13]]) });
  const idMap = new Map([['l1', '101'], ['l2', '103'], ['l3', '105']]);
  const open = new Set([11, 13]); // 12 was closed
  const current = new Map([['x', 13]]); // 13 was pinned again as another link
  assert.deepEqual([...restoredBindings(snapshot, idMap, open, current)], [['101', 11]]);
});

test('restoredPictograms: the subtree\'s pictograms move onto the new folder ids', () => {
  const pictograms = new Map([['f1', 'heart'], ['f3', 'archive'], ['other', 'star']]);
  const snapshot = snapshotSubtree(folder, { pictograms });
  assert.deepEqual([...snapshot.pictograms], [['f1', 'heart'], ['f3', 'archive']]);
  const idMap = new Map([['f1', '100'], ['f3', '104']]);
  assert.deepEqual([...restoredPictograms(snapshot, idMap)], [['100', 'heart'], ['104', 'archive']]);
  assert.deepEqual([...restoredPictograms(snapshotSubtree(folder), idMap)], []);
});

test('pinIndex: after the last top-level link, before folders below it', () => {
  const tree = (children) => buildTree({ id: 'root', children }).children;
  const link = (id) => ({ id, title: id, url: `https://${id}.com` });
  const dir = (id) => ({ id, title: id, children: [] });
  assert.equal(pinIndex(tree([link('a'), link('b'), dir('f'), dir('g')])), 2);
  assert.equal(pinIndex(tree([link('a'), dir('f'), link('b'), dir('g')])), 3);
  assert.equal(pinIndex(tree([dir('f'), dir('g')])), 0);
  assert.equal(pinIndex(tree([])), 0);
  assert.equal(pinIndex(tree([dir('f'), link('a')])), 2);
});

test('countContents counts nested links and folders', () => {
  const [model] = buildTree({ id: 'root', children: [folder] }).children;
  assert.deepEqual(countContents(model), { links: 3, folders: 2 });
  assert.deepEqual(countContents(model.children[2]), { links: 0, folders: 0 });
});
