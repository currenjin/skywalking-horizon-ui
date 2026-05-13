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
<script setup lang="ts">
import { computed, ref } from 'vue';
import type { AggregationKind, LayerDef } from '@skywalking-horizon-ui/api-client';
import Icon from '@/components/icons/Icon.vue';
import Sparkline from '@/components/charts/Sparkline.vue';
import { METRICS, metricsForLayer } from '@/composables/metricCatalog';
import { colorForMetric } from '@/composables/metricColor';
import { useSetupStore, defaultLandingFor } from '@/stores/setup';
import { fmtMetric } from '@/utils/formatters';

/** Mirror of the setup-store's defaultAggregationFor — kept inline so the
 *  setup UI seeds new columns with the same defaults the store uses. */
function defaultAgg(metricKey: string): AggregationKind {
  const k = metricKey.toLowerCase();
  if (
    k === 'cpm' ||
    k.endsWith('.msg-rate') ||
    k.endsWith('.qps') ||
    k.endsWith('.pv') ||
    k.endsWith('.invocations') ||
    k.endsWith('.tokens') ||
    k.endsWith('.req') ||
    k.endsWith('.slow-queries') ||
    k.endsWith('.js-err') ||
    k.endsWith('.cold-start') ||
    k.endsWith('.restart')
  ) {
    return 'sum';
  }
  return 'avg';
}

const props = defineProps<{ layer: LayerDef; expanded?: boolean }>();
const emit = defineEmits<{ (e: 'toggle'): void }>();

const store = useSetupStore();
const cfg = computed(() => store.ensure(props.layer.key, { slots: props.layer.slots, caps: props.layer.caps, metrics: props.layer.metrics, overview: props.layer.overview }));

const open = ref(props.expanded ?? false);
function toggle(): void {
  open.value = !open.value;
  emit('toggle');
}

function resetThisLayer(): void {
  store.reset(props.layer.key, { slots: props.layer.slots, caps: props.layer.caps });
}

// Every form-field input on this card calls onEdit so the store knows the
// user (not just a default-population) touched the config.
function onEdit(): void {
  store.markDirty();
}

const summary = computed<string>(() => {
  const c = cfg.value;
  const cols = c.landing.columns.map((x) => x.metric).join(', ');
  const tile = (c.landing.overviewMetrics ?? []).slice(0, 3).join(' / ') || '—';
  const base = `Overview tile: ${tile} · service list: top ${c.landing.topN} by ${c.landing.orderBy} · cols ${cols} · priority ${c.landing.priority}`;
  if (!props.layer.active) {
    return `${base} · no service reporting yet`;
  }
  return base;
});

// Setup-card capability toggles — scoped to the two features the
// Setup page actually configures. Deeper toggles (traces, logs,
// profiling family, etc.) live on /admin/layer-dashboards under the
// Components block, which has its own editor.
const capRows: Array<{ key: keyof typeof cfg.value.caps; label: string }> = [
  // Service-count tile is the first Feature operators see — it's
  // also the first tile rendered on the Overview strip for the layer.
  { key: 'serviceCountTile', label: 'Service count tile' },
  { key: 'dashboards', label: 'Metrics' },
  { key: 'serviceMap', label: 'Service Map' },
];

// Pulled from the shared metric catalog so labels/units/tips stay
// consistent across the Overview cards and the setup UI.
const availableColumns = Object.values(METRICS).map((m) => ({
  metric: m.key,
  label: m.label,
  longLabel: m.longLabel,
  unit: m.unit,
  tip: m.tip,
}));
// Chip groups: layer-relevant metrics first, the rest collapsed below.
const groupedColumns = computed(() => {
  const { recommended, other } = metricsForLayer(props.layer.key);
  const toOpt = (m: typeof recommended[number]) => ({
    metric: m.key,
    label: m.label,
    longLabel: m.longLabel,
    unit: m.unit,
    tip: m.tip,
  });
  return {
    recommended: recommended.map(toOpt),
    other: other.map(toOpt),
  };
});
const showAllChips = ref(false);
function isColumnSelected(metric: string): boolean {
  return cfg.value.landing.columns.some((c) => c.metric === metric);
}
function toggleColumn(metric: string, label: string, unit?: string): void {
  const cols = cfg.value.landing.columns;
  const idx = cols.findIndex((c) => c.metric === metric);
  if (idx >= 0) {
    cols.splice(idx, 1);
  } else if (cols.length < 5) {
    cols.push({
      metric,
      label,
      ...(unit ? { unit } : {}),
      aggregation: defaultAgg(metric),
    });
  }
  onEdit();
}

const showAdvanced = ref(false);

/* ---- Overview tile editor (groups → metrics) ----
 *
 * A layer's Overview tile is now a list of groups. Each group becomes
 * one tile on the Overview strip with the group's title + size +
 * metrics. Editable data:
 *   - `landing.overviewGroups`  — the ordered list (title, size,
 *                                  metricIds[]).
 *   - `landing.columns`         — full metric data keyed by id. A
 *                                  metric referenced by any group
 *                                  lives as a column entry.
 *
 * Add / remove / reorder operations keep both arrays in sync. A
 * column is removed only when no remaining group references its id,
 * so a metric moved between groups isn't accidentally garbage-
 * collected.
 */

const AUTO_GROUP_MAX = 3;

function groupsArr(): NonNullable<typeof cfg.value.landing.overviewGroups> {
  if (!cfg.value.landing.overviewGroups) cfg.value.landing.overviewGroups = [];
  return cfg.value.landing.overviewGroups;
}

function groupCells(gIdx: number) {
  const g = groupsArr()[gIdx];
  if (!g) return [];
  return g.metricIds
    .map((id) => cfg.value.landing.columns.find((c) => c.metric === id))
    .filter((c): c is NonNullable<typeof c> => !!c);
}

function maxMetricsFor(size: 'auto' | 'square'): number {
  return size === 'square' ? 1 : AUTO_GROUP_MAX;
}

function nextOverviewId(): string {
  const existing = new Set(cfg.value.landing.columns.map((c) => c.metric));
  for (let i = 0; i < 1000; i++) {
    const id = `ov_${i}`;
    if (!existing.has(id)) return id;
  }
  return `ov_${Date.now()}`;
}

function addGroup(): void {
  groupsArr().push({ title: 'New group', size: 'auto', metricIds: [] });
  onEdit();
}

function removeGroup(gIdx: number): void {
  const groups = groupsArr();
  const removed = groups[gIdx];
  if (!removed) return;
  // Drop columns that ONLY this group references.
  for (const id of removed.metricIds) {
    if (!groups.some((g, i) => i !== gIdx && g.metricIds.includes(id))) {
      const ci = cfg.value.landing.columns.findIndex((c) => c.metric === id);
      if (ci >= 0) cfg.value.landing.columns.splice(ci, 1);
    }
  }
  groups.splice(gIdx, 1);
  onEdit();
}

function moveGroup(gIdx: number, dir: -1 | 1): void {
  const groups = groupsArr();
  const j = gIdx + dir;
  if (j < 0 || j >= groups.length) return;
  [groups[gIdx], groups[j]] = [groups[j], groups[gIdx]];
  onEdit();
}

function setGroupSize(gIdx: number, size: 'auto' | 'square'): void {
  const g = groupsArr()[gIdx];
  if (!g) return;
  g.size = size;
  // Square mode is single-metric by convention — trim extras when
  // switching from auto. The trimmed metrics' columns are removed
  // unless still referenced by another group.
  if (size === 'square' && g.metricIds.length > 1) {
    const orphans = g.metricIds.slice(1);
    g.metricIds = g.metricIds.slice(0, 1);
    for (const id of orphans) {
      if (!groupsArr().some((gg) => gg.metricIds.includes(id))) {
        const ci = cfg.value.landing.columns.findIndex((c) => c.metric === id);
        if (ci >= 0) cfg.value.landing.columns.splice(ci, 1);
      }
    }
  }
  onEdit();
}

function addMetricInGroup(gIdx: number): void {
  const g = groupsArr()[gIdx];
  if (!g) return;
  if (g.metricIds.length >= maxMetricsFor(g.size)) return;
  const id = nextOverviewId();
  cfg.value.landing.columns.push({
    metric: id,
    label: 'New metric',
    mqe: '',
    aggregation: 'avg',
  });
  g.metricIds.push(id);
  onEdit();
}

function removeMetricInGroup(gIdx: number, id: string): void {
  const g = groupsArr()[gIdx];
  if (!g) return;
  g.metricIds = g.metricIds.filter((x) => x !== id);
  if (!groupsArr().some((gg) => gg.metricIds.includes(id))) {
    const ci = cfg.value.landing.columns.findIndex((c) => c.metric === id);
    if (ci >= 0) cfg.value.landing.columns.splice(ci, 1);
  }
  onEdit();
}

function moveMetricInGroup(gIdx: number, mIdx: number, dir: -1 | 1): void {
  const g = groupsArr()[gIdx];
  if (!g) return;
  const j = mIdx + dir;
  if (j < 0 || j >= g.metricIds.length) return;
  [g.metricIds[mIdx], g.metricIds[j]] = [g.metricIds[j], g.metricIds[mIdx]];
  onEdit();
}

/* ---- Live preview of the Overview tile ----
 * Operators edit the metrics in the table above; the preview tile to
 * the side mirrors the actual `LayerKpiStripCard` rendering using mock
 * values (deterministic per row id) so changes are visible without
 * leaving the page. */

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) || 1;
}
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function mockWalk(seedKey: string, points: number, center: number, amp: number): number[] {
  const rand = rng(hashSeed(seedKey));
  const out: number[] = [];
  let v = center;
  for (let i = 0; i < points; i++) {
    v += (rand() - 0.5) * amp * 0.4;
    v += (center - v) * 0.08;
    out.push(Math.max(0, v));
  }
  return out;
}
function mockProfile(unit: string | undefined): { center: number; amp: number } {
  if (unit?.includes('%')) return { center: 95 + Math.random() * 4, amp: 5 };
  if (unit === 'ms') return { center: 80 + Math.random() * 220, amp: 60 };
  if (unit === 'rpm' || unit?.includes('/min')) return { center: 1200, amp: 600 };
  return { center: 100, amp: 40 };
}

interface PreviewCell {
  id: string;
  label: string;
  unit?: string;
  tip?: string;
  value: number;
  series: number[];
  color: string;
}

const previewCells = computed<PreviewCell[]>(() =>
  overviewCells.value.map((c) => {
    const { center, amp } = mockProfile(c.unit);
    return {
      id: c.metric,
      label: c.label || c.metric,
      unit: c.unit,
      tip: c.tip,
      value: mockWalk(c.metric + (c.label ?? ''), 1, center, 0)[0],
      series: mockWalk(c.metric + (c.label ?? ''), 24, center, amp),
      color: colorForMetric(c.metric),
    };
  }),
);

function clampTopN(n: number): void {
  const v = Math.max(5, Math.min(8, Math.round(n || 5)));
  cfg.value.landing.topN = v;
  onEdit();
}

const headerColor = computed(() => props.layer.color);
const isDefaultLanding = computed(() => {
  const d = defaultLandingFor(props.layer.key);
  return (
    cfg.value.landing.priority === d.priority &&
    cfg.value.landing.topN === d.topN &&
    cfg.value.landing.orderBy === d.orderBy &&
    cfg.value.landing.columns.length === d.columns.length
  );
});
</script>

<template>
  <div class="sw-card layer-card" :class="{ 'is-open': open, 'is-inactive': !layer.active }">
    <div class="head" @click="toggle">
      <span class="dot" :style="{ background: headerColor }" />
      <span class="name">{{ cfg.displayName || layer.name }}</span>
      <span v-if="layer.active" class="sw-badge ok dot-mark">{{ layer.serviceCount >= 0 ? `${layer.serviceCount} services` : 'active' }}</span>
      <span v-else class="sw-badge">no data</span>
      <span class="sw-badge info" style="margin-left: auto" title="Priority on the Overview">
        ↑ {{ cfg.landing.priority }}
      </span>
      <span v-if="!isDefaultLanding" class="sw-badge">customized</span>
      <span class="caret" :class="{ open }"><Icon name="caret" :size="12" /></span>
    </div>
    <div class="summary">{{ summary }}</div>

    <div v-if="open" class="body">
      <section>
        <h4>Term aliases</h4>
        <div class="field-grid">
          <label>
            <span>Display name</span>
            <input v-model="cfg.displayName" :placeholder="layer.name" @input="onEdit" />
          </label>
          <label v-if="layer.slots.services !== undefined">
            <span>Services</span>
            <input v-model="cfg.slots.services" :placeholder="layer.slots.services" @input="onEdit" />
          </label>
          <label v-if="layer.slots.instances !== undefined">
            <span>Instances</span>
            <input v-model="cfg.slots.instances" :placeholder="layer.slots.instances" @input="onEdit" />
          </label>
          <label v-if="layer.slots.endpoints !== undefined">
            <span>Endpoints</span>
            <input v-model="cfg.slots.endpoints" :placeholder="layer.slots.endpoints" @input="onEdit" />
          </label>
          <label v-if="cfg.caps.endpointDependency">
            <span>Endpoint dependency</span>
            <input v-model="cfg.slots.endpointDependency" :placeholder="layer.slots.endpointDependency ?? `${cfg.slots.endpoints ?? 'Endpoint'} dependency`" @input="onEdit" />
          </label>
        </div>
      </section>

      <section>
        <h4>Features</h4>
        <div class="caps-grid">
          <label v-for="row in capRows" :key="row.key" class="cap-toggle">
            <input type="checkbox" v-model="cfg.caps[row.key]" @change="onEdit" />
            <span>{{ row.label }}</span>
          </label>
        </div>
      </section>

      <section>
        <div class="row-with-toggle">
          <h4>Overview tile groups</h4>
          <button
            class="sw-btn small"
            type="button"
            title="Add a new tile group"
            @click="addGroup"
          >＋ Add group</button>
        </div>
        <p class="hint subtle">
          Each group becomes one tile on the Overview strip. Auto groups carry 1 – 3 metric
          cells (with sparklines); square groups carry exactly 1 metric (the layer's
          headline) and render as compact squares in dense fleet views. Change a group's
          size to flip its tile.
        </p>
        <div class="row-with-toggle compact">
          <span class="hint subtle">
            Tip: keep one auto group for the headline metrics, add square groups for at-a-glance KPIs.
          </span>
          <button class="sw-btn ghost small" type="button" @click="showAdvanced = !showAdvanced">
            {{ showAdvanced ? 'Hide advanced' : 'Show advanced (scale / precision)' }}
          </button>
        </div>

        <div v-if="groupsArr().length === 0" class="hint subtle group-empty">
          No groups yet. Click "＋ Add group" to create the first tile.
        </div>

        <div
          v-for="(g, gIdx) in groupsArr()"
          :key="gIdx"
          class="group-block"
          :class="{ 'is-square': g.size === 'square' }"
        >
          <header class="group-head">
            <span class="group-idx">{{ gIdx + 1 }}</span>
            <input
              class="ctl group-title-input"
              v-model="g.title"
              placeholder="Group title (e.g. Throughput / Health)"
              @input="onEdit"
            />
            <div class="size-seg compact">
              <button
                class="seg-btn"
                :class="{ on: g.size === 'auto' }"
                type="button"
                title="3-metric tile, full-width slot"
                @click="setGroupSize(gIdx, 'auto')"
              >Auto</button>
              <button
                class="seg-btn"
                :class="{ on: g.size === 'square' }"
                type="button"
                title="1-metric square tile, compact slot"
                @click="setGroupSize(gIdx, 'square')"
              >Square</button>
            </div>
            <div class="group-actions">
              <button
                class="sw-btn ghost small"
                type="button"
                :disabled="gIdx === 0"
                title="Move group up"
                @click="moveGroup(gIdx, -1)"
              >↑</button>
              <button
                class="sw-btn ghost small"
                type="button"
                :disabled="gIdx === groupsArr().length - 1"
                title="Move group down"
                @click="moveGroup(gIdx, 1)"
              >↓</button>
              <button
                class="sw-btn ghost small danger"
                type="button"
                title="Remove group"
                @click="removeGroup(gIdx)"
              >✕</button>
            </div>
          </header>

          <table v-if="groupCells(gIdx).length > 0" class="col-editor">
            <thead>
              <tr>
                <th>#</th>
                <th>Label</th>
                <th>MQE</th>
                <th>Unit</th>
                <th>Aggregate</th>
                <th>Tip</th>
                <template v-if="showAdvanced">
                  <th>Scale</th>
                  <th>Precision</th>
                </template>
                <th class="row-actions"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(col, mIdx) in groupCells(gIdx)" :key="col.metric">
                <td class="metric-key">{{ mIdx + 1 }}</td>
                <td>
                  <input class="ctl" v-model="col.label" placeholder="e.g. RPM" @input="onEdit" />
                </td>
                <td>
                  <input
                    class="ctl mono"
                    v-model="col.mqe"
                    placeholder="e.g. service_cpm"
                    title="MQE expression — passed verbatim to OAP. Catalog short keys (e.g. cpm) also work."
                    @input="onEdit"
                  />
                </td>
                <td>
                  <input class="ctl narrow" v-model="col.unit" placeholder="—" @input="onEdit" />
                </td>
                <td>
                  <select class="ctl narrow" v-model="col.aggregation" @change="onEdit">
                    <option value="avg">avg</option>
                    <option value="sum">sum</option>
                  </select>
                </td>
                <td>
                  <input class="ctl" v-model="col.tip" placeholder="hover hint" @input="onEdit" />
                </td>
                <template v-if="showAdvanced">
                  <td>
                    <input
                      class="ctl narrow"
                      type="number"
                      step="any"
                      v-model.number="col.scale"
                      placeholder="1"
                      title="Multiplier applied to the raw MQE value (e.g. 0.01 to scale 9923 → 99.23)."
                      @input="onEdit"
                    />
                  </td>
                  <td>
                    <input
                      class="ctl narrow"
                      type="number"
                      min="0"
                      max="6"
                      v-model.number="col.precision"
                      placeholder="auto"
                      title="Decimal places to round to."
                      @input="onEdit"
                    />
                  </td>
                </template>
                <td class="row-actions">
                  <button
                    class="sw-btn ghost small"
                    type="button"
                    :disabled="mIdx === 0"
                    title="Move up"
                    @click="moveMetricInGroup(gIdx, mIdx, -1)"
                  >↑</button>
                  <button
                    class="sw-btn ghost small"
                    type="button"
                    :disabled="mIdx === groupCells(gIdx).length - 1"
                    title="Move down"
                    @click="moveMetricInGroup(gIdx, mIdx, 1)"
                  >↓</button>
                  <button
                    class="sw-btn ghost small danger"
                    type="button"
                    title="Remove from group"
                    @click="removeMetricInGroup(gIdx, col.metric)"
                  >✕</button>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-else class="hint subtle group-empty-row">
            No metrics in this group yet.
          </div>

          <div class="row-with-toggle compact">
            <span class="hint subtle">
              {{ g.size === 'square'
                ? 'Square groups carry exactly 1 metric (the headline).'
                : `Auto groups carry up to ${AUTO_GROUP_MAX} metrics.` }}
            </span>
            <button
              class="sw-btn ghost small"
              type="button"
              :disabled="g.metricIds.length >= maxMetricsFor(g.size)"
              :title="g.metricIds.length >= maxMetricsFor(g.size)
                ? 'Group is at its metric cap'
                : 'Add a new MQE-driven metric to this group'"
              @click="addMetricInGroup(gIdx)"
            >＋ Add metric</button>
          </div>
        </div>
      </section>

      <div class="actions">
        <button class="sw-btn" type="button" @click="resetThisLayer">Reset to defaults</button>
        <span class="hint">Changes are local until persisted via /api/setup (Stage 2.4).</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.layer-card {
  margin-bottom: 10px;
}
.layer-card.is-inactive .name {
  color: var(--sw-fg-2);
}
.head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  cursor: pointer;
  user-select: none;
}
.head .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: 0 0 8px;
}
.head .name {
  font-weight: 600;
  color: var(--sw-fg-0);
}
.head .dot-mark::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  margin-right: 4px;
  display: inline-block;
}
.caret {
  color: var(--sw-fg-3);
  transition: transform 0.12s;
  transform: rotate(-90deg);
  display: inline-flex;
  margin-left: 8px;
}
.caret.open {
  transform: rotate(0);
}
.summary {
  padding: 0 12px 10px;
  font-size: 11px;
  color: var(--sw-fg-2);
}
.body {
  border-top: 1px solid var(--sw-line);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.body h4 {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--sw-fg-2);
  margin: 0 0 8px;
  font-weight: 600;
}
.field-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
}
.field-grid label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: var(--sw-fg-2);
}
.field-grid label.wide {
  grid-column: 1 / -1;
  flex-direction: row;
  align-items: center;
}
.field-grid input,
.field-grid select {
  height: 28px;
  padding: 0 8px;
  background: var(--sw-bg-2);
  border: 1px solid var(--sw-line-2);
  border-radius: 4px;
  color: var(--sw-fg-0);
  font: inherit;
  font-size: 12px;
}
.field-grid input[type='checkbox'] {
  height: auto;
  margin-right: 6px;
  padding: 0;
}
.caps-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 6px;
}
.cap-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--sw-fg-1);
  padding: 4px 6px;
  border-radius: 4px;
  background: var(--sw-bg-2);
}
.cap-toggle input {
  accent-color: var(--sw-accent);
}
.cols-row {
  margin-top: 10px;
  display: flex;
  gap: 10px;
  align-items: flex-start;
}
.cols-label {
  font-size: 11px;
  color: var(--sw-fg-2);
  padding-top: 4px;
  flex: 0 0 80px;
}
.cols-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.chip {
  height: 24px;
  padding: 0 10px;
  background: var(--sw-bg-2);
  border: 1px solid var(--sw-line-2);
  border-radius: 4px;
  color: var(--sw-fg-1);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.chip.on {
  background: var(--sw-accent-soft);
  color: var(--sw-accent-2);
  border-color: var(--sw-accent-line);
}
.chip .unit {
  color: var(--sw-fg-3);
  font-size: 10px;
}
.chip.more {
  border-style: dashed;
  color: var(--sw-fg-2);
}
.chip.disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.chip .agg {
  margin-left: 4px;
  padding: 0 5px;
  border-radius: 2px;
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  background: var(--sw-bg-3);
  color: var(--sw-fg-3);
}
.chip.on .agg {
  background: var(--sw-accent-line);
  color: var(--sw-accent-2);
}

/* Overview tile picker — chip grid + ordered slot rail showing the
 * picked metrics in their on-tile order, with move-left/move-right
 * controls so operators can shuffle without removing + re-picking. */
.ov-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}
.ov-order {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: var(--sw-bg-2);
  border: 1px dashed var(--sw-line-2);
  border-radius: 5px;
}
.ov-order-label {
  font-size: 10.5px;
  color: var(--sw-fg-3);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.ov-slot {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 6px 3px 4px;
  background: var(--sw-bg-1);
  border: 1px solid var(--sw-line-2);
  border-radius: 4px;
  font-size: 11px;
}
.ov-slot .slot-idx {
  font-family: var(--sw-mono);
  font-size: 9.5px;
  width: 16px;
  height: 16px;
  display: inline-grid;
  place-items: center;
  background: var(--sw-accent);
  color: #0a0d12;
  font-weight: 700;
  border-radius: 3px;
}
.ov-slot .slot-name {
  color: var(--sw-fg-0);
  font-weight: 500;
}
.ov-slot .slot-agg {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0 5px;
  border-radius: 2px;
  background: var(--sw-bg-3);
  color: var(--sw-fg-3);
}
.ov-slot .sw-btn {
  width: 22px;
  height: 22px;
  padding: 0;
  display: inline-grid;
  place-items: center;
  font-size: 11px;
}
.ov-slot .sw-btn[disabled] { opacity: 0.35; pointer-events: none; }

/* Overview tile group editor — each group is a card-within-card
 * with its title / size toggle / metrics table / add-metric button. */
.group-empty {
  padding: 14px;
  text-align: center;
  border: 1px dashed var(--sw-line-2);
  border-radius: 6px;
  margin: 6px 0;
}
.group-empty-row {
  padding: 12px 16px;
  text-align: center;
}
.group-block {
  margin-top: 12px;
  border: 1px solid var(--sw-line);
  border-radius: 6px;
  background: var(--sw-bg-1);
  overflow: hidden;
}
.group-block.is-square {
  border-color: rgba(96, 165, 250, 0.3);
}
.group-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: var(--sw-bg-2);
  border-bottom: 1px solid var(--sw-line);
}
.group-idx {
  font-family: var(--sw-mono);
  font-size: 10px;
  width: 18px;
  height: 18px;
  display: inline-grid;
  place-items: center;
  background: var(--sw-accent);
  color: #0a0d12;
  font-weight: 700;
  border-radius: 3px;
}
.group-title-input {
  flex: 1;
  min-width: 0;
  height: 26px;
  padding: 0 8px;
  background: var(--sw-bg-1);
  border: 1px solid var(--sw-line-2);
  border-radius: 4px;
  color: var(--sw-fg-0);
  font: inherit;
  font-size: 11.5px;
}
.size-seg.compact {
  display: inline-flex;
  background: var(--sw-bg-1);
  border: 1px solid var(--sw-line);
  border-radius: 4px;
  overflow: hidden;
}
.size-seg.compact .seg-btn {
  height: 22px;
  padding: 0 8px;
  background: transparent;
  border: 0;
  color: var(--sw-fg-2);
  font: inherit;
  font-size: 10.5px;
  cursor: pointer;
}
.size-seg.compact .seg-btn:not(:last-child) {
  border-right: 1px solid var(--sw-line);
}
.size-seg.compact .seg-btn.on {
  background: var(--sw-accent-soft);
  color: var(--sw-accent-2);
  font-weight: 600;
}
.group-actions {
  display: inline-flex;
  gap: 4px;
}

/* Live preview tile — mirrors LayerKpiStripCard.vue at a smaller
 * scale. Fed by mock values from `previewCells`; updates live as the
 * operator edits labels / units / aggregation. */
.preview-wrap {
  margin-top: 14px;
  padding-top: 10px;
  border-top: 1px dashed var(--sw-line);
}
.preview-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--sw-fg-3);
  margin-bottom: 6px;
}
.preview-tile {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  max-width: 560px;
}
.pt-head {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 10.5px;
}
.pt-head .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: 0 0 6px;
  align-self: center;
}
.pt-head .name {
  color: var(--sw-fg-0);
  font-weight: 600;
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}
.pt-head .svc-count {
  display: inline-flex;
  align-items: baseline;
  gap: 3px;
  font-family: var(--sw-mono);
  color: var(--sw-fg-3);
}
.pt-head .svc-count .n {
  color: var(--sw-fg-1);
  font-weight: 600;
}
.pt-head .svc-count .unit {
  font-size: 9.5px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.pt-cells {
  display: grid;
  grid-template-columns: repeat(var(--cells-n, 3), minmax(0, 1fr));
  gap: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--sw-line);
}
.pt-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 2px 4px 0;
  min-width: 0;
}
.pt-cell-label {
  font-size: 10.5px;
  color: var(--sw-fg-3);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  text-align: center;
}
.pt-cell-label .cell-unit {
  margin-left: 4px;
  text-transform: none;
  letter-spacing: 0;
  font-size: 10px;
  color: var(--sw-fg-3);
}
.pt-cell-value {
  display: flex;
  align-items: baseline;
  justify-content: center;
  font-variant-numeric: tabular-nums;
}
.pt-cell-value .num {
  font-size: 26px;
  font-weight: 600;
  color: var(--cell-color, var(--sw-fg-0));
  letter-spacing: -0.02em;
  line-height: 1.05;
}
.pt-cell-trend {
  margin-top: 4px;
  width: 100%;
  max-width: 140px;
  height: 34px;
  display: block;
}
.preview-hint {
  margin-top: 6px;
}
.group-sep {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--sw-fg-3);
  align-self: center;
  margin: 0 6px;
}
.actions {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-top: 6px;
  border-top: 1px dashed var(--sw-line);
}
.actions .hint {
  margin-left: auto;
  font-size: 10.5px;
  color: var(--sw-fg-3);
}
.row-with-toggle {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 6px;
}
.row-with-toggle h4 {
  margin: 0;
}
.row-with-toggle .sw-btn {
  margin-left: auto;
  height: 22px;
  font-size: 10.5px;
  padding: 0 8px;
}
.hint.subtle {
  margin: -2px 0 8px;
  font-size: 10.5px;
  color: var(--sw-fg-3);
  line-height: 1.5;
}
.hint.subtle code {
  font-family: var(--sw-mono);
  font-size: 10px;
  background: var(--sw-bg-2);
  padding: 1px 4px;
  border-radius: 3px;
}
.col-editor {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
  /* No `table-layout: fixed` — we want the MQE column to grow with
   * its content so expressions like `service_percentile{p='99'}` are
   * fully visible. Narrow columns (#, Unit, Aggregate, actions) get
   * explicit `width` hints to keep them tight; the wide-content
   * columns (Label, MQE, Tip) absorb the remaining width. */
}
.col-editor th:nth-child(1),
.col-editor td:nth-child(1) { width: 24px; }   /* # */
.col-editor th:nth-child(4),
.col-editor td:nth-child(4) { width: 60px; }   /* Unit */
.col-editor th:nth-child(5),
.col-editor td:nth-child(5) { width: 80px; }   /* Aggregate */
.col-editor th.row-actions,
.col-editor td.row-actions { width: 84px; white-space: nowrap; }
/* MQE column claims roughly 2x the others — its input grows to
 * fit the cell, so the cell's natural width is what matters. */
.col-editor th:nth-child(3),
.col-editor td:nth-child(3) { min-width: 240px; }
.col-editor th {
  text-align: left;
  font-weight: 500;
  font-size: 10px;
  color: var(--sw-fg-3);
  letter-spacing: 0.04em;
  padding: 4px 6px 6px;
  border-bottom: 1px solid var(--sw-line);
}
.col-editor td {
  padding: 4px 6px;
  vertical-align: middle;
}
.col-editor .metric-key {
  font-family: var(--sw-mono);
  font-size: 10.5px;
  color: var(--sw-fg-2);
}
.col-editor .ctl {
  width: 100%;
  height: 22px;
  padding: 0 6px;
  background: var(--sw-bg-2);
  border: 1px solid var(--sw-line-2);
  border-radius: 3px;
  color: var(--sw-fg-0);
  font: inherit;
  font-size: 11px;
}
.col-editor .ctl.narrow {
  max-width: 70px;
}
.col-editor .ctl.mono,
.field-grid .mono {
  font-family: var(--sw-mono);
  font-size: 10.5px;
}
.field-grid label.wide-2 {
  grid-column: span 2;
}
</style>
