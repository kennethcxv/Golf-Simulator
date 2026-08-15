// 9.5, THE STRANGER'S FINDING 14 — "'Recover any missing AUTHORED workstation'
// — dev jargon in player UI."
//
// They were right, and there were two of them, not one: the same word was also
// in "a non-movable object still blocks the AUTHORED safe layout". Fixing the
// instance they happened to screenshot would leave the other one sitting there
// for the next stranger.
//
// So this catches the CLASS. `authored`, `collider`, `raycast` and the rest are
// words that mean something precise to whoever wrote this repo and nothing at
// all to somebody who just bought a golf game. They are perfectly fine in a
// comment, in a variable name, in a QA driver, in a log line — the objection is
// specifically to putting them in front of a player.
//
// It scans the strings a player is actually shown: the `reason:` and `label:`
// literals in the campaign objectives, which are rendered verbatim into the
// objectives panel.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Words that name an implementation, not a thing in the world. Deliberately
// short and specific: a list that also banned "stock" or "state" would ban the
// game's own vocabulary and get itself weakened the first time it fired.
const JARGON = [
  'authored', 'collider', 'raycast', 'navmesh', 'viewmodel', 'mesh ', 'GLB',
  'boolean', 'null', 'undefined', 'callback', 'refactor', 'instanced',
  'serialize', 'deserialize', 'enum', 'nullable',
];

// `reason:` and `label:` string literals, which is what the objectives panel
// prints. A template literal is skipped -- its player-facing half is assembled
// elsewhere and this would only see the parts.
const PLAYER_STRING = /\b(?:reason|label|title|hint|message)\s*:\s*'((?:[^'\\]|\\.)*)'/g;

const FILES = [
  'src/sim/campaign.js',
];

test('no implementation jargon in the strings a player is shown', () => {
  const offences = [];
  for (const rel of FILES) {
    const text = readFileSync(join(root, rel), 'utf8');
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
      // a comment is not player copy -- this file's own explanation uses several
      // of these words and banning them there would be absurd
      if (/^\s*(\/\/|\*)/.test(line)) return;
      let m;
      PLAYER_STRING.lastIndex = 0;
      // eslint-disable-next-line no-cond-assign
      while ((m = PLAYER_STRING.exec(line)) !== null) {
        const value = m[1];
        for (const word of JARGON) {
          if (value.toLowerCase().includes(word.toLowerCase())) {
            offences.push(`${rel}:${i + 1} "${value.slice(0, 90)}" contains "${word.trim()}"`);
          }
        }
      }
    });
  }
  assert.deepEqual(offences, [],
    `player-facing copy must not name the implementation:\n  ${offences.join('\n  ')}`);
});
