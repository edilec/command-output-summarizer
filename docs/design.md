# Command Output Summarizer design

## Purpose and boundary

The tool reads one saved JSON command-result export. It never runs the command,
interprets the command text as instructions, contacts a host, or writes an output
file. The CLI requires `--root` and a root-relative `--input`; stdout is one JSON
report and stderr is a fixed count summary unless `--json` is selected.

## Supported export

```json
{
  "schemaVersion": "1",
  "results": [{
    "exitCode": 1,
    "stdout": "",
    "stderr": "error: synthetic failure",
    "stdoutTruncated": false,
    "stderrTruncated": false
  }]
}
```

The list is nonempty. Every result has exactly the displayed fields. `exitCode`
is an integer from 0 to 255 or `null` when the exporter did not obtain it.
Both streams and truncation flags are required. The parser rejects duplicate
JSON keys, unsupported number spelling, excessive depth, bytes, records, lines
and elapsed time as incomplete evidence. Unknown options or unsafe input paths
are invalid configuration instead.

## Report semantics

Known nonzero exits create `exit-nonzero` error findings, even if output says
success. A known zero exit is successful only when its evidence is complete.
Missing exit status or either truncation flag being true makes the overall run
incomplete; an already-proven nonzero error remains visible. Each result row
reports its ordinal, exit code, fixed disposition, one safe error-shaped line
classification when present, a source pointer, and a fixed next-action hint.
No command text, stdout or stderr content is ever included in the report or
human summary. This is intentionally stricter than heuristic redaction: an
arbitrary excerpt cannot be proven free of secrets.

Findings sort by UTF-16 code unit over file, pointer and rule ID. The clock is
injected for library calls. The CLI only reads files confined by real path to
the real root; an unreadable or malformed named export yields a located
incomplete report, whereas invalid CLI/configuration emits no stdout.
