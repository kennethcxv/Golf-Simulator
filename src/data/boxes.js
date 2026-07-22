// PACKAGING — a driver does not arrive in a glove box.
//
// Every delivery used to come in one identical 0.52 x 0.40 x 0.46 carton, so a golf bag and a
// sleeve of tees looked the same on the receiving pad and the stockroom read as a pile of clones.
// Packaging follows contents now, and the size lives HERE rather than inside the mesh builder, so
// the carton, its collider, how much of a doorway it blocks and how it stacks all agree.
//
// This file is the whole of packaging: what a thing ships in, how many go in one, how big that is,
// and what it weighs. `planShipment` below turns an order into a manifest — and that manifest is
// the ONLY place a shipment is packed. The laptop reads it to promise you three boxes and forty-one
// pounds; the receiving pad reads the same object to decide what to stand there. Pack it twice and
// the screen would drift a box away from the world, and you would never know which one was lying.
//
// Dimensions are metres, matching the authored Blender assets and product-packaging contract.
// Weights are pounds, because that is what a shipping label says.

import {
  PACKAGING_SHELLS,
  hasProductPackaging,
  planProductPackaging,
  productPackagingFor,
} from './productPackaging.js';
import { supplierFor, shipFee } from './suppliers.js';

function kindFromShell(id, label, mass, shellId) {
  const shell = PACKAGING_SHELLS[shellId];
  if (!shell) throw new Error(`Box kind ${id} references missing packaging shell ${shellId}`);
  return Object.freeze({
    id,
    label,
    w: shell.dimensions.w,
    h: shell.dimensions.h,
    d: shell.dimensions.d,
    mass,
    tare: shell.tareWeightLb,
    shellId: shell.id,
    familyId: shell.familyId,
    modelId: shell.modelId,
  });
}

export const BOX_KINDS = Object.freeze({
  carton: kindFromShell('carton', 'Accessories carton', 'light', 'ACCESSORY_CARTON'),
  ballcase: kindFromShell('ballcase', 'Golf-ball case', 'heavy', 'BALL_CASE'),
  merchbox: kindFromShell('merchbox', 'Merchandise carton', 'medium', 'GENERIC_MERCHANDISE'),
  apparel: kindFromShell('apparel', 'Apparel carton', 'light', 'APPAREL_CARTON'),
  shoebox: kindFromShell('shoebox', 'Shoe carton', 'medium', 'SHOE_CARTON'),
  clubbox: kindFromShell('clubbox', 'Long club box', 'medium', 'LONG_CLUB_CARTON'),
  bagcarton: kindFromShell('bagcarton', 'Golf-bag carton', 'heavy', 'GOLF_BAG_CARTON'),
  fixture: kindFromShell('fixture', 'Fixture package', 'heavy', 'FIXTURE_PACKAGE'),
  crate: kindFromShell('crate', 'Furniture crate', 'freight', 'FURNITURE_CRATE'),
  provisions: kindFromShell('provisions', 'Bulk provisions carton', 'medium', 'BULK_PROVISIONS'),
  umbrella: kindFromShell('umbrella', 'Umbrella carton', 'medium', 'UMBRELLA_CARTON'),
  ironset: kindFromShell('ironset', 'Iron-set carton', 'heavy', 'IRON_SET_CARTON'),
});

export const SHIPMENT_PACKAGING_SCHEMA_VERSION = 1;

const KIND_BY_SHELL_ID = new Map(
  Object.values(BOX_KINDS).map((kind) => [kind.shellId, kind]),
);

function packagingContractForSku(sku) {
  if (!sku || typeof sku.id !== 'string') {
    throw new TypeError('A catalog SKU with an id is required for packaging');
  }
  return productPackagingFor(sku.id);
}

// what a given product ships in
export function boxKindFor(sku) {
  const contract = packagingContractForSku(sku);
  const kind = KIND_BY_SHELL_ID.get(contract.box.shellId);
  if (!kind) {
    throw new RangeError(`${sku.id} uses unregistered packaging shell ${contract.box.shellId}`);
  }
  return kind;
}

// --- how many go in one box ---------------------------------------------------------------
// The category default is a decent guess and a bad law. `bag1`'s category is 'accessories', which
// packs TWELVE to a carton — so the per-category rule alone would have shipped a dozen stand bags
// in one box, and the pad would have shown one carton where five belong.
export function unitsPerBox(sku) {
  return packagingContractForSku(sku).unitsPerBox;
}

export function boxDims(kind) {
  const k = typeof kind === 'string' ? BOX_KINDS[kind] : kind;
  const b = k || BOX_KINDS.carton;
  return { w: b.w, h: b.h, d: b.d };
}

// how far a carton of this kind sticks out from the point it was set down — used by the collider
// and by "will this fit through the door with me"
export function boxRadius(kind) {
  const d = boxDims(kind);
  return Math.hypot(d.w, d.d) / 2;
}

// what a box of `qty` of this thing weighs, on the label, in pounds
export function boxWeight(sku, qty) {
  const contract = packagingContractForSku(sku);
  if (!Number.isInteger(qty) || qty < 0) {
    throw new RangeError(`Box quantity for ${sku.id} must be a non-negative integer`);
  }
  return Math.round((contract.box.tareWeightLb + contract.unitWeightLb * qty) * 10) / 10;
}

// --- THE MANIFEST -------------------------------------------------------------------------
// One order in, one packing plan out. Pure: no state, no randomness, no clock. The same order
// always packs the same way, which is what lets the screen and the pad agree without either of
// them asking the other.
export function planShipment(sku, qty) {
  const contract = packagingContractForSku(sku);
  const supplier = supplierFor(sku);
  const packingPlan = planProductPackaging(sku.id, qty, {
    category: sku.cat,
    fragile: !!sku.fragile,
    unitWeightLb: sku.lb,
    packedDimensions: contract.packing.dimensions,
  });
  const kind = boxKindFor(sku);
  const boxes = packingPlan.boxes.map((box) => ({
    kind: kind.id,
    qty: box.units,
    w: box.dimensions.w,
    h: box.dimensions.h,
    d: box.dimensions.d,
    lb: box.weightLb,
    fragile: box.fragile,
    longProduct: box.longProduct,
    familyId: box.familyId,
    layoutId: box.layoutId,
    shellId: box.shellId,
    modelId: box.modelId,
    packingState: contract.packing.state,
    packingOrientation: contract.packing.orientation,
    contentScale: box.contentScale,
  }));
  const weight = Math.round(boxes.reduce((a, b) => a + b.lb, 0) * 10) / 10;
  return {
    packagingSchemaVersion: SHIPMENT_PACKAGING_SCHEMA_VERSION,
    supplierId: supplier.id,
    supplier: supplier.name,
    boxes,
    boxCount: boxes.length,
    weight,
    fee: shipFee(supplier, boxes.length),
  };
}

// Save migration is deliberately tolerant only after a box already exists. A known SKU always
// heals to the current authored contract; a removed/unknown legacy SKU keeps its recognized shell
// and receives explicit legacy markers so it cannot disappear during load.
const SAVED_PACKAGING_METADATA_BY_SKU = new Map();

export function packagingMetadataForSavedBox(box) {
  if (hasProductPackaging(box?.skuId)) {
    const cached = SAVED_PACKAGING_METADATA_BY_SKU.get(box.skuId);
    if (cached) return cached;
    const contract = productPackagingFor(box.skuId);
    const kind = KIND_BY_SHELL_ID.get(contract.box.shellId);
    if (!kind) throw new RangeError(`${box.skuId} uses unregistered packaging shell ${contract.box.shellId}`);
    const metadata = Object.freeze({
      kind: kind.id,
      familyId: contract.familyId,
      layoutId: contract.layoutId,
      shellId: contract.box.shellId,
      modelId: contract.box.modelId,
      packingState: contract.packing.state,
      packingOrientation: contract.packing.orientation,
      contentScale: 1,
      fragile: contract.fragile,
      longProduct: contract.longProduct,
    });
    SAVED_PACKAGING_METADATA_BY_SKU.set(box.skuId, metadata);
    return metadata;
  }
  const kind = BOX_KINDS[box?.box] || BOX_KINDS.carton;
  return {
    kind: kind.id,
    familyId: kind.familyId,
    layoutId: 'LEGACY_UNSPECIFIED',
    shellId: kind.shellId,
    modelId: kind.modelId,
    packingState: 'legacy-unspecified',
    packingOrientation: 'legacy-unspecified',
    contentScale: 1,
    fragile: !!box?.fragile,
    longProduct: kind.id === 'clubbox' || kind.id === 'umbrella' || kind.id === 'ironset',
  };
}
