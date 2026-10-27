// The panel's own color (stage 9): picked with the browser's eyedropper from Helium's panel
// header, one for the light theme and one for the dark. From the color the panel works out
// its other colors so that text stays readable. No chrome.* calls.
//
// storage.local, PANEL_COLOR_KEY: { light?: '#rrggbb', dark?: '#rrggbb' }; no key — the
// colors of tokens.css.

import { THEMES } from './action-icon.js';

export const PANEL_COLOR_KEY = 'panelColor';

// Readability (WCAG contrast): the main text at least 4.5 : 1, the muted text 3 : 1.
export const TEXT_CONTRAST = 4.5;
export const MUTED_CONTRAST = 3;
// The selected row and the current space must stand out from the background a little.
const ACTIVE_CONTRAST = 1.2;
// The focus ring and the drop line in the accent color — or in the text color, if the
// accent is hard to see on this background.
const ACCENT_CONTRAST = 3;

const BLACK = [0, 0, 0];
const WHITE = [255, 255, 255];

// '#rrggbb' (any case, also '#rgb') → [r, g, b]; anything else → null.
export function parseHex(text) {
  if (typeof text !== 'string') return null;
  let hex = text.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(hex)) hex = [...hex].map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

export const toHex = (rgb) => `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;

// 'rgb(1, 2, 3)' / 'rgba(1, 2, 3, .5)' as getComputedStyle gives it → { rgb, alpha }; else null.
export function parseRgb(text) {
  const match = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(String(text).trim());
  if (!match) return null;
  const alpha = match[4] === undefined ? 1 : match[4].endsWith('%') ? parseFloat(match[4]) / 100 : Number(match[4]);
  return { rgb: [match[1], match[2], match[3]].map(Number), alpha };
}

// `from` moved towards `to` by t (0…1).
export const mix = (from, to, t) => from.map((c, i) => c + (to[i] - c) * t);

// `rgb` with transparency `alpha` laid over `under`.
export const over = (rgb, alpha, under) => mix(under, rgb, alpha);

export function luminance(rgb) {
  const [r, g, b] = rgb.map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

// Dark text reads better on this background than light text.
export const isLightColor = (rgb) => contrast(rgb, BLACK) >= contrast(rgb, WHITE);

// The background's color moved towards `ink` just enough for `target` contrast, starting at
// `start`. Black or white ink reaches 4.5 : 1 on any background, so this never fails.
function readable(bg, ink, target, start) {
  for (let t = start; t < 1; t += 0.02) {
    const color = mix(bg, ink, t);
    if (contrast(color, bg) >= target) return color;
  }
  return ink;
}

// The overlay of `ink` that stands out enough: from `alpha` up, at most .3.
function visibleAlpha(bg, ink, alpha, target) {
  let a = alpha;
  while (a < 0.3 && contrast(over(ink, a, bg), bg) < target) a += 0.02;
  return Math.round(a * 100) / 100;
}

// White or black for the selected row and how strong: white if it shows and the text stays
// readable on it, else black; failing both — the one the text reads better on.
function shadeFor(bg, text) {
  const options = [WHITE, BLACK].map((rgb) => {
    const alpha = visibleAlpha(bg, rgb, 0.1, ACTIVE_CONTRAST);
    const row = over(rgb, alpha, bg);
    return { rgb, alpha, shows: contrast(row, bg) >= ACTIVE_CONTRAST, reads: contrast(text, row) };
  });
  return options.find((option) => option.shows && option.reads >= TEXT_CONTRAST)
    ?? options.filter((option) => option.shows).sort((a, b) => b.reads - a.reads)[0]
    ?? options[1];
}

const rgba = (rgb, alpha) => `rgba(${rgb.map(Math.round).join(', ')}, ${alpha})`;

// The panel's colors from its background `hex`. `accent` — the theme's accent ([r, g, b]),
// kept if it is visible on the background. Returns null for a wrong color.
// `scheme` — light or dark: which of tokens.css's colors go with it (menus' shadows,
// the toast, red buttons); `tokens` — CSS variables of tokens.css with their new values.
export function panelPalette(hex, accent) {
  const bg = parseHex(hex);
  if (!bg) return null;
  const light = isLightColor(bg);
  const ink = light ? BLACK : WHITE;
  const text = readable(bg, ink, TEXT_CONTRAST, 0.85);
  const muted = readable(bg, ink, MUTED_CONTRAST, 0.5);
  // The selected row is the same color, only lighter or darker (Ed's choice): lighter, as
  // Helium's selected tab and Arc's; darker where lighter doesn't show (a near-white panel)
  // or would make the text hard to read. Hover and tiles go the same way, fainter.
  const shade = shadeFor(bg, text);
  const tokens = {
    '--bg': toHex(bg),
    '--text': toHex(text),
    '--text-muted': toHex(muted),
    '--hover': rgba(shade.rgb, light ? 0.05 : 0.06),
    '--active': rgba(shade.rgb, shade.alpha),
    '--divider': rgba(ink, 0.08),
    '--tile-bg': rgba(shade.rgb, light ? 0.04 : 0.06),
    '--tile-hover': rgba(shade.rgb, light ? 0.07 : 0.1),
    '--surface': toHex(light ? mix(bg, WHITE, 0.7) : mix(bg, WHITE, 0.07)),
    '--field-bg': toHex(light ? mix(bg, WHITE, 0.85) : mix(bg, BLACK, 0.3)),
  };
  if (accent && contrast(accent, bg) < ACCENT_CONTRAST) {
    tokens['--accent'] = toHex(text);
    tokens['--accent-text'] = toHex(bg);
  }
  return { scheme: light ? 'light' : 'dark', tokens };
}

// The stored colors, only the valid ones.
export function parsePanelColors(value) {
  const colors = {};
  if (!value || typeof value !== 'object') return colors;
  for (const theme of THEMES) {
    const rgb = parseHex(value[theme]);
    if (rgb) colors[theme] = toHex(rgb);
  }
  return colors;
}

// The color for this theme or null (the colors of tokens.css).
export const colorFor = (colors, theme) => parsePanelColors(colors)[theme] ?? null;

// The colors with this theme's color set; `hex` null — reset (the other theme's stays).
export function withColor(colors, theme, hex) {
  const next = parsePanelColors(colors);
  const rgb = parseHex(hex);
  if (rgb) next[theme] = toHex(rgb);
  else delete next[theme];
  return next;
}

// The picked color is the panel's own — the pipette clicked a second time, or the panel
// itself: its background, the button under the pointer, the icon or a pixel of its edge
// between them. Then nothing changes. `own` — [background, button, icon] as [r, g, b].
export function isOwnColor(hex, [background, button, icon]) {
  const rgb = parseHex(hex);
  if (!rgb) return false;
  const near = (a, b) => a.every((c, i) => Math.abs(c - b[i]) <= 2);
  if (near(rgb, background) || near(rgb, button) || near(rgb, icon)) return true;
  // On the line between the button and the icon (the icon's smoothed edge).
  const span = icon.map((c, i) => c - button[i]);
  const length = span.reduce((sum, c) => sum + c * c, 0);
  if (!length) return false;
  const t = span.reduce((sum, c, i) => sum + c * (rgb[i] - button[i]), 0) / length;
  return t > 0 && t < 1 && near(rgb, mix(button, icon, t));
}
