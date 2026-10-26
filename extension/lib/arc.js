// Moving from Arc: Arc's sidebar file → what to put into the root folder. The panel imports
// it with chrome.bookmarks (planArcImport, stage 7b); scripts/arc-to-bookmarks.mjs writes
// a bookmarks HTML file (arcRootTree, bookmarksHtml, stage 4b). No chrome.* calls.
//
// Arc keeps its sidebar in ~/Library/Application Support/Arc/StorableSidebar.json:
//   sidebar.containers[1] = {
//     topAppsContainerIDs: [profile, favoritesContainerId],
//     spaces: [id, space, id, space, …],   space: { id, title, containerIDs: ['unpinned', id, 'pinned', id],
//                                                   customInfo: { iconType: { icon: 'video' } | { emoji…: '🎬' } } }
//     items:  [id, item, id, item, …],     item:  { id, title, childrenIds, data }
//   }
//   data.tab: { savedURL, savedTitle } — a link (title is Arc's own name for it, may be null);
//   data.list: {} — a folder; data.itemContainer — a space's pinned / unpinned list or the favorites.
//
// Node: { title, url } | { title, children: [node…] }.

import { hostOf, splitLeadingEmoji } from './tree.js';
import { FAVORITES_FOLDERS } from './strings.js';

// Where Arc keeps StorableSidebar.json, for the hint in the import dialog. On Windows the
// package name ends with an id that differs between installs.
export const ARC_FOLDER = {
  mac: '~/Library/Application Support/Arc/',
  win: '%LOCALAPPDATA%\\Packages\\TheBrowserCompany.Arc_…\\LocalCache\\Local\\Arc\\',
};

// The file itself, where its whole path is known: on a Mac it is copied for "Go to folder"
// (⇧⌘G) in the file window, which then selects the file at once. On Windows a part of the
// folder's name differs from one computer to another.
export const ARC_FILE = { mac: `${ARC_FOLDER.mac}StorableSidebar.json` };

// Arc's names keep non-breaking spaces and line breaks of page titles.
const clean = (text) => (text ?? '').replace(/\s+/g, ' ').trim();

// What Arc showed: the name given in Arc, else the page title, else the domain.
function linkTitle(item) {
  const { savedURL: url, savedTitle } = item.data.tab;
  return clean(item.title) || clean(savedTitle) || hostOf(url) || url;
}

// Arc's own space icons (Apple's symbols) → the nearest emoji; the rest get none (a letter).
const ARC_ICONS = {
  video: '🎬', film: '🎬', tv: '📺', receipt: '🧾', filetrayfull: '🗂️', filetray: '🗂️', folder: '📁',
  briefcase: '💼', house: '🏠', book: '📚', books: '📚', cart: '🛒', bag: '🛍️', music: '🎵',
  musicnote: '🎵', gamecontroller: '🎮', star: '⭐', heart: '❤️', graduationcap: '🎓', airplane: '✈️',
  paintbrush: '🎨', paintpalette: '🎨', hammer: '🔨', wrench: '🔧', globe: '🌍', bolt: '⚡', leaf: '🌱',
  flame: '🔥', camera: '📷', cup: '☕', mug: '☕', moon: '🌙', sun: '☀️', person: '👤', chat: '💬',
  envelope: '✉️', calendar: '📅', pencil: '✏️', lightbulb: '💡', terminal: '💻', laptop: '💻', code: '💻',
};

// Arc's own space icons → the nearest pictogram (lib/pictograms.js, stage 8g); names only, so the
// set isn't loaded here (tests check that each one is in it).
export const ARC_PICTOGRAMS = {
  video: 'film-slate', film: 'film-slate', tv: 'television-simple', receipt: 'receipt', filetrayfull: 'tray',
  filetray: 'tray', folder: 'folder-simple', briefcase: 'briefcase', house: 'house', book: 'book-open',
  books: 'books', cart: 'shopping-cart', bag: 'shopping-bag', music: 'music-notes', musicnote: 'music-notes',
  gamecontroller: 'game-controller', star: 'star', heart: 'heart', graduationcap: 'graduation-cap',
  airplane: 'airplane', paintbrush: 'paint-brush', paintpalette: 'palette', hammer: 'hammer', wrench: 'wrench',
  globe: 'globe-hemisphere-west', bolt: 'lightning', leaf: 'leaf', flame: 'fire', camera: 'camera', cup: 'coffee',
  mug: 'coffee', moon: 'moon', sun: 'sun', person: 'user', chat: 'chat-circle', envelope: 'envelope-simple',
  calendar: 'calendar-blank', pencil: 'pencil-simple', lightbulb: 'lightbulb', terminal: 'terminal-window',
  laptop: 'laptop', code: 'code',
};

// The space's icon in Arc: { emoji, pictogram } — an emoji set in Arc (no pictogram), or for
// Apple's symbol the nearest emoji and pictogram; nulls for none.
function arcIcon(space) {
  const icon = space?.customInfo?.iconType;
  if (!icon || typeof icon !== 'object') return { emoji: null, pictogram: null };
  for (const [key, value] of Object.entries(icon)) {
    if (!key.toLowerCase().startsWith('emoji')) continue;
    const text = typeof value === 'number' ? String.fromCodePoint(value) : String(value ?? '');
    const { emoji } = splitLeadingEmoji(text);
    if (emoji) return { emoji, pictogram: null };
  }
  const name = typeof icon.icon === 'string' ? icon.icon.replace(/[^a-z]/gi, '').toLowerCase() : '';
  return { emoji: ARC_ICONS[name] ?? null, pictogram: ARC_PICTOGRAMS[name] ?? null };
}

// The sidebar → { favorites, spaces: [{ title, emoji, pictogram, items }], skipped }. Only pinned items of
// spaces are taken ("today" tabs aren't bookmarks). `skipped` counts what couldn't be
// read: ids that point nowhere and kinds of items other than links and folders.
export function parseArcSidebar(json) {
  const container = json?.sidebar?.containers?.find((c) => Array.isArray(c?.spaces) && Array.isArray(c?.items));
  if (!container) throw new Error('This is not Arc\'s sidebar file: no spaces in it');

  const items = new Map(container.items.filter((x) => x && typeof x === 'object').map((item) => [item.id, item]));
  let skipped = 0;

  const children = (ids) => (ids ?? []).map(node).filter(Boolean);
  function node(id) {
    const item = items.get(id);
    const data = item?.data;
    if (data?.tab?.savedURL) return { title: linkTitle(item), url: data.tab.savedURL };
    if (data?.list) return { title: clean(item.title), children: children(item.childrenIds) };
    skipped++;
    return null;
  }

  const favoritesId = (container.topAppsContainerIDs ?? []).find((x) => typeof x === 'string');
  const favorites = children(items.get(favoritesId)?.childrenIds);

  const spaces = container.spaces.filter((x) => x && typeof x === 'object').map((space) => {
    const ids = space.containerIDs ?? [];
    const pinnedId = ids[ids.indexOf('pinned') + 1];
    const pinned = ids.includes('pinned') ? items.get(pinnedId) : undefined;
    return { title: clean(space.title), ...arcIcon(space), items: children(pinned?.childrenIds) };
  });

  return { favorites, spaces, skipped };
}

const sameName = (a, b) => a.toLocaleLowerCase('ru') === b.toLocaleLowerCase('ru');

// A space by its name, case aside; null if there is none.
export function findSpace(parsed, name) {
  return parsed.spaces.find((space) => sameName(space.title, name)) ?? null;
}

function spaceNamed(parsed, name) {
  const space = findSpace(parsed, name);
  if (!space) throw new Error(`No space "${name}" in Arc's sidebar`);
  return space;
}

// What goes inside the root folder: Arc's favorites as `favoritesTitle` (tiles), the items
// of `rootSpace` as they are, then a folder for each of `folderSpaces` named like the space.
export function arcRootTree(parsed, { rootSpace, folderSpaces = [], favoritesTitle = FAVORITES_FOLDERS.en }) {
  const tree = [];
  if (parsed.favorites.length) tree.push({ title: favoritesTitle, children: parsed.favorites });
  if (rootSpace) tree.push(...spaceNamed(parsed, rootSpace).items);
  for (const name of folderSpaces) {
    const space = spaceNamed(parsed, name);
    tree.push({ title: space.title, children: space.items });
  }
  return tree;
}

// The import in the panel (stage 7b). `choice`: `favorites` — take Arc's favorites,
// `top` — index of the space whose pinned items go straight into the root folder (null —
// none), `folders` — indexes of spaces that become folders named like the space, in Arc's
// order. `favoritesExists` — the root folder already has a favorites folder: the favorites
// go into it; otherwise a new one named `favoritesTitle` is created first in the root.
// `icons` (stage 8g) — { [space index]: { pictogram } | { emoji } | null } for the folders: an
// emoji goes in front of the name, a pictogram into the folder node (`pictogram`, set once it
// is created). Only adds. Returns { favorites: { create, title, children } | null, root: [node…],
// links, folders } — `links` and `folders` count what will be created.
export function planArcImport(parsed, choice, { favoritesTitle, favoritesExists = false, untitledTitle = '' }) {
  const spaceAt = (index) => parsed.spaces[index];
  const favorites = choice.favorites && parsed.favorites.length
    ? { create: !favoritesExists, title: favoritesTitle, children: parsed.favorites }
    : null;

  const root = [];
  const top = choice.top ?? null;
  if (top !== null && spaceAt(top)) root.push(...spaceAt(top).items);
  const folderIndexes = [...new Set(choice.folders ?? [])]
    .filter((index) => index !== top && spaceAt(index))
    .sort((a, b) => a - b);
  for (const index of folderIndexes) {
    const space = spaceAt(index);
    root.push(withIcon({ title: space.title || untitledTitle, children: space.items }, choice.icons?.[index]));
  }

  const counted = countNodes([...(favorites?.children ?? []), ...root]);
  return { favorites, root, links: counted.links, folders: counted.folders + (favorites?.create ? 1 : 0) };
}

// The folder node with `icon`: an emoji in front of its title, or `pictogram`.
function withIcon(node, icon) {
  if (icon?.pictogram) return { ...node, pictogram: icon.pictogram };
  if (icon?.emoji) return { ...node, title: `${icon.emoji} ${node.title}` };
  return node;
}

// The import with spaces on (stage 8b): Arc's spaces become spaces. `choice`: `favorites` as
// above, `spaces` — [{ index, into }] in Arc's order: `into` — the id of an existing space the
// pinned items are added to the end of, or null — a new space named like Arc's with `icon`
// (as in planArcImport; no `icon` key — Arc's emoji in front of the name).
// → { favorites (as above), spaces: [{ into, title, children, pictogram? }], links, folders }.
export function planArcSpacesImport(parsed, choice, { favoritesTitle, favoritesExists = false, untitledTitle = '' }) {
  const { favorites } = planArcImport(parsed, { favorites: choice.favorites, folders: [] }, { favoritesTitle, favoritesExists });
  const seen = new Set();
  const spaces = [];
  for (const entry of choice.spaces ?? []) {
    const { index, into = null } = entry;
    const space = parsed.spaces[index];
    if (!space || seen.has(index)) continue;
    seen.add(index);
    const icon = 'icon' in entry ? entry.icon : space.emoji && { emoji: space.emoji };
    spaces.push(withIcon({ into, title: space.title || untitledTitle, children: space.items }, into === null ? icon : null));
  }
  const counted = countNodes([...(favorites?.children ?? []), ...spaces.flatMap((space) => space.children)]);
  const created = spaces.filter((space) => space.into === null).length + (favorites?.create ? 1 : 0);
  return { favorites, spaces, links: counted.links, folders: counted.folders + created };
}

// The space an Arc space goes into by default: one of `spaces` ({ id, title }) with the same
// name, case and a leading emoji aside; null — a new one.
export function defaultSpaceFor(arcTitle, spaces) {
  const name = (title) => splitLeadingEmoji(title).title;
  const wanted = name(arcTitle);
  if (!wanted) return null;
  return spaces.find((space) => sameName(name(space.title), wanted))?.id ?? null;
}

// Links and folders in a list of nodes, nested ones included.
export function countNodes(nodes) {
  let links = 0;
  let folders = 0;
  for (const node of nodes) {
    if (node.children) {
      const inner = countNodes(node.children);
      folders += 1 + inner.folders;
      links += inner.links;
    } else {
      links++;
    }
  }
  return { links, folders };
}

const escapeHtml = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// The bookmarks file every browser imports (Netscape format): one folder named `rootTitle`
// (like the root folder) with `children` inside.
export function bookmarksHtml(children, rootTitle) {
  const lines = [];
  const write = (nodes, depth) => {
    const pad = '    '.repeat(depth);
    for (const node of nodes) {
      if (node.children) {
        lines.push(`${pad}<DT><H3>${escapeHtml(node.title)}</H3>`, `${pad}<DL><p>`);
        write(node.children, depth + 1);
        lines.push(`${pad}</DL><p>`);
      } else {
        lines.push(`${pad}<DT><A HREF="${escapeHtml(node.url)}">${escapeHtml(node.title)}</A>`);
      }
    }
  };
  write([{ title: rootTitle, children }], 1);
  return [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Bookmarks</TITLE>',
    '<H1>Bookmarks</H1>',
    '<DL><p>',
    ...lines,
    '</DL><p>',
    '',
  ].join('\n');
}
