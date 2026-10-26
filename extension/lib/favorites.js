// Favorites: the folder "Favorites" ("Избранное") at the top level of the root folder is
// shown as a grid of tiles above the tree, not as a folder row. No chrome.* calls.
//
// The folder is found by its name every time (nothing is stored): renamed — it is an
// ordinary folder again; created by an import — it is shown as tiles at once.

import { FAVORITES_TITLES } from './strings.js';

const normalize = (text) => text.trim().toLocaleLowerCase('ru');

// The favorites folder of the tree (lib/tree.js model) or null. Only the top level
// counts; the name may be in any language (FAVORITES_TITLES) and is compared without
// a leading emoji ("⭐ Favorites") and case. With several — the first in the tree.
export function findFavorites(tree) {
  const names = new Set(FAVORITES_TITLES.map(normalize));
  return tree.children.find((node) => node.kind === 'folder' && names.has(normalize(node.title))) ?? null;
}

// What the panel shows: `tiles` — links right inside the favorites folder (folders inside
// it are not shown, as in Arc), `rest` — the top level of the tree without the folder.
export function splitFavorites(tree) {
  const favorites = findFavorites(tree);
  return {
    favorites,
    tiles: favorites ? favorites.children.filter((node) => node.kind === 'link') : [],
    rest: favorites ? tree.children.filter((node) => node !== favorites) : tree.children,
  };
}

// How many tiles go in a row. As many as fit `width` (at least 2), then rows are evened
// out: 5 tiles with room for 4 → 3 + 2, 4 tiles with room for 3 → 2 + 2. Fewer tiles than
// fit — all in one row, stretched.
export function tileColumns(count, width, { minWidth, gap }) {
  if (count <= 0) return 1;
  const fit = Math.max(2, Math.floor((width + gap) / (minWidth + gap)));
  const rows = Math.ceil(count / fit);
  return Math.ceil(count / rows);
}
