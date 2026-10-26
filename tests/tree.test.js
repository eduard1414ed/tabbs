import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  splitLeadingEmoji,
  hostOf,
  buildTree,
  collectIds,
  collectLinks,
  nodesById,
  peekLinks,
  isRelevantEvent,
  toggleId,
  pruneIds,
  sameIds,
  fallbackIcon,
} from '../extension/lib/tree.js';

// Shaped like chrome.bookmarks.getSubTree(rootId)[0].
const subTree = {
  id: 'root', title: 'Tabbs', children: [
    { id: 'l1', parentId: 'root', index: 0, title: 'Drive', url: 'https://drive.google.com/' },
    { id: 'f1', parentId: 'root', index: 1, title: '🎌 Подкаст', children: [
      { id: 'l2', parentId: 'f1', index: 0, title: 'VK', url: 'https://vk.com/podcast' },
      { id: 'f2', parentId: 'f1', index: 1, title: 'Архив', children: [] },
    ] },
    { id: 'l3', parentId: 'root', index: 2, title: '', url: 'https://www.youtube.com/watch?v=1' },
  ],
};

test('buildTree keeps order and nesting', () => {
  const tree = buildTree(subTree);
  assert.equal(tree.id, 'root');
  assert.deepEqual(tree.children.map((n) => n.id), ['l1', 'f1', 'l3']);
  assert.deepEqual(tree.children[0], { kind: 'link', id: 'l1', title: 'Drive', name: 'Drive', url: 'https://drive.google.com/' });
  const folder = tree.children[1];
  assert.equal(folder.kind, 'folder');
  assert.equal(folder.title, 'Подкаст');
  assert.equal(folder.emoji, '🎌');
  assert.equal(folder.name, '🎌 Подкаст');
  assert.equal(tree.children[2].name, '');
  assert.deepEqual(folder.children.map((n) => n.kind), ['link', 'folder']);
  assert.deepEqual(folder.children[1].children, []);
});

test('buildTree uses the domain for a link without a title', () => {
  const tree = buildTree(subTree);
  assert.equal(tree.children[2].title, 'youtube.com');
  const odd = buildTree({ id: 'r', children: [{ id: 'x', title: '  ', url: 'not a url' }] });
  assert.equal(odd.children[0].title, 'not a url');
});

test('buildTree handles an empty root and missing children', () => {
  assert.deepEqual(buildTree({ id: 'r' }), { id: 'r', children: [] });
  assert.deepEqual(buildTree({ id: 'r', children: [{ id: 'f', title: 'Пустая' }] }).children[0].children, []);
});

test('splitLeadingEmoji takes a leading emoji with or without a space', () => {
  assert.deepEqual(splitLeadingEmoji('🎌 Японский'), { emoji: '🎌', title: 'Японский' });
  assert.deepEqual(splitLeadingEmoji('📚Книги'), { emoji: '📚', title: 'Книги' });
  assert.deepEqual(splitLeadingEmoji('  🔥  Горячее '), { emoji: '🔥', title: 'Горячее' });
});

test('splitLeadingEmoji keeps complex emoji whole', () => {
  assert.deepEqual(splitLeadingEmoji('👨‍💻 Работа'), { emoji: '👨‍💻', title: 'Работа' });
  assert.deepEqual(splitLeadingEmoji('🇯🇵 Япония'), { emoji: '🇯🇵', title: 'Япония' });
  assert.deepEqual(splitLeadingEmoji('👍🏽 Ок'), { emoji: '👍🏽', title: 'Ок' });
  assert.deepEqual(splitLeadingEmoji('❤️ Любимое'), { emoji: '❤️', title: 'Любимое' });
  assert.deepEqual(splitLeadingEmoji('1️⃣ Первое'), { emoji: '1️⃣', title: 'Первое' });
});

test('splitLeadingEmoji ignores text, digits and text-style symbols', () => {
  for (const title of ['Подкаст', 'Arzamas', '2024 отчёты', '© Права', '™ Бренд', '#теги', 'Папка 🎌']) {
    assert.deepEqual(splitLeadingEmoji(title), { emoji: null, title }, title);
  }
});

test('splitLeadingEmoji with an emoji-only or empty title', () => {
  assert.deepEqual(splitLeadingEmoji('🎌'), { emoji: '🎌', title: '' });
  assert.deepEqual(splitLeadingEmoji(''), { emoji: null, title: '' });
  assert.deepEqual(splitLeadingEmoji(undefined), { emoji: null, title: '' });
});

test('hostOf strips www and survives bad input', () => {
  assert.equal(hostOf('https://www.Example.com/path'), 'example.com');
  assert.equal(hostOf('https://admin.podcast.example.com/'), 'admin.podcast.example.com');
  assert.equal(hostOf('garbage'), '');
});

test('collectIds lists the root, all nodes and folders', () => {
  const { all, folders } = collectIds(buildTree(subTree));
  assert.deepEqual([...all].sort(), ['f1', 'f2', 'l1', 'l2', 'l3', 'root']);
  assert.deepEqual([...folders].sort(), ['f1', 'f2']);
});

test('isRelevantEvent: changes inside, moves in and out, the root itself', () => {
  const { all } = collectIds(buildTree(subTree));
  assert.ok(isRelevantEvent({ id: 'l2' }, all), 'rename inside');
  assert.ok(isRelevantEvent({ id: 'new', parentId: 'f2' }, all), 'created inside');
  assert.ok(isRelevantEvent({ id: 'ext', parentId: 'f1', oldParentId: 'elsewhere' }, all), 'moved in');
  assert.ok(isRelevantEvent({ id: 'l1', parentId: 'elsewhere', oldParentId: 'root' }, all), 'moved out');
  assert.ok(isRelevantEvent({ id: 'root' }, all), 'root renamed or removed');
  assert.ok(!isRelevantEvent({ id: 'other', parentId: 'bar' }, all), 'someone else’s bookmark');
  assert.ok(!isRelevantEvent({ id: 'a', parentId: 'b', oldParentId: 'c' }, all), 'move elsewhere');
});

test('toggleId, pruneIds and sameIds', () => {
  assert.deepEqual(toggleId([], 'a'), ['a']);
  assert.deepEqual(toggleId(['a', 'b'], 'a'), ['b']);
  const ids = ['a', 'b'];
  toggleId(ids, 'c');
  assert.deepEqual(ids, ['a', 'b'], 'does not mutate');
  assert.deepEqual(pruneIds(['f1', 'gone', 'f2'], new Set(['f1', 'f2'])), ['f1', 'f2']);
  assert.ok(sameIds(['a', 'b'], ['a', 'b']));
  assert.ok(!sameIds(['a', 'b'], ['b', 'a']));
  assert.ok(!sameIds(['a'], ['a', 'b']));
});

test('fallbackIcon: letter from the domain, stable hue', () => {
  const a = fallbackIcon('https://www.boosty.to/podcast', 'Boosty');
  assert.equal(a.letter, 'B');
  assert.deepEqual(fallbackIcon('https://boosty.to/other', 'X'), a, 'same domain → same icon');
  assert.ok(a.hue >= 0 && a.hue < 360);
  assert.equal(fallbackIcon('garbage', 'яндекс').letter, 'Я');
  assert.equal(fallbackIcon('garbage', '').letter, '?');
});

test('collectLinks lists links in display order, nested ones included', () => {
  const links = collectLinks(buildTree(subTree));
  assert.deepEqual(links.map((link) => link.id), ['l1', 'l2', 'l3']);
  assert.equal(links[1].url, 'https://vk.com/podcast');
});

test('nodesById finds links and folders at any depth', () => {
  const tree = buildTree(subTree);
  const nodes = nodesById(tree);
  assert.deepEqual([...nodes.keys()], ['l1', 'f1', 'l2', 'f2', 'l3']);
  assert.equal(nodes.get('f2').kind, 'folder');
  assert.equal(nodes.get('l2').url, 'https://vk.com/podcast');
});

test('peekLinks: every open link of a collapsed folder, in tree order', () => {
  const tree = buildTree({ id: 'root', children: [
    { id: 'l0', title: 'Top', url: 'https://top.example/' },
    { id: 'f1', title: 'Подкаст', children: [
      { id: 'a', title: 'A', url: 'https://a.example/' },
      { id: 'b', title: 'B', url: 'https://b.example/' },
      { id: 'c', title: 'C', url: 'https://c.example/' },
    ] },
  ] });
  const open = new Set(['l0', 'a', 'c']);
  const peeks = peekLinks(tree.children, new Set(), (link) => open.has(link.id));
  assert.deepEqual([...peeks.keys()], ['f1']);
  assert.deepEqual(peeks.get('f1').map((link) => link.id), ['a', 'c']);
  assert.equal(peekLinks(tree.children, new Set(['f1']), (link) => open.has(link.id)).size, 0);
});

test('peekLinks: nested folders show under the outermost collapsed one', () => {
  const tree = buildTree({ id: 'root', children: [
    { id: 'f1', title: 'Outer', children: [
      { id: 'a', title: 'A', url: 'https://a.example/' },
      { id: 'f2', title: 'Inner', children: [{ id: 'b', title: 'B', url: 'https://b.example/' }] },
    ] },
  ] });
  const all = () => true;
  assert.deepEqual(peekLinks(tree.children, new Set(), all).get('f1').map((link) => link.id), ['a', 'b']);
  const innerOnly = peekLinks(tree.children, new Set(['f1']), all);
  assert.deepEqual([...innerOnly.keys()], ['f2']);
  assert.deepEqual(innerOnly.get('f2').map((link) => link.id), ['b']);
  assert.equal(peekLinks(tree.children, new Set(), () => false).size, 0);
});
