import config from '@payload-config'
import { RichText } from '@payloadcms/richtext-lexical/react'
import { headers as nextHeaders } from 'next/headers'
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import React from 'react'

import { resolveTenant } from '@/lib/tenant'

type Props = {
  params: Promise<{ slug?: string[] }>
  searchParams: Promise<{ tenant?: string }>
}

export default async function Page({ params, searchParams }: Props) {
  const payload = await getPayload({ config })
  const [{ slug }, { tenant: tenantParam }, headers] = await Promise.all([
    params,
    searchParams,
    nextHeaders(),
  ])

  const tenant = await resolveTenant(payload, {
    host: headers.get('host'),
    tenantHeader: headers.get('x-tenant'),
    tenantParam,
  })
  if (!tenant) notFound()

  const { docs } = await payload.find({
    collection: 'pages',
    where: {
      and: [{ tenant: { equals: tenant.id } }, { slug: { equals: slug?.join('/') || 'home' } }],
    },
    limit: 1,
    depth: 0,
  })
  const page = docs[0]
  if (!page) notFound()

  return (
    <main>
      <h1>{page.title}</h1>
      {page.content ? <RichText data={page.content} /> : null}
    </main>
  )
}
