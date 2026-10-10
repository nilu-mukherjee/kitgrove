import type { Block } from 'payload'

{{imports}}export const {{Name}}: Block = {
  slug: '{{slug}}',
  interfaceName: '{{Name}}Block',
  fields: [
{{fields}}
  ],
}
