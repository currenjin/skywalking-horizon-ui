# debugLog

Wire-level HTTP request/response log for troubleshooting OAP communication. **Off by default.** Very verbose — only use when actively debugging.

```yaml
debugLog:
  enabled: false
  file: ./horizon-wire.jsonl
  maxBodyChars: 8192
  redactAuthHeaders: true
```

## Fields

| Field | Type | Default | Required | Notes |
|---|---|---|---|---|
| `enabled` | boolean | `false` | no | Master switch. When `true`, every outbound OAP request and inbound response is logged to `file`. Off otherwise. |
| `file` | string | `./horizon-wire.jsonl` | no | Filesystem path to the wire log. JSON Lines, one entry per request. Append-only, no rotation. |
| `maxBodyChars` | number | `8192` | no | Maximum body size (in characters) to log per request/response. Larger bodies are truncated with a marker. Prevents unbounded log growth from large MQE responses. Non-negative integer; `0` means do not log bodies. |
| `redactAuthHeaders` | boolean | `true` | no | When `true`, `Authorization` headers (basic-auth credentials sent to OAP) are replaced with `<redacted>` in the log. **Set to `true` in production.** |

## What gets logged

Per request:

- Method, URL, request headers (with auth redaction per the flag), request body.
- Response status, response headers, response body.
- Elapsed milliseconds.

GraphQL queries are logged as POST bodies; admin REST endpoints (runtime-rule, inspect, etc.) appear as their underlying method.

## Use cases

- **"Why does OAP return X?"** Tail the log while you reproduce the issue:

  ```sh
  tail -f horizon-wire.jsonl | jq -c 'select(.status >= 400)'
  ```

- **MQE expression debugging.** Read the literal `execExpression` mutation Horizon sends, then run it directly against OAP with `curl` to compare.
- **Capability probing.** First few entries on startup show the introspection probes that determine which OAP features Horizon thinks are available.

## Operational notes

- **High volume.** A busy dashboard fires dozens of requests per page load; expect hundreds of MB/day with `enabled: true`.
- **No rotation.** Pair with a log shipper or a logrotate sidecar.
- **Off in production by default** unless you are actively troubleshooting a specific issue.
- **Auth-header redaction is on by default.** Disabling it (`redactAuthHeaders: false`) leaks basic-auth credentials into the log. Only flip off for a single-session troubleshooting run, and clear the file afterward.

## Hot reload

`enabled`, `file`, `maxBodyChars`, `redactAuthHeaders` all hot-reload. Flipping `enabled: false → true` starts logging on the next outbound call.
