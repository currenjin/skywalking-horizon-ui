# CLAUDE.md - AI Assistant Guide for Apache SkyWalking Horizon UI

This file provides guidance for AI assistants working with the **skywalking-horizon-ui** codebase.

## Project Overview

**Horizon UI** is the next-generation web UI for [Apache SkyWalking](https://github.com/apache/skywalking). The goal is **feature parity** with [skywalking-booster-ui](https://github.com/apache/skywalking-booster-ui) on the **same OAP GraphQL query-protocol and MQE**, with a modernized, dense, dark-first design.

This is a **greenfield rewrite**, not a fork. Backend APIs do not change.

## Repository layout (target)

```
skywalking-horizon-ui/
├── .github/workflows/         # CI (skywalking-eyes header + dep-license, lint, type-check, build)
├── docs/                      # (gitignored) local design + planning docs during the build-out
├── public/                    # Static assets (favicon, logo)
├── src/
│   ├── main.ts                # entry
│   ├── App.vue                # shell
│   ├── assets/
│   │   └── styles/
│   │       └── tokens.css     # design tokens (lifted from design bundle, do NOT edit casually)
│   ├── router/                # vue-router routes (layer-first hierarchy)
│   ├── stores/                # Pinia stores (auth, layer, dashboard, alarm, …)
│   ├── graphql/
│   │   ├── client.ts          # graphql-request client pointed at /graphql
│   │   ├── queries/           # one file per query-protocol module
│   │   └── fragments/
│   ├── views/                 # top-level routed pages
│   │   ├── landing/           # global + per-layer landing
│   │   ├── metrics/           # service metrics deep-dive (multi-layer strip)
│   │   ├── topology/          # 3 variants: force / DAG / hex
│   │   ├── endpoint/          # multi-hop dependency
│   │   ├── dashboards/        # widget grid + per-scope templates (Glance/Service/Instance/Endpoint/Topology/Metric)
│   │   ├── traces/            # trace explorer
│   │   ├── logs/              # log explorer with condition bar, facets, JSON/YAML/raw payload
│   │   ├── alarms/            # active alarms (read-only) + live debug; recovery is backend-auto
│   │   ├── profiling/         # flame graph (later)
│   │   └── admin/             # LDAP/RBAC, users, roles, layer config — see "Admin & RBAC" below
│   ├── components/
│   │   ├── shell/             # sidebar, topbar, breadcrumbs, search
│   │   ├── charts/            # ECharts wrappers (TimeSeries, Heatmap, Sankey, Scatter, Stacked, Sparkline)
│   │   ├── topology/          # D3 wrappers (ForceGraph, DAG, HexGrid)
│   │   ├── trace/             # waterfall, span detail
│   │   ├── log/               # row, expanded panel, facets, condition bar
│   │   ├── dashboard/         # grid, widget, widget-editor, mqe-editor
│   │   ├── primitives/        # Button, Badge, Card, Table, Tag, KPI
│   │   └── icons/             # shared icon set (matches design bundle's Icon.*)
│   ├── composables/           # useTimeRange, useCrosshair (synced cursors), useLayer, …
│   ├── types/                 # auto-imports.d.ts, components.d.ts, query-protocol types
│   └── utils/                 # color scales, formatters, MQE token highlighter
├── tests/                     # Vitest, Cypress
├── LICENSE  NOTICE  HEADER
├── .licenserc.yaml            # skywalking-eyes config
├── .asf.yaml
├── package.json
├── vite.config.ts
└── tsconfig.json
```

## Design source of truth

During the build-out, the visual spec (HTML/JSX prototypes), design tokens snapshot, tech-stack rationale, and admin/RBAC design notes live **locally only** under `docs/` (gitignored). **The HTML/JSX prototypes are the visual spec.** Recreate them pixel-perfectly in Vue; don't blindly port the prototype's component structure — match the rendered output.

If you're an AI assistant and the `docs/` directory is missing, ask the user to share the design bundle before implementing visual work — do not invent layouts.

Design tokens have been lifted verbatim into `src/assets/styles/tokens.css` — that copy in `src/` is the canonical runtime version. The orange accent `#f97316` is the SkyWalking primary; dark surface ramps `--sw-bg-0..4`, line ramps `--sw-line / --sw-line-2 / --sw-line-3`, semantic colors (ok / warn / err / info / purple / pink / cyan).

The local `docs/` directory is temporary — it will be removed once every screen has a corresponding Vue implementation and visual sign-off. Don't reference its files from production code (other than the one-time `tokens.css` lift, already done).

## Tech stack

Locked decisions:

- **Vue 3 + TS** with `<script setup>` (matches booster-ui maintainer skillset)
- **Vite 5** build
- **Pinia** state, **vue-router 4** routing
- **ECharts 5** for time series / heatmap / sankey / scatter / stacked bar / donut
- **D3 v7** for topology (force-directed w/ traffic particles, DAG, hex), polar constellation, custom sparklines
- **d3-flame-graph** for profiling (later)
- **vue-grid-layout** for draggable / resizable dashboard widgets
- **Monaco editor** for MQE
- **graphql-request** for OAP GraphQL
- **vue-i18n** for i18n (mirror booster-ui locales)
- **Element Plus** sparingly — for things like complex selects/dropdowns; otherwise hand-rolled primitives match the design better

## Backend compatibility

The UI calls into the OAP server's GraphQL query-protocol (same as booster-ui). Source of truth: [skywalking-query-protocol](https://github.com/apache/skywalking-query-protocol) (`*.graphqls` schemas under `oap-server/server-query-plugin/.../query-protocol` in the skywalking repo).

Do NOT invent new fields. If a screen needs data that the protocol doesn't expose, flag it — the right fix is a query-protocol change in skywalking, not a UI hack.

## Admin & RBAC

The SkyWalking OAP server exposes an **admin host** (admin-grade APIs). Horizon UI must include first-class admin views:

- **LDAP integration** — bind config, search-base, attribute mapping, test-bind
- **RBAC** — roles, permissions per layer / per dashboard / per action (view / edit / debug alarm / edit layer config), user-role bindings. Alarms have no acknowledge / close / silence action — they are read-only and auto-recover on the backend.
- **Users** — local users + LDAP-backed users, group sync state
- **Audit log** — who edited what dashboard / changed which role / updated which auth provider
- **Layer admin** — per-layer menu mode (full / lite) + entity-term mapping (FaaS → Function/Version/Invocation, MQ → Cluster/Broker/Topic, …)
- **System health** — OAP cluster status, storage backend status (read from query-protocol `getOAPInfo` / cluster query)

These pages live under `src/views/admin/` and are guarded by a `requiresRole` route meta. The visual treatment matches the rest of Horizon UI (dark, dense, design tokens) — not a separate look.

## Code conventions

- **TypeScript strict** — no `any` outside `*.d.ts` shims
- **`<script setup>` + `<style scoped>`** in `.vue` files
- **Pinia** with `defineStore` (composition syntax)
- **Composables** are named `useXxx`, return `readonly()` where appropriate
- **Charts** are wrapped — never instantiate ECharts directly in a view; always go through `components/charts/*`. This is so we can swap library later and so theming/disposal is centralized.
- **D3** mounts into a `ref()` element from a composable; the composable owns the lifecycle and tears down on unmount.
- **Icon usage** — single icon component sourced from `components/icons/` (matching the design's `Icon.*` set). No icon font, no random SVG inlining.
- **No CSS-in-JS** — design uses CSS custom properties. Tailwind is NOT used (would fight the token system).

## Commits & PRs

**Never** add `Co-Authored-By: Claude` (or any AI / Anthropic / claude.com / `noreply@anthropic.com` line) to commit messages or PR bodies. Do not append the "🤖 Generated with Claude Code" footer. Per-project directive.

## License header

Every `.ts`, `.vue`, `.js`, `.yaml`, `.yml`, `.css`, `.scss` file must carry the Apache-2.0 header from `HEADER`. JSON, Markdown, lock files, and `.d.ts` files in `src/types/` are excluded — see `.licenserc.yaml`.

Run `license-eye -c .licenserc.yaml header check` locally before pushing.

## Common tasks

### Add a new GraphQL query

1. Add `.graphql` (or `gql\`\`` literal) under `src/graphql/queries/<module>.ts`
2. Type the result with hand-written types in `src/graphql/types/` (until codegen is wired up)
3. Call via the shared `graphqlClient` from `src/graphql/client.ts`
4. Surface as a composable `useXxxQuery()` returning `{ data, isLoading, error, refetch }`

### Add a new chart

1. Drop the ECharts/D3 wrapper into `src/components/charts/` (e.g. `LatencyHeatmap.vue`)
2. Accept `data`, `loading`, time-range props; emit `crosshair-move` if it participates in synced cursors
3. Register with `useCrosshair()` if it should sync with siblings on the page (see "Linked dashboard" design)

### Add a new dashboard scope

A "dashboard scope" = the entity the dashboard binds to (Service, Instance, Endpoint, Topology, Metric drill, Glance). Add it as:
1. Template under `src/views/dashboards/templates/<scope>.json` (widget grid JSON spec)
2. Route under `src/router/dashboards.ts`
3. Sidebar entry in the per-layer menu config (`src/stores/layer.ts`)

### Add a new layer

Layers are first-class navigation. Adding one means:
1. Register the data source + default menu mode (full / lite) in `src/stores/layer.ts`
2. Map entity terms (Service/Instance/Endpoint slots) if the layer uses non-standard terminology
3. Provide a layer-overview page or default to the generic one

## Tips for AI assistants

1. **Read the design first** — the prototypes in the local `docs/` directory (gitignored) are authoritative for visuals. Don't invent layouts; if `docs/` is missing, ask for it.
2. **Don't change backend contracts** — OAP query-protocol is fixed. If you need a new field, flag it; don't fake it client-side.
3. **Multi-layer is the spine** — almost every screen has "this could appear in multiple layers" semantics. Build for that from day one, not as an afterthought.
4. **Synced crosshairs matter** — multiple time-series on a dashboard share one cursor (see linked dashboard design). Don't build charts that ignore this.
5. **Density beats whitespace** — this is an observability-class UI. Information density is a feature.
6. **MQE everywhere** — metric expressions are user-editable, syntax-highlighted, debuggable (see Alarms › Live debug). Treat MQE editing as a core capability, not a config-screen afterthought.
7. **License headers** — required on all source files. CI enforces.
8. **Admin = same look** — LDAP/RBAC/admin views use the same dark dense tokens, not a separate "settings" UI.
