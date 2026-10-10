# {{name}}

A multi-tenant [Payload CMS](https://payloadcms.com) app: one admin and database serving many sites,
one **tenant** per site. Created with `grovekit`.

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
  field and are filtered by tenant in the admin.
- The frontend (`src/app/(frontend)`) resolves the tenant from the request host (matching a tenant's
  `domain`). On localhost use `?tenant=<slug>` or an `x-tenant` header.

## Useful commands

```bash
grovekit generate collection <name>   # new tenant-scoped collection
grovekit tenant add "Acme" --domain acme.com
grovekit doctor
```
