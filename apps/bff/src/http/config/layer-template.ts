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

const adminTemplateSchema = z.object({
  key: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  alias: z.string().optional(),
  color: z.string().optional(),
  documentLink: z.string().optional(),
  slots: z
    .object({
      services: z.string().optional(),
      instances: z.string().optional(),
      endpoints: z.string().optional(),
      endpointDependency: z.string().optional(),
    })
    .strict(),
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
    })
    .strict(),
  metrics: z
    .object({
      orderBy: z.string().optional(),
      columns: z
        .array(
          z.object({
            metric: z.string().min(1),
            label: z.string(),
            unit: z.string().optional(),
            mqe: z.string().optional(),
            aggregation: z.enum(['sum', 'avg']).optional(),
            scale: z.number().finite().optional(),
            precision: z.number().int().min(0).max(6).optional(),
          }),
        )
        .max(5)
        .optional(),
    })
    .strict(),
  overview: z
    .object({
      throughput: z.string().optional(),
      spark: z.string().optional(),
    })
    .strict()
    .optional(),
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
    .strict()
    .optional(),
  widgets: z.array(widgetSchema).max(40).optional(),
  naming: z
    .object({
      pattern: z.string().min(1),
      flags: z.string().optional(),
      displayGroup: z.string().optional(),
      valueGroup: z.string().optional(),
      alias: z.string().min(1),
    })
    .strict()
    .optional(),
});

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
