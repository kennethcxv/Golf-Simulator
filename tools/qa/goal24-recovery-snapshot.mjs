import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  constants as fsConstants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {
  dirname,
  isAbsolute,
  parse as parsePath,
  relative,
  resolve,
  sep,
} from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_BRANCH = 'feature/pro-shop-vertical-slice';
const COMMAND_TIMEOUT_MS = 30_000;
const MAX_BUFFER_BYTES = 128 * 1024 * 1024;
const CONTINUITY_COMMITS = Object.freeze([
  '8616f79', '76044b3', '46e62d8', '57f1092', '41a56b3',
  '663a049', '9002163', '88046fe', '8d55cb5', 'b914151',
  'f65f32d',
]);
const LFS_HOOKS = Object.freeze(['post-checkout', 'post-commit', 'post-merge', 'pre-push']);
const BLENDER_VALIDATION_PATHS = Object.freeze([
  'Assets/checkout/source/shopping_bag.blend',
  'asset_sources/blender/clubhouse/ledger_book.blend',
  'asset_sources/blender/assets_51_100/sheet_07/asset_061_front_desk_counter_shell.blend',
]);

export function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function runCommand(executable, args, {
  cwd = process.cwd(),
  required = true,
  timeoutMs = COMMAND_TIMEOUT_MS,
  env = {},
} = {}) {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER_BYTES,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: timeoutMs,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GCM_INTERACTIVE: 'Never',
      ...env,
    },
  });
  const record = {
    argv: [executable, ...args],
    cwd,
    exitCode: result.status,
    signal: result.signal || null,
    ok: result.status === 0 && !result.error,
    timedOut: result.error?.code === 'ETIMEDOUT',
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error ? String(result.error.message || result.error) : null,
  };
  if (required && !record.ok) {
    const error = new Error([
      `${record.argv.join(' ')} failed`,
      `exit=${record.exitCode ?? 'null'} signal=${record.signal ?? 'none'} timedOut=${record.timedOut}`,
      record.stderr.trim(),
      record.error,
    ].filter(Boolean).join('\n'));
    error.commandRecord = record;
    throw error;
  }
  return record;
}

export function discoverGitRoot(cwd = process.cwd()) {
  return resolve(runCommand('git', ['rev-parse', '--show-toplevel'], { cwd }).stdout.trim());
}

export function pathIsOutside(root, target) {
  const rel = relative(resolve(root), resolve(target));
  return rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel);
}

function nearestExisting(path) {
  let cursor = resolve(path);
  for (;;) {
    if (existsSync(cursor)) return cursor;
    const parent = dirname(cursor);
    if (parent === cursor) throw new Error(`No existing ancestor for ${path}`);
    cursor = parent;
  }
}

function assertInside(root, target, label) {
  const absRoot = resolve(root);
  const absTarget = resolve(target);
  if (pathIsOutside(absRoot, absTarget)) throw new Error(`${label} must stay inside ${absRoot}: ${absTarget}`);
  const realRoot = realpathSync.native(absRoot);
  const realAncestor = realpathSync.native(nearestExisting(absTarget));
  if (pathIsOutside(realRoot, realAncestor)) {
    throw new Error(`${label} escapes through a junction/symlink: ${absTarget} -> ${realAncestor}`);
  }
  return absTarget;
}

function assertOutside(root, target, label) {
  const absRoot = resolve(root);
  const absTarget = resolve(target);
  if (!pathIsOutside(absRoot, absTarget)) throw new Error(`${label} must be outside ${absRoot}: ${absTarget}`);
  if (absTarget === parsePath(absTarget).root) throw new Error(`${label} cannot be a filesystem root: ${absTarget}`);
  const realRoot = realpathSync.native(absRoot);
  const realAncestor = realpathSync.native(nearestExisting(absTarget));
  if (!pathIsOutside(realRoot, realAncestor)) {
    throw new Error(`${label} resolves back inside the repository: ${absTarget} -> ${realAncestor}`);
  }
  return absTarget;
}

function prepareEmptyDirectory(path, label) {
  if (existsSync(path)) {
    const stats = lstatSync(path);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error(`${label} must be a real directory: ${path}`);
    }
    if (readdirSync(path).length) throw new Error(`${label} must be new or empty: ${path}`);
  } else {
    mkdirSync(path, { recursive: true });
  }
  return realpathSync.native(path);
}

export function parsePorcelainV2(value) {
  const tokens = value.split('\0');
  const entries = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const line = tokens[index];
    if (!line || line.startsWith('# ')) continue;
    if (line.startsWith('? ')) {
      entries.push({ path: line.slice(2), originalPath: null, statusCode: '??', recordType: '?' });
      continue;
    }
    if (line.startsWith('1 ')) {
      const match = /^1 ([^ ]{2}) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([0-9a-f]+) ([0-9a-f]+) (.*)$/s.exec(line);
      if (!match) throw new Error(`Unparsed porcelain v2 ordinary record: ${line}`);
      entries.push({ path: match[8], originalPath: null, statusCode: match[1], recordType: '1' });
      continue;
    }
    if (line.startsWith('2 ')) {
      const match = /^2 ([^ ]{2}) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([0-9a-f]+) ([0-9a-f]+) ([^ ]+) (.*)$/s.exec(line);
      if (!match) throw new Error(`Unparsed porcelain v2 rename/copy record: ${line}`);
      const originalPath = tokens[++index];
      if (originalPath == null) throw new Error(`Missing original path for porcelain v2 record: ${line}`);
      entries.push({ path: match[9], originalPath, statusCode: match[1], recordType: '2' });
      continue;
    }
    if (line.startsWith('u ')) {
      const match = /^u ([^ ]{2}) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([0-9a-f]+) ([0-9a-f]+) ([0-9a-f]+) (.*)$/s.exec(line);
      if (!match) throw new Error(`Unparsed porcelain v2 unmerged record: ${line}`);
      entries.push({ path: match[10], originalPath: null, statusCode: match[1], recordType: 'u' });
      continue;
    }
    throw new Error(`Unsupported porcelain v2 record: ${line}`);
  }
  const seen = new Set();
  for (const entry of entries) {
    if (!entry.path || seen.has(entry.path)) throw new Error(`Duplicate or empty porcelain path: ${entry.path}`);
    seen.add(entry.path);
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

export function parseRemoteHead(stdout, branch = REQUIRED_BRANCH) {
  const wanted = `refs/heads/${branch}`;
  const rows = stdout.split(/\r?\n/).filter(Boolean).map((line) => line.split('\t'))
    .filter((parts) => parts[1] === wanted);
  if (rows.length !== 1 || !/^[0-9a-f]{40}$|^[0-9a-f]{64}$/i.test(rows[0]?.[0] || '')) {
    throw new Error(`Expected exactly one live remote row for ${wanted}; found ${rows.length}`);
  }
  return rows[0][0].toLowerCase();
}

export function parseLfsPointer(value) {
  if (!value.startsWith('version https://git-lfs.github.com/spec/v1\n')) return null;
  const oid = /^oid sha256:([0-9a-f]{64})$/m.exec(value)?.[1] || null;
  const size = Number(/^size (\d+)$/m.exec(value)?.[1]);
  return oid && Number.isSafeInteger(size) ? { oidSha256: oid, sizeBytes: size } : null;
}

export function verifyCopiedFile(source, destination, expectedSha256, expectedSizeBytes) {
  const sourceAfterSha256 = sha256(source);
  const destinationSha256 = sha256(destination);
  const destinationSizeBytes = statSync(destination).size;
  const verified = sourceAfterSha256 === expectedSha256
    && destinationSha256 === expectedSha256
    && destinationSizeBytes === expectedSizeBytes;
  if (!verified) {
    throw new Error(`Backup verification failed: ${source} -> ${destination}`);
  }
  return { sourceAfterSha256, destinationSha256, destinationSizeBytes, verified };
}

export function copyVerifiedExclusive(source, destination, expectedSha256, expectedSizeBytes) {
  copyFileSync(source, destination, fsConstants.COPYFILE_EXCL);
  return verifyCopiedFile(source, destination, expectedSha256, expectedSizeBytes);
}

function argValue(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

function commandText(commands) {
  return `${Object.entries(commands).map(([name, record]) => [
    `> ${name}`,
    `argv: ${record.argv.join(' ')}`,
    `cwd: ${record.cwd}`,
    `exit: ${record.exitCode ?? 'null'} signal: ${record.signal ?? 'none'} timedOut: ${record.timedOut}`,
    record.stdout.trimEnd(),
    record.stderr ? `[stderr]\n${record.stderr.trimEnd()}` : '',
    record.error ? `[error]\n${record.error}` : '',
  ].filter(Boolean).join('\n')).join('\n\n')}\n`;
}

function statusState(statusCode) {
  if (statusCode === '??') return 'untracked';
  if (statusCode.includes('U')) return 'unmerged';
  if (statusCode.includes('R') || statusCode.includes('C')) return 'renamed-or-copied';
  if (statusCode.includes('D')) return 'deleted';
  if (statusCode !== '..') return 'modified';
  return 'other';
}

function stableFingerprint(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function main() {
  const invokedFrom = process.cwd();
  const root = discoverGitRoot(invokedFrom);
  const git = (args, options = {}) => runCommand('git', args, { cwd: root, ...options });
  const commands = {};
  const capture = (name, args, options = {}) => {
    const record = git(args, options);
    commands[name] = record;
    return record;
  };

  const branch = capture('git branch --show-current', ['branch', '--show-current']).stdout.trim();
  if (branch !== REQUIRED_BRANCH) {
    throw new Error(`Goal 24 recovery is branch-locked to ${REQUIRED_BRANCH}; found ${branch || '(detached)'}.`);
  }
  const head = capture('git rev-parse HEAD', ['rev-parse', 'HEAD']).stdout.trim().toLowerCase();
  const trackingHead = capture(
    `git rev-parse origin/${REQUIRED_BRANCH}`,
    ['rev-parse', `origin/${REQUIRED_BRANCH}`],
  ).stdout.trim().toLowerCase();
  const liveRemoteRecord = capture(
    `git ls-remote --heads origin ${REQUIRED_BRANCH}`,
    ['ls-remote', '--heads', 'origin', REQUIRED_BRANCH],
    { timeoutMs: 60_000 },
  );
  const remoteHead = parseRemoteHead(liveRemoteRecord.stdout, REQUIRED_BRANCH);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = assertInside(root, resolve(root, argValue('out') || `qa/goal24/recovery/${stamp}`), 'Recovery evidence output');
  prepareEmptyDirectory(outDir, 'Recovery evidence output');

  const backupArg = argValue('backup-dir');
  const backupDir = backupArg ? assertOutside(root, resolve(backupArg), 'Recovery backup') : null;
  const realBackupDir = backupDir ? prepareEmptyDirectory(backupDir, 'Recovery backup') : null;

  const auditArg = argValue('audit-out');
  const auditPath = auditArg ? assertInside(root, resolve(root, auditArg), 'Durable audit output') : null;
  if (auditPath && existsSync(auditPath)) throw new Error(`Durable audit output already exists: ${auditPath}`);

  capture('git status --short', ['status', '--short', '--untracked-files=all']);
  const porcelain = capture(
    'git status --porcelain=v2 -z',
    ['status', '--porcelain=v2', '-z', '--untracked-files=all'],
  );
  capture('git status --porcelain=v2 --branch', ['status', '--porcelain=v2', '--branch', '--untracked-files=all']);
  capture('git log --oneline --decorate -30', ['log', '--oneline', '--decorate', '-30']);
  capture('git diff --stat', ['diff', '--stat']);
  capture('git diff', ['diff', '--no-ext-diff']);
  capture('git diff --cached', ['diff', '--cached', '--no-ext-diff']);
  capture('git remote -v', ['remote', '-v']);
  capture('git lfs status', ['lfs', 'status'], { timeoutMs: 60_000 });
  capture('git version', ['version']);
  capture('git lfs version', ['lfs', 'version']);
  const objectFormat = capture('git rev-parse --show-object-format', ['rev-parse', '--show-object-format'])
    .stdout.trim();
  const coreHooksPathRecord = capture(
    'git config --get core.hooksPath',
    ['config', '--get', 'core.hooksPath'],
    { required: false },
  );
  if (![0, 1].includes(coreHooksPathRecord.exitCode)) {
    throw new Error(`git config --get core.hooksPath failed with exit ${coreHooksPathRecord.exitCode}`);
  }

  const statusEntries = parsePorcelainV2(porcelain.stdout);
  const files = [];
  for (const status of statusEntries) {
    const abs = assertInside(root, resolve(root, status.path), `Dirty path ${status.path}`);
    const exists = existsSync(abs);
    if (exists && (!lstatSync(abs).isFile() || lstatSync(abs).isSymbolicLink())) {
      throw new Error(`Recovery only snapshots real files, not directories/symlinks: ${status.path}`);
    }
    const headPath = status.originalPath || status.path;
    // `ls-tree` returns exit 0 with empty stdout for an untracked path, so a
    // nonzero exit is never an expected "not found" signal and must fail shut.
    const tree = git(['ls-tree', '-z', 'HEAD', '--', headPath]);
    const treeMatch = /^\d+ blob ([0-9a-f]{40}|[0-9a-f]{64})\t/s.exec(tree.stdout);
    const headBlob = treeMatch ? treeMatch[1].toLowerCase() : null;
    const headSizeBytes = headBlob ? Number(git(['cat-file', '-s', headBlob]).stdout.trim()) : null;
    let headLfsPointer = null;
    if (headBlob && headSizeBytes <= 512) {
      headLfsPointer = parseLfsPointer(git(['cat-file', '-p', headBlob]).stdout);
    }
    const attributes = git(['check-attr', '-a', '--', status.path]).stdout.trim();
    const entry = {
      path: status.path.replaceAll('\\', '/'),
      originalPath: status.originalPath?.replaceAll('\\', '/') || null,
      recordType: status.recordType,
      statusCode: status.statusCode,
      tracked: status.statusCode !== '??',
      worktreeState: statusState(status.statusCode),
      exists,
      sizeBytes: exists ? statSync(abs).size : null,
      mtimeUtc: exists ? statSync(abs).mtime.toISOString() : null,
      sha256: exists ? sha256(abs) : null,
      headBlob,
      headSizeBytes,
      headStorage: headLfsPointer ? 'lfs-pointer' : (headBlob ? 'git-blob' : null),
      headLfsPointer,
      rawGitBlob: exists ? git(['hash-object', '--no-filters', '--', status.path]).stdout.trim() : null,
      filteredGitBlob: exists ? git(['hash-object', '--', status.path]).stdout.trim() : null,
      attributes,
      isLfsAttributed: /(?:^|\r?\n).*: filter: lfs(?:\r?\n|$)/.test(attributes),
    };
    entry.rawEqualsHead = !!entry.headBlob && entry.rawGitBlob === entry.headBlob;
    entry.logicalEqualsHead = !!entry.headBlob && (headLfsPointer
      ? entry.sha256 === headLfsPointer.oidSha256 && entry.sizeBytes === headLfsPointer.sizeBytes
      : entry.rawEqualsHead);
    files.push(entry);
  }

  const fingerprintInput = {
    branch,
    head,
    trackingHead,
    remoteHead,
    files: files.map((entry) => ({
      path: entry.path,
      originalPath: entry.originalPath,
      statusCode: entry.statusCode,
      exists: entry.exists,
      sizeBytes: entry.sizeBytes,
      sha256: entry.sha256,
      headBlob: entry.headBlob,
      logicalEqualsHead: entry.logicalEqualsHead,
    })),
  };
  const stateFingerprint = stableFingerprint(fingerprintInput);

  const activeHooksDir = resolve(root, git(['rev-parse', '--git-path', 'hooks']).stdout.trim());
  const hooks = LFS_HOOKS.map((name) => {
    const activePath = resolve(activeHooksDir, name);
    const strayPath = resolve(root, 'dev', 'null', name);
    const activeExists = existsSync(activePath) && lstatSync(activePath).isFile();
    const strayExists = existsSync(strayPath) && lstatSync(strayPath).isFile();
    const activeSha256 = activeExists ? sha256(activePath) : null;
    const straySha256 = strayExists ? sha256(strayPath) : null;
    return {
      name,
      activePath,
      strayPath,
      activeExists,
      strayExists,
      activeSha256,
      straySha256,
      byteIdentical: activeExists && strayExists && activeSha256 === straySha256,
    };
  });
  const hookCheck = {
    configuredCoreHooksPath: coreHooksPathRecord.exitCode === 0
      ? coreHooksPathRecord.stdout.trim() || null
      : null,
    activeHooksDir,
    hooks,
    ok: coreHooksPathRecord.exitCode === 1 && hooks.every((hook) => hook.byteIdentical),
  };

  const commitChecks = CONTINUITY_COMMITS.map((commit) => {
    const result = git(['merge-base', '--is-ancestor', commit, remoteHead], { required: false });
    if (![0, 1].includes(result.exitCode)) {
      throw new Error(`Unable to check ancestry for ${commit}: exit ${result.exitCode}`);
    }
    return { commit, remoteAncestor: result.exitCode === 0, command: result };
  });

  const blenderExeArg = argValue('blender-exe');
  const blender = blenderExeArg ? (() => {
    const executable = resolve(blenderExeArg);
    if (!existsSync(executable) || !lstatSync(executable).isFile()) {
      throw new Error(`Blender executable does not exist: ${executable}`);
    }
    const version = runCommand(executable, ['--version'], { cwd: root, timeoutMs: 30_000 });
    const expression = "import bpy, json; print('GOAL24_BLEND_READ_OK=' + json.dumps({'file': bpy.data.filepath, 'objects': len(bpy.data.objects), 'meshes': len(bpy.data.meshes), 'materials': len(bpy.data.materials), 'scenes': len(bpy.data.scenes)}))";
    const validations = BLENDER_VALIDATION_PATHS.map((repoPath) => {
      const path = assertInside(root, resolve(root, repoPath), `Blender validation ${repoPath}`);
      const beforeSha256 = sha256(path);
      const command = runCommand(executable, [
        '--background', '--factory-startup', '--disable-autoexec', path,
        '--python-expr', expression,
      ], { cwd: root, timeoutMs: 60_000 });
      const afterSha256 = sha256(path);
      const readMarkerSeen = command.stdout.includes('GOAL24_BLEND_READ_OK=');
      if (beforeSha256 !== afterSha256 || !readMarkerSeen) {
        throw new Error(`Blender read-only validation failed for ${repoPath}`);
      }
      return { path: repoPath, beforeSha256, afterSha256, unchanged: true, readMarkerSeen, command };
    });
    return { requested: true, executable, version, validations, ok: validations.every((row) => row.unchanged && row.readMarkerSeen) };
  })() : { requested: false, ok: null, validations: [] };

  const backupFiles = [];
  if (realBackupDir) {
    for (const entry of files) {
      const source = resolve(root, entry.path);
      const destination = resolve(realBackupDir, entry.path);
      if (pathIsOutside(realBackupDir, destination)) {
        throw new Error(`Backup destination escaped root: ${entry.path}`);
      }
      if (!entry.exists) {
        if (existsSync(destination)) throw new Error(`Deleted path unexpectedly exists in backup: ${entry.path}`);
        backupFiles.push({ path: entry.path, expectedAbsent: true, verified: true });
        continue;
      }
      mkdirSync(dirname(destination), { recursive: true });
      const realParent = realpathSync.native(dirname(destination));
      if (pathIsOutside(realBackupDir, realParent)) {
        throw new Error(`Backup parent escaped through a junction/symlink: ${entry.path}`);
      }
      backupFiles.push({
        path: entry.path,
        destination,
        expectedSha256: entry.sha256,
        expectedSizeBytes: entry.sizeBytes,
        ...copyVerifiedExclusive(source, destination, entry.sha256, entry.sizeBytes),
      });
    }
  }

  const endBranch = git(['branch', '--show-current']).stdout.trim();
  const endHead = git(['rev-parse', 'HEAD']).stdout.trim().toLowerCase();
  const endTrackingHead = git(['rev-parse', `origin/${REQUIRED_BRANCH}`]).stdout.trim().toLowerCase();
  const endRemoteHead = parseRemoteHead(
    git(['ls-remote', '--heads', 'origin', REQUIRED_BRANCH], { timeoutMs: 60_000 }).stdout,
    REQUIRED_BRANCH,
  );
  const endStatus = parsePorcelainV2(git([
    'status', '--porcelain=v2', '-z', '--untracked-files=all',
  ]).stdout);
  const endStatusShape = endStatus.map((entry) => ({
    path: entry.path.replaceAll('\\', '/'),
    originalPath: entry.originalPath?.replaceAll('\\', '/') || null,
    statusCode: entry.statusCode,
  }));
  const startStatusShape = files.map((entry) => ({
    path: entry.path,
    originalPath: entry.originalPath,
    statusCode: entry.statusCode,
  }));
  if (JSON.stringify(endStatusShape) !== JSON.stringify(startStatusShape)) {
    throw new Error('Worktree status changed while the recovery snapshot was running.');
  }
  for (const entry of files) {
    const path = resolve(root, entry.path);
    const stillExists = existsSync(path);
    if (stillExists !== entry.exists || (stillExists && sha256(path) !== entry.sha256)) {
      throw new Error(`Dirty path changed while the recovery snapshot was running: ${entry.path}`);
    }
  }
  const endFingerprint = stableFingerprint({
    branch: endBranch,
    head: endHead,
    trackingHead: endTrackingHead,
    remoteHead: endRemoteHead,
    files: fingerprintInput.files,
  });
  if (endFingerprint !== stateFingerprint) {
    throw new Error(`Recovery state drifted: ${stateFingerprint} -> ${endFingerprint}`);
  }

  const capturedAtUtc = new Date().toISOString();
  const checks = {
    stateStable: { ok: true, startFingerprint: stateFingerprint, endFingerprint },
    remote: {
      head,
      trackingHead,
      remoteHead,
      headMatchesTracking: head === trackingHead,
      headMatchesRemote: head === remoteHead,
      trackingMatchesRemote: trackingHead === remoteHead,
      ok: head === trackingHead && head === remoteHead,
    },
    backup: {
      requested: !!realBackupDir,
      directory: realBackupDir,
      files: backupFiles,
      copiedCount: backupFiles.filter((entry) => !entry.expectedAbsent).length,
      absentCount: backupFiles.filter((entry) => entry.expectedAbsent).length,
      ok: realBackupDir ? backupFiles.length === files.length && backupFiles.every((entry) => entry.verified) : null,
    },
    hooks: hookCheck,
    commits: { commits: commitChecks, ok: commitChecks.every((entry) => entry.remoteAncestor) },
    blender,
  };
  if (!checks.remote.ok || !checks.hooks.ok || !checks.commits.ok
    || (checks.backup.requested && !checks.backup.ok)
    || (checks.blender.requested && !checks.blender.ok)) {
    throw new Error('One or more required recovery checks failed.');
  }

  const snapshot = {
    schema: 'golf-flipper-goal24-recovery-v2',
    capturedAtUtc,
    invokedFrom,
    root,
    requiredBranch: REQUIRED_BRANCH,
    branch,
    head,
    trackingHead,
    remoteHead,
    headMatchesUpstream: head === trackingHead,
    headMatchesLiveRemote: head === remoteHead,
    objectFormat,
    outDir,
    backupDir: realBackupDir,
    stateFingerprint,
    commands,
    files,
    checks,
  };

  writeFileSync(resolve(outDir, 'recovery.json'), `${JSON.stringify(snapshot, null, 2)}\n`, { flag: 'wx' });
  writeFileSync(resolve(outDir, 'commands.txt'), commandText(commands), { flag: 'wx' });
  if (realBackupDir) {
    writeFileSync(resolve(realBackupDir, 'recovery-manifest.json'), `${JSON.stringify({
      schema: 'golf-flipper-goal24-backup-v2',
      capturedAtUtc,
      branch,
      head,
      trackingHead,
      remoteHead,
      sourceRoot: root,
      stateFingerprint,
      files,
      backupFiles,
    }, null, 2)}\n`, { flag: 'wx' });
  }

  if (auditPath) {
    mkdirSync(dirname(auditPath), { recursive: true });
    const durableAudit = {
      schema: 'golf-flipper-goal24-recovery-audit-v1',
      capturedAtUtc,
      generatedAfterStableCapture: true,
      branch,
      head,
      trackingHead,
      remoteHead,
      objectFormat,
      stateFingerprint,
      evidenceDirectory: relative(root, outDir).replaceAll('\\', '/'),
      externalBackupDirectory: realBackupDir,
      counts: {
        dirtyPaths: files.length,
        tracked: files.filter((entry) => entry.tracked).length,
        untracked: files.filter((entry) => !entry.tracked).length,
        modified: files.filter((entry) => entry.worktreeState === 'modified').length,
        deleted: files.filter((entry) => entry.worktreeState === 'deleted').length,
        lfsAttributed: files.filter((entry) => entry.isLfsAttributed).length,
        lfsLogicalEqualsHead: files.filter((entry) => entry.isLfsAttributed && entry.logicalEqualsHead).length,
        lfsLogicalChanged: files.filter((entry) => entry.isLfsAttributed && !entry.logicalEqualsHead).length,
      },
      files: files.map((entry) => ({
        path: entry.path,
        statusCode: entry.statusCode,
        worktreeState: entry.worktreeState,
        exists: entry.exists,
        sizeBytes: entry.sizeBytes,
        sha256: entry.sha256,
        headBlob: entry.headBlob,
        headStorage: entry.headStorage,
        isLfsAttributed: entry.isLfsAttributed,
        logicalEqualsHead: entry.logicalEqualsHead,
      })),
      checks,
    };
    writeFileSync(auditPath, `${JSON.stringify(durableAudit, null, 2)}\n`, { flag: 'wx' });
  }

  console.log(JSON.stringify({
    outDir,
    auditPath,
    backupDir: realBackupDir,
    branch,
    head,
    trackingHead,
    remoteHead,
    stateFingerprint,
    dirtyPathCount: files.length,
    copiedFileCount: backupFiles.filter((entry) => !entry.expectedAbsent).length,
    absentPathCount: backupFiles.filter((entry) => entry.expectedAbsent).length,
    checks: {
      remote: checks.remote.ok,
      backup: checks.backup.ok,
      hooks: checks.hooks.ok,
      commits: checks.commits.ok,
      blender: checks.blender.ok,
    },
  }, null, 2));
}

const isMain = process.argv[1]
  && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    main();
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  }
}
