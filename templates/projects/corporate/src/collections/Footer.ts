import type { CollectionConfig } from 'payload'

import { tenantScoped } from '../access/tenantScoped'

// One document per tenant (`isGlobal: true` in payload.config.ts).
export const Footer: CollectionConfig = {
  slug: 'footer',
  access: {
    read: tenantScoped,
  },
  admin: {
    useAsTitle: 'id',
  },
  fields: [{ name: 'copyright', type: 'text' }],
}
