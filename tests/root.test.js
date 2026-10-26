import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROOT_ID_KEY,
  pickOtherBookmarks,
  findFolderByTitle,
  findFolderByTitles,
  locateRootFolder,
  ensureRootFolder,
} from '../extension/lib/root.js';
import { rootFolderTitles } from '../extension/lib/strings.js';

// A copy under its own name (like the author's): the public build's name is found too.
const TITLE = 'Shelf';
const OLD_TITLE = 'Tabbs';
const TITLES = rootFolderTitles(TITLE);

// Minimal in-memory stand-in for chrome.bookmarks (promise API).
function fakeBookmarks(topLevel) {
  const root = { id: 'root', title: '', children: topLevel };
  const byId = new Map();
  const index = (node, parentId) => {
    if (parentId !== undefined) node.parentId = parentId;
    byId.set(node.id, node);
    for (const child of node.children ?? []) index(child, node.id);
  };
  index(root);
  let nextId = 1000;
  const calls = { create: [] };
  return {
    calls,
    async get(id) {
      const node = byId.get(id);
      if (!node) throw new Error(`Can't find bookmark for id.`);
      return [node];
    },
    async getTree() {
      return [root];
    },
    async create({ parentId, title, url }) {
      calls.create.push({ parentId, title, url });
      const node = { id: String(nextId++), parentId, title, ...(url ? { url } : { children: [] }) };
      byId.get(parentId).children.push(node);
      byId.set(node.id, node);
      return node;
    },
  };
}

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    async get(key) {
      return key in data ? { [key]: data[key] } : {};
    },
    async set(items) {
      Object.assign(data, items);
    },
  };
}

// Typical modern Chromium top level; ids deliberately not "1"/"2".
function standardTree(otherChildren = []) {
  return [
    { id: 'bar', title: 'Bookmarks bar', folderType: 'bookmarks-bar', children: [
      { id: 'b1', title: 'Some site', url: 'https://example.com/' },
    ] },
    { id: 'other', title: 'Other bookmarks', folderType: 'other', children: otherChildren },
    { id: 'mobile', title: 'Mobile bookmarks', folderType: 'mobile', children: [] },
  ];
}

test('pickOtherBookmarks finds the folder by folderType, not by position', () => {
  const topLevel = [
    { id: 'x', folderType: 'other', children: [] },
    { id: 'y', folderType: 'bookmarks-bar', children: [] },
  ];
  assert.equal(pickOtherBookmarks(topLevel).id, 'x');
});

test('pickOtherBookmarks prefers the local folder when there are several', () => {
  const topLevel = [
    { id: 'bar', folderType: 'bookmarks-bar', syncing: true, children: [] },
    { id: 'acc-other', folderType: 'other', syncing: true, children: [] },
    { id: 'local-other', folderType: 'other', syncing: false, children: [] },
  ];
  assert.equal(pickOtherBookmarks(topLevel).id, 'local-other');
});

test('pickOtherBookmarks falls back to the second top-level folder without folderType', () => {
  const topLevel = [
    { id: 'a', title: 'Bookmarks bar', children: [] },
    { id: 'b', title: 'Other bookmarks', children: [] },
    { id: 'c', title: 'Mobile bookmarks', children: [] },
  ];
  assert.equal(pickOtherBookmarks(topLevel).id, 'b');
});

test('pickOtherBookmarks returns null when nothing fits', () => {
  assert.equal(pickOtherBookmarks([]), null);
  assert.equal(pickOtherBookmarks(undefined), null);
  assert.equal(pickOtherBookmarks([{ id: 'bar', folderType: 'bookmarks-bar', children: [] }]), null);
});

test('findFolderByTitle ignores a bookmark with the same title', () => {
  const parent = { children: [
    { id: 'link', title: TITLE, url: 'https://example.com/' },
    { id: 'folder', title: TITLE, children: [] },
  ] };
  assert.equal(findFolderByTitle(parent, TITLE).id, 'folder');
  assert.equal(findFolderByTitle({ children: [parent.children[0]] }, TITLE), null);
});

test('findFolderByTitles: the order of names wins', () => {
  const parent = { children: [
    { id: 'old', title: OLD_TITLE, children: [] },
    { id: 'new', title: TITLE, children: [] },
  ] };
  assert.equal(findFolderByTitles(parent, TITLES).id, 'new');
  assert.equal(findFolderByTitles({ children: [parent.children[0]] }, TITLES).id, 'old');
  assert.equal(findFolderByTitles({ children: [] }, TITLES), null);
});

test('locate finds a folder with the old name and keeps its id', async () => {
  const bookmarks = fakeBookmarks(standardTree([{ id: 'z', title: OLD_TITLE, children: [] }]));
  const storage = fakeStorage();
  const node = await locateRootFolder({ bookmarks, storage, titles: TITLES });
  assert.equal(node.id, 'z');
  assert.equal(storage.data[ROOT_ID_KEY], 'z');
  assert.equal(bookmarks.calls.create.length, 0);
});

test('locate uses the stored id even if the folder was renamed and moved', async () => {
  const bookmarks = fakeBookmarks(standardTree());
  const moved = await bookmarks.create({ parentId: 'bar', title: 'Renamed' });
  const storage = fakeStorage({ [ROOT_ID_KEY]: moved.id });
  const node = await locateRootFolder({ bookmarks, storage, titles: TITLES });
  assert.equal(node.id, moved.id);
});

test('locate finds the folder by title when the stored id is stale and saves the new id', async () => {
  const bookmarks = fakeBookmarks(standardTree([{ id: 'z', title: TITLE, children: [] }]));
  const storage = fakeStorage({ [ROOT_ID_KEY]: 'deleted-id' });
  const node = await locateRootFolder({ bookmarks, storage, titles: TITLES });
  assert.equal(node.id, 'z');
  assert.equal(storage.data[ROOT_ID_KEY], 'z');
});

test('locate ignores a stored id that points to a bookmark, not a folder', async () => {
  const bookmarks = fakeBookmarks(standardTree());
  const storage = fakeStorage({ [ROOT_ID_KEY]: 'b1' });
  assert.equal(await locateRootFolder({ bookmarks, storage, titles: TITLES }), null);
});

test('locate only looks directly inside "Other bookmarks"', async () => {
  const tree = standardTree([{ id: 'nested', title: 'Stuff', children: [{ id: 'deep', title: TITLE, children: [] }] }]);
  tree[0].children.push({ id: 'in-bar', title: TITLE, children: [] });
  const bookmarks = fakeBookmarks(tree);
  const storage = fakeStorage();
  assert.equal(await locateRootFolder({ bookmarks, storage, titles: TITLES }), null);
  assert.deepEqual(storage.data, {});
});

test('locate never creates anything', async () => {
  const bookmarks = fakeBookmarks(standardTree());
  const node = await locateRootFolder({ bookmarks, storage: fakeStorage(), titles: TITLES });
  assert.equal(node, null);
  assert.equal(bookmarks.calls.create.length, 0);
});

test('ensure creates the folder in "Other bookmarks" and stores its id', async () => {
  const bookmarks = fakeBookmarks(standardTree([{ id: 'o1', title: 'Old link', url: 'https://old.example/' }]));
  const storage = fakeStorage();
  const node = await ensureRootFolder({ bookmarks, storage, titles: TITLES });
  assert.deepEqual(bookmarks.calls.create, [{ parentId: 'other', title: TITLE, url: undefined }]);
  assert.equal(storage.data[ROOT_ID_KEY], node.id);

  // Second run finds it instead of creating a duplicate.
  const again = await ensureRootFolder({ bookmarks, storage: fakeStorage(), titles: TITLES });
  assert.equal(again.id, node.id);
  assert.equal(bookmarks.calls.create.length, 1);
});

test('ensure leaves other bookmarks untouched', async () => {
  const tree = standardTree([{ id: 'o1', title: 'Old link', url: 'https://old.example/' }]);
  const snapshot = structuredClone(tree);
  const bookmarks = fakeBookmarks(tree);
  await ensureRootFolder({ bookmarks, storage: fakeStorage(), titles: TITLES });
  const [root] = await bookmarks.getTree();
  const strip = (nodes) => nodes.map(({ parentId, children, ...rest }) =>
    children ? { ...rest, children: strip(children) } : rest);
  const after = strip(root.children);
  after[1].children = after[1].children.filter((node) => node.title !== TITLE);
  assert.deepEqual(after, strip(snapshot));
});

test('ensure uses the fallback when folderType is missing', async () => {
  const bookmarks = fakeBookmarks([
    { id: 'a', title: 'Bookmarks bar', children: [] },
    { id: 'b', title: 'Other bookmarks', children: [] },
  ]);
  await ensureRootFolder({ bookmarks, storage: fakeStorage(), titles: TITLES });
  assert.equal(bookmarks.calls.create[0].parentId, 'b');
});

test('ensure fails loudly instead of creating the folder in a random place', async () => {
  const bookmarks = fakeBookmarks([{ id: 'bar', folderType: 'bookmarks-bar', children: [] }]);
  await assert.rejects(ensureRootFolder({ bookmarks, storage: fakeStorage(), titles: TITLES }));
  assert.equal(bookmarks.calls.create.length, 0);
});

test('rootFolderTitles: the extension\'s name first, then the public one, no repeats', () => {
  assert.deepEqual(rootFolderTitles('Shelf'), ['Shelf', 'Tabbs']);
  assert.deepEqual(rootFolderTitles('Tabbs'), ['Tabbs']);
});

test('public build: creates "Tabbs" for a new user, other names aren\'t its folder', async () => {
  const bookmarks = fakeBookmarks(standardTree([
    { id: 'jp', title: 'Shelf', children: [] },
    { id: 'old', title: 'Bookmarks', children: [] },
  ]));
  const node = await ensureRootFolder({ bookmarks, storage: fakeStorage(), titles: rootFolderTitles('Tabbs') });
  assert.equal(node.title, 'Tabbs');
  assert.deepEqual(bookmarks.calls.create, [{ parentId: 'other', title: 'Tabbs', url: undefined }]);
});

test('a copy under its own name finds its "Shelf" or a "Tabbs" folder and leaves the name alone', async () => {
  for (const title of ['Shelf', 'Tabbs']) {
    const bookmarks = fakeBookmarks(standardTree([{ id: 'z', title, children: [] }]));
    const storage = fakeStorage();
    const node = await ensureRootFolder({ bookmarks, storage, titles: rootFolderTitles('Shelf') });
    assert.equal(node.id, 'z', title);
    assert.equal(node.title, title);
    assert.deepEqual(bookmarks.calls.create, []);
    assert.equal(storage.data[ROOT_ID_KEY], 'z');
  }
});

test('the stored id wins over the name: a folder renamed by the user is still the root', async () => {
  const bookmarks = fakeBookmarks(standardTree([
    { id: 'mine', title: 'My links', children: [] },
    { id: 'named', title: 'Tabbs', children: [] },
  ]));
  const node = await ensureRootFolder({ bookmarks, storage: fakeStorage({ [ROOT_ID_KEY]: 'mine' }), titles: rootFolderTitles('Tabbs') });
  assert.equal(node.id, 'mine');
  assert.deepEqual(bookmarks.calls.create, []);
});
