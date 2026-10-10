# paycms

A CLI that creates and manages **multi-tenant [Payload CMS](https://payloadcms.com) 3.x** projects:
one Payload app and database serving many sites, one *tenant* per site.

```bash
npm install -g paycms
paycms create my-sites --template corporate --db postgres
cd my-sites
cp .env.example .env        # DATABASE_URL, PAYLOAD_SECRET
paycms doctor               # checks config, dependencies, env and DB reachability
paycms dev
```

Requires Node 20.12 or newer.

## Commands

| Command | What it does |
|---|---|
| `paycms create <name> [-t blank\|blog\|corporate] [-d postgres\|mongodb] [--pm npm\|pnpm\|yarn]` | Scaffold a project. `--yes` skips prompts, `--no-install` skips installing, `--dry-run` lists files. |
| `paycms generate collection <name> [--global-shared]` | New collection, registered in `payload.config.ts`. Tenant-scoped unless `--global-shared`. |
| `paycms generate global <name> [--global-shared]` | A per-tenant global (one document per tenant). With `--global-shared`, a real Payload global shared by all tenants. |
| `paycms generate block\|field\|hook\|access <name>` | Scaffold the file; import it where you need it. |
| `paycms tenant add <name> [--slug s] [--domain x.com] [--starter]` | Create a site. `--starter` also creates its `home` page. |
| `paycms tenant list` / `paycms tenant remove <slug> [--yes]` | List or delete sites. |
| `paycms dev` / `build` / `types` | Run the project's `dev`, `build` and `generate:types` scripts. |
| `paycms migrate [args…]` | `payload migrate`, e.g. `paycms migrate create add-notes`. |
| `paycms doctor` | Diagnose the current project. |

Generators never overwrite an existing file without `--force`. If `payload.config.ts` is shaped in a way
that cannot be edited safely (for example `collections` is a variable), the file is still created, the
exact lines to add are printed, and the exit code is 1. `--verbose` shows stack traces.

`tenant` commands start the project's own Payload through its Local API, so run them from the project
with `DATABASE_URL` and `PAYLOAD_SECRET` set (`.env` and `.env.local` are read).

## Templates

| Template | Adds |
|---|---|
| `blank` | `tenants`, `users` (roles, per-tenant roles), `media`, tenant-scoped `pages`, a catch-all frontend route |
| `blog` | `posts`, `categories`, `/blog` and `/blog/[slug]` |
| `corporate` | Layout blocks (hero, content, call to action, form), per-tenant `header`/`footer`, form builder |

### How tenancy works

- Built on `@payloadcms/plugin-multi-tenant`. Collections listed in its `collections` map get a tenant
  field and are filtered by tenant in the admin.
- The first user becomes a `super-admin` and sees every tenant. Other users get a list of tenants with a
  per-tenant role (`admin` or `editor`).
- The frontend resolves the tenant from the request host (matching a tenant's `domain`). On localhost,
  use `?tenant=<slug>` or an `x-tenant` header.
- Generated projects include `src/access/` helpers: `isSuperAdmin`, `tenantAdminOnly`, `tenantScoped`.

### Payload and dependency versions

Generated projects pin `payload` and every `@payloadcms/*` package to one version (see
`PAYLOAD_VERSION` in `src/commands/create.ts`), with the Next.js, React and sharp versions used by
Payload's own blank template at that release.

## Development

```bash
npm install
npm test                 # unit + integration (builds the CLI first)
npm run test:smoke       # slow: installs a generated project, generates types and type-checks it
```

Layout: `src/commands` (thin command handlers), `src/core` (project detection, template rendering,
ts-morph config codemod, env, Payload loading), `templates/projects` (blank → blog → corporate layers)
and `templates/snippets` (generator output).
