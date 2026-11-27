import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/permissions";
import {
  isValidPdfBuffer,
  mergeParsedSereCouncilReports,
  parseSereCouncilPdfBuffer,
  SERE_COUNCIL_PDF_MAX_FILE_BYTES,
  SERE_COUNCIL_PDF_MAX_FILES,
  type ParsedSereCouncilPdfReport,
} from "@/lib/sereCouncilPdfParser";
import {
  canMutateSchoolCouncil,
  CouncilDomainError,
  findCouncilBoardOwnershipRecord,
  isCouncilBoardAuthorizedInActiveSchool,
  resolveAuthorizedSchoolForCouncil,
  resolveCouncilHttpError,
  resolveExplicitSelectedSchoolForCouncil,
} from "@/services/classCouncilService";
import {
  applyCouncilSerePdfImport,
  previewCouncilSerePdfImport,
} from "@/services/classCouncilSerePdfService";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ boardId: string }> }
) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const { boardId } = await params;
    const school = await resolveAuthorizedSchoolForCouncil(authCheck.session, authCheck.schoolId);

    if (!school || !canMutateSchoolCouncil(authCheck.session, school.id)) {
      return NextResponse.json(
        { error: "Perfil em modo somente leitura para esta instituição escolar." },
        { status: 403 }
      );
    }

    const ownership = await findCouncilBoardOwnershipRecord(boardId);
    if (!ownership) {
      return NextResponse.json(
        { error: "Conselho de classe não encontrado." },
        { status: 404 }
      );
    }

    if (
      !isCouncilBoardAuthorizedInActiveSchool(ownership, school, authCheck.session) ||
      (ownership.classGroup && ownership.classGroup.schoolId !== ownership.schoolId)
    ) {
      return NextResponse.json(
        { error: "Acesso negado a registro de outra instituição de ensino." },
        { status: 403 }
      );
    }

    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return NextResponse.json(
        { error: "Envie os arquivos em formato de formulário válido." },
        { status: 400 }
      );
    }

    const rawMode = String(formData.get("mode") || "preview").trim().toLowerCase();
    if (rawMode !== "preview" && rawMode !== "apply") {
      return NextResponse.json(
        { error: "Modo de importação inválido. Utilize prévia ou aplicação." },
        { status: 400 }
      );
    }

    if (rawMode === "apply") {
      const explicitSchool = await resolveExplicitSelectedSchoolForCouncil(
        authCheck.session,
        undefined,
        authCheck.snapshot
      );
      if (!explicitSchool || explicitSchool.id !== school.id) {
        return NextResponse.json(
          { error: "Selecione explicitamente uma instituição escolar autorizada para aplicar a importação." },
          { status: 403 }
        );
      }
    }

    const rawEntries = [...formData.getAll("files"), ...formData.getAll("file")];
    const files = rawEntries.filter(
      (entry): entry is File =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as File).arrayBuffer === "function" &&
        typeof (entry as File).name === "string"
    );

    if (files.length === 0) {
      return NextResponse.json(
        { error: "Selecione pelo menos um arquivo PDF do SERE." },
        { status: 400 }
      );
    }

    if (files.length > SERE_COUNCIL_PDF_MAX_FILES) {
      return NextResponse.json(
        {
          error: `É possível enviar no máximo ${SERE_COUNCIL_PDF_MAX_FILES} arquivos PDF por importação.`,
        },
        { status: 400 }
      );
    }

    const parsedReports: ParsedSereCouncilPdfReport[] = [];

    for (const file of files) {
      const safeFileName = (file.name || "relatorio.pdf").slice(0, 140);
      if (file.size === 0) {
        return NextResponse.json(
          { error: `O arquivo "${safeFileName}" está vazio.` },
          { status: 400 }
        );
      }
      if (file.size > SERE_COUNCIL_PDF_MAX_FILE_BYTES) {
        return NextResponse.json(
          { error: `O arquivo "${safeFileName}" excede o limite de 10 MB.` },
          { status: 400 }
        );
      }

      const arrayBuffer = await file.arrayBuffer();
      const buffer = new Uint8Array(arrayBuffer);

      if (!isValidPdfBuffer(buffer)) {
        return NextResponse.json(
          {
            error: `O arquivo "${safeFileName}" não é um PDF válido. Exporte o Relatório de Acompanhamento Trimestral no SERE em formato PDF.`,
          },
          { status: 400 }
        );
      }

      try {
        const parsed = await parseSereCouncilPdfBuffer(buffer, safeFileName);
        parsedReports.push(parsed);
      } catch (parseErr) {
        const reason =
          parseErr instanceof Error && parseErr.message
            ? parseErr.message
            : `Não foi possível interpretar o arquivo "${safeFileName}".`;
        return NextResponse.json({ error: reason }, { status: 400 });
      }
    }

    const batch = mergeParsedSereCouncilReports(parsedReports);

    if (rawMode === "preview") {
      const preview = await previewCouncilSerePdfImport({
        boardId,
        schoolId: school.id,
        batch,
      });

      return NextResponse.json({
        success: true,
        mode: "preview",
        preview,
      });
    }

    const confirmShiftUpdate =
      String(formData.get("updateClassShift") || "")
        .trim()
        .toLowerCase() === "true";

    const actor = {
      id: authCheck.session.user?.id || undefined,
      name: authCheck.session.user?.name || "Equipe pedagógica",
      email: authCheck.session.user?.email || "sistema@redeativa.local",
    };

    const result = await applyCouncilSerePdfImport({
      boardId,
      schoolId: school.id,
      batch,
      actor,
      req,
      confirmShiftUpdate,
    });

    return NextResponse.json({
      success: true,
      mode: "apply",
      summary: result.summary,
      board: result.board,
    });
  } catch (err) {
    console.error("[POST /api/conselho-classe/[boardId]/import-pdf] Erro:", err);
    if (err instanceof CouncilDomainError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    const { status, message } = resolveCouncilHttpError(err);
    return NextResponse.json({ error: message }, { status });
  }
}
