#!/usr/bin/env node
// Packs the public version into dist/tabbs-<version>.zip for the Chrome Web Store (stage 7):
// in the author's repository it builds build/public/ first (scripts/public.mjs) and zips that;
// in the public one, where extension/ is Tabbs already, it zips extension/. No dependencies:
// the ZIP is written by hand with Node's zlib.
//
//   npm run pack        (or: node scripts/pack.mjs)
//
// Files are at the top of the archive (manifest.json at its root), hidden files such as
// .DS_Store are left out. Names starting with "_" other than _locales stop the packing:
// Chromium refuses to load an extension with them.

import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync, crc32 } from 'node:zlib';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC_SCRIPT = new URL('./public.mjs', import.meta.url);

async function source() {
  if (existsSync(PUBLIC_SCRIPT)) return (await import(PUBLIC_SCRIPT)).buildPublic();
  const dir = join(ROOT, 'extension');
  return { dir, version: JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')).version };
}

const { dir: SOURCE, version } = await source();
const DIST = join(ROOT, 'dist');

function listFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.name.startsWith('_') && relative(SOURCE, path) !== '_locales') {
      throw new Error(`Chromium won't load a name starting with "_": ${relative(ROOT, path)}`);
    }
    if (entry.isDirectory()) files.push(...listFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

// Modification time in the MS-DOS format ZIP uses (local time, 2-second steps).
function dosTime(date) {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

const UTF8_NAMES = 0x0800;
const STORE = 0;
const DEFLATE = 8;

function zip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const { name, data, modified } of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const deflated = deflateRawSync(data, { level: 9 });
    const method = deflated.length < data.length ? DEFLATE : STORE;
    const body = method === DEFLATE ? deflated : data;
    const crc = crc32(data);
    const { time, date } = dosTime(modified);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed: 2.0
    local.writeUInt16LE(UTF8_NAMES, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28); // no extra field
    parts.push(local, nameBytes, body);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4); // made by: 2.0
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(UTF8_NAMES, 8);
    header.writeUInt16LE(method, 10);
    header.writeUInt16LE(time, 12);
    header.writeUInt16LE(date, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(body.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(nameBytes.length, 28);
    // extra, comment, disk, internal and external attributes — all zero
    header.writeUInt32LE(offset, 42);
    central.push(header, nameBytes);

    offset += local.length + nameBytes.length + body.length;
  }

  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...central, end]);
}

const entries = listFiles(SOURCE)
  .map((path) => ({
    name: relative(SOURCE, path).split(sep).join('/'),
    data: readFileSync(path),
    modified: statSync(path).mtime,
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

const archive = zip(entries);
mkdirSync(DIST, { recursive: true });
const out = join(DIST, `tabbs-${version}.zip`);
writeFileSync(out, archive);
console.log(`${relative(ROOT, out)} — ${entries.length} files, ${(archive.length / 1024).toFixed(1)} KB`);
