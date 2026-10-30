import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function GET() {
  const authCheck = await requireAuth();
  if (!authCheck.ok) return authCheck.response;

  const syncToken = (process.env.SYNC_API_TOKEN || "").trim();

  return NextResponse.json({
    configured: Boolean(syncToken),
    syncToken: syncToken || null,
  });
}
