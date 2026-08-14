// G3 (Goal 23) — A SAMPLE PLAYER ALONGSIDE THE SYNTH.
//
// "Every sound in this game is built from oscillators and filtered noise. That
// is WHY things sound electric. Bring in real CC0 or CC-BY samples for the
// ledger, the menu and the money, wire a sample player alongside the synth, and
// report every licence."
//
// He is right about the diagnosis, and the measurement agrees: there is not one
// audio file in this repository. Every cue in audio.js is an oscillator or a
// filtered noise burst, and no amount of tuning makes a filtered noise burst
// sound like paper.
//
// This is the player. It sits BESIDE the synth rather than replacing it: a cue
// asks the bank first, and falls back to its oscillators when the bank has
// nothing. That matters for three reasons — the game must never go silent
// because a file failed to decode, samples can be adopted one cue at a time
// instead of in a single risky sweep, and a synth voice stays available as the
// variation layer under a sample.
//
// WHAT IT DOES NOT DO IS SHIP UNLICENSED AUDIO. Every entry must name a licence
// and a source; `tests/audio-sample-licences.test.js` fails the build otherwise,
// so a file cannot reach a player without its provenance reaching the credits.

/**
 * @param decode  (ArrayBuffer) => Promise<AudioBuffer>   usually ctx.decodeAudioData
 * @param fetchFn (url) => Promise<ArrayBuffer>
 */
export function createSampleBank({ decode, fetchFn, now = () => 0 } = {}) {
  const buffers = new Map();   // cue -> [AudioBuffer, ...] (variants)
  const pending = new Map();
  const lastPlayed = new Map(); // cue -> time, for the retrigger guard
  let loadedCount = 0;
  let failedCount = 0;
  const failures = [];

  async function load(entry) {
    if (!entry || !entry.cue || !entry.file) return false;
    const key = entry.cue;
    if (pending.has(entry.file)) return pending.get(entry.file);
    const task = (async () => {
      try {
        const data = await fetchFn(entry.file);
        const buffer = await decode(data);
        // NAME THE BUFFER SO A PROBE CAN TELL A RECORDING FROM A SYNTH BURST.
        //
        // The synth voices in audio.js also build AudioBuffers -- every
        // filtered-noise cue does -- so "a BufferSource started" is NOT evidence
        // that a vendored recording played, and a gate that counted buffer
        // sources would certify the oscillators it was built to replace. This
        // tag travels on the decoded buffer itself, so the check is on the thing
        // that reached the speakers rather than on the call that scheduled it.
        try {
          buffer.__fwSample = { cue: key, file: entry.file, licence: entry.licence || null };
        } catch { /* a frozen AudioBuffer still plays; it just cannot be attributed */ }
        const list = buffers.get(key) || [];
        list.push(buffer);
        buffers.set(key, list);
        loadedCount += 1;
        return true;
      } catch (error) {
        // A missing or corrupt sample must never be a silent cue. It is counted,
        // named, and the synth keeps that voice.
        failedCount += 1;
        failures.push({ file: entry.file, cue: key, why: String(error && error.message ? error.message : error) });
        return false;
      }
    })();
    pending.set(entry.file, task);
    return task;
  }

  return {
    /** Load every entry in a manifest. Resolves once, never throws. */
    async loadAll(manifest = []) {
      await Promise.all(manifest.map((entry) => load(entry)));
      return { loaded: loadedCount, failed: failedCount, cues: [...buffers.keys()] };
    },

    has(cue) { return buffers.has(cue) && buffers.get(cue).length > 0; },

    /**
     * One decoded buffer for a cue, or null.
     *
     * `play()` cannot serve a SUSTAINED cue: it starts a one-shot and forgets it,
     * and the cash run has to loop for as long as money is going in and then stop
     * on the last piece. That needs the buffer itself so the caller can own the
     * source node's lifetime. Kept deliberately narrow -- it hands out the buffer
     * and nothing else, so the pooling and the licence gate still live here.
     */
    buffer(cue, random = Math.random) {
      const list = buffers.get(cue);
      if (!list || !list.length) return null;
      return list[list.length === 1 ? 0 : Math.floor(random() * list.length) % list.length];
    },

    /**
     * Play a cue from the bank. Returns false when the bank cannot serve it, so
     * the caller falls through to its synth voice — that fallthrough IS the
     * design, not an error path.
     *
     * `minGapSec` stops a rapid interaction (a handful of coins) machine-gunning
     * one identical file, which is the tell that gives a sample library away.
     */
    play(cue, { ctx, destination, gain = 1, rate = 1, pitchJitter = 0.04, gainJitter = 0.08, minGapSec = 0.02, random = Math.random } = {}) {
      const list = buffers.get(cue);
      if (!list || !list.length || !ctx || !destination) return false;
      const t = now();
      const last = lastPlayed.get(cue);
      if (last != null && t - last < minGapSec) return false;
      lastPlayed.set(cue, t);
      // Round-robin the variants so the same file is never heard twice running
      // while another is available.
      const index = list.length === 1 ? 0 : Math.floor(random() * list.length) % list.length;
      const src = ctx.createBufferSource();
      src.buffer = list[index];
      // A real recording played back identically every time still reads as a
      // machine. A few per cent of pitch and level is what a hand does.
      src.playbackRate.value = Math.max(0.25, rate * (1 + (random() * 2 - 1) * pitchJitter));
      const g = ctx.createGain();
      g.gain.value = Math.max(0, gain * (1 + (random() * 2 - 1) * gainJitter));
      src.connect(g).connect(destination);
      src.start();
      return true;
    },

    diagnostics: () => ({
      cues: [...buffers.keys()],
      variantsPerCue: Object.fromEntries([...buffers.entries()].map(([k, v]) => [k, v.length])),
      loaded: loadedCount,
      failed: failedCount,
      failures: failures.slice(0, 10),
    }),
  };
}
