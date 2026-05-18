Apache SkyWalking Horizon UI
============================

<img src="https://skywalking.apache.org/assets/logo.svg" alt="SkyWalking logo" height="90px" align="right"/>

The next-generation web UI for [Apache SkyWalking](https://github.com/apache/skywalking). Horizon UI talks to the same OAP GraphQL query-protocol and admin host as the existing [skywalking-booster-ui](https://github.com/apache/skywalking-booster-ui).

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)

## Features

### Multi-layer navigation
- Layers (General Service, Service Mesh, Kubernetes, Browser RUM, Virtual MQ, Virtual Database, FaaS, OpenTelemetry, …) are level-1 in the sidebar with per-layer service counts and a colored marker.
- Drilling into a layer expands its level-2 children inline: **Layer overview · Services · Instances · Endpoints · Topology**.
- Per-layer **menu mode** (full or lite) and renamable entity slots — e.g. FaaS uses *Function / Version / Invocation*, MQ uses *Cluster / Broker / Topic*, K8s uses *Workload / Pod / Container*, Browser uses *Application / Session / Page*.

### Landing
- **Global landing**: layers-reporting KPI, services-across-layers count, throughput **stacked by layer** (units differ per layer — General `cpm`, Mesh `cpm`, MQ `msg/s`, DB `qps`, FaaS `inv/m`), layers-at-a-glance grid with sample top services per layer, error-rate-by-layer, SLO burn donut, activity heatmap, and "Available · no data" cards for configurable-but-empty layers.
- **Per-layer landing**: layer header with data-source provenance and 6 layer-scoped KPIs, layer-scoped tabs (Overview · Services · Instances · Endpoints · Topology · Dashboards · Settings), layer throughput & latency, **service health constellation** (polar graph: angle = service slot, radius = log(cpm), color = error band), services table with traffic-share bars and per-service sparklines, layer SLA burn-down, apdex distribution.

### Service metrics deep-dive
- **Multi-layer awareness**: a single service can report through multiple layers simultaneously. The header shows an "N layers" chip and a strip of auto-laid-out layer cards (e.g. General · Service Mesh · Kubernetes), each with that layer's metric set and a sparkline. Clicking a card scopes the chart grid; "Compare" opens side-by-side.
- Standard SkyWalking metrics: `service_resp_time`, `cpm`, `sla`, `apdex`, percentiles, JVM panels, instances grid.
- **Service picker dropdown**: searchable (`⌘K`), sortable by cpm / p99 / err / name / recent, layer badges (`G·M·K`, `MQ`, `DB`…), starred favorites, status dots — pick a row to jump the page to that service.

### Topology — three visual modes
- **Force-directed** with animated traffic-flow particles
- **Hierarchical DAG** by tier
- **Hex / honeycomb** grid
Each variant ships with the same toolbar (Layer filter, Group by, Color by, free-text Filter), legend (error-rate ramp, edge-weight = cpm), and side detail panel (KPI mini-grid, upstream callers, downstream dependencies).

### Endpoint / API dependency
Multi-hop caller → endpoint → downstream view (not just a single popout). Latency breakdown, dependency table, recent traces inline.

### Dashboards (custom + per-scope)
- **Widget editor**: draggable resizable grid, MQE query drawer with token-level syntax coloring, visualization picker, threshold rules, panel options.
- **Per-scope templates**: Glance (fleet overview), Service, Instance, Endpoint, Topology, Metric drill — each bound to that entity scope with the right default panels.
- **Linked widgets**: service list on the left scopes every widget on the page; all time-series share a **synced crosshair** with a pinned tooltip that reads values from every chart at the same instant, plus a dashed **compare cursor** and an "At cursor" / "Δ vs compare" readout.

### Trace explorer
Duration scatter + sortable trace list + waterfall with per-span service / kind / error highlighting.

### Log explorer
- **Condition bar** with chip filters: status, service, env, attributes (`@http.status_code:>=500`, `@duration_ms:>300`), exclusions, free-text.
- **Saved views** and view-mode tabs (Stream / Patterns / Table / Transactions).
- **Facets sidebar** (Status, Service, Env, Host, Container, K8s pod, @trace_id, @http.status_code, …) with counts.
- **Timeline histogram** with brush selection.
- **Mixed-format payloads**: each row inline-expands the raw payload as **JSON, YAML, or raw text** with proper syntax coloring; Tree / Raw / Table tabs, JSONPath breadcrumb, line gutter, ⌘F.
- **Top patterns** roll-up: templated event groups with severity dot, mini bar, and event count.
- Right detail pane: quick filter pills (＋ / −), attributes table, related trace / host / dashboard cards.

### Alarms (active, read-only + Live debug)
- **Active alarms only, read-only** — no rule management, no acknowledge, no manual close. Recovery is driven by the backend (alarms auto-clear when the rule stops firing). This is the operate view: timeline, severity tabs, alarm list + right-side detail with trigger expression and channel routing.
- **Live debug card** — Run now / Step / Pause / Copy as MQE; **MQE expression** with syntax coloring; **execution trace** (fetch → select → window → compare → hold) with per-step output count, latency, and ok/match/fire badges; **matched entities table**; **eval window chart** with crossing-now pulse; **raw OAP response** as pretty-printed JSON.

### Admin & RBAC
- **Local + LDAP auth**: bind config, search base, attribute mapping, test-bind.
- **Roles & permissions**: per-layer, per-dashboard, per-action (view, edit, debug alarm, edit layer config). Alarms are read-only — no acknowledge / close / silence actions.
- **Users**: local + LDAP-backed users, group sync state.
- **Audit log**: dashboard edits, role changes, auth-provider changes — who, what, when.
- **Layer admin**: menu mode (full / lite) + entity-term mapping, per-layer settings.
- **System health**: OAP cluster status, storage backend status (BanyanDB, Elasticsearch, JDBC).

### Profiling (planned)
Flame graph view backed by SkyWalking's profiling / async-profiler / eBPF data.

## Compatibility

Horizon UI is built against the SkyWalking OAP GraphQL query-protocol (same schema as booster-ui consumes). No backend changes are required.

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Vue 3 + TypeScript (Composition API, `<script setup>`) |
| Build | Vite 5 |
| Routing | vue-router 4 |
| State | Pinia |
| HTTP / GraphQL | `graphql-request` + `fetch` |
| Charts (time series / heatmap / sankey / scatter / stacked bar / donut) | Apache ECharts 5 |
| Topology / polar / sparklines | D3 v7 |
| Dashboard grid | `vue-grid-layout` |
| Flame graph | `d3-flame-graph` |
| Code editor (MQE) | Monaco |
| i18n | vue-i18n |
| Testing | Vitest + Vue Test Utils |
| E2E | Cypress |

## Development

Requires Node.js 20+ and pnpm 10+ (pinned via Corepack in `package.json`).

```bash
pnpm install                     # one-time / after lockfile changes; auto-builds workspace packages via `prepare`

# Dev loop (hot-reload, verbose pretty logs)
pnpm --filter bff dev            # BFF on :8081 with NODE_ENV=development → debug level + per-request access logs
pnpm --filter ui dev             # Vite dev server on :9091, proxies /api to the BFF

# Static checks / tests
pnpm -r type-check
pnpm -r lint                     # read-only; `pnpm -r lint:fix` to mutate
pnpm -r test:unit
pnpm license:check               # CI gate via skywalking-eyes

# Self-contained "binary mode" — produces ./dist/ that boots with `node dist/server.js`
pnpm package
HORIZON_CONFIG=./horizon.yaml HORIZON_STATIC_DIR=./dist/static node dist/server.js

# Container — Docker just copies in the pre-built dist (no compile in image)
docker build -t horizon-ui:local .
docker run --rm -p 8081:8081 -v "$PWD/horizon.yaml:/app/horizon.yaml:ro" horizon-ui:local
```

### Logging

The BFF uses [pino](https://github.com/pinojs/pino). Two modes, picked from `NODE_ENV`:

| Mode | When | Format | Default level |
|---|---|---|---|
| **Dev** | `pnpm --filter bff dev` (sets `NODE_ENV=development`) | Pretty, colorized, via `pino-pretty` | `debug` + per-request access logs |
| **Prod** | Everything else — `node dist/server.js`, Docker container, CI | One JSON object per line on stdout | `error` — quiet by default |

Adjust with `LOG_LEVEL`: `info` opens per-request access logs in prod, `debug` adds lifecycle chatter, `trace` is everything. Genuine request errors stay logged at `error` under any default that includes `error`. See [docs/setup/container-image.md → Logging](docs/setup/container-image.md#logging) for the three orthogonal channels (app logs, audit log, wire-debug log) and example `jq` recipes.

## License

Apache 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

License headers and dependency licenses are enforced in CI via [skywalking-eyes](https://github.com/apache/skywalking-eyes); configuration is in [.licenserc.yaml](.licenserc.yaml).
