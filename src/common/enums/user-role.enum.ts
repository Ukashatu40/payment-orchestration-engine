// src/common/enums/user-role.enum.ts

export enum UserRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  OPS_ADMIN = 'OPS_ADMIN',
  OPS_VIEWER = 'OPS_VIEWER',
  MERCHANT_ADMIN = 'MERCHANT_ADMIN',
  MERCHANT_VIEWER = 'MERCHANT_VIEWER',
}

export const INTERNAL_ROLES = [UserRole.SUPER_ADMIN, UserRole.OPS_ADMIN, UserRole.OPS_VIEWER];
export const MERCHANT_ROLES = [UserRole.MERCHANT_ADMIN, UserRole.MERCHANT_VIEWER];
