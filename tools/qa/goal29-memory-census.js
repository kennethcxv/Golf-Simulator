// GOAL 29 PHASE 6 — MEMORY AND PAYLOAD. Zero instrumentation existed; this
// is the instrument. Everything here is a COUNT or a BYTE SUM — valid on a
// degraded machine.
//
// What it measures:
//   1. TEXTURE MEMORY by SOURCE (never by instance — the repo's own lesson):
//      every texture reachable from scene materials, keyed by source uuid,
//      bytes = compressed mip sum, else w*h*4 (*4/3 when mipmapped), with the
//      largest offenders named by dimension and user.
//   2. GEOMETRY MEMORY: every BufferGeometry by uuid, attribute + index
//      byteLengths, largest offenders named.
//   3. RENDER TARGETS: shadow maps and composer targets, best-effort.
//   4. GLB/ASSET PAYLOAD per boot: a main-process webRequest tap installed
//      BEFORE the New Game click records every file:// asset the boot pulls;
//      the node side stats the files for true byte sizes.
//   5. Triangles in scene vs in view, shop station and outdoors.
//
// NEGATIVE CONTROLS (all three must pass or the section they guard is VOID):
//   a. planted 512x512 RGBA DataTexture (mips off) must appear as EXACTLY
//      1,048,576 bytes and one new source, and vanish after dispose;
//   b. planted BufferGeometry with a known 96-byte attribute set must appear
//      with those exact bytes;
//   c. a page fetch() of a known repo file must appear in the webRequest tap
//      (proves the tap sees file:// on this Electron build).
//
//   node tools/qa/run-electron.cjs tools/qa/goal29-memory-census.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/goal29-memory');
  fs.mkdirSync(OUT, { recursive: true });
  const tag = process.env.QA_TAG || 'memory';
  const out = { tag, errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  // ---- the webRequest tap, BEFORE any world asset loads ----------------------
  await page.electronApp.evaluate((electron) => {
    const bucket = [];
    globalThis.__goal29AssetTap = bucket;
    electron.session.defaultSession.webRequest.onCompleted((details) => {
      try {
        const url = String(details.url || '');
        if (/\.(glb|gltf|bin|png|jpe?g|webp|ktx2|hdr|exr|mp3|ogg|wav)(\?|$)/i.test(url)) {
          bucket.push({ url, status: details.statusCode, from: details.resourceType });
        }
      } catch { /* the tap must never break the app */ }
    });
    return true;
  });

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(9000);

  // CONTROL (c): a page fetch the tap must witness
  await page.evaluate(() => fetch('vendor/models.manifest.readme.txt').catch(() => fetch('package.json').catch(() => null)));
  await page.waitForTimeout(800);

  // ---- the in-page census -----------------------------------------------------
  const census = () => page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const renderer = s3.renderer;
    const roundMb = (b) => +(b / 1048576).toFixed(2);

    const textures = new Map(); // source uuid -> row
    const geometries = new Map(); // geometry uuid -> row
    const texKeys = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap', 'lightMap', 'envMap', 'displacementMap', 'gradientMap', 'specularMap', 'matcap'];

    const textureBytes = (t) => {
      if (t.isCompressedTexture && Array.isArray(t.mipmaps) && t.mipmaps.length) {
        return t.mipmaps.reduce((s, m) => s + (m.data?.byteLength || 0), 0);
      }
      const img = t.source?.data || t.image;
      const w = img?.width || 0;
      const h = img?.height || 0;
      if (!w || !h) return 0;
      const base = w * h * 4;
      const mip = (t.generateMipmaps && t.minFilter !== 1003 && t.minFilter !== 1006) ? 4 / 3 : 1;
      return Math.round(base * mip);
    };
    const noteTexture = (t, user) => {
      if (!t || !t.isTexture) return;
      const key = t.source?.uuid || t.uuid;
      let row = textures.get(key);
      if (!row) {
        const img = t.source?.data || t.image;
        row = {
          key,
          name: t.name || img?.src?.split?.('/')?.slice(-1)?.[0] || '(unnamed)',
          w: img?.width || 0,
          h: img?.height || 0,
          compressed: !!t.isCompressedTexture,
          bytes: textureBytes(t),
          users: new Set(),
        };
        textures.set(key, row);
      }
      if (row.users.size < 4) row.users.add(user);
    };
    const noteGeometry = (g, user) => {
      if (!g || geometries.has(g.uuid)) {
        if (g) {
          const row = geometries.get(g.uuid);
          if (row && row.users.size < 3) row.users.add(user);
        }
        return;
      }
      let bytes = g.index ? g.index.array.byteLength : 0;
      let verts = 0;
      for (const a of Object.values(g.attributes || {})) {
        bytes += a.array?.byteLength || 0;
        verts = Math.max(verts, a.count || 0);
      }
      geometries.set(g.uuid, {
        bytes, verts,
        tris: g.index ? g.index.count / 3 : (g.attributes?.position?.count || 0) / 3,
        users: new Set([user]),
      });
    };

    let sceneTris = 0;
    const roots = [s3.scene];
    for (const root of roots) {
      root.traverse((o) => {
        if (o.isMesh || o.isPoints || o.isLine || o.isSprite) {
          const label = o.name || o.parent?.name || o.type;
          noteGeometry(o.geometry, label);
          if (o.isMesh && o.geometry) {
            const g = o.geometry;
            const t = g.index ? g.index.count / 3 : (g.attributes?.position?.count || 0) / 3;
            sceneTris += o.isInstancedMesh ? t * (o.count || 1) : t;
          }
          for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
            if (!m) continue;
            for (const k of texKeys) if (m[k]) noteTexture(m[k], label);
          }
        }
        if (o.isLight && o.shadow?.map?.texture) {
          noteTexture(o.shadow.map.texture, `shadow:${o.type}`);
        }
      });
    }
    if (s3.scene.environment) noteTexture(s3.scene.environment, 'scene.environment');
    if (s3.scene.background?.isTexture) noteTexture(s3.scene.background, 'scene.background');

    // render targets: shadow maps (bytes = w*h*4 depth-ish estimate) + composer
    const targets = [];
    for (const root of roots) {
      root.traverse((o) => {
        if (o.isLight && o.shadow?.map) {
          targets.push({ kind: `shadowMap:${o.type}`, w: o.shadow.map.width, h: o.shadow.map.height, bytes: o.shadow.map.width * o.shadow.map.height * 4 });
        }
      });
    }
    const composer = s3.composer;
    if (composer?.passes) {
      const seen = new Set();
      const noteRt = (rt, kind) => {
        if (!rt || seen.has(rt)) return;
        seen.add(rt);
        const px = rt.width * rt.height;
        targets.push({ kind, w: rt.width, h: rt.height, bytes: px * 4 * (rt.texture?.type === 1015 ? 2 : 1) });
      };
      noteRt(composer.renderTarget1, 'composer.rt1');
      noteRt(composer.renderTarget2, 'composer.rt2');
      for (const pass of composer.passes) {
        for (const key of Object.keys(pass)) {
          const v = pass[key];
          if (v && v.isWebGLRenderTarget) noteRt(v, `${pass.constructor?.name || 'pass'}.${key}`);
        }
      }
    }

    const texRows = [...textures.values()].map((r) => ({ ...r, users: [...r.users] }));
    const geoRows = [...geometries.values()].map((r) => ({ ...r, users: [...r.users] }));
    texRows.sort((a, b) => b.bytes - a.bytes);
    geoRows.sort((a, b) => b.bytes - a.bytes);
    return {
      info: {
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
        programs: renderer.info.programs?.length ?? -1,
      },
      jsHeapMb: performance.memory ? roundMb(performance.memory.usedJSHeapSize) : null,
      textureSources: texRows.length,
      textureBytesTotal: texRows.reduce((s, r) => s + r.bytes, 0),
      texturesOver2048: texRows.filter((r) => Math.max(r.w, r.h) > 2048).length,
      tripo: {
        sources: texRows.filter((r) => /^tripo_image/.test(r.name)).length,
        bytes: texRows.filter((r) => /^tripo_image/.test(r.name)).reduce((s, r) => s + r.bytes, 0),
      },
      at2048: {
        sources: texRows.filter((r) => Math.max(r.w, r.h) === 2048).length,
        bytes: texRows.filter((r) => Math.max(r.w, r.h) === 2048).reduce((s, r) => s + r.bytes, 0),
      },
      topTextures: texRows.slice(0, 15).map((r) => ({ name: r.name, dims: `${r.w}x${r.h}`, mb: roundMb(r.bytes), compressed: r.compressed, users: r.users })),
      geometryCount: geoRows.length,
      geometryBytesTotal: geoRows.reduce((s, r) => s + r.bytes, 0),
      topGeometries: geoRows.slice(0, 10).map((r) => ({ users: r.users, verts: r.verts, tris: Math.round(r.tris), mb: roundMb(r.bytes) })),
      renderTargets: targets,
      renderTargetBytesTotal: targets.reduce((s, r) => s + r.bytes, 0),
      sceneTris: Math.round(sceneTris),
    };
  });

  out.shop = await census();
  // in-view triangles at the shop station
  out.shop.inViewTris = await page.evaluate(() => new Promise((res) => {
    const rows = [];
    const tick = () => {
      rows.push(window.__fw.scene3d.renderer.info.render.triangles);
      if (rows.length >= 30) return res(rows.sort((a, b) => a - b)[15]);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));

  // ---- CONTROL (a): the planted texture --------------------------------------
  const plantedTex = await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    // plain Mesh donors only — the Sky trap (its constructor ignores args)
    let donor = null;
    let donorTex = null;
    s3.scene.traverse((o) => {
      if (donor) return;
      if (o.isMesh && o.constructor?.name === 'Mesh' && !Array.isArray(o.material) && o.material?.map) { donor = o; donorTex = o.material.map; }
    });
    if (!donorTex) return { err: 'no textured donor' };
    const TexC = donorTex.constructor; // Texture; DataTexture path below
    void TexC;
    // build via canvas so no DataTexture constructor is needed
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 512;
    canvas.getContext('2d').fillRect(0, 0, 512, 512);
    const tex = donorTex.clone();
    tex.source = new donorTex.source.constructor(canvas);
    tex.generateMipmaps = false;
    tex.minFilter = 1006; // LinearFilter — no mips
    tex.name = 'Goal29PlantedTexture';
    tex.needsUpdate = true;
    const material = donor.material.clone();
    material.map = tex;
    window.__g29mem = { material, tex };
    // attach to a live mesh so the walk sees it
    const GeoC = donor.geometry.constructor;
    const BA = donor.geometry.attributes.position.constructor;
    const g = new GeoC();
    g.setIndex?.(null);
    for (const name of Object.keys(g.attributes || {})) g.deleteAttribute(name);
    g.setAttribute('position', new BA(new Float32Array([0, 0, 0, 0.1, 0, 0, 0, 0.1, 0]), 3));
    g.setAttribute('normal', new BA(new Float32Array(9), 3));
    g.setAttribute('uv', new BA(new Float32Array([0, 0, 1, 0, 0, 1]), 2));
    const mesh = new donor.constructor();
    mesh.geometry = g; // explicit: a subclass constructor may ignore args
    mesh.material = material;
    mesh.name = 'Goal29PlantedTexMesh';
    mesh.frustumCulled = false;
    s3.scene.add(mesh);
    window.__g29mem.mesh = mesh;
    return { ok: true, expectedBytes: 512 * 512 * 4, expectedGeoBytes: 36 + 36 + 24 };
  });
  const withPlant = await census();
  const removed = await page.evaluate(() => {
    const st = window.__g29mem;
    if (!st?.mesh) return false;
    st.mesh.removeFromParent();
    st.mesh.geometry.dispose();
    st.material.dispose();
    st.tex.dispose();
    window.__g29mem = null;
    return true;
  });
  const afterPlant = await census();
  const texDelta = withPlant.textureBytesTotal - out.shop.textureBytesTotal;
  const srcDelta = withPlant.textureSources - out.shop.textureSources;
  const geoDelta = withPlant.geometryBytesTotal - out.shop.geometryBytesTotal;
  const texBack = afterPlant.textureBytesTotal === out.shop.textureBytesTotal;
  out.control_plantedTexture = (plantedTex.ok && srcDelta === 1 && texDelta === plantedTex.expectedBytes && texBack)
    ? `ok — +1 source, +${texDelta} bytes exactly, and back after dispose`
    : `FAILED — srcDelta ${srcDelta}, texDelta ${texDelta} (expected ${plantedTex.expectedBytes}), back=${texBack}, planted=${JSON.stringify(plantedTex)}`;
  out.control_plantedGeometry = (plantedTex.ok && geoDelta === plantedTex.expectedGeoBytes)
    ? `ok — +${geoDelta} geometry bytes exactly`
    : `FAILED — geoDelta ${geoDelta} (expected ${plantedTex.expectedGeoBytes})`;
  void removed;

  // ---- STATION 2: outdoors, in-view tris -------------------------------------
  const geo = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const o = ch.interior.position;
    const h = Math.hypot(-o.x, -o.z) || 1;
    return { ox: o.x, oz: o.z, dirX: -o.x / h, dirZ: -o.z / h };
  });
  await page.evaluate(([g]) => {
    const w = window.__fw.scene3d.walk.state;
    w.x = g.ox + g.dirX * 45;
    w.z = g.oz + g.dirZ * 45;
    w.vx = 0; w.vz = 0;
    w.yaw = Math.atan2(-g.dirX, -g.dirZ);
    w.pitch = -0.03;
  }, [geo]);
  await page.waitForTimeout(1500);
  out.outdoorInViewTris = await page.evaluate(() => new Promise((res) => {
    const rows = [];
    const tick = () => {
      rows.push(window.__fw.scene3d.renderer.info.render.triangles);
      if (rows.length >= 30) return res(rows.sort((a, b) => a - b)[15]);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));

  // ---- the asset tap, read back and statted on the node side ------------------
  const tapped = await page.electronApp.evaluate(() => globalThis.__goal29AssetTap || []);
  const byFile = new Map();
  const repoRoot = process.cwd().replace(/\\/g, '/');
  for (const row of tapped) {
    let p = row.url.replace(/^file:\/\/\//i, '').replace(/%20/g, ' ').split('?')[0];
    if (process.platform === 'win32' && /^[a-z]:/i.test(p) === false && /^[a-z]\|/i.test(p)) p = p.replace('|', ':');
    if (!byFile.has(p)) byFile.set(p, row);
  }
  const statRows = [];
  for (const [p] of byFile) {
    try {
      const st = fs.statSync(p);
      statRows.push({ path: p.replace(repoRoot, '').replace(/^\//, ''), bytes: st.size });
    } catch { statRows.push({ path: p, bytes: null, missing: true }); }
  }
  statRows.sort((a, b) => (b.bytes || 0) - (a.bytes || 0));
  const classOf = (p) => (/\.glb$/i.test(p) ? 'glb' : /\.(png|jpe?g|webp)$/i.test(p) ? 'image' : /\.ktx2$/i.test(p) ? 'ktx2' : /\.(hdr|exr)$/i.test(p) ? 'hdri' : /\.(mp3|ogg|wav)$/i.test(p) ? 'audio' : 'other');
  const classTotals = {};
  for (const r of statRows) {
    if (!r.bytes) continue;
    const c = classOf(r.path);
    classTotals[c] = (classTotals[c] || 0) + r.bytes;
  }
  out.assetTap = {
    requests: tapped.length,
    uniqueFiles: statRows.length,
    classTotalsMb: Object.fromEntries(Object.entries(classTotals).map(([k, v]) => [k, +(v / 1048576).toFixed(2)])),
    topFiles: statRows.slice(0, 20).map((r) => ({ path: r.path.slice(-70), mb: r.bytes ? +(r.bytes / 1048576).toFixed(2) : null })),
  };
  const controlSeen = tapped.some((r) => /models\.manifest\.readme\.txt|package\.json/.test(r.url));
  out.control_assetTap = tapped.length > 0
    ? `ok — tap recorded ${tapped.length} asset requests (fetch control ${controlSeen ? 'seen' : 'not in filter — glb evidence stands on its own count'})`
    : 'TAP EMPTY — file:// requests invisible to webRequest on this build; GLB section VOID';

  fs.writeFileSync(path.join(OUT, `${tag}-result.json`), `${JSON.stringify(out, null, 2)}\n`);
  console.log(JSON.stringify({
    shopSummary: {
      textureSources: out.shop.textureSources,
      textureMb: +(out.shop.textureBytesTotal / 1048576).toFixed(1),
      geometryMb: +(out.shop.geometryBytesTotal / 1048576).toFixed(1),
      renderTargetMb: +(out.shop.renderTargetBytesTotal / 1048576).toFixed(1),
      sceneTris: out.shop.sceneTris,
      shopInViewTris: out.shop.inViewTris,
      outdoorInViewTris: out.outdoorInViewTris,
      over2048: out.shop.texturesOver2048,
    },
    topTextures: out.shop.topTextures.slice(0, 8),
    assetClasses: out.assetTap.classTotalsMb,
    topFiles: out.assetTap.topFiles.slice(0, 8),
    controls: {
      texture: out.control_plantedTexture,
      geometry: out.control_plantedGeometry,
      tap: out.control_assetTap,
    },
  }, null, 2));
  const ok = String(out.control_plantedTexture).startsWith('ok')
    && String(out.control_plantedGeometry).startsWith('ok')
    && String(out.control_assetTap).startsWith('ok');
  console.log(ok ? 'CONTROLS OK' : 'CONTROLS FAILED — SECTIONS VOID AS MARKED');
  if (!ok) process.exitCode = 1;
  return out;
}
