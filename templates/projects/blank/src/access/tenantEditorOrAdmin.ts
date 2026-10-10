import type { Access } from 'payload'

import { hasSuperAdminRole } from './isSuperAdmin'
import { tenantIDsWithRole } from './tenantAdminOnly'

/** Super-admins, plus editors and admins of the document's tenant. */
export const tenantEditorOrAdmin: Access = ({ req }) => {
  if (!req.user) return false
  if (hasSuperAdminRole(req.user)) return true
  const ids = [...tenantIDsWithRole(req.user, 'admin'), ...tenantIDsWithRole(req.user, 'editor')]
  return ids.length ? { tenant: { in: ids } } : false
}
