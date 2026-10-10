import type { CollectionConfig } from 'payload'

import { tenantScoped } from '../access/tenantScoped'

// One document per tenant: the multi-tenant plugin treats this collection as a per-tenant global
// (`isGlobal: true` in payload.config.ts).
export const Header: CollectionConfig = {
  slug: 'header',
  access: {
    read: tenantScoped,
  },
  admin: {
    useAsTitle: 'id',
  },
  fields: [
    {
      name: 'navItems',
      type: 'array',
      fields: [
        { name: 'label', type: 'text', required: true },
        { name: 'url', type: 'text', required: true },
      ],
    },
  ],
}
