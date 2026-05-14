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

import { watch } from 'vue';
import { useAutoRefreshStore } from '@/stores/autoRefresh';

/**
 * Subscribe a refetch callback to the global auto-refresh ticker.
 * Composables (or views) call this with their query's `refetch` to
 * pick up manual refreshes + interval-driven ticks from the topbar.
 * The watch is anchored to the calling scope, so when the component
 * unmounts the subscription is torn down automatically.
 */
export function useAutoRefreshSubscribe(refetch: () => Promise<unknown> | unknown): void {
  const auto = useAutoRefreshStore();
  watch(
    () => auto.tickCount,
    () => {
      void refetch();
    },
  );
}
