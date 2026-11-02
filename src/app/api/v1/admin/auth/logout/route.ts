import { apiOk, logError } from "@/lib/http";
import { logoutAdmin } from "@/lib/session";

export const runtime = "nodejs";

export async function POST() {
  try {
    await logoutAdmin();
  } catch (err) {
    logError("admin logout", err);
  }
  return apiOk({ signed_in: false });
}
