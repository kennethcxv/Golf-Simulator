// Collate per-asset fragments into the final pro-shop manifests.
import { readFile, readdir, writeFile } from 'node:fs/promises';

const BASE = new URL('../assets/pro_shop/', import.meta.url);
const FRAG = new URL('manifests/fragments/', BASE);

const products = [];
const fixtures = [];
const textures = new Map();

for (const f of (await readdir(FRAG)).filter((f) => f.endsWith('.json'))) {
  const d = JSON.parse(await readFile(new URL(f, FRAG), 'utf8'));
  const row = {
    sku: d.id,
    name: d.name || d.id,
    category: d.category,
    variant: d.variant || 'base',
    dims_m: d.dims_m,
    tris: d.tris,
    price: d.price ?? null,
    fixture: d.fixture || null,
    slot_type: d.slot_type || null,
    packaging: d.packaging || null,
    material: d.material || null,
    textures: d.textures || [],
    sockets: d.sockets || [],
    glb: d.glb,
    blend: d.blend,
    hanging: (d.min_z ?? 0) < -0.05,
  };
  (d.kind === 'fixtures' ? fixtures : products).push(row);
  for (const t of d.textures || []) {
    const [name, res] = t.split(':');
    if (!textures.has(name)) textures.set(name, { name, resolution: res, used_by: [] });
    textures.get(name).used_by.push(d.id);
  }
}

products.sort((a, b) => a.sku.localeCompare(b.sku));
fixtures.sort((a, b) => a.sku.localeCompare(b.sku));

await writeFile(new URL('manifests/product_manifest.json', BASE),
  JSON.stringify({ count: products.length, products }, null, 1));
await writeFile(new URL('manifests/fixture_manifest.json', BASE),
  JSON.stringify({ count: fixtures.length, fixtures }, null, 1));
await writeFile(new URL('manifests/texture_manifest.json', BASE),
  JSON.stringify({ count: textures.size, textures: [...textures.values()].sort((a, b) => a.name.localeCompare(b.name)) }, null, 1));

console.log(`collated: ${products.length} products, ${fixtures.length} fixtures, ${textures.size} textures`);
