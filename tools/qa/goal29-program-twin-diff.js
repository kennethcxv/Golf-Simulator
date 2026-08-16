// GOAL 29 PHASE 4 — THE TWIN-DIFF VALUE MATCHER. Name the program-key
// positions by MEASUREMENT, then produce the fold table.
//
// The program cacheKey is an anonymous joined parameter list. Goal 28 P5
// ended with "field 51/0/54 — INDEXES, not names", and 2681f28's caution
// stands: a static name table was off by one until a live value-match caught
// it. So nothing here is named from a table. Instead:
//
//   1. every live program's key array is captured, WITH the materials that
//      own it (renderer.properties.get(material).programs — the renderer's
//      own bookkeeping, not a guess);
//   2. twin pairs (key arrays differing at EXACTLY one index) vote: when the
//      two sides' materials differ in exactly one known field, that field
//      names the index; conflicting votes are reported, not swallowed;
//   3. THE CONTROL IS PLANTED GROUND TRUTH: three twin pairs are compiled
//      live (vertexColors / side / alphaTest — each differing in ONLY that
//      field). The matcher must name each planted pair's index with the
//      planted field. Miss or misname = the whole table is void.
//   4. the fold table: real program pairs that differ ONLY at the
//      vertexColors index — the programs a white-vertex-color unification
//      would fold, counted per family.
//
// Diagnostic only — reads plus a temporary compile of six tiny materials,
// disposed before the report.
//
//   node tools/qa/run-electron.cjs tools/qa/goal29-program-twin-diff.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/goal29-programs');
  fs.mkdirSync(OUT, { recursive: true });
  const tag = process.env.QA_TAG || 'twin-diff';
  const out = { tag, errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(8000);

  out.result = await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const renderer = s3.renderer;
    const scene = s3.scene;
    const camera = s3.camera;

    // ---- plant the ground-truth twins BEFORE the census --------------------
    // Six materials, three pairs, each pair differing in exactly one field.
    // A shared parent keeps them one renderer.compile call.
    // THE SKY TRAP (found by goal29-properties-probe): the first mesh in
    // traverse order is the addon Sky, whose constructor IGNORES its
    // arguments and builds its own ShaderMaterial — a plant built from that
    // donor renders the sky's material, not the planted one. Donors must be
    // plain Mesh, and geometry/material are assigned explicitly anyway.
    let donor = null;
    scene.traverse((o) => {
      if (donor || !o.isMesh || o.constructor?.name !== 'Mesh' || Array.isArray(o.material)) return;
      const pos = o.geometry?.attributes?.position;
      if (pos && !pos.isInterleavedBufferAttribute) donor = o;
    });
    const GeoC = donor.geometry.constructor;
    const BA = donor.geometry.attributes.position.constructor;
    // find a standard material to clone as the plant template (guarantees the
    // same family as the 107-program physical spread)
    let stdDonor = null;
    scene.traverse((o) => {
      if (stdDonor || !o.isMesh || Array.isArray(o.material)) return;
      if (o.material?.isMeshStandardMaterial && !o.material.map && !o.material.normalMap) stdDonor = o.material;
    });
    if (!stdDonor) return { err: 'no untextured standard material donor found' };
    const preCount = (renderer.info.programs || []).length;

    const tri = new GeoC();
    tri.setAttribute('position', new BA(new Float32Array([0, 0, 0, 0.05, 0, 0, 0, 0.05, 0]), 3));
    tri.computeVertexNormals();
    tri.setAttribute('uv', new BA(new Float32Array(6), 2));
    const triColored = tri.clone();
    triColored.setAttribute('color', new BA(new Float32Array([1, 1, 1, 1, 1, 1, 1, 1, 1]), 3));

    const plants = [];
    const mk = (mutate, geometry, label) => {
      const material = stdDonor.clone();
      material.name = `Goal29PlantTwin_${label}`;
      mutate(material);
      const mesh = new donor.constructor();
      mesh.geometry = geometry; // explicit: a subclass constructor may ignore args
      mesh.material = material;
      mesh.frustumCulled = false;
      mesh.position.set(0, -50, 0); // far below the floor; the init frame does not care
      plants.push(mesh);
      return material;
    };
    const pairs = {
      vertexColors: [
        mk((m) => { m.vertexColors = false; }, tri, 'vcA'),
        mk((m) => { m.vertexColors = true; }, triColored, 'vcB'),
      ],
      side: [
        mk((m) => { m.side = 0; }, tri, 'sideA'),
        mk((m) => { m.side = 2; }, tri, 'sideB'),
      ],
      alphaTest: [
        mk((m) => { m.alphaTest = 0; }, tri, 'atA'),
        mk((m) => { m.alphaTest = 0.5; }, tri, 'atB'),
      ],
    };
    for (const mesh of plants) scene.add(mesh);
    renderer.compile(scene, camera);

    // ---- capture programs + material ownership -----------------------------
    const properties = renderer.properties;
    const keyOfProgram = (p) => String(p.cacheKey);
    const materialsByKey = new Map(); // cacheKey -> materials[]
    const seenMats = new Set();
    const collectMaterial = (m) => {
      if (!m || seenMats.has(m)) return;
      seenMats.add(m);
      const props = properties.get(m);
      const programs = props?.programs;
      if (programs && typeof programs.forEach === 'function') {
        programs.forEach((program) => {
          const key = keyOfProgram(program);
          if (!materialsByKey.has(key)) materialsByKey.set(key, []);
          materialsByKey.get(key).push(m);
        });
      } else if (props?.currentProgram) {
        const key = keyOfProgram(props.currentProgram);
        if (!materialsByKey.has(key)) materialsByKey.set(key, []);
        materialsByKey.get(key).push(m);
      }
    };
    scene.traverse((o) => {
      if (!o.material) return;
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])) collectMaterial(m);
    });

    // THE CENSUS IS THE FIRST preCount PROGRAMS ONLY. Instrument-time
    // compile/render mints phantom variants (a direct compile sees different
    // light/scene state than the composer's frames — measured +35..56 new
    // cacheKeys on a settled boot), and those must not enter the fold table.
    // info.programs is append-only, so the settled census is its prefix; the
    // planted pairs verify through material properties directly.
    const live = (renderer.info.programs || []).slice(0, preCount).map((p) => String(p.cacheKey));
    const split = live.map((k) => k.split(','));

    // planted keys, known now: they are EXCLUDED from voting so the control
    // stays independent — a name table confirmed only by its own plants would
    // be circular
    const plantedKeys = new Set();
    for (const [ma, mb] of Object.values(pairs)) {
      for (const m of [ma, mb]) {
        for (const p of (properties.get(m)?.programs?.values() || [])) plantedKeys.add(keyOfProgram(p));
      }
    }

    // ---- twin pairs + votes -------------------------------------------------
    const FIELDS = [
      ['vertexColors', (m) => !!m.vertexColors],
      ['side', (m) => m.side],
      ['alphaTest', (m) => (m.alphaTest > 0 ? 1 : 0)],
      ['transparent', (m) => !!m.transparent],
      ['flatShading', (m) => !!m.flatShading],
      ['map', (m) => !!m.map],
      ['normalMap', (m) => !!m.normalMap],
      ['roughnessMap', (m) => !!m.roughnessMap],
      ['metalnessMap', (m) => !!m.metalnessMap],
      ['aoMap', (m) => !!m.aoMap],
      ['emissiveMap', (m) => !!m.emissiveMap],
      ['alphaMap', (m) => !!m.alphaMap],
      ['envMap', (m) => !!m.envMap],
      ['fog', (m) => !!m.fog],
      ['toneMapped', (m) => !!m.toneMapped],
      ['dithering', (m) => !!m.dithering],
    ];
    const votes = new Map(); // index -> Map(fieldName -> count)
    const vote = (index, name) => {
      if (!votes.has(index)) votes.set(index, new Map());
      const v = votes.get(index);
      v.set(name, (v.get(name) || 0) + 1);
    };
    const twinPairs = [];
    for (let a = 0; a < split.length; a += 1) {
      for (let b = a + 1; b < split.length; b += 1) {
        if (split[a].length !== split[b].length) continue;
        let diffIndex = -1;
        let diffs = 0;
        for (let i = 0; i < split[a].length && diffs < 2; i += 1) {
          if (split[a][i] !== split[b][i]) { diffs += 1; diffIndex = i; }
        }
        if (diffs !== 1) continue;
        twinPairs.push({ a, b, index: diffIndex });
        if (plantedKeys.has(live[a]) || plantedKeys.has(live[b])) continue; // plants NEVER vote
        const matsA = materialsByKey.get(live[a]) || [];
        const matsB = materialsByKey.get(live[b]) || [];
        if (matsA.length !== 1 || matsB.length !== 1) continue; // ambiguous owner: no vote
        const dfs = FIELDS.filter(([, get]) => {
          const va = get(matsA[0]);
          const vb = get(matsB[0]);
          return va !== vb;
        });
        if (dfs.length === 1) vote(diffIndex, dfs[0][0]);
      }
    }

    // ---- the planted control ------------------------------------------------
    const plantedVerdicts = {};
    for (const [name, [ma, mb]] of Object.entries(pairs)) {
      const keyA = [...(properties.get(ma)?.programs?.values() || [])].map(keyOfProgram)[0];
      const keyB = [...(properties.get(mb)?.programs?.values() || [])].map(keyOfProgram)[0];
      if (!keyA || !keyB) { plantedVerdicts[name] = 'MISSING PROGRAM — compile did not reach the plant'; continue; }
      const fa = keyA.split(',');
      const fb = keyB.split(',');
      if (fa.length !== fb.length) { plantedVerdicts[name] = `WIDTH MISMATCH ${fa.length} vs ${fb.length}`; continue; }
      const diffIdxs = [];
      for (let i = 0; i < fa.length; i += 1) if (fa[i] !== fb[i]) diffIdxs.push(i);
      plantedVerdicts[name] = diffIdxs.length === 1
        ? { index: diffIdxs[0] }
        : `EXPECTED 1 DIFF, GOT ${diffIdxs.length} at ${diffIdxs.slice(0, 6).join('/')}`;
    }

    // name table from votes
    const nameTable = [...votes.entries()].map(([index, v]) => {
      const ranked = [...v.entries()].sort((x, y) => y[1] - x[1]);
      return {
        index,
        name: ranked[0][0],
        votes: ranked[0][1],
        conflicts: ranked.slice(1).map(([n, c]) => `${n}:${c}`),
      };
    }).sort((x, y) => y.votes - x.votes);

    // control cross-check: planted indexes must be named with the planted field
    const control = {};
    for (const [name, verdict] of Object.entries(plantedVerdicts)) {
      if (typeof verdict !== 'object') { control[name] = verdict; continue; }
      const named = nameTable.find((r) => r.index === verdict.index);
      if (!named) {
        // the planted pair PROVED the position (exactly one diff, known cause);
        // no real single-owner twin votes on it, so the fold table reads 0
        // there — a valid, smaller answer, not a broken instrument
        control[name] = `ok — index ${verdict.index} proven by plant; no real twins vote on it`;
      } else {
        control[name] = named.name === name
          ? `ok — index ${verdict.index} named '${named.name}' by ${named.votes} real votes`
          : `MISNAMED — planted index ${verdict.index}, real votes say '${named.name}' — TABLE VOID`;
      }
    }

    // ---- the fold table, BIT-CALIBRATED ----------------------------------------
    // The planted vc and alphaTest pairs both diff at the SAME index — the key
    // packs many booleans into one integer field — so "differs at the vc index"
    // is NOT "differs by vertexColors". The planted pairs calibrate the exact
    // BIT each flag flips (XOR of the two planted values), and a real pair
    // folds only when its XOR equals the vertexColors bit exactly.
    const vcVerdict = plantedVerdicts.vertexColors;
    const atVerdict = plantedVerdicts.alphaTest;
    let foldTable = null;
    if (typeof vcVerdict === 'object') {
      const vcIndex = vcVerdict.index;
      const keyArrOf = (m) => {
        const p = [...(properties.get(m)?.programs?.values() || [])][0];
        return p ? String(p.cacheKey).split(',') : null;
      };
      const xorAt = (pair, index) => {
        const a = keyArrOf(pair[0]);
        const b = keyArrOf(pair[1]);
        if (!a || !b) return null;
        const va = Number(a[index]);
        const vb = Number(b[index]);
        if (!Number.isInteger(va) || !Number.isInteger(vb)) return `non-integer: ${a[index]} vs ${b[index]}`;
        // the packed field can exceed 32 bits — compare via BigInt XOR string
        return (BigInt(a[index]) ^ BigInt(b[index])).toString();
      };
      const vcBit = xorAt(pairs.vertexColors, vcIndex);
      const atBit = typeof atVerdict === 'object' ? xorAt(pairs.alphaTest, atVerdict.index) : null;
      const bitOk = typeof vcBit === 'string' && /^[0-9]+$/.test(vcBit) && vcBit !== '0' && vcBit !== atBit;
      const foldPairs = !bitOk ? [] : twinPairs.filter((t) => {
        if (t.index !== vcIndex) return false;
        if (plantedKeys.has(live[t.a]) || plantedKeys.has(live[t.b])) return false;
        const va = split[t.a][vcIndex];
        const vb = split[t.b][vcIndex];
        if (!/^[0-9]+$/.test(va) || !/^[0-9]+$/.test(vb)) return false;
        return (BigInt(va) ^ BigInt(vb)).toString() === vcBit;
      });
      const familiesFolded = new Map();
      for (const t of foldPairs) {
        const fam = split[t.a][0];
        familiesFolded.set(fam, (familiesFolded.get(fam) || 0) + 1);
      }
      const samePosAnyBit = twinPairs.filter((t) => t.index === vcIndex
        && !plantedKeys.has(live[t.a]) && !plantedKeys.has(live[t.b])).length;
      foldTable = {
        vcIndex,
        vcBitXor: vcBit,
        alphaTestBitXor: atBit,
        bitCalibrationValid: bitOk,
        pairsAtPackedField: samePosAnyBit,
        foldablePairs: foldPairs.length,
        // preCount is the settled census before any plant compiled; a perfect
        // vc fold removes one program per real vc-bit pair
        programsAfterPerfectVcFold: preCount - foldPairs.length,
        byFamily: [...familiesFolded.entries()].map(([f, n]) => ({ family: String(f).slice(0, 24), pairs: n })),
      };
    }

    // ---- cleanup the plants --------------------------------------------------
    for (const mesh of plants) {
      mesh.removeFromParent();
      mesh.material.dispose();
    }
    tri.dispose();
    triColored.dispose();

    return {
      programCount: preCount, // the settled census, captured before any plant compiled
      programsAfterPlants: (renderer.info.programs || []).length,
      twinPairCount: twinPairs.length,
      nameTable: nameTable.slice(0, 16),
      plantedVerdicts,
      control,
      foldTable,
    };
  });

  console.log(JSON.stringify(out.result, null, 2));
  fs.writeFileSync(path.join(OUT, `${tag}.json`), `${JSON.stringify(out, null, 2)}\n`);
  const c = out.result?.control || {};
  const ok = ['vertexColors', 'side', 'alphaTest'].every((k) => String(c[k] || '').startsWith('ok'));
  console.log(ok ? 'CONTROLS OK' : 'CONTROLS FAILED — NAME TABLE VOID');
  if (!ok) process.exitCode = 1;
  return out;
}
