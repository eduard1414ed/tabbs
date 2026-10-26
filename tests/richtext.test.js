import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRichText } from '../extension/lib/richtext.js';
import { STRINGS } from '../extension/lib/strings.js';

test('parseRichText: plain text stays one piece', () => {
  assert.deepEqual(parseRichText('Done. Nice work!'), [{ type: 'text', text: 'Done. Nice work!' }]);
  assert.deepEqual(parseRichText(''), []);
});

test('parseRichText: bold and links among text', () => {
  assert.deepEqual(parseRichText('Open the [Appearance](appearance) settings, set **Layout** to **Vertical**.'), [
    { type: 'text', text: 'Open the ' },
    { type: 'link', text: 'Appearance', action: 'appearance' },
    { type: 'text', text: ' settings, set ' },
    { type: 'strong', text: 'Layout' },
    { type: 'text', text: ' to ' },
    { type: 'strong', text: 'Vertical' },
    { type: 'text', text: '.' },
  ]);
});

test('parseRichText: Russian quotes and arrows inside bold', () => {
  assert.deepEqual(parseRichText('**«Панель инструментов»** → **«Расширения»**'), [
    { type: 'strong', text: '«Панель инструментов»' },
    { type: 'text', text: ' → ' },
    { type: 'strong', text: '«Расширения»' },
  ]);
});

test('parseRichText: unfinished markup is left as text', () => {
  assert.deepEqual(parseRichText('a ** b [c] (d)'), [{ type: 'text', text: 'a ** b [c] (d)' }]);
});

test('welcome texts: every link has an action the page knows, in both languages', () => {
  const known = new Set(['appearance', 'shortcuts', 'toolbar']);
  const texts = (welcome) => Object.values(welcome).flatMap((value) => {
    if (typeof value === 'function') return [value('⇧⌘S')];
    if (typeof value === 'object') return Object.values(value);
    return [value];
  });
  for (const [language, dictionary] of Object.entries(STRINGS)) {
    for (const text of texts(dictionary('Tabbs').welcome)) {
      for (const part of parseRichText(text)) {
        if (part.type === 'link') assert.ok(known.has(part.action), `${language}: ${part.action}`);
      }
      assert.ok(!/\*\*|\]\(/.test(parseRichText(text).map((part) => part.text).join('')), `${language}: ${text}`);
    }
  }
});
