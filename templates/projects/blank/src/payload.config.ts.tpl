{{#if postgres}}import { postgresAdapter } from '@payloadcms/db-postgres'
{{/if}}{{#if mongodb}}import { mongooseAdapter } from '@payloadcms/db-mongodb'
{{/if}}{{#if corporate}}import { formBuilderPlugin } from '@payloadcms/plugin-form-builder'
{{/if}}import { multiTenantPlugin } from '@payloadcms/plugin-multi-tenant'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

import { hasSuperAdminRole } from './access/isSuperAdmin'
{{#if blog}}import { Categories } from './collections/Categories'
{{/if}}{{#if corporate}}import { Footer } from './collections/Footer'
import { Header } from './collections/Header'
{{/if}}import { Media } from './collections/Media'
import { Pages } from './collections/Pages'
{{#if blog}}import { Posts } from './collections/Posts'
{{/if}}import { Tenants } from './collections/Tenants'
import { Users } from './collections/Users'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  collections: [Users, Tenants, Media, Pages{{#if blog}}, Posts, Categories{{/if}}{{#if corporate}}, Header, Footer{{/if}}],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || '',
{{#if headless}}  // Origins allowed to call the API from a browser, comma separated.
  cors: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',').map((origin) => origin.trim()) : [],
{{/if}}  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
{{#if postgres}}  db: postgresAdapter({
    pool: { connectionString: process.env.DATABASE_URL || '' },
  }),
{{/if}}{{#if mongodb}}  db: mongooseAdapter({
    url: process.env.DATABASE_URL || '',
  }),
{{/if}}  sharp,
  plugins: [
{{#if corporate}}    // Registered before the multi-tenant plugin so the forms collections get a tenant field too.
    formBuilderPlugin({}),
{{/if}}    multiTenantPlugin({
      // Every tenant-scoped collection is listed here; `kitgrove generate collection` adds new ones.
      collections: {
        pages: {},
        media: {},
{{#if blog}}        posts: {},
        categories: {},
{{/if}}{{#if corporate}}        // One document per tenant, edited like a global.
        header: { isGlobal: true },
        footer: { isGlobal: true },
        forms: {},
        'form-submissions': {},
{{/if}}      },
      // Adds a `tenants` array (tenant + per-tenant roles) to the users collection.
      tenantsArrayField: {
        includeDefaultField: true,
        rowFields: [
          {
            name: 'roles',
            type: 'select',
            hasMany: true,
            defaultValue: ['editor'],
            options: ['admin', 'editor'],
            required: true,
          },
        ],
      },
      userHasAccessToAllTenants: (user) => hasSuperAdminRole(user),
    }),
  ],
})
