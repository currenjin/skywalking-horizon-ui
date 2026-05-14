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
 * Global trace-id popout coordinator.
 *
 * Any place in the app that knows a SkyWalking trace id (refs in a
 * span detail, a log row's traceId, an alarm payload, …) can call
 * `openTrace(id)` to open a centered modal showing that trace's
 * waterfall. The state is round-tripped through the URL as
 * `?openTraceId=<id>` so links + back/forward + share-URL all work
 * without an extra session store.
 *
 * The popout component itself lives at `components/trace/TracePopout.vue`
 * and is mounted once globally inside `AppShell.vue`. It listens to
 * the same query param and fetches the trace via `useTraceDetail`.
 */

import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';

/** Query-string key. Any URL with this key auto-opens the trace
 *  popout — used for shareable links. The trace-tab list-row click
 *  also writes this key, and the global topbar treats opting-out
 *  routes the same way. */
export const TRACE_POPOUT_QUERY = 'traceId';

export function useTracePopout() {
  const route = useRoute();
  const router = useRouter();

  const openTraceId = computed<string | null>(() => {
    const v = route.query[TRACE_POPOUT_QUERY];
    return typeof v === 'string' && v.length > 0 ? v : null;
  });

  function openTrace(id: string): void {
    if (!id) return;
    void router.push({
      path: route.path,
      query: { ...route.query, [TRACE_POPOUT_QUERY]: id },
    });
  }

  function closeTrace(): void {
    const q = { ...route.query };
    delete q[TRACE_POPOUT_QUERY];
    void router.replace({ path: route.path, query: q });
  }

  return { openTraceId, openTrace, closeTrace };
}
