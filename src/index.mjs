export const TOOL_ID = 'command-output-summarizer';

const RULE_SEVERITY = Object.freeze({
  'exit-nonzero': 'error',
  'exit-unavailable': 'warning',
  'output-truncated': 'warning',
  'result-invalid': 'warning',
  'export-invalid': 'warning',
});
const byCodeUnit = (a, b) => a === b ? 0 : a < b ? -1 : 1;
const FILENAME = 'input.json';

export function summarize(document, { now = Date.now, file = FILENAME } = {}) {
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
  if (!document || typeof document !== 'object' || Array.isArray(document) ||
      document.schemaVersion !== '1' || !Array.isArray(document.results) || document.results.length === 0) {
    add('export-invalid', '/results', 'Saved command result export is unsupported or empty.');
  } else {
    for (const [index, item] of document.results.entries()) {
      const pointer = `/results/${index}`;
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        add('result-invalid', pointer, 'Saved command result is unsupported.');
        continue;
      }
      const exitCode = item.exitCode;
      const knownExit = Number.isInteger(exitCode) && exitCode >= 0 && exitCode <= 255;
      const missingExit = exitCode === null;
      if (!knownExit && !missingExit) {
        add('result-invalid', `${pointer}/exitCode`, 'Saved exit status is unsupported.');
      }
      if (knownExit) checked++;
      if (missingExit) add('exit-unavailable', `${pointer}/exitCode`, 'Saved exit status was not obtained.');
      if (knownExit && exitCode !== 0) add('exit-nonzero', `${pointer}/exitCode`, 'Saved command exited nonzero.');
      let malformed = false;
      for (const stream of ['stdout', 'stderr']) {
        if (typeof item[stream] !== 'string' || typeof item[`${stream}Truncated`] !== 'boolean') {
          add('result-invalid', `${pointer}/${stream}`, 'Saved output evidence is unsupported.');
          malformed = true;
        } else if (item[`${stream}Truncated`]) {
          add('output-truncated', `${pointer}/${stream}`, 'Saved output was truncated by its exporter.');
        }
      }
      const disposition = knownExit ? exitCode === 0 ? 'success' : 'failure' : 'unknown';
      let salient = null;
      if (knownExit && exitCode !== 0 && !malformed) {
        for (const stream of ['stderr', 'stdout']) {
          const lines = item[stream].split(/\r\n|\r|\n|\u2028|\u2029/u);
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
  findings.sort((a, b) => byCodeUnit(a.location.file, b.location.file) ||
    byCodeUnit(a.location.pointer, b.location.pointer) || byCodeUnit(a.ruleId, b.ruleId));
  const errors = findings.filter(f => f.severity === 'error').length;
  const warnings = findings.filter(f => f.severity === 'warning').length;
  return {
    schemaVersion: '1', tool: TOOL_ID, status: incomplete ? 'incomplete' : errors ? 'fail' : 'pass',
    summary: { checked, errors, warnings, results: document?.results?.length ?? 0 },
    findings, results,
  };
}
