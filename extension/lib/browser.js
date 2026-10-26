// Thin wrappers over chrome.* shared by the panel and the background script.

import { ROOT_ID_KEY, locateRootFolder, ensureRootFolder } from './root.js';
import { rootFolderTitles } from './strings.js';
import { BINDING_PREFIX, bindingKey, parseBindings } from './binding.js';
import { hasBuiltInArcImport } from './arc-import.js';
import { themeOf, isTheme, actionIconPaths } from './action-icon.js';
import {
  SPACES_KEY,
  SPACES_BEFORE_KEY,
  CURRENT_PREFIX,
  LAST_SPACE_KEY,
  lastTabKey,
  parseSpaceSession,
  isSpaceSessionKey,
} from './spaces.js';

export { ROOT_ID_KEY, BINDING_PREFIX, SPACES_KEY };
export const EXPANDED_KEY = 'expandedFolders';
export const WELCOME_STEPS_KEY = 'welcomeSteps';
// storage.session: until when the background script restores bindings after startup.
export const RESTORE_UNTIL_KEY = 'restoreUntil';
// Panel → background: restore bindings if that hasn't happened in this browser session.
export const RESTORE_MESSAGE = 'restore-bindings';
// storage.session: the welcome page asks the panel of this window to start the Arc import.
export const IMPORT_REQUEST_KEY = 'arcImportRequest';
// storage.session: … or to open the dialog that turns spaces on (stage 8b).
export const SPACES_REQUEST_KEY = 'spacesRequest';
// storage.local: Helium's import from Arc ended — the ids it put at the top level, waiting
// for the panel to sort them: { ids, dismissed } (dismissed — the sorting was cancelled).
export const ARC_PENDING_KEY = 'arcImportPending';
// storage.local: Helium's folders left from a sorted import, removed once the undo is over
// (and only if empty): { ids, after } — not before the time `after`.
export const ARC_CLEANUP_KEY = 'arcImportCleanup';
// storage.local: Helium's last theme ('light' or 'dark'), so the toolbar button is right at startup.
export const ICON_THEME_KEY = 'iconTheme';

// The extension's name from the manifest: "Tabbs" in the public build. lib/strings.js puts it
// into the texts, and the root folder is named after it.
export const appName = () => chrome.runtime.getManifest().name;
// The manifest's "icons": { 16: 'icons/….png', 32: …, 48: …, 128: … } (lib/action-icon.js).
export const manifestIcons = () => chrome.runtime.getManifest().icons;

const rootDeps = () => ({
  bookmarks: chrome.bookmarks,
  storage: chrome.storage.local,
  titles: rootFolderTitles(appName()),
});

export const findRootFolder = () => locateRootFolder(rootDeps());
export const ensureRoot = () => ensureRootFolder(rootDeps());

// The browser's language, for strings(…) in lib/strings.js.
export const uiLanguage = () => chrome.i18n.getUILanguage();

// 'mac', 'win' or 'other': which keyboard hints to show.
export function platform() {
  const name = navigator.userAgentData?.platform || navigator.platform || '';
  if (/^mac/i.test(name)) return 'mac';
  if (/^win/i.test(name)) return 'win';
  return 'other';
}

export async function getSubTree(id) {
  const [node] = await chrome.bookmarks.getSubTree(id);
  return node;
}

// Editing (stage 3). Only ever called for nodes inside the root folder.
export const createBookmark = (details) => chrome.bookmarks.create(details);
export const updateBookmark = (id, changes) => chrome.bookmarks.update(id, changes);
export const removeBookmark = (id) => chrome.bookmarks.remove(id);
export const removeBookmarkTree = (id) => chrome.bookmarks.removeTree(id);
export const moveBookmark = (id, destination) => chrome.bookmarks.move(id, destination);

// How many children a folder has, or null if it is gone.
export async function childCount(id) {
  try {
    return (await chrome.bookmarks.getChildren(id)).length;
  } catch {
    return null;
  }
}

export async function getExpanded() {
  const { [EXPANDED_KEY]: ids } = await chrome.storage.local.get(EXPANDED_KEY);
  return Array.isArray(ids) ? ids : [];
}

export const setExpanded = (ids) => chrome.storage.local.set({ [EXPANDED_KEY]: ids });

export async function getCurrentWindowId() {
  const win = await chrome.windows.getCurrent();
  return win.id;
}

// `index` — where in the window's tab strip; at the end if not given.
export function openInNewTab(url, windowId, active = true, index = undefined) {
  const details = { url, windowId, active };
  if (index !== undefined) details.index = index;
  return chrome.tabs.create(details);
}

// A page of the extension itself, such as the welcome page.
export const extensionUrl = (path) => chrome.runtime.getURL(path);

export const getAllTabs = () => chrome.tabs.query({});

// Into `windowId` if given (a tab dragged from another window), else within its own window.
export const moveTab = (tabId, index, windowId) =>
  chrome.tabs.move(tabId, windowId === undefined ? { index } : { windowId, index });

// Split view (stage 5b): two neighbouring tabs side by side. Absent in browsers without it.
export const canSplitTabs = typeof chrome.tabs?.createSplit === 'function';
export const createSplit = (tabIds) => chrome.tabs.createSplit(tabIds);
export const unsplit = (splitViewId) => chrome.tabs.unsplit(splitViewId);
// A new tab opened as a pair with `tabId`, on its right, and selected.
export const openSplitTab = (url, tabId) => chrome.tabs.create({ url, splitWithTabId: tabId, active: true });
// Chromium pairs tabs of one tab group (or none): `tabId` joins `groupId` or leaves its group.
export const setTabGroup = (tabId, groupId) =>
  groupId === -1 ? chrome.tabs.ungroup(tabId) : chrome.tabs.group({ groupId, tabIds: tabId });

// Select a tab, and its window if it is not the panel's one.
export async function activateTab(tab, currentWindowId) {
  await chrome.tabs.update(tab.id, { active: true });
  if (tab.windowId !== currentWindowId) await chrome.windows.update(tab.windowId, { focused: true });
}

// Link ↔ tab bindings (see lib/binding.js), Map bookmarkId → tabId.
export async function getBindings() {
  return parseBindings(await chrome.storage.session.get(null));
}

export const setBindings = (bindings) =>
  chrome.storage.session.set(Object.fromEntries([...bindings].map(([id, tabId]) => [bindingKey(id), tabId])));

export const bindTab = (bookmarkId, tabId) => setBindings(new Map([[bookmarkId, tabId]]));

export async function unbind(bookmarkIds) {
  if (bookmarkIds.length) await chrome.storage.session.remove(bookmarkIds.map(bindingKey));
}

export const requestRestore = () => chrome.runtime.sendMessage({ type: RESTORE_MESSAGE });

// The welcome page's request (`key`: IMPORT_REQUEST_KEY, SPACES_REQUEST_KEY) for the panel of
// `windowId`, taken at most once.
export async function takeRequest(key, windowId) {
  const { [key]: requested } = await chrome.storage.session.get(key);
  if (requested !== windowId) return false;
  await chrome.storage.session.remove(key);
  return true;
}

// Site icon from the browser's own cache (needs the "favicon" permission).
// `version` only makes the address different when the site's icon has changed,
// so the panel asks the cache again instead of reusing the image it already has.
export function faviconUrl(pageUrl, size = 32, version) {
  const url = new URL(chrome.runtime.getURL('/_favicon/'));
  url.searchParams.set('pageUrl', pageUrl);
  url.searchParams.set('size', String(size));
  if (version) url.searchParams.set('v', version);
  return url.toString();
}

// ---------- Welcome page (stage 7b)

// A page of the browser, such as chrome://settings/appearance (helium:// works too, in Helium).
export const openBrowserPage = (url) => chrome.tabs.create({ url });

// Only in answer to a click.
export const openPanel = (windowId) => chrome.sidePanel.open({ windowId });

// 'left' or 'right'; null where the browser can't tell.
export async function panelSide() {
  try {
    return (await chrome.sidePanel.getLayout())?.side ?? null;
  } catch {
    return null;
  }
}

// The welcome page's setup steps ticked by hand (ids), kept until the extension is removed.
export async function getTickedSteps() {
  const { [WELCOME_STEPS_KEY]: ids } = await chrome.storage.local.get(WELCOME_STEPS_KEY);
  return Array.isArray(ids) ? ids : [];
}

export const setTickedSteps = (ids) => chrome.storage.local.set({ [WELCOME_STEPS_KEY]: ids });

// The shortcuts of the extension's commands: { name: "⇧⌘S" or '' if none }.
async function shortcuts() {
  const commands = await chrome.commands.getAll();
  return Object.fromEntries(commands.map((command) => [command.name, command.shortcut ?? '']));
}

// The shortcut that opens the panel ("⇧⌘S"), or '' if there is none.
export const panelShortcut = async () => (await shortcuts())._execute_action ?? '';

// The keys for the next and the previous space, '' where none are assigned.
export async function spaceShortcuts() {
  const keys = await shortcuts();
  return { next: keys[NEXT_SPACE_COMMAND] ?? '', previous: keys[PREVIOUS_SPACE_COMMAND] ?? '' };
}

// ---------- Helium's import from Arc

// Where the browser imports bookmarks from other browsers.
export const IMPORT_PAGE = 'chrome://settings/importData';

// Helium (and Chrome) import from Arc themselves; elsewhere Arc's file is chosen by hand.
export const builtInArcImport = () =>
  hasBuiltInArcImport({ brands: navigator.userAgentData?.brands ?? [], brave: 'brave' in navigator });

export async function getArcPending() {
  const { [ARC_PENDING_KEY]: pending } = await chrome.storage.local.get(ARC_PENDING_KEY);
  return pending && Array.isArray(pending.ids) ? pending : null;
}

export const setArcPending = (pending) => chrome.storage.local.set({ [ARC_PENDING_KEY]: pending });
export const forgetArcPending = () => chrome.storage.local.remove(ARC_PENDING_KEY);

export async function getArcCleanup() {
  const { [ARC_CLEANUP_KEY]: cleanup } = await chrome.storage.local.get(ARC_CLEANUP_KEY);
  return cleanup && Array.isArray(cleanup.ids) ? cleanup : { ids: [], after: 0 };
}

export const setArcCleanup = (cleanup) =>
  (cleanup.ids.length ? chrome.storage.local.set({ [ARC_CLEANUP_KEY]: cleanup }) : chrome.storage.local.remove(ARC_CLEANUP_KEY));

// Where a bookmark is now: { id, parentId, index, title }.
export const getBookmark = async (id) => (await chrome.bookmarks.get(id))[0];

// The window the user was in last (the panel of another window keeps quiet), or null.
export async function lastFocusedWindowId() {
  try {
    return (await chrome.windows.getLastFocused()).id;
  } catch {
    return null;
  }
}

// Asks the panel of `windowId` to start the Arc import (it may be opening right now).
export const requestImport = (windowId) => chrome.storage.session.set({ [IMPORT_REQUEST_KEY]: windowId });
// … to open the dialog that turns spaces on.
export const requestSpaces = (windowId) => chrome.storage.session.set({ [SPACES_REQUEST_KEY]: windowId });

// ---------- Spaces (stage 8)

// Panel → background: put the tabs of a window (`windowId`, or all windows) into their spaces' groups.
export const SPACES_TIDY_MESSAGE = 'spaces-tidy';
// Panel → background: turn spaces off (the background dissolves the groups and answers when done).
export const SPACES_OFF_MESSAGE = 'spaces-off';
// Panel → background: tabs of a window into a space (dropped onto its icon; stage 8b).
export const SPACES_MOVE_MESSAGE = 'spaces-move';
// Commands for the keys of the next / previous space (manifest.json, no keys by default).
export const NEXT_SPACE_COMMAND = 'next-space';
export const PREVIOUS_SPACE_COMMAND = 'previous-space';

// Tab groups are an optional permission, asked for only when spaces are turned on.
const TAB_GROUPS = { permissions: ['tabGroups'] };
// Only in answer to a click: call it first thing in the click handler.
export const requestTabGroups = () => chrome.permissions.request(TAB_GROUPS);
export const hasTabGroups = () => chrome.permissions.contains(TAB_GROUPS);
export const dropTabGroups = () => chrome.permissions.remove(TAB_GROUPS);

// Ids of the space folders in the bar's order, or null — spaces are off.
export async function getSpaceIds() {
  const { [SPACES_KEY]: ids } = await chrome.storage.local.get(SPACES_KEY);
  return Array.isArray(ids) ? ids : null;
}

export const setSpaceIds = (ids) => chrome.storage.local.set({ [SPACES_KEY]: ids });

// The spaces when they were last turned off: ticked when turning them on again.
export async function getSpacesBefore() {
  const { [SPACES_BEFORE_KEY]: ids } = await chrome.storage.local.get(SPACES_BEFORE_KEY);
  return Array.isArray(ids) ? ids : [];
}

// Spaces off: the list is kept for next time, the session records go.
export async function forgetSpaces(ids) {
  await chrome.storage.local.set({ [SPACES_BEFORE_KEY]: ids ?? [] });
  await chrome.storage.local.remove(SPACES_KEY);
  const keys = Object.keys(await chrome.storage.session.get(null)).filter(isSpaceSessionKey);
  if (keys.length) await chrome.storage.session.remove(keys);
}

// Groups, windows' spaces and last tabs (lib/spaces.js parseSpaceSession).
export const getSpaceSession = async () => parseSpaceSession(await chrome.storage.session.get(null));

export const setSpaceSession = (records) => chrome.storage.session.set(records);

// The window's space, also remembered as the last one used (a new window starts in it).
export const setWindowSpace = (windowId, spaceId) =>
  chrome.storage.session.set({ [`${CURRENT_PREFIX}${windowId}`]: spaceId, [LAST_SPACE_KEY]: spaceId });

export const setLastTab = (windowId, spaceId, tabId) => chrome.storage.session.set({ [lastTabKey(windowId, spaceId)]: tabId });

export const tidySpaces = (windowId) => chrome.runtime.sendMessage({ type: SPACES_TIDY_MESSAGE, windowId });
export const turnSpacesOff = () => chrome.runtime.sendMessage({ type: SPACES_OFF_MESSAGE });
export const moveTabsToSpace = (windowId, spaceId, tabIds) =>
  chrome.runtime.sendMessage({ type: SPACES_MOVE_MESSAGE, windowId, spaceId, tabIds });

// Tab groups of the windows (all of them, or of `windowId`); [] without the permission.
export const getGroups = (windowId) =>
  chrome.tabGroups ? chrome.tabGroups.query(windowId === undefined ? {} : { windowId }) : Promise.resolve([]);

// ---------- Folder pictograms (lib/folder-icons.js): storage.local, one key per folder.
// The panel makes the keys (pictogramKey), so the background script doesn't load the set.

export const getLocalItems = () => chrome.storage.local.get(null);
export const setLocalItems = (items) => chrome.storage.local.set(items);
export async function removeLocalKeys(keys) {
  if (keys.length) await chrome.storage.local.remove(keys);
}

// ---------- Toolbar button icon (lib/action-icon.js)

const setActionIcon = (theme) => chrome.action.setIcon({ path: actionIconPaths(theme) });

// Background script, on browser start and after an update or reload (both reset the button
// to the manifest's icon): the icon of the last theme a page saw.
export async function restoreActionIcon() {
  const { [ICON_THEME_KEY]: theme } = await chrome.storage.local.get(ICON_THEME_KEY);
  if (isTheme(theme) && theme !== 'light') await setActionIcon(theme);
}

// Extension pages (panel, welcome): only a page knows Helium's theme, the background script
// doesn't. Sets the icon now and on every theme switch, and remembers the theme.
// Several open panels set the same icon — harmless.
export function followThemeWithActionIcon() {
  const query = matchMedia('(prefers-color-scheme: dark)');
  const sync = async () => {
    const theme = themeOf(query.matches);
    await setActionIcon(theme);
    const { [ICON_THEME_KEY]: saved } = await chrome.storage.local.get(ICON_THEME_KEY);
    if (saved !== theme) await chrome.storage.local.set({ [ICON_THEME_KEY]: theme });
  };
  const run = () => sync().catch((error) => console.error('Failed to set the toolbar icon', error));
  query.addEventListener('change', run);
  run();
}
