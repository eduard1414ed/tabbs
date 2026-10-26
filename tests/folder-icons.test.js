import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FOLDER_EMOJI,
  withFolderEmoji,
  pickEmoji,
  PICTOGRAM_NAMES,
  pictogramSections,
  pictogramKey,
  isPictogram,
  parsePictograms,
  folderIconOf,
  stalePictograms,
} from '../extension/lib/folder-icons.js';
import { PICTOGRAMS, PICTOGRAM_THEMES } from '../extension/lib/pictograms.js';
import { STRINGS } from '../extension/lib/strings.js';
import { splitLeadingEmoji } from '../extension/lib/tree.js';

test('the picker offers 36 different emoji, each one shown as a folder icon', () => {
  assert.equal(FOLDER_EMOJI.length, 36);
  assert.equal(new Set(FOLDER_EMOJI).size, FOLDER_EMOJI.length);
  for (const emoji of FOLDER_EMOJI) {
    assert.deepEqual(splitLeadingEmoji(`${emoji} Папка`), { emoji, title: 'Папка' }, emoji);
  }
});

test('withFolderEmoji puts an icon in front or replaces the current one', () => {
  assert.equal(withFolderEmoji('Подкаст', '❤️'), '❤️ Подкаст');
  assert.equal(withFolderEmoji('🔥 Подкаст', '❤️'), '❤️ Подкаст');
  assert.equal(withFolderEmoji('🔥Подкаст', '🇯🇵'), '🇯🇵 Подкаст');
  assert.equal(withFolderEmoji('  Подкаст  ', '⭐'), '⭐ Подкаст');
});

test('withFolderEmoji removes the icon', () => {
  assert.equal(withFolderEmoji('❤️ Подкаст', null), 'Подкаст');
  assert.equal(withFolderEmoji('Подкаст', null), 'Подкаст');
});

test('withFolderEmoji on a folder named by its icon only', () => {
  assert.equal(withFolderEmoji('🔥', '❤️'), '❤️');
  assert.equal(withFolderEmoji('', '❤️'), '❤️');
  assert.equal(withFolderEmoji('🔥', null), '');
});

test('withFolderEmoji keeps a text-style symbol that is part of the name', () => {
  assert.equal(withFolderEmoji('© Права', '📁'), '📁 © Права');
});

test('pickEmoji takes the first emoji of what was pasted', () => {
  assert.equal(pickEmoji('🎌'), '🎌');
  assert.equal(pickEmoji(' ❤️ '), '❤️');
  assert.equal(pickEmoji('🇯🇵'), '🇯🇵');
  assert.equal(pickEmoji('👨‍💻'), '👨‍💻');
  assert.equal(pickEmoji('🔥🎌'), '🔥');
  assert.equal(pickEmoji('Подкаст 💜'), '💜');
});

test('pickEmoji: no emoji — null', () => {
  for (const text of ['', '   ', 'Б', 'abc', '1', '©', undefined]) {
    assert.equal(pickEmoji(text), null, String(text));
  }
});

test('the picker offers about 220 different pictograms, each with an outline and a filled path', () => {
  assert.ok(PICTOGRAM_NAMES.length >= 200 && PICTOGRAM_NAMES.length <= 240, String(PICTOGRAM_NAMES.length));
  assert.equal(new Set(PICTOGRAM_NAMES).size, PICTOGRAM_NAMES.length);
  for (const name of PICTOGRAM_NAMES) {
    assert.match(name, /^[a-z0-9-]+$/, name);
    const [outline, fill] = PICTOGRAMS[name];
    for (const d of [outline, fill]) assert.match(d, /^M[\d.,\-\sA-Za-z]+$/, name);
    assert.notEqual(outline, fill, name);
  }
});

test('isPictogram: only names from the set', () => {
  assert.ok(isPictogram('heart'));
  assert.ok(!isPictogram('no-such-icon'));
  assert.ok(!isPictogram('toString'));
  assert.ok(!isPictogram(undefined));
});

test('parsePictograms keeps known pictograms of the pictogram keys only', () => {
  const items = {
    [pictogramKey('f1')]: 'heart',
    [pictogramKey('f2')]: 'no-such-icon',
    [pictogramKey('f3')]: 42,
    expandedFolders: ['f1'],
    'tab:f4': 'heart',
  };
  assert.deepEqual([...parsePictograms(items)], [['f1', 'heart']]);
  assert.deepEqual([...parsePictograms(undefined)], []);
});

test('folderIconOf: the pictogram wins over the emoji, else the emoji, else the plain folder', () => {
  const pictograms = new Map([['f1', 'heart']]);
  assert.deepEqual(folderIconOf({ id: 'f1', emoji: '🔥' }, pictograms), { pictogram: 'heart' });
  assert.deepEqual(folderIconOf({ id: 'f1', emoji: null }, pictograms), { pictogram: 'heart' });
  assert.deepEqual(folderIconOf({ id: 'f2', emoji: '🔥' }, pictograms), { emoji: '🔥' });
  assert.equal(folderIconOf({ id: 'f2', emoji: null }, pictograms), null);
  assert.equal(folderIconOf({ id: 'f2', emoji: null }), null);
});

test('stalePictograms: the records of folders that are gone', () => {
  const pictograms = new Map([['f1', 'heart'], ['f2', 'star'], ['space', 'house']]);
  assert.deepEqual(stalePictograms(pictograms, new Set(['f1', 'space'])), ['f2']);
  assert.deepEqual(stalePictograms(pictograms, new Set(['f1', 'f2', 'space'])), []);
});

test('the first pictograms (stage 8g) are all still there: folders keep them by name', () => {
  const first = 'briefcase kanban target code robot popcorn brain house paw-print baby heart airplane suitcase wallet chart-pie '
    + 'paper-plane-tilt newspaper star archive gear person-simple-run shield-check smiley cat globe-hemisphere-west bookmark-simple';
  for (const name of first.split(' ')) assert.ok(isPictogram(name), name);
});

test('pictogramSections: every pictogram once, by theme, with the theme\'s name in both languages', () => {
  const sections = pictogramSections(STRINGS.ru('Tabbs').pictogramThemes);
  assert.deepEqual(sections.flatMap((section) => section.names), PICTOGRAM_NAMES);
  assert.equal(sections[0].title, 'Работа');
  for (const language of ['en', 'ru']) {
    const titles = STRINGS[language]('Tabbs').pictogramThemes;
    assert.deepEqual(Object.keys(titles), PICTOGRAM_THEMES.map(([theme]) => theme), language);
  }
});
