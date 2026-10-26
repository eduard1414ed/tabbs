// Folder icons: an emoji at the start of the folder's bookmark title ("❤️ Podcast"),
// shown instead of the folder icon (lib/tree.js), or a pictogram (lib/pictograms.js).
// No chrome.* calls.
//
// Pictograms aren't in the bookmarks: storage.local keeps one key per folder
// ("pictogram:<folderId>" → pictogram name), so the bookmark title stays without it.
// A pictogram wins over the title's emoji.

import { splitLeadingEmoji } from './tree.js';
import { PICTOGRAMS, PICTOGRAM_THEMES } from './pictograms.js';

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

// The picker's choice, in this order.
export const FOLDER_EMOJI = [
  '📁', '❤️', '⭐', '🔥', '💼', '🏠', '📚', '🎬', '🎵', '🎮', '🛒', '💰',
  '📈', '🧪', '💡', '🛠️', '🎨', '✈️', '🍜', '📰', '📝', '📅', '💬', '🌍',
  '🎓', '🧠', '🏃', '🐱', '🌱', '🚀', '🔒', '📦', '⚙️', '🎁', '🇯🇵', '👀',
];

// The folder's bookmark title with `emoji` as its icon: put in front, replacing the
// current one; null — the icon removed.
export function withFolderEmoji(name, emoji) {
  const { title } = splitLeadingEmoji(name);
  if (!emoji) return title;
  return title ? `${emoji} ${title}` : emoji;
}

// The first emoji of what was typed or pasted into "Other…", or null if there is none.
export function pickEmoji(text) {
  for (const { segment } of graphemes.segment((text ?? '').trim())) {
    const { emoji } = splitLeadingEmoji(segment);
    if (emoji) return emoji;
  }
  return null;
}

// ---------- Pictograms

export const PICTOGRAM_PREFIX = 'pictogram:';

export const pictogramKey = (folderId) => PICTOGRAM_PREFIX + folderId;

// The picker's choice, in this order.
export const PICTOGRAM_NAMES = Object.keys(PICTOGRAMS);

// The picker's sections: [{ title, names }]; `titles` — theme → its name (strings.js pictogramThemes).
export const pictogramSections = (titles) =>
  PICTOGRAM_THEMES.map(([theme, names]) => ({ title: titles[theme] ?? theme, names }));

export const isPictogram = (name) => typeof name === 'string' && Object.hasOwn(PICTOGRAMS, name);

// storage.local items → Map folderId → pictogram name. Other keys and unknown names are skipped.
export function parsePictograms(items) {
  const pictograms = new Map();
  for (const [key, value] of Object.entries(items ?? {})) {
    if (key.startsWith(PICTOGRAM_PREFIX) && isPictogram(value)) {
      pictograms.set(key.slice(PICTOGRAM_PREFIX.length), value);
    }
  }
  return pictograms;
}

// What the folder shows instead of the plain folder icon: { pictogram } or { emoji }, or null.
export function folderIconOf(folder, pictograms) {
  const pictogram = pictograms?.get(folder.id);
  if (isPictogram(pictogram)) return { pictogram };
  if (folder.emoji) return { emoji: folder.emoji };
  return null;
}

// Folders with a pictogram that are gone from `folderIds` (a Set of the root's folders).
export function stalePictograms(pictograms, folderIds) {
  return [...pictograms.keys()].filter((id) => !folderIds.has(id));
}
