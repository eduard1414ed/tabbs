// Which tab belongs to which link. No chrome.* calls.
//
// A binding ties a bookmark to one open tab. Bindings live in storage.session,
// one key per bookmark ("tab:<bookmarkId>" → tabId), so the panels of several
// windows and the background script never overwrite each other's records.
// The window is not stored: a tab may be dragged to another window, so it is
// taken from the live tab.
//
// Tabs are shaped like chrome.tabs.Tab: { id, windowId, index, url, pendingUrl, active }.
// Links are { id, url }. Bindings are a Map bookmarkId → tabId.

import { sameUrl } from './urls.js';

export const BINDING_PREFIX = 'tab:';

export const bindingKey = (bookmarkId) => BINDING_PREFIX + bookmarkId;

// storage.session items → Map bookmarkId → tabId. Other keys are skipped.
export function parseBindings(items) {
  const bindings = new Map();
  for (const [key, value] of Object.entries(items ?? {})) {
    if (key.startsWith(BINDING_PREFIX) && Number.isInteger(value)) {
      bindings.set(key.slice(BINDING_PREFIX.length), value);
    }
  }
  return bindings;
}

// Where the tab is, or is about to be while a page is loading.
export const tabUrl = (tab) => tab?.pendingUrl || tab?.url || '';

// An open tab with this address that is not in `exclude`; the panel's window first.
export function findTabForUrl(url, tabs, { exclude = new Set(), windowId } = {}) {
  const matches = tabs.filter((tab) => !exclude.has(tab.id) && sameUrl(tabUrl(tab), url));
  return matches.find((tab) => tab.windowId === windowId) ?? matches[0] ?? null;
}

// What a click on a link does:
//   switch — its tab is open; bind — an unbound tab with the same address is open;
//   create — open a new tab and bind it.
export function resolveClick({ bookmarkId, url, bindings, tabs, windowId }) {
  const bound = tabs.find((tab) => tab.id === bindings.get(bookmarkId));
  if (bound) return { action: 'switch', tab: bound };

  const taken = new Set(bindings.values());
  const free = findTabForUrl(url, tabs, { exclude: taken, windowId });
  if (free) return { action: 'bind', tab: free };

  return { action: 'create' };
}

// "Open all" in a folder's menu: links with a live tab are left as they are; a link
// gets an open unbound tab with its address, if there is one (as a click would do;
// one tab goes to one link); the rest need new tabs, in folder order.
// → { bind: Map bookmarkId → tabId, create: [link…] }
export function planOpenAll(links, bindings, tabs, windowId) {
  const tabIds = new Set(tabs.map((tab) => tab.id));
  const taken = new Set(bindings.values());
  const bind = new Map();
  const create = [];
  for (const link of links) {
    if (tabIds.has(bindings.get(link.id))) continue;
    const free = findTabForUrl(link.url, tabs, { exclude: taken, windowId });
    if (free) {
      bind.set(link.id, free.id);
      taken.add(free.id);
    } else {
      create.push(link);
    }
  }
  return { bind, create };
}

// After a browser restart tabs come back with new ids. For every link without a
// live tab take the first unbound tab with the same address; a tab goes to one
// link at most. Returns the new bindings only.
export function restoreBindings(links, tabs, bindings) {
  const tabIds = new Set(tabs.map((tab) => tab.id));
  const taken = new Set();
  for (const link of links) {
    const tabId = bindings.get(link.id);
    if (tabIds.has(tabId)) taken.add(tabId);
  }

  const added = new Map();
  for (const link of links) {
    if (tabIds.has(bindings.get(link.id))) continue;
    const tab = findTabForUrl(link.url, tabs, { exclude: taken });
    if (!tab) continue;
    taken.add(tab.id);
    added.set(link.id, tab.id);
  }
  return added;
}

// Bookmark ids whose bindings must go: the tab is closed, the link is gone
// (when `linkIds` is given), or the tab is already bound to another link.
export function staleBindings(bindings, tabIds, linkIds) {
  const stale = [];
  const seenTabs = new Set();
  for (const [bookmarkId, tabId] of bindings) {
    if (!tabIds.has(tabId) || (linkIds && !linkIds.has(bookmarkId)) || seenTabs.has(tabId)) {
      stale.push(bookmarkId);
    } else {
      seenTabs.add(tabId);
    }
  }
  return stale;
}

export function bookmarksOfTab(bindings, tabId) {
  return [...bindings].filter(([, id]) => id === tabId).map(([bookmarkId]) => bookmarkId);
}

// The link whose tab is selected in the panel's window, or null.
export function activeLinkId(bindings, activeTabId) {
  if (activeTabId == null) return null;
  return bookmarksOfTab(bindings, activeTabId)[0] ?? null;
}

// How a link row looks: open (has a tab), active (its tab is selected),
// moved (the tab went to another address → offer ↩).
export function linkState(link, tab, activeTabId) {
  if (!tab) return { open: false, active: false, moved: false };
  const current = tabUrl(tab);
  return {
    open: true,
    active: tab.id === activeTabId,
    moved: current !== '' && !sameUrl(current, link.url),
  };
}
