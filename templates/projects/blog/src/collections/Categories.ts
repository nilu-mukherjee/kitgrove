import type { CollectionConfig } from 'payload'

import { tenantScoped } from '../access/tenantScoped'

export const Categories: CollectionConfig = {
  slug: 'categories',
  access: {
    read: tenantScoped,
  },
  admin: {
    useAsTitle: 'title',
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
    },
    {
      name: 'slug',
      type: 'text',
      required: true,
      index: true,
    },
  ],
}
