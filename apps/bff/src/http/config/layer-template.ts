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
 * `/api/admin/layer-templates*` — admin CRUD for the per-layer JSON
 * templates that drive the dashboards / service-list / overview blocks.
 *
 *   GET  /api/admin/layer-templates           — list every loaded layer.
 *   POST /api/admin/layer-templates/:key      — write one template back
 *                                                to its JSON file; the
 *                                                in-memory cache is
 *                                                invalidated so the
 *                                                next read sees the new
 *                                                shape immediately.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ConfigSource } from '../../config/loader.js';
import type { SessionStore } from '../../user/sessions.js';
import { requireAuth } from '../../user/middleware.js';
import {
  allLayerTemplates,
  getLayerTemplate,
  writeLayerTemplate,
  type LayerTemplate,
} from '../../logic/layers/loader.js';
import { widgetSchema } from '../query/dashboard.js';

export interface LayerTemplateConfigDeps {
  config: ConfigSource;
  sessions: SessionStore;
}

// One LayerMetricColumn / OverviewMetric / TopologyMetricDef row. The
// columns family across header / overview / topology share the same
// MQE-plus-presentation shape; we extract a base + extend per row type.
const metricColumnSchema = z
  .object({
    id: z.string().optional(),
    metric: z.string().min(1).optional(),
    label: z.string(),
    tip: z.string().optional(),
    unit: z.string().optional(),
    mqe: z.string().optional(),
    aggregation: z.enum(['sum', 'avg']).optional(),
    scale: z.number().finite().optional(),
    precision: z.number().int().min(0).max(6).optional(),
  })
  .passthrough();

// Header config (legacy field name `metrics`, canonical `header`).
const headerSchema = z
  .object({
    orderBy: z.string().optional(),
    columns: z.array(metricColumnSchema).max(8).optional(),
  })
  .passthrough();

// Overview-tile config — `groups` is the canonical shape; the legacy
// fields (`metrics`, `throughput`, `spark`) are preserved so older
// bundled JSONs round-trip cleanly.
const overviewGroupSchema = z
  .object({
    title: z.string(),
    size: z.enum(['auto', 'square']),
    metrics: z.array(metricColumnSchema).max(20),
  })
  .passthrough();
const overviewSchema = z
  .object({
    groups: z.array(overviewGroupSchema).max(10).optional(),
    metrics: z.array(metricColumnSchema).max(20).optional(),
    throughput: z.string().optional(),
    spark: z.string().optional(),
  })
  .passthrough();

// Topology + endpoint-dependency: node + edge metric defs. The role
// field is a string union per TopologyMetricDef; we accept any string
// here so future roles don't break saves.
const topologyMetricSchema = metricColumnSchema.extend({
  role: z.string().optional(),
});
const topologyConfigSchema = z
  .object({
    nodeMetrics: z.array(topologyMetricSchema).max(20).optional(),
    linkServerMetrics: z.array(topologyMetricSchema).max(20).optional(),
    linkClientMetrics: z.array(topologyMetricSchema).max(20).optional(),
  })
  .passthrough();
const endpointDependencyConfigSchema = z
  .object({
    nodeMetrics: z.array(topologyMetricSchema).max(20).optional(),
    linkMetrics: z.array(topologyMetricSchema).max(20).optional(),
  })
  .passthrough();

const tracesConfigSchema = z
  .object({
    source: z.enum(['native', 'zipkin', 'both']).optional(),
  })
  .passthrough();

const logConfigSchema = z
  .object({
    scope: z.enum(['service', 'instance', 'endpoint']).optional(),
    defaultTags: z
      .array(z.object({ key: z.string().min(1), value: z.string() }).passthrough())
      .max(20)
      .optional(),
  })
  .passthrough();

// `.passthrough()` on the outer template AND on `components` keeps the
// schema from silently dropping fields the loader interface knows about
// (visibility, group, topology, endpointDependency, traces, log) or
// from hard-rejecting newer component flags (networkProfiling,
// pprofProfiling) that bundled JSONs use today. Adding a new flag in
// `LayerComponentFlags` no longer requires a schema bump to ship.
const adminTemplateSchema = z
  .object({
    key: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    alias: z.string().optional(),
    group: z.string().optional(),
    visibility: z.enum(['public', 'operate']).optional(),
    color: z.string().optional(),
    documentLink: z.string().optional(),
    slots: z
      .object({
        services: z.string().optional(),
        instances: z.string().optional(),
        endpoints: z.string().optional(),
        endpointDependency: z.string().optional(),
      })
      .passthrough(),
    components: z
      .object({
        service: z.boolean().optional(),
        instances: z.boolean().optional(),
        endpoints: z.boolean().optional(),
        endpointDependency: z.boolean().optional(),
        topology: z.boolean().optional(),
        traces: z.boolean().optional(),
        logs: z.boolean().optional(),
        traceProfiling: z.boolean().optional(),
        ebpfProfiling: z.boolean().optional(),
        asyncProfiling: z.boolean().optional(),
        networkProfiling: z.boolean().optional(),
        pprofProfiling: z.boolean().optional(),
      })
      .passthrough(),
    // Accept both `header` (canonical) and `metrics` (legacy alias).
    header: headerSchema.optional(),
    metrics: headerSchema.optional(),
    overview: overviewSchema.optional(),
    dashboards: z
      .object({
        service: z.array(widgetSchema).max(40).optional(),
        instance: z.array(widgetSchema).max(40).optional(),
        endpoint: z.array(widgetSchema).max(40).optional(),
        dependency: z.array(widgetSchema).max(40).optional(),
        topology: z.array(widgetSchema).max(40).optional(),
        trace: z.array(widgetSchema).max(40).optional(),
        logs: z.array(widgetSchema).max(40).optional(),
        traceProfiling: z.array(widgetSchema).max(40).optional(),
        ebpfProfiling: z.array(widgetSchema).max(40).optional(),
        asyncProfiling: z.array(widgetSchema).max(40).optional(),
      })
      .passthrough()
      .optional(),
    widgets: z.array(widgetSchema).max(40).optional(),
    topology: topologyConfigSchema.optional(),
    endpointDependency: endpointDependencyConfigSchema.optional(),
    traces: tracesConfigSchema.optional(),
    log: logConfigSchema.optional(),
    naming: z
      .object({
        pattern: z.string().min(1),
        flags: z.string().optional(),
        displayGroup: z.string().optional(),
        valueGroup: z.string().optional(),
        alias: z.string().min(1),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export function registerLayerTemplateRoutes(
  app: FastifyInstance,
  deps: LayerTemplateConfigDeps,
): void {
  const auth = requireAuth(deps);
  app.get('/api/admin/layer-templates', { preHandler: auth }, async (_req, reply) => {
    return reply.send({ templates: allLayerTemplates() });
  });

  app.post(
    '/api/admin/layer-templates/:key',
    { preHandler: auth },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const params = req.params as { key: string };
      const layerKey = params.key.toUpperCase();
      const parsed = adminTemplateSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_template', detail: parsed.error.flatten() });
      }
      if (parsed.data.key.toUpperCase() !== layerKey) {
        return reply
          .code(400)
          .send({ error: 'key_mismatch', detail: 'URL key does not match body key' });
      }
      try {
        writeLayerTemplate(parsed.data as LayerTemplate);
      } catch (err) {
        return reply.code(500).send({
          error: 'write_failed',
          detail: err instanceof Error ? err.message : String(err),
        });
      }
      const refreshed = getLayerTemplate(layerKey);
      return reply.send({ template: refreshed });
    },
  );
}
