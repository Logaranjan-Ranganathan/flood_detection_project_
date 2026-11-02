import { isAdminPrincipal, requireAdminOr401 } from "@/lib/admin-guard";
import { generateToken } from "@/lib/auth";
import {
  createCredential,
  listCredentials,
  revokeCredentialById,
  upsertDevice,
} from "@/db/repo";
import { apiError, apiOk, logError, readJson } from "@/lib/http";
import { credentialCreateSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await requireAdminOr401();
  if (!isAdminPrincipal(admin)) return admin;
  try {
    const rows = await listCredentials();
    return apiOk({
      credentials: rows.map((c) => ({
        credential_id: c.credentialId,
        device_id: c.deviceId,
        gateway_id: c.gatewayId,
        label: c.label,
        /** Only a prefix is ever returned; the token itself is not recoverable. */
        token_prefix: c.tokenPrefix,
        created_at: c.createdAt,
        last_used_at: c.lastUsedAt,
        revoked: c.revokedAt !== null,
      })),
    });
  } catch (err) {
    logError("admin credentials list", err);
    return apiError(500, "internal_error", "Could not list credentials");
  }
}

/**
 * Issue a device token. The plaintext is returned exactly once in this
 * response and never stored, so it cannot leak from the database later.
 */
export async function POST(request: Request) {
  const admin = await requireAdminOr401();
  if (!isAdminPrincipal(admin)) return admin;

  const parsed = credentialCreateSchema.safeParse(await readJson(request));
  if (!parsed.success) {
    return apiError(400, "invalid_payload", "Credential request is invalid", {
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    });
  }

  try {
    const { device_id: deviceId, gateway_id: gatewayId } = parsed.data;

    if (deviceId && parsed.data.create_device) {
      await upsertDevice({
        deviceId,
        label: parsed.data.create_device.label,
        gatewayId: parsed.data.create_device.gateway_id ?? null,
        zoneId: parsed.data.create_device.zone_id ?? null,
        locationSource: "UNVERIFIED",
        locationVerified: false,
      });
    }

    const token = generateToken(gatewayId ? "fggw" : "fgdev");
    await createCredential({
      deviceId: deviceId ?? null,
      gatewayId: gatewayId ?? null,
      token,
      label: parsed.data.label,
    });

    return apiOk({
      device_id: deviceId ?? null,
      gateway_id: gatewayId ?? null,
      token,
      warning:
        "Store this token in the device now. It cannot be shown again, and it must never be committed to the repository.",
    });
  } catch (err) {
    logError("admin credential create", err);
    return apiError(500, "internal_error", "Could not issue a credential");
  }
}

export async function DELETE(
  request: Request,
): Promise<Response> {
  const admin = await requireAdminOr401();
  if (!isAdminPrincipal(admin)) return admin;

  const id = Number(new URL(request.url).searchParams.get("credential_id"));
  if (!Number.isInteger(id)) {
    return apiError(400, "invalid_payload", "credential_id must be an integer");
  }
  try {
    const revoked = await revokeCredentialById(id);
    if (!revoked) return apiError(404, "unknown_credential", "Credential not found or already revoked");
    return apiOk({ revoked_credential_id: id });
  } catch (err) {
    logError("admin credential revoke", err);
    return apiError(500, "internal_error", "Could not revoke the credential");
  }
}
