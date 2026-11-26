import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import {
  isBootstrapAdminEmail,
  requireSchoolAdmin,
  requireSuperAdmin,
  checkIsSuperAdmin,
} from "@/lib/permissions";
import { formatZodError, userCreateSchema } from "@/lib/schemas";
import { requireAuthorizedSchool } from "@/lib/currentSchool";

const SAFE_USER_BASE_SELECT = {
  id: true,
  name: true,
  email: true,
  image: true,
  role: true,
  active: true,
  schoolId: true,
  createdAt: true,
  updatedAt: true,
} as const;

function buildSafeUserSelect(targetSchoolId?: string) {
  return {
    ...SAFE_USER_BASE_SELECT,
    schools: {
      where: targetSchoolId ? { schoolId: targetSchoolId } : undefined,
      select: {
        id: true,
        userId: true,
        schoolId: true,
        role: true,
        active: true,
        createdAt: true,
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
  } as const;
}

function sanitizeTeamUserResponse<T extends Record<string, any>>(
  user: T,
  targetSchoolId?: string
) {
  if (!user) return user;
  const schoolsList = Array.isArray(user.schools) ? user.schools : [];
  const localLink = targetSchoolId
    ? schoolsList.find((s: any) => s.schoolId === targetSchoolId)
    : undefined;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    image: user.image ?? null,
    role: localLink?.role || user.role,
    active: localLink !== undefined ? Boolean(localLink.active) : Boolean(user.active),
    globalRole: user.role,
    globalActive: Boolean(user.active),
    schoolActive: localLink !== undefined ? Boolean(localLink.active) : null,
    accountGloballyInactive: user.active === false,
    schoolId: user.schoolId ?? null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    schools: schoolsList,
    _count: user._count,
  };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const viewAll = url.searchParams.get("all") === "true";

    const authCheck = viewAll ? await requireSuperAdmin() : await requireSchoolAdmin();
    if (!authCheck.ok) return authCheck.response;

    const isSuper = checkIsSuperAdmin(authCheck.session);
    const useGlobalView = viewAll && isSuper;

    let currentSchoolId: string | undefined;
    if (!useGlobalView) {
      const schoolCheck = await requireAuthorizedSchool(
        authCheck.session,
        authCheck.schoolId,
        authCheck.snapshot
      );
      if (!schoolCheck.ok) return schoolCheck.response;
      currentSchoolId = schoolCheck.school.id;
    }

    const whereClause: any = useGlobalView
      ? {}
      : {
          schools: { some: { schoolId: currentSchoolId } },
        };

    const users = await prisma.user.findMany({
      where: whereClause,
      select: buildSafeUserSelect(useGlobalView ? undefined : currentSchoolId),
      orderBy: [{ active: "desc" }, { role: "asc" }, { name: "asc" }],
    });

    const sanitizedUsers = users.map((u) =>
      sanitizeTeamUserResponse(u, useGlobalView ? undefined : currentSchoolId)
    );

    return NextResponse.json(sanitizedUsers);
  } catch (error: any) {
    console.error("Erro ao listar equipe:", error);
    return NextResponse.json({ error: "Erro ao listar equipe." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const authCheck = await requireSchoolAdmin();
    if (!authCheck.ok) return authCheck.response;

    const schoolCheck = await requireAuthorizedSchool(
      authCheck.session,
      authCheck.schoolId,
      authCheck.snapshot
    );
    if (!schoolCheck.ok) return schoolCheck.response;
    const currentSchool = schoolCheck.school;

    const body = await req.json();
    const isCallerSuper = checkIsSuperAdmin(authCheck.session);
    if (
      !isCallerSuper &&
      body &&
      typeof body === "object" &&
      (body.scope === "global" ||
        Object.prototype.hasOwnProperty.call(body, "globalActive") ||
        Object.prototype.hasOwnProperty.call(body, "globalRole") ||
        Object.prototype.hasOwnProperty.call(body, "reactivateGlobal"))
    ) {
      return NextResponse.json(
        { error: "Alterações globais da conta exigem administração por SuperAdmin." },
        { status: 403 }
      );
    }

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

    if (
      !isCallerSuper &&
      (effectiveRole === "SUPERADMIN" ||
        effectiveRole === "GESTAO_SECRETARIA" ||
        effectiveRole === "ADMIN")
    ) {
      return NextResponse.json(
        { error: "Você não possui permissão para conceder este perfil de acesso elevado." },
        { status: 403 }
      );
    }

    const targetSchoolId = currentSchool.id;

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
      select: {
        ...SAFE_USER_BASE_SELECT,
        schools: {
          select: { id: true, schoolId: true, role: true, active: true },
        },
      },
    });

    let targetUser: any;

    if (existing) {
      const activeLink = existing.schools.find(
        (s) => s.schoolId === targetSchoolId && s.active
      );
      if (activeLink) {
        return NextResponse.json(
          {
            error: `Este e-mail já faz parte da equipe de ${schoolDb?.name || "esta escola"}. Altere o perfil diretamente na tabela abaixo.`,
          },
          { status: 409 }
        );
      }

      // Gestão escolar local altera/reativa exclusivamente o vínculo UserSchool da unidade,
      // preservando integralmente User.role, User.active (inclusive se inativa), User.schoolId e UserNetwork.
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

      const reloaded = await prisma.user.findUnique({
        where: { id: existing.id },
        select: buildSafeUserSelect(targetSchoolId),
      });
      targetUser = reloaded || {
        ...existing,
        schools: [
          {
            userId: existing.id,
            schoolId: targetSchoolId,
            role: effectiveRole,
            active: true,
          },
        ],
      };
    } else {
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
        select: buildSafeUserSelect(targetSchoolId),
      });
    }

    if (isCallerSuper && effectiveRole === "GESTAO_SECRETARIA" && schoolDb?.networkId) {
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
        existingAccount: Boolean(existing),
        scopedToSchoolOnly: Boolean(existing),
        globalActivePreserved: existing ? Boolean(existing.active) : true,
      },
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      schoolId: targetSchoolId,
      req,
    });

    return NextResponse.json(
      sanitizeTeamUserResponse(targetUser, targetSchoolId),
      { status: 201 }
    );
  } catch (error: any) {
    console.error("Erro ao convidar membro da equipe:", error);
    return NextResponse.json({ error: "Erro ao convidar membro da equipe." }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const rawScope =
      typeof body?.scope === "string" ? body.scope.trim().toLowerCase() : "school";

    if (rawScope !== "school" && rawScope !== "global") {
      const guard = await requireSchoolAdmin();
      if (!guard.ok) return guard.response;
      return NextResponse.json(
        { error: "Escopo de atualização inválido. Utilize 'school' ou 'global'." },
        { status: 400 }
      );
    }

    const validRoles = ["SUPERADMIN", "ADMIN", "GESTAO_SECRETARIA", "GESTOR_ESCOLAR", "PEDAGOGA"];

    if (rawScope === "global") {
      const superCheck = await requireSuperAdmin();
      if (!superCheck.ok) return superCheck.response;

      const { id, name, role, active } = body;
      if (!id) {
        return NextResponse.json({ error: "ID do usuário é obrigatório." }, { status: 400 });
      }

      if (role !== undefined && !validRoles.includes(role)) {
        return NextResponse.json({ error: "Perfil de usuário inválido." }, { status: 400 });
      }

      const target = await prisma.user.findUnique({
        where: { id },
        select: buildSafeUserSelect(),
      });
      if (!target) {
        return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });
      }

      const isSelf = target.email.toLowerCase().trim() === superCheck.email;
      const isRoot = isBootstrapAdminEmail(target.email);

      if ((isSelf || isRoot) && active === false) {
        return NextResponse.json(
          { error: "Não é permitido desativar o administrador principal ou a própria conta logada." },
          { status: 400 }
        );
      }

      if ((isSelf || isRoot) && role && role !== "SUPERADMIN") {
        return NextResponse.json(
          { error: "Não é permitido rebaixar o perfil administrativo da própria conta ou do administrador raiz." },
          { status: 400 }
        );
      }

      const nextName =
        name !== undefined && String(name).trim() ? String(name).trim() : undefined;
      const nextGlobalRole = isRoot ? "SUPERADMIN" : role;
      const nextGlobalActive = isRoot ? true : active !== undefined ? Boolean(active) : undefined;

      const updated = await prisma.user.update({
        where: { id },
        data: {
          ...(nextName !== undefined ? { name: nextName } : {}),
          ...(nextGlobalRole !== undefined ? { role: nextGlobalRole } : {}),
          ...(nextGlobalActive !== undefined ? { active: nextGlobalActive } : {}),
        },
        select: buildSafeUserSelect(),
      });

      await logAudit({
        action:
          nextGlobalActive === false && target.active === true
            ? "DEACTIVATE_USER"
            : "UPDATE_USER_GLOBAL",
        entityType: "User",
        entityId: updated.id,
        details: {
          scope: "global",
          targetEmail: updated.email,
          before: {
            name: target.name,
            role: target.role,
            active: target.active,
          },
          after: {
            name: updated.name,
            role: updated.role,
            active: updated.active,
          },
          changedAt: new Date().toISOString(),
        },
        user: {
          id: superCheck.userId,
          name: superCheck.userName,
          email: superCheck.email,
        },
        schoolId: target.schoolId ?? null,
        req,
      });

      return NextResponse.json(sanitizeTeamUserResponse(updated));
    }

    const authCheck = await requireSchoolAdmin();
    if (!authCheck.ok) return authCheck.response;

    const schoolCheck = await requireAuthorizedSchool(
      authCheck.session,
      authCheck.schoolId,
      authCheck.snapshot
    );
    if (!schoolCheck.ok) return schoolCheck.response;
    const currentSchool = schoolCheck.school;

    const isCallerSuper = checkIsSuperAdmin(authCheck.session);
    if (
      !isCallerSuper &&
      body &&
      typeof body === "object" &&
      (Object.prototype.hasOwnProperty.call(body, "globalActive") ||
        Object.prototype.hasOwnProperty.call(body, "globalRole") ||
        Object.prototype.hasOwnProperty.call(body, "reactivateGlobal"))
    ) {
      return NextResponse.json(
        { error: "Alterações globais da conta exigem administração por SuperAdmin." },
        { status: 403 }
      );
    }

    const { id, role, active } = body;

    if (!id) {
      return NextResponse.json({ error: "ID do usuário é obrigatório." }, { status: 400 });
    }

    const target = await prisma.user.findUnique({
      where: { id },
      select: {
        ...SAFE_USER_BASE_SELECT,
        schools: {
          select: { id: true, schoolId: true, role: true, active: true },
        },
      },
    });
    if (!target) {
      return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });
    }

    const targetSchoolId = currentSchool.id;
    const currentLocalLink = target.schools.find((s) => s.schoolId === targetSchoolId);

    if (!currentLocalLink) {
      if (!isCallerSuper) {
        return NextResponse.json(
          { error: "Acesso negado: o usuário não possui vínculo com esta instituição escolar." },
          { status: 403 }
        );
      }
      return NextResponse.json(
        { error: "Vínculo escolar não encontrado para este usuário nesta unidade." },
        { status: 404 }
      );
    }

    if (
      !isCallerSuper &&
      role &&
      (role === "SUPERADMIN" || role === "GESTAO_SECRETARIA" || role === "ADMIN")
    ) {
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

    if ((isSelf || isRoot) && role && role !== "SUPERADMIN") {
      return NextResponse.json(
        { error: "Não é permitido rebaixar o perfil administrativo da própria conta ou do administrador raiz." },
        { status: 400 }
      );
    }

    if (role !== undefined && !validRoles.includes(role)) {
      return NextResponse.json({ error: "Perfil de usuário inválido." }, { status: 400 });
    }

    let nextRole = currentLocalLink.role || target.role;
    if (role !== undefined) {
      nextRole = role;
    }

    const nextActive =
      active !== undefined ? Boolean(active) : Boolean(currentLocalLink.active);

    const nextLinkRole = isRoot ? "SUPERADMIN" : nextRole;
    const nextLinkActive = isRoot ? true : nextActive;

    // Gestão local altera estritamente UserSchool da unidade ativa, sem mutar User.role,
    // User.active, User.schoolId nem vínculos UserNetwork de outras redes.
    if (typeof (prisma.userSchool as any).update === "function") {
      await (prisma.userSchool as any).update({
        where: {
          userId_schoolId: {
            userId: id,
            schoolId: targetSchoolId,
          },
        },
        data: {
          role: nextLinkRole,
          active: nextLinkActive,
        },
      });
    } else {
      await prisma.userSchool.upsert({
        where: {
          userId_schoolId: {
            userId: id,
            schoolId: targetSchoolId,
          },
        },
        update: {
          role: nextLinkRole,
          active: nextLinkActive,
        },
        create: {
          userId: id,
          schoolId: targetSchoolId,
          role: nextLinkRole,
          active: nextLinkActive,
        },
      });
    }

    const updated = await prisma.user.findUnique({
      where: { id },
      select: buildSafeUserSelect(targetSchoolId),
    });

    const responseUser = updated || {
      ...target,
      schools: [
        {
          id: currentLocalLink.id,
          userId: id,
          schoolId: targetSchoolId,
          role: nextLinkRole,
          active: nextLinkActive,
        },
      ],
    };

    await logAudit({
      action:
        nextLinkActive === false && currentLocalLink.active === true
          ? "DEACTIVATE_USER"
          : "UPDATE_USER",
      entityType: "User",
      entityId: responseUser.id || id,
      details: {
        scope: "school",
        targetEmail: responseUser.email || target.email,
        schoolId: targetSchoolId,
        scopedToSchoolOnly: true,
        globalActivePreserved: Boolean(target.active),
        before: {
          role: currentLocalLink.role,
          active: currentLocalLink.active,
        },
        after: {
          role: nextLinkRole,
          active: nextLinkActive,
        },
        changedAt: new Date().toISOString(),
      },
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      schoolId: targetSchoolId,
      req,
    });

    return NextResponse.json(sanitizeTeamUserResponse(responseUser, targetSchoolId));
  } catch (error: any) {
    console.error("Erro ao atualizar membro da equipe:", error);
    return NextResponse.json({ error: "Erro ao atualizar membro da equipe." }, { status: 500 });
  }
}
