import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ALWAYS_REQUIRED = ['boot', 'console', 'full-tests', 'branch-isolation'];

function git(repositoryRoot, args, { allowFailure = false } = {}) {
  const result = spawnSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`git ${args.join(' ')} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

export function classifyChangedPath(inputPath) {
  const file = String(inputPath).replaceAll('\\', '/');
  const tags = new Set();
  if (/^(src|index\.html|main\.cjs|package(?:-lock)?\.json)(?:\/|$)/.test(file)) tags.add('runtime');
  if (/(cashier|checkout|register|receipt|scanner|card|cash|customer|bag)/i.test(file)) tags.add('checkout');
  if (/(save|snapshot|persist|storage|empire)/i.test(file)) tags.add('save');
  if (/(shader|material|terrain|ground|postprocess|webgl)/i.test(file)) tags.add('shader');
  if (/\.(?:glb|gltf|blend)$/i.test(file) || /(?:assets|models|vendor\/models)/i.test(file)) tags.add('asset');
  if (/(clean|debris|grime|wet|occlusion|socket|washer|broom|mop|vacuum)/i.test(file)) tags.add('cleaning');
  if (/(course-editor|editor\/|course\/)/i.test(file)) tags.add('editor');
  if (/^(tools\/qa|tests|qa)(?:\/|$)/.test(file)) tags.add('qa');
  if (/^docs(?:\/|$)/.test(file)) tags.add('docs');
  return [...tags].sort();
}

export function requiredGatesForChanges(changes) {
  const tags = new Set(changes.flatMap((change) => change.tags || classifyChangedPath(change.path)));
  const gates = new Set(ALWAYS_REQUIRED);
  if (tags.has('runtime')) ['runtime-paths', 'performance', 'resolution-fov'].forEach((gate) => gates.add(gate));
  if (tags.has('checkout')) ['checkout-card', 'checkout-cash', 'save-reload'].forEach((gate) => gates.add(gate));
  if (tags.has('save')) gates.add('save-reload');
  if (tags.has('shader')) gates.add('shaders');
  if (tags.has('asset')) ['asset-manifests', 'glb-clean-reimport', 'runtime-paths'].forEach((gate) => gates.add(gate));
  if (tags.has('cleaning')) ['cleaning-runtime', 'save-reload'].forEach((gate) => gates.add(gate));
  if (tags.has('editor')) ['editor-tools', 'resource-stabilization', 'performance'].forEach((gate) => gates.add(gate));
  return [...gates].sort();
}

function resolveCommit(repositoryRoot, ref) {
  const result = git(repositoryRoot, ['rev-parse', '--verify', `${ref}^{commit}`], { allowFailure: true });
  return result.ok ? result.stdout.trim() : null;
}

function parseNameStatus(raw) {
  const tokens = raw.split('\0');
  if (tokens.at(-1) === '') tokens.pop();
  const changes = [];
  for (let index = 0; index < tokens.length;) {
    const status = tokens[index++];
    if (/^[RC]/.test(status)) {
      const previousPath = tokens[index++];
      const filePath = tokens[index++];
      changes.push({ status, previousPath, path: filePath, tags: classifyChangedPath(filePath) });
    } else {
      const filePath = tokens[index++];
      changes.push({ status, path: filePath, tags: classifyChangedPath(filePath) });
    }
  }
  return changes;
}

export function compareIntegrationBranch({
  repositoryRoot = process.cwd(),
  base,
  head = 'HEAD',
  expectedBranch = null,
  qaOnly = false,
} = {}) {
  if (!base) throw new Error('A base ref or commit is required.');
  const root = path.resolve(repositoryRoot);
  const baseCommit = resolveCommit(root, base);
  const headCommit = resolveCommit(root, head);
  const currentBranch = git(root, ['branch', '--show-current']).stdout.trim() || null;
  const dirtyEntries = git(root, ['status', '--porcelain=v1', '--untracked-files=all']).stdout
    .split(/\r?\n/).filter(Boolean);
  const errors = [];
  if (!baseCommit) errors.push(`Base ref does not resolve: ${base}`);
  if (!headCommit) errors.push(`Head ref does not resolve: ${head}`);

  let mergeBase = null;
  let baseIsAncestor = false;
  let changes = [];
  let commits = [];
  if (baseCommit && headCommit) {
    mergeBase = git(root, ['merge-base', baseCommit, headCommit], { allowFailure: true }).stdout.trim() || null;
    baseIsAncestor = git(root, ['merge-base', '--is-ancestor', baseCommit, headCommit], { allowFailure: true }).ok;
    changes = parseNameStatus(git(root, ['diff', '--name-status', '-z', '--find-renames', `${baseCommit}..${headCommit}`]).stdout);
    commits = git(root, ['log', '--format=%H%x09%ad%x09%s', '--date=iso-strict', `${baseCommit}..${headCommit}`]).stdout
      .split(/\r?\n/).filter(Boolean).map((line) => {
        const [commit, authoredAt, ...subject] = line.split('\t');
        return { commit, authoredAt, subject: subject.join('\t') };
      });
    if (!baseIsAncestor) errors.push('Base is not an ancestor of head.');
  }
  if (expectedBranch && currentBranch !== expectedBranch) {
    errors.push(`Expected branch ${expectedBranch}; found ${currentBranch || '(detached)'}.`);
  }
  if (dirtyEntries.length) errors.push('Worktree has uncommitted changes.');

  const productionChanges = changes.filter((change) => change.tags.includes('runtime'));
  if (qaOnly && productionChanges.length) errors.push('QA-only branch modifies production/runtime paths.');

  return {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    repositoryRoot: root.replaceAll('\\', '/'),
    requested: { base, head, expectedBranch, qaOnly },
    resolved: { baseCommit, headCommit, mergeBase, currentBranch, baseIsAncestor },
    clean: dirtyEntries.length === 0,
    dirtyEntries,
    commitCount: commits.length,
    commits,
    changedFileCount: changes.length,
    changes,
    productionChanges: productionChanges.map((change) => change.path),
    requiredGates: requiredGatesForChanges(changes),
    errors,
    ok: errors.length === 0,
  };
}

function parseArgs(argv) {
  const options = { head: 'HEAD', qaOnly: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--qa-only') options.qaOnly = true;
    else if (arg === '--base') options.base = argv[++index];
    else if (arg === '--head') options.head = argv[++index];
    else if (arg === '--expected-branch') options.expectedBranch = argv[++index];
    else if (arg === '--out') options.out = argv[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function main() {
  const { out, ...options } = parseArgs(process.argv.slice(2));
  const report = compareIntegrationBranch(options);
  const body = `${JSON.stringify(report, null, 2)}\n`;
  if (out) {
    const outputPath = path.resolve(out);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, body);
  }
  process.stdout.write(body);
  if (!report.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
