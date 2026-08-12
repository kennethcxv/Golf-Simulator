// QA-only attribution for Three r185 WebGL program cache keys.
//
// WebGLRenderer.info.programs exposes the global programs, while
// renderer.properties.get(material).programs retains the exact cache keys used
// by each material.  Joining that map back to a scene traversal lets a browser
// driver name the objects and runtime-asset ancestors that own a program which
// appeared during an interaction.  Capture is intentionally performed after a
// measured window; it does no rendering and cannot compile another program.

export const GOAL24_PROGRAM_OWNERSHIP_SCHEMA =
  'golf-flipper/goal24-three-program-ownership/v1';

export function createGoal24ProgramOwnershipProbe() {
  const schema = 'golf-flipper/goal24-three-program-ownership/v1';

  // Three r185: WebGLPrograms.getProgramCacheKeyParameters(). Keep this list
  // beside the decoder rather than importing renderer internals into the page.
  const fixedParameterNames = [
    'precision',
    'outputColorSpace',
    'envMapMode',
    'envMapCubeUVHeight',
    'mapUv',
    'alphaMapUv',
    'lightMapUv',
    'aoMapUv',
    'bumpMapUv',
    'normalMapUv',
    'displacementMapUv',
    'emissiveMapUv',
    'metalnessMapUv',
    'roughnessMapUv',
    'anisotropyMapUv',
    'clearcoatMapUv',
    'clearcoatNormalMapUv',
    'clearcoatRoughnessMapUv',
    'iridescenceMapUv',
    'iridescenceThicknessMapUv',
    'sheenColorMapUv',
    'sheenRoughnessMapUv',
    'specularMapUv',
    'specularColorMapUv',
    'specularIntensityMapUv',
    'transmissionMapUv',
    'thicknessMapUv',
    'combine',
    'fogExp2',
    'sizeAttenuation',
    'morphTargetsCount',
    'morphAttributeCount',
    'numDirLights',
    'numPointLights',
    'numSpotLights',
    'numSpotLightMaps',
    'numHemiLights',
    'numRectAreaLights',
    'numDirLightShadows',
    'numPointLightShadows',
    'numSpotLightShadows',
    'numSpotLightShadowsWithMaps',
    'numLightProbes',
    'shadowMapType',
    'toneMapping',
    'numClippingPlanes',
    'numClipIntersection',
    'depthPacking',
  ];

  // Three r185: the two Layers masks assembled by
  // WebGLPrograms.getProgramCacheKeyBooleans().
  const booleanMaskA = [
    'instancing',
    'instancingColor',
    'instancingMorph',
    'matcap',
    'envMap',
    'normalMapObjectSpace',
    'normalMapTangentSpace',
    'clearcoat',
    'iridescence',
    'alphaTest',
    'vertexColors',
    'vertexAlphas',
    'vertexUv1s',
    'vertexUv2s',
    'vertexUv3s',
    'vertexTangents',
    'anisotropy',
    'alphaHash',
    'batching',
    'dispersion',
    'batchingColor',
    'gradientMap',
    'packedNormalMap',
    'vertexNormals',
  ];
  const booleanMaskB = [
    'fog',
    'useFog',
    'flatShading',
    'logarithmicDepthBuffer',
    'reversedDepthBuffer',
    'skinning',
    'morphTargets',
    'morphNormals',
    'morphColors',
    'premultipliedAlpha',
    'shadowMapEnabled',
    'doubleSided',
    'flipSided',
    'useDepthPacking',
    'dithering',
    'transmission',
    'sheen',
    'opaque',
    'pointsUvs',
    'decodeVideoTexture',
    'decodeVideoTextureEmissive',
    'alphaToCoverage',
    'numLightProbeGrids',
    'hasPositionAttribute',
  ];

  function scalar(token) {
    if (token === '') return null;
    if (token === 'true') return true;
    if (token === 'false') return false;
    const number = Number(token);
    return Number.isFinite(number) ? number : token;
  }

  function inferDefineNames(tokens) {
    // The late door keys are built-in physical shaders. MeshStandardMaterial
    // contributes STANDARD; MeshPhysicalMaterial contributes PHYSICAL. Other
    // materials are decoded exactly when capture supplies their own defines.
    if (tokens[0] === 'physical' && ['STANDARD', 'PHYSICAL'].includes(tokens[1])) {
      return [tokens[1]];
    }
    return [];
  }

  function decodeMask(raw, names) {
    const mask = Number(raw);
    const values = {};
    const active = [];
    for (let bit = 0; bit < names.length; bit += 1) {
      const enabled = Number.isInteger(mask) && (mask & (1 << bit)) !== 0;
      values[names[bit]] = enabled;
      if (enabled) active.push(names[bit]);
    }
    return {
      mask: Number.isInteger(mask) ? mask : null,
      active,
      values,
    };
  }

  function decode(cacheKey, options = {}) {
    const key = String(cacheKey || '');
    const tokens = key.split(',');
    const defineNames = Array.isArray(options.defineNames)
      ? options.defineNames.map(String)
      : inferDefineNames(tokens);
    const defines = {};
    let cursor = 1;
    for (const expectedName of defineNames) {
      const actualName = tokens[cursor] ?? null;
      const value = tokens[cursor + 1] ?? null;
      defines[actualName ?? expectedName] = scalar(value ?? '');
      cursor += 2;
    }
    const parameters = {};
    for (const name of fixedParameterNames) {
      parameters[name] = scalar(tokens[cursor] ?? '');
      cursor += 1;
    }
    const masks = {
      a: decodeMask(tokens[cursor], booleanMaskA),
      b: decodeMask(tokens[cursor + 1], booleanMaskB),
    };
    cursor += 2;
    const rendererOutputColorSpace = scalar(tokens[cursor] ?? '');
    cursor += 1;
    return {
      cacheKey: key,
      shaderId: tokens[0] || null,
      defineNames,
      defines,
      parameters,
      masks,
      rendererOutputColorSpace,
      // Rejoining is required: Material.customProgramCacheKey() is the source
      // of onBeforeCompile(), whose default argument list itself has a comma.
      customProgramCacheKey: tokens.slice(cursor).join(','),
    };
  }

  function flatten(decoded) {
    const fields = {
      shaderId: decoded.shaderId,
      rendererOutputColorSpace: decoded.rendererOutputColorSpace,
      customProgramCacheKey: decoded.customProgramCacheKey,
    };
    for (const [name, value] of Object.entries(decoded.defines)) {
      fields[`define.${name}`] = value;
    }
    for (const [name, value] of Object.entries(decoded.parameters)) {
      fields[`parameter.${name}`] = value;
    }
    for (const [name, value] of Object.entries(decoded.masks.a.values)) {
      fields[`boolean.${name}`] = value;
    }
    for (const [name, value] of Object.entries(decoded.masks.b.values)) {
      fields[`boolean.${name}`] = value;
    }
    return fields;
  }

  function compareDecoded(reference, arrival) {
    const before = flatten(reference);
    const after = flatten(arrival);
    const names = new Set([...Object.keys(before), ...Object.keys(after)]);
    const differences = [];
    for (const field of names) {
      if (Object.is(before[field], after[field])) continue;
      differences.push({
        field,
        before: before[field] ?? null,
        after: after[field] ?? null,
      });
    }
    return differences;
  }

  function objectPath(object) {
    const segments = [];
    for (let node = object; node; node = node.parent) {
      const label = String(node.name || node.type || 'Object3D').replaceAll('/', '\u2215');
      segments.push(`${label}#${node.id ?? node.uuid ?? '?'}`);
    }
    return segments.reverse().join('/');
  }

  function primitiveRecord(value) {
    if (!value || typeof value !== 'object') return null;
    return Object.fromEntries(Object.entries(value).filter(([, item]) => (
      item == null || ['string', 'number', 'boolean'].includes(typeof item)
    )));
  }

  function runtimeAncestors(object) {
    let assetRuntime = null;
    let placedStaticBatch = null;
    const named = [];
    for (let node = object; node; node = node.parent) {
      if (!assetRuntime && node.userData?.assetRuntime) {
        assetRuntime = {
          objectId: node.id ?? null,
          objectName: node.name || null,
          metadata: primitiveRecord(node.userData.assetRuntime),
        };
      }
      if (!placedStaticBatch && node.userData?.assetRuntimePlacedStaticBatch === true) {
        placedStaticBatch = {
          objectId: node.id ?? null,
          objectName: node.name || null,
        };
      }
      if (/Asset(?:s|Runtime)/.test(String(node.name || ''))) {
        named.push({ objectId: node.id ?? null, objectName: node.name });
      }
    }
    return { assetRuntime, placedStaticBatch, named: named.reverse() };
  }

  function materialRecord(material, slot) {
    const sideNames = ['FrontSide', 'BackSide', 'DoubleSide'];
    return {
      slot,
      id: material.id ?? null,
      uuid: material.uuid ?? null,
      name: material.name || null,
      type: material.type || null,
      alphaTest: Number(material.alphaTest) || 0,
      side: material.side ?? null,
      sideName: sideNames[material.side] || null,
      vertexColors: material.vertexColors === true,
      transparent: material.transparent === true,
      opacity: Number.isFinite(Number(material.opacity)) ? Number(material.opacity) : null,
      maps: Object.fromEntries([
        'map', 'alphaMap', 'lightMap', 'aoMap', 'bumpMap', 'normalMap',
        'displacementMap', 'emissiveMap', 'metalnessMap', 'roughnessMap',
      ].map((name) => [name, !!material[name]])),
    };
  }

  function objectRecord(object, material, slot, decoded) {
    const geometry = object.geometry || null;
    const attributes = geometry?.attributes || {};
    const morph = geometry?.morphAttributes || {};
    const morphAttribute = morph.position || morph.normal || morph.color;
    const expected = {
      instancing: object.isInstancedMesh === true,
      instancingColor: object.isInstancedMesh === true && object.instanceColor != null,
      instancingMorph: object.isInstancedMesh === true && object.morphTexture != null,
      batching: object.isBatchedMesh === true,
      batchingColor: object.isBatchedMesh === true && object._colorsTexture != null,
      vertexNormals: attributes.normal !== undefined,
      vertexAlphas: material.vertexColors === true
        && attributes.color !== undefined && attributes.color.itemSize === 4,
      vertexTangents: attributes.tangent !== undefined
        && (!!material.normalMap || Number(material.anisotropy) > 0),
      skinning: object.isSkinnedMesh === true,
      morphTargets: morph.position !== undefined,
      morphNormals: morph.normal !== undefined,
      morphColors: morph.color !== undefined,
      hasPositionAttribute: attributes.position !== undefined,
    };
    const mismatches = [];
    for (const [name, value] of Object.entries(expected)) {
      const decodedValue = decoded.masks.a.values[name] ?? decoded.masks.b.values[name];
      if (decodedValue !== value) mismatches.push({ field: name, expected: value, decoded: decodedValue });
    }
    const decodedMorphCount = decoded.parameters.morphTargetsCount;
    const actualMorphCount = morphAttribute?.length || 0;
    if (Number(decodedMorphCount || 0) !== actualMorphCount) {
      mismatches.push({
        field: 'morphTargetsCount',
        expected: actualMorphCount,
        decoded: decodedMorphCount,
      });
    }
    return {
      id: object.id ?? null,
      uuid: object.uuid ?? null,
      name: object.name || null,
      type: object.type || null,
      path: objectPath(object),
      visible: object.visible !== false,
      layersMask: object.layers?.mask ?? null,
      materialSlot: slot,
      programShapeMatches: mismatches.length === 0,
      programShapeMismatches: mismatches,
      geometry: geometry ? {
        id: geometry.id ?? null,
        uuid: geometry.uuid ?? null,
        name: geometry.name || null,
        type: geometry.type || null,
        attributes: Object.keys(attributes).sort(),
        morphTargets: {
          position: morph.position?.length || 0,
          normal: morph.normal?.length || 0,
          color: morph.color?.length || 0,
        },
      } : null,
      runtimeAncestors: runtimeAncestors(object),
    };
  }

  function programRecord(program) {
    return program ? {
      id: program.id ?? null,
      type: program.type || null,
      name: program.name || null,
      usedTimes: program.usedTimes ?? null,
    } : null;
  }

  function capture({ renderer, scene, arrivalKeys = [], referenceKeys = [] } = {}) {
    if (!renderer?.properties?.has || !renderer?.properties?.get || !scene?.traverse) {
      throw new Error('Goal 24 program ownership requires a live Three renderer and scene.');
    }
    const arrivals = [...new Set(arrivalKeys.map(String).filter(Boolean))];
    const references = new Set(referenceKeys.map(String).filter(Boolean));
    const wanted = new Set([...arrivals, ...references]);
    const globalPrograms = new Map((renderer.info?.programs || []).map((program) => (
      [String(program.cacheKey || ''), program]
    )));
    const byKey = new Map();

    scene.traverse((object) => {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material, slot) => {
        if (!material?.isMaterial || !renderer.properties.has(material)) return;
        const materialProperties = renderer.properties.get(material);
        if (!(materialProperties.programs instanceof Map)) return;
        for (const [cacheKey, program] of materialProperties.programs) {
          const key = String(cacheKey || '');
          if (!wanted.has(key)) continue;
          let materialMap = byKey.get(key);
          if (!materialMap) {
            materialMap = new Map();
            byKey.set(key, materialMap);
          }
          const identity = material.uuid || material.id;
          let owner = materialMap.get(identity);
          if (!owner) {
            const defineNames = Object.keys(material.defines || {});
            owner = {
              material: materialRecord(material, slot),
              defineNames,
              decoded: decode(key, { defineNames }),
              program: programRecord(program || globalPrograms.get(key)),
              owners: [],
              programKeys: [...materialProperties.programs.keys()].map(String),
            };
            materialMap.set(identity, owner);
          }
          if (!owner.owners.some((entry) => entry.uuid === object.uuid && entry.materialSlot === slot)) {
            owner.owners.push(objectRecord(object, material, slot, owner.decoded));
          }
        }
      });
    });

    const output = arrivals.map((cacheKey) => {
      const materialOwners = [...(byKey.get(cacheKey)?.values() || [])];
      const decoded = materialOwners[0]?.decoded || decode(cacheKey);
      const nearest = [];
      for (const owner of materialOwners) {
        for (const referenceKey of owner.programKeys) {
          if (!references.has(referenceKey) || referenceKey === cacheKey) continue;
          const reference = decode(referenceKey, { defineNames: owner.defineNames });
          const differences = compareDecoded(reference, owner.decoded);
          nearest.push({
            cacheKey: referenceKey,
            distance: differences.length,
            differences,
            sameMaterial: true,
            materialUuid: owner.material.uuid,
          });
        }
      }
      // Fall back to the renderer-wide before set only when the material had no
      // pre-existing program of its own.
      if (!nearest.length) {
        for (const referenceKey of references) {
          const reference = decode(referenceKey, { defineNames: decoded.defineNames });
          if (reference.shaderId !== decoded.shaderId) continue;
          const differences = compareDecoded(reference, decoded);
          nearest.push({
            cacheKey: referenceKey,
            distance: differences.length,
            differences,
            sameMaterial: false,
            materialUuid: null,
          });
        }
      }
      nearest.sort((a, b) => a.distance - b.distance || a.cacheKey.localeCompare(b.cacheKey));
      for (const owner of materialOwners) {
        owner.matchingOwners = owner.owners.filter((entry) => entry.programShapeMatches);
        owner.nonmatchingMaterialUsers = owner.owners.filter((entry) => !entry.programShapeMatches);
        delete owner.owners;
        delete owner.programKeys;
      }
      return {
        cacheKey,
        decoded,
        program: programRecord(globalPrograms.get(cacheKey)),
        materialOwners,
        nearestExisting: nearest[0] || null,
        attributed: materialOwners.length > 0
          && materialOwners.some((owner) => owner.matchingOwners.length > 0),
      };
    });

    return {
      schema,
      threeRevision: '185',
      source: 'renderer.properties.get(material).programs joined to scene traversal',
      capturedAtMs: globalThis.performance?.now?.() ?? Date.now(),
      referenceKeyCount: references.size,
      arrivalCount: output.length,
      arrivals: output,
    };
  }

  return {
    schema,
    decode,
    compareDecoded,
    capture,
  };
}

export function goal24ProgramOwnershipProbeFactorySource() {
  return `(${createGoal24ProgramOwnershipProbe.toString()})`;
}
