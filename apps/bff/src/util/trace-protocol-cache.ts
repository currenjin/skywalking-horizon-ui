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
 * Tiny per-process cache for the native trace-query-API probe.
 *
 * OAP exposes two native trace queries. The Trace Query v2 API
 * (`queryTraces`) returns the list AND the spans inline in a single
 * roundtrip — but OAP only supports it on the BanyanDB storage
 * backend. On every other backend (Elasticsearch, …) it is
 * unavailable, so the BFF uses the Trace Query v1 API
 * (`queryBasicTraces`), which returns trace/segment summaries; the SPA
 * then fetches each detail via `queryTrace(traceId)`.
 *
 * OAP advertises v2 support through the sibling boolean
 * `hasQueryTracesV2Support` (true iff the storage backend is
 * BanyanDB), which we probe once and cache for 5 minutes so an OAP
 * rollover or a backend switch is picked up without an explicit
 * reload.
 *
 * The decision is per OAP target (keyed by `queryUrl`) — when the
 * operator points horizon at a different cluster, the probe runs
 * again.
 */

import { graphqlPost } from '../client/graphql.js';
import type { FetchLike, TraceQueryApi } from '@skywalking-horizon-ui/api-client';

interface CacheEntry {
  api: TraceQueryApi;
  expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60_000;
const cache = new Map<string, CacheEntry>();

interface ProbeOpts {
  queryUrl: string;
  timeoutMs: number;
  fetch?: FetchLike;
  /** Optional basic-auth — same shape as GraphqlOptions so call
   *  sites can pass the same `opts` object through. */
  auth?: { username: string; password: string };
}

const PROBE_QUERY = /* GraphQL */ `
  query ProbeQueryTracesSupport {
    hasQueryTracesV2Support
  }
`;

/**
 * Returns the native trace query the BFF should use against this OAP
 * target. Probes once and caches; falls back to `queryBasicTraces` on
 * probe failure since it is supported on every storage backend.
 */
export async function detectTraceQueryApi(opts: ProbeOpts): Promise<TraceQueryApi> {
  const now = Date.now();
  const cached = cache.get(opts.queryUrl);
  if (cached && cached.expiresAt > now) return cached.api;
  let api: TraceQueryApi = 'queryBasicTraces';
  try {
    const data = await graphqlPost<{ hasQueryTracesV2Support?: boolean }>(opts, PROBE_QUERY);
    if (data.hasQueryTracesV2Support === true) api = 'queryTraces';
  } catch {
    // Probe failed — an OAP without the field errors the GraphQL out.
    // Cache `queryBasicTraces` (works on every backend) so we don't
    // re-probe on every list call.
  }
  cache.set(opts.queryUrl, { api, expiresAt: now + CACHE_TTL_MS });
  return api;
}

/** Force-invalidate the cache. Wired into the future "Refresh" admin
 *  affordance; not used by the runtime today. */
export function invalidateTraceQueryApiCache(): void {
  cache.clear();
}
