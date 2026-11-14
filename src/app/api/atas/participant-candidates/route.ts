import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, checkIsSuperAdmin } from "@/lib/permissions";
import { getCurrentSchool } from "@/lib/currentSchool";
import { assertTenantOwnership } from "@/lib/tenantGuard";
import { canAccessConfidentialMinute } from "@/lib/ataCrypto";

export const dynamic = "force-dynamic";

const MAX_STUDENT_IDS = 50;
const STAFF_CANDIDATES_LIMIT = 200;

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
};

function parseStudentIdsParam(searchParams: URLSearchParams): string[] {
  const collected: string[] = [];
  for (const raw of searchParams.getAll("studentIds")) {
    for (const piece of raw.split(",")) {
      const trimmed = piece.trim();
      if (trimmed) collected.push(trimmed);
    }
  }
  return Array.from(new Set(collected));
}

async function verifyActiveSchoolCandidateAccess(
  userId: string,
  session: any,
  currentSchoolId: string
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const dbUser = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      active: true,
      role: true,
      schoolId: true,
      schools: {
        select: { schoolId: true, active: true },
      },
      networks: {
        select: {
          active: true,
          networkId: true,
          network: {
            select: { id: true, city: true, active: true },
          },
        },
      },
    },
  });

  if (!dbUser || dbUser.active === false) {
    return {
      ok: false,
      status: 403,
      error: "Usuário inativo ou sem permissão ativa para consultar participantes.",
    };
  }

  if (checkIsSuperAdmin(session)) {
    return { ok: true };
  }

  const schoolLink = (dbUser.schools || []).find((s) => s.schoolId === currentSchoolId);
  if (schoolLink && schoolLink.active === false) {
    return {
      ok: false,
      status: 403,
      error: "Vínculo com esta unidade escolar está inativo.",
    };
  }

  const hasDirectSchoolAccess =
    (dbUser.schoolId === currentSchoolId && (!schoolLink || schoolLink.active !== false)) ||
    Boolean(schoolLink && schoolLink.active !== false);

  if (hasDirectSchoolAccess) {
    return { ok: true };
  }

  // Para GESTAO_SECRETARIA, comprova vínculo ativo com a rede/município da escola solicitada no banco
  const normalizedRole = (dbUser.role || session?.user?.role || "").trim().toUpperCase();
  if (normalizedRole === "GESTAO_SECRETARIA") {
    const activeNetworks = (dbUser.networks || []).filter(
      (link) => link.active !== false && link.network && link.network.active !== false
    );
    if (activeNetworks.length > 0) {
      const targetSchool = await prisma.school.findUnique({
        where: { id: currentSchoolId },
        select: {
          id: true,
          active: true,
          networkId: true,
          network: true,
          city: true,
        },
      });

      if (targetSchool && targetSchool.active !== false) {
        const schoolCity = (targetSchool.city || "").trim().toLowerCase();
        const matchesNetwork = activeNetworks.some((link) => {
          if (targetSchool.networkId && link.networkId === targetSchool.networkId) {
            return true;
          }
          const linkCity = (link.network?.city || "").trim().toLowerCase();
          return (
            (targetSchool.network || "ESTADUAL") === "MUNICIPAL" &&
            Boolean(schoolCity) &&
            Boolean(linkCity) &&
            schoolCity === linkCity
          );
        });

        if (matchesNetwork) {
          return { ok: true };
        }
      }
    }
  }

  return {
    ok: false,
    status: 403,
    error: "Acesso negado aos participantes desta unidade escolar.",
  };
}

export async function GET(req: Request) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const currentSchool = await getCurrentSchool(authCheck.schoolId);
    const { searchParams } = new URL(req.url);

    const requestedSchoolId = searchParams.get("schoolId")?.trim();
    if (requestedSchoolId && requestedSchoolId !== currentSchool.id) {
      return NextResponse.json(
        { error: "Escola solicitada não corresponde ao contexto ativo da sessão." },
        { status: 403, headers: NO_STORE_HEADERS }
      );
    }

    if (!authCheck.userId) {
      return NextResponse.json(
        { error: "Sessão sem identificador de usuário válido." },
        { status: 401, headers: NO_STORE_HEADERS }
      );
    }

    const accessCheck = await verifyActiveSchoolCandidateAccess(
      authCheck.userId,
      authCheck.session,
      currentSchool.id
    );
    if (!accessCheck.ok) {
      return NextResponse.json(
        { error: accessCheck.error },
        { status: accessCheck.status, headers: NO_STORE_HEADERS }
      );
    }

    const partParam = (searchParams.get("part") || "all").trim().toLowerCase();
    if (partParam !== "all" && partParam !== "staff" && partParam !== "contacts") {
      return NextResponse.json(
        { error: "Parâmetro 'part' inválido." },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    const minuteId = searchParams.get("minuteId")?.trim() || null;
    let allowedInactiveStudentIds = new Set<string>();

    if (minuteId) {
      const minute = await prisma.pedagogicalMinute.findUnique({
        where: { id: minuteId },
        select: {
          id: true,
          schoolId: true,
          isConfidential: true,
          authorId: true,
          authorEmail: true,
          students: { select: { studentId: true } },
          participants: { select: { studentId: true } },
        },
      });

      if (!minute) {
        return NextResponse.json(
          { error: "Ata pedagógica não encontrada." },
          { status: 404, headers: NO_STORE_HEADERS }
        );
      }

      if (!assertTenantOwnership(minute.schoolId, currentSchool.id, authCheck.session)) {
        return NextResponse.json(
          { error: "Acesso negado a registro de outra instituição de ensino." },
          { status: 403, headers: NO_STORE_HEADERS }
        );
      }

      if (!canAccessConfidentialMinute(minute, authCheck.session)) {
        return NextResponse.json(
          { error: "Esta ata possui Sigilo Reforçado restrito à Direção Escolar e ao servidor autor." },
          { status: 403, headers: NO_STORE_HEADERS }
        );
      }

      allowedInactiveStudentIds = new Set<string>([
        ...(minute.students || []).map((s) => s.studentId).filter(Boolean),
        ...(minute.participants || [])
          .map((p) => p.studentId)
          .filter((id): id is string => Boolean(id)),
      ]);
    }

    const uniqueStudentIds = parseStudentIdsParam(searchParams);
    if (uniqueStudentIds.length > MAX_STUDENT_IDS) {
      return NextResponse.json(
        { error: `Selecione no máximo ${MAX_STUDENT_IDS} estudantes por consulta.` },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    let staff: Array<{ id: string; name: string; email: string }> | undefined;
    let staffTruncated: boolean | undefined;

    if (partParam === "all" || partParam === "staff") {
      const staffRows = await prisma.user.findMany({
        where: {
          active: true,
          OR: [
            { schoolId: currentSchool.id },
            { schools: { some: { schoolId: currentSchool.id, active: true } } },
          ],
          NOT: {
            schools: { some: { schoolId: currentSchool.id, active: false } },
          },
        },
        orderBy: [{ name: "asc" }, { email: "asc" }],
        take: STAFF_CANDIDATES_LIMIT + 1,
        select: {
          id: true,
          name: true,
          email: true,
        },
      });

      staffTruncated = staffRows.length > STAFF_CANDIDATES_LIMIT;
      staff = staffRows.slice(0, STAFF_CANDIDATES_LIMIT).map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
      }));
    }

    let students:
      | Array<{
          id: string;
          name: string;
          classGroupName: string | null;
          cgm: string | null;
          phone: string | null;
          email: string | null;
          guardianName: string | null;
          isInactiveRecord: boolean;
          contacts: Array<{
            id: string;
            studentId: string;
            name: string;
            kinship: string;
            phone: string;
            isPrimary: boolean;
          }>;
        }>
      | undefined;

    if (partParam === "all" || partParam === "contacts") {
      if (uniqueStudentIds.length === 0) {
        students = [];
      } else {
        const studentsDb = await prisma.student.findMany({
          where: {
            id: { in: uniqueStudentIds },
            schoolId: currentSchool.id,
          },
          select: {
            id: true,
            name: true,
            cgm: true,
            phone: true,
            email: true,
            guardianName: true,
            active: true,
            classGroup: { select: { name: true } },
            contacts: {
              orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
              select: {
                id: true,
                studentId: true,
                name: true,
                kinship: true,
                phone: true,
                isPrimary: true,
              },
            },
          },
        });

        if (studentsDb.length !== uniqueStudentIds.length) {
          return NextResponse.json(
            { error: "Um ou mais estudantes informados não pertencem a esta unidade escolar." },
            { status: 403, headers: NO_STORE_HEADERS }
          );
        }

        const disallowedInactive = studentsDb.find(
          (s) => s.active === false && !allowedInactiveStudentIds.has(s.id)
        );
        if (disallowedInactive) {
          return NextResponse.json(
            { error: "Estudante com matrícula inativa só pode ser carregado na ata histórica em que já está vinculado." },
            { status: 403, headers: NO_STORE_HEADERS }
          );
        }

        const studentOrder = new Map(uniqueStudentIds.map((id, idx) => [id, idx]));
        studentsDb.sort(
          (a, b) => (studentOrder.get(a.id) ?? 0) - (studentOrder.get(b.id) ?? 0)
        );

        students = studentsDb.map((s) => ({
          id: s.id,
          name: s.name,
          classGroupName: s.classGroup?.name || null,
          cgm: s.cgm || null,
          phone: s.phone || null,
          email: s.email || null,
          guardianName: s.guardianName || null,
          isInactiveRecord: s.active === false,
          contacts: (s.contacts || []).map((c) => ({
            id: c.id,
            studentId: c.studentId,
            name: c.name,
            kinship: c.kinship,
            phone: c.phone,
            isPrimary: Boolean(c.isPrimary),
          })),
        }));
      }
    }

    return NextResponse.json(
      {
        schoolId: currentSchool.id,
        ...(staff !== undefined ? { staff, staffTruncated } : {}),
        ...(students !== undefined ? { students } : {}),
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    console.error("[GET /api/atas/participant-candidates] Erro:", error);
    return NextResponse.json(
      { error: "Erro ao consultar sugestões de participantes." },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
