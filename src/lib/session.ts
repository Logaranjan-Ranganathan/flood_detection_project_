import { cookies } from "next/headers";
import {
  createSession,
  destroySession,
  getAdminByEmail,
  getAdminById,
  getSession,
  touchAdminLogin,
} from "@/db/repo";
import { generateToken, hashPassword, hashToken, verifyPassword } from "@/lib/auth";

export const SESSION_COOKIE = "fg_admin_session";
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export interface AdminPrincipal {
  adminId: number;
  email: string;
  name: string;
}

/**
 * Log an admin in and set an HttpOnly session cookie. The database only ever
 * stores the SHA-256 of the token, so a database leak is not a session leak.
 */
export async function loginAdmin(
  email: string,
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = await getAdminByEmail(email);
  // Same message for unknown email and wrong password: no account enumeration.
  if (!admin || !verifyPassword(password, admin.passwordHash)) {
    return { ok: false, error: "Invalid email or password" };
  }

  const token = generateToken("fgadmin");
  await createSession({
    tokenHash: hashToken(token),
    adminId: admin.adminId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  await touchAdminLogin(admin.adminId);

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
  return { ok: true };
}

export async function logoutAdmin(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await destroySession(hashToken(token));
  jar.delete(SESSION_COOKIE);
}

/** Returns the signed-in admin, or null. All admin writes must call this. */
export async function requireAdmin(): Promise<AdminPrincipal | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await getSession(hashToken(token));
  if (!session) return null;
  const admin = await getAdminById(session.adminId);
  if (!admin) return null;
  return { adminId: admin.adminId, email: admin.email, name: admin.name };
}

export async function bootstrapAdminIfMissing(
  email: string,
  password: string,
  name = "FloodGuard administrator",
): Promise<boolean> {
  const { countAdmins } = await import("@/db/repo");
  if ((await countAdmins()) > 0) return false;
  const { createAdmin } = await import("@/db/repo");
  await createAdmin({ email, name, passwordHash: hashPassword(password) });
  return true;
}
