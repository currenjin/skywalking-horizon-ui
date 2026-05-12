/*
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Maps the short metric keys the UI catalog uses (`cpm`, `p99`,
 * `mq.msg-rate`, …) to the actual MQE expressions OAP understands.
 *
 * For SINGLE_VALUE landing cells (current value per service), we wrap
 * the bare OAP metric name in `avg()` — this is the most defensible
 * default and matches what every booster-ui widget does for the
 * service-scope KPI tiles. Percentile metrics are passed through
 * unwrapped because they're already labeled-value MQE expressions.
 *
 * For TIME_SERIES_VALUES (sparkline), the same expression works — OAP
 * returns one value per bucket when the duration `step` is set.
 *
 * Returns `null` when no mapping exists for the (metric, layer) pair —
 * the BFF then surfaces a `null` value cell and the UI renders an
 * em-dash. Operators can extend the catalog via the Phase 7 admin
 * surface; for now we ship a conservative built-in set.
 */

import type { LandingColumn } from '@skywalking-horizon-ui/api-client';

/**
 * Logical layer-category bucketing — kept in lockstep with the UI's
 * `layerCategory()` in metricCatalog.ts. We keep the table local so the
 * BFF doesn't drag a `@/composables` dep over the package boundary.
 */
function layerCategory(layerKey: string): string {
  const k = layerKey.toLowerCase();
  if (k === 'general') return 'general';
  if (k === 'mesh' || k === 'mesh_cp' || k === 'mesh_dp') return 'mesh';
  if (k === 'k8s' || k === 'k8s_service') return 'k8s';
  if (k === 'browser') return 'browser';
  if (k === 'virtual_genai') return 'genai';
  if (
    k === 'mysql' || k === 'postgresql' || k === 'mongodb' || k === 'elasticsearch' ||
    k === 'redis' || k === 'clickhouse' || k === 'virtual_database' || k === 'virtual_cache'
  ) return 'database';
  if (
    k === 'kafka' || k === 'pulsar' || k === 'rocketmq' || k === 'rabbitmq' ||
    k === 'activemq' || k === 'virtual_mq'
  ) return 'mq';
  return 'general';
}

/**
 * The expression for a generic-RPC metric on the service scope. These
 * match booster-ui's `general-service.json` widget config (cf. OAP's
 * official metrics catalog — `service_cpm`, `service_sla`, etc.). Used
 * for general/mesh/k8s_service layers and as a fallback for unknowns.
 */
const RPC_SERVICE: Record<string, string> = {
  cpm: 'avg(service_cpm)',
  resp: 'avg(service_resp_time)',
  p50: 'service_percentile{p=\'50\'}',
  p75: 'service_percentile{p=\'75\'}',
  p95: 'service_percentile{p=\'95\'}',
  p99: 'service_percentile{p=\'99\'}',
  sla: 'avg(service_sla)/100',
  apdex: 'avg(service_apdex)/10000',
  err: '100 - avg(service_sla)/100',
};

/**
 * Browser-layer expressions. OAP names live in `browser_app_*` for the
 * app (~= service) scope. See `browser-app.json`. We surface a subset
 * relevant to the landing card; the rest can come via admin override.
 */
const BROWSER_SERVICE: Record<string, string> = {
  'browser.pv': 'avg(browser_app_pv)',
  'browser.js-err': 'avg(browser_app_error_sum)',
  err: 'avg(browser_app_error_rate)/100',
  // Page-level metrics aren't service-scope — they bind to endpoint
  // (page) entities. Operators viewing the service card see app-level
  // aggregates; deep-dives happen on the per-layer page.
};

/**
 * Database virtual-service metrics (`virtual_database`). MQ + native
 * database (mysql/postgresql/…) layers have richer per-tech catalogs in
 * OAP — we ship the lowest common denominator here and let admin
 * override land in Phase 7.
 */
const DATABASE_SERVICE: Record<string, string> = {
  cpm: 'avg(service_cpm)',
  resp: 'avg(service_resp_time)',
  p99: 'service_percentile{p=\'99\'}',
  err: '100 - avg(service_sla)/100',
};

/**
 * Virtual-MQ service metrics. Producer/consumer split shows up in
 * topology rather than the service KPI, so we surface CPM (= messages
 * routed) + latency + sla on the card.
 */
const MQ_SERVICE: Record<string, string> = {
  cpm: 'avg(service_cpm)',
  resp: 'avg(service_resp_time)',
  err: '100 - avg(service_sla)/100',
};

/** Per-category lookup tables. Falls back to `RPC_SERVICE`. */
const TABLES: Record<string, Record<string, string>> = {
  general: RPC_SERVICE,
  mesh: RPC_SERVICE,
  k8s: RPC_SERVICE,
  browser: BROWSER_SERVICE,
  database: DATABASE_SERVICE,
  mq: MQ_SERVICE,
  // genai / faas / others — no first-class mapping yet, fall through to
  // RPC_SERVICE so cpm / resp / sla still render.
};

/**
 * Resolve the MQE expression for `(metricKey, layerKey)` on the service
 * scope. Returns `null` when neither the layer table nor the RPC
 * fallback covers the key — callers should treat that as a `null` cell.
 */
export function expressionForServiceMetric(
  metricKey: string,
  layerKey: string,
): string | null {
  const cat = layerCategory(layerKey);
  const table = TABLES[cat] ?? RPC_SERVICE;
  return table[metricKey] ?? RPC_SERVICE[metricKey] ?? null;
}

/**
 * Convenience helper — resolve a list of landing columns to their MQE
 * expressions, keeping the same order. Entries with no mapping become
 * `null`, which the caller maps to a `null` cell rather than firing a
 * GraphQL query.
 */
export function resolveColumnExpressions(
  columns: ReadonlyArray<LandingColumn>,
  layerKey: string,
): Array<{ column: LandingColumn; expression: string | null }> {
  return columns.map((c) => ({
    column: c,
    expression: expressionForServiceMetric(c.metric, layerKey),
  }));
}
