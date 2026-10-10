import type { Access } from 'payload'

/**
 * Read access for tenant-scoped collections: signed-in users get the plugin's tenant filtering,
 * anonymous requests only see documents of tenants that have `allowPublicRead` enabled.
 */
export const tenantScoped: Access = ({ req }) => {
  if (req.user) return true
  return { 'tenant.allowPublicRead': { equals: true } }
}
