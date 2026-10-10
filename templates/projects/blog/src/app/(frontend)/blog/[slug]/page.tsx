import { RichText } from '@payloadcms/richtext-lexical/react'
import { notFound } from 'next/navigation'
import React from 'react'

import { getTenantContext } from '@/lib/currentTenant'

type Props = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ tenant?: string }>
}

export default async function BlogPost({ params, searchParams }: Props) {
  const [{ slug }, { tenant: tenantParam }] = await Promise.all([params, searchParams])
  const { payload, tenant } = await getTenantContext(tenantParam)

  const { docs } = await payload.find({
    collection: 'posts',
    where: { and: [{ tenant: { equals: tenant.id } }, { slug: { equals: slug } }] },
    limit: 1,
    depth: 0,
  })
  const post = docs[0]
  if (!post) notFound()

  return (
    <article>
      <h1>{post.title}</h1>
      {post.content ? <RichText data={post.content} /> : null}
    </article>
  )
}
