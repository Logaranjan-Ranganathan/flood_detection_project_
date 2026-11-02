import { isAdminPrincipal, requireAdminOr401 } from "@/lib/admin-guard";
import { apiError, apiOk, logError } from "@/lib/http";
import { sweepHealth } from "@/lib/services/ingestion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Force a stale/offline scan (also runs automatically, once a minute). */
export async function POST() {
  const admin = await requireAdminOr401();
  if (!isAdminPrincipal(admin)) return admin;
  try {
    return apiOk(await sweepHealth());
  } catch (err) {
    logError("admin sweep", err);
    return apiError(500, "internal_error", "Could not run the health sweep");
  }
}
