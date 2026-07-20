import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || 'qa/cash-register-production/final');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function roundCents(value) {
  return Math.round(Number(value || 0) * 100);
}

function webmTracks(file) {
  const bytes = fs.readFileSync(file);
  assert(bytes.length > 4 && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])),
    `${file} is not an EBML/WebM file.`);
  const text = bytes.toString('latin1');
  return {
    ebml: true,
    vp8: text.includes('V_VP8'),
    vp9: text.includes('V_VP9'),
    opus: text.includes('A_OPUS'),
  };
}

function validateMode(mode) {
  const modeRoot = path.join(root, mode);
  const resultFile = path.join(modeRoot, 'latest-result.json');
  assert(fs.existsSync(resultFile), `${mode}: missing latest-result.json.`);
  const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
  assert(result.ok === true, `${mode}: acceptance result is not ok:true.`);
  assert(result.mode === mode, `${mode}: manifest mode is ${result.mode}.`);
  assert(Array.isArray(result.products) && result.products.length === 3,
    `${mode}: final route must contain exactly three products.`);

  const before = result.beforeBooks;
  const final = result.final;
  const ticket = final?.books?.lastTicket;
  assert(before && final && ticket, `${mode}: exact-once book snapshots are incomplete.`);
  assert(final.tx == null && final.active === false, `${mode}: register did not return to idle.`);
  assert(final.books.units === before.units + 3, `${mode}: units were not booked exactly once.`);
  assert(final.books.history === before.history + 1, `${mode}: history was not booked exactly once.`);
  assert(final.books.held === before.held, `${mode}: held stock did not return to baseline.`);
  assert(ticket.customer === result.customer && ticket.method === mode && ticket.items === 3,
    `${mode}: final ticket identity/method/item count is wrong.`);
  assert(roundCents(final.books.revenue - before.revenue) === roundCents(ticket.total),
    `${mode}: revenue delta is not exactly one ticket total.`);
  assert(Array.isArray(final.queue) && !final.queue.some((entry) => entry.name === result.customer),
    `${mode}: served customer remains in the checkout queue.`);
  for (const skuId of result.products) {
    assert(final.books.shelf[skuId] === Math.max(before.shelf[skuId], 12) - 1,
      `${mode}: ${skuId} shelf stock is not the asserted fixture-adjusted exact-once value.`);
  }

  assert(result.console?.errors?.length === 0, `${mode}: console/page errors were recorded.`);
  assert(result.console?.pageErrors?.length === 0, `${mode}: page errors were recorded.`);
  assert(result.console?.nonAbortedFailedRequests?.length === 0,
    `${mode}: non-aborted request failures were recorded.`);

  const capture = result.audioVideoCapture;
  assert(capture?.requested === true, `${mode}: named audio/video capture was not requested.`);
  assert(capture.audioTracks > 0 && capture.videoTracks > 0,
    `${mode}: named capture is missing an audio or video track.`);
  assert(capture.audioContextState === 'running', `${mode}: WebAudio was not running.`);
  assert(capture.nonSilentAudioWindows > 0 && capture.audioPeak > 0.0001,
    `${mode}: named capture did not prove non-silent game audio.`);
  assert(capture.downloaded === true && capture.bytes > 0 && capture.bytesOnDisk > 0,
    `${mode}: named capture was not downloaded as a nonempty file.`);
  const namedFile = path.resolve(capture.output);
  assert(namedFile === path.join(modeRoot, 'video', `${mode}-with-audio.webm`),
    `${mode}: named capture path does not match the canonical final path.`);
  assert(fs.existsSync(namedFile), `${mode}: named capture is missing on disk.`);
  assert(fs.statSync(namedFile).size === capture.bytesOnDisk,
    `${mode}: named capture byte count differs from the manifest.`);
  const namedTracks = webmTracks(namedFile);
  assert(namedTracks.opus && (namedTracks.vp8 || namedTracks.vp9),
    `${mode}: named capture does not contain Opus plus VP8/VP9 track identifiers.`);

  const videoRoot = path.join(modeRoot, 'video');
  const contextVideos = fs.readdirSync(videoRoot)
    .filter((name) => /^page@.*\.webm$/i.test(name));
  assert(contextVideos.length === 1,
    `${mode}: expected exactly one clean Playwright context video, found ${contextVideos.length}.`);
  const contextFile = path.join(videoRoot, contextVideos[0]);
  const contextTracks = webmTracks(contextFile);
  assert(contextTracks.vp8 || contextTracks.vp9,
    `${mode}: Playwright context recording has no VP8/VP9 track identifier.`);

  return {
    mode,
    customer: result.customer,
    products: result.products,
    ticket,
    revenueDelta: Number((final.books.revenue - before.revenue).toFixed(2)),
    unitsDelta: final.books.units - before.units,
    historyDelta: final.books.history - before.history,
    heldDelta: final.books.held - before.held,
    queueAfter: final.queue,
    diagnostics: {
      errors: result.console.errors.length,
      pageErrors: result.console.pageErrors.length,
      nonAbortedFailedRequests: result.console.nonAbortedFailedRequests.length,
    },
    namedCapture: {
      path: namedFile,
      bytes: capture.bytesOnDisk,
      mimeType: capture.mimeType,
      audioTracks: capture.audioTracks,
      videoTracks: capture.videoTracks,
      nonSilentAudioWindows: capture.nonSilentAudioWindows,
      audioPeak: capture.audioPeak,
      tracks: namedTracks,
    },
    playwrightVideo: {
      path: contextFile,
      bytes: fs.statSync(contextFile).size,
      tracks: contextTracks,
    },
  };
}

const validation = {
  generatedAt: new Date().toISOString(),
  root,
  modes: [validateMode('card'), validateMode('cash')],
};
const output = path.join(root, 'FINAL_ACCEPTANCE_VALIDATION.json');
fs.writeFileSync(output, `${JSON.stringify(validation, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ ok: true, output, modes: validation.modes }, null, 2)}\n`);
