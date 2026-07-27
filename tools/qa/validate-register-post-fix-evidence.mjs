import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Usage:
//   node tools/qa/validate-register-post-fix-evidence.mjs qa/cash-register-production/pass-1
//
// The argument is the named visual-pass root. Evidence is read from its post-fix/
// child and the PASS/FAIL artifact is always written back into that child.

export const VALIDATION_FILE = 'POST_FIX_EVIDENCE_VALIDATION.json';

export const EXPECTED_STAGE_LABELS = Object.freeze({
  card: Object.freeze([
    'customer-approach',
    'customer-placing-products',
    'three-products-ready',
    'cashier-camera',
    'first-product-barcode-visible',
    'first-product-scan-light',
    'all-products-scanned-and-staged',
    'card-payment-presented',
    'card-swipe-ready',
    'physical-card-mid-swipe',
    'card-processing',
    'card-approved',
    'receipt-emerging-from-printer',
    'receipt-printed',
    'receipt-inside-bag',
    'first-product-entering-bag',
    'all-products-and-receipt-bagged',
    'filled-bag-offered-to-customer',
    'customer-accepts-bag',
    'customer-leaving',
  ]),
  cash: Object.freeze([
    'customer-approach',
    'customer-placing-products',
    'three-products-ready',
    'cashier-camera',
    'first-product-barcode-visible',
    'first-product-scan-light',
    'all-products-scanned-and-staged',
    'cash-payment-presented',
    'cash-taken',
    'cash-drawer-open',
    'all-cash-deposited',
    'physical-coin-selected',
    'correct-change-selected',
    'change-cash-in-motion-to-customer',
    'change-handed-drawer-closing',
    'receipt-emerging-from-printer',
    'receipt-printed',
    'receipt-inside-bag',
    'first-product-entering-bag',
    'all-products-and-receipt-bagged',
    'filled-bag-offered-to-customer',
    'customer-accepts-bag',
    'customer-leaving',
  ]),
});

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBM_SIGNATURE = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function roundCents(value) {
  return Math.round(Number(value) * 100);
}

function walkFiles(root) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(file);
      else if (entry.isFile()) files.push(file);
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

function fileHasPrefix(file, prefix) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  const fd = fs.openSync(file, 'r');
  try {
    const bytes = Buffer.alloc(prefix.length);
    return fs.readSync(fd, bytes, 0, bytes.length, 0) === bytes.length && bytes.equals(prefix);
  } finally {
    fs.closeSync(fd);
  }
}

function webmTracks(file) {
  if (!fileHasPrefix(file, WEBM_SIGNATURE)) return { ebml: false, vp8: false, vp9: false, opus: false };
  const text = fs.readFileSync(file).toString('latin1');
  return {
    ebml: true,
    vp8: text.includes('V_VP8'),
    vp9: text.includes('V_VP9'),
    opus: text.includes('A_OPUS'),
  };
}

function makeRecorder(scope) {
  const checks = [];
  const errors = [];
  const check = (id, condition, message, details = undefined) => {
    const item = { id: `${scope}.${id}`, ok: !!condition };
    if (!condition) {
      item.message = message;
      if (details !== undefined) item.details = details;
      errors.push({ id: item.id, message, ...(details === undefined ? {} : { details }) });
    }
    checks.push(item);
    return !!condition;
  };
  return { check, checks, errors };
}

function screenshotLabel(file) {
  const match = /^(\d{2})-(.+)\.png$/i.exec(path.basename(file));
  return match ? { number: Number(match[1]), label: match[2] } : null;
}

function validateMode(postFixRoot, mode) {
  const modeRoot = path.join(postFixRoot, mode);
  const record = makeRecorder(mode);
  const { check } = record;
  check('directory', fs.existsSync(modeRoot) && fs.statSync(modeRoot).isDirectory(),
    `${mode}: missing evidence directory ${modeRoot}.`);

  const resultFile = path.join(modeRoot, 'latest-result.json');
  let result = null;
  if (check('manifest.exists', fs.existsSync(resultFile) && fs.statSync(resultFile).isFile(),
    `${mode}: missing latest-result.json.`)) {
    try {
      result = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
      check('manifest.object', isRecord(result), `${mode}: latest-result.json must contain an object.`);
    } catch (error) {
      check('manifest.parse', false, `${mode}: latest-result.json is not valid JSON.`, error.message);
    }
  }

  check('manifest.ok', result?.ok === true, `${mode}: acceptance result must be ok:true.`);
  check('manifest.mode', result?.mode === mode, `${mode}: manifest mode must equal ${mode}.`, result?.mode);
  check('manifest.evidenceDirectory', typeof result?.evidenceDirectory === 'string'
    && path.resolve(result.evidenceDirectory) === modeRoot,
  `${mode}: evidenceDirectory does not point at this post-fix mode root.`, result?.evidenceDirectory);

  const products = result?.products;
  check('products.array', Array.isArray(products), `${mode}: products must be an array.`);
  check('products.exactCount', Array.isArray(products) && products.length === 3,
    `${mode}: route must contain exactly three products.`, products);
  check('products.distinct', Array.isArray(products) && new Set(products).size === 3
    && products.every((skuId) => typeof skuId === 'string' && skuId.length > 0),
  `${mode}: the three product identifiers must be nonempty and distinct.`, products);

  const before = result?.beforeBooks;
  const final = result?.final;
  const books = final?.books;
  const ticket = books?.lastTicket;
  const numericBookFields = ['units', 'revenue', 'held', 'history'];
  check('books.snapshots', isRecord(before) && isRecord(final) && isRecord(books) && isRecord(ticket),
    `${mode}: exact-once book/final/ticket snapshots are incomplete.`);
  check('books.numeric', numericBookFields.every((field) => Number.isFinite(before?.[field])
    && Number.isFinite(books?.[field])), `${mode}: before/final book totals must be finite numbers.`);
  check('idle.active', final?.active === false, `${mode}: register did not return to inactive.`);
  check('idle.tx', final?.tx === null, `${mode}: live transaction remained after completion.`);
  check('idle.flow', final?.flow === null, `${mode}: checkout flow remained after completion.`);
  check('books.unitsExactOnce', books?.units === before?.units + 3,
    `${mode}: units were not booked exactly once.`, { before: before?.units, after: books?.units });
  check('books.historyExactOnce', books?.history === before?.history + 1,
    `${mode}: transaction history was not booked exactly once.`, { before: before?.history, after: books?.history });
  check('books.heldRestored', books?.held === before?.held && books?.held === 0,
    `${mode}: held inventory did not return to the zero-item fixture baseline.`,
    { before: before?.held, after: books?.held });
  check('ticket.identity', ticket?.customer === result?.customer && ticket?.method === mode,
    `${mode}: ticket customer or payment method is wrong.`, ticket);
  check('ticket.items', ticket?.items === 3, `${mode}: ticket must contain exactly three items.`, ticket?.items);
  check('ticket.total', Number.isFinite(ticket?.total) && ticket.total > 0,
    `${mode}: ticket total must be a positive finite amount.`, ticket?.total);
  check('books.revenueExactOnce', Number.isFinite(before?.revenue) && Number.isFinite(books?.revenue)
    && Number.isFinite(ticket?.total)
    && roundCents(books.revenue - before.revenue) === roundCents(ticket.total),
  `${mode}: revenue delta is not exactly one ticket total.`,
  { before: before?.revenue, after: books?.revenue, ticket: ticket?.total });

  const queue = final?.queue;
  check('customer.queueArray', Array.isArray(queue), `${mode}: final checkout queue is missing.`);
  check('customer.removed', Array.isArray(queue) && queue.length === 0
    && !queue.some((entry) => entry?.name === result?.customer),
  `${mode}: served customer was not removed from the isolated checkout queue.`, queue);
  check('customer.completed', final?.customer?.name === result?.customer
    && final.customer.phase === 'complete'
    && final.customer.placed === 3
    && Array.isArray(final.customer.cart) && final.customer.cart.length === 0
    && final.customer.bought === true && final.customer.paid === true,
  `${mode}: served-customer completion snapshot is incomplete.`, final?.customer);

  if (Array.isArray(products)) {
    for (const skuId of products) {
      const beforeShelf = before?.shelf?.[skuId];
      const afterShelf = books?.shelf?.[skuId];
      check(`stock.${skuId}`, Number.isFinite(beforeShelf) && Number.isFinite(afterShelf)
        && afterShelf === Math.max(beforeShelf, 12) - 1,
      `${mode}: ${skuId} shelf stock is not the fixture-adjusted exact-once value.`,
      { before: beforeShelf, after: afterShelf });
    }
  }

  const consoleEvidence = result?.console;
  check('diagnostics.object', isRecord(consoleEvidence), `${mode}: browser diagnostics object is missing.`);
  for (const field of ['errors', 'pageErrors', 'failedRequests', 'nonAbortedFailedRequests']) {
    check(`diagnostics.${field}Array`, Array.isArray(consoleEvidence?.[field]),
      `${mode}: console.${field} must be an array.`);
  }
  check('diagnostics.consoleErrors', consoleEvidence?.errors?.length === 0,
    `${mode}: console errors were recorded.`, consoleEvidence?.errors);
  check('diagnostics.pageErrors', consoleEvidence?.pageErrors?.length === 0,
    `${mode}: page errors were recorded.`, consoleEvidence?.pageErrors);
  check('diagnostics.nonAbortedManifest', consoleEvidence?.nonAbortedFailedRequests?.length === 0,
    `${mode}: non-aborted request failures were recorded.`, consoleEvidence?.nonAbortedFailedRequests);
  const derivedNonAborted = Array.isArray(consoleEvidence?.failedRequests)
    ? consoleEvidence.failedRequests.filter((entry) => (
      typeof entry?.error !== 'string' || !entry.error.includes('ERR_ABORTED')
    )) : null;
  check('diagnostics.nonAbortedDerived', Array.isArray(derivedNonAborted) && derivedNonAborted.length === 0,
    `${mode}: failedRequests contains a non-aborted or malformed failure.`, derivedNonAborted);

  const modeFiles = walkFiles(modeRoot);
  const blockerPngs = modeFiles.filter((file) => /blocker.*\.png$/i.test(path.basename(file)));
  check('screenshots.noBlockers', blockerPngs.length === 0,
    `${mode}: blocker PNGs remain in post-fix evidence.`, blockerPngs.map((file) => path.relative(modeRoot, file)));

  const screenshotFiles = modeFiles.filter((file) => path.dirname(file) === modeRoot && /\.png$/i.test(file));
  const parsedScreens = screenshotFiles.map((file) => ({ file, parsed: screenshotLabel(file) }));
  check('screenshots.naming', parsedScreens.every((entry) => entry.parsed),
    `${mode}: every evidence PNG must use NN-stage-name.png.`,
    parsedScreens.filter((entry) => !entry.parsed).map((entry) => path.basename(entry.file)));
  const orderedScreens = parsedScreens.filter((entry) => entry.parsed)
    .sort((a, b) => a.parsed.number - b.parsed.number);
  check('screenshots.sequence', orderedScreens.every((entry, index) => entry.parsed.number === index + 1),
    `${mode}: screenshot sequence must be contiguous from 01.`, orderedScreens.map((entry) => entry.parsed.number));
  for (const stage of EXPECTED_STAGE_LABELS[mode]) {
    const matching = orderedScreens.filter((entry) => entry.parsed.label === stage);
    check(`screenshots.stage.${stage}`, matching.length === 1,
      `${mode}: expected exactly one screenshot for ${stage}.`, matching.map((entry) => path.basename(entry.file)));
  }
  const allowedLabels = new Set(EXPECTED_STAGE_LABELS[mode]);
  const unexpectedScreens = orderedScreens.filter((entry) => !allowedLabels.has(entry.parsed.label)
    && !(mode === 'card' && /^card-declined-attempt-\d+$/.test(entry.parsed.label)));
  check('screenshots.noUnexpected', unexpectedScreens.length === 0,
    `${mode}: unexpected or stale screenshots remain.`, unexpectedScreens.map((entry) => path.basename(entry.file)));
  const corruptPngs = screenshotFiles.filter((file) => !fileHasPrefix(file, PNG_SIGNATURE));
  check('screenshots.pngIntegrity', corruptPngs.length === 0,
    `${mode}: one or more screenshot files lack a PNG signature.`, corruptPngs.map((file) => path.basename(file)));

  const evidenceLog = Array.isArray(result?.log)
    ? result.log.filter((entry) => typeof entry?.evidence === 'string').map((entry) => entry.evidence) : null;
  check('screenshots.logArray', Array.isArray(result?.log), `${mode}: manifest log must be an array.`);
  check('screenshots.logSafeNames', Array.isArray(evidenceLog)
    && evidenceLog.every((file) => file === path.basename(file) && /\.png$/i.test(file)),
  `${mode}: screenshot log contains a non-local or non-PNG evidence path.`, evidenceLog);
  const diskNames = orderedScreens.map((entry) => path.basename(entry.file));
  check('screenshots.logMatchesDisk', Array.isArray(evidenceLog)
    && evidenceLog.length === diskNames.length
    && evidenceLog.every((file, index) => file === diskNames[index]),
  `${mode}: screenshot log and ordered files do not agree exactly.`, { log: evidenceLog, disk: diskNames });
  const scanActions = Array.isArray(result?.log) ? result.log.filter((entry) => (
    typeof entry?.action === 'string' && /^product \d+ rotated, scanned, and staged$/.test(entry.action)
  )) : [];
  check('products.threePhysicalScans', scanActions.length === 3
    && new Set(scanActions.map((entry) => entry.uid)).size === 3,
  `${mode}: log does not prove exactly three distinct physical scan/stage actions.`, scanActions);
  const bagActions = Array.isArray(result?.log) ? result.log.filter((entry) => (
    entry?.action === 'physical product dragged into bag'
  )) : [];
  check('products.threePhysicalBagPlacements', bagActions.length === 3
    && new Set(bagActions.map((entry) => entry.baggedUid)).size === 3,
  `${mode}: log does not prove exactly three distinct product-to-bag actions.`, bagActions);

  check('video.requested', result?.videoRequested === true,
    `${mode}: Playwright context video was not requested.`);
  const capture = result?.audioVideoCapture;
  check('video.noNamedAudioCapture', isRecord(capture) && capture.requested === false
    && !capture.output && !capture.downloaded,
  `${mode}: post-fix evidence must not request or retain a named audio capture.`, capture);
  const webmFiles = modeFiles.filter((file) => /\.webm$/i.test(file));
  const pageVideos = webmFiles.filter((file) => /^page@.*\.webm$/i.test(path.basename(file)));
  check('video.exactlyOnePageVideo', pageVideos.length === 1,
    `${mode}: expected exactly one page@*.webm, found ${pageVideos.length}.`,
    pageVideos.map((file) => path.relative(modeRoot, file)));
  check('video.noOtherWebm', webmFiles.length === 1 && pageVideos.length === 1,
    `${mode}: named audio, retry, or stale WebM files remain.`, webmFiles.map((file) => path.relative(modeRoot, file)));
  const pageVideo = pageVideos.length === 1 ? pageVideos[0] : null;
  check('video.canonicalDirectory', !!pageVideo && path.dirname(pageVideo) === path.join(modeRoot, 'video'),
    `${mode}: clean Playwright video must live directly under ${path.join(modeRoot, 'video')}.`,
    pageVideo && path.relative(modeRoot, pageVideo));
  const tracks = pageVideo ? webmTracks(pageVideo) : null;
  check('video.integrity', !!tracks && tracks.ebml && (tracks.vp8 || tracks.vp9),
    `${mode}: Playwright video is not an EBML WebM with a VP8/VP9 identifier.`, tracks);

  return {
    mode,
    ok: record.errors.length === 0,
    root: modeRoot,
    customer: result?.customer || null,
    products: Array.isArray(products) ? products : null,
    expectedStages: EXPECTED_STAGE_LABELS[mode],
    capturedStages: orderedScreens.map((entry) => entry.parsed.label),
    ticket: ticket || null,
    deltas: isRecord(before) && isRecord(books) ? {
      units: books.units - before.units,
      revenue: Number((books.revenue - before.revenue).toFixed(2)),
      held: books.held - before.held,
      history: books.history - before.history,
    } : null,
    playwrightVideo: pageVideo ? {
      path: pageVideo,
      bytes: fs.statSync(pageVideo).size,
      tracks,
    } : null,
    checks: record.checks,
    errors: record.errors,
  };
}

export function validatePostFixEvidence(passRootInput, {
  writeArtifact = true,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!passRootInput) throw new Error('A pass root is required (pass-1 through pass-4).');
  const passRoot = path.resolve(passRootInput);
  const passMatch = /^pass-([1-4])$/i.exec(path.basename(passRoot));
  if (!passMatch) throw new Error(`Pass root must end in pass-1, pass-2, pass-3, or pass-4: ${passRoot}`);
  const postFixRoot = path.join(passRoot, 'post-fix');
  fs.mkdirSync(postFixRoot, { recursive: true });

  const modes = ['card', 'cash'].map((mode) => validateMode(postFixRoot, mode));
  const allFiles = walkFiles(postFixRoot);
  const blockerPngs = allFiles.filter((file) => /blocker.*\.png$/i.test(path.basename(file)));
  const validation = {
    schemaVersion: 1,
    generatedAt,
    ok: modes.every((mode) => mode.ok) && blockerPngs.length === 0,
    pass: Number(passMatch[1]),
    passRoot,
    postFixRoot,
    policy: {
      modes: ['card', 'cash'],
      productsPerMode: 3,
      namedAudioCaptureAllowed: false,
      pageVideosPerMode: 1,
      blockerPngsAllowed: 0,
    },
    blockerPngs: blockerPngs.map((file) => path.relative(postFixRoot, file)),
    modes,
    failedChecks: modes.flatMap((mode) => mode.errors),
  };
  const output = path.join(postFixRoot, VALIDATION_FILE);
  if (writeArtifact) fs.writeFileSync(output, `${JSON.stringify(validation, null, 2)}\n`, 'utf8');
  return { ...validation, output };
}

function main() {
  const passRoot = process.argv[2];
  try {
    const validation = validatePostFixEvidence(passRoot);
    process.stdout.write(`${JSON.stringify({
      ok: validation.ok,
      pass: validation.pass,
      output: validation.output,
      failedChecks: validation.failedChecks,
    }, null, 2)}\n`);
    if (!validation.ok) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

const invokedAsScript = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedAsScript) main();
