import config from '@payload-config'
import { headers as nextHeaders } from 'next/headers'
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'

import { resolveTenant } from './tenant'

/** Payload instance and the tenant the current request is for. Responds 404 if none matches. */
export async function getTenantContext(tenantParam?: string) {
  const payload = await getPayload({ config })
  const headers = await nextHeaders()
  const tenant = await resolveTenant(payload, {
    host: headers.get('host'),
    tenantHeader: headers.get('x-tenant'),
    tenantParam,
  })
  if (!tenant) notFound()
  return { payload, tenant }
}
