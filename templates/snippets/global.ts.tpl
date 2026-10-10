import type { GlobalConfig } from 'payload'

// A Payload global shared by every tenant. For per-tenant content, generate it without --global-shared.
export const {{Name}}: GlobalConfig = {
  slug: '{{slug}}',
  fields: [
    {
      name: 'title',
      type: 'text',
    },
  ],
}
