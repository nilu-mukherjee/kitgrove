import type { Access } from 'payload'

import { hasSuperAdminRole } from './isSuperAdmin'

export const {{camel}}: Access = ({ req }) => {
  if (!req.user) return false
  if (hasSuperAdminRole(req.user)) return true
  // Narrow to the user's tenants, e.g. { tenant: { in: tenantIDsWithRole(req.user, 'editor') } }
  // (tenantIDsWithRole lives in ./tenantAdminOnly).
  return false
}
