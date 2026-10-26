#!/usr/bin/env node
// Arc's sidebar → a bookmarks HTML file to import into Helium (stage 4b). No dependencies.
//
//   node scripts/arc-to-bookmarks.mjs                       list Arc's spaces
//   node scripts/arc-to-bookmarks.mjs Work Watch Japanese   the first space at the top level,
//                                                           the others as folders → arc-bookmarks.html
//   --from <file>   a copy of StorableSidebar.json instead of Arc's own file
//
// Arc's favorites always go to the "Избранное" folder (tiles), the root folder in the file is
// named like the extension in extension/manifest.json. The output file holds personal links, so it is in .gitignore. Messages are in
// Russian: the script is Ed's tool (the panel imports Arc's sidebar itself since stage 7b).

import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArcSidebar, findSpace, arcRootTree, countNodes, bookmarksHtml } from '../extension/lib/arc.js';
import { FAVORITES_FOLDERS } from '../extension/lib/strings.js';

const ARC_FILE = join(homedir(), 'Library', 'Application Support', 'Arc', 'StorableSidebar.json');
const OUT_FILE = fileURLToPath(new URL('../arc-bookmarks.html', import.meta.url));
const MANIFEST = fileURLToPath(new URL('../extension/manifest.json', import.meta.url));
const ROOT_TITLE = JSON.parse(readFileSync(MANIFEST, 'utf8')).name;

function fail(message) {
  console.error(message);
  process.exit(1);
}

const args = process.argv.slice(2);
let from = ARC_FILE;
const names = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--from') {
    from = args[++i];
    if (!from) fail('После --from нужен путь к файлу StorableSidebar.json.');
  } else {
    names.push(args[i]);
  }
}

let parsed;
try {
  parsed = parseArcSidebar(JSON.parse(readFileSync(from, 'utf8')));
} catch (error) {
  fail(`Не получилось прочитать файл Арка ${from}\n${error.message}`);
}

const describe = ({ links, folders }) => `ссылок: ${links}, папок: ${folders}`;

if (!names.length) {
  console.log(`Файл: ${from}\n`);
  console.log(`Избранное — ${describe(countNodes(parsed.favorites))}`);
  for (const space of parsed.spaces) console.log(`${space.title} — ${describe(countNodes(space.items))}`);
  console.log('\nЗапуск: node scripts/arc-to-bookmarks.mjs <пространство в корень> [пространства папками…]');
  console.log(`Например: node scripts/arc-to-bookmarks.mjs ${parsed.spaces.map((s) => s.title).join(' ')}`);
  process.exit(0);
}

const missing = names.filter((name) => !findSpace(parsed, name));
if (missing.length) {
  fail(`В Арке нет пространства: ${missing.join(', ')}.\nЕсть: ${parsed.spaces.map((s) => s.title).join(', ')}`);
}

const [rootSpace, ...folderSpaces] = names;
const tree = arcRootTree(parsed, { rootSpace, folderSpaces, favoritesTitle: FAVORITES_FOLDERS.ru });
writeFileSync(OUT_FILE, bookmarksHtml(tree, ROOT_TITLE));

const print = (nodes, depth) => {
  for (const node of nodes) {
    console.log(`${'  '.repeat(depth)}${node.children ? `📁 ${node.title}` : node.title}`);
    if (node.children) print(node.children, depth + 1);
  }
};
console.log(ROOT_TITLE);
print(tree, 1);
console.log(`\nВсего — ${describe(countNodes(tree))}.`);
if (parsed.skipped) console.log(`Пропущено элементов, которые не ссылки и не папки: ${parsed.skipped}.`);
console.log(`Готово: ${OUT_FILE}`);
