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
 * Reactive list of instances for a (layer, service). Backs the
 * instance selector on the per-layer Instance page. Disabled until
 * both inputs are non-empty so the SPA doesn't fire a request the
 * BFF would reject as `missing_service`.
 */

import { computed, watch, type Ref } from 'vue';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { bffClient } from '@/api/client';

const INSTANCES_STALE_MS = 60_000;

export function useLayerInstances(layerKey: Ref<string>, service: Ref<string | null>) {
  const q = useQuery({
    queryKey: ['layer-instances', layerKey, service],
    queryFn: () => bffClient.layer.instances(layerKey.value, service.value ?? ''),
    enabled: computed(() => layerKey.value.length > 0 && !!service.value),
    staleTime: INSTANCES_STALE_MS,
  });
  return {
    data: computed(() => q.data.value ?? null),
    instances: computed(() => q.data.value?.instances ?? []),
    isLoading: q.isLoading,
    isFetching: q.isFetching,
    error: q.error,
  };
}

/**
 * Background pre-fetch of instance lists for every service in the
 * supplied list. Run after the landing rows arrive so the operator's
 * very next service-switch click finds the new service's instance
 * list already in cache — eliminating the ~100-500ms BFF round-trip
 * that otherwise gates the dashboard refire.
 *
 * Uses vue-query's `prefetchQuery` so each fetch goes through the
 * SAME cache key as `useLayerInstances`. The active picker call
 * then hits the cache instantly with no duplicate request. Skips
 * services we already have cached + not stale.
 *
 * Idempotent (queryClient.prefetchQuery dedups in-flight requests
 * by key) and tied to the calling scope's watch so it re-runs when
 * the layer or service list changes (e.g. when the operator
 * navigates to a different layer or hits the refresh button).
 */
export function usePrefetchLayerInstances(
  layerKey: Ref<string>,
  serviceIds: Ref<ReadonlyArray<string>>,
): void {
  const qc = useQueryClient();
  watch(
    [layerKey, serviceIds],
    ([key, ids]) => {
      if (!key) return;
      for (const id of ids) {
        if (!id) continue;
        // Plain values in the key — vue-query serialises refs by
        // their resolved .value, so this hashes to the same slot as
        // the active `useLayerInstances` queryKey for the same
        // (layerKey, id) pair.
        void qc.prefetchQuery({
          queryKey: ['layer-instances', key, id],
          queryFn: () => bffClient.layer.instances(key, id),
          staleTime: INSTANCES_STALE_MS,
        });
      }
    },
    { immediate: true },
  );
}
