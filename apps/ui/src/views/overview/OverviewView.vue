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
  Cross-layer landing. Two visible elements:
   1. Per-layer KPI strip — each reporting layer gets a tile carrying
      service count + 1 – 3 aggregated metric cells (operator-configured
      via the layer template's `overview.metrics`). Aggregation is the
      column's `aggregation` field (sum / avg), computed BFF-side.
      Strip is capped at 5 per row × 2 rows = 10 layers max, ordered
      by priority + display name.
   2. Alarms rail — recent active alarms, read-only.

  Overview does NOT surface per-layer service lists — those live on the
  per-layer Service page. Cross-layer service detail isn't a supported
  Overview concept; the page is a fleet-level glance.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import { useLayers } from '@/composables/useLayers';
import { useLandingOrder } from '@/composables/useLandingOrder';
import OverviewBody from './OverviewBody.vue';

const { availableLayers, oapReachable, oapError, isLoading } = useLayers();
const orderedLayers = useLandingOrder(availableLayers);
const empty = computed(() => !isLoading.value && orderedLayers.value.length === 0);
</script>

<template>
  <div class="overview">

    <div v-if="!oapReachable && !isLoading" class="banner err">
      <strong>OAP unreachable.</strong>
      {{ oapError ?? 'Check that the OAP query host is up and reachable from the BFF.' }}
    </div>

    <div v-if="empty" class="empty">
      <div class="empty-card">
        <h2>No layer is reporting services yet</h2>
        <p>
          Once data flows through OAP, every reporting layer appears here automatically,
          ordered by the priority you assign in
          <RouterLink to="/setup">Overview setup</RouterLink>.
        </p>
        <RouterLink class="sw-btn is-primary" to="/setup">Open Overview setup</RouterLink>
      </div>
    </div>

    <OverviewBody
      v-else
      :layers="orderedLayers"
      :show-overflow-note="true"
      :show-alarms="true"
    />
  </div>
</template>

<style scoped>
.overview {
  padding: 20px 20px 60px;
  max-width: 1440px;
  margin: 0 auto;
}
.page-head { margin-bottom: 18px; }
.kicker {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--sw-accent);
  margin-bottom: 6px;
}
.page-head h1 {
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--sw-fg-0);
  margin: 0 0 8px;
}
.lede {
  font-size: 12.5px;
  color: var(--sw-fg-1);
  line-height: 1.5;
  margin: 0;
  max-width: 720px;
}
.lede code {
  font-family: var(--sw-mono);
  font-size: 11px;
  padding: 0 4px;
  border-radius: 3px;
  background: var(--sw-bg-2);
  color: var(--sw-fg-1);
}
.lede a {
  color: var(--sw-accent-2);
  text-decoration: none;
}
.banner.err {
  margin: 0 0 16px;
  padding: 10px 12px;
  background: var(--sw-err-soft);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 6px;
  color: #f87171;
  font-size: 12px;
  line-height: 1.5;
}
.empty { margin-top: 20px; }
.empty-card {
  background: var(--sw-bg-1);
  border: 1px dashed var(--sw-line-2);
  border-radius: 10px;
  padding: 28px;
  text-align: center;
  max-width: 600px;
  margin: 0 auto;
}
.empty-card h2 {
  font-size: 15px;
  color: var(--sw-fg-0);
  margin: 0 0 8px;
}
.empty-card p {
  font-size: 12px;
  color: var(--sw-fg-2);
  margin: 0 0 16px;
  line-height: 1.5;
}
.empty-card .sw-btn { display: inline-flex; text-decoration: none; }
.empty-card a { color: var(--sw-accent-2); text-decoration: none; }

/* KPI strip + Alarms rail layout lives in OverviewBody.vue — shared
 * between the live Overview and the Preview tab on Admin · Overview
 * setup so the two stay byte-identical. */
</style>
