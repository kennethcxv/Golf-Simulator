// ART-DIRECTED SHED GRIME — the neglect layer for the maintenance-shed test
// scene. A single transparent floor canvas paints layered, PLACED grime (an
// entry grit fan spilling in from the doorway, an oil-darkened patch at the
// centre, a shadow band of muck along the workbench front, heavy corner
// buildup, scuffed traffic between the door, bench and shelving, and a fine
// speckle so no dirty cell reads flat) plus a wipeable film per shed window.
//
// Every floor element is OWNED by one cell of the clubhouse's 13x8 grime grid
// (src/sim/shop.js RENO) and fades exactly as that cell clears — the same
// ownership mapping cleanGrimeAt / maskShedGrime use, replicated here so this
// renderer never has to import a sim internal. The shed occupies a sub-rect of
// the full grid (cx 4..8, cy 2..5), so only those seeded cells carry art.
//
// This is the shed's authored before-state: canvas paint, not geometry. No
// later pass replaces it. No uniform circles; no dirt the player cannot remove.

import * as THREE from 'three';
import { RENO } from '../../sim/shop.js';
import { SHED_ROOM, insideShedRoom } from '../../data/shedLayout.js';

const hash01 = (n) => {
  const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
};

export function buildShedDirt(B, windowDefs) {
  const { interior, state } = B;

  const W = 512;
  const H = 384;
  const grimeCanvas = document.createElement('canvas');
  grimeCanvas.width = W;
  grimeCanvas.height = H;
  const grimeTex = new THREE.CanvasTexture(grimeCanvas);
  grimeTex.colorSpace = THREE.SRGBColorSpace;
  grimeTex.anisotropy = 8;
  const grimePlane = new THREE.Mesh(
    new THREE.PlaneGeometry(SHED_ROOM.w, SHED_ROOM.d),
    new THREE.MeshStandardMaterial({ map: grimeTex, transparent: true, depthWrite: false, roughness: 1 }),
  );
  grimePlane.rotation.x = -Math.PI / 2;
  grimePlane.position.y = 0.026; // neglect sits ON the concrete (mirrors dirt.js)
  grimePlane.renderOrder = 3;
  grimePlane.name = 'ShedDirtGrimePlane'; // whitelisted: startsWith('ShedDirt')
  interior.add(grimePlane);

  // local yards -> canvas px. Origin at room centre; +z south is canvas DOWN,
  // exactly like dirt.js's plane, but scaled to the shed's own clear span.
  const px = (x) => ((x + SHED_ROOM.w / 2) / SHED_ROOM.w) * W;
  const py = (z) => ((z + SHED_ROOM.d / 2) / SHED_ROOM.d) * H;
  const sx = W / SHED_ROOM.w; // px per yard

  // cell ownership: the FLOOR-mapped inverse of maskShedGrime's cell-centre
  // walk (src/sim/shedScene.js) / cleanGrimeAt (src/sim/shop.js), computed over
  // the FULL RENO.room grid. A shed point maps to the seeded cell that fades it.
  const cellOf = (x, z) => {
    const cx = Math.floor(((x + RENO.room.w / 2) / RENO.room.w) * RENO.grid.w);
    const cy = Math.floor(((z + RENO.room.d / 2) / RENO.room.d) * RENO.grid.h);
    if (cx < 0 || cx >= RENO.grid.w || cy < 0 || cy >= RENO.grid.h) return -1;
    return cy * RENO.grid.w + cx;
  };

  // ---- the static art-direction plan: computed once, drawn per repaint ----
  // element: { cell, draw(ctx, strength) }
  const plan = [];
  const GRIT = '74, 64, 50';   // ground-in grey-brown grit
  const OIL = '34, 30, 26';    // oil-dark
  // Settled dust — Task-6: darkened from the old pale 120,112,96 to sit JUST BELOW the (raised)
  // clean-floor albedo, so removing the speckle/haze BRIGHTENS the floor instead of dulling it
  // (the pale value was lighter than the floor, which fought the clean payoff). Still above GRIT.
  const DUST = '92, 86, 74';

  function blot(x, z, r, rgb, alpha, squashZ = 1) {
    const cell = cellOf(x, z);
    if (cell < 0) return;
    plan.push({
      cell,
      draw(ctx, s) {
        const a = alpha * s;
        if (a <= 0.004) return;
        const R = r * sx;
        const g = ctx.createRadialGradient(px(x), py(z), R * 0.12, px(x), py(z), R);
        g.addColorStop(0, `rgba(${rgb}, ${a.toFixed(3)})`);
        g.addColorStop(1, `rgba(${rgb}, 0)`);
        ctx.save();
        ctx.translate(px(x), py(z));
        ctx.scale(1, squashZ);
        ctx.translate(-px(x), -py(z));
        ctx.fillStyle = g;
        ctx.fillRect(px(x) - R, py(z) - R, R * 2, R * 2);
        ctx.restore();
      },
    });
  }

  // a smeared boot scuff: short curved stroke where a sole dragged
  function scuff(x, z, seedK, n = 5) {
    for (let i = 0; i < n; i++) {
      const cell = cellOf(x, z);
      if (cell < 0) continue;
      const a0 = hash01(seedK + i * 3.3) * Math.PI * 2;
      const sxp = x + (hash01(seedK + i * 7.7) - 0.5) * 0.7;
      const szp = z + (hash01(seedK + i * 5.1) - 0.5) * 0.45;
      plan.push({
        cell,
        draw(ctx, s) {
          const a = 0.4 * s;
          if (a <= 0.004) return;
          ctx.strokeStyle = `rgba(${OIL}, ${a.toFixed(3)})`;
          ctx.lineWidth = 2.4;
          ctx.beginPath();
          ctx.arc(px(sxp), py(szp), 6 + hash01(seedK + i) * 7, a0, a0 + 0.9);
          ctx.stroke();
        },
      });
    }
  }

  function buildPlan() {
    // 1) entry grit fan: heaviest just inside the open doorway (x 1.2, z 3.03),
    //    thinning as it spreads NORTH into the room. Kept z < 2.75 so every
    //    grain lands on a seeded cell (the threshold strip carries no grime cell).
    for (let i = 0; i < 34; i++) {
      const t = hash01(i * 3.7);
      const spread = 0.4 + t * 2.1;
      const x = 1.2 + (hash01(i * 7.1) - 0.5) * (1.1 + spread);
      const z = 2.66 - t * 1.7;
      blot(x, z, 0.3 + hash01(i * 5.3) * 0.36, GRIT, 0.5 * (1 - t * 0.55), 0.85);
    }

    // 2) central oil-darkened patch, harmonising with the floor:oil-patch target
    //    (contact pose 0.6, 0.2). A dark ring + core with a splashed halo.
    {
      const ix = 0.6;
      const iz = 0.2;
      const cell = cellOf(ix, iz);
      if (cell >= 0) {
        plan.push({
          cell,
          draw(ctx, s) {
            const a = 0.6 * s;
            if (a <= 0.004) return;
            const R = 0.5 * sx;
            ctx.fillStyle = `rgba(${OIL}, ${(a * 0.7).toFixed(3)})`;
            ctx.beginPath();
            ctx.ellipse(px(ix), py(iz), R, R * 0.82, 0.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = `rgba(${OIL}, ${a.toFixed(3)})`;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.ellipse(px(ix), py(iz), R * 1.16, R * 0.94, 0.5, 0, Math.PI * 2);
            ctx.stroke();
            for (let d = 0; d < 9; d++) {
              const a2 = hash01(41 + d * 3.1) * Math.PI * 2;
              const rr = R * (1.25 + hash01(41 + d) * 0.55);
              ctx.fillStyle = `rgba(${OIL}, ${(a * 0.72).toFixed(3)})`;
              ctx.beginPath();
              ctx.arc(px(ix) + Math.cos(a2) * rr, py(iz) + Math.sin(a2) * rr * 0.8, 2.6, 0, Math.PI * 2);
              ctx.fill();
            }
          },
        });
      }
    }

    // 3) bench-shadow grime band along the workbench front (x -0.4, z -2.0..-2.5):
    //    where swept-up dust and dropped filings bank against the base.
    for (let i = 0; i < 18; i++) {
      const t = (i + 0.5) / 18;
      const x = -2.35 + t * 3.9;         // spans the 4.6-yd bench footprint
      const z = -2.02 - hash01(i * 9.3) * 0.5;
      blot(x, z, 0.34 + hash01(i * 4.1) * 0.2, GRIT, 0.34, 0.6);
      if (i % 3 === 0) blot(x, z + 0.08, 0.24, OIL, 0.22, 0.6);
    }

    // 4) corner buildup at the four dirty-region corners; heaviest NW/NE (the
    //    -z side, under the cobwebs). Positions pulled inboard to land on the
    //    outermost seeded cells (cx 4/8, cy 2/5).
    const corners = [
      [-3.0, -2.4, 0.62], [3.0, -2.4, 0.62], // NW / NE — heaviest
      [-3.0, 2.35, 0.42], [3.0, 2.35, 0.42], // SW / SE
    ];
    for (const [cx, cz, heavy] of corners) {
      blot(cx, cz, 0.66, OIL, heavy * 0.7);
      blot(cx, cz, 0.42, GRIT, heavy);
      blot(cx, cz, 0.9, DUST, heavy * 0.4, 0.8);
    }

    // 5) scuffed traffic between the door and the two work stations (bench NW,
    //    shelving W): the paths feet actually wear, dragged into curved smears.
    const trail = (ax, az, bx, bz, seed) => {
      const steps = 6;
      for (let i = 1; i <= steps; i++) {
        const t = i / (steps + 1);
        const x = ax + (bx - ax) * t + (hash01(seed + i * 2.3) - 0.5) * 0.2;
        const z = az + (bz - az) * t + (hash01(seed + i * 5.7) - 0.5) * 0.2;
        scuff(x, z, seed + i * 13, 3);
        blot(x, z, 0.4, DUST, 0.2);
      }
    };
    trail(1.2, 2.5, -0.4, -1.7, 101);  // door -> workbench
    trail(1.2, 2.4, -2.9, -0.2, 211);  // door -> shelving

    // 6) fine speckle so every seeded cell reads gritty, not flat. Only cells
    //    whose centre falls inside the shed footprint carry it (the rest are 0).
    const cw = RENO.room.w / RENO.grid.w;
    const cd = RENO.room.d / RENO.grid.h;
    for (let cy = 0; cy < RENO.grid.h; cy++) {
      for (let cx = 0; cx < RENO.grid.w; cx++) {
        const centreX = -RENO.room.w / 2 + (cx + 0.5) * cw;
        const centreZ = -RENO.room.d / 2 + (cy + 0.5) * cd;
        if (!insideShedRoom(centreX, centreZ)) continue;
        const cell = cy * RENO.grid.w + cx;
        const bx = centreX - cw / 2;
        const bz = centreZ - cd / 2;
        plan.push({
          cell,
          draw(ctx, s) {
            const a = 0.42 * s;
            if (a <= 0.006) return;
            for (let i = 0; i < 20; i++) {
              const xx = bx + hash01(cell * 31 + i * 7) * cw;
              const zz = bz + hash01(cell * 17 + i * 5) * cd;
              ctx.fillStyle = `rgba(${i % 3 ? DUST : GRIT}, ${(a * (0.35 + hash01(cell + i) * 0.4)).toFixed(3)})`;
              ctx.fillRect(px(xx), py(zz), 2, 1.6);
            }
          },
        });
      }
    }
  }
  buildPlan();

  function repaintGrime() {
    const reno = state.shop && state.shop.reno;
    const ctx = grimeCanvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    if (!reno || !Array.isArray(reno.grime)) {
      grimeTex.needsUpdate = true;
      return;
    }
    for (const el of plan) {
      const strength = reno.grime[el.cell] || 0;
      if (strength > 0.015) el.draw(ctx, Math.min(1, strength * 1.45));
    }
    grimeTex.needsUpdate = true;
  }

  // ---- window film: one wipeable smudge pane per shed window --------------
  const filmCanvas = document.createElement('canvas');
  filmCanvas.width = 128;
  filmCanvas.height = 96;
  {
    const fc = filmCanvas.getContext('2d');
    for (let i = 0; i < 90; i++) {
      const x = hash01(i * 3.1) * 128;
      const y = hash01(i * 7.7) * 96;
      const r = 6 + hash01(i * 5.3) * 22;
      const g = fc.createRadialGradient(x, y, 1, x, y, r);
      g.addColorStop(0, `rgba(150, 142, 120, ${0.18 + hash01(i) * 0.22})`);
      g.addColorStop(1, 'rgba(150, 142, 120, 0)');
      fc.fillStyle = g;
      fc.fillRect(x - r, y - r, r * 2, r * 2);
    }
    for (let i = 0; i < 7; i++) {
      const x = hash01(i * 11.3) * 128;
      fc.fillStyle = 'rgba(134, 126, 104, 0.24)';
      fc.fillRect(x, hash01(i * 3.7) * 30, 2.2, 30 + hash01(i) * 40);
    }
  }
  const filmTex = new THREE.CanvasTexture(filmCanvas);
  filmTex.colorSpace = THREE.SRGBColorSpace;

  const films = [];
  (windowDefs || []).forEach((wd, i) => {
    const film = new THREE.Mesh(
      new THREE.PlaneGeometry(wd.w - 0.12, wd.h - 0.12),
      new THREE.MeshStandardMaterial({
        map: filmTex, transparent: true, opacity: 0.8, roughness: 0.9,
        depthWrite: false, side: THREE.DoubleSide,
      }),
    );
    film.name = `ShedDirtWindowFilm_${i}`; // under the shell holder (always visible)
    film.position.z = wd.insideSign * 0.045;
    wd.holder.add(film);
    films.push(film);
  });

  function refreshFilms() {
    const w = state.shop?.reno?.windows;
    films.forEach((f, i) => {
      const v = w && typeof w[i] === 'number' ? w[i] : 0;
      f.visible = v > 0.02;
      f.material.opacity = 0.22 + v * 0.72; // hazy at 0.85/0.78, clear as it drains
    });
    if (B.onWindowDirt) B.onWindowDirt();
  }

  repaintGrime();
  refreshFilms();

  function dispose() {
    grimePlane.removeFromParent();
    grimePlane.geometry.dispose();
    grimePlane.material.dispose();
    grimeTex.dispose();
    for (const f of films) {
      f.removeFromParent();
      f.geometry.dispose();
      f.material.dispose();
    }
    filmTex.dispose();
    return { films: films.length };
  }

  return { repaintGrime, refreshFilms, grimePlane, dispose };
}
