import type { CollectionConfig } from 'payload'

import { hasSuperAdminRole, isSuperAdminField } from '../access/isSuperAdmin'

// The `tenants` array (tenant + per-tenant roles) is added by the multi-tenant plugin.
export const Users: CollectionConfig = {
  slug: 'users',
  admin: {
    useAsTitle: 'email',
  },
  auth: true,
  fields: [
    {
      name: 'roles',
      type: 'select',
      hasMany: true,
      defaultValue: ['user'],
      options: ['super-admin', 'user'],
      required: true,
      saveToJWT: true,
      access: {
        create: isSuperAdminField,
        update: isSuperAdminField,
      },
      hooks: {
        // The very first user must be able to administer everything.
        beforeValidate: [
          async ({ operation, req, value }) => {
            if (operation === 'create' && !hasSuperAdminRole(req.user)) {
              const { totalDocs } = await req.payload.count({ collection: 'users' })
              if (totalDocs === 0) return ['super-admin']
            }
            return value
          },
        ],
      },
    },
  ],
}
