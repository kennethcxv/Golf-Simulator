// G (Goal 21) — MERGE TRANSLATED KEYS INTO src/core/i18n.js.
//
// Input:  qa/i18n/<locale>.json   flat { key: "translated string" }
// Effect: each key is inserted into that locale's table, before its closing
//         brace, in the order English defines them.
//
// Guards, because a locale table is the kind of file where a silent mistake
// ships to nine languages at once:
//   * a key already present is SKIPPED, never overwritten
//   * a value whose placeholders differ from English is REFUSED, named, and the
//     merge aborts. {name} silently becoming {nombre} is untestable at runtime
//     and shows up as a literal brace in the player's face.
//   * an em dash is REFUSED. The suite fails the build on one, and finding out
//     from the suite is slower than finding out here.
//   * tables are rewritten from the LAST one backwards so earlier line numbers
//     stay valid as the file grows.
//
//   node tools/merge-locale-json.mjs            # all locales found in qa/i18n
//   node tools/merge-locale-json.mjs es fr      # only these
import fs from 'node:fs';

const FILE = 'src/core/i18n.js';
const DIR = 'qa/i18n';
const TABLE_OF = {
  es: 'ES', fr: 'FR', de: 'DE', 'pt-BR': 'PT_BR', ru: 'RU',
  'zh-Hans': 'ZH_HANS', ja: 'JA', ko: 'KO', tr: 'TR',
};

const wanted = process.argv.slice(2);
const locales = Object.keys(TABLE_OF)
  .filter((l) => (wanted.length ? wanted.includes(l) : true))
  .filter((l) => fs.existsSync(`${DIR}/${l}.json`));
if (!locales.length) { console.error(`No locale JSON in ${DIR}`); process.exit(2); }

const raw = fs.readFileSync(FILE, 'utf8');
const EOL = raw.includes('\r\n') ? '\r\n' : '\n';
let lines = raw.split(/\r?\n/);

const placeholders = (s) => (String(s).match(/\{[a-zA-Z0-9_]+\}/g) || []).sort().join(',');

// English source, for the placeholder contract and for key order
const enStart = lines.findIndex((l) => /^const EN = Object\.freeze\(\{/.test(l));
const enEnd = lines.findIndex((l, i) => i > enStart && /^\}\);/.test(l));
const EN = {};
const EN_ORDER = [];
for (let i = enStart + 1; i < enEnd; i += 1) {
  const m = lines[i].match(/^\s*'([^']+)':\s*(.*?),?\s*$/);
  if (m) { EN[m[1]] = m[2]; EN_ORDER.push(m[1]); }
}

// last table first, so the line numbers above each edit stay put
const plan = locales
  .map((locale) => {
    const name = TABLE_OF[locale];
    const start = lines.findIndex((l) => new RegExp(`^const ${name} = Object\\.freeze\\(\\{`).test(l));
    if (start < 0) throw new Error(`table ${name} not found`);
    const end = lines.findIndex((l, i) => i > start && /^\}\);/.test(l));
    return { locale, name, start, end };
  })
  .sort((a, b) => b.start - a.start);

const refusals = [];
let inserted = 0;
for (const entry of plan) {
  const table = JSON.parse(fs.readFileSync(`${DIR}/${entry.locale}.json`, 'utf8'));
  const existing = new Set();
  for (let i = entry.start + 1; i < entry.end; i += 1) {
    const m = lines[i].match(/^\s*'([^']+)':/);
    if (m) existing.add(m[1]);
  }
  const add = [];
  for (const key of EN_ORDER) {
    if (existing.has(key) || !(key in table)) continue;
    const value = String(table[key]);
    if (value.includes('—')) {
      refusals.push(`${entry.locale} ${key}: em dash`);
      continue;
    }
    const enValue = EN[key] || '';
    if (placeholders(enValue) !== placeholders(JSON.stringify(value))) {
      refusals.push(`${entry.locale} ${key}: placeholders ${placeholders(enValue)} -> ${placeholders(JSON.stringify(value))}`);
      continue;
    }
    add.push(`  '${key}': ${JSON.stringify(value)},`);
  }
  if (add.length) {
    lines.splice(entry.end, 0, ...add);
    inserted += add.length;
  }
  console.log(`${entry.locale.padEnd(8)} +${String(add.length).padStart(3)} keys`);
}

if (refusals.length) {
  console.error(`\nREFUSED ${refusals.length} value(s); nothing written:`);
  for (const r of refusals.slice(0, 25)) console.error(`  ${r}`);
  process.exit(3);
}

fs.writeFileSync(FILE, lines.join(EOL));
console.log(`\ninserted ${inserted} keys into ${FILE}`);
