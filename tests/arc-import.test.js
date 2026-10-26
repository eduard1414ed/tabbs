import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importedTops, findArcImport, defaultArcSort, planArcSort, undoSteps, hasBuiltInArcImport } from '../extension/lib/arc-import.js';

// What Helium 0.20.1.1 made of an Arc sidebar like Ed's, on a bookmarks bar that wasn't empty.
const link = (id, title) => ({ id, title, url: `https://${id}.example.com/` });
const WORK = '6C17F165-82DB-4BA5-8DB8-970992D77EF6';
const JAPANESE = 'E1F67AC4-1EF0-47A2-913E-7E8ED04A5AEB';
const imported = () => ({
  id: '39', title: 'Импортировано из Arc (1)', children: [
    link('40', 'Calendar'),
    link('41', 'YouTube'),
    { id: '42', title: 'Personal', children: [link('43', 'Crunchyroll'), link('44', 'Football'), link('45', 'AniList'), link('46', 'YouTube')] },
    { id: '47', title: WORK, children: [
      link('48', 'Drive'),
      { id: '50', title: 'Podcast', children: [{ id: '51', title: 'Site', children: [link('52', 'Admin')] }, link('53', 'Channel')] },
      link('54', 'Hosting'),
    ] },
    { id: '65', title: JAPANESE, children: [] },
  ],
});

test('importedTops: what an import put at the top level, not inside its own folders', () => {
  const created = [
    { id: '6', parentId: '1' }, { id: '7', parentId: '1' }, { id: '8', parentId: '1' },
    { id: '9', parentId: '8' }, { id: '10', parentId: '9' }, { id: '14', parentId: '8' },
  ];
  assert.deepEqual(importedTops(created), ['6', '7', '8']);
  assert.deepEqual(importedTops([]), []);
});

test('findArcImport: favorites, then spaces with their items, links and a preview', () => {
  const found = findArcImport([imported()]);
  assert.deepEqual(found.containers, ['39']);
  assert.deepEqual(found.favorites, [{ id: '40', title: 'Calendar' }, { id: '41', title: 'YouTube' }]);
  assert.deepEqual(found.spaces.map(({ id, personal, children, links, folders, preview }) => ({ id, personal, children, links, folders, preview })), [
    { id: '42', personal: true, children: ['43', '44', '45', '46'], links: 4, folders: 0, preview: ['Crunchyroll', 'Football', 'AniList'] },
    { id: '47', personal: false, children: ['48', '50', '54'], links: 4, folders: 2, preview: ['Drive', 'Admin', 'Channel'] },
    { id: '65', personal: false, children: [], links: 0, folders: 0, preview: [] },
  ]);
});

test('findArcImport: an empty bookmarks bar — the favorites lie on the bar next to the folder', () => {
  const folder = imported();
  folder.title = 'Imported from Arc';
  folder.children = folder.children.filter((node) => node.children);
  const found = findArcImport([link('6', 'Calendar'), link('7', 'YouTube'), folder]);
  assert.deepEqual(found.favorites.map((node) => node.id), ['6', '7']);
  assert.equal(found.spaces.length, 3);
});

test('findArcImport: an import from another browser or a bookmarks file is not Arc\'s', () => {
  assert.equal(findArcImport([{ id: '8', title: 'Imported from Safari', children: [link('9', 'News'), { id: '10', title: 'Work', children: [] }] }]), null);
  assert.equal(findArcImport([link('11', 'A page')]), null);
  assert.equal(findArcImport([]), null);
  // Arc's folder that ended up empty.
  assert.equal(findArcImport([{ id: '12', title: 'Imported from Arc', children: [] }]), null);
});

test('findArcImport: favorites only — the folder is known by its name', () => {
  const found = findArcImport([{ id: '13', title: 'Imported from Arc', children: [link('14', 'Mail')] }]);
  assert.deepEqual(found.favorites, [{ id: '14', title: 'Mail' }]);
  assert.deepEqual(found.spaces, []);
});

test('defaultArcSort: spaces off — Personal on top, the rest as folders; on — all new spaces', () => {
  const found = findArcImport([imported()]);
  assert.deepEqual(defaultArcSort(found), {
    favorites: true,
    spaces: [
      { id: '42', mode: 'top', title: 'Personal', into: null },
      { id: '47', mode: 'folder', title: '', into: null },
      { id: '65', mode: 'folder', title: '', into: null },
    ],
  });
  assert.deepEqual(defaultArcSort(found, { spaces: true }).spaces.map((space) => space.mode), ['space', 'space', 'space']);
});

test('planArcSort: favorites into a new folder, Personal on top, a named folder, a skipped space', () => {
  const found = findArcImport([imported()]);
  const plan = planArcSort(found, {
    favorites: true,
    spaces: [
      { id: '42', mode: 'top', title: 'Personal' },
      { id: '47', mode: 'folder', title: '  Work ' },
      { id: '65', mode: 'skip', title: 'Japanese' },
    ],
  }, { favoritesExists: false, untitled: (n) => `Space ${n}` });
  assert.deepEqual(plan.favorites, { create: true, ids: ['40', '41'] });
  assert.deepEqual(plan.top, ['43', '44', '45', '46']);
  assert.deepEqual(plan.folders, [{ id: '47', title: 'Work' }]);
  assert.deepEqual(plan.spaces, []);
  assert.deepEqual(plan.into, []);
  assert.deepEqual(plan.cleanup, ['42', '39']); // Personal, emptied, then Helium's folder
  assert.equal(plan.links, 2 + 4 + 4);
  assert.equal(plan.folderCount, 1 + 2 + 1); // favorites, Work's two folders, Work itself
});

test('planArcSort: an existing favorites folder is filled; an empty name gets the n-th space\'s', () => {
  const found = findArcImport([imported()]);
  const plan = planArcSort(found, {
    favorites: true,
    spaces: [{ id: '47', mode: 'folder', title: '' }, { id: '65', mode: 'folder' }],
  }, { favoritesExists: true, untitled: (n) => `Space ${n}` });
  assert.equal(plan.favorites.create, false);
  assert.deepEqual(plan.folders, [{ id: '47', title: 'Space 2' }, { id: '65', title: 'Space 3' }]);
  assert.deepEqual(plan.top, []);
});

test('planArcSort: spaces on — new spaces and items into an existing one', () => {
  const found = findArcImport([imported()]);
  const plan = planArcSort(found, {
    favorites: false,
    spaces: [
      { id: '42', mode: 'into', into: '900' },
      { id: '47', mode: 'space', title: '💼 Work' },
      { id: '65', mode: 'into', into: null }, // no space picked — nothing happens
    ],
  }, { untitled: (n) => `Space ${n}` });
  assert.equal(plan.favorites, null);
  assert.deepEqual(plan.into, [{ target: '900', ids: ['43', '44', '45', '46'] }]);
  assert.deepEqual(plan.spaces, [{ id: '47', title: '💼 Work' }]);
  assert.deepEqual(plan.cleanup, ['42', '39']);
  assert.equal(plan.links, 8);
});

test('planArcSort: unknown and repeated spaces are skipped; no favorites — none taken', () => {
  const found = findArcImport([imported()]);
  found.favorites = [];
  const plan = planArcSort(found, {
    favorites: true,
    spaces: [{ id: 'nope', mode: 'top' }, { id: '42', mode: 'top' }, { id: '42', mode: 'folder' }],
  }, {});
  assert.equal(plan.favorites, null);
  assert.deepEqual(plan.top, ['43', '44', '45', '46']);
  assert.deepEqual(plan.folders, []);
});

test('planArcSort: a folder\'s or a space\'s icon — an emoji in front of the name, a pictogram aside', () => {
  const found = findArcImport([imported()]);
  const plan = planArcSort(found, {
    favorites: false,
    spaces: [
      { id: '42', mode: 'folder', title: 'Personal', icon: { emoji: '🏠' } },
      { id: '47', mode: 'space', title: 'Work', icon: { pictogram: 'briefcase' } },
      { id: '65', mode: 'folder', title: 'Japanese', icon: null },
    ],
  }, { untitled: (n) => `Space ${n}` });
  assert.deepEqual(plan.folders, [{ id: '42', title: '🏠 Personal' }, { id: '65', title: 'Japanese' }]);
  assert.deepEqual(plan.spaces, [{ id: '47', title: 'Work', pictogram: 'briefcase' }]);
});

test('undoSteps: the last step is taken back first', () => {
  const log = [{ created: { id: '100' } }, { moved: { id: '40', parentId: '39', index: 0 } }, { moved: { id: '41', parentId: '39', index: 0 } }];
  assert.deepEqual(undoSteps(log).map((step) => step.moved?.id ?? step.created.id), ['41', '40', '100']);
  assert.equal(log[0].created.id, '100'); // the log itself stays as it was
});

test('hasBuiltInArcImport: Helium and Chrome yes; Brave, Edge, Opera no', () => {
  const chrome = [{ brand: 'Chromium', version: '156' }, { brand: 'Google Chrome', version: '156' }];
  assert.equal(hasBuiltInArcImport({ brands: chrome }), true);
  assert.equal(hasBuiltInArcImport({ brands: chrome, brave: true }), false);
  assert.equal(hasBuiltInArcImport({ brands: [{ brand: 'Microsoft Edge', version: '140' }] }), false);
  assert.equal(hasBuiltInArcImport({ brands: [{ brand: 'Opera', version: '120' }] }), false);
  assert.equal(hasBuiltInArcImport(), true);
});
