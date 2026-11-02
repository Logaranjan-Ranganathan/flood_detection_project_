import { isAdminPrincipal, requireAdminOr401 } from "@/lib/admin-guard";
import { acknowledgeAlert, unacknowledgeAlert } from "@/db/repo";
import { apiError, apiOk, logError, readJson } from "@/lib/http";
import { z } from "zod";

export const runtime = "nodejs";

const bodySchema = z.object({
  alert_id: z.number().int().positive(),
  action: z.enum(["acknowledge", "unacknowledge"]),
});

/** Only signed-in administrators may acknowledge alerts. */
export async function POST(request: Request) {
  const admin = await requireAdminOr401();
  if (!isAdminPrincipal(admin)) return admin;

  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) {
    return apiError(400, "invalid_payload", "alert_id and action are required");
  }

  const { alert_id, action } = parsed.data;
  try {
    const changed =
      action === "acknowledge"
        ? await acknowledgeAlert(alert_id, admin.adminId)
        : await unacknowledgeAlert(alert_id);
    if (!changed) {
      return apiError(
        404,
        action === "acknowledge" ? "already_acknowledged" : "unknown_alert",
        "Alert was not changed",
      );
    }
    return apiOk({ alert_id, action });
  } catch (err) {
    logError("admin alert ack", err);
    return apiError(500, "internal_error", "Could not update the alert");
  }
}
