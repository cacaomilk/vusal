'use strict';

// Recreate the assets/ directory from assets.zip during Render's build step.
// No npm packages and no shell `unzip` binary are required: this reads the ZIP
// central directory with Node's built-in fs/zlib modules.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ZIP = path.resolve(__dirname, 'assets.zip');
const ROOT = __dirname;
const buf = fs.readFileSync(ZIP);

function sig(offset) {
  return buf.readUInt32LE(offset);
}

function findEocd() {
  const needle = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const i = buf.lastIndexOf(needle);
  if (i < 0 || i + 22 > buf.length) throw new Error('assets.zip has no end-of-central-directory record');
  return i;
}

const eocd = findEocd();
const total = buf.readUInt16LE(eocd + 10);
let p = buf.readUInt32LE(eocd + 16);
let written = 0;

for (let n = 0; n < total; n += 1) {
  if (p + 46 > buf.length || sig(p) !== 0x02014b50) throw new Error('Invalid central directory in assets.zip');

  const method = buf.readUInt16LE(p + 10);
  const compSize = buf.readUInt32LE(p + 20);
  const uncompSize = buf.readUInt32LE(p + 24);
  const nameLen = buf.readUInt16LE(p + 28);
  const extraLen = buf.readUInt16LE(p + 30);
  const commentLen = buf.readUInt16LE(p + 32);
  const localOffset = buf.readUInt32LE(p + 42);
  const name = buf.toString('utf8', p + 46, p + 46 + nameLen);

  p += 46 + nameLen + extraLen + commentLen;
  if (!name || name.endsWith('/')) continue;
  if (!name.startsWith('assets/') || name.includes('..') || name.includes('\\')) {
    throw new Error('Unsafe path in assets.zip: ' + name);
  }

  if (localOffset + 30 > buf.length || sig(localOffset) !== 0x04034b50) {
    throw new Error('Invalid local header for ' + name);
  }
  const localNameLen = buf.readUInt16LE(localOffset + 26);
  const localExtraLen = buf.readUInt16LE(localOffset + 28);
  const dataStart = localOffset + 30 + localNameLen + localExtraLen;
  const compressed = buf.slice(dataStart, dataStart + compSize);

  let data;
  if (method === 0) data = compressed;
  else if (method === 8) data = zlib.inflateRawSync(compressed);
  else throw new Error('Unsupported ZIP compression method ' + method + ' for ' + name);
  if (data.length !== uncompSize) throw new Error('Size mismatch for ' + name);

  const dest = path.resolve(ROOT, name);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, data);
  written += 1;
}

if (written !== 113) throw new Error('Expected to unpack 113 asset files, got ' + written);
const probe = fs.readFileSync(path.resolve(ROOT, 'assets/cards/bc1.png'));
if (probe.slice(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('bc1.png is not a PNG after unpacking');
console.log('Unpacked ' + written + ' VUSAL asset files from assets.zip');
