import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/session";
import { LoginForm } from "@/components/admin/login-form";

export const dynamic = "force-dynamic";

export default async function AdminLoginPage() {
  const admin = await requireAdmin();
  if (admin) redirect("/admin");

  return (
    <div className="py-8">
      <LoginForm />
      <p className="mx-auto mt-4 max-w-md text-center text-xs text-slate-500">
        The public dashboard, map, sensors, zones and alerts stay open to visitors.
        Only device management, calibration, thresholds and alert acknowledgement
        require this sign-in.
      </p>
    </div>
  );
}
