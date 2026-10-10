import type { CollectionConfig } from 'payload'

import { tenantScoped } from '../access/tenantScoped'

export const Media: CollectionConfig = {
  slug: 'media',
  access: {
    read: tenantScoped,
  },
  upload: true,
  fields: [
    {
      name: 'alt',
      type: 'text',
      required: true,
    },
  ],
}
