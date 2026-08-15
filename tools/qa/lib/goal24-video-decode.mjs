import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

import { goal24VisualMarkerDefinition } from './goal24-visual-evidence.mjs';

export const GOAL24_DECODED_VIDEO_SCHEMA = 'golf-flipper/goal24-decoded-video-evidence/v1';

function required(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256File(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function safeName(value) {
  return String(value || '').replace(/[^a-z0-9._-]+/giu, '-').replace(/^-|-$/gu, '');
}

function startVideoServer(file) {
  const size = fs.statSync(file).size;
  const server = http.createServer((request, response) => {
    if (request.url === '/') {
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      response.end('<!doctype html><meta charset="utf-8"><video id="capture" muted playsinline></video><canvas id="frame" hidden></canvas>');
      return;
    }
    if (request.url !== '/capture.webm') {
      response.writeHead(404);
      response.end();
      return;
    }
    const range = /^bytes=(\d*)-(\d*)$/u.exec(request.headers.range || '');
    let start = 0;
    let end = size - 1;
    if (range) {
      start = range[1] ? Number(range[1]) : 0;
      end = range[2] ? Number(range[2]) : end;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)
        || start < 0 || end < start || start >= size) {
        response.writeHead(416, { 'Content-Range': `bytes */${size}` });
        response.end();
        return;
      }
      end = Math.min(end, size - 1);
    }
    const headers = {
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      'Content-Length': end - start + 1,
      'Content-Type': 'video/webm',
    };
    if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    response.writeHead(range ? 206 : 200, headers);
    fs.createReadStream(file, { start, end }).pipe(response);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        server,
        url: `http://127.0.0.1:${address.port}/`,
      });
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

function pixel(png, x, y) {
  const safeX = Math.max(0, Math.min(png.width - 1, Math.round(x)));
  const safeY = Math.max(0, Math.min(png.height - 1, Math.round(y)));
  const offset = (safeY * png.width + safeX) * 4;
  return [png.data[offset], png.data[offset + 1], png.data[offset + 2]];
}

function compareSceneSamples(samples, screenshot, label) {
  const png = PNG.sync.read(fs.readFileSync(screenshot));
  required(samples.length >= 200, `${label}: decoded proof has too few scene comparison samples.`);
  const distances = samples.map((sample) => {
    const actual = pixel(png, sample.normalizedX * png.width, sample.normalizedY * png.height);
    return Math.hypot(
      actual[0] - sample.rgb[0],
      actual[1] - sample.rgb[1],
      actual[2] - sample.rgb[2],
    );
  }).sort((left, right) => left - right);
  const percentile = (fraction) => distances[
    Math.min(distances.length - 1, Math.floor((distances.length - 1) * fraction))
  ];
  const medianDistance = percentile(0.5);
  const p95Distance = percentile(0.95);
  const within60Fraction = distances.filter((distance) => distance <= 60).length / distances.length;
  required(medianDistance <= 30 && p95Distance <= 90 && within60Fraction >= 0.9,
    `${label}: decoded video scene does not match its paired screenshot `
      + `(median ${medianDistance.toFixed(2)}, p95 ${p95Distance.toFixed(2)}, `
      + `${(within60Fraction * 100).toFixed(2)}% within distance 60).`);
  return {
    samples: distances.length,
    medianColorDistance: +medianDistance.toFixed(3),
    p95ColorDistance: +p95Distance.toFixed(3),
    within60Fraction: +within60Fraction.toFixed(4),
    screenshotSha256: sha256File(screenshot),
  };
}

function decodeDataUrl(dataUrl) {
  const match = /^data:image\/png;base64,([a-z0-9+/=]+)$/iu.exec(dataUrl);
  required(match, 'Decoded proof frame is not an inline PNG.');
  return Buffer.from(match[1], 'base64');
}

/**
 * Decode the finalized Playwright WebM in Chromium and find every closed-event
 * marker in route order. Structural EBML parsing is deliberately not enough:
 * this gate requires successful media decode, presented frames, exact markers,
 * playback through end, and scene pixels matching the paired in-game PNG.
 */
export async function validateGoal24DecodedVideo({
  file,
  expectedMarkers,
  outputDirectory,
  expectedWidth,
  expectedHeight,
  minimumDurationMs,
  maximumPresentedGapMs = 2_000,
}) {
  required(fs.statSync(file).isFile(), 'Decoded-video validation requires a WebM file.');
  required(Array.isArray(expectedMarkers) && expectedMarkers.length > 0,
    'Decoded-video validation requires ordered marker expectations.');
  required(Number.isInteger(expectedWidth) && expectedWidth >= 640
    && Number.isInteger(expectedHeight) && expectedHeight >= 360,
  'Decoded-video validation requires exact expected dimensions.');
  required(Number.isFinite(minimumDurationMs) && minimumDurationMs >= 5_000,
    'Decoded-video validation requires a locked minimum route duration.');
  required(Number.isFinite(maximumPresentedGapMs) && maximumPresentedGapMs >= 2_000,
    'Decoded-video validation requires a raw-derived presented-frame gap limit.');
  const expectations = expectedMarkers.map((entry, index) => {
    const definition = goal24VisualMarkerDefinition(entry.payload);
    required(entry.digest === definition.digest,
      `Decoded-video marker ${index + 1} digest does not match its payload.`);
    required(fs.statSync(entry.screenshot).isFile(),
      `Decoded-video marker ${index + 1} paired screenshot is missing.`);
    for (const key of ['x', 'y', 'width', 'height']) {
      required(Number.isFinite(entry.markerRect?.[key]),
        `Decoded-video marker ${index + 1} rectangle lacks ${key}.`);
    }
    required(entry.markerRect.width >= 200 && entry.markerRect.height >= 200,
      `Decoded-video marker ${index + 1} is too small.`);
    return {
      ordinal: index + 1,
      digest: definition.digest,
      cells: definition.cells.map((color) => color.slice(0, 3)),
      gridSize: definition.gridSize,
      markerRect: entry.markerRect,
      excludedRects: [entry.panelRect, ...(entry.excludedRects || [])].filter(Boolean),
      interactionId: entry.payload.source.interactionId,
      scenario: entry.payload.source.scenario,
      screenshot: path.resolve(entry.screenshot),
    };
  });
  fs.mkdirSync(outputDirectory, { recursive: true });

  const served = await startVideoServer(path.resolve(file));
  let browser = null;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: expectedWidth, height: expectedHeight } });
    await page.goto(served.url, { waitUntil: 'domcontentloaded' });
    const decoded = await page.evaluate(async ({
      markers, width, height, minimumRouteDurationMs, allowedPresentedGapMs,
    }) => {
      const requiredInPage = (condition, message) => {
        if (!condition) throw new Error(message);
      };
      const video = document.getElementById('capture');
      const canvas = document.getElementById('frame');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
      const waitEvent = (name) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timed out waiting for video ${name}.`)), 30_000);
        video.addEventListener(name, () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
        video.addEventListener('error', () => {
          clearTimeout(timer);
          reject(new Error(`Video decode error ${video.error?.code}: ${video.error?.message || 'unknown'}.`));
        }, { once: true });
      });
      video.src = '/capture.webm';
      await waitEvent('loadedmetadata');
      requiredInPage(video.videoWidth === width && video.videoHeight === height,
        `Decoded video is ${video.videoWidth}x${video.videoHeight}; expected ${width}x${height}.`);
      requiredInPage(Number.isFinite(video.duration) && video.duration * 1000 >= minimumRouteDurationMs,
        `Decoded duration ${video.duration * 1000} ms is below the route minimum.`);
      requiredInPage(typeof video.requestVideoFrameCallback === 'function',
        'Chromium lacks requestVideoFrameCallback for decoded proof.');

      const colorDistance = (actual, expected) => Math.hypot(
        actual[0] - expected[0], actual[1] - expected[1], actual[2] - expected[2],
      );
      const markerMatches = (marker) => {
        const rect = marker.markerRect;
        const moduleWidth = rect.width / marker.gridSize;
        const moduleHeight = rect.height / marker.gridSize;
        let matched = 0;
        let cornersMatched = 0;
        for (let y = 0; y < marker.gridSize; y += 1) {
          for (let x = 0; x < marker.gridSize; x += 1) {
            const expected = marker.cells[y * marker.gridSize + x];
            const positions = [0.3, 0.45, 0.6, 0.72];
            const pixels = [];
            for (const yFraction of positions) {
              for (const xFraction of positions) {
                const data = context.getImageData(
                  Math.floor(rect.x + (x + xFraction) * moduleWidth),
                  Math.floor(rect.y + (y + yFraction) * moduleHeight),
                  1,
                  1,
                ).data;
                pixels.push([data[0], data[1], data[2]]);
              }
            }
            const average = [0, 1, 2].map((channel) => (
              pixels.reduce((sum, value) => sum + value[channel], 0) / pixels.length
            ));
            const cellMatched = colorDistance(average, expected) <= 90;
            if (cellMatched) matched += 1;
            if ((x === 0 || x === marker.gridSize - 1)
              && (y === 0 || y === marker.gridSize - 1) && cellMatched) cornersMatched += 1;
          }
        }
        return { matched, cornersMatched, pass: matched >= 396 && cornersMatched === 4 };
      };
      const inside = (x, y, rect) => rect
        && x >= rect.x && x <= rect.x + rect.width
        && y >= rect.y && y <= rect.y + rect.height;
      const sceneSamples = (excludedRects) => {
        const samples = [];
        for (let gridY = 1; gridY < 18; gridY += 1) {
          for (let gridX = 1; gridX < 32; gridX += 1) {
            const x = (gridX / 32) * width;
            const y = (gridY / 18) * height;
            if (excludedRects.some((rect) => inside(x, y, rect))) continue;
            const data = context.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
            samples.push({
              normalizedX: x / width,
              normalizedY: y / height,
              rgb: [data[0], data[1], data[2]],
            });
          }
        }
        return samples;
      };
      const proofCanvas = document.createElement('canvas');
      proofCanvas.width = 480;
      proofCanvas.height = 270;
      const proofContext = proofCanvas.getContext('2d', { alpha: false });
      const markerCanvas = document.createElement('canvas');
      markerCanvas.width = 200;
      markerCanvas.height = 200;
      const markerContext = markerCanvas.getContext('2d', { alpha: false });
      const found = [];
      let expectedIndex = 0;
      let consecutiveMatches = 0;
      let presentedFrames = 0;
      let firstMediaTime = null;
      let lastMediaTime = null;
      let maximumPresentedGapMs = 0;
      let settled = false;

      const playback = new Promise((resolve, reject) => {
        const timeoutMs = Math.min(180_000, Math.max(45_000, video.duration * 1000 / 4 + 30_000));
        const timer = setTimeout(() => reject(new Error('Decoded video playback timed out.')), timeoutMs);
        const fail = (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        };
        video.addEventListener('error', () => fail(new Error(
          `Video decode error ${video.error?.code}: ${video.error?.message || 'unknown'}.`,
        )), { once: true });
        video.addEventListener('ended', () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (expectedIndex !== markers.length) {
            reject(new Error(`Decoded video ended after ${expectedIndex}/${markers.length} markers.`));
            return;
          }
          resolve();
        }, { once: true });
        const frame = (_now, metadata) => {
          try {
            presentedFrames += 1;
            const mediaTime = metadata.mediaTime;
            if (firstMediaTime == null) firstMediaTime = mediaTime;
            if (lastMediaTime != null) {
              maximumPresentedGapMs = Math.max(
                maximumPresentedGapMs,
                (mediaTime - lastMediaTime) * 1000,
              );
            }
            lastMediaTime = mediaTime;
            context.drawImage(video, 0, 0, width, height);
            if (expectedIndex < markers.length) {
              const marker = markers[expectedIndex];
              const match = markerMatches(marker);
              consecutiveMatches = match.pass ? consecutiveMatches + 1 : 0;
              if (consecutiveMatches === 3) {
                proofContext.drawImage(video, 0, 0, proofCanvas.width, proofCanvas.height);
                markerContext.drawImage(
                  video,
                  marker.markerRect.x,
                  marker.markerRect.y,
                  marker.markerRect.width,
                  marker.markerRect.height,
                  0,
                  0,
                  markerCanvas.width,
                  markerCanvas.height,
                );
                found.push({
                  ordinal: marker.ordinal,
                  digest: marker.digest,
                  scenario: marker.scenario,
                  interactionId: marker.interactionId,
                  mediaTimeMs: mediaTime * 1000,
                  presentedFrameOrdinal: presentedFrames,
                  consecutiveMatchedFrames: consecutiveMatches,
                  matchedCells: match.matched,
                  sceneSamples: sceneSamples([
                    marker.markerRect,
                    ...marker.excludedRects,
                  ]),
                  proofPngDataUrl: proofCanvas.toDataURL('image/png'),
                  markerPngDataUrl: markerCanvas.toDataURL('image/png'),
                });
                expectedIndex += 1;
                consecutiveMatches = 0;
              }
            }
            if (!settled) video.requestVideoFrameCallback(frame);
          } catch (error) {
            fail(error);
          }
        };
        video.requestVideoFrameCallback(frame);
      });
      video.playbackRate = 4;
      await video.play();
      await playback;
      requiredInPage(video.ended && video.currentTime >= video.duration - 0.25,
        'Decoded playback did not reach the finite media end.');
      requiredInPage(presentedFrames >= 30, 'Decoded playback presented too few frames.');
      requiredInPage(maximumPresentedGapMs <= allowedPresentedGapMs,
        `Decoded playback has a ${maximumPresentedGapMs} ms presented-frame gap; `
          + `${allowedPresentedGapMs} ms is the raw-derived limit.`);
      return {
        durationMs: video.duration * 1000,
        width: video.videoWidth,
        height: video.videoHeight,
        playbackRate: video.playbackRate,
        presentedFrames,
        firstMediaTimeMs: firstMediaTime * 1000,
        lastMediaTimeMs: lastMediaTime * 1000,
        maximumPresentedGapMs,
        reachedMediaEnd: video.ended,
        decodeError: null,
        found,
      };
    }, {
      markers: expectations.map((entry) => Object.fromEntries(
        Object.entries(entry).filter(([key]) => key !== 'screenshot'),
      )),
      width: expectedWidth,
      height: expectedHeight,
      minimumRouteDurationMs: minimumDurationMs,
      allowedPresentedGapMs: maximumPresentedGapMs,
    });

    const markerResults = decoded.found.map((found, index) => {
      const expectation = expectations[index];
      required(found.digest === expectation.digest && found.ordinal === index + 1,
        `Decoded marker ${index + 1} is out of route order.`);
      const base = `${String(index + 1).padStart(2, '0')}-${safeName(expectation.scenario)}-${expectation.digest.slice(0, 12)}`;
      const proofFrame = path.join(outputDirectory, `${base}-decoded-proof.png`);
      const markerCrop = path.join(outputDirectory, `${base}-decoded-marker.png`);
      fs.writeFileSync(proofFrame, decodeDataUrl(found.proofPngDataUrl));
      fs.writeFileSync(markerCrop, decodeDataUrl(found.markerPngDataUrl));
      const sceneComparison = compareSceneSamples(
        found.sceneSamples,
        expectation.screenshot,
        `${expectation.scenario}/${expectation.interactionId}`,
      );
      return {
        ordinal: index + 1,
        digest: found.digest,
        scenario: found.scenario,
        interactionId: found.interactionId,
        mediaTimeMs: +found.mediaTimeMs.toFixed(3),
        presentedFrameOrdinal: found.presentedFrameOrdinal,
        consecutiveMatchedFrames: found.consecutiveMatchedFrames,
        matchedCells: found.matchedCells,
        pairedScreenshot: expectation.screenshot,
        sceneComparison,
        proofFrame: { path: proofFrame, sha256: sha256File(proofFrame) },
        markerCrop: { path: markerCrop, sha256: sha256File(markerCrop) },
      };
    });
    return {
      schema: GOAL24_DECODED_VIDEO_SCHEMA,
      file: path.resolve(file),
      fileSha256: sha256File(file),
      width: decoded.width,
      height: decoded.height,
      durationMs: +decoded.durationMs.toFixed(3),
      playbackRate: decoded.playbackRate,
      presentedFrames: decoded.presentedFrames,
      firstMediaTimeMs: +decoded.firstMediaTimeMs.toFixed(3),
      lastMediaTimeMs: +decoded.lastMediaTimeMs.toFixed(3),
      maximumPresentedGapMs: +decoded.maximumPresentedGapMs.toFixed(3),
      maximumAllowedPresentedGapMs: +maximumPresentedGapMs.toFixed(3),
      reachedMediaEnd: decoded.reachedMediaEnd,
      decodeError: decoded.decodeError,
      markerResults,
      exactRouteOrderVerified: markerResults.length === expectations.length,
      decodedGameSceneBoundToScreenshots: markerResults.every((entry) => (
        entry.sceneComparison.within60Fraction >= 0.9
      )),
    };
  } finally {
    await browser?.close().catch(() => {});
    await closeServer(served.server);
  }
}
