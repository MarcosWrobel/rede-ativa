"use client";

import { LogOut } from "lucide-react";
import { cleanupLegacyServiceWorkersAndCaches } from "@/lib/pwaCleanup";

export default function SignOutButton({ className }: { className?: string }) {
  const handleSignOut = async () => {
    await cleanupLegacyServiceWorkersAndCaches().catch(() => {});
    window.location.href = "/api/auth/signout";
  };

  return (
    <button type="button" onClick={handleSignOut} className={className}>
      <LogOut className="w-4 h-4" />
      <span>Encerrar sessão</span>
    </button>
  );
}
