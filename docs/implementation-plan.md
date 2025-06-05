# Command Output Summarizer implementation plan

**Goal:** Summarize one saved command-result export without executing it or
revealing its text.

**Architecture:** `src/json.mjs` parses the strict supported JSON subset;
`src/index.mjs` validates and classifies results; the CLI confines one named
input and prints the report. Tests use actual library and CLI entry points.

**Tech stack:** Node.js ESM, `node:test`, `node:assert/strict`, no packages.

**Spec:** [design.md](./design.md)

## Global constraints

- No network, command execution, report file writes, dependencies, or raw
  command/output text in the report.
- Valid configuration errors have empty stdout; input failures have an
  incomplete JSON report; statuses map to exits 0/1/2.
- Every bound is inclusive at N and refuses N+1. Clock is injected, output is
  deterministic UTF-16 order, and all locations are root-relative.

## Task 1: strict export parsing and a good result

Files: `src/json.mjs`, `src/index.mjs`, `test/core.test.mjs`.

- [ ] Write a named test calling `summarize({schemaVersion:'1',results:[{exitCode:0,stdout:'ok',stderr:'',stdoutTruncated:false,stderrTruncated:false}]})` and asserting `pass`, `checked:1`, no findings and no raw text.
- [ ] Run it and observe failure because `summarize` does not exist.
- [ ] Implement only the envelope, rule table, validated good result and strict parser.
- [ ] Run the test green; add red/green tests for duplicate keys, malformed JSON,
  missing fields and unsupported number spelling.
- [ ] Commit the coherent parser/core milestone after the focused check.

## Task 2: failure, unknown and bounded classification

Files: `src/index.mjs`, `test/core.test.mjs`.

- [ ] Write tests for nonzero exit with reassuring stdout, missing exit,
  truncated stderr plus known nonzero, and an error-shaped line containing a
  synthetic secret canary. Assert fixed messages and precise line pointers,
  but never text excerpts.
- [ ] Observe each new test fail for the intended missing behavior.
- [ ] Implement the fixed classifications, incomplete precedence, and a
  single bounded salient-line position per result.
- [ ] Pin N/N+1 records, lines, bytes, depth and injected timeout, including
  finite/monotone clock readings; run focused tests green.
- [ ] Commit this independently testable classification milestone.

## Task 3: offline confined CLI and docs

Files: `bin/command-output-summarizer.mjs`, `support/deny-network.mjs`,
`test/cli.test.mjs`, `test/no-network.test.mjs`, `examples/`, `README.md`,
`package.json`.

- [ ] Add real CLI tests for clean/failing/incomplete examples, `--help`, bad
  option empty stdout, unreadable/malformed named input report, symlink escape,
  fixed human summary and `--json` suppression; observe red first.
- [ ] Implement strict CLI parsing, real-root confinement and safe source
  location, then run CLI tests green.
- [ ] Add active network-denial negative controls using a data-URL fetch and
  null-receiver socket call; run the complete test process under denial.
- [ ] Document rule table, input shape, quick start, exits, bounds and non-goals.
- [ ] Run `npm run check`, sample all three exits, check raw control bytes and
  clean status, then commit the final coherent milestone.
