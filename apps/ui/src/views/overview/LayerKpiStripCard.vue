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
  One tile in the per-layer Overview strip. Renders up to 3 KPI cells
  driven by the layer template's `overview.metrics`. Each cell shows a
  label, value, and a mini sparkline pulled from
  `aggregates.seriesByMetric`.

  Width-adaptive: when the tile is wide (~> 220px), cells lay out in a
  horizontal row with sparklines; when squeezed below that, the cells
  collapse to label + value chips (no sparks), stacked to fit. A
  ResizeObserver drives the breakpoint so the tile behaves as the
  strip auto-fits more layers per row.

  Clicking the tile drills into the layer's service page.
-->
<script setup lang="ts">
import { computed, toRef } from 'vue';
import { RouterLink } from 'vue-router';
import type { LayerDef } from '@skywalking-horizon-ui/api-client';
import { metricMeta } from '@/composables/metricCatalog';
import { colorForMetric } from '@/composables/metricColor';
import { useLayerLanding } from '@/composables/useLayerLanding';
import { useSetupStore } from '@/stores/setup';
import { fmtMetric } from '@/utils/formatters';
import Sparkline from '@/components/charts/Sparkline.vue';

const props = withDefaults(
  defineProps<{
    layer: LayerDef;
    /** When true the tile renders as a static card (no RouterLink). */
    disableLink?: boolean;
    /**
     * Tile kind:
     *   - `serviceCount` — square tile bundled per layer, shows the
     *      live service count. Always sits as the first tile for its
     *      layer. The service number lives ONLY on this tile so the
     *      other tiles can drop the duplicate counter.
     *   - `group` (default) — render one of the layer's
     *      `overviewGroups` (label + metric cells).
     */
    kind?: 'serviceCount' | 'group';
    /**
     * Specific Overview group to render (only honored when
     * `kind === 'group'`). The Overview Body iterates over each
     * layer's `landingCfg.overviewGroups` and passes one group per
     * tile.
     */
    groupIndex?: number;
  }>(),
  { disableLink: false, kind: 'group', groupIndex: 0 },
);
const store = useSetupStore();
const cfg = computed(() =>
  store.ensure(props.layer.key, {
    slots: props.layer.slots,
    caps: props.layer.caps,
    metrics: props.layer.metrics,
    overview: props.layer.overview,
  }),
);
const landingCfg = computed(() => cfg.value.landing);
const layerRef = toRef(props, 'layer');
const landing = useLayerLanding(layerRef, landingCfg);
const aggregates = computed(() => landing.data.value?.aggregates ?? null);
const serviceCount = computed(() => aggregates.value?.serviceCount ?? props.layer.serviceCount);
const slotName = computed(() => cfg.value.slots.services ?? 'services');

interface KpiCell {
  metric: string;
  label: string;
  /** Hover tip from the operator's overview-metric config. Surfaced
   *  via the cell's `title` attribute so a brief mouseover reads
   *  the explanation. */
  tip?: string;
  unit?: string;
  value: number | null;
  series: Array<number | null> | null;
  color: string;
}

/** Resolve the active group for this tile. Falls back to a synthetic
 *  group built from `overviewMetrics` (legacy callers) so existing
 *  call sites keep working until the Overview Body fully switches to
 *  passing `groupIndex`. */
const group = computed(() => {
  const groups = landingCfg.value.overviewGroups ?? [];
  if (groups.length > 0) return groups[Math.min(props.groupIndex, groups.length - 1)];
  const all = landingCfg.value.overviewMetrics ?? [
    aggregates.value?.throughputMetric ?? landingCfg.value.orderBy,
  ];
  return { title: '', size: 'auto' as const, metricIds: all };
});

const groupTitle = computed(() => group.value.title);
const size = computed<'auto' | 'square'>(() => group.value.size);

/** 1-3 KPI cells for this group. Square groups recommend exactly one
 *  metric (the layer's primary headline — RPM for services, Msg/s
 *  for MQ, QPS for DB — at-a-glance signal in dense fleet views). */
const cells = computed<KpiCell[]>(() => {
  const all = group.value.metricIds;
  const keys = size.value === 'square' ? all.slice(0, 1) : all.slice(0, 3);
  const a = aggregates.value;
  return keys.map((key) => {
    const meta = metricMeta(key);
    const col = landingCfg.value.columns.find((c) => c.metric === key);
    const value = (() => {
      if (!a) return null;
      if (key === a.throughputMetric && a.throughputValue !== undefined) return a.throughputValue;
      return a.metrics?.[key] ?? null;
    })();
    const series = (() => {
      if (!a) return null;
      if (key === a.throughputMetric && a.spark) return a.spark;
      return a.seriesByMetric?.[key] ?? null;
    })();
    return {
      metric: key,
      label: col?.label ?? meta.label,
      tip: col?.tip ?? meta.tip,
      unit: col?.unit ?? meta.unit,
      value,
      series,
      // Per-metric semantic color (orange for throughput, yellow for
      // latency, green for SLA, red for errors, etc.). Matches the
      // booster-ui color story so operators get instant signal
      // without reading the label.
      color: colorForMetric(key),
    };
  });
});

/** Breakpoints driven by the actual rendered tile width — not the
 *  viewport. The strip auto-fits N tiles per row at ~200px each, so
 *  a 1440px screen with 6 layers gives ~210px tiles (compact mode)
 *  and a 1200px screen with 5 layers gives ~220px (also compact);
 *  only when tiles get noticeably wider do sparklines fit. */
/* Deterministic layout: `auto` groups always render linear (label +
 * big colored value + sparkline per cell); `square` groups always
 * render the single-cell square. No width-adaptive switching — the
 * group's size config is the only input, so the Preview tab on
 * /setup matches the real Overview page regardless of container
 * width. Compact-chip mode was removed: it caused tiles to silently
 * shift styles depending on viewport, which read as a randomly-
 * changing UI. */
const layout = computed<'linear'>(() => 'linear');

const detailHref = computed(() => `/layer/${props.layer.key}/service`);
</script>

<template>
  <component
    :is="disableLink ? 'div' : RouterLink"
    class="sw-card strip-card"
    :class="{
      'no-link': disableLink,
      'is-square': kind === 'serviceCount' || size === 'square',
      'is-service-count': kind === 'serviceCount',
    }"
    :to="disableLink ? undefined : detailHref"
    :data-layout="layout"
    :data-size="kind === 'serviceCount' ? 'square' : size"
  >
    <!-- Header stacks layer name on top, group title (if any)
         underneath — operators see "General Service" prominently and
         each group tile's intent ("Throughput" / "Health") as a
         sub-label. The service-count tile has no group title; its
         header is the layer name alone. -->
    <header class="head">
      <span class="layer-line">
        <span class="dot" :style="{ background: layer.color }" />
        <span class="name">{{ cfg.displayName || layer.name }}</span>
      </span>
      <span v-if="kind === 'group' && groupTitle" class="group-line">
        {{ groupTitle }}
      </span>
      <span v-else-if="kind === 'serviceCount'" class="group-line muted">
        {{ slotName }}
      </span>
    </header>

    <!-- Service-count body: a single big number for the layer's
         service total. Other tiles drop the svc-count chip from their
         header since this tile owns the number — no duplicate. -->
    <div v-if="kind === 'serviceCount'" class="sc-body">
      <span class="sc-num" :class="{ muted: serviceCount < 0 }">{{
        serviceCount >= 0 ? serviceCount : '—'
      }}</span>
    </div>
    <!-- Group body: 1-3 KPI cells. -->
    <div v-else class="cells" :class="layout" :style="{ '--cells-n': cells.length }">
      <div
        v-for="c in cells"
        :key="c.metric"
        class="cell"
        :style="{ '--cell-color': c.color }"
        :title="c.tip || c.label"
      >
        <div class="cell-label">
          {{ c.label }}<span v-if="c.unit" class="cell-unit">({{ c.unit }})</span>
          <span v-if="c.tip" class="tip-mark" aria-hidden="true">?</span>
        </div>
        <div class="cell-value">
          <span class="num" :class="{ muted: c.value == null }">{{ fmtMetric(c.value) }}</span>
        </div>
        <Sparkline
          v-if="layout === 'linear' && c.series && c.series.length > 1"
          class="trend"
          :values="c.series"
          :width="120"
          :height="34"
          :color="c.color"
          :stroke="1.5"
        />
      </div>
    </div>
  </component>
</template>

<style scoped>
.strip-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  text-decoration: none;
  min-width: 0;
  transition: border-color 0.12s, background 0.12s;
}
.strip-card:hover {
  border-color: var(--sw-line-3);
  background: var(--sw-bg-1);
}
/* Preview-mode tile: render as a static card, suppress the
 * hover-as-link affordance so operators don't expect navigation. */
.strip-card.no-link {
  cursor: default;
}
.strip-card.no-link:hover {
  border-color: var(--sw-line);
  background: var(--sw-bg-1);
}

/* Square mode — single-metric small tile. Used in dense grids (10+
 * layers) where a 3-cell tile per layer is too noisy. Forces a
 * roughly-square aspect ratio so the strip reads as a tight grid. */
.strip-card.is-square {
  aspect-ratio: 1 / 1;
  padding: 8px 10px;
  gap: 4px;
}
.strip-card.is-square .head {
  font-size: 10px;
}
.strip-card.is-square .head .svc-count .n {
  font-size: 10.5px;
}
.strip-card.is-square .head .svc-count .unit {
  display: none;
}
.strip-card.is-square .cells.linear,
.strip-card.is-square .cells.compact {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  border-top: 1px dashed var(--sw-line);
  padding-top: 6px;
}
.strip-card.is-square .cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  width: 100%;
  min-width: 0;
}
.strip-card.is-square .cell-label {
  font-size: 9.5px;
}
.strip-card.is-square .cell-value .num {
  font-size: 22px;
  font-weight: 600;
  color: var(--cell-color, var(--sw-fg-0));
  letter-spacing: -0.02em;
  line-height: 1.05;
}
.strip-card.is-square .trend {
  margin-top: 2px;
  width: 100%;
  max-width: 100%;
  height: 26px;
}

/* Stacked header: layer name on top (with dot), group title beneath
 * as a smaller sub-label. The service-count tile's "subtitle" is the
 * layer's services-slot name (e.g. "Services" / "API"). */
.head {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.layer-line {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  min-width: 0;
}
.layer-line .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: 0 0 6px;
}
.layer-line .name {
  color: var(--sw-fg-0);
  font-weight: 600;
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}
.group-line {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--sw-accent-2);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding-left: 12px;
}
.group-line.muted {
  color: var(--sw-fg-3);
  font-weight: 500;
}

/* Service-count tile body: one big number, centered. */
.sc-body {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px 0 2px;
  border-top: 1px dashed var(--sw-line);
}
.sc-num {
  font-size: 30px;
  font-weight: 600;
  color: var(--sw-fg-0);
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  line-height: 1.05;
}
.sc-num.muted { color: var(--sw-fg-3); }

/* Linear mode — match the ui-1 reference: label centered above a
 * large colored value, sparkline (with area fill) below. Each cell
 * uses --cell-color (semantic per-metric color from colorForMetric)
 * for the value text + sparkline. */
.cells.linear {
  display: grid;
  grid-template-columns: repeat(var(--cells-n, 3), minmax(0, 1fr));
  gap: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--sw-line);
}
.cells.linear .cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  min-width: 0;
  padding: 2px 4px 0;
}
.cells.linear .cell-label {
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
.cells.linear .cell-label .cell-unit {
  margin-left: 4px;
  text-transform: none;
  letter-spacing: 0;
  font-size: 10px;
  color: var(--sw-fg-3);
}
/* Small `?` indicator next to the label when a tip is configured —
 * hover the cell (browser native tooltip) to read it. The cell's
 * `title` attribute carries the full tip text. */
.cell-label .tip-mark {
  display: inline-grid;
  place-items: center;
  width: 12px;
  height: 12px;
  margin-left: 4px;
  background: var(--sw-bg-3);
  color: var(--sw-fg-3);
  font-family: var(--sw-mono);
  font-size: 9px;
  font-weight: 700;
  border-radius: 50%;
  text-transform: none;
  letter-spacing: 0;
  vertical-align: middle;
  cursor: help;
}
.cell:hover .tip-mark {
  background: var(--cell-color, var(--sw-accent));
  color: #0a0d12;
}
.cells.linear .cell-value {
  display: flex;
  align-items: baseline;
  justify-content: center;
  font-variant-numeric: tabular-nums;
}
.cells.linear .cell-value .num {
  font-size: 28px;
  font-weight: 600;
  color: var(--cell-color, var(--sw-fg-0));
  letter-spacing: -0.02em;
  line-height: 1.05;
}
.cells.linear .cell-value .num.muted {
  color: var(--sw-fg-3);
}
.cells.linear .trend {
  margin-top: 4px;
  width: 100%;
  max-width: 140px;
  height: 34px;
  display: block;
}

/* Compact mode — narrow tiles drop sparklines and stack each cell as
 * a label / value row. Value still picks up its --cell-color. */
.cells.compact {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-top: 6px;
  border-top: 1px dashed var(--sw-line);
}
.cells.compact .cell {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px;
  font-size: 11px;
}
.cells.compact .cell-label {
  color: var(--sw-fg-3);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-size: 9.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cells.compact .cell-label .cell-unit {
  margin-left: 3px;
  text-transform: none;
  letter-spacing: 0;
}
.cells.compact .cell-value {
  display: inline-flex;
  align-items: baseline;
  gap: 2px;
}
.cells.compact .cell-value .num {
  color: var(--cell-color, var(--sw-fg-0));
  font-weight: 600;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
}
.cells.compact .cell-value .num.muted { color: var(--sw-fg-3); }
</style>
