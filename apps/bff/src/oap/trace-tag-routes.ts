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
 * Trace tag autocomplete routes:
 *   GET /api/trace-tags/keys?windowMinutes=30
 *   GET /api/trace-tags/values?key=<k>&windowMinutes=30
 *
 * Both wrap OAP's `queryTraceTagAutocompleteKeys` /
 * `queryTraceTagAutocompleteValues` GraphQL endpoints. Same pattern
 * as booster-ui's `ConditionTags.vue` — operator types in the trace
 * tab's Tag input, the suggestions list narrows.
 */

import type { FetchLike } from '@skywalking-horizon-ui/api-client';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ConfigSource } from '../config/loader.js';
import type { SessionStore } from '../auth/sessions.js';
import { requireAuth } from '../auth/middleware.js';
import { buildOapOpts, graphqlPost } from './graphql-client.js';

export interface TraceTagRouteDeps {
  config: ConfigSource;
  sessions: SessionStore;
  fetch?: FetchLike;
}

const DEFAULT_WINDOW_MIN = 30;
const MAX_WINDOW_MIN = 60 * 24 * 7;
function fmtMinute(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
}
function rollingWindow(minutes: number): { start: string; end: string; step: 'MINUTE' } {
  const m = Math.max(1, Math.min(MAX_WINDOW_MIN, Math.round(minutes)));
  const end = new Date();
  const start = new Date(end.getTime() - m * 60_000);
  return { start: fmtMinute(start), end: fmtMinute(end), step: 'MINUTE' };
}

const KEYS_QUERY = /* GraphQL */ `
  query TagKeys($duration: Duration!) {
    keys: queryTraceTagAutocompleteKeys(duration: $duration)
  }
`;
const VALUES_QUERY = /* GraphQL */ `
  query TagValues($tagKey: String!, $duration: Duration!) {
    values: queryTraceTagAutocompleteValues(tagKey: $tagKey, duration: $duration)
  }
`;

export function registerTraceTagRoutes(app: FastifyInstance, deps: TraceTagRouteDeps): void {
  const auth = requireAuth(deps);

  app.get(
    '/api/trace-tags/keys',
    { preHandler: auth },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const q = req.query as { windowMinutes?: string };
      const m = q.windowMinutes ? Number(q.windowMinutes) : DEFAULT_WINDOW_MIN;
      const duration = rollingWindow(Number.isFinite(m) ? m : DEFAULT_WINDOW_MIN);
      const opts = buildOapOpts(deps.config.current, deps.fetch);
      try {
        const env = await graphqlPost<{ keys: string[] | null }>(opts, KEYS_QUERY, { duration });
        return reply.send({ keys: env.keys ?? [], generatedAt: Date.now() });
      } catch (err) {
        return reply
          .code(200)
          .send({ keys: [], generatedAt: Date.now(), error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.get(
    '/api/trace-tags/values',
    { preHandler: auth },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const q = req.query as { key?: string; windowMinutes?: string };
      const key = (q.key ?? '').trim();
      if (!key) return reply.code(400).send({ error: 'missing_key' });
      const m = q.windowMinutes ? Number(q.windowMinutes) : DEFAULT_WINDOW_MIN;
      const duration = rollingWindow(Number.isFinite(m) ? m : DEFAULT_WINDOW_MIN);
      const opts = buildOapOpts(deps.config.current, deps.fetch);
      try {
        const env = await graphqlPost<{ values: string[] | null }>(opts, VALUES_QUERY, {
          tagKey: key,
          duration,
        });
        return reply.send({ key, values: env.values ?? [], generatedAt: Date.now() });
      } catch (err) {
        return reply
          .code(200)
          .send({
            key,
            values: [],
            generatedAt: Date.now(),
            error: err instanceof Error ? err.message : String(err),
          });
      }
    },
  );
}
