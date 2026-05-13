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
  Per-layer API dependency tab — design "Endpoint / API dependency".

  Layout strategy for large graphs:
    - The focused endpoint is anchored at layer index 0. Upstream
      callers go to negative indices, downstream callees to positive
      indices. We BFS in each direction; indices outside the rendered
      window are collapsed into a single "+N more" chip.
    - Per layer we cap the visible node count (NODES_PER_LAYER) by
      ranking on call rate; overflow is summarised in a chip.
    - The whole SVG sits inside a scroll container so wide graphs
      don't blow up the layer shell card; an outer pan handle lets
      the operator scrub.
    - Clicking a node opens an inline popout (the design's tail
      callout). Only one popout open at a time.
-->
<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type {
  EndpointDependencyCall,
  EndpointDependencyNode,
  LayerDef,
  TopologyMetricDef,
} from '@/api/client';
import { useLayerEndpointDependency } from '@/composables/useLayerEndpointDependency';
import { useLayerEndpoints } from '@/composables/useLayerEndpoints';
import { useLayerLanding } from '@/composables/useLayerLanding';
import { useLayers } from '@/composables/useLayers';
import { useSelectedEndpoint } from '@/composables/useSelectedEndpoint';
import { useSelectedService } from '@/composables/useSelectedService';
import { useSetupStore } from '@/stores/setup';
import { fmtMetric } from '@/utils/formatters';
import { watch } from 'vue';
import Sparkline from '@/components/charts/Sparkline.vue';

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
// Loading-sequence orchestration. The per-step waits keep this
// deterministic: service first, then the endpoint query (empty
// keyword → top-N), then the first-endpoint pick. See the matching
// `watchEffect` in LayerDashboardsView for the rationale.
// Defined further below once `endpointList` / `endpointsLoading` are
// in scope.

// ── Endpoint picker (same shape as Endpoint tab).
const { selectedEndpoint, setSelectedEndpoint } = useSelectedEndpoint();
const endpointSearchInput = ref('');
const endpointQuery = ref('');
const endpointLimit = ref(30);
function submitEndpointSearch(): void {
  endpointQuery.value = endpointSearchInput.value.trim();
}
function clearEndpointSearch(): void {
  endpointSearchInput.value = '';
  endpointQuery.value = '';
}
const { endpoints: endpointList, isFetching: endpointsLoading } = useLayerEndpoints(
  layerKey,
  serviceName,
  endpointQuery,
  endpointLimit,
);
// Drop stale endpoint when service changes.
watch(serviceName, (next, prev) => {
  if (prev !== undefined && next !== prev && selectedEndpoint.value) {
    setSelectedEndpoint(null);
  }
});
// Strict loading sequence (service → endpoint list → first-endpoint
// pick). `watchEffect` cascades naturally through the dependency
// updates; the `return` after step 1 prevents racing the endpoint
// pick before `serviceName` has propagated and the endpoint list
// has refreshed.
watchEffect(() => {
  if (!selectedId.value) {
    const first = landingRows.value[0];
    if (first) setSelectedService(first.serviceId);
    return;
  }
  if (selectedEndpoint.value) return;
  if (endpointsLoading.value) return;
  const first = endpointList.value[0];
  if (first) setSelectedEndpoint(first.name);
});

const { nodes, calls, isLoading, isFetching, data } = useLayerEndpointDependency(
  layerKey,
  serviceName,
  selectedEndpoint,
);
const reachable = computed(() => data.value?.reachable !== false);
const errorText = computed(() => data.value?.error ?? null);

// ── Config from response (operator-edited layer JSON). Mirrors the
// service-map view's binding pattern: a role → metric def lookup
// drives every visual channel.
const cfg = computed(() => data.value?.config ?? {
  nodeMetrics: [] as TopologyMetricDef[],
  linkMetrics: [] as TopologyMetricDef[],
});
function pickByRole(defs: TopologyMetricDef[], role: TopologyMetricDef['role']): TopologyMetricDef | null {
  return defs.find((d) => d.role === role) ?? null;
}
const centerDef = computed(() => pickByRole(cfg.value.nodeMetrics, 'center'));
const ringDef = computed(() => pickByRole(cfg.value.nodeMetrics, 'ring'));
const secondaryDef = computed(() => pickByRole(cfg.value.nodeMetrics, 'secondary'));
const lineDef = computed(() => pickByRole(cfg.value.linkMetrics ?? [], 'lineServer'));

function nodeVal(n: EndpointDependencyNode, def: TopologyMetricDef | null): number | null {
  if (!def) return null;
  const v = n.metrics?.[def.id];
  return v ?? null;
}
function edgeVal(c: EndpointDependencyCall, def: TopologyMetricDef | null): number | null {
  if (!def) return null;
  const v = c.metrics?.[def.id];
  return v ?? null;
}

// ── Focused endpoint id (resolved by BFF; we surface the same id
// that came back so highlighting stays consistent even if the BFF
// picked the closest fuzzy match).
const focusedId = computed<string | null>(() => data.value?.endpointId ?? null);

// ── Compute layer index per node by BFS from focus, then bucket.
interface LayoutNode extends EndpointDependencyNode {
  layerIdx: number;
}
const layoutNodes = computed<LayoutNode[]>(() => {
  const all = nodes.value;
  if (all.length === 0) return [];
  const focusId = focusedId.value;
  const byId = new Map(all.map((n) => [n.id, n]));
  const callsList = calls.value;
  const downstream = new Map<string, string[]>();
  const upstream = new Map<string, string[]>();
  for (const c of callsList) {
    if (!downstream.has(c.source)) downstream.set(c.source, []);
    downstream.get(c.source)!.push(c.target);
    if (!upstream.has(c.target)) upstream.set(c.target, []);
    upstream.get(c.target)!.push(c.source);
  }
  const layerOf = new Map<string, number>();
  if (focusId && byId.has(focusId)) {
    layerOf.set(focusId, 0);
    // Forward BFS (downstream).
    const fwd = [focusId];
    while (fwd.length > 0) {
      const id = fwd.shift()!;
      const cur = layerOf.get(id)!;
      for (const t of downstream.get(id) ?? []) {
        if (!layerOf.has(t)) {
          layerOf.set(t, cur + 1);
          fwd.push(t);
        }
      }
    }
    // Backward BFS (upstream).
    const back = [focusId];
    while (back.length > 0) {
      const id = back.shift()!;
      const cur = layerOf.get(id)!;
      for (const s of upstream.get(id) ?? []) {
        if (!layerOf.has(s)) {
          layerOf.set(s, cur - 1);
          back.push(s);
        }
      }
    }
  }
  // Stragglers — anything still un-bucketed gets a "far" layer.
  let extra = 4;
  for (const n of all) {
    if (!layerOf.has(n.id)) {
      layerOf.set(n.id, extra++);
    }
  }
  return all.map((n) => ({ ...n, layerIdx: layerOf.get(n.id)! }));
});

// ── Group nodes by layer index, cap each layer at NODES_PER_LAYER by
// CPM, and bucket the rest into a "+N more" pseudo-row.
const NODES_PER_LAYER = 8;
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
  return indices.map((i) => {
    // Sort by the operator-configured `center` metric (typically RPM).
    // Falls back to the legacy `cpm` field when the config hasn't
    // arrived yet (first render before the BFF responds).
    const list = byLayer.get(i)!.slice().sort((a, b) => {
      const va = nodeVal(a, centerDef.value) ?? a.cpm ?? 0;
      const vb = nodeVal(b, centerDef.value) ?? b.cpm ?? 0;
      return vb - va;
    });
    const visible = list.slice(0, NODES_PER_LAYER);
    const hidden = list.length - visible.length;
    let label: string;
    if (i < 0) label = `L${i} · Upstream`;
    else if (i === 0) label = 'L0 · Focus';
    else label = `L+${i} · Downstream`;
    return { index: i, label, visible, hidden };
  });
});

// ── SVG layout math. The template binds NW / COL_GAP via the same
// names; exposing them on a const-bag keeps Vue's setup-script
// auto-binding happy without resorting to `defineExpose`.
const NW = 160;
const NH = 56;
const COL_GAP = 220;
const ROW_GAP = 72;
const W = computed(() => Math.max(800, layerColumns.value.length * COL_GAP + 80));
const H = computed(() => {
  const maxNodes = Math.max(1, ...layerColumns.value.map((c) => c.visible.length));
  return 80 + maxNodes * ROW_GAP + 40;
});

interface Pos { x: number; y: number; col: number; row: number }
const nodePos = computed<Map<string, Pos>>(() => {
  const map = new Map<string, Pos>();
  layerColumns.value.forEach((col, colIdx) => {
    const x = 40 + colIdx * COL_GAP;
    col.visible.forEach((n, rowIdx) => {
      const y = 80 + rowIdx * ROW_GAP;
      map.set(n.id, { x, y, col: colIdx, row: rowIdx });
    });
  });
  return map;
});

// Filter calls whose endpoints survived the per-layer cap.
const visibleCalls = computed<EndpointDependencyCall[]>(() => {
  const ids = new Set(nodePos.value.keys());
  return calls.value.filter((c) => ids.has(c.source) && ids.has(c.target));
});

// Kind colour band — uses the endpoint's `type` field, then service
// name fallbacks (db/cache/mq/ext).
function kindColor(n: EndpointDependencyNode): string {
  const t = (n.type ?? '').toUpperCase();
  if (t.includes('DATABASE') || t.includes('SQL')) return 'var(--sw-cyan)';
  if (t.includes('CACHE') || t.includes('REDIS')) return 'var(--sw-pink)';
  if (t.includes('MQ') || t.includes('KAFKA') || t.includes('PROD')) return 'var(--sw-warn)';
  if (t.includes('HTTP') || t.includes('GRPC') || t.includes('RPC')) return 'var(--sw-purple)';
  if (!n.isReal) return 'var(--sw-fg-2)';
  return 'var(--sw-info)';
}
function kindLabel(n: EndpointDependencyNode): string {
  const t = (n.type ?? '').toUpperCase();
  if (t.includes('DATABASE') || t.includes('SQL')) return 'DB';
  if (t.includes('CACHE')) return 'CACHE';
  if (t.includes('MQ') || t.includes('KAFKA')) return 'QUEUE';
  if (t.includes('RPC') || t.includes('GRPC')) return 'RPC';
  if (!n.isReal) return n.name === 'User' ? 'CLIENT' : 'EXT';
  return 'ENDPOINT';
}

// ── Selected node popout state. Anchors the design's tail callout
// just right of the clicked node.
const selectedNodeId = ref<string | null>(null);
const selectedNode = computed<EndpointDependencyNode | null>(() => {
  const id = selectedNodeId.value;
  if (!id) return null;
  return nodes.value.find((n) => n.id === id) ?? null;
});
const popoutUpstream = computed(() => {
  const sel = selectedNode.value;
  if (!sel) return [];
  return visibleCalls.value
    .filter((c) => c.target === sel.id)
    .map((c) => nodes.value.find((n) => n.id === c.source))
    .filter((n): n is EndpointDependencyNode => !!n);
});
const popoutDownstream = computed(() => {
  const sel = selectedNode.value;
  if (!sel) return [];
  return visibleCalls.value
    .filter((c) => c.source === sel.id)
    .map((c) => nodes.value.find((n) => n.id === c.target))
    .filter((n): n is EndpointDependencyNode => !!n);
});

function jumpToService(): void {
  const sel = selectedNode.value;
  if (!sel) return;
  void router.push({
    path: `/layer/${layerKey.value}/service`,
    query: { service: sel.serviceId },
  });
}
/**
 * Navigate to the Endpoint dashboard for the clicked node — same
 * pattern as topology's "Open service" jump. No client-side keyword
 * search: we hand the endpoint name + service id to the page via the
 * URL, and the Endpoint view's own auto-pick effect resolves it.
 */
function jumpToEndpointDashboard(): void {
  const sel = selectedNode.value;
  if (!sel) return;
  void router.push({
    path: `/layer/${layerKey.value}/endpoint`,
    query: {
      service: sel.serviceId,
      endpoint: sel.name,
    },
  });
}

/** Bi-direction-aware curved path. Same rule as the service map's
 *  `callPathD`: bow the arc to one side of the chord; for the
 *  matching reverse call we bow the other side so both lines stay
 *  visible. No arrowhead — animated traffic dots advertise direction. */
function hasReverse(c: EndpointDependencyCall): boolean {
  return calls.value.some((x) => x.source === c.target && x.target === c.source);
}
function bowSign(c: EndpointDependencyCall): number {
  if (!hasReverse(c)) return 0;
  return c.source < c.target ? 1 : -1;
}
function callPathD(c: EndpointDependencyCall): string {
  const a = nodePos.value.get(c.source);
  const b = nodePos.value.get(c.target);
  if (!a || !b) return '';
  const x1 = a.x + NW;
  const y1 = a.y + NH / 2;
  const x2 = b.x;
  const y2 = b.y + NH / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const perpX = -uy;
  const perpY = ux;
  const bow = Math.min(30, Math.max(14, len * 0.10));
  const sign = bowSign(c);
  const amplitude = sign === 0 ? 12 : bow;
  const signed = sign === 0 ? -1 : sign;
  const ctrlX = (x1 + x2) / 2 + perpX * amplitude * signed;
  const ctrlY = (y1 + y2) / 2 + perpY * amplitude * signed;
  return `M ${x1} ${y1} Q ${ctrlX} ${ctrlY} ${x2} ${y2}`;
}
function callMidpoint(c: EndpointDependencyCall): { x: number; y: number } | null {
  const a = nodePos.value.get(c.source);
  const b = nodePos.value.get(c.target);
  if (!a || !b) return null;
  const x1 = a.x + NW;
  const y1 = a.y + NH / 2;
  const x2 = b.x;
  const y2 = b.y + NH / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const perpX = -uy;
  const perpY = ux;
  const bow = Math.min(30, Math.max(14, len * 0.10));
  const sign = bowSign(c);
  const amplitude = sign === 0 ? 12 : bow;
  const signed = sign === 0 ? -1 : sign;
  return {
    x: (x1 + x2) / 2 + perpX * amplitude * signed * 0.55,
    y: (y1 + y2) / 2 + perpY * amplitude * signed * 0.55,
  };
}

// Edge selection — same independent-from-node model as the service
// map. Edge panel surfaces server-side line metrics only (OAP doesn't
// expose a client family for endpoint relations).
const selectedCallId = ref<string | null>(null);
function selectCall(id: string | null): void {
  selectedCallId.value = selectedCallId.value === id ? null : id;
}
const selectedCall = computed<EndpointDependencyCall | null>(() => {
  const id = selectedCallId.value;
  if (!id) return null;
  return calls.value.find((c) => c.id === id) ?? null;
});
const selectedCallSource = computed<EndpointDependencyNode | null>(() => {
  const c = selectedCall.value;
  if (!c) return null;
  return nodes.value.find((n) => n.id === c.source) ?? null;
});
const selectedCallTarget = computed<EndpointDependencyNode | null>(() => {
  const c = selectedCall.value;
  if (!c) return null;
  return nodes.value.find((n) => n.id === c.target) ?? null;
});
function edgeSeries(c: EndpointDependencyCall, def: TopologyMetricDef): Array<number | null> {
  return c.metricSeries?.[def.id] ?? [];
}
</script>

<template>
  <div class="ep-tab">
    <!-- Endpoint picker — search-on-Enter (mirrors the Endpoint tab). -->
    <section class="ep-picker sw-card">
      <header class="picker-head">
        <span class="kicker">API dependency</span>
        <span v-if="serviceName" class="for-svc">on <b>{{ serviceName }}</b></span>
        <span v-if="isFetching" class="hint">refreshing…</span>
      </header>
      <div v-if="!serviceName" class="empty inline">
        Pick a service in the header above to search its endpoints.
      </div>
      <template v-else>
        <div class="ep-controls">
          <input
            class="ep-search"
            type="search"
            placeholder="Search endpoints, press Enter…"
            v-model="endpointSearchInput"
            @keydown.enter.prevent="submitEndpointSearch"
            @search="submitEndpointSearch"
          />
          <button class="sw-btn small" type="button" @click="submitEndpointSearch">Search</button>
          <button v-if="endpointQuery" class="sw-btn ghost small" type="button" @click="clearEndpointSearch">
            Clear
          </button>
          <label class="ep-limit">
            <span>Top</span>
            <select v-model.number="endpointLimit">
              <option :value="20">20</option>
              <option :value="30">30</option>
              <option :value="50">50</option>
            </select>
          </label>
        </div>
        <ul v-if="!endpointsLoading && endpointList.length > 0" class="ep-list">
          <li
            v-for="e in endpointList"
            :key="e.id"
            class="ep-row"
            :class="{ on: selectedEndpoint === e.name }"
          >
            <button class="ep-pick" type="button" @click="setSelectedEndpoint(e.name)">
              {{ e.name }}
            </button>
          </li>
        </ul>
        <div v-else-if="!endpointsLoading" class="empty inline">
          No endpoints found.
        </div>
      </template>
    </section>

    <div v-if="!reachable" class="banner err">
      <strong>OAP unreachable.</strong>
      {{ errorText ?? 'API dependency feed failed — check the BFF and OAP.' }}
    </div>

    <section v-if="selectedEndpoint" class="ep-graph-card sw-card">
      <!-- Two-column layout: graph on the left, selection detail
           panel on the right. Mirrors the topology view's sidebar so
           operators get the same interaction pattern across the two
           dependency tabs. -->
      <div class="ep-graph">
        <header class="graph-head">
          <h4>API dependency chain</h4>
          <span class="hint">
            {{ layerColumns.length }} columns · {{ nodes.length }} endpoints
            · click a node for details
          </span>
        </header>

        <!-- Layer headers row -->
        <div class="layer-hdr-row" :style="{ minWidth: W + 'px' }">
          <div
            v-for="(col, i) in layerColumns"
            :key="col.index"
            class="layer-hdr"
            :style="{ left: 40 + i * COL_GAP + 'px', width: NW + 'px' }"
          >
            <span>{{ col.label }}</span>
            <span v-if="col.hidden > 0" class="hdr-overflow">+{{ col.hidden }} more</span>
          </div>
        </div>

        <div class="ep-scroll">
        <svg
          v-if="layoutNodes.length > 0"
          :viewBox="`0 0 ${W} ${H}`"
          :style="{ width: W + 'px', height: H + 'px', display: 'block' }"
        >
          <!-- No arrow markers — the animated dots advertise direction. -->

          <!-- column guide lines -->
          <line
            v-for="(col, i) in layerColumns"
            :key="`g-${col.index}`"
            :x1="40 + i * COL_GAP + NW / 2"
            :x2="40 + i * COL_GAP + NW / 2"
            :y1="40"
            :y2="H - 12"
            stroke="var(--sw-line)"
            stroke-dasharray="2 6"
            opacity="0.4"
          />

          <!-- edges. Curved, bi-direction-aware, no arrowhead. Clickable
               so the operator can open the edge sidebar with the
               configured server-side line metrics. Traffic dots flow
               along the focus + heaviest edges. -->
          <g
            v-for="c in visibleCalls"
            :key="c.id"
            class="ep-edge"
            @click.stop="selectCall(c.id)"
          >
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
              :stroke="selectedCallId === c.id ? 'var(--sw-accent-2)' : c.source === focusedId || c.target === focusedId ? 'var(--sw-accent)' : 'var(--sw-line-3)'"
              :stroke-width="(() => {
                if (selectedCallId === c.id) return 3;
                if (c.source === focusedId || c.target === focusedId) return 2.4;
                const v = edgeVal(c, lineDef);
                if (v === null) return 1.2;
                if (v > 5000) return 2.2;
                if (v > 500) return 1.8;
                return 1.2;
              })()"
              :opacity="selectedCallId === c.id ? 1 : c.source === focusedId || c.target === focusedId ? 0.95 : 0.4"
              stroke-linecap="round"
              style="pointer-events: none"
            >
              <title v-if="lineDef">{{ lineDef.label }}: {{ fmtMetric(edgeVal(c, lineDef)) }} {{ lineDef.unit ?? '' }}</title>
            </path>
            <!-- Animated traffic dots on focus/heaviest/selected edges. -->
            <template v-if="c.source === focusedId || c.target === focusedId || selectedCallId === c.id">
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
            <!-- Compact metric chip at the curve midpoint. -->
            <template v-if="lineDef && edgeVal(c, lineDef) !== null && callMidpoint(c)">
              <g
                :transform="`translate(${callMidpoint(c)!.x - 30}, ${callMidpoint(c)!.y - 9})`"
                style="pointer-events: none"
              >
                <rect
                  x="0"
                  y="0"
                  width="60"
                  height="16"
                  rx="8"
                  fill="var(--sw-bg-1)"
                  :stroke="selectedCallId === c.id ? 'var(--sw-accent-2)' : c.source === focusedId || c.target === focusedId ? 'var(--sw-accent)' : 'var(--sw-line-2)'"
                  :stroke-width="selectedCallId === c.id ? 1.4 : 1"
                />
                <text
                  x="30"
                  y="11"
                  text-anchor="middle"
                  :fill="selectedCallId === c.id ? 'var(--sw-accent-2)' : c.source === focusedId || c.target === focusedId ? 'var(--sw-accent-2)' : 'var(--sw-fg-2)'"
                  font-size="9"
                  font-family="var(--sw-mono)"
                  font-weight="700"
                >
                  {{ fmtMetric(edgeVal(c, lineDef)) }}<tspan v-if="lineDef.unit" :dx="2" fill="var(--sw-fg-3)" font-weight="500">{{ lineDef.unit }}</tspan>
                </text>
              </g>
            </template>
          </g>

          <!-- nodes -->
          <g
            v-for="n in layoutNodes.filter((nn) => nodePos.get(nn.id))"
            :key="n.id"
            :transform="`translate(${nodePos.get(n.id)!.x}, ${nodePos.get(n.id)!.y})`"
            class="ep-node"
            @click="selectedNodeId = selectedNodeId === n.id ? null : n.id"
          >
            <rect
              v-if="n.id === focusedId"
              x="-3"
              y="-3"
              :width="NW + 6"
              :height="NH + 6"
              rx="9"
              fill="var(--sw-accent)"
              opacity="0.18"
            />
            <rect
              x="0"
              y="0"
              :width="NW"
              :height="NH"
              rx="7"
              :fill="n.id === selectedNodeId ? 'rgba(249,115,22,0.10)' : n.id === focusedId ? 'rgba(249,115,22,0.06)' : 'var(--sw-bg-2)'"
              :stroke="n.id === selectedNodeId || n.id === focusedId ? 'var(--sw-accent)' : 'var(--sw-line-2)'"
              :stroke-width="n.id === selectedNodeId || n.id === focusedId ? 1.6 : 1"
            />
            <rect x="0" y="0" width="3" :height="NH" :fill="kindColor(n)" rx="1" />
            <text x="10" y="14" :fill="kindColor(n)" font-size="8.5" font-weight="700" letter-spacing="0.5">
              {{ kindLabel(n) }}
            </text>
            <text x="10" y="32" fill="var(--sw-fg-0)" font-size="10.5" font-family="var(--sw-mono)" :font-weight="n.id === focusedId ? 700 : 500">
              {{ n.name.length > 24 ? n.name.slice(0, 22) + '…' : n.name }}
            </text>
            <text x="10" y="46" fill="var(--sw-fg-3)" font-size="9">
              {{ n.serviceName.length > 24 ? n.serviceName.slice(0, 22) + '…' : n.serviceName }}
            </text>
            <!-- Metrics row: pulls the configured `center` + `secondary`
                 metrics rather than hardcoded cpm/respTime. -->
            <text
              :x="NW - 8"
              y="46"
              text-anchor="end"
              :fill="(() => {
                const sla = nodeVal(n, ringDef);
                return sla !== null && sla < 99 ? 'var(--sw-warn)' : 'var(--sw-fg-2)';
              })()"
              font-size="9"
              font-family="var(--sw-mono)"
            >
              {{ centerDef ? fmtMetric(nodeVal(n, centerDef)) : '' }}<tspan v-if="centerDef?.unit"> {{ centerDef.unit }}</tspan><tspan v-if="secondaryDef && nodeVal(n, secondaryDef) !== null"> · {{ fmtMetric(nodeVal(n, secondaryDef)) }}{{ secondaryDef.unit ? ' ' + secondaryDef.unit : '' }}</tspan>
            </text>
          </g>
        </svg>

          <div v-else-if="isLoading" class="loader">loading…</div>
          <div v-else class="loader">
            No dependency graph available for this endpoint in the last 15 minutes.
          </div>
        </div>
      </div>

      <!-- Sidebar — node panel on top, edge panel underneath (mirrors
           the service topology layout). Both selections are
           independent so they stay open in parallel. -->
      <aside v-if="selectedNode || selectedCall" class="ep-detail">
      <!-- Top slot: node panel (when selected). -->
      <section v-if="selectedNode" class="ep-detail-block">
        <header class="ed-head">
          <div class="ed-id">
            <div class="ed-kind-row">
              <span class="sw-tag" :style="{ background: 'rgba(168,85,247,0.12)', color: 'var(--sw-purple)' }">
                {{ kindLabel(selectedNode) }}
              </span>
              <span class="ed-svc">{{ selectedNode.serviceName }}</span>
            </div>
            <div class="ed-name">{{ selectedNode.name }}</div>
          </div>
          <button class="sw-btn small" type="button" @click="selectedNodeId = null">×</button>
        </header>
        <div class="ed-kpis">
          <div v-for="m in cfg.nodeMetrics" :key="m.id" class="ed-kpi">
            <div class="ed-kpi-label">{{ m.label }}<span v-if="m.unit"> ({{ m.unit }})</span></div>
            <div
              class="ed-kpi-value"
              :style="{ color: m.role === 'center' ? 'var(--sw-accent)' : m.role === 'ring' ? 'var(--sw-warn)' : 'var(--sw-fg-0)' }"
            >
              {{ fmtMetric(nodeVal(selectedNode, m)) }}
            </div>
          </div>
        </div>
        <div class="ed-section">
          <div class="ed-section-title">Inbound ({{ popoutUpstream.length }})</div>
          <ul class="ed-list">
            <li v-for="u in popoutUpstream" :key="u.id">
              <span class="ed-mono small">{{ u.name }}</span>
              <span class="ed-arrow">→</span>
              <span class="ed-mono small accent">{{ selectedNode.name }}</span>
            </li>
            <li v-if="popoutUpstream.length === 0" class="ed-empty">no inbound calls in window</li>
          </ul>
        </div>
        <div class="ed-section">
          <div class="ed-section-title">Outbound ({{ popoutDownstream.length }})</div>
          <ul class="ed-list">
            <li v-for="d in popoutDownstream" :key="d.id">
              <span class="ed-mono small accent">{{ selectedNode.name }}</span>
              <span class="ed-arrow">→</span>
              <span class="ed-mono small">{{ d.name }}</span>
            </li>
            <li v-if="popoutDownstream.length === 0" class="ed-empty">no outbound calls in window</li>
          </ul>
        </div>
        <div class="ed-actions">
          <button class="sw-btn small primary" type="button" @click="jumpToEndpointDashboard">
            Open endpoint
          </button>
          <button class="sw-btn small" type="button" @click="jumpToService">Service →</button>
        </div>
      </section>

      <!-- Bottom slot: edge panel. Endpoint relations are server-side
           only; each metric row carries a single line chart (no
           client column) plus the live aggregated value. -->
      <section v-if="selectedCall && selectedCallSource && selectedCallTarget" class="ep-detail-block">
        <header class="ed-head">
          <div class="ed-id">
            <div class="ed-edge-row">
              <span class="ed-mono small">{{ selectedCallSource.name }}</span>
              <span class="ed-arrow">→</span>
              <span class="ed-mono small">{{ selectedCallTarget.name }}</span>
            </div>
            <div class="ed-edge-svc">
              {{ selectedCallSource.serviceName }} → {{ selectedCallTarget.serviceName }}
            </div>
          </div>
          <button class="sw-btn small" type="button" @click="selectedCallId = null">×</button>
        </header>
        <div class="ed-section">
          <div class="ed-section-title">Line metrics (server-side)</div>
          <div v-if="(cfg.linkMetrics ?? []).length > 0" class="ed-edge-rows">
            <div
              v-for="m in (cfg.linkMetrics ?? [])"
              :key="m.id"
              class="ed-edge-row-card"
            >
              <div class="ed-edge-row-head">
                <span class="ed-edge-row-label">
                  {{ m.label }}<span v-if="m.unit" class="unit"> ({{ m.unit }})</span>
                </span>
                <span class="ed-edge-row-num">{{ fmtMetric(edgeVal(selectedCall, m)) }}</span>
              </div>
              <Sparkline
                :values="edgeSeries(selectedCall, m)"
                color="var(--sw-accent)"
                :height="38"
                :stroke="1.4"
              />
            </div>
          </div>
          <div v-else class="ed-empty">no line metrics configured</div>
        </div>
      </section>

      <!-- Empty prompts. -->
      <section v-if="!selectedNode" class="ep-detail-empty">
        <span>Click an endpoint node to inspect it</span>
      </section>
      <section v-if="!(selectedCall && selectedCallSource && selectedCallTarget)" class="ep-detail-empty">
        <span>Click an edge to inspect the call</span>
      </section>
      </aside>
    </section>

    <section v-else-if="serviceName" class="empty">
      Select an endpoint above to see its dependency chain.
    </section>
  </div>
</template>

<style scoped>
.ep-tab {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 4px 0 0;
}
.ep-picker { padding: 0; }
.picker-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--sw-line);
}
.kicker {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--sw-accent);
  font-weight: 600;
}
.for-svc { font-size: 11px; color: var(--sw-fg-3); }
.for-svc b { color: var(--sw-fg-1); font-family: var(--sw-mono); font-weight: 500; }
.hint { font-size: 10.5px; color: var(--sw-fg-3); margin-left: auto; }
.ep-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--sw-line);
}
.ep-search {
  flex: 1;
  height: 26px;
  padding: 0 8px;
  background: var(--sw-bg-2);
  border: 1px solid var(--sw-line-2);
  border-radius: 4px;
  color: var(--sw-fg-0);
  font: inherit;
  font-size: 11.5px;
}
.ep-search:focus { outline: none; border-color: var(--sw-accent-line); }
.ep-limit {
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
  font-size: 10.5px;
  color: var(--sw-fg-3);
}
.ep-limit select {
  height: 26px;
  padding: 0 6px;
  background: var(--sw-bg-2);
  border: 1px solid var(--sw-line-2);
  border-radius: 4px;
  color: var(--sw-fg-0);
  font: inherit;
  font-size: 11.5px;
}
.ep-list {
  list-style: none;
  margin: 0;
  padding: 4px 0;
  max-height: 220px;
  overflow-y: auto;
}
.ep-row {
  padding: 2px 10px;
  border-bottom: 1px solid var(--sw-line);
}
.ep-row:last-child { border-bottom: none; }
.ep-row.on { background: var(--sw-accent-soft); }
.ep-pick {
  display: block;
  width: 100%;
  padding: 6px 8px;
  background: transparent;
  border: none;
  color: var(--sw-fg-1);
  font: inherit;
  font-family: var(--sw-mono);
  font-size: 11.5px;
  text-align: left;
  cursor: pointer;
}
.ep-pick:hover { background: var(--sw-bg-2); color: var(--sw-fg-0); }
.ep-row.on .ep-pick { color: var(--sw-accent-2); font-weight: 600; }
.empty.inline { padding: 18px; font-size: 11px; color: var(--sw-fg-3); }
.empty {
  padding: 32px;
  text-align: center;
  color: var(--sw-fg-3);
  font-size: 12px;
}
.banner.err {
  padding: 8px 12px;
  background: var(--sw-err-soft);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 6px;
  color: #f87171;
  font-size: 11.5px;
}
.ep-graph-card {
  padding: 0;
  display: grid;
  grid-template-columns: 1fr 320px;
  height: 720px;
  overflow: hidden;
}
.ep-graph {
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.ep-detail {
  border-left: 1px solid var(--sw-line);
  background: var(--sw-bg-1);
  overflow-y: auto;
  font-size: 11.5px;
  display: grid;
  grid-template-rows: 1fr 1fr;
  min-height: 0;
}
.ep-detail-block {
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  min-height: 0;
}
.ep-detail-block + .ep-detail-block {
  border-top: 1px solid var(--sw-line);
}
.ep-detail-empty {
  border: 1px dashed var(--sw-line-2);
  margin: 8px;
  border-radius: 6px;
  color: var(--sw-fg-3);
  font-size: 11px;
  display: grid;
  place-items: center;
}
.ep-detail-empty + .ep-detail-empty {
  border-top: 1px solid var(--sw-line);
}
/* Edge-row line chart cards inside the endpoint-dep edge panel. */
.ed-edge-rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ed-edge-row-card {
  background: var(--sw-bg-2);
  border: 1px solid var(--sw-line);
  border-radius: 4px;
  padding: 6px 8px;
}
.ed-edge-row-head {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-bottom: 2px;
}
.ed-edge-row-label {
  font-family: var(--sw-mono);
  font-size: 11px;
  color: var(--sw-fg-1);
  font-weight: 600;
}
.ed-edge-row-label .unit {
  color: var(--sw-fg-3);
  font-size: 10px;
  font-weight: 500;
}
.ed-edge-row-num {
  margin-left: auto;
  font-family: var(--sw-mono);
  font-size: 12px;
  color: var(--sw-fg-0);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.ed-edge-row {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.ed-edge-svc {
  margin-top: 4px;
  font-size: 10.5px;
  color: var(--sw-fg-3);
}
.ep-edge { cursor: pointer; }
.ep-edge:hover path:nth-of-type(2) {
  stroke: var(--sw-accent-2) !important;
  opacity: 1 !important;
}
.ed-head {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px;
  border-bottom: 1px solid var(--sw-line);
}
.ed-id { min-width: 0; flex: 1; }
.ed-kind-row { display: inline-flex; gap: 6px; align-items: center; margin-bottom: 6px; }
.ed-svc {
  font-family: var(--sw-mono);
  font-size: 11px;
  color: var(--sw-fg-1);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ed-name {
  font-family: var(--sw-mono);
  font-size: 12.5px;
  font-weight: 600;
  color: var(--sw-fg-0);
  word-break: break-all;
}
.ed-kpis {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(90px, 1fr));
  gap: 8px;
  padding: 12px;
}
.ed-kpi {
  padding: 6px 8px;
  background: var(--sw-bg-2);
  border: 1px solid var(--sw-line);
  border-radius: 4px;
}
.ed-kpi-label {
  font-size: 9.5px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--sw-fg-3);
}
.ed-kpi-value {
  font-size: 16px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.ed-section { padding: 8px 12px 4px; border-top: 1px solid var(--sw-line); }
.ed-section-title {
  font-size: 9.5px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--sw-fg-3);
  margin-bottom: 6px;
}
.ed-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.ed-list li {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
  border-bottom: 1px solid var(--sw-line);
  font-size: 11px;
}
.ed-list li:last-child { border-bottom: none; }
.ed-mono.small {
  font-family: var(--sw-mono);
  font-size: 10.5px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--sw-fg-1);
}
.ed-mono.accent { color: var(--sw-accent-2); }
.ed-arrow { color: var(--sw-fg-3); font-size: 10px; }
.ed-empty { color: var(--sw-fg-3); font-style: italic; }
.ed-actions {
  display: flex;
  gap: 8px;
  padding: 12px;
  border-top: 1px solid var(--sw-line);
}
@media (max-width: 1100px) {
  .ep-graph-card {
    grid-template-columns: 1fr;
    height: auto;
  }
  .ep-detail {
    border-left: none;
    border-top: 1px solid var(--sw-line);
    max-height: 460px;
  }
}
.graph-head {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--sw-line);
}
.graph-head h4 {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--sw-fg-0);
}
.layer-hdr-row {
  position: relative;
  height: 30px;
  border-bottom: 1px solid var(--sw-line);
}
.layer-hdr {
  position: absolute;
  top: 8px;
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 9.5px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--sw-fg-3);
  font-weight: 700;
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
.ep-scroll {
  position: relative;
  overflow: auto;
  max-height: 640px;
}
.ep-node { cursor: pointer; }
.ep-node:hover rect { stroke: var(--sw-accent-2); }
.loader {
  padding: 60px;
  text-align: center;
  color: var(--sw-fg-3);
  font-size: 11.5px;
}
.ep-popout {
  position: absolute;
  width: 280px;
  background: var(--sw-bg-1);
  border: 1px solid var(--sw-accent-line);
  border-radius: 8px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(249, 115, 22, 0.15);
  z-index: 4;
}
.po-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--sw-line);
}
.po-svc { font-weight: 600; font-size: 11.5px; color: var(--sw-fg-0); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.po-body { padding: 10px 12px; }
.po-name {
  font-family: var(--sw-mono);
  font-size: 12px;
  color: var(--sw-fg-0);
  margin-bottom: 10px;
  word-break: break-all;
}
.po-kpis {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  margin-bottom: 10px;
}
.po-kpis > div {
  background: var(--sw-bg-2);
  border: 1px solid var(--sw-line);
  border-radius: 6px;
  padding: 6px 8px;
}
.po-label {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--sw-fg-3);
}
.po-val {
  font-size: 13px;
  font-weight: 700;
  font-family: var(--sw-mono);
  color: var(--sw-fg-0);
}
.po-section { margin-top: 8px; }
.po-section-title {
  font-size: 9.5px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--sw-fg-3);
  margin-bottom: 4px;
}
.po-link {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 0;
  font-size: 11px;
  color: var(--sw-fg-1);
}
.po-mono {
  font-family: var(--sw-mono);
  flex: 0 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.po-mono.accent { color: var(--sw-accent-2); }
.po-arrow { color: var(--sw-fg-3); }
.po-empty {
  color: var(--sw-fg-3);
  font-style: italic;
  font-size: 11px;
  padding: 3px 0;
}
.po-actions {
  display: flex;
  gap: 6px;
  margin-top: 12px;
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
</style>
