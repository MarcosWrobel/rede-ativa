import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { isBootstrapAdminEmail, requireAdmin } from "@/lib/permissions";

export async function GET() {
  try {
    const authCheck = await requireAdmin();
    if (!authCheck.ok) return authCheck.response;

    const users = await prisma.user.findMany({
      include: {
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
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const authCheck = await requireAdmin();
    if (!authCheck.ok) return authCheck.response;

    const body = await req.json();
    const rawEmail = String(body.email || "").toLowerCase().trim();
    const rawName = String(body.name || "").trim();
    const role = body.role === "ADMIN" ? "ADMIN" : "PEDAGOGA";

    if (!rawEmail || !rawEmail.endsWith("@escola.pr.gov.br")) {
      return NextResponse.json(
        { error: "Informe um e-mail institucional válido terminado em @escola.pr.gov.br." },
        { status: 400 }
      );
    }

    const existing = await prisma.user.findUnique({ where: { email: rawEmail } });
    if (existing) {
      return NextResponse.json(
        { error: "Este e-mail já está cadastrado na equipe. Você pode reativá-lo ou alterar o perfil na tabela." },
        { status: 409 }
      );
    }

    const defaultName =
      rawName ||
      rawEmail
        .split("@")[0]
        .replace(/[._-]+/g, " ")
        .replace(/\b\w/g, (l) => l.toUpperCase());

    const created = await prisma.user.create({
      data: {
        email: rawEmail,
        name: defaultName,
        role: isBootstrapAdminEmail(rawEmail) ? "ADMIN" : role,
        active: true,
      },
      include: {
        _count: {
          select: { messageLogs: true, repliedLogs: true },
        },
      },
    });

    await logAudit({
      action: "CREATE_USER",
      entityType: "User",
      entityId: created.id,
      details: {
        authorizedEmail: created.email,
        name: created.name,
        role: created.role,
      },
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      req,
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
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

    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) {
      return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });
    }

    const isSelf = target.email.toLowerCase().trim() === authCheck.email;
    const isRoot = isBootstrapAdminEmail(target.email);

    if ((isSelf || isRoot) && active === false) {
      return NextResponse.json(
        { error: "Não é permitido desativar o administrador principal ou a própria conta logada." },
        { status: 400 }
      );
    }

    if ((isSelf || isRoot) && role && role !== "ADMIN") {
      return NextResponse.json(
        { error: "Não é permitido remover o perfil ADMIN da própria conta ou do administrador raiz." },
        { status: 400 }
      );
    }

    const nextRole =
      role !== undefined ? (role === "ADMIN" ? "ADMIN" : "PEDAGOGA") : target.role;
    const nextActive = active !== undefined ? Boolean(active) : target.active;
    const nextName = name !== undefined && String(name).trim() ? String(name).trim() : target.name;

    const updated = await prisma.user.update({
      where: { id },
      data: {
        name: nextName,
        role: isRoot ? "ADMIN" : nextRole,
        active: isRoot ? true : nextActive,
      },
      include: {
        _count: {
          select: { messageLogs: true, repliedLogs: true },
        },
      },
    });

    await logAudit({
      action: nextActive === false && target.active === true ? "DEACTIVATE_USER" : "UPDATE_USER",
      entityType: "User",
      entityId: updated.id,
      details: {
        targetEmail: updated.email,
        before: { name: target.name, role: target.role, active: target.active },
        after: { name: updated.name, role: updated.role, active: updated.active },
      },
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      req,
    });

    return NextResponse.json(updated);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
