// F2 — WHAT SOUNDS EXIST, WHICH ARE LAYERED, WHICH ARE PITCH-VARIED, AND WHICH
// ARE PLACEHOLDERS.
//
// The brief lists the physical events it wants and then asks for two properties
// and one confession: "Layered - start transient, body, tail - and pitch-varied
// so repeats do not grate. Report what you added and which are placeholders."
//
// This reads core/audio.js and answers that as a table rather than a claim.
// Layering is counted as the number of sound SOURCES a voice creates
// (oscillators + noise buffers); pitch variation as whether its frequency or
// detune is a function of Math.random(). Both are structural facts about the
// code, so neither can be fudged by wanting the answer.
import fs from 'node:fs';

const src = fs.readFileSync('src/core/audio.js', 'utf8');

// F2's own list, in its own order.
const WANTED = [
  ['the register drawer', /drawer/i],
  ['coins and notes', /coin|note|cash/i],
  ["the card reader's beep", /beep|reader|card/i],
  ["the card reader's keys", /keypad/i],
  ['entering the cashier', /stationEnter/],
  ['leaving the cashier', /stationLeave/],
  ['footsteps by surface', /footstep/],
  ['the ledger opening', /ledgerOpen/],
  ['the ledger closing', /ledgerClose/],
  ['every page turn', /ledgerTurn|ledgerLeaf/],
  ['doors', /doorSwing|doorbell/],
  ['the sign', /signFlip/],
  ['boxes', /thunk|box/i],
  ["tool contact with a surface", /equipTick|toolLoop|scrub|sweep/i],
];

// Every voice: a top-level function in the module.
const voices = [...src.matchAll(/^  function ([a-zA-Z][a-zA-Z0-9]*)\(/gm)].map((m) => m[1]);
const INFRA = new Set(['applyVolume', 'init', 'qaMasterTap', 'setToolLoop', 'applyPreferences']);

function bodyOf(name) {
  const at = src.indexOf(`  function ${name}(`);
  if (at < 0) return '';
  let depth = 0; let started = false;
  for (let i = at; i < src.length; i += 1) {
    if (src[i] === '{') { depth += 1; started = true; }
    else if (src[i] === '}') {
      depth -= 1;
      if (started && depth === 0) return src.slice(at, i + 1);
    }
  }
  return '';
}

const rows = voices.filter((v) => !INFRA.has(v)).map((name) => {
  const body = bodyOf(name);
  const sources = (body.match(/createOscillator|createBufferSource/g) || []).length;
  const gains = (body.match(/createGain/g) || []).length;
  const randomised = /Math\.random\(\)/.test(body);
  // a tail is an explicit decay ramp rather than an abrupt stop
  const tail = /exponentialRampToValueAtTime|setTargetAtTime|linearRampToValueAtTime/.test(body);
  return { name, sources, gains, layered: sources >= 2, pitchVaried: randomised, tail };
});

console.log('=== F2: EVERY VOICE ===');
console.log('voice'.padEnd(18), 'srcs', 'layered', 'pitch-varied', 'tail');
for (const r of rows) {
  console.log(
    r.name.padEnd(18),
    String(r.sources).padEnd(4),
    (r.layered ? 'yes' : 'NO').padEnd(7),
    (r.pitchVaried ? 'yes' : 'NO').padEnd(12),
    r.tail ? 'yes' : 'NO',
  );
}

console.log('\n=== F2: WHAT THE BRIEF ASKS FOR ===');
const missing = [];
for (const [label, re] of WANTED) {
  const hit = rows.find((r) => re.test(r.name)) || (re.test(src) ? { name: '(inline)' } : null);
  if (!hit) missing.push(label);
  console.log(`${hit ? 'HAVE' : 'MISSING'}  ${label}${hit && hit.name !== '(inline)' ? `  -> ${hit.name}` : ''}`);
}

const layered = rows.filter((r) => r.layered).length;
const varied = rows.filter((r) => r.pitchVaried).length;
console.log(`\nSUMMARY: ${rows.length} voices, ${layered} layered, ${varied} pitch-varied, ${missing.length} of F2's ${WANTED.length} events missing.`);
console.log('EVERY VOICE IS SYNTHESISED - there is not one recorded sample in the game.');
console.log('By any normal reading that makes all of them placeholders.');
fs.mkdirSync('qa/electron/f2-audit', { recursive: true });
fs.writeFileSync('qa/electron/f2-audit/f2.json', `${JSON.stringify({ rows, missing }, null, 2)}\n`);
