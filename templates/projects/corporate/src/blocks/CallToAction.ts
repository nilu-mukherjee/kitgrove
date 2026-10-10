import type { Block } from 'payload'

export const CallToAction: Block = {
  slug: 'cta',
  interfaceName: 'CallToActionBlock',
  fields: [
    { name: 'heading', type: 'text', required: true },
    { name: 'label', type: 'text', required: true },
    { name: 'url', type: 'text', required: true },
  ],
}
