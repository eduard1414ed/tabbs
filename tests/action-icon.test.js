import { test } from 'node:test';
import assert from 'node:assert/strict';
import { themeOf, isTheme, actionIconPaths, logoPath, faviconPath } from '../extension/lib/action-icon.js';

test('themeOf: prefers-color-scheme to a theme', () => {
  assert.equal(themeOf(true), 'dark');
  assert.equal(themeOf(false), 'light');
});

test('isTheme: only light and dark', () => {
  assert.ok(isTheme('light'));
  assert.ok(isTheme('dark'));
  assert.ok(!isTheme(undefined));
  assert.ok(!isTheme('auto'));
});

test('actionIconPaths: dark mark on light, light mark on dark, light for unknown', () => {
  assert.deepEqual(actionIconPaths('light'), { 16: '/icons/tabbs-16.png', 32: '/icons/tabbs-32.png' });
  assert.deepEqual(actionIconPaths('dark'), { 16: '/icons/tabbs-light-16.png', 32: '/icons/tabbs-light-32.png' });
  assert.deepEqual(actionIconPaths(undefined), actionIconPaths('light'));
});

test('welcome page: the plain mark as the logo, the manifest\'s icon on its tab', () => {
  const outlined = { 16: 'icons/tabbs-outline-16.png', 32: 'icons/tabbs-outline-32.png', 128: 'icons/tabbs-outline-128.png' };
  assert.equal(logoPath(outlined), '/icons/tabbs-128.png');
  assert.equal(faviconPath(outlined), '/icons/tabbs-outline-32.png');
  const own = { 32: 'icons/shin-32.png', 128: 'icons/shin-128.png' };
  assert.equal(logoPath(own), '/icons/shin-128.png');
  assert.equal(faviconPath(own), '/icons/shin-32.png');
});
