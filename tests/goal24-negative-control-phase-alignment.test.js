import assert from 'node:assert/strict';
import test from 'node:test';

import {
  beginInteractionWindow,
  endInteractionWindow,
  installGoal24InteractionRecorder,
  restartInteractionMeasurementWithBusyStall,
  uninstallGoal24InteractionRecorder,
  validateGoal24BusyStallPhaseAlignment,
} from '../tools/qa/lib/goal24-interaction-recorder.mjs';

function installBrowserClockFixture() {
  const names = [
    '__fw',
    '__goal24InteractionRecorder',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'addEventListener',
    'removeEventListener',
  ];
  const originals = new Map(names.map((name) => [
    name,
    Object.getOwnPropertyDescriptor(globalThis, name),
  ]));
  const callbacks = new Map();
  const requestTimes = [];
  let nextRafId = 1;
  let nextRafError = null;
  let composedRenders = 0;
  const renderer = {
    info: {
      autoReset: false,
      render: { frame: 0, calls: 1, triangles: 12 },
      memory: { geometries: 1, textures: 1 },
      programs: [],
    },
  };
  const scene3d = {
    renderer,
    post: {
      stats: () => ({ shadowBakes: 0, composedRenders }),
    },
    render() {
      renderer.info.render.frame += 1;
      composedRenders += 1;
    },
  };

  Object.assign(globalThis, {
    __fw: { scene3d },
    requestAnimationFrame(callback) {
      if (nextRafError) {
        const error = nextRafError;
        nextRafError = null;
        throw error;
      }
      const id = nextRafId;
      nextRafId += 1;
      callbacks.set(id, callback);
      requestTimes.push(performance.now());
      return id;
    },
    cancelAnimationFrame(id) {
      callbacks.delete(id);
    },
    addEventListener() {},
    removeEventListener() {},
  });
  delete globalThis.__goal24InteractionRecorder;

  return {
    page: {
      evaluate(callback, argument) {
        return callback(argument);
      },
    },
    scene3d,
    callbacks,
    requestTimes,
    failNextRafRequest(message = 'synthetic requestAnimationFrame failure') {
      nextRafError = new Error(message);
    },
    runNextRaf(timestamp = performance.now()) {
      const next = callbacks.entries().next().value;
      assert.ok(next, 'a recorder display rAF must be pending');
      const [id, callback] = next;
      callbacks.delete(id);
      callback(timestamp);
    },
    restore() {
      for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
    },
  };
}

function exactStraddles(interval, stall) {
  return interval.startAtMs <= stall.startedAtMs
    && interval.endAtMs >= stall.endedAtMs;
}

async function reachPostStallProbe(fixture, id, durationMs = 200) {
  await installGoal24InteractionRecorder(fixture.page);
  await beginInteractionWindow(fixture.page, {
    id,
    scenario: 'negativeControl',
    maxDurationMs: 1000,
  });
  fixture.runNextRaf();
  fixture.scene3d.render();
  const controlPromise = restartInteractionMeasurementWithBusyStall(
    fixture.page,
    `${id}-aligned`,
    durationMs,
  );
  const alignedBoundaryMs = performance.now();
  fixture.runNextRaf(alignedBoundaryMs);
  await new Promise((resolve) => setTimeout(resolve, 0));
  return {
    alignedBoundaryMs,
    controlPromise,
    firstPostStallRequestAtMs: fixture.requestTimes.at(-1),
  };
}

test('the negative control drains stale rAF timestamps before accepting a post-stall boundary', async () => {
  const fixture = installBrowserClockFixture();
  try {
    const installed = await installGoal24InteractionRecorder(fixture.page);
    assert.deepEqual(installed, { installed: true, reused: false });
    assert.equal(globalThis.__goal24InteractionRecorder.schemaVersion, 4);

    const cases = [
      { id: 'fresh-boundary', durationMs: 6, staleProbe: false },
      { id: 'one-stale-boundary', durationMs: 80, staleProbe: true },
    ];
    for (const { id, durationMs, staleProbe } of cases) {
      await beginInteractionWindow(fixture.page, {
        id: `phase-${id}`,
        scenario: 'negativeControl',
        maxDurationMs: 1000,
      });
      fixture.runNextRaf(performance.now());
      fixture.scene3d.render();

      const controlPromise = restartInteractionMeasurementWithBusyStall(
        fixture.page,
        `phase-aligned-${id}`,
        durationMs,
      );
      const requestsBeforeAlignedTick = fixture.requestTimes.length;
      fixture.runNextRaf(performance.now());
      assert.equal(
        fixture.requestTimes.length,
        requestsBeforeAlignedTick,
        'the aligned tick returns before requesting another rendering opportunity',
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.equal(
        fixture.requestTimes.length,
        requestsBeforeAlignedTick + 1,
        'the next display rAF is requested exactly once after the stall returns',
      );
      const postStallRequestAtMs = fixture.requestTimes.at(-1);
      if (staleProbe) {
        fixture.runNextRaf(postStallRequestAtMs - 40);
      }
      fixture.scene3d.render();
      fixture.runNextRaf(performance.now());
      const control = await controlPromise;

      assert.equal(control.alignment.phaseAligned, true);
      assert.equal(
        control.alignment.source,
        'recorder-display-raf-task-hop-two-boundary-phase-alignment',
      );
      assert.equal(
        control.boundary.priorDisplayBoundaryMs,
        control.alignment.displayTickTimestampMs,
      );
      assert.ok(control.alignment.requestQueuedAtMs <= control.alignment.displayTickObservedAtMs);
      assert.ok(control.alignment.displayTickObservedAtMs <= control.boundary.atMs);
      assert.ok(control.boundary.atMs <= control.busyStall.startedAtMs);
      assert.ok(
        control.busyStall.endedAtMs <= control.alignment.postStallRequestTaskObservedAtMs,
      );
      assert.ok(
        control.alignment.postStallRequestTaskObservedAtMs
          <= control.alignment.nextDisplayRafRequestedAtMs,
      );
      assert.ok(
        control.alignment.nextDisplayRafRequestedAtMs
          <= control.alignment.acceptedPostStallRafRequestedAtMs,
      );
      assert.ok(
        control.alignment.nextDisplayRafRequestedAtMs
          <= control.alignment.postStallDisplayTickObservedAtMs,
      );
      assert.equal(control.alignment.postStallRafRequestCount, staleProbe ? 2 : 1);
      assert.equal(control.alignment.stalePostStallRafCallbacks.length, staleProbe ? 1 : 0);
      assert.ok(control.alignment.stalePostStallRafCallbacks.every((entry) => (
        entry.requestedAtMs === control.alignment.nextDisplayRafRequestedAtMs
        && control.busyStall.startedAtMs < entry.timestampMs
        && entry.timestampMs < control.busyStall.endedAtMs
        && entry.observedAtMs >= control.busyStall.endedAtMs
      )));
      assert.equal(validateGoal24BusyStallPhaseAlignment(control), true);
      assert.ok(
        postStallRequestAtMs >= control.busyStall.endedAtMs,
        'no next display callback is queued from inside the busy interval',
      );
      assert.equal(
        control.alignment.postStallDisplayInterval.startAtMs,
        control.boundary.priorDisplayBoundaryMs,
      );
      assert.equal(
        control.alignment.postStallDisplayInterval.endAtMs,
        control.alignment.postStallDisplayTickTimestampMs,
      );
      assert.ok(exactStraddles(
        control.alignment.postStallDisplayInterval,
        control.busyStall,
      ));

      const window = await endInteractionWindow(fixture.page);
      const displayMatches = window.displayCadenceIntervals
        .filter((interval) => exactStraddles(interval, control.busyStall));
      const renderMatches = window.renderCadenceIntervals
        .filter((interval) => exactStraddles(interval, control.busyStall));
      assert.equal(displayMatches.length, 1, 'one display interval owns the complete stall');
      assert.equal(renderMatches.length, 1, 'one production-render interval owns the complete stall');
      assert.equal(displayMatches[0].startAtMs, control.boundary.priorDisplayBoundaryMs);
      assert.equal(renderMatches[0].startAtMs, control.boundary.priorRenderBoundaryMs);
      assert.equal(fixture.callbacks.size, 0, 'ending the window cancels the next recorder rAF');
    }

    await uninstallGoal24InteractionRecorder(fixture.page);
  } finally {
    try { await uninstallGoal24InteractionRecorder(fixture.page); } catch { /* best effort */ }
    fixture.restore();
  }
});

test('teardown rejects a queued phase-aligned stall instead of leaving its caller hung', async () => {
  const fixture = installBrowserClockFixture();
  try {
    await installGoal24InteractionRecorder(fixture.page);
    await beginInteractionWindow(fixture.page, {
      id: 'phase-teardown',
      scenario: 'negativeControl',
      maxDurationMs: 1000,
    });
    fixture.runNextRaf();
    fixture.scene3d.render();

    const controlPromise = restartInteractionMeasurementWithBusyStall(
      fixture.page,
      'phase-aligned-teardown',
      6,
    );
    const rejected = assert.rejects(
      controlPromise,
      /Busy-stall display alignment aborted: recorder-uninstalled/,
    );
    const uninstalled = await uninstallGoal24InteractionRecorder(fixture.page);

    assert.equal(uninstalled.activeWindowAborted, true);
    await rejected;
    assert.equal(fixture.callbacks.size, 0);
    assert.equal(globalThis.__goal24InteractionRecorder, undefined);
  } finally {
    try { await uninstallGoal24InteractionRecorder(fixture.page); } catch { /* best effort */ }
    fixture.restore();
  }
});

test('ending a window settles a pending control and blocks competing measurement mutations', async () => {
  const fixture = installBrowserClockFixture();
  try {
    await installGoal24InteractionRecorder(fixture.page);
    await beginInteractionWindow(fixture.page, {
      id: 'phase-end',
      scenario: 'negativeControl',
      maxDurationMs: 1000,
    });
    fixture.runNextRaf();
    fixture.scene3d.render();

    const recorder = globalThis.__goal24InteractionRecorder;
    const controlPromise = recorder.restartWithBusyStall('phase-aligned-end', 6);
    assert.throws(
      () => recorder.restartWithBusyStall('duplicate', 6),
      /already pending/,
    );
    assert.throws(
      () => recorder.restartAtMeasurementBoundary('competing-restart'),
      /alignment is pending/,
    );
    assert.throws(
      () => recorder.busyStall(6),
      /unaligned busy stall while display alignment is pending/,
    );

    const rejected = assert.rejects(
      controlPromise,
      /Busy-stall display alignment aborted: window-ended/,
    );
    const window = await endInteractionWindow(fixture.page);
    assert.equal(window.id, 'phase-end');
    await rejected;
    assert.equal(fixture.callbacks.size, 0);
    await uninstallGoal24InteractionRecorder(fixture.page);
  } finally {
    try { await uninstallGoal24InteractionRecorder(fixture.page); } catch { /* best effort */ }
    fixture.restore();
  }
});

test('a failed post-stall rAF request rejects the control instead of orphaning its promise', async () => {
  const fixture = installBrowserClockFixture();
  try {
    await installGoal24InteractionRecorder(fixture.page);
    await beginInteractionWindow(fixture.page, {
      id: 'phase-raf-failure',
      scenario: 'negativeControl',
      maxDurationMs: 1000,
    });
    fixture.runNextRaf();
    fixture.scene3d.render();

    const controlPromise = restartInteractionMeasurementWithBusyStall(
      fixture.page,
      'phase-aligned-raf-failure',
      6,
    );
    const rejected = assert.rejects(controlPromise, /synthetic rAF request failure/);
    fixture.failNextRafRequest('synthetic rAF request failure');
    fixture.runNextRaf();

    await rejected;
    assert.equal(globalThis.__goal24InteractionRecorder.diagnostics().busyStallAlignmentPending, false);
    assert.equal(globalThis.__goal24InteractionRecorder.diagnostics().displayRafScheduled, false);
    await uninstallGoal24InteractionRecorder(fixture.page);
  } finally {
    try { await uninstallGoal24InteractionRecorder(fixture.page); } catch { /* best effort */ }
    fixture.restore();
  }
});

test('teardown after the stall cancels the proving rAF and rejects the aligned control', async () => {
  const fixture = installBrowserClockFixture();
  try {
    await installGoal24InteractionRecorder(fixture.page);
    await beginInteractionWindow(fixture.page, {
      id: 'phase-post-stall-teardown',
      scenario: 'negativeControl',
      maxDurationMs: 1000,
    });
    fixture.runNextRaf();
    fixture.scene3d.render();

    const controlPromise = restartInteractionMeasurementWithBusyStall(
      fixture.page,
      'phase-aligned-post-stall-teardown',
      6,
    );
    fixture.runNextRaf();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(globalThis.__goal24InteractionRecorder.diagnostics().busyStallAlignmentPending, true);
    assert.equal(fixture.callbacks.size, 1, 'the proving post-stall display rAF is pending');

    const rejected = assert.rejects(
      controlPromise,
      /Busy-stall display alignment aborted: window-ended/,
    );
    await endInteractionWindow(fixture.page);
    await rejected;
    assert.equal(fixture.callbacks.size, 0);
  } finally {
    try { await uninstallGoal24InteractionRecorder(fixture.page); } catch { /* best effort */ }
    fixture.restore();
  }
});

test('a failed follow-up request after a stale rAF probe rejects the aligned control', async () => {
  const fixture = installBrowserClockFixture();
  try {
    await installGoal24InteractionRecorder(fixture.page);
    await beginInteractionWindow(fixture.page, {
      id: 'phase-stale-raf-failure',
      scenario: 'negativeControl',
      maxDurationMs: 1000,
    });
    fixture.runNextRaf();
    fixture.scene3d.render();

    const controlPromise = restartInteractionMeasurementWithBusyStall(
      fixture.page,
      'phase-aligned-stale-raf-failure',
      80,
    );
    fixture.runNextRaf();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.failNextRafRequest('synthetic stale-probe follow-up failure');
    fixture.runNextRaf(fixture.requestTimes.at(-1) - 40);

    await assert.rejects(controlPromise, /synthetic stale-probe follow-up failure/);
    assert.equal(globalThis.__goal24InteractionRecorder.diagnostics().busyStallAlignmentPending, false);
    assert.equal(globalThis.__goal24InteractionRecorder.diagnostics().displayRafScheduled, false);
  } finally {
    try { await uninstallGoal24InteractionRecorder(fixture.page); } catch { /* best effort */ }
    fixture.restore();
  }
});

test('a backward or second stale rAF timestamp fails closed', async (context) => {
  await context.test('backward timestamp', async () => {
    const fixture = installBrowserClockFixture();
    try {
      const pending = await reachPostStallProbe(fixture, 'phase-backward-stale');
      fixture.runNextRaf(pending.alignedBoundaryMs);
      await assert.rejects(
        pending.controlPromise,
        /invalid or repeated stale rAF timestamp/,
      );
      assert.equal(globalThis.__goal24InteractionRecorder.diagnostics().displayRafScheduled, false);
    } finally {
      try { await uninstallGoal24InteractionRecorder(fixture.page); } catch { /* best effort */ }
      fixture.restore();
    }
  });

  await context.test('second timestamp inside the stall', async () => {
    const fixture = installBrowserClockFixture();
    try {
      const pending = await reachPostStallProbe(fixture, 'phase-second-stale');
      fixture.runNextRaf(pending.firstPostStallRequestAtMs - 100);
      fixture.runNextRaf(pending.firstPostStallRequestAtMs - 50);
      await assert.rejects(
        pending.controlPromise,
        /invalid or repeated stale rAF timestamp/,
      );
      assert.equal(globalThis.__goal24InteractionRecorder.diagnostics().displayRafScheduled, false);
    } finally {
      try { await uninstallGoal24InteractionRecorder(fixture.page); } catch { /* best effort */ }
      fixture.restore();
    }
  });
});

test('driver phase validation rejects stale-probe counter and identity relabeling', async () => {
  const fixture = installBrowserClockFixture();
  try {
    const pending = await reachPostStallProbe(fixture, 'phase-validator-relabels');
    fixture.runNextRaf(pending.firstPostStallRequestAtMs - 100);
    fixture.scene3d.render();
    fixture.runNextRaf(performance.now());
    const control = await pending.controlPromise;
    assert.equal(validateGoal24BusyStallPhaseAlignment(control), true);

    const wrongCount = structuredClone(control);
    wrongCount.alignment.postStallRafRequestCount += 1;
    assert.equal(validateGoal24BusyStallPhaseAlignment(wrongCount), false);

    const duplicateProbe = structuredClone(control);
    duplicateProbe.alignment.stalePostStallRafCallbacks.push(
      structuredClone(duplicateProbe.alignment.stalePostStallRafCallbacks[0]),
    );
    duplicateProbe.alignment.postStallRafRequestCount += 1;
    assert.equal(validateGoal24BusyStallPhaseAlignment(duplicateProbe), false);

    const backwardProbe = structuredClone(control);
    backwardProbe.alignment.stalePostStallRafCallbacks[0].timestampMs
      = backwardProbe.boundary.priorDisplayBoundaryMs;
    assert.equal(validateGoal24BusyStallPhaseAlignment(backwardProbe), false);

    const relabeledRequest = structuredClone(control);
    relabeledRequest.alignment.stalePostStallRafCallbacks[0].requestedAtMs += 1;
    assert.equal(validateGoal24BusyStallPhaseAlignment(relabeledRequest), false);

    const relabeledAcceptedBoundary = structuredClone(control);
    relabeledAcceptedBoundary.alignment.postStallDisplayTickTimestampMs
      = relabeledAcceptedBoundary.alignment.stalePostStallRafCallbacks[0].timestampMs;
    assert.equal(validateGoal24BusyStallPhaseAlignment(relabeledAcceptedBoundary), false);

    // Chromium may stamp an accepted callback with the frame's nominal
    // deadline just before JavaScript requested it. Delivery still has to be
    // after the request; the observed callback time proves that ordering.
    const deadlineBeforeRequest = structuredClone(control);
    const preRequestEnd = deadlineBeforeRequest.alignment
      .acceptedPostStallRafRequestedAtMs - 0.01;
    deadlineBeforeRequest.alignment.postStallDisplayTickTimestampMs = preRequestEnd;
    deadlineBeforeRequest.alignment.postStallDisplayInterval.endAtMs = preRequestEnd;
    deadlineBeforeRequest.alignment.postStallDisplayInterval.durationMs = preRequestEnd
      - deadlineBeforeRequest.alignment.postStallDisplayInterval.startAtMs;
    deadlineBeforeRequest.alignment.phaseAligned = true;
    assert.equal(validateGoal24BusyStallPhaseAlignment(deadlineBeforeRequest), true);

    const futureAcceptedBoundary = structuredClone(control);
    const futureEnd = futureAcceptedBoundary.alignment.postStallDisplayTickObservedAtMs + 1;
    futureAcceptedBoundary.alignment.postStallDisplayTickTimestampMs = futureEnd;
    futureAcceptedBoundary.alignment.postStallDisplayInterval.endAtMs = futureEnd;
    futureAcceptedBoundary.alignment.postStallDisplayInterval.durationMs = futureEnd
      - futureAcceptedBoundary.alignment.postStallDisplayInterval.startAtMs;
    assert.equal(validateGoal24BusyStallPhaseAlignment(futureAcceptedBoundary), false);

    await endInteractionWindow(fixture.page);
  } finally {
    try { await uninstallGoal24InteractionRecorder(fixture.page); } catch { /* best effort */ }
    fixture.restore();
  }
});

test('a missing display tick times out and clears the queued phase alignment', async () => {
  const fixture = installBrowserClockFixture();
  try {
    await installGoal24InteractionRecorder(fixture.page);
    await beginInteractionWindow(fixture.page, {
      id: 'phase-timeout',
      scenario: 'negativeControl',
      maxDurationMs: 1000,
    });
    const controlPromise = globalThis.__goal24InteractionRecorder.restartWithBusyStall(
      'phase-aligned-timeout',
      6,
      25,
    );

    await assert.rejects(controlPromise, /timed out before alignment completed/);
    assert.equal(globalThis.__goal24InteractionRecorder.diagnostics().busyStallAlignmentPending, false);
    await uninstallGoal24InteractionRecorder(fixture.page);
  } finally {
    try { await uninstallGoal24InteractionRecorder(fixture.page); } catch { /* best effort */ }
    fixture.restore();
  }
});

test('installation replaces an older recorder schema instead of reusing its phase-racy API', async () => {
  const fixture = installBrowserClockFixture();
  try {
    let oldRecorderUninstalled = 0;
    globalThis.__goal24InteractionRecorder = {
      schemaVersion: 3,
      uninstall() {
        oldRecorderUninstalled += 1;
        delete globalThis.__goal24InteractionRecorder;
      },
    };

    const installed = await installGoal24InteractionRecorder(fixture.page);
    assert.deepEqual(installed, { installed: true, reused: false });
    assert.equal(oldRecorderUninstalled, 1);
    assert.equal(globalThis.__goal24InteractionRecorder.schemaVersion, 4);
    await uninstallGoal24InteractionRecorder(fixture.page);
  } finally {
    try { await uninstallGoal24InteractionRecorder(fixture.page); } catch { /* best effort */ }
    fixture.restore();
  }
});
