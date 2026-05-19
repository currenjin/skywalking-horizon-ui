# RBAC: Roles & Verbs

Horizon enforces access at the BFF on every HTTP request. The UI hides controls based on the verbs the session reports, but the enforcement is server-side — a forged UI cannot escalate. This page is the full reference for the verb vocabulary, the four built-in roles, and how grants are matched against requests.

## Model

- **Subject**: an authenticated session (`username + roles`).
- **Object**: an HTTP route.
- **Action (verb)**: a dot-namespaced string declared by the route policy table.
- **Decision**: granted iff any of the user's roles has a grant that matches the route's required verb.

Sessions capture the **role list** at login time. Verbs are computed per request from `session.roles → rbac.roles → grants`. Hot-reloading role definitions takes effect on the next route check; hot-reloading group mappings or local user roles requires the user to re-login (since sessions hold their original role list).

## Verb vocabulary

Source: `apps/bff/src/rbac/verbs.ts`. Twenty-eight verbs grouped into areas:

### Data reads (the public catalog)

| Verb | Gates |
|---|---|
| `metrics:read` | Layer dashboards, overview widgets that fetch MQE values. |
| `alarms:read` | Alarms page, alarm widgets on overviews. |
| `traces:read` | Traces tab on any layer, trace detail page. |
| `logs:read` | Logs tab on any layer, log detail page. |
| `topology:read` | Topology tab, topology widgets on overviews. |
| `profile:read` | Profiling tab (results read-only). |

### Operate — dashboards, rules, diagnostics

| Verb | Gates |
|---|---|
| `overview:read` / `overview:write` | Overview templates admin page (`/admin/overview-templates`): list / edit. |
| `dashboard:read` / `dashboard:write` | Layer dashboard templates admin page: list / edit. |
| `alarm-setup:read` / `alarm-setup:write` | Alarm Setup page: list / edit. |
| `alarm-rule:read` / `alarm-rule:write` | Alarm Rule catalog: list / edit. |
| `setup:read` / `setup:write` | Service / instance / endpoint setup pages. |
| `rule:read` | DSL Management — list rules. |
| `rule:write` | DSL Management — content edits (non-structural). |
| `rule:write:structural` | DSL Management — add / remove rules, change rule kind. |
| `rule:delete` | DSL Management — delete a rule. |
| `rule:debug` | DSL Management — debug a rule against sample input. |
| `live-debug:read` / `live-debug:write` | Live Debugger — observe / start sessions. |
| `profile:enable` | Create a profiling task on a layer. |

### Platform monitoring

| Verb | Gates |
|---|---|
| `cluster:read` | Cluster Status page (`/operate/cluster`). |
| `inspect:read` | Inspect page (`/admin/inspect`). |

### Admin surface

| Verb | Gates |
|---|---|
| `user:read` | Users admin page (`/admin/users`). |
| `user:write` | Reserved (no current write endpoint). |
| `role:read` | Roles & Permissions admin page (`/admin/roles`). |
| `role:write` | Reserved. |
| `auth:read` | Auth Status admin page (`/admin/auth-status`) + LDAP probe. |
| `auditRead` | Reserved (audit log not yet exposed via API). |

### Special

| Verb | Meaning |
|---|---|
| `admin` | Synonym for `*`. Matches anything. |
| `*` | Wildcard. Matches anything. |

## Grant matching

A user's grant string is matched against a required verb using these rules (`verbs.ts`):

| Grant pattern | Matches |
|---|---|
| `*` or `admin` | Any verb. |
| `area:verb` (exact) | The exact required verb (case-sensitive). |
| `area:*` | Any verb in that area, including sub-actions: `rule:*` matches `rule:read`, `rule:write`, `rule:write:structural`, `rule:delete`, `rule:debug`. |
| `*:read` | The `read` action in any area: matches `metrics:read`, `alarms:read`, `cluster:read`, etc. Does **not** match `rule:write:structural` (the action is not `read`). |

Effective verbs for a session are the **union** of all grants from all roles.

## Built-in roles

Default definitions (used when `rbac.roles` is not overridden):

### `viewer`

Read-only data catalog. Deliberately limited — does not include `*:read` so a viewer cannot peek at rule definitions, live-debug sessions, setup screens, or platform internals.

```
metrics:read, alarms:read, traces:read, logs:read, topology:read, profile:read
```

### `maintainer`

Viewer + platform monitoring.

```
viewer baseline + cluster:read, inspect:read
```

### `operator`

Configures observability. Inherits maintainer's reads + write access to dashboards, alarms, rules, live-debug, profiling.

```
maintainer baseline +
overview:read, overview:write,
setup:read, setup:write,
dashboard:read, dashboard:write,
alarm-setup:read, alarm-setup:write,
alarm-rule:read, alarm-rule:write,
rule:read, rule:write, rule:write:structural, rule:delete, rule:debug,
live-debug:read, live-debug:write,
profile:enable
```

### `admin`

Unrestricted. `"*"`.

## Role assignment

| Backend | Assignment |
|---|---|
| Local | `auth.local.users[].roles: [role1, role2, ...]` in `horizon.yaml`. |
| LDAP | `auth.ldap.groupMappings`: each group DN → one role. A user matching multiple groups gets the union of all matching roles. |

A user with no role gets no verbs. The session is created (login succeeds) but everything is denied. The login response carries an empty verb list; the UI shows "no access" for every protected feature.

## Landing route per role

After login, the BFF returns a `landingRoute` from `rbac.landingByRole`. The UI router uses it as the post-login destination unless `?redirect=` overrides (set when the user was bounced to login from a protected route — they return to where they came from).

Default mapping:

```yaml
landingByRole:
  viewer:     /
  maintainer: /operate/cluster
  operator:   /
  admin:      /operate/cluster
```

When a user has multiple roles, the **first role on the user** wins. Order matters in `auth.local.users[].roles` and in LDAP group-mapping resolution.

## Enforcement

Source: `apps/bff/src/rbac/route-policy.ts`, `apps/bff/src/rbac/policy.ts`, `apps/bff/src/user/middleware.ts`.

The BFF builds a route → required-verb table at startup. Every Fastify route is gated by:

1. `requireAuth()` — looks up the session cookie, returns 401 on missing / expired.
2. `checkVerb(verb)` — looks up the session's effective verbs, returns 403 on mismatch.

Routes without an explicit policy entry default to `'auth'` (session required, no specific verb) **with a warning at startup**. This is fail-safe: a forgotten route does not become accidentally public.

### Policy values

| Policy | Meaning |
|---|---|
| `'public'` | No auth required. Login, logout, health-check endpoints. |
| `'auth'` | Session required; no verb check. Identity-only routes. |
| `'<verb>'` | Session required + verb check. Most application routes. |

### Example policy entries

```ts
'POST /api/auth/login':              'public',
'POST /api/auth/logout':             'public',
'GET /api/auth/me':                  'auth',
'GET /api/oap/info':                 'auth',
'POST /api/layer/:key/dashboard':    'metrics:read',
'GET /api/rule':                     'rule:read',
'POST /api/rule/addOrUpdate':        'rule:write',
'POST /api/admin/auth-status/probe': 'auth:read',
```

## Disabling RBAC for dev

```yaml
rbac:
  enabled: false
```

Every authenticated session is granted `*`. Useful for local development. **Never set `false` in production.** When disabled, the Admin → Roles page shows a red banner.

## Visualizing the policy

The Admin → Roles page (`/admin/roles`, verb `role:read`) renders a read-only board of roles × verbs with check marks. It pulls live data — what you see is exactly what the BFF will use to evaluate the next request. Use it to verify role changes after editing `horizon.yaml`.

## Common patterns

### Read-only role for a new team

```yaml
roles:
  on-call:
    - metrics:read
    - alarms:read
    - traces:read
    - logs:read
    - topology:read
    - inspect:read       # so they can browse the catalog
landingByRole:
  on-call: /alarms       # land on the alarm board
```

### Lockdown for an external auditor

```yaml
roles:
  auditor:
    - "*:read"           # all reads only
landingByRole:
  auditor: /operate/cluster
```

`*:read` grants every read — useful for audit access without write capability.

### Separate alarm-tuning role

```yaml
roles:
  alarm-tuner:
    - metrics:read, alarms:read, topology:read, traces:read, logs:read
    - alarm-setup:read, alarm-setup:write
    - alarm-rule:read, alarm-rule:write
    - rule:read, rule:debug
```

Can view operational data and edit alarm rules but cannot touch DSL rule structure or live-debug.
