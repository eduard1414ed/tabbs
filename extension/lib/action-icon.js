// The toolbar button follows Helium's theme: the dark mark on a light toolbar, the light
// mark on a dark one. The panel header and the extensions page can't follow it (they take
// the manifest's "icons"), so those use the outlined mark that works on both.

export const THEMES = ['light', 'dark'];
const ACTION_SIZES = [16, 32];
const ICON_BY_THEME = { light: 'tabbs', dark: 'tabbs-light' };

export const themeOf = (prefersDark) => (prefersDark ? 'dark' : 'light');

export const isTheme = (value) => THEMES.includes(value);

// The `path` for chrome.action.setIcon; light for anything unknown (the manifest's default).
export function actionIconPaths(theme) {
  const name = ICON_BY_THEME[isTheme(theme) ? theme : 'light'];
  return Object.fromEntries(ACTION_SIZES.map((size) => [size, `/icons/${name}-${size}.png`]));
}

// The welcome page (always light): its logo is the manifest's 128 px icon, the plain mark
// rather than the outlined one; its tab gets the 32 px icon as it is (tab strips may be dark).
// Paths from the extension's root. One page, and each build shows its own mark.
export const logoPath = (icons) => `/${icons[128].replace('-outline-', '-')}`;
export const faviconPath = (icons) => `/${icons[32]}`;
