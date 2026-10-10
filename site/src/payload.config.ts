import { postgresAdapter } from '@payloadcms/db-postgres'
import { multiTenantPlugin } from '@payloadcms/plugin-multi-tenant'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

import { hasSuperAdminRole } from './access/isSuperAdmin'
import { Media } from './collections/Media'
import { Pages } from './collections/Pages'
import { Tenants } from './collections/Tenants'
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
  collections: [Users, Tenants, Media, Pages],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: postgresAdapter({
    pool: { connectionString: process.env.DATABASE_URL || '' },
  }),
  sharp,
  plugins: [
    multiTenantPlugin({
      // Every tenant-scoped collection is listed here; `grovekit generate collection` adds new ones.
      collections: {
        pages: {},
        media: {},
      },
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
