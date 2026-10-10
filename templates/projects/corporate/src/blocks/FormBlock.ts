import type { Block } from 'payload'

export const FormBlock: Block = {
  slug: 'form',
  interfaceName: 'FormBlock',
  fields: [
    // `forms` is added by the form-builder plugin.
    { name: 'form', type: 'relationship', relationTo: 'forms', required: true },
    { name: 'intro', type: 'text' },
  ],
}
