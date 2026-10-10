import type { Access } from 'payload'

import { hasSuperAdminRole, type TenantRole, type TenantUser } from './isSuperAdmin'

/** IDs of the tenants where the user holds `role`. */
export const tenantIDsWithRole = (user: unknown, role: TenantRole): (string | number)[] =>
  ((user as TenantUser | null | undefined)?.tenants ?? [])
    .filter((row) => row.roles?.includes(role))
    .map((row) => (typeof row.tenant === 'object' ? row.tenant.id : row.tenant))

/**
 * Only super-admins and admins of a document's tenant. Returns a query constraint, so it works
 * for update/delete on collections that have the plugin's `tenant` field.
 */
export const tenantAdminOnly: Access = ({ req }) => {
  if (!req.user) return false
  if (hasSuperAdminRole(req.user)) return true
  const ids = tenantIDsWithRole(req.user, 'admin')
  return ids.length ? { tenant: { in: ids } } : false
}
