import { NodeIO } from '@gltf-transform/core';
import fs from 'node:fs';
import path from 'node:path';
const io = new NodeIO();
const RX = /(barcode|swingtag|hangtag|pricetag|shelftag|sizetag|pricerail|pricecard|qrcode|qr_code)/i;
const files = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
  const p = path.join(d, e.name);
  if (e.isDirectory()) walk(p); else if (e.name.endsWith('.glb')) files.push(p);
} };
walk('vendor/models');
let hits = 0; let scanned = 0;
const out = [];
for (const f of files) {
  scanned += 1;
  let doc; try { doc = await io.read(f); } catch { continue; }
  const names = [];
  for (const n of doc.getRoot().listNodes()) {
    const nm = n.getName() || '';
    if (RX.test(nm) && n.getMesh()) names.push(nm);
  }
  for (const m of doc.getRoot().listMaterials()) {
    const nm = m.getName() || '';
    if (RX.test(nm)) names.push('mat:' + nm);
  }
  if (names.length) { hits += 1; out.push([f, names]); }
}
console.log('scanned ' + scanned + ' GLBs; ' + hits + ' contain tag-named mesh nodes or materials');
for (const [f, names] of out) console.log('  ' + f.split(path.sep).join('/') + ' -> ' + names.slice(0, 8).join(', ') + (names.length > 8 ? ' (+' + (names.length - 8) + ')' : ''));
