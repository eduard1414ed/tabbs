// Drag and drop: where a dragged item lands. No chrome.* calls.
//
// Zones of a row under the pointer:
//   before / after — the gap above or below the row;
//   inside         — into a folder, at its end;
//   inside-start   — into an expanded folder, at its very top (the line right under the folder row);
//   onto           — onto a tab or a link: the two open side by side (split view, stage 5b).

import { completeUrl, sameUrl } from './urls.js';

// `y` — pointer position from the row's top, `height` — the row's height.
// Links and tabs: upper half — before, lower half — after.
// Tiles stand in a row, so for them it's across: `y` — from the tile's left edge,
// `height` — its width; left half — before, right half — after.
// Folders: upper quarter — before, the middle — inside, lower quarter — after
// (or inside-start if the folder is expanded: its first child is right below).
// Links and tabs that something can be split with (`canSplit`): the same quarters,
// the middle — onto.
export function dropZone(kind, y, height, { expanded = false, canSplit = false } = {}) {
  const quarters = kind === 'folder' || (canSplit && (kind === 'link' || kind === 'tab'));
  if (!quarters) return y < height / 2 ? 'before' : 'after';
  if (y < height / 4) return 'before';
  if (y >= (height * 3) / 4) return kind === 'folder' && expanded ? 'inside-start' : 'after';
  return kind === 'folder' ? 'inside' : 'onto';
}

// id → { parentId, index, node } for every node of the tree (lib/tree.js model).
function placesOf(tree) {
  const places = new Map();
  const walk = (parentId, children) => {
    children.forEach((node, index) => {
      places.set(node.id, { parentId, index, node });
      if (node.kind === 'folder') walk(node.id, node.children);
    });
  };
  walk(tree.id, tree.children);
  return places;
}

// Where a bookmark goes: { parentId, index } or null if it can't or needn't move.
// `targetId` equal to the root's id means the empty space below the tree: the end of the root.
// `dragId` — the bookmark being moved; undefined for a new one (a pinned tab, a dropped address).
// The index is counted before the dragged bookmark is taken out, as chrome.bookmarks.move expects
// (moving within one folder further down, Chromium subtracts one itself).
export function bookmarkDrop(tree, { dragId, targetId, zone }) {
  const places = placesOf(tree);
  let parentId;
  let index;
  if (targetId === tree.id) {
    parentId = tree.id;
    index = tree.children.length;
  } else {
    const target = places.get(targetId);
    if (!target) return null;
    if (zone === 'before' || zone === 'after') {
      parentId = target.parentId;
      index = target.index + (zone === 'after' ? 1 : 0);
    } else if (target.node.kind !== 'folder') {
      return null;
    } else {
      parentId = targetId;
      index = zone === 'inside-start' ? 0 : target.node.children.length;
    }
  }

  const dragged = places.get(dragId);
  if (!dragged) return { parentId, index };
  // A folder can't go into itself or into a folder inside it.
  for (let id = parentId; id !== undefined; id = places.get(id)?.parentId) {
    if (id === dragId) return null;
  }
  // Dropped right before or right after itself: nothing changes.
  if (dragged.parentId === parentId && (index === dragged.index || index === dragged.index + 1)) return null;
  return { parentId, index };
}

// Where a tab goes among the tabs of the panel's window: an index for chrome.tabs.move
// (when `dragTabId` is a tab of this window) or chrome.tabs.create, or null if nothing changes.
// Only some tabs are shown below the divider (the others are on links), so the position is
// taken from the target tab's own index. `targetTabId` null — after the last tab.
// chrome.tabs.move counts the index after the tab is taken out, chrome.tabs.create — as is.
export function tabDrop(windowTabs, { dragTabId, targetTabId, zone }) {
  let position;
  if (targetTabId == null) {
    position = windowTabs.length;
  } else {
    const target = windowTabs.find((tab) => tab.id === targetTabId);
    if (!target) return null;
    position = target.index + (zone === 'after' ? 1 : 0);
  }
  const dragged = windowTabs.find((tab) => tab.id === dragTabId);
  if (!dragged) return position;
  const index = position > dragged.index ? position - 1 : position;
  return index === dragged.index ? null : index;
}

// Split view: Chromium pairs only neighbouring tabs, so the dropped tab first goes right
// after the target one. → an index for chrome.tabs.move (counted after the tab is taken
// out), or null if it is there already. A tab not in `windowTabs` (from another window)
// goes to the target's index + 1.
export function splitDrop(windowTabs, { dragTabId, targetTabId }) {
  const target = windowTabs.find((tab) => tab.id === targetTabId);
  if (!target) return null;
  const dragged = windowTabs.find((tab) => tab.id === dragTabId);
  if (!dragged) return target.index + 1;
  if (dragged.index === target.index + 1) return null;
  return dragged.index < target.index ? target.index : target.index + 1;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[name.toLowerCase()] ?? match;
  });
}

// An address dropped from the address bar or a page → { url, title } or null.
// The browser gives it as "text/uri-list" (one address per line, "#" lines are comments),
// "text/html" (a link, its text is the page title) and "text/plain".
export function droppedLink({ uriList = '', html = '', text = '' } = {}) {
  const listed = uriList.split(/\r?\n/).map((line) => line.trim()).find((line) => line && !line.startsWith('#'));
  const anchor = /<a\b[^>]*?\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/i.exec(html);
  const candidate = listed || (anchor && decodeEntities(anchor[2]).trim()) || text.trim();
  const url = completeUrl(candidate);
  if (!url) return null;

  let title = anchor ? decodeEntities(anchor[3].replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim() : '';
  if (sameUrl(title, url) || title === candidate) title = '';
  return { url, title };
}
