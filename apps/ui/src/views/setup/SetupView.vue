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
  Admin · Overview setup. Layout mirrors /admin/layer-dashboards: a
  collapsible layer-rail on the left, the selected layer's setup card
  on the right (which carries its own preview of the Overview tile).
  Only reporting layers ("existing") are listed here — layers with no
  services configured yet are noise on this page; they show up
  automatically the moment OAP starts forwarding them.
-->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import LayerSetupCard from './LayerSetupCard.vue';
import OverviewBody from '@/views/overview/OverviewBody.vue';
import { useLayers } from '@/composables/useLayers';
import { useLandingOrder } from '@/composables/useLandingOrder';
import { useSetupStore } from '@/stores/setup';

const { layers, availableLayers, oapReachable, oapError, isLoading } = useLayers();
const store = useSetupStore();

onMounted(() => {
  void store.bootstrap();
});

/** Preview tab uses the SAME layer source as the real Overview page
 *  (`availableLayers` from useLayers), priority-ordered, so the
 *  preview is a faithful render — not a filtered subset. */
const previewOrder = useLandingOrder(availableLayers);

const savePhase = ref<'idle' | 'saving' | 'saved' | 'error'>('idle');
async function onSave(): Promise<void> {
  savePhase.value = 'saving';
  try {
    await store.save();
    savePhase.value = 'saved';
    setTimeout(() => {
      if (savePhase.value === 'saved') savePhase.value = 'idle';
    }, 1500);
  } catch {
    savePhase.value = 'error';
  }
}
async function onDiscard(): Promise<void> {
  await store.discard();
  savePhase.value = 'idle';
}

const orderedLayers = useLandingOrder(layers);

/** Only layers with a dashboard template (overview tile or per-layer
 *  header columns loaded from `apps/bff/src/layers/config/<key>.json`)
 *  belong on this page. Detected-but-undefined layers have nothing to
 *  configure here — they'd render as empty cards. Already ordered by
 *  priority (lowest first) via `useLandingOrder`. */
const existingLayers = computed(() =>
  orderedLayers.value.filter(
    (L) => (L.overview?.metrics?.length ?? 0) > 0 || (L.header?.columns?.length ?? 0) > 0,
  ),
);

const selectedKey = ref<string>('');
watch(
  existingLayers,
  (rows) => {
    if (rows.length === 0) {
      selectedKey.value = '';
      return;
    }
    if (!rows.some((L) => L.key === selectedKey.value)) {
      selectedKey.value = rows[0].key;
    }
  },
  { immediate: true },
);

const selectedLayer = computed(() => existingLayers.value.find((L) => L.key === selectedKey.value) ?? null);

/** Collapsible rail toggle — same pattern as /admin/layer-dashboards. */
const layerListOpen = ref(true);

/** Top-level mode: "preview" renders the actual Overview strip with
 *  the operator's in-progress edits applied; "config" shows the
 *  layer-rail + per-layer setup card. */
type Mode = 'preview' | 'config';
const mode = ref<Mode>('config');
</script>

<template>
  <div class="setup">
    <header class="page-head">
      <div>
        <div class="kicker">Admin · Overview setup</div>
        <h1>Per-layer Overview tile</h1>
      </div>
      <div class="head-actions">
        <span v-if="store.lastError && savePhase === 'error'" class="hint err">
          {{ store.lastError }}
        </span>
        <span v-else-if="savePhase === 'saved'" class="hint ok">saved</span>
        <span v-else-if="store.dirty" class="hint dirty">unsaved changes</span>
        <span v-else class="hint">all changes persisted</span>
        <button
          class="sw-btn"
          type="button"
          :disabled="!store.dirty || savePhase === 'saving'"
          @click="onDiscard"
        >Discard</button>
        <button
          class="sw-btn is-primary"
          type="button"
          :disabled="!store.dirty || savePhase === 'saving'"
          @click="onSave"
        >{{ savePhase === 'saving' ? 'Saving…' : 'Save' }}</button>
      </div>
    </header>

    <!-- Mode tabs: Preview shows the whole Overview strip with the
         operator's in-progress edits applied; Config opens the
         layer-rail + per-layer editor. -->
    <nav class="mode-tabs sw-card">
      <button
        class="mode-tab"
        :class="{ on: mode === 'preview' }"
        type="button"
        @click="mode = 'preview'"
      >
        Preview
        <span class="hint">how the Overview will render</span>
      </button>
      <button
        class="mode-tab"
        :class="{ on: mode === 'config' }"
        type="button"
        @click="mode = 'config'"
      >
        Config
        <span class="hint">edit metrics, aggregation, MQE</span>
      </button>
    </nav>

    <div v-if="!oapReachable && !isLoading" class="banner err">
      <strong>OAP unreachable.</strong>
      {{ oapError ?? 'Check that the OAP query host is up and reachable from the BFF.' }}
    </div>

    <div v-if="existingLayers.length === 0 && !isLoading" class="empty">
      <div class="empty-card">
        <div class="empty-icon">○</div>
        <h2>No layer dashboards configured</h2>
        <p>
          Setup only lists layers with a dashboard template (an
          <code>overview.metrics</code> or <code>layer-header.columns</code> block in
          <code>apps/bff/src/layers/config/&lt;key&gt;.json</code>). Define one, or edit a
          loaded template under /admin/layer-dashboards.
        </p>
      </div>
    </div>

    <!-- Preview mode: render the EXACT same component the live
         Overview page uses, fed the same layer source. Tiles read
         from the setup store, so in-progress edits show up here
         immediately — what you see here is what /overview will
         render after Save. -->
    <div v-else-if="mode === 'preview'" class="preview-pane">
      <OverviewBody
        :layers="previewOrder"
        :show-overflow-note="false"
        :show-alarms="true"
        :disable-tile-links="true"
      />
      <p class="preview-note">
        Live preview — values come from OAP; tile structure (cells, labels, units,
        aggregation, group sizes) reflects your unsaved edits. Switch to Config to edit.
        Each Overview group is one tile; auto groups take a wide slot, square groups take a
        compact slot.
      </p>
    </div>

    <div v-else class="grid" :class="{ 'list-collapsed': !layerListOpen }">
      <aside class="sw-card layer-list" :class="{ collapsed: !layerListOpen }">
        <div class="list-head">
          <button
            class="list-toggle"
            type="button"
            :title="layerListOpen ? 'Collapse the layers list' : 'Expand the layers list'"
            @click="layerListOpen = !layerListOpen"
          >
            <span class="caret" :class="{ open: layerListOpen }">›</span>
          </button>
          <h4 v-if="layerListOpen">Layers</h4>
          <span v-if="layerListOpen" class="sub">
            {{ existingLayers.length }} configured · priority order
          </span>
        </div>
        <template v-if="layerListOpen">
          <button
            v-for="L in existingLayers"
            :key="L.key"
            class="layer-row"
            :class="{ active: selectedKey === L.key }"
            @click="selectedKey = L.key"
          >
            <span class="dot" :style="{ background: L.color || 'var(--sw-fg-3)' }" />
            <span class="name">{{ L.name }}</span>
            <span class="count">{{ L.serviceCount >= 0 ? L.serviceCount : '—' }}</span>
          </button>
        </template>
        <template v-else>
          <button
            v-for="L in existingLayers"
            :key="L.key"
            class="layer-row collapsed-row"
            :class="{ active: selectedKey === L.key }"
            :title="L.name"
            @click="selectedKey = L.key"
          >
            <span class="dot" :style="{ background: L.color || 'var(--sw-fg-3)' }" />
          </button>
        </template>
      </aside>

      <main class="detail">
        <LayerSetupCard
          v-if="selectedLayer"
          :key="selectedLayer.key"
          :layer="selectedLayer"
          :expanded="true"
        />
      </main>
    </div>
  </div>
</template>

<style scoped>
.setup {
  padding: 20px 20px 60px;
  max-width: 1440px;
  margin: 0 auto;
}
.page-head {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 18px;
}
.page-head > div:first-child {
  flex: 1;
  min-width: 0;
}
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
  margin: 0;
}
.head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.head-actions .hint {
  font-size: 10.5px;
  color: var(--sw-fg-3);
  font-variant-numeric: tabular-nums;
}
.head-actions .hint.dirty { color: var(--sw-warn); }
.head-actions .hint.err { color: #f87171; }
.head-actions .hint.ok { color: var(--sw-ok); }

.mode-tabs {
  display: flex;
  padding: 4px;
  gap: 2px;
  margin-bottom: 14px;
}
.mode-tab {
  flex: 1;
  padding: 8px 14px;
  background: transparent;
  border: none;
  border-radius: 5px;
  color: var(--sw-fg-2);
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  display: inline-flex;
  align-items: baseline;
  justify-content: center;
  gap: 8px;
}
.mode-tab .hint {
  font-size: 10.5px;
  color: var(--sw-fg-3);
  font-weight: 400;
}
.mode-tab:hover {
  background: var(--sw-bg-2);
  color: var(--sw-fg-1);
}
.mode-tab.on {
  background: var(--sw-accent-soft);
  color: var(--sw-accent-2);
  font-weight: 600;
}
.mode-tab.on .hint { color: var(--sw-accent-2); opacity: 0.75; }

/* Preview pane wraps the shared OverviewBody — strip + alarms styles
 * live there so the preview reads identical to the real page. */
.preview-pane {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.preview-note {
  font-size: 10.5px;
  color: var(--sw-fg-3);
  margin: 4px 0 0;
}

/* Per-group size is now configured per-tile in the Config tab; the
 * Preview tab just renders the result, no strip-wide toggle. */

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
.empty-icon {
  font-size: 36px;
  color: var(--sw-fg-3);
  margin-bottom: 6px;
}
.empty-card h2 {
  font-size: 15px;
  color: var(--sw-fg-0);
  margin: 0 0 6px;
}
.empty-card p {
  font-size: 12px;
  color: var(--sw-fg-2);
  margin: 0;
}

.grid {
  display: grid;
  grid-template-columns: 220px 1fr;
  gap: 14px;
  align-items: start;
  transition: grid-template-columns 160ms ease;
}
.grid.list-collapsed {
  grid-template-columns: 36px 1fr;
}
.layer-list {
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-self: start;
  position: sticky;
  top: 16px;
}
.layer-list.collapsed {
  padding: 6px 4px;
}
.list-head {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px 10px;
  border-bottom: 1px solid var(--sw-line);
  margin-bottom: 6px;
}
.layer-list.collapsed .list-head {
  border-bottom: 1px solid var(--sw-line);
  padding: 4px 0 6px;
  justify-content: center;
}
.list-head h4 {
  margin: 0;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--sw-fg-0);
}
.list-head .sub {
  font-size: 10px;
  color: var(--sw-fg-3);
  margin-left: auto;
}
.list-toggle {
  flex: 0 0 auto;
  width: 22px;
  height: 22px;
  margin-right: 4px;
  background: transparent;
  border: none;
  color: var(--sw-fg-3);
  cursor: pointer;
  font: inherit;
  border-radius: 3px;
  display: inline-grid;
  place-items: center;
}
.list-toggle:hover {
  background: var(--sw-bg-2);
  color: var(--sw-fg-1);
}
.list-toggle .caret {
  display: inline-block;
  font-size: 13px;
  line-height: 1;
  transition: transform 0.15s;
}
.list-toggle .caret.open {
  transform: rotate(90deg);
}
.layer-list.collapsed .list-toggle {
  margin-right: 0;
}
.layer-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 5px;
  background: transparent;
  border: none;
  color: var(--sw-fg-1);
  font-size: 12px;
  cursor: pointer;
  text-align: left;
  font: inherit;
}
.layer-row:hover { background: var(--sw-bg-2); }
.layer-row.active {
  background: var(--sw-bg-3);
  color: var(--sw-fg-0);
  box-shadow: inset 2px 0 0 var(--sw-accent);
}
.layer-row .dot {
  width: 7px; height: 7px;
  border-radius: 50%;
  flex: 0 0 7px;
}
.layer-row .name {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.layer-row .count {
  font-family: var(--sw-mono);
  font-size: 10px;
  color: var(--sw-fg-3);
}
.layer-row.active .count {
  color: var(--sw-fg-2);
}
.collapsed-row {
  justify-content: center;
  padding: 6px 4px;
}
.collapsed-row .dot {
  width: 10px;
  height: 10px;
}

.detail {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}
</style>
