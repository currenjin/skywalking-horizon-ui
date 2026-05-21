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
  Per-session conflict prompt. When the operator lands with templates
  that diverge between the local bundled copy and the OAP-stored remote
  copy, ask once which version to render: their LOCAL (unpublished) edits
  or the REMOTE (live) version. The choice is global and per login
  session (reset on login). Until chosen, the runtime defaults to remote.
-->
<script setup lang="ts">
import { computed, ref } from 'vue';
import Modal from '@/features/operate/_shared/Modal.vue';
import { useConfigBundle, setTemplateRenderMode, refreshConfigBundle } from '@/controls/configBundle';
import { useTemplatePreference } from '@/controls/templatePreference';
import { useLayers } from '@/shell/useLayers';
import { bffClient } from '@/api/client';

const { bundle } = useConfigBundle();
const pref = useTemplatePreference();
const { layers } = useLayers();

/** Diverged templates named from the operator's MENU perspective —
 *  the layer's sidebar label / overview title, not the template file. */
const divergedItems = computed<string[]>(() => {
  const badges = (bundle.value?.syncStatus?.badges ?? []).filter((b) => b.status === 'diverged');
  const overviews = bundle.value?.overviews ?? [];
  return badges.map((b) => {
    if (b.kind === 'layer') {
      const L = layers.value.find((l) => l.key.toUpperCase() === b.key.toUpperCase());
      return L?.name ? `Layer · ${L.name}` : `Layer · ${b.key}`;
    }
    if (b.kind === 'overview') {
      const ov = overviews.find((o) => o.id === b.key);
      return ov?.title ? `Overview · ${ov.title}` : `Overview · ${b.key}`;
    }
    return b.key;
  });
});
const divergedCount = computed(() => divergedItems.value.length);
const open = computed(() => pref.mode === null && divergedCount.value > 0);

// Second step shown when the operator picks "use live" — overriding the
// local edits with the remote version is destructive, so it's confirmed.
const confirmingRemote = ref(false);
const busy = ref(false);

async function useLocal(): Promise<void> {
  await setTemplateRenderMode('local');
}

// Override local with remote: discard the local edits (revert bundled to
// the live version), then render remote.
async function useLive(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    await bffClient.templateSync.revertLocal();
    await refreshConfigBundle();
    pref.set('remote');
  } finally {
    busy.value = false;
    confirmingRemote.value = false;
  }
}
</script>

<template>
  <Modal
    :open="open"
    :dismissable="false"
    :title="confirmingRemote ? 'Use the live version?' : 'Template versions differ from OAP'"
  >
    <div v-if="!confirmingRemote" class="tcp">
      <p class="tcp__lede">
        <b>{{ divergedCount }}</b> dashboard{{ divergedCount === 1 ? '' : 's' }} differ between the
        version OAP currently serves (<b>remote / live</b>) and your <b>local</b> copy — OAP may have
        newer changes, or you have unpublished local edits. Which should this session render?
      </p>
      <ul class="tcp__list">
        <li v-for="(name, i) in divergedItems" :key="i">{{ name }}</li>
      </ul>
      <ul class="tcp__opts">
        <li><b>Local</b> — preview your unpublished edits. Nothing is sent to OAP; publish later with “Sync all to OAP”.</li>
        <li><b>Remote</b> — show the live version everyone else sees. Your local edits stay on disk, unpublished.</li>
      </ul>
    </div>
    <div v-else class="tcp">
      <p class="tcp__lede tcp__warn">
        OAP holds a different version. Using live will <b>overwrite your
        {{ divergedCount }} local change{{ divergedCount === 1 ? '' : 's' }}</b> with the remote
        version — your local edits are <b>discarded and cannot be recovered</b>. Publish them with
        “Sync all to OAP” instead if you want to keep them. Override local with live?
      </p>
    </div>

    <template #footer>
      <template v-if="!confirmingRemote">
        <button class="sw-btn" type="button" @click="confirmingRemote = true">Use live (remote)</button>
        <button class="sw-btn primary" type="button" @click="useLocal">Keep my local edits</button>
      </template>
      <template v-else>
        <button class="sw-btn" type="button" :disabled="busy" @click="confirmingRemote = false">Back</button>
        <button class="sw-btn danger" type="button" :disabled="busy" @click="useLive">
          {{ busy ? 'Overriding…' : 'Overwrite local with live' }}
        </button>
      </template>
    </template>
  </Modal>
</template>

<style scoped>
.tcp { padding: 4px 2px; }
.tcp__lede { margin: 0 0 10px; font-size: 12.5px; color: var(--sw-fg-1); line-height: 1.55; }
.tcp__warn { color: var(--sw-fg-1); }
.tcp__warn b { color: var(--sw-err); }
.tcp__list {
  margin: 0 0 12px;
  padding: 8px 10px 8px 24px;
  max-height: 30vh;
  overflow: auto;
  border: 1px solid var(--sw-line);
  border-radius: 6px;
  background: var(--sw-bg-2);
  font-size: 11.5px;
  color: var(--sw-fg-1);
  line-height: 1.6;
}
.tcp__opts { margin: 0; padding-left: 18px; font-size: 11.5px; color: var(--sw-fg-2); line-height: 1.6; }
.tcp__opts b { color: var(--sw-fg-0); }
</style>
