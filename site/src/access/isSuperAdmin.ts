import type { Access, FieldAccess } from 'payload'

export type TenantRole = 'admin' | 'editor'

/** The user shape these helpers rely on (matches the Users collection in this project). */
export interface TenantUser {
  id?: string | number
  roles?: string[]
  tenants?: {
    tenant: string | number | { id: string | number }
    roles?: TenantRole[]
  }[]
}

export const hasSuperAdminRole = (user: unknown): boolean =>
  Boolean((user as TenantUser | null | undefined)?.roles?.includes('super-admin'))

export const isSuperAdmin: Access = ({ req }) => hasSuperAdminRole(req.user)

/** Same check for field-level access (field access args differ from collection access args). */
export const isSuperAdminField: FieldAccess = ({ req }) => hasSuperAdminRole(req.user)
