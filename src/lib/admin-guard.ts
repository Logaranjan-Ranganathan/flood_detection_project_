import type { NextResponse } from "next/server";
import { apiError } from "./http";
import { requireAdmin, type AdminPrincipal } from "./session";

/**
 * Backend-enforced administrator check. Every mutating route calls this, so
 * hiding a button in the UI is never the actual access control.
 */
export async function requireAdminOr401():
  Promise<AdminPrincipal | NextResponse> {
  const admin = await requireAdmin();
  if (!admin) {
    return apiError(401, "not_authenticated", "Administrator sign-in required");
  }
  return admin;
}

export function isAdminPrincipal(
  value: AdminPrincipal | NextResponse,
): value is AdminPrincipal {
  return (value as AdminPrincipal).adminId !== undefined;
}
