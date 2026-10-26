// Locating the extension's root folder (named like the extension, inside "Other bookmarks").
// No direct chrome.* calls: callers pass chrome.bookmarks and chrome.storage.local
// (or fakes in tests), both used through their promise-based API.

export const ROOT_ID_KEY = 'rootFolderId';

const isFolder = (node) => node != null && !node.url;

// "Other bookmarks" among the top-level system folders. Found by folderType
// (Chromium 134+); with several candidates (account sync) prefer the local one.
// Fallback for builds without folderType: Chromium always lists the top level
// as [Bookmarks bar, Other bookmarks, Mobile bookmarks], so take the second.
export function pickOtherBookmarks(topLevel) {
  const folders = (topLevel ?? []).filter(isFolder);
  if (folders.some((node) => 'folderType' in node)) {
    const others = folders.filter((node) => node.folderType === 'other');
    return others.find((node) => node.syncing === false) ?? others[0] ?? null;
  }
  return folders[1] ?? null;
}

export function findFolderByTitle(parent, title) {
  return (parent?.children ?? []).find((node) => isFolder(node) && node.title === title) ?? null;
}

// The first of `titles` that names a folder in `parent`: the order of names wins, not
// the order of folders.
export function findFolderByTitles(parent, titles) {
  for (const title of titles) {
    const found = findFolderByTitle(parent, title);
    if (found) return found;
  }
  return null;
}

async function getStoredFolder(bookmarks, storage) {
  const { [ROOT_ID_KEY]: id } = await storage.get(ROOT_ID_KEY);
  if (!id) return null;
  try {
    const [node] = await bookmarks.get(id);
    return isFolder(node) ? node : null;
  } catch {
    return null; // the folder was deleted
  }
}

// Returns the root folder node or null. Never creates anything.
// The stored id wins, so the folder may be renamed or moved by the user. Without it the
// folder is looked up by `titles` (the current name first, then older ones).
export async function locateRootFolder({ bookmarks, storage, titles }) {
  const stored = await getStoredFolder(bookmarks, storage);
  if (stored) return stored;

  const [tree] = await bookmarks.getTree();
  const found = findFolderByTitles(pickOtherBookmarks(tree?.children), titles);
  if (found) await storage.set({ [ROOT_ID_KEY]: found.id });
  return found;
}

// Like locateRootFolder, but creates the folder in "Other bookmarks" if missing,
// named by the first of `titles`.
export async function ensureRootFolder({ bookmarks, storage, titles }) {
  const existing = await locateRootFolder({ bookmarks, storage, titles });
  if (existing) return existing;

  const [tree] = await bookmarks.getTree();
  const other = pickOtherBookmarks(tree?.children);
  if (!other) throw new Error('"Other bookmarks" folder not found');
  const created = await bookmarks.create({ parentId: other.id, title: titles[0] });
  await storage.set({ [ROOT_ID_KEY]: created.id });
  return created;
}
