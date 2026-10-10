# grovekit

A CLI that creates and manages **multi-tenant [Payload CMS](https://payloadcms.com) 3.x** projects:
one Payload app and database serving many sites, one *tenant* per site.

```bash
npm install -g grovekit
grovekit create my-sites --template corporate --db postgres
cd my-sites
cp .env.example .env        # DATABASE_URL, PAYLOAD_SECRET
grovekit doctor               # checks config, dependencies, env and DB reachability
grovekit dev
```

Requires Node 20.12 or newer.

Run `grovekit` with no arguments for the full-screen terminal UI (see [Terminal UI](#terminal-ui)).

## Commands

| Command | What it does |
|---|---|
| `grovekit create <name> [-t blank\|blog\|corporate] [-d postgres\|mongodb] [--pm npm\|pnpm\|yarn]` | Scaffold a project. `--yes` skips prompts, `--no-install` skips installing, `--dry-run` lists files. |
| `grovekit create collection [name]` (same as `grovekit generate collection`) | New collection, registered in `payload.config.ts`. In a terminal it asks for the name, `useAsTitle`, then each field. Tenant-scoped unless `--global-shared`. `--fields`, `--use-as-title <field>` or `--yes` skip the prompts. |
| `grovekit generate global <name> [--fields <spec>] [--global-shared]` | A per-tenant global (one document per tenant). With `--global-shared`, a real Payload global shared by all tenants. |
| `grovekit generate block <name> [--fields <spec>]` | A block with the given fields; import it into a `blocks` field. |
| `grovekit generate field\|hook\|access <name>` | Scaffold the file; import it where you need it. |
| `grovekit tenant add <name> [--slug s] [--domain x.com] [--starter]` | Create a site. `--starter` also creates its `home` page. |
| `grovekit tenant list` / `grovekit tenant remove <slug> [--yes]` | List or delete sites. |
| `grovekit dev` / `build` / `types` | Run the project's `dev`, `build` and `generate:types` scripts. |
| `grovekit migrate [args…]` | `payload migrate`, e.g. `grovekit migrate create add-notes`. |
| `grovekit access set <collection> --read <rule> --update <rule> …` / `grovekit access show [collection]` | Change or show who can read/create/update/delete a collection. |
| `grovekit user list\|add\|roles\|assign\|unassign\|remove\|reset-password` | Users, roles and tenant membership. |
| `grovekit data collections\|list\|get\|create\|update\|delete` | Browse and edit documents. |
| `grovekit tui` | The terminal UI (same as running `grovekit` with no arguments in a terminal). |
| `grovekit doctor` | Diagnose the current project. |

### Fields

In a terminal, `grovekit create collection` asks for the **collection name**, then **useAsTitle** (the field
that names a document in the admin), then for each field: **name**, **type** (the full Payload list),
whatever that type needs (options, target collection, nested fields…), **required**, **unique**, a
**default value**, and, behind one confirm, extras (label, description, admin position, read-only, index,
hasMany, min/max, minLength/maxLength). Leave the field name empty to finish; with no fields you get a single
`title` field. Container types (array, group, row, collapsible, tabs) ask for their inner fields the same way.
`generate global` and `generate block` use the same prompts (without useAsTitle).

For scripts and CI, pass the same thing with `--fields` (or `--yes` to skip prompts entirely):

```bash
grovekit generate collection "Case Studies" --fields \
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
grovekit create collection Products --use-as-title sku --fields \
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

## Access rules

Each of `read`, `create`, `update`, `delete` takes one rule:

| Rule | Meaning |
|---|---|
| `public` | Anyone, including anonymous requests |
| `authenticated` | Any signed-in user |
| `tenant-scoped` | Signed-in users, filtered by tenant; anonymous only for tenants with `allowPublicRead` |
| `tenant-editor` | Editors and admins of the document's tenant, plus super-admins |
| `tenant-admin` | Admins of the document's tenant, plus super-admins |
| `super-admin` | Super-admins only |

```bash
grovekit create collection Notes --access read=public,update=tenant-editor,delete=tenant-admin
grovekit access set notes --update tenant-editor        # change one operation, others untouched
grovekit access show                                    # every collection ("custom" = not one of the rules above)
```

Collections generated without `--access` keep `read: tenantScoped` only. Operations you don't set use
Payload's default (any signed-in user). `access set` edits the collection file; if its `access` block
can't be edited safely (for example it contains a spread) nothing is written and the exact lines to add
are printed. The helper files in `src/access/` are created if your project lacks them.

## Users

```bash
grovekit user list [--tenant acme]
grovekit user add ed@acme.com --tenant acme --tenant-role editor     # password: prompted, or GROVEKIT_PASSWORD
grovekit user roles ed@acme.com --set super-admin,user
grovekit user assign ed@acme.com --tenant globex --tenant-role admin # replaces the role if already assigned
grovekit user unassign ed@acme.com --tenant globex
grovekit user remove ed@acme.com --yes
grovekit user reset-password ed@acme.com
```

Passwords are never accepted as flags (shell history): you are prompted with hidden input, or in scripts
set `GROVEKIT_PASSWORD`. Emails are case-insensitive. The last super-admin cannot be removed or demoted.

## Data

```bash
grovekit data collections
grovekit data list pages --tenant acme --where slug=home --limit 20 --page 1 [--json]
grovekit data get pages 3
grovekit data create pages --tenant acme --set title=Hello --set views=3        # or --json file.json
grovekit data update pages 3 --set title="New title"
grovekit data delete pages 3 --yes
grovekit data list pages --as ed@acme.com          # run as that user, with access control enforced
```

`--set` values are coerced by field type (number, checkbox `true|false`, date, select/radio options,
relationship ids); array/group/blocks/json take JSON; rich text cannot be set with `--set` (use `--json`
or the admin). Tenant-scoped collections require `--tenant` on create. Without `--as`, commands run
with `overrideAccess: true`, like any script holding the database credentials.

## Terminal UI

`grovekit` with no arguments opens a full-screen app (it needs a terminal; otherwise it prints help).

| Screen | What you can do |
|---|---|
| Home | Open any screen below; outside a project: create one |
| Collections | Browse, open the builder (`n`) |
| New collection | Name, useAsTitle, a field table with a live preview of the generated file, access rules, write with `Ctrl+S` |
| Tenants | List, add (`a`), delete (`d`) |
| Users | Add, toggle super-admin, assign/unassign tenants, reset password, remove |
| Access | Grid of collections × operations; `Enter` on a cell picks a rule |
| Data | Pick a collection, page through documents (`[` `]`), filter by tenant (`t`), view, new, edit, delete |
| Run | `dev`, `build`, `types`, `migrate` with streamed output; `Ctrl+C` stops the process, not the app |
| Doctor | The same checks as `grovekit doctor`; `r` re-runs |

Keys: `↑↓`/`jk` move, `Enter` open, `Esc` back, `?` help, `q` quit from Home. Data screens connect to
the database once, on first use. Needs a terminal of at least 80×24. In the builder: `a` add field, `e`
edit, `d` delete, `J`/`K` reorder, `Enter` on a container to open it, `n` name, `t` useAsTitle, `x` access.

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
                         # (includes collections using every field type and access rules)
```

Layout: `src/commands` (thin command handlers), `src/core` (project detection, template rendering,
ts-morph config codemod, env, Payload loading), `templates/projects` (blank → blog → corporate layers)
and `templates/snippets` (generator output).

## License

[MIT](LICENSE)
