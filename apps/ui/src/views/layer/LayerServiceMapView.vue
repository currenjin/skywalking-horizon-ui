<!--
  Licensed to the Apache Software Foundation (ASF) under one or more
  contributor license agreements.  See the NOTICE file distributed with
  this work for additional information regarding copyright ownership.
  The ASF licenses this file to You under the Apache License, Version 2.0
  (the "License"); you may not use this file except in compliance with
  the License.  You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
-->
<!--
  Per-layer Topology tab — left-to-right hierarchical service map with
  circular nodes.

  Layout
    User nodes (`isReal === false` OR `name === 'User'`) anchor column 0.
    BFS depth from there decides each node's column. Within a column
    nodes are sorted by RPM (descending) so the heavy lanes stay
    visually aligned across columns.

  Visual binding
    Every visual channel reads from the LAYER TEMPLATE's `topology`
    block (delivered in the response's `config` field):
      - the metric with `role: 'center'`     → number printed inside
                                                the circle, with its
                                                configured unit
      - the metric with `role: 'ring'`       → SLA-style colour band on
                                                the circle's perimeter
      - the metric with `role: 'secondary'`  → surfaced in detail panel
                                                + node tooltip
      - linkServerMetrics[`role: lineServer`] / linkClientMetrics[`role: lineClient`]
        → edge thickness; server has priority, client is the fallback.
    Nothing is hardcoded; swapping `mqe` / `unit` / `role` in the layer
    JSON is enough to repaint.

  Heaviest path
    Greedy walk from the highest-traffic entry. At each step we pick
    the outgoing edge with the highest server-cpm, falling back to
    client-cpm when server is null (per operator direction). The
    accent stroke highlights the dominant call lane.

  Large graphs
    Columns cap at NODES_PER_LAYER by RPM; overflow folds into a
    "+N more" chip per column. The whole SVG sits in an overflow:auto
    scroll container.
-->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as d3 from 'd3';
import { useRoute, useRouter } from 'vue-router';
import type {
  LayerDef,
  TopologyCall,
  TopologyMetricDef,
  TopologyNode,
} from '@/api/client';
import { useLayerTopology } from '@/composables/useLayerTopology';
import { useSelectedService } from '@/composables/useSelectedService';
import { useLayerLanding } from '@/composables/useLayerLanding';
import { useLayers } from '@/composables/useLayers';
import { useSetupStore } from '@/stores/setup';
import { fmtMetric } from '@/utils/formatters';
import Sparkline from '@/components/charts/Sparkline.vue';
import { isUserNode } from '@/composables/useTopologyIcons';

const route = useRoute();
const router = useRouter();
const layerKey = computed(() => String(route.params.layerKey ?? ''));
const { selectedId, setSelected: setSelectedService } = useSelectedService();

const { layers } = useLayers();
const layer = computed<LayerDef | null>(
  () => layers.value.find((l) => l.key === layerKey.value) ?? null,
);
const store = useSetupStore();
const safeLayer = computed<LayerDef>(() => layer.value ?? {
  key: layerKey.value, name: layerKey.value, color: 'var(--sw-fg-2)',
  serviceCount: -1, active: false, level: null, slots: {}, caps: {},
});
const safeCfg = computed(() => {
  if (!layer.value) return { priority: 99, topN: 5, orderBy: 'cpm', columns: [], style: 'table' as const };
  return store.ensure(layer.value.key, {
    slots: layer.value.slots, caps: layer.value.caps, metrics: layer.value.metrics, overview: layer.value.overview,
  }).landing;
});
const landing = useLayerLanding(safeLayer, safeCfg);
const serviceName = computed<string | null>(() => {
  const rows = landing.data.value?.sampledRows ?? landing.rows.value ?? [];
  const match = rows.find((r) => r.serviceId === selectedId.value);
  return match?.serviceName ?? null;
});
const landingRows = computed(() => landing.data.value?.sampledRows ?? landing.rows.value ?? []);
watch(
  landingRows,
  (rows) => {
    if (selectedId.value) return;
    const first = rows[0];
    if (first) setSelectedService(first.serviceId);
  },
  { immediate: true },
);

const depth = ref<number>(2);
const { nodes, calls, isLoading, isFetching, data, refetch } = useLayerTopology(
  layerKey,
  serviceName,
  depth,
);
const reachable = computed(() => data.value?.reachable !== false);
const errorText = computed(() => data.value?.error ?? null);

// ── Config from response (operator-edited layer JSON). Falls back to
// an empty config when the BFF hasn't responded yet — the renderer
// degrades gracefully to neutral colours / no number.
const cfg = computed(() => data.value?.config ?? {
  nodeMetrics: [] as TopologyMetricDef[],
  linkServerMetrics: [] as TopologyMetricDef[],
  linkClientMetrics: [] as TopologyMetricDef[],
});
function pickByRole(defs: TopologyMetricDef[], role: TopologyMetricDef['role']): TopologyMetricDef | null {
  return defs.find((d) => d.role === role) ?? null;
}
const ringDef = computed(() => pickByRole(cfg.value.nodeMetrics, 'ring'));
const centerDef = computed(() => pickByRole(cfg.value.nodeMetrics, 'center'));
const secondaryDef = computed(() => pickByRole(cfg.value.nodeMetrics, 'secondary'));
const lineServerDef = computed(() => pickByRole(cfg.value.linkServerMetrics ?? [], 'lineServer'));
const lineClientDef = computed(() => pickByRole(cfg.value.linkClientMetrics ?? [], 'lineClient'));

function nodeVal(n: TopologyNode, def: TopologyMetricDef | null): number | null {
  if (!def) return null;
  const v = n.metrics?.[def.id];
  return v ?? null;
}
function edgeVal(
  c: TopologyCall,
  side: 'server' | 'client',
  def: TopologyMetricDef | null,
): number | null {
  if (!def) return null;
  const bucket = side === 'server' ? c.serverMetrics : c.clientMetrics;
  const v = bucket?.[def.id];
  return v ?? null;
}
/** Per-bucket series for the edge sidebar's twin sparklines. */
function edgeSeries(
  c: TopologyCall,
  side: 'server' | 'client',
  def: TopologyMetricDef | null,
): Array<number | null> {
  if (!def) return [];
  const bucket = side === 'server' ? c.serverMetricSeries : c.clientMetricSeries;
  return bucket?.[def.id] ?? [];
}

// ── Layered layout (BFS depth from entry points).
interface LayoutNode extends TopologyNode {
  layerIdx: number;
}
/** Only the literal `User` node OAP emits counts as the entry-user.
 *  Synthetic non-real nodes (localhost:-1, external IPs) are NOT users;
 *  they're unattributed callers and we render them with their own
 *  cloud-shaped icon so the operator can tell them apart. */
function isUser(n: TopologyNode): boolean {
  return isUserNode(n);
}
const layoutNodes = computed<LayoutNode[]>(() => {
  const all = nodes.value;
  if (all.length === 0) return [];
  const callsList = calls.value;
  const downstream = new Map<string, string[]>();
  const upstream = new Map<string, string[]>();
  for (const c of callsList) {
    if (!downstream.has(c.source)) downstream.set(c.source, []);
    downstream.get(c.source)!.push(c.target);
    if (!upstream.has(c.target)) upstream.set(c.target, []);
    upstream.get(c.target)!.push(c.source);
  }
  const userIds = new Set(all.filter(isUser).map((n) => n.id));
  const roots: string[] = [...userIds];
  for (const n of all) {
    if (userIds.has(n.id)) continue;
    if ((upstream.get(n.id) ?? []).length === 0) roots.push(n.id);
  }
  if (roots.length === 0) {
    const focus = all.find((n) => n.name === serviceName.value);
    if (focus) roots.push(focus.id);
    else {
      const sorted = [...all].sort((a, b) => (nodeVal(b, centerDef.value) ?? 0) - (nodeVal(a, centerDef.value) ?? 0));
      if (sorted[0]) roots.push(sorted[0].id);
    }
  }
  const layerOf = new Map<string, number>();
  for (const r of roots) layerOf.set(r, 0);
  let changed = true;
  let safety = all.length + 8;
  while (changed && safety-- > 0) {
    changed = false;
    for (const c of callsList) {
      const s = layerOf.get(c.source);
      if (s === undefined) continue;
      const tCur = layerOf.get(c.target);
      const want = s + 1;
      if (tCur === undefined || want > tCur) {
        layerOf.set(c.target, want);
        changed = true;
      }
    }
  }
  const maxLayer = Math.max(0, ...layerOf.values());
  for (const n of all) {
    if (!layerOf.has(n.id)) layerOf.set(n.id, maxLayer + 1);
  }
  return all.map((n) => ({ ...n, layerIdx: layerOf.get(n.id)! }));
});

// ── Heaviest-path. Walk from the busiest entry; at each step pick the
// outgoing edge with the highest server-cpm (preferred) or client-cpm
// (fallback). The order of preference is operator-controlled via the
// node ordering in `linkServerMetrics` / `linkClientMetrics`.
function edgeWeight(c: TopologyCall): number {
  const s = edgeVal(c, 'server', lineServerDef.value);
  if (s !== null) return s;
  const cl = edgeVal(c, 'client', lineClientDef.value);
  if (cl !== null) return cl;
  return 0;
}
const heaviestEdges = computed<Set<string>>(() => {
  const out = new Set<string>();
  const callsList = calls.value;
  if (callsList.length === 0) return out;
  const byId = new Map(layoutNodes.value.map((n) => [n.id, n]));
  const outBy = new Map<string, TopologyCall[]>();
  for (const c of callsList) {
    if (!outBy.has(c.source)) outBy.set(c.source, []);
    outBy.get(c.source)!.push(c);
  }
  const roots = layoutNodes.value.filter((n) => n.layerIdx === 0);
  function rootScore(n: LayoutNode): number {
    const own = nodeVal(n, centerDef.value);
    if (own !== null) return own;
    const outs = outBy.get(n.id) ?? [];
    let best = 0;
    for (const c of outs) {
      const t = byId.get(c.target);
      if (t) best = Math.max(best, nodeVal(t, centerDef.value) ?? 0, edgeWeight(c));
    }
    return best;
  }
  const sortedRoots = [...roots].sort((a, b) => rootScore(b) - rootScore(a));
  const start = sortedRoots[0];
  if (!start) return out;
  let cursor: LayoutNode | undefined = start;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    const outs = outBy.get(cursor.id) ?? [];
    if (outs.length === 0) break;
    let best: TopologyCall | null = null;
    let bestScore = -Infinity;
    for (const c of outs) {
      const score = edgeWeight(c);
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    if (!best) break;
    out.add(best.id);
    cursor = byId.get(best.target);
  }
  return out;
});
const heaviestNodes = computed<Set<string>>(() => {
  const set = new Set<string>();
  const byId = new Map(calls.value.map((c) => [c.id, c]));
  for (const id of heaviestEdges.value) {
    const c = byId.get(id);
    if (!c) continue;
    set.add(c.source);
    set.add(c.target);
  }
  return set;
});

const NODES_PER_LAYER = 12;
interface LayerColumn {
  index: number;
  label: string;
  visible: LayoutNode[];
  hidden: number;
}
const layerColumns = computed<LayerColumn[]>(() => {
  const byLayer = new Map<number, LayoutNode[]>();
  for (const n of layoutNodes.value) {
    if (!byLayer.has(n.layerIdx)) byLayer.set(n.layerIdx, []);
    byLayer.get(n.layerIdx)!.push(n);
  }
  const indices = [...byLayer.keys()].sort((a, b) => a - b);
  const heavy = heaviestNodes.value;
  return indices.map((i) => {
    const list = byLayer.get(i)!.slice().sort((a, b) => {
      const hA = heavy.has(a.id) ? 1 : 0;
      const hB = heavy.has(b.id) ? 1 : 0;
      if (hA !== hB) return hB - hA;
      return (nodeVal(b, centerDef.value) ?? 0) - (nodeVal(a, centerDef.value) ?? 0);
    });
    const keep: LayoutNode[] = [];
    const overflow: LayoutNode[] = [];
    for (const n of list) {
      if (keep.length < NODES_PER_LAYER || heavy.has(n.id)) keep.push(n);
      else overflow.push(n);
    }
    const label = i === 0 ? 'L0 · Entry' : `L${i} · Tier ${i}`;
    return { index: i, label, visible: keep, hidden: overflow.length };
  });
});

// ── SVG layout math (circles).
const NODE_R = 42;
// Layout spacing — node circle (R*2) + halo + label/metric room.
// Larger ROW_GAP than before so the dashed selection halo at r=56
// doesn't bump into the neighbouring row.
const COL_GAP = 240;
const ROW_GAP = NODE_R * 2 + 90;
const W = computed(() => Math.max(820, layerColumns.value.length * COL_GAP + 80));
const H = computed(() => {
  const maxNodes = Math.max(1, ...layerColumns.value.map((c) => c.visible.length));
  return 90 + maxNodes * ROW_GAP + 40;
});
interface Pos { cx: number; cy: number }
const nodePos = computed<Map<string, Pos>>(() => {
  const map = new Map<string, Pos>();
  layerColumns.value.forEach((col, colIdx) => {
    const cx = 40 + colIdx * COL_GAP + NODE_R + 4;
    col.visible.forEach((n, rowIdx) => {
      const cy = 110 + rowIdx * ROW_GAP + NODE_R;
      map.set(n.id, { cx, cy });
    });
  });
  return map;
});
const visibleCalls = computed<TopologyCall[]>(() => {
  const ids = new Set(nodePos.value.keys());
  return calls.value.filter((c) => ids.has(c.source) && ids.has(c.target));
});
const elidedTotal = computed(() =>
  layerColumns.value.reduce((acc, c) => acc + c.hidden, 0),
);

// ── Ring colour band. Maps the ringDef metric value to an ok/warn/err
// band; for SLA (0..100, higher is healthier) we invert, otherwise we
// treat higher as worse. The mapping is intentionally simple — a more
// elaborate threshold config can live on the metric def later.
function ringColor(n: TopologyNode): string {
  const def = ringDef.value;
  if (!def) return 'var(--sw-line-2)';
  const v = nodeVal(n, def);
  if (v === null) return 'var(--sw-fg-3)';
  const isHealthHigh = /sla|success|apdex/i.test(def.id) || /sla|apdex|success/i.test(def.label);
  const errPct = isHealthHigh ? Math.max(0, 100 - v) : v;
  if (errPct > 5) return 'var(--sw-err)';
  if (errPct > 1) return 'var(--sw-warn)';
  if (errPct > 0.1) return '#fbbf24';
  return 'var(--sw-ok)';
}
/**
 * Node kind — drives the icon shape rendered inside the ring. We map
 * each topology node to one of three SVG icon families, matching the
 * polished linear-chain design spec:
 *
 *   - `client`   — entry caller (literal `User` node OAP emits).
 *                  Drawn as a stylised user silhouette pair.
 *   - `external` — synthetic non-real callee (localhost:-1 / external
 *                  endpoint). Drawn as a cloud with a `?` glyph.
 *   - `service`  — every other real node. Drawn as a 3D box made of
 *                  three polygons to keep the booster-ui feel.
 */
function nodeKind(n: TopologyNode): 'client' | 'service' | 'external' {
  if (n.name === 'User') return 'client';
  if (!n.isReal) return 'external';
  return 'service';
}
/** Pick the edge metric to surface as a label. Server-side first per
 *  operator direction; falls back to client when null. */
function edgeLabel(c: TopologyCall): { value: number; unit: string; isClient: boolean } | null {
  const sDef = lineServerDef.value;
  if (sDef) {
    const v = edgeVal(c, 'server', sDef);
    if (v !== null) return { value: v, unit: sDef.unit ?? '', isClient: false };
  }
  const cDef = lineClientDef.value;
  if (cDef) {
    const v = edgeVal(c, 'client', cDef);
    if (v !== null) return { value: v, unit: cDef.unit ?? '', isClient: true };
  }
  return null;
}
/**
 * True when this call has a mirror in the opposite direction. We
 * use a deterministic offset sign (`source < target` ? +1 : -1) so
 * the two arcs of a bi-directional pair always go to opposite sides
 * of the midline regardless of iteration order.
 */
function hasReverse(c: TopologyCall): boolean {
  return calls.value.some((x) => x.source === c.target && x.target === c.source);
}
function bowSign(c: TopologyCall): number {
  if (!hasReverse(c)) return 0;
  return c.source < c.target ? 1 : -1;
}
/**
 * Curved edge between two node circles. The bow keeps the line from
 * disappearing into a straight pipe between adjacent columns; for
 * bi-directional pairs the two arcs bow to opposite sides so both
 * lines are visible. Arrow heads are deliberately omitted — the
 * animated traffic dots already advertise direction.
 */
function callPathD(c: TopologyCall): string {
  const a = nodePos.value.get(c.source);
  const b = nodePos.value.get(c.target);
  if (!a || !b) return '';
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const x1 = a.cx + ux * NODE_R;
  const y1 = a.cy + uy * NODE_R;
  const x2 = b.cx - ux * NODE_R;
  const y2 = b.cy - uy * NODE_R;
  const perpX = -uy;
  const perpY = ux;
  const bow = Math.min(30, Math.max(14, len * 0.10));
  const sign = bowSign(c);
  // Pure-arc curves are flat for non-reversed edges; the sign === 0
  // case still bows a touch (12px) so adjacent columns don't read as
  // a straight pipe.
  const amplitude = sign === 0 ? 12 : bow;
  const signed = sign === 0 ? -1 : sign;
  const cx = (x1 + x2) / 2 + perpX * amplitude * signed;
  const cy = (y1 + y2) / 2 + perpY * amplitude * signed;
  return `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;
}
function edgeMidpoint(c: TopologyCall): { x: number; y: number } | null {
  const a = nodePos.value.get(c.source);
  const b = nodePos.value.get(c.target);
  if (!a || !b) return null;
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const perpX = -uy;
  const perpY = ux;
  const bow = Math.min(30, Math.max(14, len * 0.10));
  const sign = bowSign(c);
  const amplitude = sign === 0 ? 12 : bow;
  const signed = sign === 0 ? -1 : sign;
  // Midpoint along the arc — using 0.5 along the quadratic
  // approximates as the control point's reflection of the chord
  // mid; close enough for placing the metric chip.
  return {
    x: (a.cx + b.cx) / 2 + perpX * amplitude * signed * 0.55,
    y: (a.cy + b.cy) / 2 + perpY * amplitude * signed * 0.55,
  };
}

// Detail-panel selection. Node and edge selections are INDEPENDENT —
// both can be active at once, surfacing the two detail cards
// side-by-side below the map. The polished linear-chain design
// (`docs/design/.../screens/topology-chain.jsx`) lays them out that
// way so the operator can compare a service's metrics against the
// call edge's metrics in one glance without toggling between them.
const selectedNodeId = ref<string | null>(null);
const selectedCallId = ref<string | null>(null);
function selectNode(id: string | null): void {
  selectedNodeId.value = selectedNodeId.value === id ? null : id;
}
function selectCall(id: string | null): void {
  selectedCallId.value = selectedCallId.value === id ? null : id;
}
const selectedNode = computed<LayoutNode | null>(() => {
  const id = selectedNodeId.value;
  if (!id) return null;
  return layoutNodes.value.find((n) => n.id === id) ?? null;
});
const selectedCall = computed<TopologyCall | null>(() => {
  const id = selectedCallId.value;
  if (!id) return null;
  return calls.value.find((c) => c.id === id) ?? null;
});
const selectedCallSource = computed<LayoutNode | null>(() => {
  const c = selectedCall.value;
  if (!c) return null;
  return layoutNodes.value.find((n) => n.id === c.source) ?? null;
});
const selectedCallTarget = computed<LayoutNode | null>(() => {
  const c = selectedCall.value;
  if (!c) return null;
  return layoutNodes.value.find((n) => n.id === c.target) ?? null;
});

/**
 * Build a row per metric for the edge-detail sidebar. We pair up the
 * server + client metric defs by `id`, so a metric defined on only
 * one side renders as that side only. The row always carries the
 * label + unit so the y-axis stays aligned across rows.
 */
interface EdgeRow {
  id: string;
  label: string;
  unit: string;
  serverDef: TopologyMetricDef | null;
  clientDef: TopologyMetricDef | null;
}
const edgeRows = computed<EdgeRow[]>(() => {
  const map = new Map<string, EdgeRow>();
  for (const m of cfg.value.linkServerMetrics ?? []) {
    const row: EdgeRow =
      map.get(m.id) ??
      ({ id: m.id, label: m.label, unit: m.unit ?? '', serverDef: null, clientDef: null } as EdgeRow);
    row.serverDef = m;
    if (!map.has(m.id)) {
      row.label = m.label;
      row.unit = m.unit ?? '';
    }
    map.set(m.id, row);
  }
  for (const m of cfg.value.linkClientMetrics ?? []) {
    const row: EdgeRow =
      map.get(m.id) ??
      ({ id: m.id, label: m.label, unit: m.unit ?? '', serverDef: null, clientDef: null } as EdgeRow);
    row.clientDef = m;
    if (!map.has(m.id)) {
      row.label = m.label;
      row.unit = m.unit ?? '';
    }
    map.set(m.id, row);
  }
  return [...map.values()];
});
/**
 * Resolve a row's display state. The kind is determined by VALUE
 * availability, not just metric-def presence: an edge with only a
 * server reading (e.g. `User → consumer` — client side has no agent)
 * collapses to `server-only`, even though both metric defs exist on
 * the layer config.
 *
 *   - `both`        — both sides have non-null values.
 *   - `client-only` — only client has a value.
 *   - `server-only` — only server has a value.
 *   - `none`        — neither side has a value (or no def at all).
 */
type EdgeRowKind = 'both' | 'client-only' | 'server-only' | 'none';
function edgeRowValues(c: TopologyCall, row: EdgeRow): {
  kind: EdgeRowKind;
  clientV: number | null;
  serverV: number | null;
} {
  const clientV = row.clientDef ? edgeVal(c, 'client', row.clientDef) : null;
  const serverV = row.serverDef ? edgeVal(c, 'server', row.serverDef) : null;
  const hasClientV = clientV !== null;
  const hasServerV = serverV !== null;
  if (hasClientV && hasServerV) return { kind: 'both', clientV, serverV };
  if (hasClientV) return { kind: 'client-only', clientV, serverV };
  if (hasServerV) return { kind: 'server-only', clientV, serverV };
  return { kind: 'none', clientV, serverV };
}
const upstream = computed<LayoutNode[]>(() => {
  const sel = selectedNode.value;
  if (!sel) return [];
  const ids = new Set(calls.value.filter((c) => c.target === sel.id).map((c) => c.source));
  return layoutNodes.value.filter((n) => ids.has(n.id));
});
const downstream = computed<LayoutNode[]>(() => {
  const sel = selectedNode.value;
  if (!sel) return [];
  const ids = new Set(calls.value.filter((c) => c.source === sel.id).map((c) => c.target));
  return layoutNodes.value.filter((n) => ids.has(n.id));
});

/**
 * Resolve the layer key we should jump into for the selected node.
 * A service may belong to multiple OAP layers (e.g. a Java service
 * tagged `general` AND `k8s-service`); OAP returns the complete list
 * on `node.layers`. Stay in the current layer when it's in that list,
 * else fall back to the first one — landing on a layer that doesn't
 * contain the service produces a confusing empty page.
 */
function targetLayerFor(n: TopologyNode): string {
  const current = layerKey.value.toUpperCase();
  const layers = n.layers ?? [];
  const pick = layers.includes(current) ? current : (layers[0] ?? current);
  return pick.toLowerCase();
}
function jumpToService(): void {
  const sel = selectedNode.value;
  if (!sel) return;
  void router.push({
    path: `/layer/${targetLayerFor(sel)}/service`,
    query: { service: sel.id },
  });
}
function jumpToEndpointDependency(): void {
  const sel = selectedNode.value;
  if (!sel) return;
  void router.push({
    path: `/layer/${targetLayerFor(sel)}/dependency`,
    query: { service: sel.id },
  });
}

// ────────────────────────────────────────────────────────────────────
// Pan + zoom via d3.zoom. Wheel scrolls in/out, trackpad pinch
// zooms, drag pans. Browser-level Ctrl+/- still works for whole-page
// zoom; this is the in-canvas equivalent operators expect on a
// service-map. The transform applies to a `<g class="zoom-layer">`
// inside the SVG, so the gradient, baselines, edges, and nodes all
// transform together.
//
// We auto-fit on mount and on graph-shape changes so the operator
// lands on a sensible default no matter how wide the chain is.
// ────────────────────────────────────────────────────────────────────
const svgEl = ref<SVGSVGElement | null>(null);
const zoomLayerEl = ref<SVGGElement | null>(null);
const containerEl = ref<HTMLDivElement | null>(null);
let zoomBehaviour: d3.ZoomBehavior<SVGSVGElement, unknown> | null = null;
const zoomT = ref<{ k: number; x: number; y: number }>({ k: 1, x: 0, y: 0 });

function viewportSize(): { width: number; height: number } {
  const el = containerEl.value;
  if (!el) return { width: W.value, height: H.value };
  const rect = el.getBoundingClientRect();
  return { width: rect.width || W.value, height: rect.height || H.value };
}

/** Fit the graph's bounding box into the visible canvas, leaving a
 *  little padding. Called on mount + when the graph shape changes
 *  + when the operator hits the Fit button. */
function fitToScreen(animate = true): void {
  if (!svgEl.value || !zoomBehaviour) return;
  const vp = viewportSize();
  const pad = 24;
  const scale = Math.min(
    (vp.width - pad * 2) / W.value,
    (vp.height - pad * 2) / H.value,
    1.5, // never overshoot too far
  );
  const k = Math.max(0.15, scale);
  const tx = (vp.width - W.value * k) / 2;
  const ty = (vp.height - H.value * k) / 2;
  const sel = d3.select(svgEl.value);
  const transform = d3.zoomIdentity.translate(tx, ty).scale(k);
  if (animate) {
    sel.transition().duration(220).call(zoomBehaviour.transform, transform);
  } else {
    sel.call(zoomBehaviour.transform, transform);
  }
}
function zoomBy(factor: number): void {
  if (!svgEl.value || !zoomBehaviour) return;
  d3.select(svgEl.value).transition().duration(160).call(zoomBehaviour.scaleBy, factor);
}

function installZoom(): void {
  if (!svgEl.value || !zoomLayerEl.value) return;
  const sel = d3.select(svgEl.value);
  zoomBehaviour = d3
    .zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.15, 5])
    .filter((event) => {
      // Ignore zoom on right-click — leaves the context menu usable.
      // Wheel + dblclick + drag all proceed normally; pinch on
      // trackpads fires `wheel` with ctrlKey=true which d3 handles.
      if (event.type === 'mousedown' && (event as MouseEvent).button !== 0) return false;
      return !(event as MouseEvent).button;
    })
    .on('zoom', (ev) => {
      zoomT.value = { k: ev.transform.k, x: ev.transform.x, y: ev.transform.y };
      d3.select(zoomLayerEl.value).attr('transform', ev.transform.toString());
    });
  sel.call(zoomBehaviour);
  // Double-click resets to fit — friendlier than d3's default
  // "double-click to zoom in by 2x" which often takes the operator
  // by surprise.
  sel.on('dblclick.zoom', null);
  sel.on('dblclick', () => fitToScreen(true));
}

onMounted(() => {
  // Defer one tick so the SVG has been rendered (layoutNodes drives
  // its mount through v-if).
  void nextTick(() => {
    installZoom();
    if (svgEl.value) fitToScreen(false);
  });
});
onBeforeUnmount(() => {
  if (svgEl.value) d3.select(svgEl.value).on('.zoom', null).on('dblclick', null);
  zoomBehaviour = null;
});
// Re-fit when the graph's shape changes substantially (depth toggle,
// data refresh that adds/removes nodes). Layout-dependent dims (W/H)
// are the cheapest signal that something visible changed.
watch(
  () => `${W.value}x${H.value}x${layoutNodes.value.length}`,
  () => {
    // If the SVG remounts (v-if), we need to re-install zoom. Defer.
    void nextTick(() => {
      if (!zoomBehaviour) installZoom();
      fitToScreen(false);
    });
  },
);

function fmtWithUnit(v: number | null | undefined, unit: string | undefined): string {
  if (v === null || v === undefined) return '—';
  const s = fmtMetric(v);
  return unit ? `${s} ${unit}` : s;
}
</script>

<template>
  <div class="sm-tab">
    <header class="sm-toolbar sw-card">
      <div class="left">
        <span class="kicker">Topology</span>
        <span v-if="serviceName" class="for-svc">centred on <b>{{ serviceName }}</b></span>
        <span v-else class="for-svc">layer overview</span>
        <span v-if="isFetching" class="hint">refreshing…</span>
      </div>
      <div class="right">
        <label class="depth-pick">
          <span>Depth</span>
          <select v-model.number="depth">
            <option :value="1">1 hop</option>
            <option :value="2">2 hops</option>
            <option :value="3">3 hops</option>
          </select>
        </label>
        <button class="sw-btn small" type="button" @click="() => refetch()">Refresh</button>
      </div>
    </header>

    <div v-if="!reachable" class="banner err">
      <strong>OAP unreachable.</strong>
      {{ errorText ?? 'Topology feed failed — check the BFF and OAP.' }}
    </div>

    <section class="sm-card sw-card">
      <div ref="containerEl" class="sm-graph">
        <!-- Single SVG that fills the container; pan/zoom transforms
             apply to the inner `<g class="zoom-layer">`. No scroll
             wrapper — wheel + pinch + drag handle navigation. -->
        <svg
          v-if="layoutNodes.length > 0"
          ref="svgEl"
          class="sm-svg"
          width="100%"
          height="100%"
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <radialGradient id="sm-bg-glow" cx="50%" cy="50%" r="60%">
              <stop offset="0%" stop-color="rgba(249,115,22,0.05)" />
              <stop offset="100%" stop-color="transparent" />
            </radialGradient>
          </defs>
          <g ref="zoomLayerEl" class="zoom-layer">
            <!-- Soft radial glow behind the chain — pure decoration. -->
            <rect :width="W" :height="H" fill="url(#sm-bg-glow)" />

            <!-- Single-baseline guide along the median row (single-row
                 chains) or one guide per row (fan-out columns). The
                 linear-chain design uses a single horizontal dashed
                 line through every node. -->
            <line
              v-for="r in Array.from({ length: Math.max(1, ...layerColumns.map((c) => c.visible.length)) }, (_, i) => i)"
              :key="`baseline-${r}`"
              x1="40"
              :x2="W - 40"
              :y1="110 + r * ROW_GAP + NODE_R"
              :y2="110 + r * ROW_GAP + NODE_R"
              stroke="var(--sw-line)"
              stroke-dasharray="2 6"
              opacity="0.4"
            />

            <g
              v-for="c in visibleCalls"
              :key="c.id"
              class="sm-edge"
              @click.stop="selectCall(c.id)"
            >
              <!-- Invisible wide hit-path: gives the operator a
                   ~14px-wide clickable corridor along the edge so
                   landing the cursor on a 2px line isn't fiddly. The
                   visible path on top draws the actual edge. -->
              <path
                :d="callPathD(c)"
                fill="none"
                stroke="transparent"
                stroke-width="14"
                style="cursor: pointer"
              />
              <path
                :d="callPathD(c)"
                fill="none"
                :stroke="selectedCallId === c.id ? 'var(--sw-accent-2)' : heaviestEdges.has(c.id) ? 'var(--sw-accent)' : 'var(--sw-line-3)'"
                :stroke-width="selectedCallId === c.id ? 3 : heaviestEdges.has(c.id) ? 2.6 : 1.2"
                :opacity="selectedCallId === c.id ? 1 : heaviestEdges.has(c.id) ? 0.95 : 0.45"
                stroke-linecap="round"
                style="pointer-events: none"
              />
              <!-- Animated traffic dots — only on heavy / selected
                   edges so the canvas doesn't shimmer everywhere.
                   Mirrors the polished linear-chain design's "live
                   flow" suggestion. -->
              <template v-if="heaviestEdges.has(c.id) || selectedCallId === c.id">
                <circle
                  v-for="off in [0, 0.5, 1.0]"
                  :key="off"
                  r="2.2"
                  :fill="selectedCallId === c.id ? 'var(--sw-accent-2)' : 'var(--sw-accent)'"
                  opacity="0.85"
                  style="pointer-events: none"
                >
                  <animateMotion
                    :dur="`${2.4 + (off * 0.4)}s`"
                    :begin="`${off}s`"
                    repeatCount="indefinite"
                    :path="callPathD(c)"
                  />
                </circle>
              </template>
              <!-- Edge metric chip — sits on the line midpoint with a
                   pill background. Compact by design (edge metrics
                   aren't the headline signal; they ride alongside the
                   line). The chip shows the configured line metric
                   value + unit; `(C)` marker when only client-side
                   data was available. -->
              <template v-if="edgeLabel(c) && edgeMidpoint(c)">
                <g
                  :transform="`translate(${edgeMidpoint(c)!.x - 30}, ${edgeMidpoint(c)!.y - 9})`"
                  style="pointer-events: none"
                >
                  <rect
                    x="0"
                    y="0"
                    width="60"
                    height="16"
                    rx="8"
                    fill="var(--sw-bg-1)"
                    :stroke="selectedCallId === c.id ? 'var(--sw-accent-2)' : heaviestEdges.has(c.id) ? 'var(--sw-accent)' : 'var(--sw-line-2)'"
                    :stroke-width="selectedCallId === c.id ? 1.4 : 1"
                  />
                  <text
                    x="30"
                    y="11"
                    text-anchor="middle"
                    :fill="selectedCallId === c.id ? 'var(--sw-accent-2)' : heaviestEdges.has(c.id) ? 'var(--sw-accent-2)' : 'var(--sw-fg-2)'"
                    font-size="9"
                    font-family="var(--sw-mono)"
                    font-weight="700"
                  >
                    {{ fmtMetric(edgeLabel(c)!.value) }}<tspan v-if="edgeLabel(c)!.unit" :dx="2" fill="var(--sw-fg-3)" font-weight="500">{{ edgeLabel(c)!.unit }}</tspan><tspan v-if="edgeLabel(c)!.isClient" :dx="2" fill="var(--sw-fg-3)">·C</tspan>
                  </text>
                </g>
              </template>
            </g>

            <!-- Polished linear-chain node — pure SVG, no PNGs. Three
                 concentric circles + a kind-specific icon + agent
                 badge top-right + name/metric text below. Mirrors
                 docs/.../screens/topology-chain.jsx. -->
            <g
              v-for="n in layoutNodes.filter((nn) => nodePos.get(nn.id))"
              :key="n.id"
              :transform="`translate(${nodePos.get(n.id)!.cx}, ${nodePos.get(n.id)!.cy})`"
              class="sm-node"
              @click.stop="selectNode(n.id)"
            >
              <!-- Selection halo: tinted fill at r=56 + dashed ring at
                   r=50 (design spec). -->
              <template v-if="selectedNodeId === n.id">
                <circle r="56" :fill="ringColor(n)" opacity="0.10" />
                <circle
                  r="50"
                  fill="none"
                  :stroke="ringColor(n)"
                  stroke-width="1.2"
                  stroke-dasharray="3 4"
                  opacity="0.7"
                />
              </template>
              <!-- Heavy-path halo when not selected. -->
              <circle
                v-else-if="heaviestNodes.has(n.id)"
                r="50"
                fill="var(--sw-accent)"
                opacity="0.10"
              />
              <!-- Outer ring (health). Dashed for client / external
                   to signal "untraced" (no agent here). Solid stroke
                   for real services. -->
              <circle
                r="42"
                fill="var(--sw-bg-1)"
                :stroke="ringColor(n)"
                :stroke-width="nodeKind(n) === 'service' ? 2.5 : 1.2"
                :stroke-dasharray="nodeKind(n) === 'service' ? '0' : '4 4'"
                :style="{
                  filter: selectedNodeId === n.id
                    ? `drop-shadow(0 0 12px ${ringColor(n)})`
                    : 'none',
                }"
              />
              <!-- Inner disc — slightly darker for services to push
                   the icon forward; matches the design's two-tone
                   readout. -->
              <circle
                r="32"
                :fill="nodeKind(n) === 'service' ? 'var(--sw-bg-2)' : 'var(--sw-bg-1)'"
                stroke="var(--sw-line-2)"
                stroke-width="1"
              />

              <!-- Kind icon: client = user silhouette, service = 3D
                   box, external = cloud with `?`. SVG-only, per
                   design. -->
              <g v-if="nodeKind(n) === 'client'" transform="translate(-14, -12)" fill="var(--sw-info)">
                <circle cx="9" cy="6" r="4" />
                <circle cx="20" cy="6" r="4" />
                <path d="M2 24 c0 -6 5 -10 10 -10 c5 0 10 4 10 10 z" />
                <path d="M14 24 c0 -6 5 -10 10 -10 c5 0 10 4 10 10 z" opacity="0.7" />
              </g>
              <g v-else-if="nodeKind(n) === 'service'" transform="translate(-14, -14)">
                <polygon points="14,0 28,7 14,14 0,7" fill="#94a3b8" />
                <polygon points="0,7 14,14 14,28 0,21" fill="#5b6373" />
                <polygon points="28,7 14,14 14,28 28,21" fill="#3a4456" />
              </g>
              <g v-else transform="translate(-14, -10)" fill="var(--sw-info)">
                <path d="M6 14 a8 8 0 0 1 8 -8 a7 7 0 0 1 7 5 a6 6 0 0 1 1 12 H6 a6 6 0 0 1 -2 -9 z" />
                <text
                  x="14"
                  y="16"
                  text-anchor="middle"
                  font-size="10"
                  font-weight="700"
                  fill="var(--sw-bg-2)"
                >?</text>
              </g>

              <!-- Agent badge — top-right of the ring. Apache-feather
                   mark inside an accent halo. Only real services
                   advertise an agent (synthetic User / external have
                   no detector). -->
              <g v-if="n.isReal" transform="translate(26, -26)">
                <circle r="10" fill="var(--sw-bg-0)" stroke="var(--sw-accent-line)" stroke-width="1" />
                <circle r="8.5" fill="var(--sw-accent)" opacity="0.18" />
                <g transform="translate(-7, -7) scale(0.6)" fill="var(--sw-accent-2)">
                  <path d="M3 14c4-3 8-3 12-1 3 1.4 5 .5 6-1-1 5-4 8-9 8-4 0-7-2-9-6z" />
                  <path
                    d="M5 10c3-2 7-2 11 0 3 1.3 5 .6 6-1-1 3.6-4 6-8 6-4 0-7-1.6-9-5z"
                    fill="#fff"
                    opacity="0.25"
                  />
                </g>
              </g>

              <!-- Pulsing health dot bottom-right of selected node. -->
              <circle
                v-if="selectedNodeId === n.id"
                cx="22"
                cy="26"
                r="5"
                fill="var(--sw-bg-0)"
                :stroke="ringColor(n)"
                stroke-width="1"
              >
                <animate attributeName="r" values="5;9;5" dur="2s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="1;0.2;1" dur="2s" repeatCount="indefinite" />
              </circle>

              <!-- Name below the node. -->
              <text
                text-anchor="middle"
                y="64"
                :fill="selectedNodeId === n.id ? 'var(--sw-fg-0)' : 'var(--sw-fg-1)'"
                font-size="13"
                font-family="var(--sw-mono)"
                :font-weight="selectedNodeId === n.id ? 700 : 600"
              >
                {{ n.name.length > 22 ? n.name.slice(0, 20) + '…' : n.name }}
              </text>
              <!-- Metric line. Operator-configured `center` metric
                   in the ring colour; `secondary` next to it muted. -->
              <text
                text-anchor="middle"
                y="80"
                :fill="centerDef && nodeVal(n, centerDef) !== null ? ringColor(n) : 'var(--sw-fg-3)'"
                font-size="11"
                font-family="var(--sw-mono)"
                font-weight="600"
              >
                {{
                  centerDef
                    ? (nodeVal(n, centerDef) === null
                        ? `— ${centerDef.unit ?? ''}`
                        : `${fmtMetric(nodeVal(n, centerDef))}${centerDef.unit ? ' ' + centerDef.unit : ''}`)
                    : ''
                }}<template v-if="secondaryDef && nodeVal(n, secondaryDef) !== null"><tspan fill="var(--sw-fg-3)"> · </tspan><tspan fill="var(--sw-fg-2)">{{ secondaryDef.label.toLowerCase() }} {{ fmtMetric(nodeVal(n, secondaryDef)) }}{{ secondaryDef.unit ? ' ' + secondaryDef.unit : '' }}</tspan></template>
              </text>
            </g>
          </g>
        </svg>
        <div v-else-if="isLoading" class="loader">loading…</div>
        <div v-else class="loader">
          No services with metric data in this layer for the last 15 minutes.
        </div>

        <!-- Floating zoom controls — top-right, mirror the map
             toolbar's affordance vocabulary (small ghost buttons). -->
        <div v-if="layoutNodes.length > 0" class="sm-zoom-ctrls">
          <button class="sw-btn small" type="button" title="Zoom in (wheel up)" @click="zoomBy(1.25)">+</button>
          <button class="sw-btn small" type="button" title="Zoom out (wheel down)" @click="zoomBy(1 / 1.25)">−</button>
          <button class="sw-btn small" type="button" title="Fit to screen (double-click canvas)" @click="fitToScreen(true)">Fit</button>
          <span class="sm-zoom-pct" :title="`Scale ${(zoomT.k * 100).toFixed(0)}%`">{{ Math.round(zoomT.k * 100) }}%</span>
        </div>

        <div class="legend">
          <div v-if="ringDef" class="lg-label">{{ ringDef.label }}</div>
          <div v-if="ringDef" class="lg-ramp">
            <span style="background: var(--sw-ok)" />
            <span style="background: #fbbf24" />
            <span style="background: var(--sw-warn)" />
            <span style="background: var(--sw-err)" />
          </div>
          <div v-if="ringDef" class="lg-scale">
            <span>0%</span><span>0.1%</span><span>1%</span><span>5%+</span>
          </div>
          <div class="lg-rule" />
          <div class="lg-row">
            <span class="lg-swatch" style="background: var(--sw-accent)" />
            <span>Heaviest path</span>
            <span class="lg-aside">
              ({{ lineServerDef?.label ?? '' }}{{ lineServerDef && lineClientDef ? ' → ' + lineClientDef.label : '' }})
            </span>
          </div>
        </div>
        <div v-if="elidedTotal > 0" class="cap-chip">
          {{ elidedTotal }} node{{ elidedTotal === 1 ? '' : 's' }} elided across columns
        </div>
      </div>

      <!-- Right sidebar — node panel on top, edge panel underneath.
           Both selections are independent so the two stay open in
           parallel; empty slots prompt the operator to pick the
           missing side. Edges DO NOT open a dashboard page — metrics
           live here and on the canvas, that's the full extent of
           edge drill-in. -->
      <aside class="sm-panels">
      <!-- ── Top slot: node panel (or empty prompt). ── -->
      <article v-if="selectedNode" class="sm-panel">
        <header class="sp-head">
          <div class="sp-id">
            <div class="sp-mono">{{ selectedNode.name }}</div>
            <div class="sp-tags">
              <span v-for="l in selectedNode.layers" :key="l" class="sw-tag">{{ l }}</span>
              <span v-if="!selectedNode.isReal" class="sw-tag">virtual</span>
              <span v-if="heaviestNodes.has(selectedNode.id)" class="sw-tag accent">main path</span>
            </div>
          </div>
          <button class="sw-btn small" type="button" @click="selectedNodeId = null">×</button>
        </header>
        <div class="sp-kpis">
          <div v-for="m in cfg.nodeMetrics" :key="m.id" class="sp-kpi">
            <div class="sp-kpi-label">{{ m.label }}<span v-if="m.unit"> ({{ m.unit }})</span></div>
            <div class="sp-kpi-value" :style="{ color: m.role === 'ring' ? ringColor(selectedNode) : m.role === 'center' ? 'var(--sw-accent)' : 'var(--sw-fg-0)' }">
              {{ fmtMetric(nodeVal(selectedNode, m)) }}
            </div>
          </div>
        </div>
        <div class="sp-section">
          <div class="sp-section-title">Upstream callers ({{ upstream.length }})</div>
          <ul class="sp-list">
            <li v-for="u in upstream" :key="u.id">
              <span class="sp-pulse" :style="{ color: ringColor(u) }">●</span>
              <span class="sp-mono small">{{ u.name }}</span>
              <span class="sp-cpm">{{ fmtWithUnit(nodeVal(u, centerDef), centerDef?.unit) }}</span>
            </li>
            <li v-if="upstream.length === 0" class="sp-empty">no upstream callers in window</li>
          </ul>
        </div>
        <div class="sp-section">
          <div class="sp-section-title">Downstream deps ({{ downstream.length }})</div>
          <ul class="sp-list">
            <li v-for="d in downstream" :key="d.id">
              <span class="sp-pulse" :style="{ color: ringColor(d) }">●</span>
              <span class="sp-mono small">{{ d.name }}</span>
              <span class="sp-cpm">{{ fmtWithUnit(nodeVal(d, secondaryDef), secondaryDef?.unit) }}</span>
            </li>
            <li v-if="downstream.length === 0" class="sp-empty">no downstream deps in window</li>
          </ul>
        </div>
        <!-- Node-only dashboard jumps. Edges deliberately have no
             corresponding affordance — we keep their detail inline. -->
        <div class="sp-actions">
          <button class="sw-btn small primary" type="button" @click="jumpToService">Open service</button>
          <button class="sw-btn small" type="button" @click="jumpToEndpointDependency">API map →</button>
        </div>
      </article>

      <!-- Top-slot empty when no node is selected. -->
      <article v-if="!selectedNode" class="sm-panel sm-panel-empty">
        <span>Click a node to inspect a service</span>
      </article>

      <!-- ── Bottom slot: edge panel (or empty prompt). ── -->
      <article v-if="selectedCall && selectedCallSource && selectedCallTarget" class="sm-panel">
        <header class="sp-head">
          <div class="sp-id">
            <div class="sp-edge-row">
              <span class="sp-mono small">{{ selectedCallSource.name }}</span>
              <span class="sp-edge-arrow">→</span>
              <span class="sp-mono small">{{ selectedCallTarget.name }}</span>
            </div>
            <div class="sp-tags">
              <span class="sw-tag">{{ selectedCall.detectPoints.join(' · ') || 'relation' }}</span>
              <span v-if="heaviestEdges.has(selectedCall.id)" class="sw-tag accent">main path</span>
            </div>
          </div>
          <button class="sw-btn small" type="button" @click="selectedCallId = null">×</button>
        </header>
        <!-- Edge line metrics — one row per metric. Each row shows
             two sparklines side-by-side: client on the left, server
             on the right. Both share the metric's label/unit at the
             top of the row so the eye reads label → client trend →
             server trend across a single horizontal band.
             Single-side rows render only that side full-width;
             "no value" appears when both sides are configured but
             returned null. -->
        <div class="sp-section">
          <div class="sp-section-title">Line metrics</div>
          <div v-if="edgeRows.length > 0" class="sp-edge-rows">
            <div v-for="row in edgeRows" :key="row.id" class="sp-edge-row-card">
              <div class="sp-edge-row-head">
                <span class="sp-edge-row-label">
                  {{ row.label }}<span v-if="row.unit" class="unit"> ({{ row.unit }})</span>
                </span>
              </div>
              <template v-if="edgeRowValues(selectedCall, row).kind === 'both'">
                <div class="sp-edge-pair">
                  <div class="sp-edge-cell">
                    <div class="sp-edge-cell-head">
                      <span class="sp-edge-cell-tag">Client</span>
                      <span class="sp-edge-cell-num">{{ fmtMetric(edgeRowValues(selectedCall, row).clientV) }}</span>
                    </div>
                    <Sparkline
                      :values="edgeSeries(selectedCall, 'client', row.clientDef)"
                      color="var(--sw-info)"
                      :height="38"
                      :stroke="1.4"
                    />
                  </div>
                  <div class="sp-edge-cell">
                    <div class="sp-edge-cell-head">
                      <span class="sp-edge-cell-tag">Server</span>
                      <span class="sp-edge-cell-num">{{ fmtMetric(edgeRowValues(selectedCall, row).serverV) }}</span>
                    </div>
                    <Sparkline
                      :values="edgeSeries(selectedCall, 'server', row.serverDef)"
                      color="var(--sw-accent)"
                      :height="38"
                      :stroke="1.4"
                    />
                  </div>
                </div>
              </template>
              <template v-else-if="edgeRowValues(selectedCall, row).kind === 'client-only'">
                <div class="sp-edge-cell">
                  <div class="sp-edge-cell-head">
                    <span class="sp-edge-cell-tag">Client</span>
                    <span class="sp-edge-cell-num">{{ fmtMetric(edgeRowValues(selectedCall, row).clientV) }}</span>
                    <span class="sp-side-note">client only</span>
                  </div>
                  <Sparkline
                    :values="edgeSeries(selectedCall, 'client', row.clientDef)"
                    color="var(--sw-info)"
                    :height="38"
                    :stroke="1.4"
                  />
                </div>
              </template>
              <template v-else-if="edgeRowValues(selectedCall, row).kind === 'server-only'">
                <div class="sp-edge-cell">
                  <div class="sp-edge-cell-head">
                    <span class="sp-edge-cell-tag">Server</span>
                    <span class="sp-edge-cell-num">{{ fmtMetric(edgeRowValues(selectedCall, row).serverV) }}</span>
                    <span class="sp-side-note">server only</span>
                  </div>
                  <Sparkline
                    :values="edgeSeries(selectedCall, 'server', row.serverDef)"
                    color="var(--sw-accent)"
                    :height="38"
                    :stroke="1.4"
                  />
                </div>
              </template>
              <template v-else>
                <div class="sp-edge-none">no value</div>
              </template>
            </div>
          </div>
          <div v-else class="sp-empty">no line metrics configured</div>
        </div>
      </article>

      <!-- Bottom-slot empty when no edge is selected. -->
      <article
        v-if="!(selectedCall && selectedCallSource && selectedCallTarget)"
        class="sm-panel sm-panel-empty"
      >
        <span>Click an edge to inspect a call</span>
      </article>
      </aside>
    </section>
  </div>
</template>

<style scoped>
.sm-tab {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 4px 0 0;
}
.sm-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
}
.sm-toolbar .left {
  display: inline-flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}
.sm-toolbar .right {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.kicker {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--sw-accent);
  font-weight: 600;
}
.for-svc {
  font-size: 11.5px;
  color: var(--sw-fg-3);
}
.for-svc b {
  color: var(--sw-fg-1);
  font-family: var(--sw-mono);
  font-weight: 500;
}
.hint { font-size: 10.5px; color: var(--sw-fg-3); }
.depth-pick {
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
  font-size: 10.5px;
  color: var(--sw-fg-3);
}
.depth-pick select {
  height: 24px;
  padding: 0 6px;
  background: var(--sw-bg-2);
  border: 1px solid var(--sw-line-2);
  border-radius: 4px;
  color: var(--sw-fg-0);
  font: inherit;
  font-size: 11px;
}
.banner.err {
  padding: 8px 12px;
  background: var(--sw-err-soft);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 6px;
  color: #f87171;
  font-size: 11.5px;
}
.sm-card {
  /* Map card — graph on the left, dual-stack sidebar on the right.
     Node panel on top, edge panel underneath; both visible at the
     same time so the operator can read service KPIs against the
     in-flight call's line-chart trends in one glance. */
  padding: 0;
  overflow: hidden;
  height: 720px;
  display: grid;
  grid-template-columns: 1fr 360px;
}
.sm-panels {
  border-left: 1px solid var(--sw-line);
  background: var(--sw-bg-1);
  display: grid;
  /* Two equal rows so the node + edge panels each get a stable
     viewport — line charts inside the edge panel need predictable
     vertical space to read. */
  grid-template-rows: 1fr 1fr;
  min-height: 0;
}
.sm-panel {
  padding: 0;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
}
.sm-panel + .sm-panel {
  border-top: 1px solid var(--sw-line);
}
.sm-panel-empty {
  border: 1px dashed var(--sw-line-2);
  margin: 8px;
  border-radius: 6px;
  background: transparent;
  color: var(--sw-fg-3);
  font-size: 11.5px;
  display: grid;
  place-items: center;
}
.sm-graph {
  /* Fill the card — the parent `.sm-card` is `display: flex` since the
     2-col-with-sidebar layout went away; without an explicit `flex: 1`
     the graph collapsed to its intrinsic height and the map showed
     stale. */
  flex: 1;
  position: relative;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: radial-gradient(900px 540px at 30% 40%, rgba(56, 189, 248, 0.04), transparent 60%), var(--sw-bg-0);
}
.layer-hdr-row {
  position: relative;
  height: 34px;
  flex: 0 0 auto;
  border-bottom: 1px solid var(--sw-line);
  background: var(--sw-bg-1);
}
.layer-hdr {
  position: absolute;
  top: 10px;
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 9.5px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--sw-fg-3);
  font-weight: 700;
  justify-content: center;
}
.hdr-overflow {
  font-size: 9px;
  color: var(--sw-fg-2);
  padding: 1px 5px;
  background: var(--sw-bg-2);
  border-radius: 3px;
  text-transform: none;
  letter-spacing: 0;
  font-weight: 500;
}
.sm-scroll {
  flex: 1;
  overflow: auto;
  min-height: 0;
}
.sm-node { cursor: pointer; }
.sm-node { cursor: pointer; }
.sm-node:hover image {
  /* Subtle pop on hover — the cube image gets a slight scale via
     filter rather than a CSS transform so the SVG transform-origin
     stays at the node's geometric centre. */
  filter: drop-shadow(0 0 4px rgba(249, 115, 22, 0.45));
}
.sm-edge { cursor: pointer; }
.sm-edge:hover path:nth-of-type(2) {
  stroke: var(--sw-accent-2) !important;
  opacity: 1 !important;
}
.sp-edge-row {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.sp-edge-arrow {
  color: var(--sw-fg-3);
  font-size: 11px;
}
/* Edge line-metric cards. One card per metric, two sparkline cells
   per card (client | server). The pair grid stays 1:1 even when
   only one side has data — the empty side renders a full-width cell
   in those rows so the label is left-aligned consistently. */
.sp-edge-rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0;
}
.sp-edge-row-card {
  background: var(--sw-bg-2);
  border: 1px solid var(--sw-line);
  border-radius: 4px;
  padding: 6px 8px;
}
.sp-edge-row-head {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 0 2px 4px;
}
.sp-edge-row-label {
  font-family: var(--sw-mono);
  font-size: 11px;
  color: var(--sw-fg-1);
  font-weight: 600;
}
.sp-edge-row-label .unit {
  color: var(--sw-fg-3);
  font-size: 10px;
  font-weight: 500;
}
.sp-edge-pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}
.sp-edge-cell {
  background: var(--sw-bg-1);
  border: 1px solid var(--sw-line);
  border-radius: 3px;
  padding: 4px 6px;
}
.sp-edge-cell-head {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-bottom: 2px;
}
.sp-edge-cell-tag {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--sw-fg-3);
  font-weight: 700;
}
.sp-edge-cell-num {
  font-family: var(--sw-mono);
  font-size: 12px;
  color: var(--sw-fg-0);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  margin-left: auto;
}
.sp-side-note {
  margin-left: auto;
  color: var(--sw-fg-3);
  font-size: 9.5px;
  font-weight: 500;
}
.sp-edge-none {
  color: var(--sw-fg-3);
  font-style: italic;
  text-align: center;
  padding: 6px;
}
.loader {
  padding: 60px;
  text-align: center;
  color: var(--sw-fg-3);
  font-size: 11.5px;
}
.legend {
  position: absolute;
  left: 12px;
  bottom: 12px;
  padding: 8px 10px;
  font-size: 10.5px;
  min-width: 180px;
  background: rgba(15, 19, 26, 0.92);
  backdrop-filter: blur(8px);
  border: 1px solid var(--sw-line);
  border-radius: 6px;
}
.lg-label {
  font-size: 9.5px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--sw-fg-3);
  margin-bottom: 4px;
}
.lg-ramp {
  display: flex;
  gap: 4px;
  margin-bottom: 4px;
}
.lg-ramp span { width: 22px; height: 8px; border-radius: 2px; display: block; }
.lg-scale {
  display: flex;
  justify-content: space-between;
  color: var(--sw-fg-3);
  font-size: 9.5px;
}
.lg-rule {
  height: 1px;
  background: var(--sw-line);
  margin: 6px 0;
}
.lg-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10.5px;
  color: var(--sw-fg-2);
}
.lg-swatch { width: 18px; height: 3px; border-radius: 1px; display: block; }
.lg-aside { color: var(--sw-fg-3); font-size: 9.5px; }
.cap-chip {
  position: absolute;
  right: 12px;
  top: 44px;
  background: rgba(15, 19, 26, 0.92);
  border: 1px solid var(--sw-line);
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 10px;
  color: var(--sw-fg-3);
}
/* `.sm-detail` was the legacy right-side sidebar; replaced by
   `.sm-panels` below the map. Kept the class deleted intentionally. */
.sp-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  border-bottom: 1px solid var(--sw-line);
}
.sp-id { min-width: 0; flex: 1; }
.sp-mono {
  font-family: var(--sw-mono);
  font-size: 12.5px;
  font-weight: 600;
  color: var(--sw-fg-0);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sp-tags { margin-top: 4px; display: flex; gap: 4px; flex-wrap: wrap; }
.sw-tag.accent {
  background: var(--sw-accent-soft);
  color: var(--sw-accent-2);
  border-color: var(--sw-accent-line);
}
.sp-kpis {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  gap: 8px;
  padding: 12px;
}
.sp-kpi {
  padding: 6px 8px;
  background: var(--sw-bg-2);
  border: 1px solid var(--sw-line);
  border-radius: 4px;
}
.sp-kpi-label {
  font-size: 9.5px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--sw-fg-3);
}
.sp-kpi-value {
  font-size: 16px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.sp-section { padding: 8px 12px 4px; border-top: 1px solid var(--sw-line); }
.sp-section-title {
  font-size: 9.5px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--sw-fg-3);
  margin-bottom: 6px;
}
.sp-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.sp-list li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  border-bottom: 1px solid var(--sw-line);
  font-size: 11px;
}
.sp-list li:last-child { border-bottom: none; }
.sp-mono.small { font-family: var(--sw-mono); font-size: 11px; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--sw-fg-1); }
.sp-pulse { font-size: 8px; }
.sp-cpm { font-family: var(--sw-mono); font-size: 10.5px; color: var(--sw-fg-3); }
.sp-empty { color: var(--sw-fg-3); font-style: italic; }
.sp-actions {
  display: flex;
  gap: 8px;
  padding: 12px;
  border-top: 1px solid var(--sw-line);
}
.sw-btn.small {
  height: 24px;
  padding: 0 10px;
  font-size: 11px;
}
.sw-btn.small.primary {
  background: var(--sw-accent-soft);
  color: var(--sw-accent-2);
  border-color: var(--sw-accent-line);
}

@media (max-width: 1100px) {
  .sm-card { height: auto; }
  .sm-graph { height: 460px; }
  .sm-panels { grid-template-columns: 1fr; }
}
</style>
