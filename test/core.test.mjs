import test from 'node:test';
import assert from 'node:assert/strict';
import { ConfigError, summarize } from '../src/index.mjs';

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

test('a zero exit with truncated or missing stream evidence is not called success', () => {
  for (const change of [{ stdoutTruncated: true }, { stderr: undefined }]) {
    const document = clean();
    Object.assign(document.results[0], change);
    const report = summarize(document, { now: () => 0 });
    assert.equal(report.status, 'incomplete');
    assert.equal(report.results[0].disposition, 'unknown');
    assert.equal(report.results[0].hint, 'Obtain a complete saved result before relying on this summary.');
    assert.ok(report.findings.some(f => ['output-truncated', 'result-invalid'].includes(f.ruleId)));
  }
  assert.equal(summarize(clean(), { now: () => 0 }).results[0].disposition, 'success');
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

test('an empty export and unsupported result fields are incomplete, not vacuous pass', () => {
  const empty = summarize({ schemaVersion: '1', results: [] }, { now: () => 0 });
  assert.equal(empty.status, 'incomplete');
  assert.equal(empty.summary.checked, 0);
  assert.deepEqual(empty.findings.map(f => f.ruleId), ['export-invalid']);
  const document = clean();
  document.results[0].command = 'token=SYNTHETIC_SECRET_CANARY';
  const extra = summarize(document, { now: () => 0 });
  assert.equal(extra.status, 'incomplete');
  assert.deepEqual(extra.findings.map(f => f.ruleId), ['result-invalid']);
  assert.equal(JSON.stringify(extra).includes('SYNTHETIC_SECRET_CANARY'), false);
});

test('records bound accepts exactly 128 results and refuses the 129th', () => {
  const result = clean().results[0];
  const at = summarize({ schemaVersion: '1', results: Array.from({ length: 128 }, () => ({ ...result })) }, { now: () => 0 });
  const extra = [...Array.from({ length: 128 }, () => ({ ...result })), { ...result, exitCode: 7 }];
  const over = summarize({ schemaVersion: '1', results: extra }, { now: () => 0 });
  assert.equal(at.status, 'pass');
  assert.equal(at.summary.checked, 128);
  assert.equal(at.results.length, 128);
  assert.equal(over.status, 'incomplete');
  assert.equal(over.summary.results, 129);
  assert.equal(over.summary.checked, 128);
  assert.equal(over.results.length, 128);
  assert.ok(over.findings.some(f => f.ruleId === 'limit-exceeded' && f.location.pointer === '/limits/maxResults'));
  assert.ok(!over.findings.some(f => f.ruleId === 'exit-nonzero'));
});

test('stream unit and line bounds are silent at N and incomplete at N plus one', () => {
  const limits = { maxStreamUnits: 5, maxLines: 2 };
  const document = clean();
  document.results[0].stdout = 'ab\ncd';
  assert.equal(summarize(document, { now: () => 0, limits }).status, 'pass');
  document.results[0].stdout = 'ab\ncd!';
  let report = summarize(document, { now: () => 0, limits });
  assert.equal(report.status, 'incomplete');
  assert.ok(report.findings.some(f => f.location.pointer === '/limits/maxStreamUnits'));
  document.results[0].stdout = 'a\nb\nc';
  report = summarize(document, { now: () => 0, limits });
  assert.equal(report.status, 'incomplete');
  assert.ok(report.findings.some(f => f.location.pointer === '/limits/maxLines'));
});

test('inherited object property names are not accepted as limit overrides', () => {
  for (const key of ['toString', 'constructor', '__proto__']) {
    const limits = JSON.parse(`{"${key}":1}`);
    assert.throws(() => summarize(clean(), { now: () => 0, limits }), ConfigError);
  }
  assert.equal(summarize(clean(), { now: () => 0, limits: { maxResults: 1 } }).status, 'pass');
});

test('injected clock accepts exact deadline but refuses N plus one and invalid readings', () => {
  const limits = { timeoutMs: 1 };
  const clock = end => { let calls = 0; return () => calls++ === 0 ? 0 : end; };
  assert.equal(summarize(clean(), { now: clock(1), limits }).status, 'pass');
  const late = summarize(clean(), { now: clock(2), limits });
  assert.equal(late.status, 'incomplete');
  assert.ok(late.findings.some(f => f.ruleId === 'limit-exceeded' && f.location.pointer === '/limits/timeoutMs'));
  assert.equal(summarize(clean(), { now: () => NaN }).status, 'incomplete');
  const backward = (() => { let calls = 0; return () => calls++ === 0 ? 1 : 0; })();
  assert.equal(summarize(clean(), { now: backward }).status, 'incomplete');
});

test('the final clock reading can invalidate an otherwise completed one-result run', () => {
  const readings = [0, 0, 2];
  const report = summarize(clean(), { now: () => readings.shift() ?? 2, limits: { timeoutMs: 1 } });
  assert.equal(report.status, 'incomplete');
  assert.ok(report.findings.some(f => f.ruleId === 'limit-exceeded' && f.location.pointer === '/limits/timeoutMs'));
});

test('finding pointers use UTF-16 code-unit order for two different result indexes', () => {
  const result = clean().results[0];
  const results = Array.from({ length: 11 }, () => ({ ...result }));
  results[2].exitCode = null;
  results[10].exitCode = null;
  const report = summarize({ schemaVersion: '1', results }, { now: () => 0 });
  assert.equal(report.status, 'incomplete');
  assert.deepEqual(report.findings.map(f => f.location.pointer), ['/results/10/exitCode', '/results/2/exitCode']);
});
