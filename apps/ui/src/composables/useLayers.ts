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

import { computed } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import type { LayerDef } from '@skywalking-horizon-ui/api-client';
import { bffClient } from '@/api/client';

/**
 * Live OAP-driven layer + menu state. Fed by `GET /api/menu`. Refetches on
 * window focus + every 60s.
 *
 * `data.value` is `null` while loading. `oapReachable` is false when the
 * BFF returned a soft-fail body (OAP down); the UI should render a banner
 * but otherwise keep the empty layer list rendered without crashing.
 */
export function useLayers() {
  const q = useQuery({
    queryKey: ['menu'],
    queryFn: () => bffClient.menu(),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const layers = computed<LayerDef[]>(() => q.data.value?.layers ?? []);
  const activeLayers = computed<LayerDef[]>(() => layers.value.filter((L) => L.active));
  const oapReachable = computed<boolean>(() => q.data.value?.oap.reachable ?? false);
  const oapError = computed<string | undefined>(() => q.data.value?.oap.error);

  function findLayer(key: string | undefined): LayerDef | undefined {
    if (!key) return undefined;
    return layers.value.find((L) => L.key === key);
  }

  /**
   * `caps.serviceMap || caps.instanceTopology || caps.processTopology`.
   * Pulled out of `layers.ts` so the sidebar can stay UI-only.
   */
  function hasTopology(L: LayerDef | undefined): boolean {
    if (!L) return false;
    return Boolean(L.caps.serviceMap || L.caps.instanceTopology || L.caps.processTopology);
  }

  return {
    isLoading: q.isLoading,
    isError: q.isError,
    layers,
    activeLayers,
    oapReachable,
    oapError,
    findLayer,
    hasTopology,
    refetch: q.refetch,
  };
}
