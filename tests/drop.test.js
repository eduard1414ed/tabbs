import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dropZone, bookmarkDrop, tabDrop, splitDrop, droppedLink } from '../extension/lib/drop.js';
import { buildTree } from '../extension/lib/tree.js';

test('dropZone: links and tabs split in halves', () => {
  assert.equal(dropZone('link', 0, 36), 'before');
  assert.equal(dropZone('link', 17.9, 36), 'before');
  assert.equal(dropZone('link', 18, 36), 'after');
  assert.equal(dropZone('tab', 35, 36), 'after');
});

test('dropZone: folders have a middle that means inside', () => {
  assert.equal(dropZone('folder', 8, 36), 'before');
  assert.equal(dropZone('folder', 9, 36), 'inside');
  assert.equal(dropZone('folder', 26.9, 36), 'inside');
  assert.equal(dropZone('folder', 27, 36), 'after');
  assert.equal(dropZone('folder', 27, 36, { expanded: true }), 'inside-start');
  assert.equal(dropZone('folder', 2, 36, { expanded: true }), 'before');
});

test('dropZone: a tab or link that can be split with has a middle that means onto', () => {
  for (const kind of ['tab', 'link']) {
    assert.equal(dropZone(kind, 8.9, 36, { canSplit: true }), 'before', kind);
    assert.equal(dropZone(kind, 9, 36, { canSplit: true }), 'onto', kind);
    assert.equal(dropZone(kind, 26.9, 36, { canSplit: true }), 'onto', kind);
    assert.equal(dropZone(kind, 27, 36, { canSplit: true }), 'after', kind);
  }
});

test('dropZone: without a split there is no middle; folders and tiles never get onto', () => {
  assert.equal(dropZone('tab', 17, 36, { canSplit: false }), 'before');
  assert.equal(dropZone('link', 19, 36), 'after');
  assert.equal(dropZone('folder', 18, 36, { canSplit: true }), 'inside');
  assert.equal(dropZone('folder', 30, 36, { canSplit: true, expanded: true }), 'inside-start');
  assert.equal(dropZone('tile', 30, 60, { canSplit: true }), 'after');
});

test('dropZone: tiles split across, left half before, right half after', () => {
  assert.equal(dropZone('tile', 0, 60), 'before');
  assert.equal(dropZone('tile', 29.9, 60), 'before');
  assert.equal(dropZone('tile', 30, 60), 'after');
});

// root: a, b, F[ c, G[ d ], e ], h, E[]
const tree = buildTree({
  id: 'root', children: [
    { id: 'a', title: 'a', url: 'https://a.com' },
    { id: 'b', title: 'b', url: 'https://b.com' },
    { id: 'F', title: 'F', children: [
      { id: 'c', title: 'c', url: 'https://c.com' },
      { id: 'G', title: 'G', children: [{ id: 'd', title: 'd', url: 'https://d.com' }] },
      { id: 'e', title: 'e', url: 'https://e.com' },
    ] },
    { id: 'h', title: 'h', url: 'https://h.com' },
    { id: 'E', title: 'E', children: [] },
  ],
});

test('bookmarkDrop: reorder within one folder, down and up', () => {
  assert.deepEqual(bookmarkDrop(tree, { dragId: 'a', targetId: 'h', zone: 'after' }), { parentId: 'root', index: 4 });
  assert.deepEqual(bookmarkDrop(tree, { dragId: 'h', targetId: 'a', zone: 'before' }), { parentId: 'root', index: 0 });
  assert.deepEqual(bookmarkDrop(tree, { dragId: 'e', targetId: 'c', zone: 'after' }), { parentId: 'F', index: 1 });
});

test('bookmarkDrop: dropping next to itself changes nothing', () => {
  assert.equal(bookmarkDrop(tree, { dragId: 'b', targetId: 'b', zone: 'before' }), null);
  assert.equal(bookmarkDrop(tree, { dragId: 'b', targetId: 'b', zone: 'after' }), null);
  assert.equal(bookmarkDrop(tree, { dragId: 'a', targetId: 'b', zone: 'before' }), null);
  assert.equal(bookmarkDrop(tree, { dragId: 'b', targetId: 'a', zone: 'after' }), null);
});

test('bookmarkDrop: into a folder, at its end or at its top; out of a folder', () => {
  assert.deepEqual(bookmarkDrop(tree, { dragId: 'a', targetId: 'F', zone: 'inside' }), { parentId: 'F', index: 3 });
  assert.deepEqual(bookmarkDrop(tree, { dragId: 'a', targetId: 'F', zone: 'inside-start' }), { parentId: 'F', index: 0 });
  assert.deepEqual(bookmarkDrop(tree, { dragId: 'a', targetId: 'E', zone: 'inside' }), { parentId: 'E', index: 0 });
  assert.deepEqual(bookmarkDrop(tree, { dragId: 'd', targetId: 'a', zone: 'after' }), { parentId: 'root', index: 1 });
  assert.deepEqual(bookmarkDrop(tree, { dragId: 'd', targetId: 'G', zone: 'after' }), { parentId: 'F', index: 2 });
});

test('bookmarkDrop: a link is not a folder to drop into', () => {
  assert.equal(bookmarkDrop(tree, { dragId: 'a', targetId: 'h', zone: 'inside' }), null);
});

test('bookmarkDrop: the empty space below the tree is the end of the root', () => {
  assert.deepEqual(bookmarkDrop(tree, { dragId: 'd', targetId: 'root', zone: 'inside' }), { parentId: 'root', index: 5 });
  assert.equal(bookmarkDrop(tree, { dragId: 'E', targetId: 'root', zone: 'inside' }), null, 'already last');
});

test('bookmarkDrop: a folder never goes into itself or its own subfolder', () => {
  assert.equal(bookmarkDrop(tree, { dragId: 'F', targetId: 'F', zone: 'inside' }), null);
  assert.equal(bookmarkDrop(tree, { dragId: 'F', targetId: 'G', zone: 'inside' }), null);
  assert.equal(bookmarkDrop(tree, { dragId: 'F', targetId: 'd', zone: 'before' }), null);
  assert.equal(bookmarkDrop(tree, { dragId: 'F', targetId: 'c', zone: 'after' }), null);
  assert.deepEqual(bookmarkDrop(tree, { dragId: 'G', targetId: 'E', zone: 'inside' }), { parentId: 'E', index: 0 });
  assert.deepEqual(bookmarkDrop(tree, { dragId: 'F', targetId: 'a', zone: 'before' }), { parentId: 'root', index: 0 });
});

test('bookmarkDrop: a new bookmark (pinned tab, dropped address)', () => {
  assert.deepEqual(bookmarkDrop(tree, { targetId: 'b', zone: 'after' }), { parentId: 'root', index: 2 });
  assert.deepEqual(bookmarkDrop(tree, { targetId: 'G', zone: 'inside' }), { parentId: 'G', index: 1 });
  assert.equal(bookmarkDrop(tree, { targetId: 'gone', zone: 'after' }), null);
});

// root: Fav[ t1, t2, t3 ], a, B[ c ]
const withFavorites = buildTree({
  id: 'root', children: [
    { id: 'Fav', title: 'Избранное', children: [
      { id: 't1', title: 't1', url: 'https://t1.com' },
      { id: 't2', title: 't2', url: 'https://t2.com' },
      { id: 't3', title: 't3', url: 'https://t3.com' },
    ] },
    { id: 'a', title: 'a', url: 'https://a.com' },
    { id: 'B', title: 'B', children: [{ id: 'c', title: 'c', url: 'https://c.com' }] },
  ],
});

test('bookmarkDrop: reorder tiles', () => {
  assert.deepEqual(bookmarkDrop(withFavorites, { dragId: 't1', targetId: 't3', zone: 'after' }), { parentId: 'Fav', index: 3 });
  assert.deepEqual(bookmarkDrop(withFavorites, { dragId: 't3', targetId: 't1', zone: 'before' }), { parentId: 'Fav', index: 0 });
  assert.equal(bookmarkDrop(withFavorites, { dragId: 't2', targetId: 't1', zone: 'after' }), null, 'own place');
  assert.equal(bookmarkDrop(withFavorites, { dragId: 't3', targetId: 'Fav', zone: 'inside' }), null, 'already last');
});

test('bookmarkDrop: into the tiles and out of them', () => {
  assert.deepEqual(bookmarkDrop(withFavorites, { dragId: 'c', targetId: 't2', zone: 'before' }), { parentId: 'Fav', index: 1 });
  assert.deepEqual(bookmarkDrop(withFavorites, { dragId: 'a', targetId: 'Fav', zone: 'inside' }), { parentId: 'Fav', index: 3 });
  assert.deepEqual(bookmarkDrop(withFavorites, { targetId: 'Fav', zone: 'inside' }), { parentId: 'Fav', index: 3 }, 'a pinned tab');
  assert.deepEqual(bookmarkDrop(withFavorites, { dragId: 't1', targetId: 'a', zone: 'after' }), { parentId: 'root', index: 2 });
  assert.deepEqual(bookmarkDrop(withFavorites, { dragId: 't2', targetId: 'B', zone: 'inside' }), { parentId: 'B', index: 1 });
});

// Window tabs by index; 2 and 4 are on links, so below the divider only 1, 3, 5, 6 are seen.
const windowTabs = [1, 2, 3, 4, 5, 6].map((id, index) => ({ id, index, windowId: 1 }));

test('tabDrop: move a tab forward and back', () => {
  assert.equal(tabDrop(windowTabs, { dragTabId: 1, targetTabId: 5, zone: 'after' }), 4);
  assert.equal(tabDrop(windowTabs, { dragTabId: 1, targetTabId: 5, zone: 'before' }), 3);
  assert.equal(tabDrop(windowTabs, { dragTabId: 6, targetTabId: 3, zone: 'before' }), 2);
  assert.equal(tabDrop(windowTabs, { dragTabId: 6, targetTabId: 1, zone: 'before' }), 0);
});

test('tabDrop: next to itself, or across hidden tabs to the same spot, changes nothing', () => {
  assert.equal(tabDrop(windowTabs, { dragTabId: 3, targetTabId: 3, zone: 'before' }), null);
  assert.equal(tabDrop(windowTabs, { dragTabId: 3, targetTabId: 3, zone: 'after' }), null);
  assert.equal(tabDrop(windowTabs, { dragTabId: 6, targetTabId: null }), null);
  // 3 dropped before 5: past the hidden tab 4 — a real move.
  assert.equal(tabDrop(windowTabs, { dragTabId: 3, targetTabId: 5, zone: 'before' }), 3);
});

test('tabDrop: to the end, and for a new tab or one from elsewhere', () => {
  assert.equal(tabDrop(windowTabs, { dragTabId: 1, targetTabId: null }), 5);
  assert.equal(tabDrop(windowTabs, { targetTabId: null }), 6);
  assert.equal(tabDrop(windowTabs, { targetTabId: 3, zone: 'after' }), 3);
  assert.equal(tabDrop(windowTabs, { dragTabId: 99, targetTabId: 1, zone: 'before' }), 0);
  assert.equal(tabDrop(windowTabs, { targetTabId: 42, zone: 'after' }), null);
});

test('droppedLink: from the address bar (uri-list and a link with the page title)', () => {
  assert.deepEqual(
    droppedLink({
      uriList: '# Подкаст\r\nhttps://podcast.example.com/robots\r\n',
      html: '<a href="https://podcast.example.com/robots">Роботы — Подкаст! &quot;1&quot; &#8470;2</a>',
      text: 'https://podcast.example.com/robots',
    }),
    { url: 'https://podcast.example.com/robots', title: 'Роботы — Подкаст! "1" №2' },
  );
  assert.deepEqual(
    droppedLink({ uriList: 'https://vk.com/podcast', html: '<meta charset="utf-8"><a href="https://vk.com/podcast"><b>VK</b> &amp; Ко</a>' }),
    { url: 'https://vk.com/podcast', title: 'VK & Ко' },
  );
});

test('droppedLink: only an address, or a link whose text is the address', () => {
  assert.deepEqual(droppedLink({ uriList: 'https://vk.com/podcast' }), { url: 'https://vk.com/podcast', title: '' });
  assert.deepEqual(droppedLink({ html: "<a href='https://x.com/a?b=1&amp;c=2'>https://x.com/a?b=1&amp;c=2</a>" }),
    { url: 'https://x.com/a?b=1&c=2', title: '' });
  assert.deepEqual(droppedLink({ text: '  example.com/page ' }), { url: 'https://example.com/page', title: '' });
});

test('droppedLink: plain text that is not an address', () => {
  assert.equal(droppedLink({ text: 'просто текст' }), null);
  assert.equal(droppedLink({ text: 'https://a.com\nhttps://b.com' }), null);
  assert.equal(droppedLink({}), null);
});

// Window tabs 10…14 at indexes 0…4.
const strip = [10, 11, 12, 13, 14].map((id, index) => ({ id, index }));

test('splitDrop puts the dropped tab right after the target', () => {
  assert.equal(splitDrop(strip, { dragTabId: 10, targetTabId: 12 }), 2); // from the left: 11, 12, 10
  assert.equal(splitDrop(strip, { dragTabId: 14, targetTabId: 11 }), 2); // from the right: 11, 14, 12
  assert.equal(splitDrop(strip, { dragTabId: 11, targetTabId: 12 }), 2); // neighbour on the left: swap
});

test('splitDrop: already right after the target — nothing to move', () => {
  assert.equal(splitDrop(strip, { dragTabId: 13, targetTabId: 12 }), null);
});

test('splitDrop: a tab from another window goes after the target; no target — null', () => {
  assert.equal(splitDrop(strip, { dragTabId: 99, targetTabId: 12 }), 3);
  assert.equal(splitDrop(strip, { dragTabId: 10, targetTabId: 99 }), null);
});
