import { apiOk, logError } from "@/lib/http";
import { requireAdmin } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const admin = await requireAdmin();
    return apiOk({ signed_in: !!admin, admin });
  } catch (err) {
    logError("admin session", err);
    return apiOk({ signed_in: false, admin: null });
  }
}
