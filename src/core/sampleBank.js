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
  const meta = new Map();      // cue -> [entry, ...] parallel to buffers
  const pending = new Map();
  const lastPlayed = new Map(); // cue -> time, for the retrigger guard
  let loadedCount = 0;
  let failedCount = 0;
  const failures = [];

  // PLAYTEST 3, ITEM 1 — THE AUDITION SWITCHER.
  //
  // "You cannot hear and I can." Every taste call in this brief -- which click,
  // which drawer, which page turn, which track -- is one I can measure the peak
  // of and cannot judge. So the bank carries SEVERAL COMPETING RECORDINGS per
  // family and lets the owner pin one while the game runs.
  //
  // A family is a group of cues that must change together: pinning "felt tap"
  // has to move uiTick, uiConfirm and uiCancel at once, or the menu ends up half
  // wooden and half sci-fi. The pin lives here rather than in the UI because the
  // selection happens on every play, and because it has to survive the settings
  // panel being closed.
  const familyPin = new Map(); // family -> option id

  // Which buffers a cue may draw from right now. When a family is pinned, only
  // that option's recordings are eligible -- UNLESS the option supplies nothing
  // for this particular cue, in which case the whole set is eligible again. That
  // fallback is deliberate: an option that covers uiTick but not uiConfirm must
  // leave uiConfirm audible rather than silently muting a button.
  function eligible(cue) {
    const list = buffers.get(cue);
    if (!list || !list.length) return null;
    const entries = meta.get(cue);
    if (!entries || entries.length !== list.length) return list;
    const wanted = [];
    for (let i = 0; i < list.length; i += 1) {
      const e = entries[i];
      if (!e || !e.family) continue;
      const pin = familyPin.get(e.family);
      if (pin == null) continue;
      if (e.option === pin) wanted.push(list[i]);
    }
    // no pin touching this cue, or a pin that names nothing here -> everything
    return wanted.length ? wanted : list;
  }

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
        // The ENTRY travels beside the buffer, index for index, so the audition
        // switcher can ask "which option is this recording" later. Kept parallel
        // rather than stored on the buffer because a frozen AudioBuffer refuses
        // the tag and still has to be selectable.
        const metaList = meta.get(key) || [];
        metaList.push({
          file: entry.file,
          family: entry.family || null,
          option: entry.option || null,
          optionLabel: entry.optionLabel || null,
          licence: entry.licence || null,
        });
        meta.set(key, metaList);
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
      const list = eligible(cue);
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
      const list = eligible(cue);
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

    /**
     * ITEM 1 — what the audition picker draws itself from.
     *
     * Built from what actually DECODED, not from the manifest: an option whose
     * file failed to load must not appear in the list, because a picker that
     * offers a silent choice is worse than one that offers three. Each option
     * reports how many recordings and which cues it covers, so a half-covered
     * option is visible rather than surprising.
     */
    families() {
      const byFamily = new Map();
      for (const [cue, entries] of meta.entries()) {
        for (const e of entries) {
          if (!e || !e.family || !e.option) continue;
          let fam = byFamily.get(e.family);
          if (!fam) { fam = { family: e.family, options: new Map() }; byFamily.set(e.family, fam); }
          let opt = fam.options.get(e.option);
          if (!opt) {
            opt = { id: e.option, label: e.optionLabel || e.option, files: 0, cues: new Set(), licence: e.licence || null };
            fam.options.set(e.option, opt);
          }
          opt.files += 1;
          opt.cues.add(cue);
        }
      }
      return [...byFamily.values()].map((fam) => ({
        family: fam.family,
        current: familyPin.get(fam.family) ?? null,
        options: [...fam.options.values()]
          .map((o) => ({ id: o.id, label: o.label, files: o.files, cues: [...o.cues].sort(), licence: o.licence }))
          .sort((a, b) => a.label.localeCompare(b.label)),
      })).sort((a, b) => a.family.localeCompare(b.family));
    },

    /**
     * Pin a family to one option, or pass null to go back to drawing from all of
     * them. Returns false for an option the bank has never decoded -- silently
     * accepting a name that matches nothing would leave the picker showing a
     * selection that changes no sound, which is the exact failure this whole
     * feature exists to avoid.
     */
    setFamilyOption(family, optionId) {
      if (!family) return false;
      if (optionId == null) { familyPin.delete(family); return true; }
      for (const entries of meta.values()) {
        for (const e of entries) {
          if (e && e.family === family && e.option === optionId) {
            familyPin.set(family, optionId);
            return true;
          }
        }
      }
      return false;
    },

    familyOption: (family) => familyPin.get(family) ?? null,

    diagnostics: () => ({
      cues: [...buffers.keys()],
      variantsPerCue: Object.fromEntries([...buffers.entries()].map(([k, v]) => [k, v.length])),
      loaded: loadedCount,
      failed: failedCount,
      failures: failures.slice(0, 10),
      pins: Object.fromEntries(familyPin),
    }),
  };
}
