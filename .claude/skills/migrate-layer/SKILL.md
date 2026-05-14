---
name: migrate-layer
description: Migrate one OAP layer's UI templates from booster-ui (apache/skywalking ui-initialized-templates) into the Horizon UI bundled config — preserves intent, adapts to Horizon's flatter widget grid + extracts metric semantics from upstream docs.
user-invocable: true
---

# Migrate one OAP layer into Horizon

Source of truth for the upstream side:
- Templates: `/Users/wusheng/github/skywalking/oap-server/server-starter/src/main/resources/ui-initialized-templates/<layer>/`
- Docs index: `/Users/wusheng/github/skywalking/docs/menu.yml` (paths are relative to `/Users/wusheng/github/skywalking/docs/`)

Output goes to: `apps/bff/src/bundled_templates/layers/<layer>.json`

The Horizon JSON shape is defined by `apps/bff/src/layers/loader.ts` (`LayerTemplate` interface). Read it once before each new layer so any new fields are picked up.

---

## When this skill applies

You're staring at a booster-ui template folder (e.g. `k8s/`, `mesh/`, `virtual_database/`) with 1–7 nested `*.json` files and you need to produce **one** Horizon JSON that lights up the corresponding layer page (Services / Instances / Endpoints / Topology / Traces / Logs / Profiling). Some layers have only `*-root.json` + `*-service.json` (service-only); others add `*-instance.json`, `*-endpoint.json`, and `*-*-relation.json` (full mesh).

---

## Booster → Horizon mapping reference

### Top-level shape

| Booster | Horizon | Notes |
|---|---|---|
| One file per scope, each wrapping a `Tab` tree | One JSON, scopes flattened into `dashboards.{service,instance,endpoint,dependency,topology}` arrays | The `Tab` containers in booster are dropped — Horizon's layer page already provides the tab strip via the route hierarchy. |
| `configuration.layer` | top-level `key` (also matches the file basename uppercased) | The loader asserts `file.json` ↔ `"key": "FILE"` (UPPER_SNAKE). |
| `configuration.entity` (`Service` / `ServiceInstance` / `Endpoint` / …) | implied by which `dashboards.*` bucket the widget lives in | Drop the entity field — placement decides. |
| `configuration.name` (e.g. `General-Service`) | not needed | Horizon derives titles from `alias` + route. |
| `Event` widget at the bottom | not yet supported | Skip; revisit when Horizon adds an events strip. |

### Widget renderer mapping

| Booster `graph.type` | Horizon `type` | Comment |
|---|---|---|
| `Card` | `card` | Single scalar, avg across window. Card MQE usually wraps with `avg(...)`. Horizon evaluates the average itself; **strip the `avg()` wrapper** unless it changes shape (e.g. `avg(x/100)`). |
| `Line` (single expression) | `line` | One labeled series. Carry `unit`, `expressions[0]`, `expressionLabels?`. |
| `Line` (multiple expressions) | `line` | Multi-series. Use `expressionLabels` (mandatory for legend). When the booster widget has a dual-axis trick (e.g. count + latency), set `expressionAxes: [0, 1]` and supply `expressionUnits`. |
| `TopList` | `top` | Sorted list — usually `top_n(...,N,des)`. When booster ships several `TopList`s on the same layer that are conceptually the same ranking with different sort dimensions (e.g. Top APIs by Traffic / by Slow / by SR), **fold them into a single `top` widget with multiple `expressions` + `expressionLabels` + `expressionUnits`** (the SPA renders these as in-widget tabs). |
| `TopList` with RECORD-typed MQE (`top_n_service_database_statement`, etc.) | `record` | Use `record`, not `top`. Pair with `relatedTrace.refIdType: traceId` upstream — Horizon's record widget surfaces trace links automatically. |
| `Topology` | **not a dashboard widget** — pull node/link MQE up to top-level `topology` block | The `linkServerExpressions`, `linkClientExpressions`, `nodeExpressions` become `topology.{nodeMetrics, linkServerMetrics, linkClientMetrics}` arrays. Add `role` (`center`/`ring`/`secondary` for nodes, `lineServer`/`lineClient` for edges). |
| `InstanceList`, `EndpointList` | **dropped** — Horizon ships built-in pickers | The picker columns come from `header.columns` (or `overview.*`) instead. Don't reproduce these as dashboard widgets. |
| `Trace`, `Log` | **flip the component flag** in `components.{traces,logs}` | No widget needed — Horizon owns the Traces / Logs views. |
| `Profile` (trace profiling) | `components.traceProfiling: true` | Horizon's profiling views are component-level, not widget-level. |
| `Ebpf` | `components.ebpfProfiling: true` | Same. |
| `AsyncProfiling` | `components.asyncProfiling: true` | Same. |
| `Text` | dropped | Layer header in Horizon already documents the page; if you need an external link, set `documentLink` at the layer root. |
| `Event` | dropped (no Horizon equivalent yet) | Note in the PR if a layer leans on this heavily. |

### Field-level mapping

| Booster | Horizon | Notes |
|---|---|---|
| `widget.title` | `title` | Drop unit suffixes from the title — Horizon shows the unit separately. e.g. `"Service Avg Response Time (ms)"` → `"Avg Response Time"` + `"unit": "ms"`. |
| `widget.tips` | `tip` | Keep verbatim where useful; otherwise tighten to one sentence. |
| `expressions[0]` | `expressions[0]` | MQE stays. For cards, unwrap a single outer `avg(...)`. |
| `graph.fontSize`, `textAlign`, `showSymbol`, `step`, `smooth`, `color`, `showXAxis`/`Y` | dropped | Horizon's chart wrappers own the rendering style. |
| `metricConfig[*].unit` | `unit` (or `expressionUnits`) | Use widget-level `unit` for single-series widgets, `expressionUnits` per index for multi-series. |
| `metricConfig[*].label` | `expressionLabels[i]` | When booster sets a label to give the legend a friendly name, copy it; otherwise rely on the MQE relabel (e.g. `relabels(...,percentile='99')` is already the legend label). |
| `associate` (cross-widget cursor sync) | dropped | Horizon syncs crosshairs via `useCrosshair()` automatically. |
| `relatedTrace.enableRelate`, `latency`, `status`, `queryOrder` | dropped (for widget) | The dashboard's trace-list links are auto-derived. For `record` widgets, keep `relatedTrace.refIdType` semantics by ensuring the underlying MQE is RECORD-typed. |
| `valueRelatedDashboard` | dropped | Horizon routing — clicking a top item drills into the instance/endpoint page automatically. |
| `x/y/w/h` (24-col grid) | `span` / `rowSpan` (12-col flow) | **Halve the booster width** to convert to Horizon's 12-col grid (`w: 8` → `span: 4`). Use `rowSpan` only when the widget is taller than the default 2 rows (default ~14px × 8 = chart height). Top-lists and percentile charts typically `rowSpan: 3` or `4`. |
| `subExpressions` (per-row sparkline MQE under `InstanceList`/`EndpointList`) | dropped (UI computes the row-sparklines itself) | These are the picker's per-row spark sources. Horizon's pickers fetch them through `landing` routes. |
| `legendMQE` + `description.healthy/unhealthy` on Topology | Horizon doesn't yet have a legend-rule UI — capture the rule in a comment for now | Pending UI work. |

### Picker column derivation

The layer page header (services list) needs `header.columns`. Source order of preference:
1. The booster `*-service.json` Overview tab's top three single-card metrics — these are conceptually the same as the picker columns.
2. The picker's `subExpressions` array — first 1–3 entries map well.
3. Default to `cpm` / `sla/100` / `resp_time` if nothing is obvious.

Always set `orderBy` to the column you want as the default sort (usually `cpm`).

### Overview tile derivation

`overview.groups` drives the tall hero card above the picker. Pick 2–4 metrics that tell the layer's health story at a glance — almost always:
- **one** latency percentile (**P95** — prefer P95 over P99; do not include both, they're redundant in a hero strip)
- an error rate (`100 - service_sla/100` or layer equivalent)
- a health score (apdex) where available **or** a throughput indicator — pick the one that's most informative for that layer

Group as `{ "title": "Latency & errors", "size": "auto", "metrics": [...] }` and (optionally) `{ "title": "Health", "size": "square", "metrics": [<single>] }` or `{ "title": "Throughput", "size": "square", "metrics": [<RPM>] }` when the layer has no apdex equivalent.

---

## 5-step procedure for migrating one layer

Run these in order **for each layer**. The order matters: 1–4 build the mental model; 5 produces the JSON. Don't skip ahead to writing JSON.

### Step 1 — Learn the old layout

Read every file under `/Users/wusheng/github/skywalking/oap-server/server-starter/src/main/resources/ui-initialized-templates/<layer>/`. List:
- Each `*-root.json` Tab name + child widgets — defines the layer landing strip
- Each `*-service.json` / `*-instance.json` / `*-endpoint.json` Overview tab widget set — these become the `dashboards.<scope>` arrays
- The `*-relation.json` files — the relation widget sets feed into Horizon's edge/dependency drill panels but **most metrics belong to topology.linkServerMetrics / linkClientMetrics**, not as flat widgets. If the relation file has 4+ widgets, mention them in the migration notes; if it's just RPM/respTime/SLA/percentile, fold into topology.
- Note which widgets the layer uses (`InstanceList`, `EndpointList`, `Topology`, `Trace`, `Log`, `Profile`, etc.) so you know which `components.*` flags to flip.

Optional `Bash` helper to summarize:
```bash
for f in /Users/wusheng/github/skywalking/oap-server/server-starter/src/main/resources/ui-initialized-templates/<LAYER>/*.json; do
  echo "=== $(basename $f) ==="
  python3 -c "
import json
d = json.load(open('$f'))
def walk(n, depth=0):
    if isinstance(n, list):
        for i in n: walk(i, depth); return
    if not isinstance(n, dict): return
    t = n.get('type'); name = n.get('name')
    title = (n.get('widget') or {}).get('title') if isinstance(n.get('widget'), dict) else None
    if name or (t and t != 'Tab') or title:
        print('  '*depth + (t or 'Tab') + ((': ' + (name or title)) if (name or title) else ''))
    for c in n.get('children') or []: walk(c, depth+1)
    if n.get('configuration'): walk(n['configuration'], depth)
walk(d)"
done
```

### Step 2 — Learn the Horizon capabilities

Reread `apps/bff/src/layers/loader.ts` (the `LayerTemplate` interface + comments) and `packages/api-client/src/dashboard.ts` (the `DashboardWidget` interface). Decide which Horizon features the migration will use:
- `dashboards.service` (always)
- `dashboards.instance` (if booster has instance template **and** the layer has per-instance metrics worth showing)
- `dashboards.endpoint` (same logic for endpoints)
- `dashboards.dependency` (only if the relation file has metrics distinct from topology edges)
- `topology` block (any layer with a non-trivial service map — almost all do)
- `endpointDependency` block (only if the layer has per-endpoint relations, e.g. general, mesh, k8s_service)
- `components.{traces, logs, traceProfiling, ebpfProfiling, asyncProfiling}` flags
- `visibleWhen` for any widget whose MQE only fires conditionally (`instance_jvm_cpu has value` etc.) — common on instance-scope widgets that span multiple runtimes.

Also reread the existing `general.json` (and `mesh.json` if migrating a service-mesh-adjacent layer) as the reference template. Copy its shape verbatim and replace metric names — don't reinvent the structure.

### Step 3 — Read metrics meaning from booster's `widget.tips` + metric names

For each widget you're going to migrate, write a one-line summary of what the metric represents. Sources:
- `widget.tips` in the booster JSON (often the most direct)
- The metric name itself (e.g. `instance_jvm_gc_pause_duration` → JVM GC pause time per minute)
- The OAP query-protocol schemas under `apache/skywalking/oap-server/.../query-protocol/*.graphqls` if the metric is exposed there

If you can't write a one-liner from these alone, move to Step 4.

### Step 4 — Web search the target component + popular key metrics

For domain-specific layers (Kafka, Redis, MongoDB, Envoy, Cilium, etc.), web search a small set:
- `"<component> top metrics for monitoring"` — usually finds the canonical 5–10 SREs care about
- `"<component> golden signals"` — RED / USE method articles
- Vendor docs (Confluent for Kafka, Redis Labs for Redis, etc.) for the metric definitions

The goal is to **prioritize** the booster widgets — if booster ships 30 metrics but only 8 of them are commonly-watched, surface those 8 in the layer landing and stash the rest in a "More" group (or just keep them in the JSON with smaller `span` so they live below the fold).

### Step 5 — Read upstream docs from `docs/menu.yml`

`/Users/wusheng/github/skywalking/docs/menu.yml` has a `catalog:` tree. Find the entry whose name matches the layer (e.g. "MySQL/MariaDB monitoring", "Kafka monitoring", "Redis monitoring") and follow its `path:` to `/Users/wusheng/github/skywalking/docs/<path-without-leading-slash>.md`. These docs:
- List every metric the OAP module emits, with definitions
- Often categorize metrics ("RED metrics", "Capacity metrics", "Reliability metrics")
- Sometimes include the suggested dashboard layout

This is the most authoritative source for metric semantics. **If a booster widget tip is vague but the upstream doc explains the metric, use the doc's wording for the Horizon `tip`.**

### Step 6 — Write the Horizon JSON

Now produce `apps/bff/src/bundled_templates/layers/<layer>.json`. Skeleton:

```jsonc
{
  "key": "<UPPER_SNAKE>",
  "alias": "<Display Name>",
  "color": "var(--sw-accent)",            // most layers use the orange accent
  "documentLink": "https://skywalking.apache.org/docs/main/next/en/<path-from-menu.yml>",
  "aliases": {                            // optional — only override slot names when the layer uses non-standard entity terms
    "services": "Brokers",
    "instances": "Nodes",
    "endpoints": "Topics"
  },
  "components": {
    "service": true,
    "instances": <has *-instance.json>,
    "endpoints": <has *-endpoint.json>,
    "endpointDependency": <has endpoint-relation.json>,
    "topology": <has Topology widget anywhere>,
    "traces": <has Trace widget>,
    "logs": <has Log widget>,
    "traceProfiling": <has Profile widget>,
    "ebpfProfiling": <has Ebpf widget>,
    "asyncProfiling": <has AsyncProfiling widget>
  },
  "layer-header": {
    "orderBy": "<column metric key>",
    "columns": [ /* 2-4 picker columns */ ]
  },
  "overview": {
    "groups": [
      { "title": "Latency & errors", "size": "auto", "metrics": [/* p95 + err (no p99 — redundant with p95 in a hero strip) */] },
      { "title": "Health", "size": "square", "metrics": [/* single apdex-like */] }
    ]
  },
  "dashboards": {
    "service": [ /* the *-service.json Overview tab widgets, mapped 1:1 */ ],
    "instance": [ /* *-instance.json Overview + JVM/CLR/etc tabs flattened */ ],
    "endpoint": [ /* *-endpoint.json Overview tab */ ]
  },
  "topology": {
    "nodeMetrics": [ /* center, ring, secondary */ ],
    "linkServerMetrics": [ /* RPM, respTime, p95, SLA — order matters for fallback */ ],
    "linkClientMetrics": [ /* same shape; omit on layers w/o client-side relations */ ]
  },
  "endpointDependency": {                  // only when components.endpointDependency
    "nodeMetrics": [ /* center, ring, secondary */ ],
    "linkMetrics":  [ /* server-only — endpoint relations have no client side in OAP */ ]
  }
}
```

### Step 7 — Validate

From `apps/bff`:
```bash
pnpm exec tsc --noEmit              # schema still typechecks
node --import tsx -e "import('./src/layers/loader.ts').then(m => { const t = m.getLayerTemplate('<KEY>'); console.log(JSON.stringify({key:t.key, components:t.components, headerCols:t.header.columns.length, dashScopes:Object.keys(t.dashboards||{}), topo:!!t.topology, epDep:!!t.endpointDependency}, null, 2)); })"
```

Sanity-check the JSON loads and surfaces all expected fields. If the BFF is running, hit `/api/menu` and `/api/layer/<key>/landing` against the demo OAP to confirm the picker columns resolve.

---

## Common pitfalls

1. **Scope mismatch — SERVICE_INSTANCE metrics in service dashboards.** A bare per-instance metric (e.g. `meter_oap_instance_cpu_percentage`, catalog `SERVICE_INSTANCE`) **does not work** in a service-scope picker / overview / line widget. You have three options:
   - **Picker column / overview / card** — wrap with `avg(...)` or `sum(...)` to coerce to a single scalar (e.g. `avg(meter_oap_instance_cpu_percentage)`).
   - **Service-dashboard line widget showing per-instance trends** — must be a **`top_n(...)` `top` widget**, never a bare `line`. The line widget at service scope can only render SERVICE-scope metrics.
   - **Per-instance metric on the instance scope** — put it under `dashboards.instance` and reference the bare metric; it works fine at instance entity.
   The same rule applies one level deeper for ENDPOINT-scope metrics in service dashboards — use `top_n` or aggregate.
2. **Labeled vs regular OAL/MAL output.** `aggregate_labels(metric, sum)` is only valid for LABELED_VALUE metrics. For REGULAR_VALUE metrics use plain `sum(metric)` / `avg(metric)`. Mixing them produces "result is not a labeled result" errors. Check `listMetrics(regex:^<name>$)` on the demo OAP to confirm catalog + type before composing.
3. **Card MQE includes `avg(...)`** — booster wraps card values in `avg(...)` because their card renderer expects a scalar. Horizon's card path *also* averages, so leaving the `avg(...)` works but is redundant. **For consistency, unwrap a single outer `avg()` from card expressions** unless removing it changes the shape (e.g. `avg(x)/100` becomes `x/100`, but `avg(x{p='99'})/100` stays as-is because the inner `{p='99'}` is the dimension we're averaging across).
2. **24-col → 12-col grid** — `w: 8` (booster) becomes `span: 4` (Horizon). Don't paste 24-col widths or widgets overflow the grid.
3. **InstanceList / EndpointList** — these are *not* widgets in Horizon. They're the layer page's built-in pickers. The booster widget's `subExpressions` array (per-row MQE) is the closest analogue; drop it (Horizon's landing route picks per-row metrics from `header.columns`).
4. **Relation files** — most of a `*-service-relation.json` collapses into the top-level `topology` block (server + client edge metrics). Don't replicate the relation widgets as flat `dashboards.dependency` entries unless they're metrics the topology renderer can't surface (e.g. relation-specific record widgets).
5. **`visibleWhen`** — booster instance dashboards bundle JVM / CLR / Golang / Python / Ruby / Spring widgets in the same scope, and the SPA hides ones with no data. Carry this over with `"visibleWhen": "<first_metric> has value"` so the Horizon Instance view stays clean for a single-runtime instance.
6. **No `Co-Authored-By` footers on commits** — per project `CLAUDE.md` and stored memory.

---

## Reference: General layer migration

The General layer (already migrated) is the canonical reference. Compare:

- Upstream files: `general-root.json`, `general-service.json`, `general-instance.json`, `general-endpoint.json`, `general-service-relation.json`, `general-instance-relation.json`, `general-endpoint-relation.json` (4565 lines total across 7 files)
- Horizon output: `apps/bff/src/bundled_templates/layers/general.json` (989 lines, one file)

Key transformations applied (use as a recipe):
- 7 nested `Tab` files → flat `dashboards.{service,instance,endpoint}` arrays (dependency + topology folded into top-level blocks)
- Card MQE unwrapped (`avg(service_apdex)/10000` → in card context Horizon does the avg, but kept as-is when the math is inside)
- Picker columns derived from the booster Overview tab's three card metrics: cpm / apdex / error rate
- Topology block merged `general-service-relation.json`'s `linkServerExpressions` / `linkClientExpressions` into a single block with four-metric server + client families (RPM / respTime / p95 / SLA)
- Slow-statements widget converted from booster's `TopList` with RECORD-typed MQE to Horizon's `record` type
- Multi-runtime instance widgets (JVM / CLR / Sleuth / Go / Python / Ruby) all carry `visibleWhen: "<first_metric> has value"` so instances only render the relevant rows
- `components.{traceProfiling, ebpfProfiling, asyncProfiling}` set from the three booster profiling tabs
