// Editing the tree from the panel. No chrome.* calls.
//
// Removing a link or a folder can be undone for a few seconds. Before removal the
// panel takes a snapshot of the subtree; undo creates the same bookmarks again
// (they get new ids) and moves the old ids' bindings, expanded state and pictograms onto them.
//
// Snapshot:
//   { parentId, index, node, expanded, bindings, pictograms }
//   node — { id, title, url } or { id, title, children: [node…] } (bookmark titles as is);
//   expanded — ids of folders of the subtree that were expanded;
//   bindings — Map bookmarkId → tabId for links of the subtree;
//   pictograms — Map folderId → pictogram name for folders of the subtree (lib/folder-icons.js).

function copyNode(node) {
  if (node.url !== undefined) return { id: node.id, title: node.title ?? '', url: node.url };
  return { id: node.id, title: node.title ?? '', children: (node.children ?? []).map(copyNode) };
}

function subtreeIds(node, ids = new Set()) {
  ids.add(node.id);
  for (const child of node.children ?? []) subtreeIds(child, ids);
  return ids;
}

// `bookmarkNode` is shaped like chrome.bookmarks.getSubTree(id)[0]:
// { id, parentId, index, title, url?, children? }.
export function snapshotSubtree(bookmarkNode, { expanded = [], bindings = new Map(), pictograms = new Map() } = {}) {
  const node = copyNode(bookmarkNode);
  const ids = subtreeIds(node);
  return {
    parentId: bookmarkNode.parentId,
    index: bookmarkNode.index,
    node,
    expanded: expanded.filter((id) => ids.has(id)),
    bindings: new Map([...bindings].filter(([id]) => ids.has(id))),
    pictograms: new Map([...pictograms].filter(([id]) => ids.has(id))),
  };
}

// Creates the snapshot's bookmarks again, in their old place:
//   create({ parentId, index?, title, url? }) → Promise<{ id }>  (chrome.bookmarks.create);
//   childCount(folderId) → Promise<number | null>, null if the folder is gone.
// If the old parent is gone, the subtree goes to the end of `fallbackParentId`.
// Returns Map oldId → newId.
export async function restoreSubtree(snapshot, { create, childCount, fallbackParentId }) {
  let parentId = snapshot.parentId;
  let count = await childCount(parentId);
  let index = snapshot.index;
  if (count === null) {
    parentId = fallbackParentId;
    count = await childCount(parentId);
    index = undefined;
  }
  if (count === null) throw new Error('Nowhere to restore the bookmarks to');
  index = Math.min(index ?? count, count);

  const idMap = new Map();
  const make = async (node, parent, at) => {
    const details = { parentId: parent, title: node.title };
    if (at !== undefined) details.index = at;
    if (node.url !== undefined) details.url = node.url;
    const created = await create(details);
    idMap.set(node.id, created.id);
    for (const child of node.children ?? []) await make(child, created.id); // appended in order
  };
  await make(snapshot.node, parentId, index);
  return idMap;
}

// Old ids → new ones; ids that weren't restored are dropped.
export function remapIds(ids, idMap) {
  return ids.map((id) => idMap.get(id)).filter((id) => id !== undefined);
}

// Bindings to give the restored links: only for tabs that are still open and
// haven't been pinned to another link in the meantime. Map newId → tabId.
export function restoredBindings(snapshot, idMap, openTabIds, currentBindings) {
  const taken = new Set(currentBindings.values());
  const result = new Map();
  for (const [oldId, tabId] of snapshot.bindings) {
    const newId = idMap.get(oldId);
    if (newId === undefined || !openTabIds.has(tabId) || taken.has(tabId)) continue;
    taken.add(tabId);
    result.set(newId, tabId);
  }
  return result;
}

// Pictograms to give the restored folders: Map newId → name.
export function restoredPictograms(snapshot, idMap) {
  const result = new Map();
  for (const [oldId, name] of snapshot.pictograms ?? []) {
    const newId = idMap.get(oldId);
    if (newId !== undefined) result.set(newId, name);
  }
  return result;
}

// Where a pinned tab goes at the top level: right after the last link of the root
// (before the folders below it); at the very top if the root has no links.
// `children` — the root's children from lib/tree.js, in order.
export function pinIndex(children) {
  for (let i = children.length - 1; i >= 0; i--) {
    if (children[i].kind === 'link') return i + 1;
  }
  return 0;
}

// What a folder holds, nested folders included: { links, folders }.
export function countContents(folder) {
  let links = 0;
  let folders = 0;
  for (const node of folder.children) {
    if (node.kind === 'folder') {
      const inner = countContents(node);
      folders += 1 + inner.folders;
      links += inner.links;
    } else {
      links++;
    }
  }
  return { links, folders };
}
