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
| `paycms create collection [name]` (same as `paycms generate collection`) | New collection, registered in `payload.config.ts`. In a terminal it asks for the name, `useAsTitle`, then each field. Tenant-scoped unless `--global-shared`. `--fields`, `--use-as-title <field>` or `--yes` skip the prompts. |
| `paycms generate global <name> [--fields <spec>] [--global-shared]` | A per-tenant global (one document per tenant). With `--global-shared`, a real Payload global shared by all tenants. |
| `paycms generate block <name> [--fields <spec>]` | A block with the given fields; import it into a `blocks` field. |
| `paycms generate field\|hook\|access <name>` | Scaffold the file; import it where you need it. |
| `paycms tenant add <name> [--slug s] [--domain x.com] [--starter]` | Create a site. `--starter` also creates its `home` page. |
| `paycms tenant list` / `paycms tenant remove <slug> [--yes]` | List or delete sites. |
| `paycms dev` / `build` / `types` | Run the project's `dev`, `build` and `generate:types` scripts. |
| `paycms migrate [args…]` | `payload migrate`, e.g. `paycms migrate create add-notes`. |
| `paycms doctor` | Diagnose the current project. |

### Fields

In a terminal, `paycms create collection` asks for the **collection name**, then **useAsTitle** (the field
that names a document in the admin), then for each field: **name**, **type** (the full Payload list),
whatever that type needs (options, target collection, nested fields…), **required**, **unique**, a
**default value**, and, behind one confirm, extras (label, description, admin position, read-only, index,
hasMany, min/max, minLength/maxLength). Leave the field name empty to finish; with no fields you get a single
`title` field. Container types (array, group, row, collapsible, tabs) ask for their inner fields the same way.
`generate global` and `generate block` use the same prompts (without useAsTitle).

For scripts and CI, pass the same thing with `--fields` (or `--yes` to skip prompts entirely):

```bash
paycms generate collection "Case Studies" --fields \
  "client:text!,status:select:draft|live,cover:upload:media,links:array(label:text!,url:text!)"
```

Syntax: comma-separated `name:type[:arg][(children)][!]`, where `!` marks the field required.

| Type | Argument / children |
|---|---|
| `text` `textarea` `richText` `number` `checkbox` `date` `email` `json` `code` `point` | none |
| `select` `radio` | `:a\|b\|c` options |
| `upload` `relationship` | `:<collection>` which must already exist |
| `join` | `:<collection>.<field>`, e.g. `posts.category` |
| `array` `group` `row` `collapsible` | `(child:type,…)` nested fields |
| `tabs` | `(Label(child:type,…),Other(…))` |
| `blocks` | `(hero,callout)` names of blocks that already exist (they are imported for you) |
| `ui` | none; add `admin.components` yourself |

Per-field options go in a trailing `[...]`: flags (`unique`, `index`, `readOnly`, `hasMany`) and
`key=value` pairs (`default`, `label`, `description`, `position=sidebar|main`, `min`, `max`, `minLength`,
`maxLength`). Values can't contain `,` or `]`. For example:

```bash
paycms create collection Products --use-as-title sku --fields \
  "sku:text![unique,index],price:number![min=0],stock:number[default=0],sale:checkbox,status:select:draft|live[default=draft,position=sidebar]"
```

`unique` applies to text, textarea, email, number, date, select, radio, relationship and code;
`default` to text, textarea, email, code, number, checkbox (`true`/`false`), date (`now` or an ISO date),
select and radio. `hasMany` cannot be combined with `unique` or `default`. `localized`, `saveToJWT`,
`validate`, `hooks`, `access` and `admin.condition` are not generated; add them in the file.

`group`, `row`, `collapsible`, `tabs`, `join` and `ui` have no `required` option. The admin title is
`title` if present, otherwise the first top-level text or email field, otherwise `id`.

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
