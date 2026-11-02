import { authenticateGatewayToken } from "@/db/repo";
import { apiError, apiOk, bearerToken, logError, readJson } from "@/lib/http";
import { ingestGatewayStatus } from "@/lib/services/ingestion";
import { gatewayStatusPayloadSchema } from "@/lib/schemas";

export const runtime = "nodejs";

/**
 * Gateway heartbeat. Identity is the gateway_id in the authenticated payload,
 * never the IP address the request happened to arrive from.
 */
export async function POST(request: Request) {
  const token = bearerToken(request);
  if (!token) {
    return apiError(401, "missing_token", "Authorization: Bearer <device token> is required");
  }
  const ownedGatewayId = await authenticateGatewayToken(token);
  if (!ownedGatewayId) {
    return apiError(
      401,
      "invalid_token",
      "A gateway token issued for this gateway is required",
    );
  }

  const body = await readJson(request);
  const parsed = gatewayStatusPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, "invalid_payload", "Payload does not match the gateway status schema", {
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    });
  }

  try {
    const result = await ingestGatewayStatus(parsed.data, {
      authenticatedGatewayId: ownedGatewayId,
      receivedAt: new Date(),
    });
    if (result.status === "rejected") {
      return apiError(404, result.code ?? "rejected", result.message ?? "Rejected");
    }
    return apiOk({ gateway_id: parsed.data.gateway_id, recorded_at: new Date().toISOString() });
  } catch (err) {
    logError("ingest gateway status", err);
    return apiError(500, "internal_error", "Could not record gateway status");
  }
}
