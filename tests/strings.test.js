import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STRINGS, pickLanguage, strings, FAVORITES_TITLES, PUBLIC_NAME } from '../extension/lib/strings.js';

const en = STRINGS.en('Tabbs');
const ru = STRINGS.ru('Tabbs');

test('pickLanguage: Russian for a Russian browser, English otherwise', () => {
  for (const ui of ['ru', 'ru-RU', 'ru_RU', 'RU']) assert.equal(pickLanguage(ui), 'ru', ui);
  for (const ui of ['en', 'en-US', 'en-GB', 'uk', 'be', 'de', 'rue', '', undefined, null]) assert.equal(pickLanguage(ui), 'en', String(ui));
  assert.equal(strings('ru-RU', 'Tabbs').menu.rename, ru.menu.rename);
  assert.equal(strings('ja', 'Tabbs').menu.rename, en.menu.rename);
});

// Key → 'string' | 'function' | { nested shape }, to compare the two dictionaries.
const shape = (value) => (typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, shape(inner)]).sort())
  : typeof value);

test('English and Russian have the same texts', () => {
  assert.deepEqual(shape(ru), shape(en));
});

// Every text of a dictionary: strings as they are, functions called with sample arguments.
function allTexts(dictionary) {
  const texts = [];
  const samples = [[{ links: 2, folders: 1, failed: 1 }], ['Work', 'Prev'], [['A', 'B'], 3], [2]];
  const walk = (value) => {
    if (typeof value === 'string') texts.push(value);
    else if (typeof value === 'object') Object.values(value).forEach(walk);
    else if (typeof value === 'function') {
      for (const args of samples) {
        try { texts.push(String(value(...args))); } catch { /* not this function's arguments */ }
      }
    }
  };
  walk(dictionary);
  return texts;
}

test('no text is empty', () => {
  const check = (value, path) => {
    if (typeof value === 'string') assert.ok(value.trim(), path);
    else if (typeof value === 'object') for (const [key, inner] of Object.entries(value)) check(inner, `${path}.${key}`);
  };
  check(en, 'en');
  check(ru, 'ru');
});

test('the extension\'s name comes from outside, no other name is written in the texts', () => {
  for (const language of ['en', 'ru']) {
    const texts = allTexts(STRINGS[language]('Tabbs')).join('\n');
    assert.doesNotMatch(texts, /Табу|Tabu\b/i, language); // the author's names: scripts/public.mjs
    const mine = allTexts(STRINGS[language]('Shelf')).join('\n');
    assert.doesNotMatch(mine, /Tabbs|Табу|Tabu\b/, language);
  }
});

test('the name is put into the texts as given, without quotes', () => {
  assert.equal(strings('en', 'Tabbs').appName, 'Tabbs');
  assert.equal(strings('en', 'Tabbs').welcome.title, 'Welcome to Tabbs');
  assert.equal(strings('ru', 'Tabbs').welcome.title, 'Добро пожаловать в Tabbs');
  assert.equal(strings('ru', 'Shelf').welcome.title, 'Добро пожаловать в Shelf');
  assert.equal(strings('ru', 'Tabbs').arcSort.title, 'Разложить по Tabbs');
  assert.equal(strings('en', 'Shelf').arcImport.adds, 'Links are added to Shelf, nothing is deleted.');
  assert.match(strings('ru', 'Tabbs').welcome.spacesPermission, /разрешить Tabbs управлять/);
  assert.match(strings('ru', 'Tabbs').welcome.intro, / Tabbs добавляет/);
  assert.match(strings('ru', 'Tabbs').welcome.stepShortcut('⌘⇧S'), /^Tabbs теперь открывается клавишами \*\*⌘⇧S\*\*/);
  assert.equal(strings('en', 'Tabbs').rootMissing, 'Can’t find the “Tabbs” folder');
  assert.equal(strings('ru', 'Shelf').rootMissing, 'Папка „Shelf“ не найдена');
  assert.equal(PUBLIC_NAME, 'Tabbs');
});

test('no "read as" line on the welcome page', () => {
  assert.equal(en.welcome.subtitle, undefined);
  assert.equal(ru.welcome.subtitle, undefined);
});

test('texts with a name or a number', () => {
  assert.equal(en.confirmDeleteFolder('Work'), 'Delete folder “Work”?');
  assert.equal(ru.confirmDeleteFolder('Работа'), 'Удалить папку „Работа“?');
  assert.equal(en.folderLabel('Work'), 'Folder “Work”');
});

test('Favorites in every language', () => {
  assert.deepEqual(FAVORITES_TITLES, ['Favorites', 'Избранное']);
  assert.equal(en.favoritesFolder, 'Favorites');
  assert.equal(ru.favoritesFolder, 'Избранное');
});
