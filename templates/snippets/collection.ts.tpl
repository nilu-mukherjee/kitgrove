import type { CollectionConfig } from 'payload'
{{#if hasAccessImports}}
{{accessImports}}{{/if}}
{{imports}}{{#if isGlobal}}// One document per tenant: registered with `isGlobal: true` in the multi-tenant plugin map.
{{/if}}export const {{Name}}: CollectionConfig = {
  slug: '{{slug}}',
{{accessBlock}}  admin: {
    useAsTitle: '{{titleField}}',
  },
  fields: [
{{fields}}
  ],
}
