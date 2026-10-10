import type { CollectionConfig } from 'payload'

import { tenantScoped } from '../access/tenantScoped'

export const Pages: CollectionConfig = {
  slug: 'pages',
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
      defaultValue: 'home',
      admin: { description: 'Use "home" for the site’s front page.' },
    },
    {
      name: 'content',
      type: 'richText',
    },
  ],
}
