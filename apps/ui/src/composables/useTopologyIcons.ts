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
 * Topology icon registry — the same 100+ technology PNGs booster-ui
 * ships under `src/assets/img/technologies`. We use them in three
 * spots on the service map:
 *
 *   - `CUBE` / `CUBEERROR`  — the 3D-box node background, swapped on
 *                              health (CUBEERROR when the node is
 *                              over the error threshold).
 *   - `LOCAL`                — the speech-bubble that floats above the
 *                              cube, hosting the component badge.
 *   - `<COMPONENT>`          — the technology badge inside the LOCAL
 *                              bubble. Picked from the node's `type`
 *                              field (uppercased, hyphens stripped —
 *                              the same normalisation booster uses).
 *
 * `USER`, `UNDEFINED`, `UNKNOWN`, `UNKNOWN_CLOUD` are special cases —
 * `User` is only the literal entry-point node OAP emits for caller
 * traffic with no upstream service; `UNDEFINED` is the fallback for
 * a node whose `type` field is empty or `"N/A"`.
 *
 * The icons are loaded as base64-or-hashed URLs via Vite's
 * `import.meta.glob`, so they get fingerprinted in the production
 * bundle just like any other asset.
 */

const modules = import.meta.glob('@/assets/topology-icons/*.{png,jpg}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const REGISTRY: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const [path, url] of Object.entries(modules)) {
    const match = /([^/]+)\.(?:png|jpg)$/.exec(path);
    if (!match) continue;
    out[match[1].toUpperCase()] = url;
  }
  return out;
})();

function normaliseKey(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw.toUpperCase().replace(/[-_\s]/g, '');
}

/** True only for OAP's literal "User" caller node — `isReal === false`
 *  alone is NOT enough: synthetic `localhost:-1` nodes also come back
 *  with `isReal === false` but represent external/unknown callers,
 *  not interactive users. */
export function isUserNode(n: { name: string; isReal: boolean }): boolean {
  return n.name === 'User';
}

/** Cube image for the node body. Real nodes use CUBE/CUBEERROR based
 *  on the `errored` flag the caller supplies (derived from SLA).
 *  Non-real callers fall back to USER for the literal "User" node and
 *  UNKNOWN_CLOUD for everything else (localhost:-1 / external). */
export function cubeIcon(n: { name: string; isReal: boolean }, errored: boolean): string {
  if (!n.isReal) {
    if (isUserNode(n)) return REGISTRY.USER ?? REGISTRY.CUBE ?? '';
    return REGISTRY.UNKNOWN_CLOUD ?? REGISTRY.UNKNOWN ?? REGISTRY.CUBE ?? '';
  }
  return (errored ? REGISTRY.CUBEERROR : REGISTRY.CUBE) ?? '';
}

/** Floating bubble background — the small speech-bubble that sits
 *  above the cube and holds the component badge. */
export function bubbleIcon(): string {
  return REGISTRY.LOCAL ?? '';
}

/** Technology badge for the bubble. Maps the node's `type` field
 *  (booster calls this `n.type`) to a PNG. Falls back to UNDEFINED for
 *  empty / unmappable types. */
export function componentIcon(type: string | null | undefined): string {
  const key = normaliseKey(type);
  if (!key || key === 'N/A') return REGISTRY.UNDEFINED ?? '';
  return REGISTRY[key] ?? REGISTRY.UNDEFINED ?? '';
}

/** Like {@link componentIcon} but returns `null` when the type
 *  doesn't map to a specific technology PNG (no UNDEFINED fallback).
 *  Callers that want to render a custom "generic span" glyph on miss
 *  use this so they can detect the unmatched case. */
export function componentIconOrNull(type: string | null | undefined): string | null {
  const key = normaliseKey(type);
  if (!key || key === 'N/A') return null;
  return REGISTRY[key] ?? null;
}
