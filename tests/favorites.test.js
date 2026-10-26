import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findFavorites, splitFavorites, tileColumns } from '../extension/lib/favorites.js';
import { buildTree, collectLinks } from '../extension/lib/tree.js';
import { splitWindowTabs } from '../extension/lib/tabs.js';

const link = (id, title = id) => ({ id, title, url: `https://${id}.com/` });
const folder = (id, title, children = []) => ({ id, title, children });
const tree = (...children) => buildTree({ id: 'root', children });

test('findFavorites: the top-level folder named "Избранное"', () => {
  assert.equal(findFavorites(tree(link('a'), folder('F', 'Избранное', [link('b')]))).id, 'F');
  assert.equal(findFavorites(tree(folder('F', '  избранное '))).id, 'F', 'case and spaces');
  assert.equal(findFavorites(tree(folder('F', '⭐ Избранное'))).id, 'F', 'with an emoji');
  assert.equal(findFavorites(tree(folder('F', 'ИЗБРАННОЕ'))).id, 'F');
});

test('findFavorites: "Favorites" in English, the same rules', () => {
  assert.equal(findFavorites(tree(link('a'), folder('F', 'Favorites', [link('b')]))).id, 'F');
  assert.equal(findFavorites(tree(folder('F', ' favorites '))).id, 'F', 'case and spaces');
  assert.equal(findFavorites(tree(folder('F', '⭐ FAVORITES'))).id, 'F', 'with an emoji');
  assert.equal(findFavorites(tree(folder('F', 'Favorite'))), null);
  assert.equal(findFavorites(tree(folder('E', 'Favorites'), folder('R', 'Избранное'))).id, 'E', 'the first in the tree');
  assert.equal(findFavorites(tree(folder('R', 'Избранное'), folder('E', 'Favorites'))).id, 'R');
});

test('findFavorites: what does not count', () => {
  assert.equal(findFavorites(tree()), null);
  assert.equal(findFavorites(tree(folder('B', 'Подкаст', [folder('F', 'Избранное')]))), null, 'nested');
  assert.equal(findFavorites(tree({ id: 'x', title: 'Избранное', url: 'https://x.com' })), null, 'a link');
  assert.equal(findFavorites(tree(folder('F', 'Избранное 2'))), null);
  assert.equal(findFavorites(tree(folder('F', 'Моё избранное'))), null);
});

test('findFavorites: the first of two', () => {
  assert.equal(findFavorites(tree(folder('A', 'Подкаст'), folder('F1', 'Избранное'), folder('F2', 'Избранное'))).id, 'F1');
});

test('splitFavorites: tiles are the links of the folder, the tree is the rest', () => {
  const t = tree(
    link('drive'),
    folder('F', 'Избранное', [link('cal'), folder('sub', 'Папка', [link('deep')]), link('yt')]),
    folder('B', 'Подкаст', [link('vk')]),
  );
  const { favorites, tiles, rest } = splitFavorites(t);
  assert.equal(favorites.id, 'F');
  assert.deepEqual(tiles.map((node) => node.id), ['cal', 'yt'], 'folders inside are not shown');
  assert.deepEqual(rest.map((node) => node.id), ['drive', 'B']);
});

test('splitFavorites: no favorites — everything is the tree', () => {
  const t = tree(link('a'), folder('B', 'Подкаст'));
  const { favorites, tiles, rest } = splitFavorites(t);
  assert.equal(favorites, null);
  assert.deepEqual(tiles, []);
  assert.equal(rest, t.children);
});

test('tabs of tiles are not shown below the divider; of hidden links — are', () => {
  const t = tree(folder('F', 'Избранное', [link('cal'), folder('sub', 'Папка', [link('deep')])]), link('a'));
  const { tiles, rest } = splitFavorites(t);
  const shown = new Set(collectLinks({ children: [...tiles, ...rest] }).map((node) => node.id));
  const tabs = [1, 2, 3, 4].map((id, index) => ({ id, index, windowId: 1, url: `https://t${id}.com/` }));
  const bindings = new Map([['cal', 1], ['deep', 2], ['a', 3]]);
  const { inFolders, loose } = splitWindowTabs(tabs, bindings, shown, 1);
  assert.deepEqual([...inFolders.keys()], ['cal', 'a']);
  assert.deepEqual(loose.map((tab) => tab.id), [2, 4]);
});

// Panel content width 244px (panel 260px minus padding), tiles at least 56px, gaps 6px.
const size = { minWidth: 56, gap: 6 };

test('tileColumns: fewer tiles than fit — one row', () => {
  assert.equal(tileColumns(1, 244, size), 1);
  assert.equal(tileColumns(2, 244, size), 2);
  assert.equal(tileColumns(3, 244, size), 3);
  assert.equal(tileColumns(4, 244, size), 4); // (244 + 6) / 62 → 4 fit
});

test('tileColumns: rows are evened out', () => {
  assert.equal(tileColumns(5, 244, size), 3); // 3 + 2, not 4 + 1
  assert.equal(tileColumns(6, 244, size), 3); // 3 + 3
  assert.equal(tileColumns(7, 244, size), 4); // 4 + 3
  assert.equal(tileColumns(9, 244, size), 3); // 3 + 3 + 3
  assert.equal(tileColumns(4, 180, size), 2); // 3 fit → 2 + 2
});

test('tileColumns: a narrow panel still has 2 in a row, a wide one more', () => {
  assert.equal(tileColumns(6, 100, size), 2);
  assert.equal(tileColumns(6, 0, size), 2);
  assert.equal(tileColumns(6, 400, size), 6);
  assert.equal(tileColumns(12, 400, size), 6);
  assert.equal(tileColumns(0, 244, size), 1);
});
