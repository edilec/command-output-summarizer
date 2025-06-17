import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const bin = resolve('bin/command-output-summarizer.mjs');
const guard = resolve('support/deny-network.mjs');
const run = (...args) => spawnSync(process.execPath, ['--import', guard, bin, ...args], { encoding: 'utf8' });
const example = name => resolve('examples', name);

test('saved examples exercise real CLI exits zero, one and two without output echoes', () => {
  for (const [name, exit, status] of [['clean', 0, 'pass'], ['failing', 1, 'fail'], ['incomplete', 2, 'incomplete']]) {
    const root = example(name);
    const child = run('--root', root, '--input', 'input.json');
    assert.equal(child.status, exit, child.stderr);
    const report = JSON.parse(child.stdout);
    assert.equal(report.status, status);
    assert.equal(report.tool, 'command-output-summarizer');
    assert.match(child.stderr, /^(?:pass|fail|incomplete): \d+ results, \d+ errors, \d+ warnings\n$/u);
    assert.equal(child.stdout.includes('synthetic failure'), false);
  }
});

test('help, JSON-only mode and invalid configuration keep their distinct streams', () => {
  const help = run('--help');
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--root DIR --input FILE/u);
  assert.equal(help.stderr, '');
  const root = example('clean');
  const json = run('--root', root, '--input', 'input.json', '--json');
  assert.equal(json.status, 0);
  assert.equal(json.stderr, '');
  const bad = run('--root', root, '--input', 'input.json', '--json', '--bad-option=SYNTHETIC_SECRET_CANARY');
  assert.equal(bad.status, 2);
  assert.equal(bad.stdout, '');
  assert.equal(bad.stderr, 'Invalid CLI configuration.\n');
  const rootFile = run('--root', resolve('package.json'), '--input', 'input.json');
  assert.equal(rootFile.status, 2);
  assert.equal(rootFile.stdout, '');
});

test('a missing or malformed named input yields incomplete JSON, not a usage error', () => {
  const root = mkdtempSync(join(tmpdir(), 'command-output-input-'));
  try {
    const missing = run('--root', root, '--input', 'input.json');
    assert.equal(missing.status, 2);
    assert.equal(JSON.parse(missing.stdout).status, 'incomplete');
    assert.deepEqual(JSON.parse(missing.stdout).findings.map(f => f.ruleId), ['input-unreadable']);
    writeFileSync(join(root, 'input.json'), '{"results": token=SYNTHETIC_SECRET_CANARY}');
    const malformed = run('--root', root, '--input', 'input.json');
    assert.equal(malformed.status, 2);
    assert.deepEqual(JSON.parse(malformed.stdout).findings.map(f => f.ruleId), ['input-invalid']);
    assert.equal(malformed.stdout.includes('SYNTHETIC_SECRET_CANARY'), false);
    assert.equal(malformed.stderr.includes('SYNTHETIC_SECRET_CANARY'), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a named input symlink cannot pull evidence from outside the real root', () => {
  const root = mkdtempSync(join(tmpdir(), 'command-output-root-'));
  const outside = mkdtempSync(join(tmpdir(), 'command-output-outside-'));
  try {
    writeFileSync(join(outside, 'secret.json'), '{"schemaVersion":"1","results":[],"note":"SYNTHETIC_SECRET_CANARY"}');
    symlinkSync(join(outside, 'secret.json'), join(root, 'input.json'));
    const child = run('--root', root, '--input', 'input.json');
    assert.equal(child.status, 2);
    const report = JSON.parse(child.stdout);
    assert.equal(report.status, 'incomplete');
    assert.deepEqual(report.findings.map(f => f.ruleId), ['path-outside-root']);
    assert.equal(child.stdout.includes('SYNTHETIC_SECRET_CANARY'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('input byte bound accepts exactly 1048576 bytes and refuses the next byte', () => {
  const root = mkdtempSync(join(tmpdir(), 'command-output-bytes-'));
  try {
    const document = JSON.stringify({ schemaVersion: '1', results: [{ exitCode: 0, stdout: '', stderr: '', stdoutTruncated: false, stderrTruncated: false }] });
    const input = join(root, 'input.json');
    writeFileSync(input, document + ' '.repeat(1048576 - Buffer.byteLength(document)));
    const at = run('--root', root, '--input', 'input.json');
    assert.equal(at.status, 0, at.stderr);
    assert.equal(JSON.parse(at.stdout).status, 'pass');
    writeFileSync(input, document + ' '.repeat(1048577 - Buffer.byteLength(document)));
    const over = run('--root', root, '--input', 'input.json');
    assert.equal(over.status, 2);
    assert.equal(JSON.parse(over.stdout).status, 'incomplete');
    assert.deepEqual(JSON.parse(over.stdout).findings.map(f => f.location.pointer), ['/limits/maxBytes']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('identical saved input produces byte-identical JSON stdout', () => {
  const root = example('clean');
  const first = run('--root', root, '--input', 'input.json');
  const second = run('--root', root, '--input', 'input.json');
  assert.equal(first.status, 0);
  assert.equal(first.stdout, second.stdout);
});
