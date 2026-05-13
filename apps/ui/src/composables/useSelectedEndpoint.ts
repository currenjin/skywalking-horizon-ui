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
 * Page-wide selected-endpoint state. Mirrors `useSelectedInstance`:
 * URL-backed (`?endpoint=<name>`) so the choice is shareable and
 * survives a reload. The Endpoint scope's widget queries thread this
 * value to the BFF; other scopes ignore it.
 */

import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';

export function useSelectedEndpoint() {
  const route = useRoute();
  const router = useRouter();

  const selectedEndpoint = computed<string | null>(() => {
    const v = route.query.endpoint;
    if (typeof v === 'string' && v.length > 0) return v;
    return null;
  });

  function setSelectedEndpoint(name: string | null): void {
    const next = { ...route.query };
    if (name) next.endpoint = name;
    else delete next.endpoint;
    void router.replace({ path: route.path, query: next });
  }

  return { selectedEndpoint, setSelectedEndpoint };
}
