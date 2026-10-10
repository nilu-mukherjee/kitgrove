# kitgrove

A CLI that creates and manages **multi-tenant [Payload CMS](https://payloadcms.com) 3.x** projects:
one Payload app and database serving many sites, one *tenant* per site.

```bash
npm install -g kitgrove
kitgrove create my-sites --template corporate --db postgres
cd my-sites
cp .env.example .env        # DATABASE_URL, PAYLOAD_SECRET
kitgrove doctor               # checks config, dependencies, env and DB reachability
kitgrove dev
```

Requires Node 20.12 or newer.

Run `kitgrove` with no arguments for the full-screen terminal UI (see [Terminal UI](#terminal-ui)).

## Commands

| Command | What it does |
|---|---|
| `kitgrove create <name> [-t blank\|blog\|corporate] [-d postgres\|mongodb] [--pm npm\|pnpm\|yarn]` | Scaffold a project. `--yes` skips prompts, `--no-install` skips installing, `--dry-run` lists files, `--headless` makes it backend only (see below). |
| `kitgrove create collection [name]` (same as `kitgrove generate collection`) | New collection, registered in `payload.config.ts`. In a terminal it asks for the name, `useAsTitle`, then each field. Tenant-scoped unless `--global-shared`. `--fields`, `--use-as-title <field>` or `--yes` skip the prompts. |
| `kitgrove generate global <name> [--fields <spec>] [--global-shared]` | A per-tenant global (one document per tenant). With `--global-shared`, a real Payload global shared by all tenants. |
| `kitgrove generate block <name> [--fields <spec>]` | A block with the given fields; import it into a `blocks` field. |
| `kitgrove generate field\|hook\|access <name>` | Scaffold the file; import it where you need it. |
| `kitgrove tenant add <name> [--slug s] [--domain x.com] [--starter]` | Create a site. `--starter` also creates its `home` page. |
| `kitgrove tenant list` / `kitgrove tenant remove <slug> [--yes]` | List or delete sites. |
| `kitgrove dev` / `build` / `types` | Run the project's `dev`, `build` and `generate:types` scripts. |
| `kitgrove migrate [args…]` | `payload migrate`, e.g. `kitgrove migrate create add-notes`. |
| `kitgrove access set <collection> --read <rule> --update <rule> …` / `kitgrove access show [collection]` | Change or show who can read/create/update/delete a collection. |
| `kitgrove user list\|add\|roles\|assign\|unassign\|remove\|reset-password` | Users, roles and tenant membership. |
| `kitgrove data collections\|list\|get\|create\|update\|delete` | Browse and edit documents. |
| `kitgrove headless [--dry-run] [--force] [--yes]` | Convert an existing project to backend only (see Headless below). |
| `kitgrove tui` | The terminal UI (same as running `kitgrove` with no arguments in a terminal). |
| `kitgrove doctor` | Diagnose the current project. |

### Fields

In a terminal, `kitgrove create collection` asks for the **collection name**, then **useAsTitle** (the field
that names a document in the admin), then for each field: **name**, **type** (the full Payload list),
whatever that type needs (options, target collection, nested fields…), **required**, **unique**, a
**default value**, and, behind one confirm, extras (label, description, admin position, read-only, index,
hasMany, min/max, minLength/maxLength). Leave the field name empty to finish; with no fields you get a single
`title` field. Container types (array, group, row, collapsible, tabs) ask for their inner fields the same way.
`generate global` and `generate block` use the same prompts (without useAsTitle).

For scripts and CI, pass the same thing with `--fields` (or `--yes` to skip prompts entirely):

```bash
kitgrove generate collection "Case Studies" --fields \
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
kitgrove create collection Products --use-as-title sku --fields \
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
kitgrove create collection Notes --access read=public,update=tenant-editor,delete=tenant-admin
kitgrove access set notes --update tenant-editor        # change one operation, others untouched
kitgrove access show                                    # every collection ("custom" = not one of the rules above)
```

Collections generated without `--access` keep `read: tenantScoped` only. Operations you don't set use
Payload's default (any signed-in user). `access set` edits the collection file; if its `access` block
can't be edited safely (for example it contains a spread) nothing is written and the exact lines to add
are printed. The helper files in `src/access/` are created if your project lacks them.

## Users

```bash
kitgrove user list [--tenant acme]
kitgrove user add ed@acme.com --tenant acme --tenant-role editor     # password: prompted, or KITGROVE_PASSWORD
kitgrove user roles ed@acme.com --set super-admin,user
kitgrove user assign ed@acme.com --tenant globex --tenant-role admin # replaces the role if already assigned
kitgrove user unassign ed@acme.com --tenant globex
kitgrove user remove ed@acme.com --yes
kitgrove user reset-password ed@acme.com
```

Passwords are never accepted as flags (shell history): you are prompted with hidden input, or in scripts
set `KITGROVE_PASSWORD`. Emails are case-insensitive. The last super-admin cannot be removed or demoted.

## Data

```bash
kitgrove data collections
kitgrove data list pages --tenant acme --where slug=home --limit 20 --page 1 [--json]
kitgrove data get pages 3
kitgrove data create pages --tenant acme --set title=Hello --set views=3        # or --json file.json
kitgrove data update pages 3 --set title="New title"
kitgrove data delete pages 3 --yes
kitgrove data list pages --as ed@acme.com          # run as that user, with access control enforced
```

`--set` values are coerced by field type (number, checkbox `true|false`, date, select/radio options,
relationship ids); array/group/blocks/json take JSON; rich text cannot be set with `--set` (use `--json`
or the admin). Tenant-scoped collections require `--tenant` on create. Without `--as`, commands run
with `overrideAccess: true`, like any script holding the database credentials.

## Terminal UI

`kitgrove` with no arguments opens a full-screen app (it needs a terminal; otherwise it prints help).

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
| Doctor | The same checks as `kitgrove doctor`; `r` re-runs |

Keys: `↑↓`/`jk` move, `Enter` open, `Esc` back, `?` help, `q` quit from Home. Data screens connect to
the database once, on first use. Needs a terminal of at least 80×24. In the builder: `a` add field, `e`
edit, `d` delete, `J`/`K` reorder, `Enter` on a container to open it, `n` name, `t` useAsTitle, `x` access.

## Templates

| Template | Adds |
|---|---|
| `blank` | `tenants`, `users` (roles, per-tenant roles), `media`, tenant-scoped `pages`, a catch-all frontend route |
| `blog` | `posts`, `categories`, `/blog` and `/blog/[slug]` |
| `corporate` | Layout blocks (hero, content, call to action, form), per-tenant `header`/`footer`, form builder |

### Headless (backend only)

`kitgrove create my-cms --headless` generates the admin and API with **no demo frontend**, for setups
where your sites call the REST or GraphQL API. A headless project also:

- turns on **API keys** for users, so each site's server can authenticate as its own user limited to
  its tenants (`kitgrove user add acme-site@example.com --tenant acme`, then tick *Enable API key*);
- reads allowed browser origins from **`CORS_ORIGINS`** (comma separated);
- ships a README with per-tenant REST and GraphQL examples.

Without `--headless` you get a small Next.js demo frontend per tenant. Both include the same collections.

**Already have a project?** Convert it in place:

```bash
kitgrove headless --dry-run     # shows exactly what would change
kitgrove headless --yes         # applies it
```

It removes only the demo-frontend files that are still exactly as generated (files you changed, or added
yourself, are kept and listed; `--force` removes the changed ones), sets `auth: { useAPIKey: true }` on
your users collection, adds the `cors` option, and documents `CORS_ORIGINS` in `.env.example`. Your `.env`
is never touched. Running it twice changes nothing, and anything it cannot edit safely is printed with
the exact line to add.

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

## Releasing

Pushing a version tag publishes to both registries from GitHub Actions
(`.github/workflows/release.yml`):

```bash
npm version patch            # or minor / major: bumps package.json and creates the v* tag
git push --follow-tags
```

| Registry | Package | Needs |
|---|---|---|
| npmjs.com | `kitgrove` | trusted publishing: no secret, configured once under the package's Settings on npmjs.com (user `nilu-mukherjee`, repo `kitgrove`, workflow `release.yml`) |
| GitHub Packages | `@nilu-mukherjee/kitgrove` | nothing; uses the workflow's `GITHUB_TOKEN` |

The tag must match the `version` in `package.json`; tests and typecheck run first. Installing from
GitHub Packages needs a GitHub token and `@nilu-mukherjee:registry=https://npm.pkg.github.com` in `.npmrc`,
so most people should use `npm i -g kitgrove`.

## License

[MIT](LICENSE)
