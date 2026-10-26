// Moving from Arc with Helium's own import (after stage 8b): Helium reads Arc's sidebar itself
// and puts the bookmarks next to the user's own; the extension finds what came from Arc and moves
// it into its root folder. No chrome.* calls.
//
// What Helium adds (checked in Helium 0.20.1.1):
//   the bookmarks bar is not empty → one folder at its end, "Imported from Arc" (in the browser's
//     language; "… (1)" and so on the next time). Inside: Arc's favorites as links, then a folder
//     per space with its pinned links and folders — named "Personal" (Arc's first space) or
//     after the space's id (6C17F165-82DB-4BA5-8DB8-970992D77EF6). The space's name is lost;
//   the bar is empty → the favorites go straight onto the bar, the folder holds the spaces only.
//
// Node: chrome.bookmarks' { id, title, url } | { id, title, children: [node…] }.

export const PERSONAL_SPACE = 'Personal';
const SPACE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isFolder = (node) => Array.isArray(node.children);
const isSpaceFolder = (node) => isFolder(node) && (node.title === PERSONAL_SPACE || SPACE_ID.test(node.title));
// Helium's folder: has Arc's spaces in it, or "Arc" in its name (an import of favorites only).
const isImportFolder = (node) => isFolder(node) && (node.children.some(isSpaceFolder) || /\bArc\b/.test(node.title));

// The bookmarks an import created, in order: [{ id, parentId }] → the ids of those it put at the
// top level (into the bookmarks bar, other bookmarks…), not inside another one it created.
export function importedTops(created) {
  const ids = new Set(created.map((node) => node.id));
  return created.filter((node) => !ids.has(node.parentId)).map((node) => node.id);
}

// Links in a list of nodes, nested ones included, and the first `count` of their titles.
function linksOf(nodes, count) {
  let links = 0;
  let folders = 0;
  const titles = [];
  const walk = (list) => {
    for (const node of list) {
      if (isFolder(node)) {
        folders++;
        walk(node.children);
      } else {
        links++;
        if (titles.length < count) titles.push(node.title || node.url);
      }
    }
  };
  walk(nodes);
  return { links, folders, titles };
}

// The nodes an import added at the top level, with their subtrees → what came from Arc:
// { containers: [ids] — Helium's folders, removed once empty; favorites: [{ id, title }];
//   spaces: [{ id, personal, children: [ids], links, folders, preview: [titles] }] },
// or null if this import wasn't Arc's (another browser, a bookmarks file).
export function findArcImport(nodes, { preview = 3 } = {}) {
  const containers = nodes.filter(isImportFolder);
  if (!containers.length) return null;
  const favorites = nodes.filter((node) => !isFolder(node)); // straight on an empty bar
  const spaces = [];
  for (const container of containers) {
    for (const child of container.children) {
      if (isSpaceFolder(child)) {
        const { links, folders, titles } = linksOf(child.children, preview);
        spaces.push({
          id: child.id,
          personal: child.title === PERSONAL_SPACE,
          children: child.children.map((node) => node.id),
          links,
          folders,
          preview: titles,
        });
      } else if (!isFolder(child)) {
        favorites.push(child);
      }
    }
  }
  if (!favorites.length && !spaces.length) return null;
  return { containers: containers.map((node) => node.id), favorites: favorites.map(({ id, title }) => ({ id, title })), spaces };
}

// Where each space goes by default. Spaces off: Arc's first space ("Personal") on top, the rest
// as folders; spaces on: each a new space. Arc's first space keeps its name "Personal", the
// others' names are to be typed (an empty name — `untitled(n)` when sorting).
export function defaultArcSort(found, { spaces = false } = {}) {
  return {
    favorites: found.favorites.length > 0,
    spaces: found.spaces.map((space) => ({
      id: space.id,
      mode: spaces ? 'space' : space.personal ? 'top' : 'folder',
      title: space.personal ? PERSONAL_SPACE : '',
      into: null,
    })),
  };
}

// What to move where. `choice`: { favorites, spaces: [{ id, mode, title, into, icon }] } — mode is
// 'top' (the space's items at the end of the root folder), 'folder' (the space's folder itself,
// renamed, at the end of the root), 'space' (the same, and it becomes a space), 'into' (the items
// at the end of the existing space `into`) or 'skip' (stays in Helium's folder).
// `favoritesExists` — the root has a favorites folder; otherwise one is created first in it.
// `untitled(n)` — the name of the n-th space (from 1) when none is typed. `icon` (stage 8g) of a
// folder or a space: { emoji } goes in front of its title, { pictogram } into `pictogram`.
// → { favorites: { create, ids } | null, top: [ids], folders: [{ id, title, pictogram? }],
//     spaces: [{ id, title, pictogram? }], into: [{ target, ids }], cleanup: [ids], links, folderCount } —
//     cleanup: the folders left empty (spaces whose items moved out, then Helium's folders).
// Applied in this order: favorites, items on top, folders and spaces in Arc's order, into spaces.
export function planArcSort(found, choice, { favoritesExists = false, untitled = (n) => String(n) }) {
  const byId = new Map(found.spaces.map((space, index) => [space.id, { space, index }]));
  const favorites = choice.favorites && found.favorites.length
    ? { create: !favoritesExists, ids: found.favorites.map((node) => node.id) }
    : null;
  const plan = { favorites, top: [], folders: [], spaces: [], into: [], cleanup: [] };
  let links = favorites ? favorites.ids.length : 0;
  let folders = favorites?.create ? 1 : 0;
  const seen = new Set();
  for (const wanted of choice.spaces ?? []) {
    const entry = byId.get(wanted.id);
    if (!entry || seen.has(wanted.id) || wanted.mode === 'skip') continue;
    seen.add(wanted.id);
    const { space, index } = entry;
    const name = (wanted.title ?? '').trim() || untitled(index + 1);
    const { icon } = wanted;
    const folder = icon?.pictogram ? { id: space.id, title: name, pictogram: icon.pictogram }
      : { id: space.id, title: icon?.emoji ? `${icon.emoji} ${name}` : name };
    if (wanted.mode === 'top') plan.top.push(...space.children);
    else if (wanted.mode === 'folder') plan.folders.push(folder);
    else if (wanted.mode === 'space') plan.spaces.push(folder);
    else if (wanted.mode === 'into' && wanted.into) plan.into.push({ target: wanted.into, ids: [...space.children] });
    else continue;
    if (wanted.mode === 'top' || wanted.mode === 'into') plan.cleanup.push(space.id);
    links += space.links;
    folders += space.folders + (wanted.mode === 'folder' || wanted.mode === 'space' ? 1 : 0);
  }
  plan.cleanup.push(...found.containers);
  return { ...plan, links, folderCount: folders };
}

// Undoing a sort from its log, the steps in the order they were made: { moved: { id, parentId,
// index } — where a node was before it was moved; renamed: { id, title } — its old name;
// created: { id } — a folder made for the sort; space: { id } — a folder that became a space;
// pictogram: { id } — a folder that got a pictogram (stage 8g) }.
// → the same steps to take back, last one first.
export function undoSteps(log) {
  return [...log].reverse();
}

// Helium (and Chrome) can import from Arc; Brave, Edge and the like can't — there the
// sidebar file is chosen by hand. `brands` — navigator.userAgentData.brands, `brave` —
// whether navigator.brave exists. Helium calls itself Chrome, so the two aren't told apart.
export function hasBuiltInArcImport({ brands = [], brave = false } = {}) {
  if (brave) return false;
  const names = brands.map((brand) => brand.brand);
  return !names.some((name) => /Edge|Opera|Vivaldi|Yandex|Brave/i.test(name));
}
