export const TOOL_ID = 'command-output-summarizer';
export class ConfigError extends Error {}

export const DEFAULT_LIMITS = Object.freeze({
  maxBytes: 1048576, maxResults: 128, maxStreamUnits: 65536, maxLines: 4096, timeoutMs: 2000,
});

const RULE_SEVERITY = Object.freeze({
  'exit-nonzero': 'error',
  'exit-unavailable': 'warning',
  'output-truncated': 'warning',
  'result-invalid': 'warning',
  'export-invalid': 'warning',
  'limit-exceeded': 'warning',
  'clock-invalid': 'warning',
  'input-unreadable': 'warning',
  'input-invalid': 'warning',
  'path-outside-root': 'warning',
  'input-alias-unsupported': 'warning',
});
const byCodeUnit = (a, b) => a === b ? 0 : a < b ? -1 : 1;
const FILENAME = 'input.json';
const safePath = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/u;
export const isSafePath = value => typeof value === 'string' && value.length <= 256 && safePath.test(value) &&
  !value.split('/').some(part => !part || part === '.');

export function incompleteInput(file, ruleId, pointer = '') {
  if (!isSafePath(file) || !['input-unreadable', 'input-invalid', 'path-outside-root',
    'input-alias-unsupported', 'limit-exceeded'].includes(ruleId)) throw new ConfigError('Invalid input report.');
  const message = {
    'input-unreadable': 'Named input could not be read or decoded.',
    'input-invalid': 'Named input is not a supported JSON export.',
    'path-outside-root': 'Named input resolves outside the declared root.',
    'input-alias-unsupported': 'Named input is an alias with ambiguous provenance.',
    'limit-exceeded': 'Named input exceeds the byte limit.',
  }[ruleId];
  return { schemaVersion: '1', tool: TOOL_ID, status: 'incomplete',
    summary: { checked: 0, errors: 0, warnings: 1, results: 0 },
    findings: [{ ruleId, severity: RULE_SEVERITY[ruleId], message,
      location: { file, ...(pointer ? { pointer } : {}) } }], results: [] };
}

function checkedLimits(limits) {
  if (!limits || typeof limits !== 'object' || Array.isArray(limits)) throw new ConfigError('Invalid limits.');
  for (const [key, value] of Object.entries(limits)) {
    if (!(key in DEFAULT_LIMITS) || !Number.isSafeInteger(value) || value < 1 || value > DEFAULT_LIMITS[key]) {
      throw new ConfigError('Invalid limit.');
    }
  }
  return { ...DEFAULT_LIMITS, ...limits };
}

export function summarize(document, { now = Date.now, file = FILENAME, limits = {} } = {}) {
  if (typeof now !== 'function' || !isSafePath(file)) throw new ConfigError('Invalid clock or source label.');
  const bounds = checkedLimits(limits);
  const findings = [];
  const results = [];
  let incomplete = false;
  let checked = 0;
  const add = (ruleId, pointer, message) => {
    const severity = RULE_SEVERITY[ruleId];
    if (!severity) throw Error('Unknown report rule.');
    findings.push({ ruleId, severity, message, location: { file, pointer } });
    if (severity === 'warning') incomplete = true;
  };
  let firstTime;
  let lastTime;
  try { firstTime = now(); if (!Number.isFinite(firstTime)) throw Error(); lastTime = firstTime; }
  catch { add('clock-invalid', '/clock', 'Injected clock did not return a finite value.'); }
  const tick = () => {
    if (firstTime === undefined || !Number.isFinite(firstTime)) return false;
    let current;
    try { current = now(); } catch { current = NaN; }
    if (!Number.isFinite(current) || current < lastTime) {
      if (!findings.some(f => f.ruleId === 'clock-invalid')) add('clock-invalid', '/clock', 'Injected clock is not finite and monotone.');
      return false;
    }
    lastTime = current;
    if (current - firstTime > bounds.timeoutMs) {
      if (!findings.some(f => f.ruleId === 'limit-exceeded' && f.location.pointer === '/limits/timeoutMs')) {
        add('limit-exceeded', '/limits/timeoutMs', 'Analysis deadline exceeded.');
      }
      return false;
    }
    return true;
  };
  if (!document || typeof document !== 'object' || Array.isArray(document) ||
      document.schemaVersion !== '1' || !Array.isArray(document.results) || document.results.length === 0) {
    add('export-invalid', '/results', 'Saved command result export is unsupported or empty.');
  } else {
    if (Object.keys(document).some(key => !['schemaVersion', 'results'].includes(key))) {
      add('export-invalid', '/', 'Saved command result export has unsupported fields.');
    }
    if (document.results.length > bounds.maxResults) add('limit-exceeded', '/limits/maxResults', 'Saved result count exceeds limit.');
    for (const [index, item] of document.results.slice(0, bounds.maxResults).entries()) {
      if (!tick()) break;
      const pointer = `/results/${index}`;
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        add('result-invalid', pointer, 'Saved command result is unsupported.');
        continue;
      }
      let rowIncomplete = false;
      if (Object.keys(item).some(key => !['exitCode', 'stdout', 'stderr', 'stdoutTruncated', 'stderrTruncated'].includes(key))) {
        add('result-invalid', pointer, 'Saved command result has unsupported fields.');
        rowIncomplete = true;
      }
      const exitCode = item.exitCode;
      const knownExit = Number.isInteger(exitCode) && exitCode >= 0 && exitCode <= 255;
      const missingExit = exitCode === null;
      if (!knownExit && !missingExit) {
        add('result-invalid', `${pointer}/exitCode`, 'Saved exit status is unsupported.');
        rowIncomplete = true;
      }
      if (knownExit) checked++;
      if (missingExit) add('exit-unavailable', `${pointer}/exitCode`, 'Saved exit status was not obtained.');
      if (knownExit && exitCode !== 0) add('exit-nonzero', `${pointer}/exitCode`, 'Saved command exited nonzero.');
      let malformed = false;
      const streamLines = {};
      for (const stream of ['stdout', 'stderr']) {
        if (typeof item[stream] !== 'string' || typeof item[`${stream}Truncated`] !== 'boolean') {
          add('result-invalid', `${pointer}/${stream}`, 'Saved output evidence is unsupported.');
          malformed = true;
          rowIncomplete = true;
        } else {
          if (item[`${stream}Truncated`]) {
            add('output-truncated', `${pointer}/${stream}`, 'Saved output was truncated by its exporter.');
            rowIncomplete = true;
          }
          if (item[stream].length > bounds.maxStreamUnits) {
            if (!findings.some(f => f.ruleId === 'limit-exceeded' && f.location.pointer === '/limits/maxStreamUnits')) {
              add('limit-exceeded', '/limits/maxStreamUnits', 'Saved output stream exceeds unit limit.');
            }
            malformed = true;
            rowIncomplete = true;
          } else {
            streamLines[stream] = item[stream].split(/\r\n|\r|\n|\u2028|\u2029/u);
            if (streamLines[stream].length > bounds.maxLines) {
              if (!findings.some(f => f.ruleId === 'limit-exceeded' && f.location.pointer === '/limits/maxLines')) {
                add('limit-exceeded', '/limits/maxLines', 'Saved output stream exceeds line limit.');
              }
              malformed = true;
              rowIncomplete = true;
            }
          }
        }
      }
      const disposition = knownExit ? exitCode === 0 ? rowIncomplete ? 'unknown' : 'success' : 'failure' : 'unknown';
      let salient = null;
      if (knownExit && exitCode !== 0 && !malformed) {
        for (const stream of ['stderr', 'stdout']) {
          const lines = streamLines[stream];
          const lineIndex = lines.findIndex(line => /^\s*(?:error|fatal|exception|traceback)\b/iu.test(line));
          if (lineIndex >= 0) {
            const matched = /^\s*(error|fatal|exception|traceback)\b/iu.exec(lines[lineIndex]);
            salient = { stream, line: lineIndex + 1, class: matched[1].toLowerCase(), pointer: `${pointer}/${stream}/line/${lineIndex + 1}` };
            break;
          }
        }
      }
      results.push({ ordinal: index + 1, exitCode: knownExit ? exitCode : null, disposition, salient,
        hint: disposition === 'failure' ? 'Inspect the saved result at the cited position.'
          : disposition === 'unknown' ? 'Obtain a complete saved result before relying on this summary.'
            : 'No follow-up is indicated by the saved exit status.' });
    }
  }
  tick();
  findings.sort((a, b) => byCodeUnit(a.location.file, b.location.file) ||
    byCodeUnit(a.location.pointer, b.location.pointer) || byCodeUnit(a.ruleId, b.ruleId));
  const errors = findings.filter(f => f.severity === 'error').length;
  const warnings = findings.filter(f => f.severity === 'warning').length;
  return {
    schemaVersion: '1', tool: TOOL_ID, status: incomplete ? 'incomplete' : errors ? 'fail' : 'pass',
    summary: { checked, errors, warnings, results: Array.isArray(document?.results) ? document.results.length : 0 },
    findings, results,
  };
}
