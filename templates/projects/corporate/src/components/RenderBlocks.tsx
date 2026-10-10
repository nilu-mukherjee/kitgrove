import { RichText } from '@payloadcms/richtext-lexical/react'
import React from 'react'

type RichTextData = React.ComponentProps<typeof RichText>['data']

// Mirrors the blocks in src/blocks. Kept local so this file compiles before types are generated.
type LayoutBlock =
  | { blockType: 'hero'; id?: string | null; heading: string; subheading?: string | null }
  | { blockType: 'content'; id?: string | null; body: RichTextData }
  | { blockType: 'cta'; id?: string | null; heading: string; label: string; url: string }
  | { blockType: 'form'; id?: string | null; intro?: string | null }

/** Minimal block renderer; replace with your own components per block type. */
export function RenderBlocks({ blocks }: { blocks: LayoutBlock[] }) {
  return (
    <>
      {blocks.map((block, i) => {
        const key = block.id ?? i
        switch (block.blockType) {
          case 'hero':
            return (
              <section key={key}>
                <h2>{block.heading}</h2>
                {block.subheading ? <p>{block.subheading}</p> : null}
              </section>
            )
          case 'content':
            return (
              <section key={key}>
                <RichText data={block.body} />
              </section>
            )
          case 'cta':
            return (
              <section key={key}>
                <h2>{block.heading}</h2>
                <a href={block.url}>{block.label}</a>
              </section>
            )
          case 'form':
            // Render the submitted form with your own client component.
            return <section key={key}>{block.intro ? <p>{block.intro}</p> : null}</section>
          default:
            return null
        }
      })}
    </>
  )
}
