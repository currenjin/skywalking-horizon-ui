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
 * Wire types for the per-dashboard Overview pages.
 *
 * Overview config is stored OUTSIDE the layer JSONs: operators
 * define one or more "overview dashboards" (e.g. *General service*,
 * *Mesh service*) in standalone files under
 * `apps/bff/src/bundled_templates/overviews/*.json`. Each dashboard is a list
 * of widgets, and each widget targets a specific layer. This keeps
 * the layer JSONs focused on per-layer concerns and lets one
 * dashboard pull metrics from multiple layers (e.g. an overview
 * combining General service metrics with Kubernetes service counts).
 *
 * Widget types:
 *   - `service-count` — count of services reporting on the layer.
 *   - `metric`        — an MQE expression evaluated layer-wide.
 *   - `topology`      — the service-map graph for the layer.
 *
 * The layout uses the same 12-col / `span` + `rowSpan` model as the
 * per-layer dashboard, so the same renderer can place these widgets
 * on a grid.
 */

export type OverviewWidgetType = 'service-count' | 'metric' | 'topology';

export interface OverviewWidget {
  /** Stable id, unique within the dashboard. */
  id: string;
  /** Card title shown above the widget. */
  title: string;
  /** Optional one-line hint shown next to the title. */
  tip?: string;
  /** Which layer this widget pulls from. Upper-snake to match
   *  OAP's layer enum (`GENERAL`, `MESH`, `K8S_SERVICE`, …). */
  layer: string;
  /** Widget kind. See module docs. */
  type: OverviewWidgetType;
  /** For `metric` widgets — MQE expression evaluated layer-wide. */
  mqe?: string;
  /** Display unit. */
  unit?: string;
  /** `sum` for throughput-shaped metrics, `avg` otherwise. */
  aggregation?: 'sum' | 'avg';
  /** Grid span in 12-col grid. */
  span?: number;
  /** Grid row span. */
  rowSpan?: number;
}

export interface OverviewDashboard {
  /** Stable id, used in routes (`/overview/:id`). */
  id: string;
  /** Display title. */
  title: string;
  /** Optional description shown in the dashboard header. */
  description?: string;
  /** Ordered list of widgets. */
  widgets: OverviewWidget[];
}

/** Bundle returned by `GET /api/overview/dashboards`. */
export interface OverviewDashboardListResponse {
  generatedAt: number;
  dashboards: Array<{
    id: string;
    title: string;
    description?: string;
    widgetCount: number;
  }>;
}

/** Single dashboard returned by `GET /api/overview/dashboards/:id`. */
export interface OverviewDashboardResponse {
  generatedAt: number;
  dashboard: OverviewDashboard;
  reachable: boolean;
  error?: string;
}

/** Wire shape for one resolved widget value when the BFF runs
 *  `POST /api/overview/dashboards/:id/data` (out of scope for the
 *  first cut — the SPA will fetch widget data widget-by-widget). */
export interface OverviewWidgetResult {
  id: string;
  /** For `service-count` and `metric` — single value. */
  value?: number | null;
  /** For `topology` — the topology response is returned via the
   *  existing `/api/layer/:key/topology` route directly. This block
   *  carries only widget metadata. */
  error?: string;
}
