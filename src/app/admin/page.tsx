import { redirect } from "next/navigation";
import { listAlerts, listCredentials } from "@/db/repo";
import { requireAdmin } from "@/lib/session";
import { AdminConsole } from "@/components/admin/console";
import { getOverview } from "@/lib/services/overview";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const admin = await requireAdmin();
  if (!admin) redirect("/admin/login");

  const overview = await getOverview();
  const [alerts, credentials] = await Promise.all([
    listAlerts({ limit: 100 }),
    listCredentials(),
  ]);

  return (
    <AdminConsole
      devices={overview.devices}
      zones={overview.zones}
      gateways={overview.gateways}
      thresholds={overview.thresholds}
      healthWindow={overview.healthWindow}
      alerts={alerts}
      credentials={credentials.map((c) => ({
        credential_id: c.credentialId,
        device_id: c.deviceId,
        gateway_id: c.gatewayId,
        label: c.label,
        token_prefix: c.tokenPrefix,
        last_used_at: c.lastUsedAt,
        revoked: c.revokedAt !== null,
      }))}
    />
  );
}
