import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseArcSidebar, findSpace, arcRootTree, countNodes, bookmarksHtml, planArcImport, planArcSpacesImport, defaultSpaceFor, ARC_PICTOGRAMS } from '../extension/lib/arc.js';
import { PICTOGRAMS } from '../extension/lib/pictograms.js';

// A made-up piece of Arc's StorableSidebar.json with the same structure.
const sidebar = JSON.parse(readFileSync(new URL('./fixtures/arc-sidebar.json', import.meta.url), 'utf8'));
const parsed = parseArcSidebar(sidebar);

test('parseArcSidebar: favorites, with page titles or the domain when Arc has no name', () => {
  assert.deepEqual(parsed.favorites, [
    { title: 'Calendar - Week 42', url: 'https://calendar.example.com/week' },
    { title: 'video.example.com', url: 'https://video.example.com/' },
  ]);
});

test('parseArcSidebar: pinned items of each space, nested folders, Arc names first', () => {
  assert.deepEqual(parsed.spaces.map((space) => space.title), ['Home', 'Hobby']);
  assert.deepEqual(parsed.spaces[0].items, [
    { title: 'Disk', url: 'https://disk.example.com/my' },
    { title: 'Podcast', children: [
      { title: 'Site', children: [
        { title: 'Robots — Podcast <admin>', url: 'https://podcast.example.com/admin?a=1&b=2' },
      ] },
      { title: 'Social "page"', url: 'https://social.example.com/podcast' },
    ] },
    { title: 'Notes & ideas', url: 'https://notes.example.com/' },
  ]);
  assert.deepEqual(parsed.spaces[1].items, [{ title: 'Board', url: 'https://board.example.com/' }]);
});

test('parseArcSidebar: "today" tabs are not taken; a lost id and an unknown kind are skipped', () => {
  const urls = JSON.stringify(parsed);
  assert.ok(!urls.includes('today.example.com'));
  assert.equal(parsed.skipped, 2);
});

test('parseArcSidebar: not an Arc file', () => {
  assert.throws(() => parseArcSidebar({}), /not Arc/);
  assert.throws(() => parseArcSidebar({ sidebar: { containers: [{ global: {} }] } }), /not Arc/);
});

test('findSpace: by name, case aside', () => {
  assert.equal(findSpace(parsed, 'hobby').title, 'Hobby');
  assert.equal(findSpace(parsed, 'Work'), null);
});

test('arcRootTree: favorites first, one space at the top level, others as folders', () => {
  const tree = arcRootTree(parsed, { rootSpace: 'Home', folderSpaces: ['Hobby'] });
  assert.deepEqual(tree.map((node) => node.title), ['Favorites', 'Disk', 'Podcast', 'Notes & ideas', 'Hobby']);
  assert.equal(arcRootTree(parsed, { rootSpace: 'Home', favoritesTitle: 'Избранное' })[0].title, 'Избранное');
  assert.equal(tree[0].children.length, 2);
  assert.deepEqual(tree[4].children, parsed.spaces[1].items);
  assert.deepEqual(countNodes(tree), { links: 7, folders: 4 });
});

test('arcRootTree: only folders, no favorites, unknown space', () => {
  const noFavorites = { ...parsed, favorites: [] };
  assert.deepEqual(arcRootTree(noFavorites, { folderSpaces: ['Home', 'Hobby'] }).map((node) => node.title), ['Home', 'Hobby']);
  assert.throws(() => arcRootTree(parsed, { rootSpace: 'Work' }), /No space "Work"/);
});

test('bookmarksHtml: one root folder with everything nested inside, escaped', () => {
  const html = bookmarksHtml(arcRootTree(parsed, { rootSpace: 'Home', folderSpaces: ['Hobby'] }), 'Shelf');
  assert.ok(html.startsWith('<!DOCTYPE NETSCAPE-Bookmark-file-1>'));
  assert.ok(html.includes('charset=UTF-8'));
  const lines = html.split('\n').map((line) => line.trim());
  assert.equal(lines.filter((line) => line === '<DT><H3>Shelf</H3>').length, 1);
  assert.ok(lines.includes('<DT><A HREF="https://podcast.example.com/admin?a=1&amp;b=2">Robots — Podcast &lt;admin&gt;</A>'));
  assert.ok(lines.includes('<DT><A HREF="https://social.example.com/podcast">Social &quot;page&quot;</A>'));
  assert.ok(lines.includes('<DT><A HREF="https://notes.example.com/">Notes &amp; ideas</A>'));
  // Every folder is opened and closed.
  assert.equal(lines.filter((line) => line === '<DL><p>').length, lines.filter((line) => line === '</DL><p>').length);
  assert.equal(lines.filter((line) => line.startsWith('<DT><A ')).length, 7);
});

test('bookmarksHtml: nesting follows the tree', () => {
  const html = bookmarksHtml([{ title: 'F', children: [{ title: 'a', url: 'https://a.example/' }] }], 'Tabbs');
  assert.match(html, /^ {4}<DT><H3>Tabbs<\/H3>$/m);
  assert.match(html, /^ {8}<DT><H3>F<\/H3>$/m);
  assert.match(html, /^ {12}<DT><A HREF="https:\/\/a\.example\/">a<\/A>$/m);
});

const titles = (nodes) => nodes.map((node) => node.title);

test('planArcImport: favorites into a new folder, one space on top, the other as a folder', () => {
  const plan = planArcImport(parsed, { favorites: true, top: 0, folders: [1] }, { favoritesTitle: 'Favorites' });
  assert.deepEqual(plan.favorites, { create: true, title: 'Favorites', children: parsed.favorites });
  assert.deepEqual(titles(plan.root), ['Disk', 'Podcast', 'Notes & ideas', 'Hobby']);
  assert.deepEqual(plan.root[3].children, parsed.spaces[1].items);
  // 2 favorites + 4 links of Home (one deep in two folders) + 1 of Hobby; folders: Favorites, Podcast, Site, Hobby
  assert.deepEqual([plan.links, plan.folders], [7, 4]);
});

test('planArcImport: the same layout as the stage 4b script', () => {
  const plan = planArcImport(parsed, { favorites: true, top: 0, folders: [1] }, { favoritesTitle: 'Избранное' });
  const script = arcRootTree(parsed, { rootSpace: 'Home', folderSpaces: ['Hobby'], favoritesTitle: 'Избранное' });
  assert.deepEqual([{ title: plan.favorites.title, children: plan.favorites.children }, ...plan.root], script);
  assert.deepEqual({ links: plan.links, folders: plan.folders }, countNodes(script));
});

test('planArcImport: an existing favorites folder is filled, not created', () => {
  const plan = planArcImport(parsed, { favorites: true, top: null, folders: [] }, { favoritesTitle: 'Favorites', favoritesExists: true });
  assert.equal(plan.favorites.create, false);
  assert.deepEqual(plan.root, []);
  assert.deepEqual([plan.links, plan.folders], [2, 0]);
});

test('planArcImport: nothing on top, folders in Arc\'s order, the top space never doubles as a folder', () => {
  const plan = planArcImport(parsed, { favorites: false, top: null, folders: [1, 0, 1] }, { favoritesTitle: 'F' });
  assert.equal(plan.favorites, null);
  assert.deepEqual(titles(plan.root), ['Home', 'Hobby']);
  const same = planArcImport(parsed, { favorites: false, top: 1, folders: [0, 1] }, { favoritesTitle: 'F' });
  assert.deepEqual(titles(same.root), ['Board', 'Home']);
});

test('planArcImport: no favorites in Arc, an unnamed space, unknown indexes', () => {
  const bare = { favorites: [], spaces: [{ title: '', items: [] }], skipped: 0 };
  const plan = planArcImport(bare, { favorites: true, top: 7, folders: [0, 5] }, { favoritesTitle: 'F', untitledTitle: 'Untitled' });
  assert.equal(plan.favorites, null);
  assert.deepEqual(plan.root, [{ title: 'Untitled', children: [] }]);
  assert.deepEqual([plan.links, plan.folders], [0, 1]);
});

test('parseArcSidebar: space icons — an emoji as is, Apple\'s symbols by the table, the rest none', () => {
  assert.deepEqual(parsed.spaces.map((space) => space.emoji), ['🏡', '🎮']);
  const icons = (iconType) => parseArcSidebar({ sidebar: { containers: [{ spaces: [
    'X', { id: 'X', title: 'X', customInfo: { iconType }, containerIDs: ['pinned', 'P'] },
  ], items: [] }] } }).spaces[0]?.emoji;
  assert.equal(icons({ icon: 'fileTrayFull' }), '🗂️');
  assert.equal(icons({ icon: 'video' }), '🎬');
  assert.equal(icons({ icon: 'receipt' }), '🧾');
  assert.equal(icons({ icon: 'somethingNew' }), null);
  assert.equal(icons({ emoji: 0x1f3a8 }), '🎨');
  assert.equal(icons({ emoji_v2: 'abc' }), null);
  assert.equal(icons(undefined), null);
});

test('planArcSpacesImport: new spaces named with Arc\'s icon, existing ones get the items', () => {
  const plan = planArcSpacesImport(parsed, { favorites: true, spaces: [{ index: 0, into: null }, { index: 1, into: '42' }] },
    { favoritesTitle: 'Favorites' });
  assert.deepEqual(plan.favorites, { create: true, title: 'Favorites', children: parsed.favorites });
  assert.deepEqual(plan.spaces, [
    { into: null, title: '🏡 Home', children: parsed.spaces[0].items },
    { into: '42', title: 'Hobby', children: parsed.spaces[1].items }, // the title of an existing one isn't used
  ]);
  // 2 favorites + 4 + 1 links; folders: Favorites, Podcast, Site and the new Home space
  assert.deepEqual([plan.links, plan.folders], [7, 4]);
});

test('planArcSpacesImport: unticked and unknown spaces skipped, each at most once', () => {
  const plan = planArcSpacesImport(parsed, { favorites: false, spaces: [{ index: 1, into: null }, { index: 1, into: '7' }, { index: 9 }] },
    { favoritesTitle: 'F', favoritesExists: true });
  assert.equal(plan.favorites, null);
  assert.deepEqual(plan.spaces.map((space) => [space.into, space.title]), [[null, '🎮 Hobby']]);
  assert.deepEqual([plan.links, plan.folders], [1, 1]);
  const bare = { favorites: [], spaces: [{ title: '', emoji: null, items: [] }], skipped: 0 };
  assert.deepEqual(planArcSpacesImport(bare, { favorites: true, spaces: [{ index: 0, into: null }] },
    { favoritesTitle: 'F', untitledTitle: 'Untitled' }).spaces, [{ into: null, title: 'Untitled', children: [] }]);
});

test('parseArcSidebar: Apple\'s symbols also get the nearest pictogram, Arc\'s emoji none', () => {
  const icon = (iconType) => {
    const [space] = parseArcSidebar({ sidebar: { containers: [{ spaces: [
      'X', { id: 'X', title: 'X', customInfo: { iconType }, containerIDs: ['pinned', 'P'] },
    ], items: [] }] } }).spaces;
    return [space.emoji, space.pictogram];
  };
  assert.deepEqual(icon({ icon: 'briefcase' }), ['💼', 'briefcase']);
  assert.deepEqual(icon({ icon: 'fileTrayFull' }), ['🗂️', 'tray']);
  assert.deepEqual(icon({ emoji: 0x1f3a8 }), ['🎨', null]);
  assert.deepEqual(icon({ icon: 'somethingNew' }), [null, null]);
  assert.deepEqual(icon(undefined), [null, null]);
});

test('ARC_PICTOGRAMS: every pictogram is in the set', () => {
  for (const [arc, name] of Object.entries(ARC_PICTOGRAMS)) assert.ok(Object.hasOwn(PICTOGRAMS, name), `${arc} → ${name}`);
});

test('planArcImport: the folders\' icons — an emoji in front of the name, a pictogram on the node', () => {
  const plan = planArcImport(parsed, { favorites: false, top: null, folders: [0, 1], icons: { 0: { pictogram: 'house' }, 1: { emoji: '🎮' } } },
    { favoritesTitle: 'F' });
  assert.deepEqual(plan.root.map((node) => [node.title, node.pictogram]), [['Home', 'house'], ['🎮 Hobby', undefined]]);
});

test('planArcSpacesImport: the icon picked — a pictogram, an emoji or none — instead of Arc\'s', () => {
  const plan = planArcSpacesImport(parsed, { favorites: false, spaces: [
    { index: 0, into: null, icon: { pictogram: 'house' } },
    { index: 1, into: null, icon: null },
  ] }, { favoritesTitle: 'F' });
  assert.deepEqual(plan.spaces.map((space) => [space.title, space.pictogram]), [['Home', 'house'], ['Hobby', undefined]]);
  const emoji = planArcSpacesImport(parsed, { favorites: false, spaces: [{ index: 0, into: null, icon: { emoji: '🏠' } }] }, { favoritesTitle: 'F' });
  assert.equal(emoji.spaces[0].title, '🏠 Home');
});

test('defaultSpaceFor: the same name, case and emoji aside, else a new space', () => {
  const spaces = [{ id: '1', title: '💼 Work' }, { id: '2', title: 'Watch' }, { id: '3', title: '' }];
  assert.equal(defaultSpaceFor('work', spaces), '1');
  assert.equal(defaultSpaceFor('🎬 WATCH', spaces), '2');
  assert.equal(defaultSpaceFor('Japanese', spaces), null);
  assert.equal(defaultSpaceFor('', spaces), null);
});
