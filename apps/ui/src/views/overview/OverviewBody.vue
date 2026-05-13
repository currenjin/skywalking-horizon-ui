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
  Shared Overview body — used by both the real Overview page
  (OverviewView.vue) and the Preview tab on Admin · Overview setup
  (SetupView.vue). Renders the per-layer KPI strip + Alarms rail
  exactly the same way in both places so "preview" reads as a true
  what-you-see-is-what-you-get.

  Per-layer tiles read from the SetupStore, so the same component
  reflects unsaved edits during preview without any extra plumbing.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import type { LayerDef } from '@skywalking-horizon-ui/api-client';
import { useSetupStore } from '@/stores/setup';
import AlarmsPanel from './AlarmsPanel.vue';
import LayerKpiStripCard from './LayerKpiStripCard.vue';

const store = useSetupStore();

const props = withDefaults(
  defineProps<{
    layers: LayerDef[];
    /** Show the strip-overflow note + an `Overview setup` link.
     *  Off in preview mode (operator is already on setup). */
    showOverflowNote?: boolean;
    /** Show the Alarms rail underneath the strip. */
    showAlarms?: boolean;
    /** When true, render tiles as static cards (no navigation on
     *  click). Used by the Preview tab so clicking a tile doesn't
     *  yank the operator out of setup. */
    disableTileLinks?: boolean;
  }>(),
  {
    showOverflowNote: true,
    showAlarms: true,
    disableTileLinks: false,
  },
);

/* Cap mirrors the design brief: 5 per row × 2 rows = 10 layers max.
 * Each layer's groups expand into separate tiles below (a layer with
 * 2 groups produces 2 tiles). */
const STRIP_CAP = 10;
const stripLayers = computed(() => props.layers.slice(0, STRIP_CAP));
const overflow = computed(() => Math.max(0, props.layers.length - STRIP_CAP));

interface TileEntry {
  layer: LayerDef;
  kind: 'serviceCount' | 'group';
  groupIndex?: number;
  size: 'auto' | 'square';
}

/** Expand each layer into N tile entries.
 *  Order per layer (when `caps.serviceCountTile` is on):
 *    1. serviceCount square tile (bundled headline).
 *    2. Each Overview group, in operator order, as its own tile.
 *  Layers with the cap off skip the bundled tile.
 *
 *  vue-query inside `LayerKpiStripCard` dedupes the landing fetch by
 *  (layer, landingCfg), so multiple tiles for the same layer share a
 *  single network call — no duplicate fetches across groups. */
const tiles = computed<TileEntry[]>(() => {
  const out: TileEntry[] = [];
  for (const layer of stripLayers.value) {
    const cfg = store.ensure(layer.key, {
      slots: layer.slots,
      caps: layer.caps,
      metrics: layer.metrics,
      overview: layer.overview,
    });
    if (cfg.caps.serviceCountTile !== false) {
      out.push({ layer, kind: 'serviceCount', size: 'square' });
    }
    const groups = cfg.landing.overviewGroups ?? [{ title: '', size: 'auto' as const, metricIds: [] }];
    groups.forEach((g, i) => {
      out.push({ layer, kind: 'group', groupIndex: i, size: g.size });
    });
  }
  return out;
});
</script>

<template>
  <div class="overview-body">
    <!-- Strip — one tile per (layer, group). Auto-flow grid packs the
         tile sizes (auto tiles claim 3 columns, square tiles claim 1)
         so a layer with one auto group + one square group reads as
         "wide tile + sidekick". -->
    <div class="kpi-strip">
      <LayerKpiStripCard
        v-for="t in tiles"
        :key="`${t.layer.key}_${t.kind}_${t.groupIndex ?? 'sc'}`"
        :layer="t.layer"
        :kind="t.kind"
        :group-index="t.groupIndex"
        :disable-link="disableTileLinks"
        :class="['tile-cell', t.size === 'square' ? 'tile-square' : 'tile-auto']"
      />
    </div>
    <div v-if="showOverflowNote && overflow > 0" class="overflow-note">
      {{ overflow }} more layer{{ overflow === 1 ? '' : 's' }} not shown.
      <RouterLink to="/setup">Re-order via setup</RouterLink>
      to surface them.
    </div>
    <AlarmsPanel v-if="showAlarms" class="alarms-rail" />
  </div>
</template>

<style scoped>
.overview-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* Mixed-size strip: 15-column flow grid. Auto tiles span 3 (5/row),
 * square tiles span 2 — roughly 2× the previous square size, so the
 * single primary metric reads cleanly without crowding. Math: 15
 * cols decomposes as 5 autos (3+3+3+3+3) OR 1 auto + 6 squares
 * (3+12) OR 3 autos + 3 squares (9+6). Auto-flow dense packs the
 * squares into gaps the auto tiles can't fill, so a layer with one
 * auto + one square group reads as "wide tile + sidekick". */
.kpi-strip {
  display: grid;
  grid-template-columns: repeat(15, minmax(0, 1fr));
  grid-auto-flow: dense;
  gap: 12px;
}
.tile-auto { grid-column: span 3; }
.tile-square { grid-column: span 2; }

.overflow-note {
  font-size: 11px;
  color: var(--sw-fg-3);
  padding: 0 8px;
}
.overflow-note a {
  color: var(--sw-accent-2);
  text-decoration: none;
}

.alarms-rail {
  display: block;
  min-width: 0;
}

@media (max-width: 1200px) {
  /* 12-col grid: 4 autos OR 6 squares per row. */
  .kpi-strip { grid-template-columns: repeat(12, minmax(0, 1fr)); }
}
@media (max-width: 900px) {
  /* 6-col grid: 2 autos OR 3 squares per row. */
  .kpi-strip { grid-template-columns: repeat(6, minmax(0, 1fr)); }
}
@media (max-width: 600px) {
  .kpi-strip { grid-template-columns: minmax(0, 1fr); }
  .tile-auto, .tile-square { grid-column: 1 / -1; }
}
</style>
