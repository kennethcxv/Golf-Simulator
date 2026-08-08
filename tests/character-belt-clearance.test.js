import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// H3 (Goal 17) — SKIN MUST NOT PASS THROUGH THE BELT, ON ANY BODY, IN ANY POSE.
//
// This is checkable without rendering anything, because the failure was static:
// the shirt was wider than the belt standing still. Two separate causes, and a
// check that only knew about one would have passed the broken build.
//
//   1. RADIUS. The belt meets the torso lathe at local y -0.015 (belt y 1.055,
//      chest group y 1.07). The profile interpolates to 0.2026 there. The belt's
//      mid radius was 0.2015 - already 1.1 mm inside the shirt.
//   2. SEGMENT COUNT. A cylinder is a polygon; between vertices its surface is
//      at r * cos(pi/n). At 18 segments against the torso's 24, the belt's real
//      surface on its flats was 0.1984 - 4.2 mm inside the shirt.
//
// So the test compares the belt's INSCRIBED radius against the torso's
// CIRCUMSCRIBED radius at the meeting height. Comparing nominal radii would
// miss cause 2 entirely.

const src = fs.readFileSync(new URL('../src/render3d/characterAsset.js', import.meta.url), 'utf8');

function beltGeometry() {
  const m = /new THREE\.CylinderGeometry\(([\d.]+), ([\d.]+), [\d.]+, (\d+)\), mBelt\)/.exec(src);
  if (!m) return null;
  return { top: Number(m[1]), bottom: Number(m[2]), segments: Number(m[3]) };
}

function torsoProfile() {
  const block = /new THREE\.LatheGeometry\(\[([\s\S]*?)\], (\d+)\)/.exec(src);
  if (!block) return null;
  const pts = [...block[1].matchAll(/new THREE\.Vector2\(([-\d.]+), ([-\d.]+)\)/g)]
    .map((p) => ({ r: Number(p[1]), y: Number(p[2]) }));
  return { pts, segments: Number(block[2]) };
}

// the belt's centre in the torso lathe's own local space
const MEET_Y = 1.055 - 1.07;

test('the belt and the torso are both findable with their segment counts', () => {
  assert.ok(beltGeometry(), 'belt cylinder found');
  assert.ok(torsoProfile()?.pts.length > 2, 'torso lathe profile found');
});

test('the belt is not a coarser polygon than the body it wraps', () => {
  // A finer belt is fine; a coarser one puts its flats inside the shirt.
  assert.ok(beltGeometry().segments >= torsoProfile().segments,
    `belt has ${beltGeometry().segments} segments against the torso's ${torsoProfile().segments}`);
});

test('the belt clears the shirt where the two actually meet', () => {
  const belt = beltGeometry();
  const torso = torsoProfile();
  // torso radius at the meeting height, linearly interpolated
  let torsoR = null;
  for (let i = 1; i < torso.pts.length; i += 1) {
    const a = torso.pts[i - 1]; const b = torso.pts[i];
    if (MEET_Y >= a.y && MEET_Y <= b.y) {
      const t = (MEET_Y - a.y) / (b.y - a.y);
      torsoR = a.r + t * (b.r - a.r);
      break;
    }
  }
  assert.ok(torsoR != null, 'the belt height falls inside the torso profile');
  // the shirt's widest point between its own vertices is its nominal radius
  const shirtOuter = torsoR;
  // the belt's NARROWEST point is between its vertices
  const beltMid = (belt.top + belt.bottom) / 2;
  const beltInscribed = beltMid * Math.cos(Math.PI / belt.segments);
  assert.ok(
    beltInscribed > shirtOuter,
    `belt inscribed radius ${beltInscribed.toFixed(4)} must exceed shirt radius ${shirtOuter.toFixed(4)} at the meeting height`,
  );
});
