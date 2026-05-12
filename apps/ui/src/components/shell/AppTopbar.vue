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
import { computed } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import Icon from '@/components/icons/Icon.vue';
import { useOapInfo } from '@/composables/useOapInfo';

const route = useRoute();

// Trivial breadcrumb derivation from the path. Real breadcrumb metadata
// lands when individual views start setting `route.meta.breadcrumbs`.
const crumbs = computed<string[]>(() => {
  const segs = route.path.split('/').filter(Boolean);
  if (segs.length === 0) return ['Home'];
  return segs.map((s) => s.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()));
});

const { info, reachable, version, tzOffsetLabel, healthState } = useOapInfo();

const oapChipTooltip = computed<string>(() => {
  if (!info.value) return 'OAP status — loading…';
  if (!reachable.value) {
    return `OAP unreachable: ${info.value.error ?? 'no response'}\nFix the upstream and the pill turns green.`;
  }
  const parts: string[] = [];
  if (info.value.version) parts.push(`Version ${info.value.version}`);
  if (tzOffsetLabel.value) parts.push(`Server TZ ${tzOffsetLabel.value}`);
  if (info.value.currentTimestamp) {
    parts.push(`Server clock ${new Date(info.value.currentTimestamp).toLocaleString()} (your local time)`);
  }
  if (info.value.healthScore !== undefined) {
    parts.push(`Health score ${info.value.healthScore} — ${info.value.healthDetails ?? '(no details)'}`);
  }
  return parts.join('\n');
});

const localTzLabel = computed<string>(() => {
  const offMin = -new Date().getTimezoneOffset(); // browser returns inverted sign
  const sign = offMin >= 0 ? '+' : '-';
  const abs = Math.abs(offMin);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return m === 0 ? `UTC${sign}${h}` : `UTC${sign}${h}:${String(m).padStart(2, '0')}`;
});

// True when the user's browser is in a different TZ than the OAP server.
// Time-range queries get converted server-side; the chip flags the gap
// so the operator knows the displayed local time will differ from the
// server's log timestamps.
const { timezone: serverTzMin } = useOapInfo();
const tzMismatch = computed<boolean>(() => {
  if (serverTzMin.value === undefined) return false;
  const browserMin = -new Date().getTimezoneOffset();
  return browserMin !== serverTzMin.value;
});
</script>

<template>
  <header class="sw-top">
    <div class="sw-crumbs">
      <template v-for="(c, i) in crumbs" :key="i">
        <Icon v-if="i > 0" name="chev" :size="10" />
        <b v-if="i === crumbs.length - 1">{{ c }}</b>
        <span v-else>{{ c }}</span>
      </template>
    </div>
    <div class="sw-top-search">
      <Icon name="search" :size="12" />
      <span>Search services, endpoints, traceId&hellip;</span>
      <kbd>⌘K</kbd>
    </div>
    <div class="sw-top-actions">
      <RouterLink class="sw-btn oap-chip" :class="`is-${healthState}`" :title="oapChipTooltip" to="/operate/cluster">
        <span class="dot" />
        <span v-if="reachable && version" class="ver">v{{ version }}</span>
        <span v-else-if="reachable" class="ver">OAP</span>
        <span v-else class="ver">offline</span>
        <span v-if="reachable && tzOffsetLabel" class="tz" :class="{ mismatch: tzMismatch }">
          {{ tzOffsetLabel }}
        </span>
      </RouterLink>
      <div class="sw-btn" :title="`Browser local time · ${localTzLabel}`">
        <Icon name="clock" :size="12" />
        <span>Last 30 minutes</span>
        <Icon name="caret" :size="10" />
      </div>
      <div class="sw-btn is-icon"><Icon name="refresh" :size="12" /></div>
      <div class="sw-btn is-icon"><Icon name="bell" :size="12" /></div>
    </div>
  </header>
</template>

<style scoped>
.oap-chip {
  text-decoration: none;
  font-family: var(--sw-mono);
  font-variant-numeric: tabular-nums;
  font-size: 10.5px;
  gap: 6px;
}
.oap-chip .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  display: inline-block;
}
.oap-chip.is-ok .dot {
  background: var(--sw-ok);
  box-shadow: 0 0 6px 0 rgba(34, 197, 94, 0.55);
}
.oap-chip.is-warn .dot {
  background: var(--sw-warn);
}
.oap-chip.is-err .dot {
  background: var(--sw-err);
  animation: pulse-err 1.6s infinite;
}
.oap-chip.is-unknown .dot {
  background: var(--sw-fg-3);
}
.oap-chip .ver {
  color: var(--sw-fg-0);
  font-weight: 600;
}
.oap-chip .tz {
  color: var(--sw-fg-2);
  padding-left: 4px;
  border-left: 1px solid var(--sw-line-2);
}
.oap-chip .tz.mismatch {
  color: var(--sw-warn);
}
@keyframes pulse-err {
  0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.6); }
  70% { box-shadow: 0 0 0 6px transparent; }
  100% { box-shadow: 0 0 0 0 transparent; }
}
</style>
