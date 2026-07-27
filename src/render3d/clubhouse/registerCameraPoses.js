// Pure geometry for the card-payment camera. Every pose is authored in the
// canonical front-desk frame, so relocating or rotating reception cannot make
// a working camera look back toward the former counter.

import {
  frontDeskLocalPoint,
  frontDeskPoint,
} from '../../data/shopLayout.js';

function posed(local, y, fov) {
  const point = frontDeskPoint(local.x, local.z);
  return { ...point, y, ...(fov ? { fov } : {}) };
}

// Card handoff: eye on the staff side at standing height, looking across the
// counter at the card and customer torso.
export function cardHandoffPose(customer, counterTop) {
  const localCustomer = frontDeskLocalPoint(customer.x, customer.z);
  const cx = Math.max(-0.75, Math.min(0.25, localCustomer.x));
  return {
    eye: posed({ x: cx + 0.26, z: 1.15 }, 1.66),
    look: posed({ x: cx, z: -0.56 }, counterTop + 0.29),
    fov: 52,
  };
}

// Terminal entry: the reader remains physically seated on the counter. The
// camera approaches from local +z (the staff side) and looks down at it.
export function cardTerminalPose(station, counterTop) {
  const localStation = frontDeskLocalPoint(station.x, station.z);
  return {
    // Aim between the reader and the POS, like the supplied payment frame:
    // the keypad stays dominant without throwing away the transaction screen.
    eye: posed({ x: localStation.x + 0.18, z: localStation.z + 1.14 }, counterTop + 0.54),
    look: posed({ x: localStation.x + 0.20, z: localStation.z + 0.18 }, counterTop + 0.14),
    fov: 48,
  };
}

// Fulfilment keeps the printer, receipt path, and receiving customer in one
// close working frame from the staff side. The loading pouch now sits inside a
// narrower counter span, so this no longer needs the old room-wide pullback.
export function fulfillmentHandoffPose(customer, printer, counterTop, bag = null, goods = null) {
  const localCustomer = frontDeskLocalPoint(customer.x, customer.z);
  const localPrinter = Number.isFinite(printer?.x) && Number.isFinite(printer?.z)
    ? frontDeskLocalPoint(printer.x, printer.z)
    : { x: 1.08, z: 0.28 };
  const localBag = Number.isFinite(bag?.x) && Number.isFinite(bag?.z)
    ? frontDeskLocalPoint(bag.x, bag.z)
    : { x: -0.86, z: 0.24 };
  const goodsCorners = Number.isFinite(goods?.minX) && Number.isFinite(goods?.maxX)
    && Number.isFinite(goods?.minZ) && Number.isFinite(goods?.maxZ)
    ? [
      frontDeskLocalPoint(goods.minX, goods.minZ),
      frontDeskLocalPoint(goods.minX, goods.maxZ),
      frontDeskLocalPoint(goods.maxX, goods.minZ),
      frontDeskLocalPoint(goods.maxX, goods.maxZ),
    ]
    : [];
  const customerX = Math.max(-0.80, Math.min(0.20, localCustomer.x));
  const taskXs = [customerX, localPrinter.x, localBag.x, ...goodsCorners.map((point) => point.x)];
  const leftX = Math.min(...taskXs);
  const rightX = Math.max(...taskXs);
  const centreX = (leftX + rightX) / 2;
  return {
    eye: posed({ x: centreX, z: 1.34 }, 1.68),
    look: posed({ x: centreX, z: 0.00 }, counterTop + 0.13),
    fov: 52,
  };
}
