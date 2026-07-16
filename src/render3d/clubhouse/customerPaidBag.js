import * as THREE from 'three';

export const PAID_BAG_ACCEPTANCE_HOLD_SEC = 1.4;

// Shared scratch storage: a paid customer can update every frame without
// allocating a new vector or growing garbage-collection pressure.
const gripPoint = new THREE.Vector3();
const carryPoint = new THREE.Vector3();

export function syncPaidBagCarry(customer, dt = 0) {
  if (!customer || !customer.mesh || !customer.bagCarryRoot || !customer.bagCarryTarget) return false;
  if (customer.bagAcceptanceHold > 0) {
    // Hold the purchased bag centered against the customer's torso for
    // the ownership beat. The counter otherwise hides a side-hung bag almost
    // completely from the cashier camera, even though it is correctly attached.
    // The cashier POS occupies the customer's visual center. Keep the bag at
    // their receiving hand so the branded face clears the monitor on camera.
    carryPoint.set(0.40, 1.40, 0.46);
  } else {
    customer.bagCarryTarget.getWorldPosition(carryPoint);
    customer.mesh.worldToLocal(carryPoint);
  }

  if (dt > 0) {
    // When the hold ends, ease the bag from the two-hand acceptance pose to the
    // walking hand instead of popping sideways on the first departure frame.
    customer.bagCarryRoot.position.lerp(carryPoint, 1 - Math.exp(-dt * 7));
  } else {
    customer.bagCarryRoot.position.copy(carryPoint);
  }
  return true;
}

export function attachPaidBagToCustomer(customer, bag, { productionBag = false, carryTarget = null } = {}) {
  if (!customer || !customer.mesh || !bag) return null;

  bag.rotation.set(0.035, 0.16, -0.055);
  if (carryTarget) {
    // Track the articulated grip's position from a customer-root child. This
    // inherits the customer's scale and heading, but not the forearm pitch, so
    // a gravity-hung bag stays upright while the hand changes pose.
    const uprightCarrier = new THREE.Group();
    uprightCarrier.name = 'PaidBagCarryRoot';
    customer.mesh.add(uprightCarrier);
    customer.bagCarryRoot = uprightCarrier;
    customer.bagCarryTarget = carryTarget;
    syncPaidBagCarry(customer);
    uprightCarrier.add(bag);

    if (productionBag) {
      bag.position.set(0, 0, 0);
      uprightCarrier.updateWorldMatrix(true, true);
      const handoff = bag.getObjectByName('ANCHOR_BagHandoff')
        || bag.getObjectByName('ANCHOR_BagHandleFront');
      if (handoff) {
        const anchorAt = handoff.getWorldPosition(gripPoint);
        uprightCarrier.worldToLocal(anchorAt);
        bag.position.sub(anchorAt);
      } else {
        bag.position.set(0, -0.345, 0.025);
      }
    } else {
      bag.position.set(0, -0.245, 0.025);
    }
  } else {
    bag.position.set(-0.32, 0.38, 0.14);
    customer.mesh.add(bag);
  }

  customer.bagMesh = bag;
  bag.userData.checkoutOwner = 'customer';
  return bag;
}
