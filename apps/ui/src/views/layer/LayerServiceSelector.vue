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
  Sticky selector zone at the top of every per-layer tab. The currently
  selected service is pinned (name + inline KPIs); click "switch" to
  expand a filterable + paginated table of all sampled services. Picking
  a row updates the page-wide selection (driven via URL `?service=`),
  which downstream widgets (constellation, dashboards, traces tab once
  it lands) consume to scope their queries.

  Default selection: the first row of `services` (sorted desc by orderBy
  in the BFF), so opening a layer lands on the highest-traffic service.
-->
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { LandingColumn, LandingServiceRow } from '@skywalking-horizon-ui/api-client';
import { metricMeta } from '@/composables/metricCatalog';
import { fmtMetric } from '@/utils/formatters';

const props = withDefaults(
  defineProps<{
    services: ReadonlyArray<LandingServiceRow>;
    columns: ReadonlyArray<LandingColumn>;
    selectedId: string | null;
    /** Layer color — used for the pinned service dot. */
    accent?: string;
    /** Rows per page in expanded mode. */
    pageSize?: number;
  }>(),
  {
    accent: 'var(--sw-accent)',
    pageSize: 8,
  },
);
const emit = defineEmits<{ (e: 'select', id: string): void }>();

const expanded = ref(false);
const filter = ref('');
const page = ref(0);

// Default-select highest-traffic (first row) on initial render when the
// caller hasn't set anything. Watch responds to delayed data loads too.
watch(
  () => props.services,
  (rows) => {
    if (!props.selectedId && rows.length > 0) emit('select', rows[0].serviceId);
  },
  { immediate: true },
);

const selectedRow = computed<LandingServiceRow | null>(
  () => props.services.find((s) => s.serviceId === props.selectedId) ?? props.services[0] ?? null,
);

const filtered = computed(() => {
  const q = filter.value.trim().toLowerCase();
  const base = props.services;
  if (q.length === 0) return base;
  return base.filter((s) => s.serviceName.toLowerCase().includes(q));
});
const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / props.pageSize)));
const currentPage = computed(() => Math.min(page.value, pageCount.value - 1));
const visible = computed(() => {
  const start = currentPage.value * props.pageSize;
  return filtered.value.slice(start, start + props.pageSize);
});
watch(filter, () => (page.value = 0));

function selectAndCollapse(id: string): void {
  emit('select', id);
  expanded.value = false;
}
function toggle(): void {
  expanded.value = !expanded.value;
}
</script>

<template>
  <section class="sw-card selector" :class="{ expanded }">
    <div class="pin">
      <span class="dot" :style="{ background: accent }" />
      <div class="pin-title">
        <span class="kicker">Selected {{ services.length > 0 ? 'service' : '' }}</span>
        <div class="name">
          {{ selectedRow?.serviceName || (services.length > 0 ? 'pick a service' : '—') }}
        </div>
      </div>
      <div class="pin-kpis">
        <div
          v-for="c in columns"
          :key="c.metric"
          class="pin-kpi"
          :title="`${metricMeta(c.metric).longLabel}\n\n${metricMeta(c.metric).tip}`"
        >
          <span class="pin-kpi-label">{{ c.label }}<span v-if="c.unit" class="unit">{{ c.unit }}</span></span>
          <span class="pin-kpi-value" :class="{ muted: selectedRow?.metrics[c.metric] == null }">
            {{ fmtMetric(selectedRow?.metrics[c.metric] ?? null) }}
          </span>
        </div>
      </div>
      <button class="sw-btn ghost small toggle" type="button" @click="toggle">
        <span>{{ expanded ? 'Close' : 'Switch' }}</span>
        <span class="caret" :class="{ open: expanded }">▾</span>
      </button>
    </div>

    <div v-if="expanded" class="picker">
      <div class="picker-head">
        <input
          v-model="filter"
          class="search"
          placeholder="filter by name…"
          spellcheck="false"
          autocomplete="off"
        />
        <span class="count">
          {{ filtered.length }} of {{ services.length }}
        </span>
      </div>
      <table class="sw-table picker-table">
        <thead>
          <tr>
            <th class="svc-col">Service</th>
            <th v-for="c in columns" :key="c.metric" class="num">
              {{ c.label }}<span v-if="c.unit" class="unit">{{ c.unit }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in visible"
            :key="row.serviceId"
            class="row"
            :class="{ active: row.serviceId === selectedRow?.serviceId }"
            @click="selectAndCollapse(row.serviceId)"
          >
            <td class="svc-col" :title="row.serviceName">
              <span class="name-text">{{ row.shortName || row.serviceName }}</span>
            </td>
            <td
              v-for="c in columns"
              :key="c.metric"
              class="num"
              :class="{ muted: row.metrics[c.metric] == null }"
            >
              {{ fmtMetric(row.metrics[c.metric]) }}
            </td>
          </tr>
          <tr v-if="visible.length === 0">
            <td :colspan="columns.length + 1" class="empty">
              No services match <code>{{ filter }}</code>.
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="pageCount > 1" class="pager">
        <button class="sw-btn ghost small" :disabled="currentPage === 0" @click="page = currentPage - 1">←</button>
        <span class="page-info">{{ currentPage + 1 }} / {{ pageCount }}</span>
        <button
          class="sw-btn ghost small"
          :disabled="currentPage >= pageCount - 1"
          @click="page = currentPage + 1"
        >
          →
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.selector {
  margin-bottom: 14px;
}
.pin {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
}
.pin .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: 0 0 8px;
}
.pin-title {
  min-width: 0;
  flex: 0 0 220px;
}
.pin-title .kicker {
  display: block;
  font-size: 9.5px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--sw-fg-3);
  line-height: 1;
}
.pin-title .name {
  margin-top: 2px;
  font-family: var(--sw-mono);
  font-size: 13px;
  font-weight: 600;
  color: var(--sw-fg-0);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pin-kpis {
  display: flex;
  gap: 18px;
  flex: 1;
  flex-wrap: wrap;
}
.pin-kpi {
  text-align: right;
  min-width: 50px;
}
.pin-kpi-label {
  display: block;
  font-size: 9.5px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--sw-fg-3);
  margin-bottom: 1px;
}
.pin-kpi-label .unit {
  margin-left: 2px;
  text-transform: none;
  letter-spacing: 0;
}
.pin-kpi-value {
  font-size: 14px;
  font-weight: 600;
  color: var(--sw-fg-0);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
}
.pin-kpi-value.muted {
  color: var(--sw-fg-3);
}
.toggle {
  margin-left: auto;
  font-size: 11px;
  height: 24px;
  padding: 0 10px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.caret {
  display: inline-block;
  transform: rotate(0);
  transition: transform 0.12s;
  font-size: 8px;
}
.caret.open {
  transform: rotate(180deg);
}
.picker {
  border-top: 1px solid var(--sw-line);
  padding: 10px 14px 14px;
}
.picker-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.search {
  flex: 1;
  max-width: 320px;
  height: 28px;
  padding: 0 10px;
  background: var(--sw-bg-2);
  border: 1px solid var(--sw-line-2);
  border-radius: 4px;
  color: var(--sw-fg-0);
  font: inherit;
  font-size: 12px;
}
.search:focus {
  outline: 1px solid var(--sw-accent-line);
  border-color: var(--sw-accent-line);
}
.count {
  font-size: 11px;
  color: var(--sw-fg-3);
  margin-left: auto;
  font-variant-numeric: tabular-nums;
}
.picker-table {
  width: 100%;
  font-size: 11.5px;
}
.picker-table th {
  text-align: left;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--sw-fg-3);
  font-weight: 500;
  padding: 4px 8px;
  border-bottom: 1px solid var(--sw-line);
}
.picker-table th.num {
  text-align: right;
}
.picker-table td {
  padding: 6px 8px;
  color: var(--sw-fg-1);
  border-bottom: 1px solid var(--sw-line);
}
.picker-table td.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.picker-table td.muted {
  color: var(--sw-fg-3);
}
.picker-table tr.row {
  cursor: pointer;
}
.picker-table tr.row:hover {
  background: var(--sw-bg-2);
}
.picker-table tr.row.active {
  background: var(--sw-accent-soft);
}
.picker-table tr.row.active .name-text {
  color: var(--sw-accent-2);
  font-weight: 600;
}
.picker-table .empty {
  text-align: center;
  padding: 16px;
  color: var(--sw-fg-3);
  font-size: 11px;
}
.picker-table .empty code {
  font-family: var(--sw-mono);
  background: var(--sw-bg-2);
  padding: 1px 4px;
  border-radius: 3px;
}
.svc-col {
  max-width: 240px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.name-text {
  font-family: var(--sw-mono);
  color: var(--sw-fg-0);
  font-size: 11.5px;
}
.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin-top: 10px;
}
.pager .sw-btn {
  height: 22px;
  font-size: 11px;
  padding: 0 8px;
}
.pager .sw-btn[disabled] {
  opacity: 0.4;
  cursor: not-allowed;
}
.page-info {
  font-size: 10.5px;
  color: var(--sw-fg-2);
  font-variant-numeric: tabular-nums;
}
</style>
