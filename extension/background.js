import {
  RESTORE_UNTIL_KEY,
  RESTORE_MESSAGE,
  ensureRoot,
  findRootFolder,
  getSubTree,
  getAllTabs,
  getBindings,
  setBindings,
  unbind,
  openInNewTab,
  extensionUrl,
  uiLanguage,
  appName,
  restoreActionIcon,
  SPACES_TIDY_MESSAGE,
  SPACES_OFF_MESSAGE,
  SPACES_MOVE_MESSAGE,
  hasTabGroups,
  dropTabGroups,
  getSpaceIds,
  forgetSpaces,
  getSpaceSession,
  setSpaceSession,
  getGroups,
  setWindowSpace,
  NEXT_SPACE_COMMAND,
  PREVIOUS_SPACE_COMMAND,
  setArcPending,
} from './lib/browser.js';
import { importedTops, findArcImport } from './lib/arc-import.js';
import { buildTree, collectLinks } from './lib/tree.js';
import { restoreBindings, staleBindings, bookmarksOfTab } from './lib/binding.js';
import { findFavorites } from './lib/favorites.js';
import { strings } from './lib/strings.js';
import {
  GROUP_PREFIX,
  CURRENT_PREFIX,
  resolveSpaces,
  linkSpaces,
  groupTitles,
  matchGroups,
  tabTargets,
  regroupPlan,
  windowSpace,
  pickSpaceTab,
  adjacentSpace,
  lastTabKey,
} from './lib/spaces.js';

// After startup Helium keeps bringing tabs back for a while (lazily, window by window),
// so restoring is repeated on tab events during this time.
const RESTORE_WINDOW_MS = 30_000;
const RESTORE_DELAY_MS = 500;

// Clicking the toolbar icon opens the side panel.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('Failed to set side panel behavior', error));

// ---------- Bindings

// Binding updates run one at a time, so two of them never work from the same snapshot.
let queue = Promise.resolve();
function exclusive(task) {
  queue = queue.then(task).catch((error) => console.error('Failed to update bindings', error));
  return queue;
}

// Drop bindings of closed tabs and removed links, then give every link without
// a tab an open tab with the same address.
async function restoreNow() {
  const root = await findRootFolder();
  if (!root) return;
  const links = collectLinks(buildTree(await getSubTree(root.id)));
  const [tabs, bindings] = await Promise.all([getAllTabs(), getBindings()]);

  const stale = staleBindings(bindings, new Set(tabs.map((tab) => tab.id)), new Set(links.map((link) => link.id)));
  for (const id of stale) bindings.delete(id);
  await unbind(stale);

  const added = restoreBindings(links, tabs, bindings);
  if (added.size) await setBindings(added);
}

// Also kept here, set at once: a check that is reading storage.session right now must
// see a window that has just opened, before storage has it.
let restoreUntil = 0;

async function startRestoreWindow() {
  restoreUntil = Date.now() + RESTORE_WINDOW_MS;
  watchTabs();
  stopWatchingTabs().catch(logWatchError); // when the window ends
  await chrome.storage.session.set({ [RESTORE_UNTIL_KEY]: restoreUntil });
  await exclusive(restoreNow);
}

// When the restore window ends (or ended), 0 if it was never opened.
async function restoreWindowEnd() {
  const { [RESTORE_UNTIL_KEY]: stored } = await chrome.storage.session.get(RESTORE_UNTIL_KEY);
  return Math.max(restoreUntil, typeof stored === 'number' ? stored : 0);
}

let restoreTimer = null;
async function onTabsAppeared() {
  if (Date.now() >= (await restoreWindowEnd())) return;
  clearTimeout(restoreTimer);
  restoreTimer = setTimeout(() => exclusive(restoreNow), RESTORE_DELAY_MS);
}

// New tabs and address changes matter only during the restore window. Outside it the
// worker unsubscribes: Helium keeps freezing and unfreezing background tabs (dozens of
// tabs.onUpdated a minute), and every event would wake the worker, so it never slept.
// Listeners are added at the top level on every start (so an event inside the window
// is delivered) and removed again once the window is over.
const logRestoreError = (error) => console.error('Failed to restore bindings', error);
const logWatchError = (error) => console.error('Failed to check the restore window', error);
const onTabCreated = () => onTabsAppeared().catch(logRestoreError);
const onTabUpdated = (tabId, info) => {
  if ('url' in info) onTabsAppeared().catch(logRestoreError);
};

function watchTabs() {
  if (!chrome.tabs.onCreated.hasListener(onTabCreated)) chrome.tabs.onCreated.addListener(onTabCreated);
  if (!chrome.tabs.onUpdated.hasListener(onTabUpdated)) chrome.tabs.onUpdated.addListener(onTabUpdated);
}

// Unsubscribes now if the window is over, else checks again when it ends.
let watchTimer = null;
async function stopWatchingTabs() {
  const left = (await restoreWindowEnd()) - Date.now();
  clearTimeout(watchTimer);
  if (left > 0) {
    watchTimer = setTimeout(() => stopWatchingTabs().catch(logWatchError), left + RESTORE_DELAY_MS);
    return;
  }
  chrome.tabs.onCreated.removeListener(onTabCreated);
  chrome.tabs.onUpdated.removeListener(onTabUpdated);
}

watchTabs();
stopWatchingTabs().catch(logWatchError);

// Browser start: tabs are restored with new ids and storage.session is empty.
chrome.runtime.onStartup.addListener(() => {
  restoreActionIcon().catch((error) => console.error('Failed to set the toolbar icon', error));
  startRestoreWindow().catch((error) => console.error('Failed to restore bindings', error));
});

// On install and on every extension update/reload: make sure the root folder exists.
// Not on browser startup: if the folder was deleted, the panel offers to recreate it.
// A reload also clears storage.session, so bindings are restored too.
// The very first install also opens the welcome page (not updates and reloads).
chrome.runtime.onInstalled.addListener(({ reason }) => {
  restoreActionIcon().catch((error) => console.error('Failed to set the toolbar icon', error));
  if (reason === chrome.runtime.OnInstalledReason.INSTALL) {
    openInNewTab(extensionUrl('welcome.html')).catch((error) => console.error('Failed to open the welcome page', error));
  }
  ensureRoot()
    .catch((error) => console.error('Failed to find or create the root folder', error))
    .then(startRestoreWindow)
    .catch((error) => console.error('Failed to restore bindings', error));
});

// A panel opened: a safety net in case the startup pass didn't run.
// Only once per browser session, so tabs opened later don't stick to links by themselves.
// Panels also ask to put tabs into their spaces and to turn spaces off.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === SPACES_TIDY_MESSAGE) {
    watchSpaces(true);
    scheduleTidy(message.windowId);
    sendResponse({ ok: true });
    return;
  }
  if (message?.type === SPACES_MOVE_MESSAGE) {
    exclusive(() => moveIntoSpace(message)).then(() => sendResponse({ ok: true }));
    return true; // answers when the tabs are in the group
  }
  if (message?.type === SPACES_OFF_MESSAGE) {
    exclusive(spacesOff).then(() => sendResponse({ ok: true }));
    return true; // answers when the groups are dissolved
  }
  if (message?.type !== RESTORE_MESSAGE) return;
  chrome.storage.session.get(RESTORE_UNTIL_KEY)
    .then(({ [RESTORE_UNTIL_KEY]: until }) => (until ? undefined : startRestoreWindow()))
    .catch((error) => console.error('Failed to restore bindings', error));
  sendResponse({ ok: true });
});

// ---------- Spaces (stage 8)
//
// Which tab is in which space — tab groups, one per space in every window (lib/spaces.js).
// Only this script changes groups, one pass at a time (the same queue as bindings), so two
// panels never make two groups for one space.

// A new tab gets its group a moment later: by then a panel has bound it to its link, if any.
// Right after startup Helium is still bringing windows back, with their groups — wait longer.
const TIDY_DELAY_MS = 300;
const TIDY_STARTUP_DELAY_MS = 1500;

// Spaces as the bookmarks and storage have them, or null when they are off.
async function spacesContext() {
  const ids = await getSpaceIds();
  if (!ids || !(await hasTabGroups())) return null;
  const root = await findRootFolder();
  if (!root) return null;
  const tree = buildTree(await getSubTree(root.id));
  const favorites = findFavorites(tree);
  const spaces = resolveSpaces(tree, ids, favorites?.id);
  if (!spaces.list.length) return null;
  const tiles = favorites ? favorites.children.filter((node) => node.kind === 'link') : [];
  return {
    ids: spaces.list.map((space) => space.id),
    titles: groupTitles(spaces.list, strings(uiLanguage(), appName()).spaces.untitled),
    linkSpace: linkSpaces(spaces, tiles),
  };
}

// Every tab of the window into its space's group: groups are matched to spaces (by title
// after a restart), renamed after their spaces, made where a space has none yet.
async function tidyWindow(windowId, context, session, bindings) {
  const [groups, tabs] = await Promise.all([getGroups(windowId), chrome.tabs.query({ windowId })]);
  const match = matchGroups(groups, context.titles, session.groupSpace);
  const records = {};
  for (const [groupId, spaceId] of match.groupSpace) {
    if (session.groupSpace.get(groupId) !== spaceId) records[`${GROUP_PREFIX}${groupId}`] = spaceId;
  }
  for (const [groupId, title] of match.rename) {
    await chrome.tabGroups.update(groupId, { title }).catch((error) => console.warn('Failed to rename a group', error));
  }

  const ctx = { linkSpace: context.linkSpace, bindings, groupSpace: match.groupSpace };
  const active = tabs.find((tab) => tab.active);
  const stored = session.current.get(windowId);
  const current = windowSpace({
    stored,
    activeTarget: active && tabTargets(tabs, { ...ctx, current: undefined }).get(active.id),
    last: session.last,
    ids: context.ids,
  });
  if (current !== stored) records[`${CURRENT_PREFIX}${windowId}`] = current;

  const plan = regroupPlan(tabs, tabTargets(tabs, { ...ctx, current }), match.groupOf);
  if (plan.ungroup.length) await chrome.tabs.ungroup(plan.ungroup).catch((error) => console.warn('Failed to ungroup', error));
  for (const [spaceId, tabIds] of plan.join) {
    try {
      await joinSpace(windowId, spaceId, tabIds, match.groupOf.get(spaceId), context, records);
    } catch (error) {
      console.warn('Failed to put tabs into their space', spaceId, tabIds, error); // a tab closed meanwhile
    }
  }
  if (Object.keys(records).length) await setSpaceSession(records);
}

// Tabs into the space's group `groupId`, or a new group of the space in the window.
async function joinSpace(windowId, spaceId, tabIds, groupId, context, records) {
  if (groupId !== undefined) {
    await chrome.tabs.group({ groupId, tabIds });
    return;
  }
  const created = await chrome.tabs.group({ tabIds, createProperties: { windowId } });
  await chrome.tabGroups.update(created, { title: context.titles.get(spaceId), color: 'grey' });
  records[`${GROUP_PREFIX}${created}`] = spaceId;
}

// Tabs dropped onto a space's icon in the panel (stage 8b): into that space's group. The window
// is tidied first, so its groups are known.
async function moveIntoSpace({ windowId, spaceId, tabIds }) {
  const context = await spacesContext();
  if (!context || !context.ids.includes(spaceId) || !Array.isArray(tabIds) || !tabIds.length) return;
  await tidyWindow(windowId, context, await getSpaceSession(), await getBindings());
  const session = await getSpaceSession();
  const { groupOf } = matchGroups(await getGroups(windowId), context.titles, session.groupSpace);
  const records = {};
  try {
    await joinSpace(windowId, spaceId, tabIds, groupOf.get(spaceId), context, records);
  } catch (error) {
    console.warn('Failed to move tabs into the space', spaceId, tabIds, error); // a tab closed meanwhile
  }
  if (Object.keys(records).length) await setSpaceSession(records);
}

async function tidy(windowIds) {
  const context = await spacesContext();
  if (!context) return;
  const [session, bindings] = await Promise.all([getSpaceSession(), getBindings()]);
  const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
  for (const { id } of windows) {
    if (windowIds && !windowIds.has(id)) continue;
    await tidyWindow(id, context, session, bindings);
  }
}

let tidyTimer = null;
let tidyWindows = new Set(); // empty — all windows
let tidyAll = false;
function scheduleTidy(windowId) {
  if (windowId === undefined) tidyAll = true;
  else tidyWindows.add(windowId);
  clearTimeout(tidyTimer);
  const delay = Date.now() < restoreUntil ? TIDY_STARTUP_DELAY_MS : TIDY_DELAY_MS;
  tidyTimer = setTimeout(() => {
    const windows = tidyAll ? null : tidyWindows;
    tidyAll = false;
    tidyWindows = new Set();
    exclusive(() => tidy(windows));
  }, delay);
}

// The keys for the next / previous space (stage 8b, assigned by hand): the window switches to
// the neighbouring space and its tab last selected there, else its most recent one, else a new
// tab — like a click on the icon in the panel. No going round. An open panel follows by itself.
async function stepSpace(windowId, step) {
  const context = await spacesContext();
  if (!context) return;
  if (windowId === undefined) windowId = (await chrome.windows.getLastFocused({ windowTypes: ['normal'] })).id;
  const [session, bindings, groups, tabs] = await Promise.all([
    getSpaceSession(), getBindings(), getGroups(windowId), chrome.tabs.query({ windowId }),
  ]);
  const match = matchGroups(groups, context.titles, session.groupSpace);
  const ctx = { linkSpace: context.linkSpace, bindings, groupSpace: match.groupSpace };
  const active = tabs.find((tab) => tab.active);
  const current = windowSpace({
    stored: session.current.get(windowId),
    activeTarget: active && tabTargets(tabs, { ...ctx, current: undefined }).get(active.id),
    last: session.last,
    ids: context.ids,
  });
  const next = adjacentSpace(context.ids, current, step);
  if (!next) return;
  const targets = tabTargets(tabs, { ...ctx, current });
  const tabId = pickSpaceTab(tabs, targets, next, session.lastTabs.get(lastTabKey(windowId, next)));
  await setWindowSpace(windowId, next);
  if (tabId !== null) await chrome.tabs.update(tabId, { active: true });
  else await chrome.tabs.create({ windowId, active: true });
  await tidyWindow(windowId, context, await getSpaceSession(), bindings); // the new tab into the space's group
}

chrome.commands.onCommand.addListener((command, tab) => {
  const step = { [NEXT_SPACE_COMMAND]: 1, [PREVIOUS_SPACE_COMMAND]: -1 }[command];
  if (!step) return;
  exclusive(() => stepSpace(tab?.windowId, step));
});

// Spaces off: the spaces' groups are dissolved (tabs stay open), the list is kept for the next
// time, the permission is given back. Also when the permission was taken away by hand.
async function spacesOff() {
  const ids = await getSpaceIds();
  if (!ids) return;
  watchSpaces(false);
  const context = await spacesContext().catch(() => null);
  const session = await getSpaceSession();
  const groups = new Set(session.groupSpace.keys());
  if (context) {
    for (const group of await getGroups()) {
      if (matchGroups([group], context.titles).groupOf.size) groups.add(group.id);
    }
  }
  const tabIds = (await chrome.tabs.query({})).filter((tab) => groups.has(tab.groupId)).map((tab) => tab.id);
  if (tabIds.length) await chrome.tabs.ungroup(tabIds).catch((error) => console.warn('Failed to dissolve the groups', error));
  await forgetSpaces(ids);
  if (await hasTabGroups()) await dropTabGroups().catch((error) => console.warn('Failed to give back tab groups', error));
}

// New tabs and tabs from other windows go into their spaces. Only while spaces are on: like
// the restore window above, the listeners are added at the top level on every start and
// removed again when spaces are off, so the worker keeps sleeping.
const onSpaceTabCreated = (tab) => scheduleTidy(tab.windowId);
const onSpaceTabAttached = (tabId, { newWindowId }) => scheduleTidy(newWindowId);

function watchSpaces(on) {
  for (const [event, listener] of [[chrome.tabs.onCreated, onSpaceTabCreated], [chrome.tabs.onAttached, onSpaceTabAttached]]) {
    if (on && !event.hasListener(listener)) event.addListener(listener);
    if (!on) event.removeListener(listener);
  }
}

watchSpaces(true);
getSpaceIds()
  .then((ids) => {
    if (ids) scheduleTidy();
    else watchSpaces(false);
  })
  .catch((error) => console.error('Failed to check spaces', error));

chrome.permissions.onRemoved.addListener(({ permissions }) => {
  if (permissions?.includes('tabGroups')) exclusive(spacesOff);
});

// A closed tab frees its link.
chrome.tabs.onRemoved.addListener((tabId) => exclusive(async () => {
  await unbind(bookmarksOfTab(await getBindings(), tabId));
}));

// Chromium may swap a tab for a preloaded one with another id: keep the link.
chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => exclusive(async () => {
  const ids = bookmarksOfTab(await getBindings(), removedTabId);
  if (ids.length) await setBindings(new Map(ids.map((id) => [id, addedTabId])));
}));

// Helium's import from Arc (after stage 8b): the bookmarks an import creates are noted as they
// come (the worker wakes for every bookmark created, and goes back to sleep at once); at its
// end, if what it put at the top level came from Arc, it waits for the panel to sort it.
let imported = null; // [{ id, parentId }] while an import runs

chrome.bookmarks.onImportBegan.addListener(() => { imported = []; });

chrome.bookmarks.onCreated.addListener((id, node) => { imported?.push({ id, parentId: node.parentId }); });

chrome.bookmarks.onImportEnded.addListener(() => {
  const created = imported;
  imported = null;
  if (created?.length) noteArcImport(importedTops(created)).catch((error) => console.error('Failed to note the import', error));
});

async function noteArcImport(ids) {
  const nodes = (await Promise.all(ids.map((id) => getSubTree(id).catch(() => null)))).filter(Boolean);
  if (findArcImport(nodes)) await setArcPending({ ids, dismissed: false });
}
