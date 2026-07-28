import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const NODE = process.execPath;
const playwright = (script) => [NODE, ['tools/qa/run-playwright.cjs', script, '--bootstrap']];
const nodeTest = (...files) => [NODE, ['--test', '--test-concurrency=1', ...files]];

export function resolveBlenderExecutable(environment = process.env) {
  if (environment.BLENDER_BIN) return environment.BLENDER_BIN;
  if (process.platform === 'win32' && environment.ProgramFiles) {
    const foundation = path.join(environment.ProgramFiles, 'Blender Foundation');
    if (fs.existsSync(foundation)) {
      const installs = fs.readdirSync(foundation, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && /^Blender\s/i.test(entry.name))
        .map((entry) => path.join(foundation, entry.name, 'blender.exe'))
        .filter((candidate) => fs.existsSync(candidate))
        .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
      if (installs.length) return installs[0];
    }
  }
  return 'blender';
}

export function createGateDefinitions({
  outputRoot,
  baseRef = null,
  performanceBaseline = null,
} = {}) {
  const root = path.resolve(outputRoot || path.join('qa', 'overnight', 'integration-run'));
  const gateDir = (id) => path.join(root, id);
  const resultPath = (id) => path.join(gateDir(id), 'result.json');
  const browserStep = (id, script, env = {}) => {
    const [command, args] = playwright(script);
    return { command, args, env: { QA_RESULT_PATH: resultPath(id), ...env }, browser: true };
  };
  const testStep = (...files) => {
    const [command, args] = nodeTest(...files);
    return { command, args };
  };
  const definitions = [
    {
      id: 'boot', group: 'runtime',
      description: 'Normal Continue reaches a live clubhouse and a valid WebGL context.',
      steps: [browserStep('boot', 'tools/qa/boot-probe.js')],
    },
    {
      id: 'console', group: 'runtime',
      description: 'A normal boot has no console errors, page errors, or failed requests.',
      steps: [browserStep('console', 'tools/qa/boot-probe.js')],
    },
    {
      id: 'shaders', group: 'rendering',
      description: 'Course terrain shaders compile, draw, and retain a live WebGL context.',
      steps: [browserStep('shaders', 'tools/qa/course-shader-boot.js', {
        OUT_DIR: gateDir('shaders'),
      })],
    },
    {
      id: 'editor-tools', group: 'editor',
      description: 'Player-facing course editor tools, undo/redo, save/reload, and video evidence pass.',
      steps: [browserStep('editor-tools', 'tools/qa/course-editor-production-qa.js', {
        COURSE_EDITOR_QA_PHASE: 'overnight-integration-gate',
        HEADED: '1',
        VIDEO_DIR: path.join(gateDir('editor-tools'), 'video'),
      })],
    },
    {
      id: 'editor-performance', group: 'editor',
      description: 'Real terrain strokes retain frame pacing and scoped undo geometry integrity.',
      steps: [browserStep('editor-performance', 'tools/qa/course-editor-stroke-perf.js', {
        COURSE_QA_PHASE: 'overnight-integration-gate',
        HEADED: '1',
      })],
    },
    {
      id: 'checkout-card', group: 'checkout',
      description: 'Strict physical scan, mouse card insert, receipt, bagging, and customer handoff pass.',
      steps: [browserStep('checkout-card', 'tools/qa/register-acceptance-card.js', {
        HEADED: '1',
        REGISTER_QA_ROOT: path.join(root, 'checkout'),
        REGISTER_CAPTURE_PATH: path.join(gateDir('checkout-card'), 'audio-canvas.webm'),
        VIDEO_DIR: path.join(gateDir('checkout-card'), 'video'),
      })],
    },
    {
      id: 'checkout-cash', group: 'checkout',
      description: 'Strict physical scan, cash tender/change, receipt, bagging, and customer handoff pass.',
      steps: [browserStep('checkout-cash', 'tools/qa/register-acceptance-cash.js', {
        HEADED: '1',
        REGISTER_QA_ROOT: path.join(root, 'checkout'),
        REGISTER_CAPTURE_PATH: path.join(gateDir('checkout-cash'), 'audio-canvas.webm'),
        VIDEO_DIR: path.join(gateDir('checkout-cash'), 'video'),
      })],
    },
    {
      id: 'assets-1-50', group: 'assets',
      description: 'Assets 1-50 have a complete ordered manifest, source, runtime GLB, and runtime bindings.',
      steps: [{
        command: NODE,
        args: ['tools/qa/validate-asset-manifests.mjs', '--gate', 'assets-1-50', '--out', resultPath('assets-1-50')],
      }],
    },
    {
      id: 'assets-51-100', group: 'assets',
      description: 'Assets 51-100 have a complete ordered manifest, source, runtime GLB, and runtime bindings.',
      steps: [{
        command: NODE,
        args: ['tools/qa/validate-asset-manifests.mjs', '--gate', 'assets-51-100', '--out', resultPath('assets-51-100')],
      }],
    },
    {
      id: 'glb-clean-reimport', group: 'assets',
      description: 'Every declared GLB cleanly imports into factory-startup Blender.',
      steps: [{
        command: resolveBlenderExecutable(),
        args: [
          '--background', '--factory-startup', '--python', 'tools/blender/verify_assets_reimport.py',
          '--', '--out', resultPath('glb-clean-reimport'),
        ],
        env: { PYTHONDONTWRITEBYTECODE: '1' },
      }],
    },
    {
      id: 'runtime-paths', group: 'assets',
      description: 'Literal runtime image, audio, data, and GLB paths resolve inside the repository.',
      steps: [{
        command: NODE,
        args: ['tools/qa/validate-asset-manifests.mjs', '--gate', 'runtime-paths', '--out', resultPath('runtime-paths')],
      }],
    },
    {
      id: 'cleaning-sockets', group: 'cleaning',
      description: 'Cleaning tools attach to authored sockets and retain correct pivots.',
      steps: [testStep('tests/tool-sockets-and-occlusion.test.js', 'tests/cleaning-tool-registry.test.js')],
    },
    {
      id: 'cleaning-occlusion', group: 'cleaning',
      description: 'First-person tool geometry obeys the authored occlusion contract.',
      steps: [testStep('tests/tool-sockets-and-occlusion.test.js')],
    },
    {
      id: 'cleaning-wetness', group: 'cleaning',
      description: 'Wetness, solution, grime, and dry-cloth behavior remain deterministic and persistent.',
      steps: [testStep('tests/cleaning-wet-solution.test.js', 'tests/cleaning-save-persistence.test.js')],
    },
    {
      id: 'cleaning-debris', group: 'cleaning',
      description: 'Debris conservation, consolidation, pickup, and serialization remain valid.',
      steps: [testStep('tests/cleaning-debris.test.js', 'tests/cleaning-save-persistence.test.js')],
    },
    {
      id: 'cleaning-runtime', group: 'cleaning',
      description: 'Live broom, dustpan, vacuum, mop, spray, cloth, bag, and unequip smoke passes.',
      steps: [
        browserStep('cleaning-runtime', 'tools/qa/cleaning-tools-acceptance.js', {
          CLEANING_QA_ROOT: gateDir('cleaning-runtime'),
          QA_RESULT_PATH: path.join(gateDir('cleaning-runtime'), 'cleaning-tools-result.json'),
        }),
        browserStep('cleaning-runtime', 'tools/qa/pressure-washer-acceptance.js', {
          PRESSURE_WASHER_QA_ROOT: path.join(gateDir('cleaning-runtime'), 'pressure-washer'),
          QA_RESULT_PATH: path.join(gateDir('cleaning-runtime'), 'pressure-washer-result.json'),
        }),
      ],
    },
    {
      id: 'save-reload', group: 'persistence',
      description: 'Checkout and cleaning state survive real page reload without duplicate banking or lost state.',
      steps: [
        testStep('tests/simplified-register-save-reload-matrix.test.js', 'tests/cleaning-save-persistence.test.js'),
        browserStep('save-reload', 'tools/qa/simplified-register-save-reload.js', {
          REGISTER_QA_ROOT: gateDir('save-reload'),
          REGISTER_QA_QUICK: '1',
        }),
      ],
    },
    {
      id: 'resource-stabilization', group: 'performance',
      description: 'Scene, customer, merchandise, and stock resources dispose and stabilize after lifecycle churn.',
      steps: [
        testStep(
          'tests/character-resources.test.js',
          'tests/clubhouse-resource-lifecycle.test.js',
          'tests/dispose-scene-resources.test.js',
          'tests/merch-resource-lifecycle.test.js',
          'tests/stock-resources.test.js',
        ),
        browserStep('resource-stabilization', 'tools/qa/runtime-asset-residency.js', {
          ASSET_RESIDENCY_QA_ROOT: gateDir('resource-stabilization'),
        }),
      ],
    },
    {
      id: 'resolution-fov', group: 'performance',
      description: 'Nine fixed checkout-adjacent resolution/FOV cases retain render, layout, and resource health.',
      steps: [browserStep('resolution-fov', 'tools/qa/resolution-fov-performance.js', {
        HEADED: '1',
        QA_PERF_PHASE: 'integration-gate',
        RESOLUTION_FOV_QA_ROOT: gateDir('resolution-fov'),
      })],
    },
    {
      id: 'performance-comparison', group: 'performance',
      description: 'Candidate frame pacing and renderer/resource counts stay within the fixed baseline thresholds.',
      steps: performanceBaseline ? [{
        command: NODE,
        args: [
          'tools/qa/compare-performance-runs.mjs',
          '--before', path.resolve(performanceBaseline),
          '--after', resultPath('resolution-fov'),
          '--out', resultPath('performance-comparison'),
        ],
      }] : [],
      configurationError: performanceBaseline
        ? null : '--performance-baseline is required for performance-comparison.',
    },
    {
      id: 'full-tests', group: 'regression',
      description: 'The complete Node regression suite passes serially.',
      steps: [testStep()],
    },
    {
      id: 'branch-isolation', group: 'integration',
      description: 'Head descends from the selected base, is clean, is on the QA branch, and changes no runtime files.',
      steps: baseRef ? [{
        command: NODE,
        args: [
          'tools/qa/compare-integration-branch.mjs', '--base', baseRef, '--head', 'HEAD',
          '--expected-branch', 'overnight/qa-audit', '--qa-only', '--out', resultPath('branch-isolation'),
        ],
      }] : [],
      configurationError: baseRef ? null : '--base is required for branch-isolation.',
    },
  ];
  return definitions;
}

function parseArgs(argv) {
  const options = {
    port: 8471,
    startServer: false,
    dryRun: false,
    list: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--start-server') options.startServer = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--list') options.list = true;
    else if (arg === '--port') options.port = Number(argv[++index]);
    else if (arg === '--base-url') options.baseUrl = argv[++index];
    else if (arg === '--base') options.baseRef = argv[++index];
    else if (arg === '--performance-baseline') options.performanceBaseline = argv[++index];
    else if (arg === '--only') options.only = argv[++index].split(',').filter(Boolean);
    else if (arg === '--group') options.group = argv[++index];
    else if (arg === '--out') options.outputRoot = argv[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(options.port) || options.port <= 0 || options.port > 65535) {
    throw new Error(`Invalid --port: ${options.port}`);
  }
  options.baseUrl ||= `http://127.0.0.1:${options.port}/`;
  options.outputRoot ||= path.join('qa', 'overnight', 'integration-run');
  return options;
}

async function waitForServer(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Server did not become ready at ${url}: ${lastError?.message || 'timeout'}`);
}

async function serverAlreadyResponding(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(750) });
    return true;
  } catch {
    return false;
  }
}

function executeStep(step, { repositoryRoot, environment, logRoot, label }) {
  return new Promise((resolve) => {
    fs.mkdirSync(logRoot, { recursive: true });
    const stdoutPath = path.join(logRoot, `${label}.stdout.log`);
    const stderrPath = path.join(logRoot, `${label}.stderr.log`);
    const stdout = fs.createWriteStream(stdoutPath);
    const stderr = fs.createWriteStream(stderrPath);
    const started = Date.now();
    const child = spawn(step.command, step.args, {
      cwd: repositoryRoot,
      env: { ...process.env, ...environment, ...(step.env || {}) },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let spawnError = null;
    child.on('error', (error) => { spawnError = error; });
    child.stdout.pipe(stdout);
    child.stderr.pipe(stderr);
    child.on('close', (code, signal) => {
      stdout.end();
      stderr.end();
      resolve({
        ok: code === 0 && !spawnError,
        command: step.command,
        args: step.args,
        exitCode: code,
        signal,
        error: spawnError?.message || null,
        durationMs: Date.now() - started,
        stdout: stdoutPath.replaceAll('\\', '/'),
        stderr: stderrPath.replaceAll('\\', '/'),
      });
    });
  });
}

function markdown(report) {
  const rows = report.gates.map((gate) => (
    `| ${gate.id} | ${gate.status.toUpperCase()} | ${gate.durationMs} | ${gate.description.replaceAll('|', '\\|')} |`
  ));
  return [
    '# Integration gate run',
    '',
    `- Captured: ${report.capturedAt}`,
    `- Base URL: ${report.baseUrl}`,
    `- Overall: ${report.ok ? 'PASS' : 'FAIL'}`,
    '',
    '| Gate | Status | Duration (ms) | Contract |',
    '| --- | --- | ---: | --- |',
    ...rows,
    '',
  ].join('\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const repositoryRoot = process.cwd();
  const outputRoot = path.resolve(options.outputRoot);
  const definitions = createGateDefinitions({
    outputRoot,
    baseRef: options.baseRef,
    performanceBaseline: options.performanceBaseline,
  });
  if (options.list) {
    process.stdout.write(`${JSON.stringify(definitions.map(({ id, group, description, configurationError }) => ({
      id, group, description, configurationError,
    })), null, 2)}\n`);
    return;
  }
  const known = new Set(definitions.map((gate) => gate.id));
  for (const requested of options.only || []) {
    if (!known.has(requested)) throw new Error(`Unknown gate: ${requested}`);
  }
  const selected = definitions.filter((gate) => (
    (!options.only || options.only.includes(gate.id)) && (!options.group || gate.group === options.group)
  ));
  if (!selected.length) throw new Error('No gates matched the selection.');
  if (options.dryRun) {
    process.stdout.write(`${JSON.stringify({ ...options, selected }, null, 2)}\n`);
    return;
  }

  fs.mkdirSync(outputRoot, { recursive: true });
  let server = null;
  try {
    const needsBrowser = selected.some((gate) => gate.steps.some((step) => step.browser));
    if (options.startServer) {
      if (await serverAlreadyResponding(options.baseUrl)) {
        throw new Error(`Refusing to reuse occupied QA server URL: ${options.baseUrl}`);
      }
      server = spawn(NODE, ['tools/serve.cjs'], {
        cwd: repositoryRoot,
        env: { ...process.env, PORT: String(options.port) },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      server.stdout.pipe(fs.createWriteStream(path.join(outputRoot, 'server.stdout.log')));
      server.stderr.pipe(fs.createWriteStream(path.join(outputRoot, 'server.stderr.log')));
      const ready = await Promise.race([
        waitForServer(options.baseUrl).then(() => ({ ready: true })),
        new Promise((resolve) => server.once('exit', (code, signal) => resolve({
          ready: false, code, signal,
        }))),
      ]);
      if (!ready.ready) {
        throw new Error(`Owned QA server exited before readiness (code=${ready.code}, signal=${ready.signal}).`);
      }
    }
    if (needsBrowser && !options.startServer) await waitForServer(options.baseUrl);

    const results = [];
    for (const gate of selected) {
      const started = Date.now();
      if (gate.configurationError) {
        results.push({
          id: gate.id, description: gate.description, status: 'blocked',
          durationMs: 0, error: gate.configurationError, steps: [],
        });
        continue;
      }
      const steps = [];
      for (let index = 0; index < gate.steps.length; index += 1) {
        const step = await executeStep(gate.steps[index], {
          repositoryRoot,
          environment: { QA_BASE_URL: options.baseUrl },
          logRoot: path.join(outputRoot, gate.id),
          label: `step-${index + 1}`,
        });
        steps.push(step);
        if (!step.ok) break;
      }
      results.push({
        id: gate.id,
        description: gate.description,
        status: steps.length === gate.steps.length && steps.every((step) => step.ok) ? 'pass' : 'fail',
        durationMs: Date.now() - started,
        steps,
      });
    }
    const report = {
      schemaVersion: 1,
      capturedAt: new Date().toISOString(),
      repositoryRoot: repositoryRoot.replaceAll('\\', '/'),
      baseUrl: options.baseUrl,
      baseRef: options.baseRef || null,
      gates: results,
      ok: results.every((gate) => gate.status === 'pass'),
    };
    fs.writeFileSync(path.join(outputRoot, 'integration-gates.json'), `${JSON.stringify(report, null, 2)}\n`);
    fs.writeFileSync(path.join(outputRoot, 'integration-gates.md'), markdown(report));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ok) process.exitCode = 1;
  } finally {
    if (server && !server.killed) server.kill();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
