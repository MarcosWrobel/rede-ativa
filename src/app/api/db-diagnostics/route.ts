import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const dbUrl = process.env.DATABASE_URL || "";
  // Mascara a senha para segurança
  const maskedUrl = dbUrl.replace(/:([^:@]+)@/, ":*****@");

  try {
    const t0 = Date.now();
    const [userCount, studentCount, schoolCount] = await Promise.all([
      prisma.user.count(),
      prisma.student.count(),
      prisma.school.count(),
    ]);

    return NextResponse.json({
      status: "ok",
      elapsedMs: Date.now() - t0,
      databaseUrl: maskedUrl,
      hasPooler: dbUrl.includes("-pooler"),
      counts: {
        users: userCount,
        students: studentCount,
        schools: schoolCount,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        status: "error",
        errorName: err?.name,
        errorCode: err?.code,
        errorMessage: err?.message,
        errorStack: err?.stack,
        databaseUrl: maskedUrl,
        hasPooler: dbUrl.includes("-pooler"),
      },
      { status: 500 }
    );
  }
}
