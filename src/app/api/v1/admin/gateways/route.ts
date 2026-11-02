import { isAdminPrincipal, requireAdminOr401 } from "@/lib/admin-guard";
import { getGateway, listGateways, upsertGateway } from "@/db/repo";
import { apiError, apiOk, logError, readJson } from "@/lib/http";
import { gatewayUpsertSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await requireAdminOr401();
  if (!isAdminPrincipal(admin)) return admin;
  try {
    return apiOk({ gateways: await listGateways() });
  } catch (err) {
    logError("admin gateways list", err);
    return apiError(500, "internal_error", "Could not list gateways");
  }
}

/** Register a gateway such as ESP32-2 under its own stable gateway ID. */
export async function POST(request: Request) {
  const admin = await requireAdminOr401();
  if (!isAdminPrincipal(admin)) return admin;

  const parsed = gatewayUpsertSchema.safeParse(await readJson(request));
  if (!parsed.success) {
    return apiError(400, "invalid_payload", "Gateway definition is invalid", {
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    });
  }

  try {
    const existing = await getGateway(parsed.data.gateway_id);
    await upsertGateway({
      gatewayId: parsed.data.gateway_id,
      name: parsed.data.name,
      firmwareVersion: parsed.data.firmware_version,
      hardwareNote: parsed.data.hardware_note,
    });
    return apiOk({ gateway_id: parsed.data.gateway_id, created: !existing });
  } catch (err) {
    logError("admin gateway create", err);
    return apiError(500, "internal_error", "Could not register this gateway");
  }
}
