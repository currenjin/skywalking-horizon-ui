# audit

Audit log file path. The format and event schema are documented in [Access Control → Audit Log](../access-control/audit-log.md); this page is the `horizon.yaml` shape.

```yaml
audit:
  file: ./horizon-audit.jsonl
```

## Fields

| Field | Type | Default | Required | Notes |
|---|---|---|---|---|
| `file` | string | `./horizon-audit.jsonl` | no | Filesystem path to the JSON Lines audit log. Relative paths resolve from the BFF working directory. The BFF appends; it never rotates. |

## Operational notes

- **Append-only, no rotation.** If you need rotation, run the BFF behind a log shipper (`vector`, `fluent-bit`) and write to a path the shipper rotates, **or** point `file` at a Unix pipe / FIFO that a sidecar drains.
- **Durable storage.** Do not write to a container tmpfs — break-glass logins and rule edits should outlive the container.
- **JSON Lines.** One JSON object per line. Streamable with `tail -f` and parseable with `jq`.

## Hot reload

Changing `file` mid-process redirects subsequent writes to the new path. The old file is not closed eagerly — for a clean cut-over, restart the BFF.
