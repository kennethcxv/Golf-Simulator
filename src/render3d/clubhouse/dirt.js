// ART-DIRECTED DIRT — the neglect you can remove. The floor canvas paints
// layered, placed grime (an entry mud fan, footprint trails down the real
// traffic paths, dust banked along walls and under fixtures, corner buildup,
// scuffs at the counter, a couple of old spills) — every element is owned by
// one 13×8 grime-grid cell and fades exactly as the vacuum clears that cell.
// The glass carries a wipeable film per pane (shop.reno.windows).
//
// No uniform circles. No dirt the player can't remove.

import * as THREE from 'three';
import { INTERIOR, FIXTURES, TRAFFIC_PATHS, DOOR_MAIN, COUNTER, MAT, STOCKROOM } from '../../data/shopLayout.js';
import { RENO, wipeWindow } from '../../sim/shop.js';
import { tutorialFlag } from '../../sim/tutorial.js';

const hash01 = (n) => {
  const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
};

export function buildDirt(B, windowDefs) {
  const { interior, state, addProp, L2W, hooks } = B;

  const W = 1024;
  const H = 640;
  const grimeCanvas = document.createElement('canvas');
  grimeCanvas.width = W;
  grimeCanvas.height = H;
  const grimeTex = new THREE.CanvasTexture(grimeCanvas);
  grimeTex.colorSpace = THREE.SRGBColorSpace;
  grimeTex.anisotropy = 8;
  const grimePlane = new THREE.Mesh(
    new THREE.PlaneGeometry(INTERIOR.w, INTERIOR.d),
    new THREE.MeshStandardMaterial({ map: grimeTex, transparent: true, depthWrite: false, roughness: 1 }),
  );
  grimePlane.rotation.x = -Math.PI / 2;
  grimePlane.position.y = 0.026; // above the rugs: neglect sits ON everything (ref 2)
  grimePlane.renderOrder = 3;
  interior.add(grimePlane);

  // local yards → canvas px ((-w/2,-d/2) top-left; +z south is canvas DOWN)
  const px = (x) => ((x + INTERIOR.w / 2) / INTERIOR.w) * W;
  const py = (z) => ((z + INTERIOR.d / 2) / INTERIOR.d) * H;
  const sx = W / INTERIOR.w; // px per yard
  const cellOf = (x, z) => {
    const cx = Math.floor(((x + INTERIOR.w / 2) / INTERIOR.w) * RENO.grid.w);
    const cy = Math.floor(((z + INTERIOR.d / 2) / INTERIOR.d) * RENO.grid.h);
    if (cx < 0 || cx >= RENO.grid.w || cy < 0 || cy >= RENO.grid.h) return -1;
    return cy * RENO.grid.w + cx;
  };

  // ---- the static art-direction plan: computed once, drawn per repaint ----
  // element: { cell, draw(ctx, strength) }
  const plan = [];
  const MUD = '56, 38, 22';
  const DUST = '112, 101, 82';
  const DARK = '48, 38, 26';

  function blot(x, z, r, rgb, alpha, squashZ = 1) {
    const cell = cellOf(x, z);
    if (cell < 0) return;
    plan.push({
      cell,
      draw(ctx, s) {
        const a = alpha * s;
        if (a <= 0.004) return;
        const R = r * sx;
        const g = ctx.createRadialGradient(px(x), py(z), R * 0.1, px(x), py(z), R);
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

  function footprint(x, z, angle, rgb, alpha) {
    const cell = cellOf(x, z);
    if (cell < 0) return;
    plan.push({
      cell,
      draw(ctx, s) {
        const a = alpha * s;
        if (a <= 0.004) return;
        ctx.save();
        ctx.translate(px(x), py(z));
        ctx.rotate(-angle); // canvas y-down vs plan z-north flip
        ctx.fillStyle = `rgba(${rgb}, ${a.toFixed(3)})`;
        // sole + heel
        ctx.beginPath();
        ctx.ellipse(0, -4.6, 4.6, 8.8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(0, 8.6, 3.8, 4.4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      },
    });
  }

  function buildPlan() {
    // 1) entry mud fan: heavy splotching just inside the door, thinning north
    for (let i = 0; i < 46; i++) {
      const t = hash01(i * 3.7);
      const spread = 0.5 + t * 2.6;
      const x = DOOR_MAIN.x + (hash01(i * 7.1) - 0.5) * (1.2 + spread * 0.9);
      const z = 6.1 - t * 3.4;
      blot(x, z, 0.36 + hash01(i * 5.3) * 0.42, MUD, 0.52 * (1 - t * 0.6), 0.8);
    }
    // mat halo: the mat catches most of it — grime rings just past its edge
    for (let i = 0; i < 10; i++) {
      const a = hash01(i * 9.7) * Math.PI * 2;
      blot(MAT.x + Math.sin(a) * 1.15, MAT.z - 0.3 + Math.cos(a) * 0.7, 0.32, MUD, 0.34);
    }

    // 2) footprint trails along the real traffic routes
    TRAFFIC_PATHS.forEach((path, pi) => {
      let total = 0;
      const segs = [];
      for (let s = 0; s < path.length - 1; s++) {
        const dx = path[s + 1].x - path[s].x;
        const dz = path[s + 1].z - path[s].z;
        const len = Math.hypot(dx, dz);
        segs.push({ a: path[s], dx, dz, len });
        total += len;
      }
      let walked = 0;
      let stepFlip = 0;
      for (const seg of segs) {
        const steps = Math.max(1, Math.floor(seg.len / 0.44));
        for (let i = 0; i < steps; i++) {
          const t = i / steps;
          const along = walked + seg.len * t;
          const fade = pi === 0 ? 1 - (along / total) * 0.72 : 0.55; // the door trail bleeds out
          const dirX = seg.dx / seg.len;
          const dirZ = seg.dz / seg.len;
          const side = (stepFlip++ % 2 === 0 ? 1 : -1) * 0.1;
          const x = seg.a.x + seg.dx * t - dirZ * side + (hash01(pi * 91 + i * 7) - 0.5) * 0.08;
          const z = seg.a.z + seg.dz * t + dirX * side + (hash01(pi * 47 + i * 3) - 0.5) * 0.08;
          const ang = Math.atan2(dirX, -dirZ);
          const rgb = along < 5.2 && pi === 0 ? MUD : DUST;
          footprint(x, z, ang, rgb, (pi === 0 ? 0.58 : 0.4) * fade);
        }
        walked += seg.len;
      }
    });

    // 3) dust banked along the walls (skip doorways)
    const bank = (x0, z0, x1, z1, n) => {
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const x = x0 + (x1 - x0) * t;
        const z = z0 + (z1 - z0) * t;
        if (Math.abs(x - DOOR_MAIN.x) < 1.4 && z > 5.6) continue;
        blot(x, z, 0.44 + hash01(i * 13.7 + x) * 0.24, DUST, 0.32);
      }
    };
    const hw = INTERIOR.w / 2 - 0.24;
    const hd = INTERIOR.d / 2 - 0.24;
    bank(-hw, -hd, hw, -hd, 30);
    bank(-hw, hd, hw, hd, 30);
    bank(-hw, -hd, -hw, hd, 20);
    bank(hw, -hd, hw, hd, 20);
    bank(STOCKROOM.bounds.minX, -hd, STOCKROOM.bounds.minX, 1.8, 12); // partition line

    // 4) grime shadows under every fixture footprint
    for (const f of FIXTURES) {
      for (let i = 0; i < 5; i++) {
        const ox = (hash01(f.x * 13 + i) - 0.5) * 1.6;
        const oz = (hash01(f.z * 17 + i) - 0.5) * 0.8;
        blot(f.x + ox, f.z + oz, 0.52, DARK, 0.26, 0.7);
      }
    }

    // 5) corner buildup
    for (const [cx, cz] of [[-hw + 0.3, -hd + 0.3], [hw - 0.3, -hd + 0.3], [-hw + 0.3, hd - 0.3], [hw - 0.3, hd - 0.3], [STOCKROOM.bounds.minX + 0.35, -hd + 0.35], [STOCKROOM.bounds.minX + 0.35, 1.6]]) {
      blot(cx, cz, 0.62, DARK, 0.46);
      blot(cx, cz, 0.34, MUD, 0.34);
    }

    // 6) scuffs where shoes pivot: register front + queue + door threshold
    const scuff = (x, z, n, seedK) => {
      for (let i = 0; i < n; i++) {
        const cell = cellOf(x, z);
        if (cell < 0) continue;
        const a0 = hash01(seedK + i * 3.3) * Math.PI * 2;
        const sxp = x + (hash01(seedK + i * 7.7) - 0.5) * 0.9;
        const szp = z + (hash01(seedK + i * 5.1) - 0.5) * 0.5;
        plan.push({
          cell,
          draw(ctx, s) {
            const a = 0.42 * s;
            if (a <= 0.004) return;
            ctx.strokeStyle = `rgba(${DARK}, ${a.toFixed(3)})`;
            ctx.lineWidth = 2.2;
            ctx.beginPath();
            ctx.arc(px(sxp), py(szp), 7 + hash01(seedK + i) * 8, a0, a0 + 0.9);
            ctx.stroke();
          },
        });
      }
    };
    scuff(COUNTER.registerX, COUNTER.z - 1.1, 8, 31);
    scuff(COUNTER.registerX - 1.6, COUNTER.z - 1.6, 6, 57);
    scuff(DOOR_MAIN.x, 5.7, 7, 83);

    // 7) two old spills in the aisle (ring + darker core, splashed edge)
    for (const [ix, iz, seedK] of [[-1.8, -0.7, 11], [1.2, 1.9, 23]]) {
      const cell = cellOf(ix, iz);
      if (cell >= 0) {
        plan.push({
          cell,
          draw(ctx, s) {
            const a = 0.5 * s;
            if (a <= 0.004) return;
            const R = 0.34 * sx;
            ctx.fillStyle = `rgba(96, 74, 46, ${(a * 0.75).toFixed(3)})`;
            ctx.beginPath();
            ctx.ellipse(px(ix), py(iz), R, R * 0.8, 0.4, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = `rgba(96, 74, 46, ${a.toFixed(3)})`;
            ctx.lineWidth = 2.4;
            ctx.beginPath();
            ctx.ellipse(px(ix), py(iz), R * 1.18, R * 0.95, 0.4, 0, Math.PI * 2);
            ctx.stroke();
            for (let d = 0; d < 7; d++) {
              const a2 = hash01(seedK + d * 3.1) * Math.PI * 2;
              const rr = R * (1.3 + hash01(seedK + d) * 0.5);
              ctx.fillStyle = `rgba(96, 74, 46, ${(a * 0.8).toFixed(3)})`;
              ctx.beginPath();
              ctx.arc(px(ix) + Math.cos(a2) * rr, py(iz) + Math.sin(a2) * rr * 0.8, 2.4, 0, Math.PI * 2);
              ctx.fill();
            }
          },
        });
      }
    }

    // 8) fine speckle so dirty cells never read flat
    for (let cy = 0; cy < RENO.grid.h; cy++) {
      for (let cx = 0; cx < RENO.grid.w; cx++) {
        const cell = cy * RENO.grid.w + cx;
        const cw = INTERIOR.w / RENO.grid.w;
        const cd = INTERIOR.d / RENO.grid.h;
        const bx = -INTERIOR.w / 2 + cx * cw;
        const bz = -INTERIOR.d / 2 + cy * cd;
        plan.push({
          cell,
          draw(ctx, s) {
            const a = 0.44 * s;
            if (a <= 0.006) return;
            for (let i = 0; i < 22; i++) {
              const xx = bx + hash01(cell * 31 + i * 7) * cw;
              const zz = bz + hash01(cell * 17 + i * 5) * cd;
              ctx.fillStyle = `rgba(${i % 3 ? DUST : DARK}, ${(a * (0.35 + hash01(cell + i) * 0.4)).toFixed(3)})`;
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
    if (!reno) {
      grimeTex.needsUpdate = true;
      return;
    }
    for (const el of plan) {
      const s = reno.grime[el.cell] || 0;
      if (s > 0.015) el.draw(ctx, Math.min(1, s * 1.45));
    }
    grimeTex.needsUpdate = true;
  }

  // ---- window film: one wipeable smudge pane per plan window --------------
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
      g.addColorStop(0, `rgba(168, 158, 132, ${0.16 + hash01(i) * 0.2})`);
      g.addColorStop(1, 'rgba(168, 158, 132, 0)');
      fc.fillStyle = g;
      fc.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // a couple of drip streaks
    for (let i = 0; i < 7; i++) {
      const x = hash01(i * 11.3) * 128;
      fc.fillStyle = 'rgba(150, 140, 116, 0.22)';
      fc.fillRect(x, hash01(i * 3.7) * 30, 2.2, 30 + hash01(i) * 40);
    }
  }
  const filmTex = new THREE.CanvasTexture(filmCanvas);
  filmTex.colorSpace = THREE.SRGBColorSpace;

  const films = [];
  windowDefs.forEach((wd, i) => {
    const film = new THREE.Mesh(
      new THREE.PlaneGeometry(wd.w - 0.12, wd.h - 0.12),
      new THREE.MeshStandardMaterial({
        map: filmTex, transparent: true, opacity: 0.75, roughness: 0.9,
        depthWrite: false, side: THREE.DoubleSide,
      }),
    );
    film.position.z = wd.insideSign * 0.045;
    wd.holder.add(film);
    films.push(film);

    // Window work uses the same contextual-tool path as cartons: the first deliberate [E] equips
    // the cloth, then holding [E] blends its authored wipe loop while the film visibly clears.
    // This replaces the old bare-hand tap that changed save state without showing a held tool.
    const local = wd.holder.position; // group-space center of this window
    const wp = L2W(local.x, local.z);
    let wipeClock = 0;
    addProp({
      x: wp.x, z: wp.z, r: 1.7,
      // The north pane shares its footprint with the campaign's window-frame
      // repair marker. Cleaning the glass is that repair's prerequisite, so
      // dirty glass must win a straight-on crosshair tie or progression
      // deadlocks behind the blocked marker.
      focusBias: 2.0,
      tool: 'cloth',
      label: () => {
        const v = state.shop?.reno?.windows?.[i] || 0;
        if (v <= 0) return null; // clean glass: no prompt
        const stage = v > 0.63 ? 'filthy' : v > 0.3 ? 'smeared' : 'almost there';
        return `Window (${stage}) — hold [E] to wipe`;
      },
      hold: (dt) => {
        wipeClock += dt;
        if (wipeClock < 0.34) return;
        wipeClock %= 0.34;
        const res = wipeWindow(state, i);
        if (!res.ok) return;
        refreshFilms();
        if (hooks.sfx) hooks.sfx('wipe');
        if (res.left === 0) {
          tutorialFlag(state, 'windowWiped');
          if (hooks.toast) hooks.toast('The pane comes up clear — real daylight again.');
        }
      },
    });
  });

  function refreshFilms() {
    const w = state.shop?.reno?.windows;
    films.forEach((f, i) => {
      const v = w && typeof w[i] === 'number' ? w[i] : 0;
      f.visible = v > 0.02;
      f.material.opacity = 0.28 + v * 0.55;
    });
    if (B.onWindowDirt) B.onWindowDirt();
  }
  refreshFilms();

  return { repaintGrime, refreshFilms, grimePlane };
}
