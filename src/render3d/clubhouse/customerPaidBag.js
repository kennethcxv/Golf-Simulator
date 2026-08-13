import * as THREE from 'three';

export const PAID_BAG_ACCEPTANCE_HOLD_SEC = 1.4;

// Shared scratch storage: a paid customer can update every frame without
// allocating a new vector or growing garbage-collection pressure.
const gripPoint = new THREE.Vector3();
const carryPoint = new THREE.Vector3();

// A customer is removed from the live actor list immediately after departure,
// even when a custom WebGL disposer fails. Keep failed bag ledgers under a
// module owner so clearing actor pointers cannot make their live resources
// unreachable. The register performs a final retry after all customers have
// been removed during clubhouse teardown; later departures also drain this
// queue opportunistically.
const retainedPaidBagDisposals = new Map(); // detached bag -> retry record
let retainedPaidBagDisposalSequence = 0;

function paidBagResourcesStillLive(resources, threw = false) {
  if (threw) return true;
  if (!resources || typeof resources !== 'object') return false;
  const hasGeometryCount = Number.isFinite(Number(resources.liveGeometries));
  const hasMaterialCount = Number.isFinite(Number(resources.liveMaterials));
  if (hasGeometryCount || hasMaterialCount) {
    return Math.max(0, Number(resources.liveGeometries) || 0)
      + Math.max(0, Number(resources.liveMaterials) || 0) > 0;
  }
  if (resources.disposed === false) return true;
  return Array.isArray(resources.errors) && resources.errors.length > 0;
}

function retainPaidBagDisposal(bag, resources, errors) {
  if (!bag) return null;
  const existing = retainedPaidBagDisposals.get(bag);
  const entry = existing || {
    id: `paid-bag-disposal-${++retainedPaidBagDisposalSequence}`,
    bag,
    attempts: 0,
    resources: null,
    errors: [],
  };
  entry.resources = resources || null;
  entry.errors = (errors || []).map((error) => ({ ...error }));
  retainedPaidBagDisposals.set(bag, entry);
  return entry;
}

export function retainedPaidBagDisposalStatus() {
  let liveGeometries = 0;
  let liveMaterials = 0;
  let unknownLiveResources = 0;
  const entries = [];
  for (const entry of retainedPaidBagDisposals.values()) {
    const resources = entry.resources;
    const geometryKnown = Number.isFinite(Number(resources?.liveGeometries));
    const materialKnown = Number.isFinite(Number(resources?.liveMaterials));
    if (geometryKnown) liveGeometries += Math.max(0, Number(resources.liveGeometries) || 0);
    if (materialKnown) liveMaterials += Math.max(0, Number(resources.liveMaterials) || 0);
    if (!geometryKnown && !materialKnown) unknownLiveResources += 1;
    entries.push({
      id: entry.id,
      attempts: entry.attempts,
      liveGeometries: geometryKnown ? Math.max(0, Number(resources.liveGeometries) || 0) : null,
      liveMaterials: materialKnown ? Math.max(0, Number(resources.liveMaterials) || 0) : null,
      errors: entry.errors.map((error) => ({ ...error })),
    });
  }
  return {
    retained: retainedPaidBagDisposals.size,
    liveGeometries,
    liveMaterials,
    unknownLiveResources,
    entries,
  };
}

/** Retry every failed detached carrier without requiring its customer actor. */
export function retryRetainedPaidBagDisposals() {
  const failures = [];
  let attempted = 0;
  let released = 0;
  for (const [bag, entry] of [...retainedPaidBagDisposals]) {
    attempted += 1;
    entry.attempts += 1;
    const disposeResources = bag?.userData?.disposeCheckoutPaidBagResources;
    let resources = entry.resources;
    let threw = false;
    const errors = [];
    if (typeof disposeResources !== 'function') {
      threw = true;
      errors.push({ stage: 'owned-resources-retry', message: 'Paid-bag disposer is unavailable.' });
    } else {
      try {
        resources = disposeResources() || resources;
      } catch (error) {
        threw = true;
        errors.push({
          stage: 'owned-resources-retry',
          message: String(error?.message || error),
        });
      }
    }
    if (paidBagResourcesStillLive(resources, threw)) {
      entry.resources = resources || null;
      entry.errors = [
        ...(Array.isArray(resources?.errors) ? resources.errors : []),
        ...errors,
      ].map((error) => ({ ...error }));
      failures.push({ id: entry.id, errors: entry.errors.map((error) => ({ ...error })) });
      continue;
    }
    retainedPaidBagDisposals.delete(bag);
    released += 1;
  }
  return {
    attempted,
    released,
    ...retainedPaidBagDisposalStatus(),
    failures,
  };
}

function descendsFrom(object, ancestor) {
  if (!object || !ancestor) return false;
  for (let parent = object.parent; parent; parent = parent.parent) {
    if (parent === ancestor) return true;
  }
  return false;
}

/**
 * A paid carrier can be mounted directly under the customer or beneath the
 * gravity-upright carry root.  Ownership checks must follow ancestry rather
 * than assuming one particular presentation hierarchy.
 */
export function paidBagAttachedToCustomer(customer) {
  const bag = customer?.bagMesh;
  const root = customer?.mesh;
  if (!bag || !root) return false;
  return descendsFrom(bag, root) && bag.userData?.checkoutOwner === 'customer';
}

/**
 * Repair a paid carrier whose presentation threw after the physical handoff.
 * Success means the exact bag is now discoverable through the customer's
 * departure ownership pointer and is actually beneath that customer's root.
 */
export function salvagePaidBagToCustomer(customer, bag) {
  if (!customer?.mesh || !bag || bag.userData?.checkoutOwner !== 'customer') return false;
  if (customer.bagMesh && customer.bagMesh !== bag) return false;

  if (!descendsFrom(bag, customer.mesh)) {
    try {
      customer.mesh.attach(bag);
    } catch {
      // Object3D.attach can fail after a custom matrix hook has already moved
      // the node. Verify the actual postcondition below instead of treating the
      // exception itself as proof of failure.
    }
  }
  if (!descendsFrom(bag, customer.mesh)) return false;

  customer.bagMesh = bag;
  if (customer.checkoutHandoffBag === bag) customer.checkoutHandoffBag = null;
  return paidBagAttachedToCustomer(customer);
}

/**
 * Explicit ownership for resources minted for one checkout carrier.
 *
 * GLB geometry, authored materials, the shared kraft bump texture, and the
 * shared brand material are intentionally never registered here.  The ledger
 * owns only per-bag procedural geometry/materials and material clones.  That
 * makes customer departure safe without evicting merchandise-cache resources
 * still used by the counter's next bag.
 */
export function createPaidBagResourceLedger() {
  const geometries = new Set();
  const materials = new Set();
  const totals = { geometriesCreated: 0, materialsCreated: 0 };
  const released = { geometriesDisposed: 0, materialsDisposed: 0 };
  const errors = [];
  let disposalErrorCount = 0;

  const own = (set, key, resource) => {
    if (!resource || typeof resource.dispose !== 'function' || set.has(resource)) return resource;
    set.add(resource);
    totals[key] += 1;
    return resource;
  };
  const release = (set, key, resource, stage) => {
    if (!resource || !set.has(resource)) return false;
    try {
      resource.dispose();
      set.delete(resource);
      released[key] += 1;
      return true;
    } catch (error) {
      disposalErrorCount += 1;
      errors.push({ stage, message: String(error?.message || error) });
      if (errors.length > 32) errors.splice(0, errors.length - 32);
      return false;
    }
  };
  const status = () => ({
    ...totals,
    ...released,
    liveGeometries: geometries.size,
    liveMaterials: materials.size,
    disposalErrors: disposalErrorCount,
    disposed: geometries.size === 0 && materials.size === 0,
  });

  return Object.freeze({
    ownGeometry: (geometry) => own(geometries, 'geometriesCreated', geometry),
    ownMaterial: (material) => own(materials, 'materialsCreated', material),
    releaseGeometry: (geometry) => release(
      geometries, 'geometriesDisposed', geometry, 'geometry-release',
    ),
    releaseMaterial: (material) => release(
      materials, 'materialsDisposed', material, 'material-release',
    ),
    status,
    dispose() {
      const before = { ...released };
      for (const material of [...materials]) {
        release(materials, 'materialsDisposed', material, 'material-dispose');
      }
      for (const geometry of [...geometries]) {
        release(geometries, 'geometriesDisposed', geometry, 'geometry-dispose');
      }
      const current = status();
      return {
        geometries: current.geometriesDisposed - before.geometriesDisposed,
        materials: current.materialsDisposed - before.materialsDisposed,
        liveGeometries: current.liveGeometries,
        liveMaterials: current.liveMaterials,
        errors: errors.map((entry) => ({ ...entry })),
        alreadyDisposed: before.geometriesDisposed === totals.geometriesCreated
          && before.materialsDisposed === totals.materialsCreated,
      };
    },
  });
}

/**
 * Release the paid-bag presentation through the same funnel that removes its
 * customer.  Resource disposal and scene detachment are independently guarded
 * so one broken disposer cannot retain the character, route, or carry root.
 */
export function disposePaidBagFromCustomer(customer) {
  const retainedRetry = retryRetainedPaidBagDisposals();
  const bag = customer?.bagMesh || null;
  const carryRoot = customer?.bagCarryRoot || null;
  const failures = [];
  let resources = {
    geometries: 0, materials: 0, liveGeometries: 0, liveMaterials: 0, errors: [],
  };
  let resourceDisposalThrew = false;
  if (bag) {
    const disposeResources = bag.userData?.disposeCheckoutPaidBagResources;
    if (typeof disposeResources === 'function') {
      try {
        resources = disposeResources() || resources;
      } catch (error) {
        resourceDisposalThrew = true;
        failures.push({ stage: 'owned-resources', message: String(error?.message || error) });
      }
    }
    try {
      bag.removeFromParent();
    } catch (error) {
      failures.push({ stage: 'bag-detach', message: String(error?.message || error) });
    }
  }
  if (carryRoot) {
    try {
      carryRoot.removeFromParent();
    } catch (error) {
      failures.push({ stage: 'carry-root-detach', message: String(error?.message || error) });
    }
  }
  if (customer) {
    if (customer.checkoutHandoffBag === bag) customer.checkoutHandoffBag = null;
    customer.bagMesh = null;
    customer.bagCarryRoot = null;
    customer.bagCarryTarget = null;
  }
  const resourceErrors = Array.isArray(resources.errors) ? resources.errors : [];
  const retained = paidBagResourcesStillLive(resources, resourceDisposalThrew)
    ? retainPaidBagDisposal(bag, resources, [...resourceErrors, ...failures])
    : null;
  return {
    hadBag: !!bag,
    hadCarryRoot: !!carryRoot,
    resources,
    errors: [...resourceErrors, ...failures],
    retained: !!retained,
    retainedDisposalId: retained?.id || null,
    retainedRetry,
    retainedStatus: retainedPaidBagDisposalStatus(),
  };
}

export function syncPaidBagCarry(customer, dt = 0) {
  void dt; // retained in the public animation signature for callers that pass frame delta
  if (!customer || !customer.mesh || !customer.bagCarryRoot || !customer.bagCarryTarget) return false;
  // The authored handoff socket must remain physically at the receiving palm
  // during both the acceptance beat and departure. A fixed torso showcase pose
  // left the handle roughly 20 cm above/behind the hand in ReceiveBag.
  customer.bagCarryTarget.getWorldPosition(carryPoint);
  customer.mesh.worldToLocal(carryPoint);

  // The character rig owns the short ReceiveBag -> WalkBag easing. Copying the
  // resulting grip exactly keeps the handle in the palm instead of introducing
  // a second spring that visibly trails the hand.
  customer.bagCarryRoot.position.copy(carryPoint);
  return true;
}

export function attachPaidBagToCustomer(customer, bag, { productionBag = false, carryTarget = null } = {}) {
  if (!customer || !customer.mesh || !bag) return null;

  // Establish departure ownership before any presentation operation that can
  // invoke authored/custom Object3D behavior. If anchor lookup, matrix update,
  // or parenting throws after a partial mount, the finalizer and customer
  // removal funnel can still find and release this exact carrier.
  bag.userData.checkoutOwner = 'customer';
  customer.bagMesh = bag;
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

  return bag;
}
