# Command Output Summarizer

An offline reporter for command results that were already saved by another
system. It answers what exit status was recorded, where a salient error-shaped
line begins, and what to inspect next. It never executes the command or
publishes its output text. A failed exit is not reinterpreted as success when
the saved stdout sounds reassuring.

## Quick start

```sh
node bin/command-output-summarizer.mjs --root examples/clean --input input.json
node bin/command-output-summarizer.mjs --root examples/failing --input input.json
node bin/command-output-summarizer.mjs --root examples/incomplete --input input.json
npm run check
```

Those examples exit 0 (`pass`), 1 (`fail`) and 2 (`incomplete`). `--help` prints
usage. Standard output is one JSON report line. Standard error is a fixed
human-readable status/count summary; `--json` suppresses only that summary.
Neither stream repeats command, stdout or stderr text. The CLI has no report
file mode and never writes to its input.

## Saved export profile

The input is a UTF-8 JSON document inside the real `--root` directory. `--input`
is a root-relative ASCII path of at most 256 UTF-16 units, with no `.` or `..`
segment. Symlinked input aliases and paths resolving outside the root are
incomplete, not silently followed. The supported shape is:

```json
{
  "schemaVersion": "1",
  "results": [
    {
      "exitCode": 7,
      "stdout": "",
      "stderr": "error: synthetic failure",
      "stdoutTruncated": false,
      "stderrTruncated": false
    }
  ]
}
```

`results` must be nonempty. Each result has exactly those five fields.
`exitCode` is 0–255 or `null` when no exit status was obtained. Output streams
must be strings, and both truncation flags must be booleans. Numeric JSON
tokens use nonnegative integer spelling only; fractional and exponent forms
are unsupported rather than rounded into an exit code. Duplicate keys,
including escaped-equivalent keys, are refused before `JSON.parse` can erase
them. Unknown fields are incomplete evidence, never silently ignored.

## Rules and status

| Rule | Meaning | Severity |
| --- | --- | --- |
| `exit-nonzero` | Saved exit was nonzero | error |
| `exit-unavailable` | Exporter did not obtain the exit | warning, incomplete |
| `output-truncated` | Exporter flagged one stream as truncated | warning, incomplete |
| `result-invalid`, `export-invalid` | Required structure is missing or unsupported | warning, incomplete |
| `input-unreadable`, `input-invalid` | Named input could not be read, decoded or parsed | warning, incomplete |
| `input-alias-unsupported`, `path-outside-root` | Input provenance is ambiguous or outside root | warning, incomplete |
| `limit-exceeded`, `clock-invalid` | Bounded analysis could not finish honestly | warning, incomplete |

If any saved result is incomplete, the whole report is `incomplete`, even when
another result proves a nonzero exit. The proven `exit-nonzero` error stays in
the report. A complete report with any nonzero exit is `fail`; all complete
zero exits are `pass`. Empty results cannot pass. Error-shaped lines are
classified only for failed commands, using fixed prefixes `error`, `fatal`,
`exception` and `traceback`; this is a locator, not a claim that the remaining
text was understood. The report gives stream and one-based line pointer but
never the line's text. Suggestions are fixed next-action hints, not instructions
copied from output.

The JSON envelope has `schemaVersion`, `tool`, `status`, `summary`, `findings`
and `results`. Each result row has its one-based ordinal, safe disposition,
optional salient-line class and pointer, and fixed hint. Findings sort by
UTF-16 code unit over file, pointer and rule ID. The single named document is
identified by the logical `input` location label and JSON pointers; its
supplied filename is not echoed. The clock is injected via
`summarize(document, { now })` and never read from output text.

| Exit | stdout | Meaning |
| ---: | --- | --- |
| 0 | JSON `pass` | Complete saved results, all exits zero |
| 1 | JSON `fail` | Complete results with a nonzero exit |
| 2 | empty | Invalid CLI option, root or input path syntax |
| 2 | JSON `incomplete` | Named input or result evidence unavailable, unsupported or over bound |

Invalid configuration has only a fixed stderr diagnostic, including under
`--json`. An unreadable named input has an incomplete JSON report.

## Limits and non-goals

Defaults are inclusive: 1,048,576 input bytes, 128 results, 65,536 UTF-16
units and 4,096 lines per output stream, JSON depth 64, JSON structural nodes
100,000, and 2,000 milliseconds of cooperative analysis. Tests pin N and N+1.
Library callers may lower the result, stream, line and time limits. The clock
cannot interrupt a synchronous parser call; an elapsed limit is checked between
records. No arbitrary excerpt is considered provably secret-free, so none is
rendered. The tool does not execute commands, diagnose every program-specific
error, verify that an exporter told the truth, connect to a host, or repair a
failing command. It has no runtime or development dependencies beyond Node.js
22 or newer. `npm run check` runs the suite under an active network-denial
guard.

MIT licensed; see [LICENSE](./LICENSE).
