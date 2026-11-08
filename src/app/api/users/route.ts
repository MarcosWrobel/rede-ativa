import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { isBootstrapAdminEmail, requireAdmin, checkIsSuperAdmin } from "@/lib/permissions";
import { formatZodError, userCreateSchema } from "@/lib/schemas";
import { getCurrentSchool } from "@/lib/currentSchool";

export async function GET(req: Request) {
  try {
    const authCheck = await requireAdmin();
    if (!authCheck.ok) return authCheck.response;

    const url = new URL(req.url);
    const viewAll = url.searchParams.get("all") === "true";
    const currentSchool = await getCurrentSchool(authCheck.schoolId);
    const isSuper = checkIsSuperAdmin(authCheck.session);

    // Por padrão, filtra estritamente pela escola ativa.
    // Apenas SuperAdmin com flag explícita ?all=true visualiza o catálogo global.
    const whereClause: any =
      viewAll && isSuper
        ? {}
        : {
            OR: [
              { schoolId: currentSchool.id },
              { schools: { some: { schoolId: currentSchool.id, active: true } } },
            ],
          };

    const users = await prisma.user.findMany({
      where: whereClause,
      include: {
        schools: {
          where: viewAll && isSuper ? undefined : { schoolId: currentSchool.id },
          include: {
            school: {
              select: { id: true, name: true, inepCode: true, network: true },
            },
          },
        },
        _count: {
          select: {
            messageLogs: true,
            repliedLogs: true,
          },
        },
      },
      orderBy: [{ active: "desc" }, { role: "asc" }, { name: "asc" }],
    });

    return NextResponse.json(users);
  } catch (error: any) {
    console.error("Erro ao listar equipe:", error);
    return NextResponse.json({ error: "Erro ao listar equipe." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const authCheck = await requireAdmin();
    if (!authCheck.ok) return authCheck.response;

    const body = await req.json();
    const parsed = userCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: formatZodError(parsed.error) },
        { status: 400 }
      );
    }

    const { email: rawEmail, name: rawName, role: rawRole } = parsed.data;
    const isSuperAdminEmail = isBootstrapAdminEmail(rawEmail);
    const effectiveRole = isSuperAdminEmail ? "SUPERADMIN" : rawRole || "PEDAGOGA";

    const isCallerSuper = checkIsSuperAdmin(authCheck.session);
    if (!isCallerSuper && (effectiveRole === "SUPERADMIN" || effectiveRole === "GESTAO_SECRETARIA" || effectiveRole === "ADMIN")) {
      return NextResponse.json(
        { error: "Você não possui permissão para conceder este perfil de acesso elevado." },
        { status: 403 }
      );
    }

    const currentSchool = await getCurrentSchool(authCheck.schoolId);
    const targetSchoolId = currentSchool.id;

    // Busca os dados da escola ativa para verificar eventual vínculo com Rede Municipal
    const schoolDb = await prisma.school.findUnique({
      where: { id: targetSchoolId },
      select: { id: true, networkId: true, name: true },
    });

    const defaultName =
      rawName ||
      rawEmail
        .split("@")[0]
        .replace(/[._-]+/g, " ")
        .replace(/\b\w/g, (l) => l.toUpperCase());

    const existing = await prisma.user.findUnique({
      where: { email: rawEmail },
      include: {
        schools: { where: { schoolId: targetSchoolId } },
      },
    });

    let targetUser: any;

    if (existing) {
      const activeLink = existing.schools.find((s) => s.schoolId === targetSchoolId && s.active);
      if (activeLink) {
        return NextResponse.json(
          { error: `Este e-mail já faz parte da equipe de ${schoolDb?.name || "esta escola"}. Altere o perfil diretamente na tabela abaixo.` },
          { status: 409 }
        );
      }

      // Usuário já existe no SaaS (ex: em outra escola) — adiciona o vínculo com a escola atual
      await prisma.userSchool.upsert({
        where: {
          userId_schoolId: {
            userId: existing.id,
            schoolId: targetSchoolId,
          },
        },
        update: { role: effectiveRole, active: true },
        create: {
          userId: existing.id,
          schoolId: targetSchoolId,
          role: effectiveRole,
          active: true,
        },
      });

      targetUser = await prisma.user.update({
        where: { id: existing.id },
        data: {
          // Se o usuário não tinha schoolId primário, vincula a esta escola
          ...(existing.schoolId ? {} : { schoolId: targetSchoolId }),
          // Atualiza role se foi atribuído um perfil superior
          ...(effectiveRole === "SUPERADMIN" || effectiveRole === "GESTAO_SECRETARIA" || effectiveRole === "GESTOR_ESCOLAR"
            ? { role: effectiveRole }
            : {}),
          active: true,
        },
        include: {
          schools: { where: { schoolId: targetSchoolId } },
          _count: { select: { messageLogs: true, repliedLogs: true } },
        },
      });
    } else {
      // Cria novo usuário na plataforma vinculado à escola ativa
      targetUser = await prisma.user.create({
        data: {
          email: rawEmail,
          name: defaultName,
          role: effectiveRole,
          schoolId: targetSchoolId,
          active: true,
          schools: {
            create: {
              schoolId: targetSchoolId,
              role: effectiveRole,
              active: true,
            },
          },
        },
        include: {
          schools: { where: { schoolId: targetSchoolId } },
          _count: { select: { messageLogs: true, repliedLogs: true } },
        },
      });
    }

    // Se o perfil for Gestão da Secretaria e a escola pertencer a uma rede municipal, vincula em UserNetwork
    if (effectiveRole === "GESTAO_SECRETARIA" && schoolDb?.networkId) {
      await prisma.userNetwork.upsert({
        where: {
          userId_networkId: {
            userId: targetUser.id,
            networkId: schoolDb.networkId,
          },
        },
        update: { role: "GESTAO_SECRETARIA", active: true },
        create: {
          userId: targetUser.id,
          networkId: schoolDb.networkId,
          role: "GESTAO_SECRETARIA",
          active: true,
        },
      });
    }

    await logAudit({
      action: "CREATE_USER",
      entityType: "User",
      entityId: targetUser.id,
      details: {
        authorizedEmail: targetUser.email,
        name: targetUser.name,
        role: effectiveRole,
        schoolId: targetSchoolId,
        schoolName: schoolDb?.name,
      },
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      schoolId: targetSchoolId,
      req,
    });

    return NextResponse.json(targetUser, { status: 201 });
  } catch (error: any) {
    console.error("Erro ao convidar membro da equipe:", error);
    return NextResponse.json({ error: "Erro ao convidar membro da equipe." }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const authCheck = await requireAdmin();
    if (!authCheck.ok) return authCheck.response;

    const body = await req.json();
    const { id, name, role, active } = body;

    if (!id) {
      return NextResponse.json({ error: "ID do usuário é obrigatório." }, { status: 400 });
    }

    const target = await prisma.user.findUnique({
      where: { id },
      include: { schools: true },
    });
    if (!target) {
      return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });
    }

    const currentSchool = await getCurrentSchool(authCheck.schoolId);
    const targetSchoolId = currentSchool.id;
    const isCallerSuper = checkIsSuperAdmin(authCheck.session);

    // Validação de posse de inquilino: o usuário alvo precisa ter vínculo com esta instituição
    const isDefaultSchoolContext =
      targetSchoolId === "default-leopoldina" ||
      currentSchool.inepCode === "41042730";

    const isLinkedToCurrentSchool =
      target.schoolId === targetSchoolId ||
      target.schools.some((s) => s.schoolId === targetSchoolId) ||
      ((!target.schoolId || target.schoolId === "default-leopoldina") && isDefaultSchoolContext);

    if (!isCallerSuper && !isLinkedToCurrentSchool) {
      return NextResponse.json(
        { error: "Acesso negado: o usuário não pertence à equipe desta instituição escolar." },
        { status: 403 }
      );
    }

    // Teto de privilégios: não-SuperAdmins não podem elevar para SUPERADMIN, GESTAO_SECRETARIA ou ADMIN
    if (!isCallerSuper && role && (role === "SUPERADMIN" || role === "GESTAO_SECRETARIA" || role === "ADMIN")) {
      return NextResponse.json(
        { error: "Você não possui permissão para conceder este perfil de acesso elevado." },
        { status: 403 }
      );
    }

    const isSelf = target.email.toLowerCase().trim() === authCheck.email;
    const isRoot = isBootstrapAdminEmail(target.email);

    if ((isSelf || isRoot) && active === false) {
      return NextResponse.json(
        { error: "Não é permitido desativar o administrador principal ou a própria conta logada." },
        { status: 400 }
      );
    }

    if ((isSelf || isRoot) && role && role !== "SUPERADMIN" && role !== "ADMIN") {
      return NextResponse.json(
        { error: "Não é permitido rebaixar o perfil ADMIN da própria conta ou do administrador raiz." },
        { status: 400 }
      );
    }

    const validRoles = ["SUPERADMIN", "ADMIN", "GESTAO_SECRETARIA", "GESTOR_ESCOLAR", "PEDAGOGA"];
    let nextRole = target.role;
    if (role !== undefined && validRoles.includes(role)) {
      nextRole = role;
    }

    const nextActive = active !== undefined ? Boolean(active) : target.active;
    const nextName = name !== undefined && String(name).trim() ? String(name).trim() : target.name;

    // Atualiza o perfil global do usuário
    const updated = await prisma.user.update({
      where: { id },
      data: {
        name: nextName,
        role: isRoot ? "SUPERADMIN" : nextRole,
        active: isRoot ? true : nextActive,
      },
      include: {
        schools: { where: { schoolId: targetSchoolId } },
        _count: {
          select: { messageLogs: true, repliedLogs: true },
        },
      },
    });

    // Atualiza também o vínculo local do usuário com esta escola ativa
    await prisma.userSchool.upsert({
      where: {
        userId_schoolId: {
          userId: id,
          schoolId: targetSchoolId,
        },
      },
      update: {
        role: isRoot ? "SUPERADMIN" : nextRole,
        active: isRoot ? true : nextActive,
      },
      create: {
        userId: id,
        schoolId: targetSchoolId,
        role: isRoot ? "SUPERADMIN" : nextRole,
        active: isRoot ? true : nextActive,
      },
    });

    await logAudit({
      action: nextActive === false && target.active === true ? "DEACTIVATE_USER" : "UPDATE_USER",
      entityType: "User",
      entityId: updated.id,
      details: {
        targetEmail: updated.email,
        schoolId: targetSchoolId,
        before: { name: target.name, role: target.role, active: target.active },
        after: { name: updated.name, role: nextRole, active: updated.active },
      },
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      schoolId: targetSchoolId,
      req,
    });

    return NextResponse.json(updated);
  } catch (error: any) {
    console.error("Erro ao atualizar membro da equipe:", error);
    return NextResponse.json({ error: "Erro ao atualizar membro da equipe." }, { status: 500 });
  }
}
