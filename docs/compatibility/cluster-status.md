# Cluster Status Check Sequence

The Cluster Status page (`/operate/cluster`, sidebar **Operate → Cluster**) is the operator's single pane for "is the OAP backend healthy and configured correctly?" It runs **two independent checks in parallel** against the two OAP ports — they do not block each other, and the page surfaces each pane's result independently.

This page is intentionally two-pane: a healthy `:12800` with broken `:17128` is a real and recoverable state (forgot to expose the admin port behind a Kubernetes Service), and Horizon makes that diagnosis obvious.

## Pane A — Query / GraphQL port (`:12800`)

**Source:** `apps/bff/src/http/query/info.ts`, UI composable `apps/ui/src/shell/useOapInfo.ts`.

**Single GraphQL call** fired every 30 seconds:

```graphql
query {
  version
  getTimeInfo { timezone, currentTimestamp }
  checkHealth { score, details }
}
```

### What the pane shows

| Field | Source | Notes |
|---|---|---|
| Reachable | HTTP success of the GraphQL call | Hard fail → whole pane shows red banner. |
| Version | `version` | The OAP build string. |
| Server timezone | `getTimeInfo.timezone` | UTC offset like `+0800`. Used for time-range conversion throughout the UI. |
| Server timestamp | `getTimeInfo.currentTimestamp` | Epoch ms. UI shows skew vs browser clock if non-trivial. |
| Health score | `checkHealth.score` | `0` = OK, `>0` = degraded, `<0` = not started. |

### Failure modes

- **Hard fail (unreachable)**: GraphQL endpoint refused / timed out / 5xx. `reachable: false`. Whole UI shows a top-of-page "OAP unreachable" banner — query pages cannot render.
- **Soft fail (degraded)**: `score > 0` — OAP is up but degraded (storage lag, receiver backlog, internal queue depth). Shown as a yellow "degraded (score N)" chip; details from `checkHealth.details`.
- **Soft fail (not started)**: `score < 0` — OAP process is running but has not finished initialization yet. Shown as "not started"; usually transient during a rolling restart.

### Poll cadence

- Stale-time: 20 s
- Refetch interval: 30 s

## Pane B — Admin host (`:17128`)

**Source:** `apps/bff/src/http/query/preflight.ts`, UI composable `apps/ui/src/shell/useAdminFeatures.ts`.

**Single admin REST call** fired every 60 seconds:

```
GET <adminUrl>/debugging/config/dump
```

OAP returns a flat key/value map. The BFF parses it and reports, per required module, whether **any** key with that module's prefix appears.

### Check sequence (per refresh)

The checks run in this strict order — earlier failures short-circuit later ones:

1. **Admin host reachable?** TCP / HTTP connect succeeds.
   - Fail → `adminReachable: false`, every module reports `enabled: false`. Whole pane red.
2. **`admin-server` module loaded?** Any `admin-server.*` key in the dump.
   - Fail → admin host responded but does not expose the admin selector. (Should not happen — the dump endpoint is itself served by admin-server. In practice this case means a custom OAP build.)
3. **`receiver-runtime-rule` loaded?** Any `receiver-runtime-rule.*` key.
   - Fail → DSL Management, alarm rules, cluster rule matrix disabled. Yellow badge.
4. **`dsl-debugging` loaded?** Any `dsl-debugging.*` key.
   - Fail → Live Debugger disabled. Yellow badge.
5. **`inspect` loaded?** Any `inspect.*` key.
   - Fail → Inspect page disabled. Yellow badge.

The sequence is fail-fast: once `admin-server` itself is off, the dump is empty so steps 3–5 all report off. The UI does not stack three separate warnings — it shows one root cause.

### What the pane shows

| Module | Hint shown when off |
|---|---|
| `admin-server` | "Confirm `SW_ADMIN_SERVER=default` is set on OAP and port 17128 is exposed." |
| `receiver-runtime-rule` | "Set `SW_RECEIVER_RUNTIME_RULE=default` on OAP to enable DSL Management." |
| `dsl-debugging` | "Set `SW_DSL_DEBUGGING=default` on OAP to enable the Live Debugger." |
| `inspect` | "Set `SW_INSPECT=default` on OAP to enable the Inspect page." |

### Poll cadence

- Stale-time: 30 s
- Refetch interval: 60 s

## Per-node cluster discovery (`/status/cluster/nodes`)

In addition to the two health panes, the page lists OAP cluster members:

- **Source**: `GET <queryUrl>/status/cluster/nodes` (status client, `packages/api-client/src/status.ts`).
- **Returns**: per-node host, port, role, heartbeat.
- **Use**: confirm cluster size matches expectations (e.g., 3-node OAP behind one DNS name should show three rows).

Cluster discovery is **not** required for Horizon to function — it is purely informational. If `/status/cluster/nodes` fails, the cluster pane shows "unknown" but the rest of the UI keeps working.

## Reading the page during an incident

The triage flow during "Horizon shows banners I don't understand":

1. **Is the Query pane green?** If not, OAP itself is down / unreachable — fix OAP first, the rest is downstream.
2. **Is the Admin pane green?** If not, expose port 17128 and / or turn on the four selectors — see the per-module hints.
3. **Is the health score `> 0`?** OAP is up but degraded — pull `details` from `checkHealth` (visible in the Query pane) and triage on the OAP side.
4. **Cluster member count off?** Either DNS / Service config is wrong, or one OAP node is down — check `/status/cluster/nodes` output and your OAP cluster controller.

