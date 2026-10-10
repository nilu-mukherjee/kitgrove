import { RichText } from '@payloadcms/richtext-lexical/react'
import { notFound } from 'next/navigation'
import React from 'react'

import { getTenantContext } from '@/lib/currentTenant'

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

  return (
    <>
      <main>
        <h1>{page.title}</h1>
        {page.content ? <RichText data={page.content} /> : null}
      </main>
    </>
  )
}
