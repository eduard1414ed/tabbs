// Open tabs of the panel's window: which are shown on their links in folders and
// which below the divider. No chrome.* calls.
//
// Tabs are shaped like chrome.tabs.Tab; bindings are a Map bookmarkId → tabId
// (lib/binding.js); `linkIds` is anything with .has(bookmarkId) — the links of the tree.

import { hostOf } from './tree.js';

// Every tab of the window ends up in exactly one place:
//   inFolders — Map bookmarkId → tab, shown on that link;
//   loose     — the rest, below the divider, in the browser's order.
// A binding counts only if its link is still in the tree; if two links claim one
// tab (shouldn't happen), the first one gets it.
export function splitWindowTabs(tabs, bindings, linkIds, windowId) {
  const linkOfTab = new Map();
  for (const [bookmarkId, tabId] of bindings) {
    if (linkIds.has(bookmarkId) && !linkOfTab.has(tabId)) linkOfTab.set(tabId, bookmarkId);
  }

  const inFolders = new Map();
  const loose = [];
  const windowTabs = tabs.filter((tab) => tab.windowId === windowId).sort((a, b) => a.index - b.index);
  for (const tab of windowTabs) {
    const bookmarkId = linkOfTab.get(tab.id);
    if (bookmarkId === undefined) loose.push(tab);
    else inFolders.set(bookmarkId, tab);
  }
  return { inFolders, loose };
}

// Changes when the tab's page or the site's icon changes: then its icon is fetched again.
export function iconVersion(tab) {
  const source = `${tab.url ?? ''}\n${tab.favIconUrl ?? ''}`;
  let hash = 0;
  for (const char of source) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  return hash.toString(36);
}

// What a tab row says: the page title, else the domain, else the address.
export function tabTitle(tab) {
  const url = tab.pendingUrl || tab.url || '';
  return tab.title?.trim() || hostOf(url) || url;
}

// The speaker on a tab's row: 'muted' while its sound is off (even if the site is silent,
// as in the browser's own tab strip), 'playing' while it plays, else null.
export function soundState(tab) {
  if (tab?.mutedInfo?.muted) return 'muted';
  if (tab?.audible) return 'playing';
  return null;
}

// Split view (stage 5b): two tabs side by side share a splitViewId; -1 (or none) — not in one.
export const inSplit = (tab) => Number.isInteger(tab?.splitViewId) && tab.splitViewId !== -1;

// Where pairs of the window show, as one row each. `inFolders` and `loose` — from
// splitWindowTabs; `hostIds` — links that can show a pair, in tree order (tiles can't).
// A pair with a tab on such a link shows on that link (the first one in tree order):
//   onLinks — Map bookmarkId → the other tab of the pair; that tab leaves the divider
//             (unless it is on a link of its own: links are never hidden).
// Otherwise both are below the divider: `loose` gets one item { pair: [left, right],
// splitViewId } in place of the left tab. Anything else stays as it was.
export function placePairs({ inFolders, loose }, hostIds) {
  const linkOfTab = new Map([...inFolders].map(([bookmarkId, tab]) => [tab.id, bookmarkId]));
  const bySplit = new Map();
  for (const tab of [...inFolders.values(), ...loose]) {
    if (!inSplit(tab)) continue;
    if (!bySplit.has(tab.splitViewId)) bySplit.set(tab.splitViewId, []);
    bySplit.get(tab.splitViewId).push(tab);
  }

  const order = new Map(hostIds.map((id, i) => [id, i]));
  const onLinks = new Map();
  const hidden = new Set();
  const loosePairs = new Map(); // left tab id → pair item
  for (const [splitViewId, tabs] of bySplit) {
    if (tabs.length !== 2) continue;
    const pair = [...tabs].sort((a, b) => a.index - b.index);
    const hosts = pair.map((tab) => linkOfTab.get(tab.id)).filter((id) => order.has(id));
    if (hosts.length) {
      const host = hosts.sort((a, b) => order.get(a) - order.get(b))[0];
      const other = pair.find((tab) => linkOfTab.get(tab.id) !== host);
      onLinks.set(host, other);
      if (!linkOfTab.has(other.id)) hidden.add(other.id);
    } else if (pair.every((tab) => !linkOfTab.has(tab.id))) {
      loosePairs.set(pair[0].id, { pair, splitViewId });
      hidden.add(pair[1].id);
    }
  }

  const items = [];
  for (const tab of loose) {
    if (loosePairs.has(tab.id)) items.push(loosePairs.get(tab.id));
    else if (!hidden.has(tab.id)) items.push(tab);
  }
  return { onLinks, loose: items };
}

// The speaker of a pair: playing if either plays, else muted if either is muted.
export function pairSoundState(tabs) {
  const states = tabs.map(soundState);
  if (states.includes('playing')) return 'playing';
  return states.includes('muted') ? 'muted' : null;
}
