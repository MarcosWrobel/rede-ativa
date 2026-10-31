import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const dbUrl = process.env.DATABASE_URL || "";
  const directUrl = (process.env.DIRECT_URL || dbUrl).replace("-pooler.", ".");

  const results: Record<string, any> = {
    envDatabaseUrl: dbUrl.replace(/:([^:@]+)@/, ":*****@"),
    envDirectUrl: directUrl.replace(/:([^:@]+)@/, ":*****@"),
  };

  // Test 1: Direct URL (without pooler)
  try {
    const directPrisma = new PrismaClient({
      datasources: { db: { url: directUrl } },
    });
    const t0 = Date.now();
    const studentsDirect = await directPrisma.student.count();
    results.directConnection = {
      ok: true,
      elapsedMs: Date.now() - t0,
      studentsCount: studentsDirect,
    };
    await directPrisma.$disconnect();
  } catch (err: any) {
    results.directConnection = {
      ok: false,
      errorName: err?.name,
      errorMessage: err?.message,
    };
  }

  // Test 2: Pooler URL
  try {
    const poolerPrisma = new PrismaClient({
      datasources: { db: { url: dbUrl } },
    });
    const t0 = Date.now();
    const studentsPooler = await poolerPrisma.student.count();
    results.poolerConnection = {
      ok: true,
      elapsedMs: Date.now() - t0,
      studentsCount: studentsPooler,
    };
    await poolerPrisma.$disconnect();
  } catch (err: any) {
    results.poolerConnection = {
      ok: false,
      errorName: err?.name,
      errorMessage: err?.message,
    };
  }

  return NextResponse.json(results);
}
