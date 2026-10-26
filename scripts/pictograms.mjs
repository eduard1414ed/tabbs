#!/usr/bin/env node
// Builds extension/lib/pictograms.js — the pictograms for folders and spaces (stage 8g) — from
// Phosphor Icons (MIT, THIRD_PARTY_NOTICES.md). No dependencies: Phosphor isn't a dependency of
// the project; this only reads its SVG files from an unpacked copy of @phosphor-icons/core.
//
//   npm pack @phosphor-icons/core && tar -xzf phosphor-icons-core-*.tgz
//   node scripts/pictograms.mjs package/assets
//
// The choice and its order (by theme) are below. Every icon is one <path> in both weights.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The choice by theme, in the picker's order (the themes' names are in lib/strings.js,
// pictogramThemes). Names only ever get added: folders keep a pictogram by its name.
const CHOICE = {
  work: 'briefcase building-office buildings kanban presentation-chart chart-line-up chart-bar calendar-blank calendar-check clipboard-text envelope-simple phone handshake target folder-simple files file-text tray archive printer note-pencil list-checks check-square clock alarm hourglass stamp seal-check identification-card',
  code: 'code terminal-window git-branch github-logo bug database cloud cpu robot desktop laptop device-mobile keyboard mouse wifi-high hard-drive plug battery-full gear circuitry brackets-curly function sliders',
  media: 'television-simple film-slate film-strip play-circle youtube-logo music-notes headphones microphone vinyl-record radio camera video-camera image images game-controller popcorn ticket mask-happy guitar piano-keys speaker-high',
  study: 'book-open books book-bookmark graduation-cap student chalkboard-teacher translate pencil-simple notebook brain lightbulb flask atom dna globe-hemisphere-west math-operations exam ruler',
  home: 'house couch bed bathtub cooking-pot coffee wine beer-bottle hamburger pizza carrot cookie ice-cream cake fork-knife shopping-cart basket plant flower tree potted-plant lamp key door baby heart',
  travel: 'airplane airplane-tilt map-trifold map-pin compass mountains tent car bus train taxi bicycle motorcycle boat suitcase globe island campfire umbrella',
  sport: 'barbell person-simple-run person-simple-walk sneaker-move soccer-ball basketball tennis-ball football volleyball baseball swimming-pool heartbeat first-aid pill bandaids tooth',
  money: 'wallet coins credit-card piggy-bank bank receipt chart-pie currency-dollar currency-eur currency-rub storefront tag shopping-bag percent calculator',
  people: 'chat-circle chats-circle users-three user at paper-plane-tilt megaphone newspaper telegram-logo instagram-logo x-logo discord-logo share-network phone-call address-book',
  nature: 'sun moon cloud-sun cloud-rain snowflake rainbow leaf drop fire lightning wave-sine flower-lotus butterfly cat dog paw-print bird fish horse',
  other: 'star sparkle flag bookmark-simple gift puzzle-piece palette paint-brush scissors wrench hammer lock shield-check rocket trophy crown diamond smiley ghost skull anchor infinity hash question',
};

const assets = process.argv[2];
if (!assets) {
  console.error('Usage: node scripts/pictograms.mjs <path to @phosphor-icons/core/assets>');
  process.exit(1);
}
const { version } = JSON.parse(readFileSync(join(assets, '..', 'package.json'), 'utf8'));
// MIT asks for its notice in every copy: the store archive gets it inside this file.
const license = readFileSync(join(assets, '..', 'LICENSE'), 'utf8').trim().split('\n').map((line) => `// ${line}`.trimEnd()).join('\n');

function pathOf(file) {
  const svg = readFileSync(file, 'utf8').trim();
  const match = /^<svg [^>]*viewBox="0 0 256 256"[^>]*><path d="([^"]+)"\/><\/svg>$/.exec(svg);
  if (!match) throw new Error(`Not a single-path 256×256 icon: ${file}`);
  return match[1];
}

const themes = Object.entries(CHOICE).map(([theme, names]) => [theme, names.split(' ')]);
const all = themes.flatMap(([, names]) => names);
const twice = all.filter((name, index) => all.indexOf(name) !== index);
if (twice.length) throw new Error(`In two themes: ${twice.join(', ')}`);
const lines = all.map((name) => {
  const line = pathOf(join(assets, 'regular', `${name}.svg`));
  const fill = pathOf(join(assets, 'fill', `${name}-fill.svg`));
  return `  '${name}': ['${line}', '${fill}'],`;
});

const out = fileURLToPath(new URL('../extension/lib/pictograms.js', import.meta.url));
writeFileSync(out, `// Pictograms for folders and spaces (stage 8g): Phosphor Icons ${version}, MIT (THIRD_PARTY_NOTICES.md).
// Made by scripts/pictograms.mjs — change the choice there, not here.
// Name → [outline, filled]: the d of one path, viewBox 0 0 256 256, drawn in currentColor.
// In the picker's order, by theme.
//
${license}

export const PICTOGRAMS = {
${lines.join('\n')}
};

// Theme → names, in the picker's order.
export const PICTOGRAM_THEMES = [
${themes.map(([theme, names]) => `  ['${theme}', [${names.map((name) => `'${name}'`).join(', ')}]],`).join('\n')}
];
`);
console.log(`extension/lib/pictograms.js — ${lines.length} icons, Phosphor ${version}`);
