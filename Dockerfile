# Licensed to the Apache Software Foundation (ASF) under one or more
# contributor license agreements.  See the NOTICE file distributed with
# this work for additional information regarding copyright ownership.
# The ASF licenses this file to You under the Apache License, Version 2.0
# (the "License"); you may not use this file except in compliance with
# the License.  You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# ---- builder ----------------------------------------------------------------
# Builds the BFF bundle + the Vite SPA in a single workspace install. Final
# image only carries the BFF dist + UI dist + the production dependency tree
# (no source, no devDependencies, no pnpm store).
FROM node:20-alpine AS builder
WORKDIR /workspace

# argon2 (password hashing) builds a native module; alpine needs python + a
# C toolchain at build time. The deps are dropped from the runtime stage.
RUN apk add --no-cache python3 make g++ libc6-compat
# Activate the pnpm version pinned in the repo's root `package.json`.
# We pin it here too so `corepack prepare` doesn't need package.json
# on disk yet (it runs before the COPY of workspace manifests).
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/bff/package.json apps/bff/
COPY apps/ui/package.json apps/ui/
COPY packages/api-client/package.json packages/api-client/
COPY packages/design-tokens/package.json packages/design-tokens/
COPY packages/templates/package.json packages/templates/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @skywalking-horizon-ui/bff build \
 && pnpm --filter @skywalking-horizon-ui/ui  build

# Deploy a focused production install for the BFF — pnpm copies only the
# packages it actually needs (workspace deps + runtime npm deps). The
# `--legacy` flag is mandatory under pnpm 10+ for non-injected
# workspaces (the alternative is enabling `inject-workspace-packages`
# everywhere, which we don't need for plain workspace deps).
RUN pnpm deploy --legacy --filter @skywalking-horizon-ui/bff --prod /deploy/bff

# ---- runtime ---------------------------------------------------------------
FROM node:20-alpine
WORKDIR /app

# Run as a non-root user — the BFF doesn't need any privileged access.
RUN addgroup -S horizon && adduser -S -G horizon horizon

# Read-only artifacts (code, deps, static assets, example config) — owned
# by root, world-readable. The BFF never writes here.
COPY --from=builder /deploy/bff/dist ./dist
COPY --from=builder /deploy/bff/node_modules ./node_modules
COPY --from=builder /deploy/bff/package.json ./package.json
COPY --from=builder /workspace/apps/ui/dist ./static
COPY --from=builder /workspace/horizon.example.yaml ./horizon.example.yaml

# `bundled_templates/` is writable: the admin Layer-Templates and
# Overview-Templates editors `writeFileSync` into the per-key/per-id
# JSON files here. Must be owned by the `horizon` user, otherwise admin
# saves EACCES. The loader still resolves the directory via
# `__dirname/../bundled_templates`, so the path layout stays in sync
# with the source tree.
COPY --from=builder --chown=horizon:horizon /workspace/apps/bff/src/bundled_templates ./bundled_templates

# `/data` is the writable state directory the BFF writes its runtime
# files into (audit log, setup state, alarm state, wire debug log).
# Operators can mount a PVC / named volume / host bind at /data and
# the configured paths below land on durable storage. Without this
# mount the writes go to the container's writable layer (ephemeral).
RUN mkdir -p /data && chown horizon:horizon /data
VOLUME ["/data"]

ENV NODE_ENV=production \
    HORIZON_STATIC_DIR=/app/static \
    HORIZON_CONFIG=/app/horizon.yaml \
    HORIZON_AUDIT_FILE=/data/horizon-audit.jsonl \
    HORIZON_SETUP_FILE=/data/horizon-setup.json \
    HORIZON_ALARMS_FILE=/data/horizon-alarms.json \
    HORIZON_WIRE_LOG_FILE=/data/horizon-wire.jsonl

USER horizon
EXPOSE 8081
CMD ["node", "dist/server.js"]
