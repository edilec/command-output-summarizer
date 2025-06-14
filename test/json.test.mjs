import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStrictJson } from '../src/json.mjs';

test('strict JSON accepts a complete saved export and decodes escaped keys', () => {
  const value = parseStrictJson('{"schemaVersion":"1","results":[{"exitCode":0,"stdout":"","stderr":"","stdoutTruncated":false,"stderrTruncated":false}]}');
  assert.equal(value.results[0].exitCode, 0);
  assert.deepEqual(parseStrictJson('{"\\u0061":true}'), { a: true });
});

test('escaped-equivalent duplicate JSON keys cannot erase export evidence', () => {
  assert.throws(() => parseStrictJson('{"exitCode":1,"\\u0065xitCode":0}'), /Duplicate JSON key/);
});

test('unsupported fractional or over-range numeric spelling cannot round into an exit', () => {
  assert.throws(() => parseStrictJson('{"exitCode":0.9999999999999999999}'), /number/i);
  assert.throws(() => parseStrictJson('{"exitCode":256}'), /number/i);
  assert.equal(parseStrictJson('{"exitCode":255}').exitCode, 255);
});

test('strict JSON depth and node limits are inclusive at N and reject N plus one', () => {
  assert.deepEqual(parseStrictJson('{"a":{"b":0}}', { maxDepth: 2 }), { a: { b: 0 } });
  assert.throws(() => parseStrictJson('{"a":{"b":0}}', { maxDepth: 1 }), /depth/i);
  assert.deepEqual(parseStrictJson('[0,1]', { maxNodes: 3 }), [0, 1]);
  assert.throws(() => parseStrictJson('[0,1]', { maxNodes: 2 }), /nodes/i);
});

test('malformed JSON diagnostics do not echo a synthetic secret canary', () => {
  assert.throws(() => parseStrictJson('{"exitCode": token=SYNTHETIC_SECRET_CANARY}'), error => {
    assert.equal(error.message.includes('SYNTHETIC_SECRET_CANARY'), false);
    return true;
  });
});
