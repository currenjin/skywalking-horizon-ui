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
import { onMounted, onBeforeUnmount } from 'vue';

const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    /** Panel width — any CSS length. Defaults to the narrow form dialog;
     *  wide surfaces (side-by-side diffs) pass e.g. `80vw`. */
    width?: string;
    /** When true the body becomes a flex column with no scroll of its
     *  own — a child marked `flex: 1` (e.g. a diff editor) absorbs the
     *  leftover height and scrolls internally, so the popout never grows
     *  a vertical scrollbar. */
    fitBody?: boolean;
  }>(),
  { width: '520px', fitBody: false },
);

const emit = defineEmits<{ close: [] }>();

function onKey(e: KeyboardEvent): void {
  if (props.open && e.key === 'Escape') emit('close');
}

onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal" role="dialog" aria-modal="true" @click.self="emit('close')">
      <div class="modal__panel" :class="{ 'modal__panel--fit': fitBody }" :style="{ width: props.width }">
        <header class="modal__header">
          <span class="modal__title">{{ title }}</span>
          <button
            type="button"
            class="modal__close"
            aria-label="close"
            @click="emit('close')"
          >
            ×
          </button>
        </header>
        <div class="modal__body" :class="{ 'modal__body--fit': fitBody }"><slot /></div>
        <footer v-if="$slots.footer" class="modal__footer"><slot name="footer" /></footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal__panel {
  /* width comes from the `width` prop (inline style); this is the
   * fallback for any consumer that doesn't pass one. */
  width: 520px;
  max-width: calc(100vw - 32px);
  background: var(--rr-bg2);
  border: 1px solid var(--rr-border);
  border-radius: var(--rr-radius-lg);
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 64px);
  overflow: hidden;
}
/* Fit mode: take a concrete height so the flex body can fill it and the
 * diff child can claim the slack. */
.modal__panel--fit {
  height: calc(100vh - 64px);
}

.modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: var(--rr-bg3);
  border-bottom: 1px solid var(--rr-border);
}

.modal__title {
  font-family: var(--rr-font-mono);
  font-size: 12px;
  letter-spacing: 0.4px;
  color: var(--rr-heading);
}

.modal__close {
  background: transparent;
  border: none;
  color: var(--rr-dim);
  font-size: 14px;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
}
.modal__close:hover {
  color: var(--rr-ink);
}

.modal__body {
  padding: 16px;
  overflow: auto;
  font-size: 13px;
  color: var(--rr-ink);
}
/* Fit mode: fill the panel height, no own scroll — a `flex: 1` child
 * (e.g. the diff editor) takes the slack and scrolls internally. */
.modal__body--fit {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.modal__footer {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  padding: 12px 16px;
  border-top: 1px solid var(--rr-border);
  background: var(--rr-bg);
}
</style>
