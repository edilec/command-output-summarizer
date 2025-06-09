import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from '../src/index.mjs';

const clean = () => ({
  schemaVersion: '1',
  results: [{ exitCode: 0, stdout: 'synthetic-ok', stderr: '', stdoutTruncated: false, stderrTruncated: false }],
});

test('one complete zero-exit saved result passes without echoing its output', () => {
  const report = summarize(clean(), { now: () => 0 });
  assert.equal(report.tool, 'command-output-summarizer');
  assert.equal(report.status, 'pass');
  assert.deepEqual(report.summary, { checked: 1, errors: 0, warnings: 0, results: 1 });
  assert.deepEqual(report.findings, []);
  assert.equal(JSON.stringify(report).includes('synthetic-ok'), false);
});

test('a nonzero saved exit remains a failure despite reassuring output text', () => {
  const document = clean();
  document.results[0] = { ...document.results[0], exitCode: 7, stdout: 'all checks passed' };
  const report = summarize(document, { now: () => 0 });
  assert.equal(report.status, 'fail');
  assert.equal(report.summary.checked, 1);
  assert.deepEqual(report.findings.map(f => [f.ruleId, f.severity, f.location.pointer]), [
    ['exit-nonzero', 'error', '/results/0/exitCode'],
  ]);
  assert.equal(report.results[0].disposition, 'failure');
  assert.equal(JSON.stringify(report).includes('all checks passed'), false);
});

test('a missing exit is incomplete, not success or failure inferred from text', () => {
  const document = clean();
  document.results[0].exitCode = null;
  document.results[0].stdout = 'success';
  const report = summarize(document, { now: () => 0 });
  assert.equal(report.status, 'incomplete');
  assert.equal(report.summary.checked, 0);
  assert.deepEqual(report.findings.map(f => [f.ruleId, f.location.pointer]), [
    ['exit-unavailable', '/results/0/exitCode'],
  ]);
  assert.equal(report.results[0].disposition, 'unknown');
});

test('truncated output makes the run incomplete but retains a proven failure', () => {
  const document = clean();
  document.results[0].exitCode = 2;
  document.results[0].stderrTruncated = true;
  document.results[0].stderr = 'error: token=SYNTHETIC_SECRET_CANARY';
  const report = summarize(document, { now: () => 0 });
  assert.equal(report.status, 'incomplete');
  assert.equal(report.summary.checked, 1);
  assert.deepEqual(report.findings.map(f => [f.ruleId, f.severity, f.location.pointer]), [
    ['exit-nonzero', 'error', '/results/0/exitCode'],
    ['output-truncated', 'warning', '/results/0/stderr'],
  ]);
  assert.equal(JSON.stringify(report).includes('SYNTHETIC_SECRET_CANARY'), false);
});

test('a salient error line is located without copying its secret-shaped text', () => {
  const document = clean();
  document.results[0].exitCode = 1;
  document.results[0].stderr = 'a harmless preface\r\nERROR token=SYNTHETIC_SECRET_CANARY\n';
  const report = summarize(document, { now: () => 0 });
  assert.equal(report.status, 'fail');
  assert.deepEqual(report.results[0].salient, {
    stream: 'stderr', line: 2, class: 'error', pointer: '/results/0/stderr/line/2',
  });
  assert.equal(JSON.stringify(report).includes('SYNTHETIC_SECRET_CANARY'), false);
});
