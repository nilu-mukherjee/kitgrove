import type { GlobalConfig } from 'payload'

{{imports}}// A Payload global shared by every tenant. For per-tenant content, generate it without --global-shared.
export const {{Name}}: GlobalConfig = {
  slug: '{{slug}}',
  fields: [
{{fields}}
  ],
}
