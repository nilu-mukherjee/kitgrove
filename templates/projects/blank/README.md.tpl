# {{name}}

A multi-tenant [Payload CMS](https://payloadcms.com) backend: one admin and database serving many sites,
one **tenant** per site. Created with `kitgrove`.
{{#if headless}}
This project is **headless**: the admin (`/admin`) and the API only, with no frontend. Your sites call
the REST API (`/api`) or GraphQL (`/api/graphql`).
{{/if}}
## Getting started

```bash
cp .env.example .env     # set DATABASE_URL and PAYLOAD_SECRET
npm run dev              # http://localhost:3000/admin
```

The first user you create becomes a `super-admin` and can see every tenant.

## How tenancy works

- `tenants` holds one document per site (`slug`, optional `domain`).
- Users get a `tenants` list with a per-tenant role (`admin` or `editor`). Super-admins see all tenants.
- Collections listed in the `multiTenantPlugin` `collections` map in `src/payload.config.ts` get a tenant
  field and are filtered by tenant in the admin and in the API.
{{#if frontend}}- The frontend (`src/app/(frontend)`) resolves the tenant from the request host (matching a tenant's
  `domain`). On localhost use `?tenant=<slug>` or an `x-tenant` header.
{{/if}}{{#if headless}}
## Calling the API from a site

Read one tenant's content (REST):

```bash
curl "http://localhost:3000/api/pages?where[tenant.slug][equals]=acme&depth=1"
```

The same through GraphQL (`POST /api/graphql`):

```graphql
query {
  Pages(where: { tenant__slug: { equals: "acme" } }) {
    docs { id title slug }
  }
}
```

### Public reads

Anonymous requests only see a tenant's content when its **Allow public read** box is ticked
(`allowPublicRead` on the tenant). Everything else needs authentication.

### API keys (server to server)

API keys are enabled on users. Create one user per site and limit it to that tenant:

```bash
kitgrove user add acme-site@example.com --tenant acme --tenant-role editor
```

Open that user in the admin, tick **Enable API key**, save, then call the API with:

```
Authorization: users API-Key <the key>
```

The key can only read and write the tenants that user belongs to; the multi-tenant plugin enforces it.

### CORS

Browsers on other origins need them listed in `CORS_ORIGINS` (comma separated). Server-to-server calls
do not need CORS.
{{/if}}
## Useful commands

```bash
kitgrove generate collection <name>   # new tenant-scoped collection
kitgrove tenant add "Acme" --domain acme.com
kitgrove user add editor@acme.com --tenant acme
kitgrove doctor
```
