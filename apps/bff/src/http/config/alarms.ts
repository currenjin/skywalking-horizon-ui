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
 * `/api/alarms/config` — read + write the alarm-page setup
 * (per-traffic-layer MQE expression list). The `serviceLayer` cache is
 * invalidated on save so the next `GET /api/alarms` picks up any newly
 * configured layer immediately instead of waiting for the 60s TTL.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ConfigSource } from '../../config/loader.js';
import type { SessionStore } from '../../user/sessions.js';
import type { AuditLogger } from '../../audit/logger.js';
import { requireAuth } from '../../user/middleware.js';
import type { ServiceLayerMap } from '../../logic/alarms/service-layer-map.js';
import type { AlarmsStore, AlarmsConfig } from '../../logic/alarms/store.js';

export interface AlarmsConfigRouteDeps {
  config: ConfigSource;
  sessions: SessionStore;
  audit: AuditLogger;
  store: AlarmsStore;
  serviceLayer: ServiceLayerMap;
}

const configSaveSchema = z.object({
  trafficLayers: z
    .array(
      z.object({
        layerKey: z.string().min(1),
        mqe: z.string().min(1),
        label: z.string().optional(),
      }).strict(),
    )
    .max(8),
});

export function registerAlarmsConfigRoutes(
  app: FastifyInstance,
  deps: AlarmsConfigRouteDeps,
): void {
  const auth = requireAuth(deps);

  app.get(
    '/api/alarms/config',
    { preHandler: auth },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      const cfg = await deps.store.load();
      return reply.send(cfg);
    },
  );

  app.post(
    '/api/alarms/config',
    { preHandler: auth },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parsed = configSaveSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_body', detail: parsed.error.flatten() });
      }
      const next: AlarmsConfig = { trafficLayers: parsed.data.trafficLayers };
      await deps.store.save(next);
      deps.serviceLayer.invalidate();
      deps.audit.record({
        action: 'alarms.config.save',
        actor: req.session?.username ?? null,
        outcome: 'ok',
        details: { layers: next.trafficLayers.map((l) => `${l.layerKey}:${l.mqe}`) },
        fromIp: req.ip,
        sessionId: req.session?.sid,
      });
      return reply.send(next);
    },
  );
}
