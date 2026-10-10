import type { CollectionConfig } from 'payload'

import { isSuperAdmin } from '../access/isSuperAdmin'

export const Tenants: CollectionConfig = {
  slug: 'tenants',
  access: {
    create: isSuperAdmin,
    delete: isSuperAdmin,
  },
  admin: {
    useAsTitle: 'name',
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
    },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: { description: 'Used in URLs and the ?tenant= parameter during local development.' },
    },
    {
      name: 'domain',
      type: 'text',
      unique: true,
      admin: { description: 'Hostname this site is served from, e.g. acme.com (no protocol).' },
    },
    {
      name: 'allowPublicRead',
      type: 'checkbox',
      defaultValue: false,
      index: true,
      admin: {
        position: 'sidebar',
        description: 'Allow anonymous API reads of this tenant’s content.',
      },
    },
  ],
}
