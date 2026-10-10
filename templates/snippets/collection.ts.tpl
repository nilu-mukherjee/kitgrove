import type { CollectionConfig } from 'payload'
{{#if tenantScoped}}
import { tenantScoped } from '../access/tenantScoped'
{{/if}}
{{imports}}{{#if isGlobal}}// One document per tenant: registered with `isGlobal: true` in the multi-tenant plugin map.
{{/if}}export const {{Name}}: CollectionConfig = {
  slug: '{{slug}}',
{{#if tenantScoped}}  access: {
    read: tenantScoped,
  },
{{/if}}  admin: {
    useAsTitle: '{{titleField}}',
  },
  fields: [
{{fields}}
  ],
}
