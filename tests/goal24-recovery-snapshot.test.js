import assert from 'node:assert/strict';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  copyVerifiedExclusive,
  discoverGitRoot,
  parseLfsPointer,
  parsePorcelainV2,
  parseRemoteHead,
  pathIsOutside,
  runCommand,
  sha256,
  verifyCopiedFile,
} from '../tools/qa/goal24-recovery-snapshot.mjs';

test('recovery path containment distinguishes dot-dot names from parent traversal', () => {
  const root = resolve('C:/repo');
  assert.equal(pathIsOutside(root, resolve(root, '..evidence')), false);
  assert.equal(pathIsOutside(root, resolve(root, '..backup')), false);
  assert.equal(pathIsOutside(root, resolve(root, '..', 'backup')), true);
  assert.equal(pathIsOutside(root, root), false);
});

test('recovery discovers the repository root when invoked from a nested directory', () => {
  assert.equal(discoverGitRoot(resolve('tools/qa')), resolve('.'));
});

test('porcelain v2 parser preserves spaces, XY columns, renames, conflicts, and untracked paths', () => {
  const hashA = 'a'.repeat(40);
  const hashB = 'b'.repeat(40);
  const input = [
    `1 .M N... 100644 100644 100644 ${hashA} ${hashB} src/file with space.js`,
    `2 R. N... 100644 100644 100644 ${hashA} ${hashB} R100 src/new name.js`,
    'src/old name.js',
    `u UU N... 100644 100644 100644 100644 ${hashA} ${hashB} ${hashA} conflict file.js`,
    '? untracked name.txt',
    '',
  ].join('\0');
  assert.deepEqual(parsePorcelainV2(input), [
    { path: 'conflict file.js', originalPath: null, statusCode: 'UU', recordType: 'u' },
    { path: 'src/file with space.js', originalPath: null, statusCode: '.M', recordType: '1' },
    { path: 'src/new name.js', originalPath: 'src/old name.js', statusCode: 'R.', recordType: '2' },
    { path: 'untracked name.txt', originalPath: null, statusCode: '??', recordType: '?' },
  ]);
});

test('live remote parser requires one exact branch and accepts SHA-1 or SHA-256 object ids', () => {
  const sha1 = 'a'.repeat(40);
  const sha256Oid = 'b'.repeat(64);
  assert.equal(parseRemoteHead(`${sha1}\trefs/heads/feature/pro-shop-vertical-slice\n`), sha1);
  assert.equal(
    parseRemoteHead(`${sha256Oid}\trefs/heads/topic\n`, 'topic'),
    sha256Oid,
  );
  assert.throws(() => parseRemoteHead(''), /exactly one live remote row/);
  assert.throws(
    () => parseRemoteHead(`${sha1}\trefs/heads/topic\n`, 'missing'),
    /exactly one live remote row/,
  );
});

test('LFS pointer parser exposes logical content identity', () => {
  const oid = 'c'.repeat(64);
  assert.deepEqual(parseLfsPointer([
    'version https://git-lfs.github.com/spec/v1',
    `oid sha256:${oid}`,
    'size 1234',
    '',
  ].join('\n')), { oidSha256: oid, sizeBytes: 1234 });
  assert.equal(parseLfsPointer('ordinary git blob'), null);
});

test('structured command records retain stderr, exit status, and timeout state', () => {
  const failed = runCommand(process.execPath, [
    '-e', "process.stderr.write('intentional stderr'); process.exit(7)",
  ], { required: false });
  assert.equal(failed.ok, false);
  assert.equal(failed.exitCode, 7);
  assert.match(failed.stderr, /intentional stderr/);
  assert.equal(failed.timedOut, false);

  const timed = runCommand(process.execPath, [
    '-e', 'setTimeout(() => {}, 5000)',
  ], { required: false, timeoutMs: 50 });
  assert.equal(timed.ok, false);
  assert.equal(timed.timedOut, true);
});

test('exclusive backup copy verifies both endpoints and refuses overwrite or drift', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'golf-goal24-recovery-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = join(dir, 'source.bin');
  const destination = join(dir, 'backup', 'source.bin');
  mkdirSync(join(dir, 'backup'));
  writeFileSync(source, Buffer.from('baseline bytes'));
  const expectedSha256 = sha256(source);
  const expectedSizeBytes = readFileSync(source).length;
  assert.equal(
    copyVerifiedExclusive(source, destination, expectedSha256, expectedSizeBytes).verified,
    true,
  );
  assert.throws(
    () => copyVerifiedExclusive(source, destination, expectedSha256, expectedSizeBytes),
    /EEXIST|exist/i,
  );

  const raced = join(dir, 'raced.bin');
  copyFileSync(source, raced);
  writeFileSync(source, Buffer.from('mutated after capture'));
  assert.throws(
    () => verifyCopiedFile(source, raced, expectedSha256, expectedSizeBytes),
    /Backup verification failed/,
  );
});
