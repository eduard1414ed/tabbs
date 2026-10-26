// Spaces (stage 8): top-level folders of the root folder, each with its own links and its own
// open tabs, as in Arc. Which tab is in which space — Chromium tab groups: in every window
// a space has one group, titled as the space. No chrome.* calls.
//
// A space is a folder of the tree (lib/tree.js model). Tabs are shaped like chrome.tabs.Tab,
// groups like chrome.tabGroups.TabGroup ({ id, title, windowId }).

import { collectLinks } from './tree.js';
import { inSplit } from './tabs.js';

// storage.local: ids of the space folders in the bar's order; no key — spaces are off.
export const SPACES_KEY = 'spaces';
// storage.local: the spaces when they were last turned off — ticked when turning them on again.
export const SPACES_BEFORE_KEY = 'spacesBefore';
// storage.session, one key per record (panels of several windows and the background script
// write them, like bindings):
export const GROUP_PREFIX = 'spaceGroup:'; // spaceGroup:<groupId> → spaceId
export const CURRENT_PREFIX = 'spaceOf:'; // spaceOf:<windowId> → the window's space
export const LAST_SPACE_KEY = 'lastSpace'; // the space of the window used last: a new window starts in it
export const LAST_TAB_PREFIX = 'spaceTab:'; // spaceTab:<windowId>:<spaceId> → the tab last selected there

export const NO_GROUP = -1;

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export const lastTabKey = (windowId, spaceId) => `${LAST_TAB_PREFIX}${windowId}:${spaceId}`;

// The spaces' records in storage.session (all of it, as chrome.storage.session.get(null) gives).
export function parseSpaceSession(items) {
  const groupSpace = new Map();
  const current = new Map();
  const lastTabs = new Map();
  for (const [key, value] of Object.entries(items ?? {})) {
    if (key.startsWith(GROUP_PREFIX) && typeof value === 'string') {
      const groupId = Number(key.slice(GROUP_PREFIX.length));
      if (Number.isInteger(groupId)) groupSpace.set(groupId, value);
    } else if (key.startsWith(CURRENT_PREFIX) && typeof value === 'string') {
      const windowId = Number(key.slice(CURRENT_PREFIX.length));
      if (Number.isInteger(windowId)) current.set(windowId, value);
    } else if (key.startsWith(LAST_TAB_PREFIX) && Number.isInteger(value)) {
      lastTabs.set(key, value);
    }
  }
  const last = typeof items?.[LAST_SPACE_KEY] === 'string' ? items[LAST_SPACE_KEY] : null;
  return { groupSpace, current, lastTabs, last };
}

// Every key of the spaces in storage.session: cleared when spaces are turned off.
export const isSpaceSessionKey = (key) =>
  key === LAST_SPACE_KEY || [GROUP_PREFIX, CURRENT_PREFIX, LAST_TAB_PREFIX].some((prefix) => key.startsWith(prefix));

// The spaces of the tree in `ids` order (folders at its top level; a folder that is gone or is
// the favorites doesn't count). `stray` — the rest of the top level except the favorites:
// it appears only if added in the bookmark manager, and is shown at the end of the first space.
export function resolveSpaces(tree, ids, favoritesId) {
  const folders = new Map(tree.children.filter((node) => node.kind === 'folder').map((node) => [node.id, node]));
  const list = [];
  for (const id of ids ?? []) {
    const folder = folders.get(id);
    if (folder && id !== favoritesId && !list.includes(folder)) list.push(folder);
  }
  const stray = tree.children.filter((node) => node.id !== favoritesId && !list.includes(node));
  return { list, stray };
}

// The space's icon in the bar: its pictogram (a name from lib/folder-icons.js parsePictograms),
// else the emoji at the start of its name, else its first letter.
export function spaceIcon(folder, pictogram = null) {
  if (pictogram) return { pictogram };
  if (folder.emoji) return { emoji: folder.emoji };
  const [first] = graphemes.segment(folder.title.trim());
  return { letter: first ? first.segment.toLocaleUpperCase() : '•' };
}

// Bookmark id → its space for every link shown: links of a space (nested too) — that space,
// stray ones — the first space, tiles — null (their tabs belong to no space).
export function linkSpaces({ list, stray }, tiles = []) {
  const spaces = new Map();
  for (const tile of tiles) spaces.set(tile.id, null);
  for (const space of list) {
    for (const link of collectLinks(space)) spaces.set(link.id, space.id);
  }
  if (list.length) {
    for (const link of collectLinks({ children: stray })) spaces.set(link.id, list[0].id);
  }
  return spaces;
}

// ---------- Turning spaces on and off

// Folders that can become spaces: the top level of the root without the favorites.
export const enableCandidates = (tree, favoritesId) =>
  tree.children.filter((node) => node.kind === 'folder' && node.id !== favoritesId);

// Turning spaces on with the folders `checked` as spaces. Whatever isn't ticked (links, other
// folders) moves into a new first space, made right after the favorites; if nothing is left,
// no folder is made and the first ticked one comes first.
// → { create: { index } | null, move: [ids into the new folder, in order], spaces: [ids] }
// (the new folder's id goes in front of `spaces`).
export function planEnable(tree, favoritesId, checked) {
  const ticked = new Set(checked);
  const top = tree.children.filter((node) => node.id !== favoritesId);
  const isSpace = (node) => node.kind === 'folder' && ticked.has(node.id);
  const spaces = top.filter(isSpace).map((node) => node.id);
  const move = top.filter((node) => !isSpace(node)).map((node) => node.id);
  if (!move.length && spaces.length) return { create: null, move, spaces };
  const favoritesIndex = tree.children.findIndex((node) => node.id === favoritesId);
  return { create: { index: favoritesIndex + 1 }, move, spaces };
}

// Is the first space's name needed: is anything left without a tick?
export const needsFirstSpace = (tree, favoritesId, checked) => planEnable(tree, favoritesId, checked).create !== null;

// The space that takes the tabs of a removed one: the next, else the previous.
export function neighborSpace(ids, id) {
  const index = ids.indexOf(id);
  if (index === -1) return ids[0] ?? null;
  return ids[index + 1] ?? ids[index - 1] ?? null;
}

// ---------- Groups

// The title of each space's group: the space's name; two spaces with the same name get
// "Work", "Work 2" — so their groups can still be told apart after a restart.
export function groupTitles(spaces, untitled) {
  const titles = new Map();
  const used = new Set();
  for (const space of spaces) {
    const base = space.name.trim() || untitled;
    let title = base;
    for (let n = 2; used.has(title); n++) title = `${base} ${n}`;
    used.add(title);
    titles.set(space.id, title);
  }
  return titles;
}

// Groups of one window ↔ spaces. A group made for a space keeps it (`known`: groupId →
// spaceId); after a browser restart groups come back with new ids and are found by title.
// One group per space: another one of the same space is merged into the first. A group of no
// space (made by hand, or left from a removed space) is foreign: its tabs go to their spaces.
// → { groupOf: Map spaceId → groupId, groupSpace: Map groupId → spaceId (merged ones too),
//     merge: Map groupId → groupId, rename: Map groupId → title, foreign: [groupId] }
export function matchGroups(groups, titles, known = new Map()) {
  const groupOf = new Map();
  const groupSpace = new Map();
  const merge = new Map();
  const foreign = [];
  const claim = (group, spaceId) => {
    groupSpace.set(group.id, spaceId);
    if (groupOf.has(spaceId)) merge.set(group.id, groupOf.get(spaceId));
    else groupOf.set(spaceId, group.id);
  };
  const byTitle = new Map([...titles].map(([spaceId, title]) => [title, spaceId]));
  const unknown = [];
  for (const group of groups) {
    const spaceId = known.get(group.id);
    if (titles.has(spaceId)) claim(group, spaceId);
    else unknown.push(group);
  }
  for (const group of unknown) {
    const spaceId = byTitle.get(group.title ?? '');
    if (spaceId !== undefined) claim(group, spaceId);
    else foreign.push(group.id);
  }
  const rename = new Map();
  for (const [spaceId, groupId] of groupOf) {
    const title = titles.get(spaceId);
    if (groups.find((group) => group.id === groupId).title !== title) rename.set(groupId, title);
  }
  return { groupOf, groupSpace, merge, rename, foreign };
}

// The space each tab of a window belongs in (Map tabId → spaceId), or null for tabs that stay
// out of groups and show in every space: tabs of favorites tiles, tabs pinned in the browser
// (Chromium doesn't group them) and a tab side by side with one of those (a pair shares a group).
//   linkSpace — linkSpaces(…); bindings — Map bookmarkId → tabId; groupSpace — Map groupId → spaceId;
//   current — the window's space.
// A link's tab — the link's space; another tab — its group's space; a tab out of a group or in a
// foreign one — its opener's space, else `current` (undefined `current` leaves it undefined).
// Both tabs of a pair go together: with a link's space if one of them is a link's tab, else the left one's.
export function tabTargets(tabs, { linkSpace, bindings, groupSpace, current }) {
  const linkOfTab = new Map();
  for (const [bookmarkId, tabId] of bindings) {
    if (linkSpace.has(bookmarkId) && !linkOfTab.has(tabId)) linkOfTab.set(tabId, bookmarkId);
  }
  const own = (tab) => {
    if (tab.pinned) return null;
    if (linkOfTab.has(tab.id)) return linkSpace.get(linkOfTab.get(tab.id));
    return groupSpace.get(tab.groupId);
  };
  const owned = new Map(tabs.map((tab) => [tab.id, own(tab)]));
  const targets = new Map();
  for (const tab of tabs) {
    const target = owned.get(tab.id);
    targets.set(tab.id, target !== undefined ? target : owned.get(tab.openerTabId) ?? current);
  }

  const pairs = new Map();
  for (const tab of tabs) {
    if (!inSplit(tab)) continue;
    if (!pairs.has(tab.splitViewId)) pairs.set(tab.splitViewId, []);
    pairs.get(tab.splitViewId).push(tab);
  }
  for (const pair of pairs.values()) {
    if (pair.length !== 2) continue;
    const [left, right] = pair.sort((a, b) => a.index - b.index);
    const values = pair.map((tab) => targets.get(tab.id));
    let target;
    if (values.includes(null)) target = null;
    else if (linkOfTab.has(right.id) && !linkOfTab.has(left.id)) target = targets.get(right.id);
    else target = targets.get(left.id);
    for (const tab of pair) targets.set(tab.id, target);
  }
  return targets;
}

// What to change so that every tab of a window is in its space's group: `groupOf` — the
// window's group of each space (matchGroups). → { ungroup: [tabId], join: Map spaceId → [tabId] }
// (a space with no group in the window yet gets one).
export function regroupPlan(tabs, targets, groupOf) {
  const ungroup = [];
  const join = new Map();
  for (const tab of [...tabs].sort((a, b) => a.index - b.index)) {
    const target = targets.get(tab.id);
    if (target === undefined) continue;
    if (target === null) {
      if (tab.groupId !== undefined && tab.groupId !== NO_GROUP) ungroup.push(tab.id);
    } else if (tab.groupId !== groupOf.get(target)) {
      if (!join.has(target)) join.set(target, []);
      join.get(target).push(tab.id);
    }
  }
  return { ungroup, join };
}

// The window's space: the one stored for it, else the space of its selected tab (`activeTarget`),
// else the space used last (a new window), else the first one.
export function windowSpace({ stored, activeTarget, last, ids }) {
  for (const id of [stored, activeTarget, last]) {
    if (id && ids.includes(id)) return id;
  }
  return ids[0] ?? null;
}

// The tab to select when switching to `spaceId`: the one last selected there (a tile's tab
// too), else the space's most recently used tab; null — none, a new tab opens there.
export function pickSpaceTab(tabs, targets, spaceId, lastTabId) {
  const last = tabs.find((tab) => tab.id === lastTabId);
  if (last && (targets.get(last.id) === spaceId || targets.get(last.id) === null)) return last.id;
  const own = tabs
    .filter((tab) => targets.get(tab.id) === spaceId)
    .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
  return own[0]?.id ?? null;
}

// ---------- Switching to the next one (stage 8b)

// The space before (`step` -1) or after (+1) `current`; null at either end (no going round).
export function adjacentSpace(ids, current, step) {
  const index = ids.indexOf(current);
  if (index === -1) return null;
  return ids[index + step] ?? null;
}

// The bar's order after dropping the icon `dragId` before or after `targetId`; null if nothing changes.
export function reorderSpaces(ids, dragId, targetId, zone) {
  if (!ids.includes(dragId) || !ids.includes(targetId) || dragId === targetId) return null;
  const rest = ids.filter((id) => id !== dragId);
  const at = rest.indexOf(targetId) + (zone === 'after' ? 1 : 0);
  const next = [...rest.slice(0, at), dragId, ...rest.slice(at)];
  return next.every((id, i) => id === ids[i]) ? null : next;
}

// A sideways two-finger swipe on a trackpad, as wheel events: { dx, dy, time } (deltaX, deltaY,
// event.timeStamp). One gesture — events with no pause longer than `gap` ms, the trackpad's
// momentum included. Its direction is decided by the first `lock` px: mostly up or down — a
// scroll, not a swipe. Sideways past `threshold` px — one switch: fingers to the left (dx > 0)
// — the next space, to the right — the previous; the rest of the gesture switches nothing.
// The momentum only fades, with no pause before the fingers touch again, so after a switch a
// new gesture also starts when the fingers go the other way, or speed up again (by `rise` px)
// once the motion has died down to `settled` px — swiping back or on right away works.
// → { state, axis: 'x' | 'y' | null, action: 'next' | 'previous' | null, offset } — `offset` is
// how far the content follows the fingers (px, negative — to the left), 0 once it switched.
export const SWIPE = { threshold: 60, gap: 200, lock: 6, rise: 4, settled: 2 };

function startsAgain(state, dx, { rise, settled }) {
  if (!state.fired) return false;
  const size = Math.abs(dx);
  if (Math.sign(dx) === -state.sign && size >= settled) return true; // the other way
  return Math.sign(dx) === state.sign && state.low <= settled && size - state.low >= rise; // a new push
}

export function swipeStep(state, { dx, dy, time }, options = SWIPE) {
  const { threshold, gap, lock } = { ...SWIPE, ...options };
  let next = state && time - state.time <= gap && !startsAgain(state, dx, { ...SWIPE, ...options })
    ? { ...state, time }
    : { axis: null, x: 0, y: 0, total: 0, fired: false, sign: 0, low: Infinity, time };
  if (next.axis === null) {
    next.x += Math.abs(dx);
    next.y += Math.abs(dy);
    if (Math.max(next.x, next.y) >= lock) next.axis = next.x > next.y ? 'x' : 'y';
  }
  let action = null;
  if (next.fired) {
    next.low = Math.min(next.low, Math.abs(dx));
  } else if (next.axis === 'x') {
    next.total += dx;
    if (Math.abs(next.total) >= threshold) {
      next.fired = true;
      next.sign = Math.sign(next.total);
      action = next.total > 0 ? 'next' : 'previous';
    }
  } else if (next.axis === null) {
    next.total += dx;
  }
  const offset = next.fired || next.axis === 'y' ? 0 : -next.total;
  return { state: next, axis: next.axis, action, offset };
}
