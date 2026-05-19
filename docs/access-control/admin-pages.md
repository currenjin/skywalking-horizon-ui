# Admin Pages

Three pages under `/admin/` surface authentication, user, and RBAC state for live verification. All three are dark, dense, design-token UIs — they look like the rest of Horizon, not a separate "settings" section.

## Login page

**Path:** `/login`
**File:** `apps/ui/src/features/auth/LoginView.vue`

The redesigned login page:

- Full-bleed canyon background (the SkyWalking homepage backdrop).
- Centered glass-morphism card with the Horizon wordmark.
- **Inline auth-status pill** that adapts to the active backend:
  - Green: local backend, **or** LDAP backend with the directory reachable.
  - Red: LDAP backend with directory unreachable (warns that break-glass may be armed).
- Backend health is polled every 5 seconds via `GET /api/auth/health`.
- Form fields: username, password. Submit is disabled while in flight.
- Apache copyright footer with auto-current year.

After successful login, the UI redirects to:

1. `?redirect=<path>` if the user was bounced from a protected route, **or**
2. `landingByRole[<first role>]` (see [RBAC](rbac.md)).

## Auth Status

**Path:** `/admin/auth-status`
**Verb:** `auth:read` (maintainer, admin)
**File:** `apps/ui/src/features/admin/auth-status/AuthStatusView.vue`
**Endpoints:** `GET /api/admin/auth-status` (30 s auto-refresh), `POST /api/admin/auth-status/probe`

The single pane for "is my auth wiring correct?" Shows:

| Section | Content |
|---|---|
| Active backend | `local` or `ldap`. |
| Config file | Path, last-modified time, file size. |
| Local users | Count of `auth.local.users` entries (zero in LDAP mode). |
| LDAP probe | Reachability, service-bind success, user-search success, latency, last error. |
| Group-to-role mappings | The full `groupMappings` table from `horizon.yaml`. |
| Active sessions | Count from the in-memory session map. |
| Break-glass | Configured? Armed (LDAP unhealthy)? Username (hash not shown). |
| RBAC policy snapshot | All role names, all known verbs. |

### Live probe

A manual **Probe now** button fires `POST /api/admin/auth-status/probe` for an immediate refresh (does not wait for the 30 s tick).

### Username resolver

LDAP only. Type a username, see:

- Groups returned by LDAP for that user.
- Horizon roles resolved via `groupMappings`.

No login required for the resolution — useful for "if Alice tried to log in right now, what roles would she get?"

## Users

**Path:** `/admin/users`
**Verb:** `user:read` (admin)
**File:** `apps/ui/src/features/admin/users/UsersAdminView.vue`
**Endpoint:** `GET /api/admin/users` (15 s auto-refresh)

Lists users known to this BFF instance. Three sources merged:

1. **LDAP users**: from the in-memory seen-cache (anyone who successfully logged in via LDAP on this BFF since startup).
2. **Local users**: static entries from `auth.local.users` in `horizon.yaml`.
3. **Break-glass logins**: seen-cache entries marked `source: break-glass`.

Per-row:

| Column | Notes |
|---|---|
| Username | Login name. |
| Source | `ldap`, `local`, `break-glass`. |
| Roles | Assigned roles (current values from config or login-time capture). |
| Last login | Timestamp of most recent successful login. |
| From IP | Source IP of the last login. |
| Flags | `staticOnly` (in YAML but never logged in to this BFF), `fallbackOnly` (local user but LDAP is active backend). |

### Filters

- Free-text search by username.
- Source filter (`local` / `ldap` / `break-glass`).
- Role filter.
- "Active in last 24h" toggle.

### Operations

The Users page is **read-only**. To add a local user, edit `horizon.yaml`. To remove an LDAP user, do so in the directory; the seen-cache entry persists until BFF restart but is informational only.

## Roles & Permissions

**Path:** `/admin/roles`
**Verb:** `role:read` (admin)
**File:** `apps/ui/src/features/admin/roles/RolesView.vue`
**Endpoint:** `GET /api/admin/auth-status` (shared with the Auth Status page; reads the `rbac` block)

Renders a read-only board of roles × verbs as a check-mark grid. The intent is to answer "what can role X do?" without having to re-derive it from `horizon.yaml`.

Layout:

- **Left rail**: verb areas (`metrics`, `alarms`, `rule`, etc.).
- **Main grid**: rows = areas, columns = roles, cells = check marks per verb in that area.
- **Header strip**: built-in roles flagged distinctly from custom roles.
- **Footer**: legend explaining the four grant patterns (`*`, exact, `area:*`, `*:read`).

A red banner appears when `rbac.enabled: false` — the page warns that every authenticated session is granted `*`.

### Operations

Read-only. To change roles, edit `rbac.roles` in `horizon.yaml`; hot-reload applies the change without restart, and the next refresh of this page reflects the new state.

## Access summary

| Page | Verb | Default role(s) granted |
|---|---|---|
| `/operate/cluster` | `cluster:read` | maintainer, operator, admin |
| `/admin/auth-status` | `auth:read` | (none built-in; assign explicitly) |
| `/admin/users` | `user:read` | (none built-in; assign explicitly) |
| `/admin/roles` | `role:read` | (none built-in; assign explicitly) |
| `/admin/inspect` | `inspect:read` | maintainer, operator, admin |

`auth:read`, `user:read`, `role:read` are **not** in any default role. Either grant them via a custom role:

```yaml
roles:
  security-admin:
    - auth:read
    - user:read
    - role:read
    - cluster:read
```

or rely on the `admin` role (which gets everything via `*`).

The intent: viewing auth/user/role state is a privileged operation distinct from operating SkyWalking itself. A maintainer can see cluster health but should not need to see who else has logged in.
