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
import { useOapInfo } from '@/composables/useOapInfo';

// Early preview of the Cluster Status page. Surfaces the OAP version,
// timezone, server clock and health score now; the full module-activity
// matrix / storage health / config-tree / TTL grid lands in Phase 6/7
// (see docs/design/system-status.md).
const { info, reachable, version, tzOffsetLabel, healthState, healthScore } = useOapInfo();

const serverClockLocal = computed<string>(() => {
  const ts = info.value?.currentTimestamp;
  if (!ts) return '—';
  return new Date(ts).toLocaleString();
});

const localTzLabel = computed<string>(() => {
  const offMin = -new Date().getTimezoneOffset();
  const sign = offMin >= 0 ? '+' : '-';
  const abs = Math.abs(offMin);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return m === 0 ? `UTC${sign}${h}` : `UTC${sign}${h}:${String(m).padStart(2, '0')}`;
});

const healthLabel = computed<string>(() => {
  if (!reachable.value) return 'unreachable';
  if (healthScore.value === undefined) return 'unknown';
  if (healthScore.value < 0) return 'not started';
  if (healthScore.value > 0) return `degraded (score ${healthScore.value})`;
  return 'healthy';
});
</script>

<template>
  <div class="cluster">
    <header class="page-head">
      <div>
        <div class="kicker">Operate · Cluster status</div>
        <h1>OAP cluster</h1>
        <p class="lede">
          Live view of the OAP backend horizon is connected to.
          The full module-activity matrix, storage health, receiver throughput, effective-config tree
          and TTL grid land in Phase 6&nbsp;/&nbsp;7 — for now this page shows the basics.
        </p>
      </div>
    </header>

    <div class="grid">
      <div class="sw-card kpi">
        <div class="sw-card-head">
          <h4>Version</h4>
          <span class="sw-badge" :class="`is-${healthState}`">
            <span class="state-dot" />{{ healthLabel }}
          </span>
        </div>
        <div class="kpi-body">
          <div class="kpi-value">{{ version ?? '—' }}</div>
          <div class="kpi-label">{{ reachable ? info?.statusUrl : 'OAP unreachable' }}</div>
        </div>
      </div>

      <div class="sw-card kpi">
        <div class="sw-card-head"><h4>Server timezone</h4></div>
        <div class="kpi-body">
          <div class="kpi-value">{{ tzOffsetLabel || '—' }}</div>
          <div class="kpi-label">Browser local: {{ localTzLabel }}</div>
        </div>
      </div>

      <div class="sw-card kpi">
        <div class="sw-card-head"><h4>Server clock</h4></div>
        <div class="kpi-body">
          <div class="kpi-value mono">{{ serverClockLocal }}</div>
          <div class="kpi-label">As seen in your browser timezone</div>
        </div>
      </div>

      <div class="sw-card kpi">
        <div class="sw-card-head"><h4>Health score</h4></div>
        <div class="kpi-body">
          <div class="kpi-value">{{ healthScore ?? '—' }}</div>
          <div class="kpi-label">{{ info?.healthDetails ?? '0 ok · &gt;0 degraded · &lt;0 not started' }}</div>
        </div>
      </div>
    </div>

    <div class="phase-note">
      <strong>Coming in Phase 6&nbsp;/&nbsp;7</strong>
      <ul>
        <li>Per-node cluster map (host/port, role, heartbeat)</li>
        <li>Module activity matrix (module × provider × node)</li>
        <li>Storage backend health (BanyanDB / Elasticsearch / JDBC)</li>
        <li>Receiver activity (gRPC / HTTP / Kafka / OTLP throughput, queue depth)</li>
        <li>Navigable effective-configuration tree with two-node diff</li>
        <li>TTL &amp; retention grid (hot / warm / cold)</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.cluster {
  padding: 20px 20px 60px;
  max-width: 1440px;
  margin: 0 auto;
}
.page-head {
  margin-bottom: 18px;
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
  margin: 0 0 8px;
}
.lede {
  font-size: 12.5px;
  color: var(--sw-fg-1);
  line-height: 1.5;
  margin: 0;
  max-width: 720px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
  margin-bottom: 20px;
}
.kpi {
  display: flex;
  flex-direction: column;
}
.kpi .sw-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.kpi .sw-card-head h4 {
  flex: 1;
}
.kpi-body {
  padding: 14px 12px 14px;
}
.kpi-value {
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--sw-fg-0);
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}
.kpi-value.mono {
  font-family: var(--sw-mono);
  font-size: 14px;
  font-weight: 500;
}
.kpi-label {
  margin-top: 4px;
  font-size: 11px;
  color: var(--sw-fg-2);
}
.sw-badge .state-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  margin-right: 4px;
  display: inline-block;
  vertical-align: middle;
}
.sw-badge.is-ok {
  color: var(--sw-ok);
  background: var(--sw-ok-soft);
  border-color: rgba(34, 197, 94, 0.3);
}
.sw-badge.is-warn {
  color: var(--sw-warn);
  background: var(--sw-warn-soft);
  border-color: rgba(234, 179, 8, 0.3);
}
.sw-badge.is-err {
  color: var(--sw-err);
  background: var(--sw-err-soft);
  border-color: rgba(239, 68, 68, 0.3);
}
.sw-badge.is-unknown {
  color: var(--sw-fg-3);
}
.phase-note {
  background: var(--sw-bg-1);
  border: 1px dashed var(--sw-line-2);
  border-radius: 8px;
  padding: 14px 16px;
}
.phase-note strong {
  display: block;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--sw-accent);
  margin-bottom: 8px;
}
.phase-note ul {
  margin: 0;
  padding-left: 18px;
  color: var(--sw-fg-1);
  font-size: 12px;
  line-height: 1.7;
}
</style>
