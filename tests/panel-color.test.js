import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseHex, toHex, parseRgb, contrast, over, isLightColor, panelPalette,
  parsePanelColors, colorFor, withColor, isOwnColor, TEXT_CONTRAST, MUTED_CONTRAST,
} from '../extension/lib/panel-color.js';

const LIGHT_ACCENT = parseHex('#3b82f6');
const DARK_ACCENT = parseHex('#60a5fa');

// Helium's header in some of its color themes, light and dark, and colors to break it with.
const COLORS = {
  'Helium light': '#f9f9ff',
  'Helium dark': '#1e2020',
  'pale blue': '#dfe7f7',
  'pale green': '#dcebd9',
  'pale pink': '#f6dfe8',
  'dark blue': '#1c2433',
  'dark green': '#1d2a21',
  'dark violet': '#2a1f33',
  white: '#ffffff',
  black: '#000000',
  'mid grey': '#777777',
  'bright red': '#ff0000',
  'bright yellow': '#ffff00',
  'bright blue': '#0000ff',
  'mid blue': '#3b82f6',
  'mid green': '#4caf50',
};

// The overlay of a token ('rgba(0, 0, 0, 0.05)') laid over the background.
function laid(token, bg) {
  const { rgb, alpha } = parseRgb(token);
  return over(rgb, alpha, bg);
}

test('parseHex / toHex: #rrggbb and #rgb, anything else null', () => {
  assert.deepEqual(parseHex('#1e2020'), [30, 32, 32]);
  assert.deepEqual(parseHex('#FFF'), [255, 255, 255]);
  assert.equal(toHex([30, 32, 32]), '#1e2020');
  for (const bad of ['', '1e2020x', '#12345', 'red', null, undefined, 42]) assert.equal(parseHex(bad), null);
});

test('parseRgb: what getComputedStyle gives', () => {
  assert.deepEqual(parseRgb('rgb(249, 249, 255)'), { rgb: [249, 249, 255], alpha: 1 });
  assert.deepEqual(parseRgb('rgba(0, 0, 0, 0.05)'), { rgb: [0, 0, 0], alpha: 0.05 });
  assert.equal(parseRgb('transparent'), null);
});

test('contrast: black on white 21 : 1, a color on itself 1 : 1', () => {
  assert.equal(Math.round(contrast([0, 0, 0], [255, 255, 255])), 21);
  assert.equal(contrast([30, 32, 32], [30, 32, 32]), 1);
});

test('panelPalette: the text and the muted text are readable on any color', () => {
  for (const [name, hex] of Object.entries(COLORS)) {
    const { tokens } = panelPalette(hex, LIGHT_ACCENT);
    const bg = parseHex(hex);
    assert.equal(tokens['--bg'], hex, name);
    const text = parseHex(tokens['--text']);
    const muted = parseHex(tokens['--text-muted']);
    assert.ok(contrast(text, bg) >= TEXT_CONTRAST, `${name}: text ${contrast(text, bg).toFixed(2)}`);
    assert.ok(contrast(muted, bg) >= MUTED_CONTRAST, `${name}: muted ${contrast(muted, bg).toFixed(2)}`);
    // Still readable on the hover and on the selected row.
    assert.ok(contrast(text, laid(tokens['--active'], bg)) >= TEXT_CONTRAST - 0.5, `${name}: text on the selected row`);
    assert.ok(contrast(muted, laid(tokens['--active'], bg)) >= MUTED_CONTRAST - 0.5, `${name}: muted on the selected row`);
    // On menus and fields too.
    assert.ok(contrast(text, parseHex(tokens['--surface'])) >= TEXT_CONTRAST, `${name}: text on a menu`);
    assert.ok(contrast(text, parseHex(tokens['--field-bg'])) >= TEXT_CONTRAST, `${name}: text in a field`);
  }
});

test('panelPalette: the selected row and the current space stand out from the background', () => {
  for (const [name, hex] of Object.entries(COLORS)) {
    const { tokens } = panelPalette(hex, LIGHT_ACCENT);
    const bg = parseHex(hex);
    assert.ok(contrast(laid(tokens['--active'], bg), bg) >= 1.2, name);
    assert.ok(contrast(laid(tokens['--active'], bg), bg) > contrast(laid(tokens['--hover'], bg), bg), `${name}: brighter than hover`);
  }
});

test('panelPalette: dark text on light colors, light text on dark ones', () => {
  assert.equal(panelPalette('#dfe7f7', LIGHT_ACCENT).scheme, 'light');
  assert.equal(panelPalette('#ffff00', LIGHT_ACCENT).scheme, 'light');
  assert.equal(panelPalette('#1c2433', DARK_ACCENT).scheme, 'dark');
  assert.equal(panelPalette('#0000ff', DARK_ACCENT).scheme, 'dark');
  assert.ok(isLightColor(parseHex('#dfe7f7')));
  assert.ok(!isLightColor(parseHex('#1c2433')));
  // A light color picked in the dark theme still gets dark text: readable, not refused.
  const { scheme, tokens } = panelPalette('#f6dfe8', DARK_ACCENT);
  assert.equal(scheme, 'light');
  assert.ok(contrast(parseHex(tokens['--text']), parseHex('#f6dfe8')) >= TEXT_CONTRAST);
});

test('panelPalette: the text keeps a shade of the color', () => {
  const { tokens } = panelPalette('#1c2433', DARK_ACCENT);
  const [r, , b] = parseHex(tokens['--text']);
  assert.ok(b > r, 'bluish text on a dark blue panel');
});

test('panelPalette: the accent stays where it is visible, else the text color takes its place', () => {
  assert.equal(panelPalette('#f9f9ff', LIGHT_ACCENT).tokens['--accent'], undefined);
  assert.equal(panelPalette('#1c2433', DARK_ACCENT).tokens['--accent'], undefined);
  const blue = panelPalette('#3b82f6', LIGHT_ACCENT).tokens;
  assert.equal(blue['--accent'], blue['--text']);
  assert.equal(blue['--accent-text'], '#3b82f6');
  assert.ok(contrast(parseHex(blue['--accent']), parseHex('#3b82f6')) >= 3);
});

test('panelPalette: a wrong color — null', () => {
  assert.equal(panelPalette('nope', LIGHT_ACCENT), null);
});

test('colors by theme: each theme has its own, resetting one keeps the other', () => {
  let colors = parsePanelColors(undefined);
  assert.deepEqual(colors, {});
  assert.equal(colorFor(colors, 'light'), null);
  colors = withColor(colors, 'light', '#DFE7F7');
  colors = withColor(colors, 'dark', '#1c2433');
  assert.deepEqual(colors, { light: '#dfe7f7', dark: '#1c2433' });
  assert.equal(colorFor(colors, 'light'), '#dfe7f7');
  assert.equal(colorFor(colors, 'dark'), '#1c2433');
  colors = withColor(colors, 'dark', null);
  assert.deepEqual(colors, { light: '#dfe7f7' });
  assert.equal(colorFor(colors, 'dark'), null);
});

test('parsePanelColors: junk in storage is dropped', () => {
  assert.deepEqual(parsePanelColors({ light: 'blue', dark: '#1C2433', other: '#ffffff' }), { dark: '#1c2433' });
  assert.deepEqual(parsePanelColors('#ffffff'), {});
});

test('isOwnColor: the panel, the pipette and its edge — not a new color', () => {
  const background = parseHex('#f9f9ff');
  const button = parseHex('#ececf2');
  const icon = parseHex('#6e6e73');
  const own = [background, button, icon];
  assert.ok(isOwnColor('#f9f9ff', own));
  assert.ok(isOwnColor('#ededf2', own)); // the button under the pointer, off by a little
  assert.ok(isOwnColor('#6e6e73', own));
  assert.ok(isOwnColor(toHex([173, 173, 178]), own)); // half way along the icon's edge
  assert.ok(!isOwnColor('#dfe7f7', own)); // Helium's header in a blue theme
  assert.ok(!isOwnColor('#e0e0e0', own)); // a grey header
  assert.ok(!isOwnColor('bad', own));
});
