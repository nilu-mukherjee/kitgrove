import Link from 'next/link'
import React from 'react'

import { getTenantContext } from '@/lib/currentTenant'

type Props = { searchParams: Promise<{ tenant?: string }> }

export default async function BlogIndex({ searchParams }: Props) {
  const { tenant: tenantParam } = await searchParams
  const { payload, tenant } = await getTenantContext(tenantParam)

  const { docs: posts } = await payload.find({
    collection: 'posts',
    where: { tenant: { equals: tenant.id } },
    sort: '-publishedAt',
    limit: 20,
    depth: 0,
  })

  const suffix = tenantParam ? `?tenant=${encodeURIComponent(tenantParam)}` : ''
  return (
    <main>
      <h1>Blog</h1>
      <ul>
        {posts.map((post) => (
          <li key={post.id}>
            <Link href={`/blog/${post.slug}${suffix}`}>{post.title}</Link>
          </li>
        ))}
      </ul>
    </main>
  )
}
