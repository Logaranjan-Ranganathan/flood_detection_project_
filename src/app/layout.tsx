import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "FloodGuard — IoT flood monitoring",
  description:
    "Community flood monitoring from LoRa water-level sensors: live levels, 50-metre monitoring zones and alerts.",
};

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/map", label: "Live map" },
  { href: "/sensors", label: "Sensors" },
  { href: "/zones", label: "Zones" },
  { href: "/diagnostics", label: "Diagnostics" },
  { href: "/alerts", label: "Alerts" },
  { href: "/admin", label: "Admin" },
];

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <header className="sticky top-0 z-40 border-b border-slate-700/60 bg-[#0b1220]/90 backdrop-blur">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <span className="inline-block size-2.5 rounded-full bg-cyan-400" />
              FloodGuard
            </Link>
            <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="text-slate-300 transition hover:text-white"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 pb-16 pt-6">{children}</main>

        <footer className="mx-auto max-w-7xl px-4 pb-10 text-xs text-slate-500">
          <p>
            Monitoring circles on the map are {`50 m`} IoT observation zones drawn
            around sensor coordinates. They are not official administrative wards
            or government boundaries. During a real flood emergency, contact your
            local disaster management authority.
          </p>
        </footer>
      </body>
    </html>
  );
}
