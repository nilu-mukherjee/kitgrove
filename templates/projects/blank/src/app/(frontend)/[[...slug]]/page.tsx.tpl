import { RichText } from '@payloadcms/richtext-lexical/react'
import { notFound } from 'next/navigation'
import React from 'react'

{{#if corporate}}import { RenderBlocks } from '@/components/RenderBlocks'
{{/if}}import { getTenantContext } from '@/lib/currentTenant'

type Props = {
  params: Promise<{ slug?: string[] }>
  searchParams: Promise<{ tenant?: string }>
}

export default async function Page({ params, searchParams }: Props) {
  const [{ slug }, { tenant: tenantParam }] = await Promise.all([params, searchParams])
  const { payload, tenant } = await getTenantContext(tenantParam)

  const { docs } = await payload.find({
    collection: 'pages',
    where: {
      and: [{ tenant: { equals: tenant.id } }, { slug: { equals: slug?.join('/') || 'home' } }],
    },
    limit: 1,
    depth: 1,
  })
  const page = docs[0]
  if (!page) notFound()
{{#if corporate}}
  const forTenant = { tenant: { equals: tenant.id } }
  const [{ docs: [header] }, { docs: [footer] }] = await Promise.all([
    payload.find({ collection: 'header', where: forTenant, limit: 1, depth: 0 }),
    payload.find({ collection: 'footer', where: forTenant, limit: 1, depth: 0 }),
  ])
{{/if}}
  return (
    <>
{{#if corporate}}      <header>
        <nav>
          {(header?.navItems ?? []).map((item) => (
            <a key={item.id ?? item.url} href={item.url}>
              {item.label}
            </a>
          ))}
        </nav>
      </header>
{{/if}}      <main>
        <h1>{page.title}</h1>
        {page.content ? <RichText data={page.content} /> : null}
{{#if corporate}}        <RenderBlocks blocks={page.layout ?? []} />
{{/if}}      </main>
{{#if corporate}}      <footer>{footer?.copyright}</footer>
{{/if}}    </>
  )
}
