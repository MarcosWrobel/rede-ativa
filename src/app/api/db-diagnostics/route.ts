import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const dbUrl = process.env.DATABASE_URL || "";
  const directUrl = process.env.DIRECT_URL || "";

  try {
    const t0 = Date.now();
    const [userCount, studentCount, classGroupCount, messageLogCount] = await Promise.all([
      prisma.user.count(),
      prisma.student.count(),
      prisma.classGroup.count(),
      prisma.messageLog.count(),
    ]);

    return NextResponse.json({
      ok: true,
      elapsedMs: Date.now() - t0,
      envDatabaseUrl: dbUrl.replace(/:([^:@]+)@/, ":*****@"),
      envDirectUrl: directUrl.replace(/:([^:@]+)@/, ":*****@"),
      data: {
        users: userCount,
        students: studentCount,
        classGroups: classGroupCount,
        messageLogs: messageLogCount,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        errorName: err?.name,
        errorMessage: err?.message,
        envDatabaseUrl: dbUrl.replace(/:([^:@]+)@/, ":*****@"),
      },
      { status: 500 }
    );
  }
}
