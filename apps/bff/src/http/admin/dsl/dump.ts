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
 *   GET /api/dump             — dump every catalog (zipped).
 *   GET /api/dump/:catalog    — dump one catalog. Streams the upstream
 *                                response straight through.
 *
 * Gated on `rule:read`; response is a passthrough of OAP's content-type
 * and content-disposition so the browser's save-as dialog works.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isCatalog, type Catalog } from '@skywalking-horizon-ui/api-client';
import { requireAuth } from '../../../user/middleware.js';
import {
  type DslRouteDeps,
  ensureVerb,
  makeClients,
  passOapError,
} from './_shared.js';

export function registerDslDumpRoutes(app: FastifyInstance, deps: DslRouteDeps): void {
  const auth = requireAuth(deps);
  const clients = makeClients(deps);

  const dumpHandler = (catalog: Catalog | null) =>
    async function (req: FastifyRequest, reply: FastifyReply) {
      if (!ensureVerb(req, reply, deps, 'rule:read')) return;
      try {
        const upstream = await clients()
          .primary()
          .dump(catalog ?? undefined);
        const ct = upstream.headers.get('content-type') ?? 'application/octet-stream';
        const cd = upstream.headers.get('content-disposition');
        reply.header('content-type', ct);
        if (cd) reply.header('content-disposition', cd);
        return reply.send(upstream.body ?? '');
      } catch (err) {
        return passOapError(err, reply);
      }
    };

  app.get('/api/dump', { preHandler: auth }, dumpHandler(null));

  app.get(
    '/api/dump/:catalog',
    { preHandler: auth },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const params = req.params as { catalog: string };
      if (!isCatalog(params.catalog)) {
        return reply.code(400).send({ error: 'invalid_catalog', value: params.catalog });
      }
      return dumpHandler(params.catalog)(req, reply);
    },
  );
}
