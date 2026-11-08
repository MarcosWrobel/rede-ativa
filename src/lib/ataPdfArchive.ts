import fs from "fs";
import path from "path";
import crypto from "crypto";
import QRCode from "qrcode";
import { PDFDocument, rgb, PDFName, PDFString, PDFHexString } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { anonymizeOtherMinorsInText } from "./ataCrypto";
import { getAtaValidationUrl } from "./qrCode";

export interface GeneratePdfOptions {
  targetStudentId?: string;
  verificationOrigin?: string;
}

export interface PdfArchiveResult {
  pdfBytes: Uint8Array;
  sha256: string;
  filename: string;
}

function escapeXml(unsafe: string): string {
  return (unsafe || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildXmpMetadata(minute: any, sha256Hex: string): string {
  const nowIso = new Date().toISOString();
  const createdIso = minute.finalizedAt
    ? new Date(minute.finalizedAt).toISOString()
    : new Date(minute.attendedAt || nowIso).toISOString();

  const title = `Ata Pedagógica Nº ${String(minute.ataNumber || 0).padStart(3, "0")}/${minute.year} - ${minute.subject || "Atendimento Pedagógico"}`;
  const author = minute.authorName ? `${minute.authorName} (${minute.authorEmail})` : "Rede Ativa SaaS";
  const desc = minute.agreementsSummary || minute.subject || "Livro Oficial de Atas do Atendimento Pedagógico";

  return `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
        xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
      <pdfaid:part>1</pdfaid:part>
      <pdfaid:conformance>B</pdfaid:conformance>
    </rdf:Description>
    <rdf:Description rdf:about=""
        xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:title>
        <rdf:Alt>
          <rdf:li xml:lang="x-default">${escapeXml(title)}</rdf:li>
        </rdf:Alt>
      </dc:title>
      <dc:creator>
        <rdf:Seq>
          <rdf:li>${escapeXml(author)}</rdf:li>
        </rdf:Seq>
      </dc:creator>
      <dc:description>
        <rdf:Alt>
          <rdf:li xml:lang="x-default">${escapeXml(desc)}</rdf:li>
        </rdf:Alt>
      </dc:description>
    </rdf:Description>
    <rdf:Description rdf:about=""
        xmlns:xmp="http://ns.adobe.com/xap/1.0/">
      <xmp:CreateDate>${createdIso}</xmp:CreateDate>
      <xmp:ModifyDate>${nowIso}</xmp:ModifyDate>
      <xmp:CreatorTool>Rede Ativa SaaS - Livro Oficial de Atas Pedagógicas (Lei 14.063/2020)</xmp:CreatorTool>
    </rdf:Description>
    <rdf:Description rdf:about=""
        xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/"
        xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">
      <pdfaProperty:verificationCode>${escapeXml(minute.verificationCode || "")}</pdfaProperty:verificationCode>
      <pdfaProperty:contentHash>${escapeXml(minute.contentHash || "")}</pdfaProperty:contentHash>
      <pdfaProperty:documentSha256>${escapeXml(sha256Hex)}</pdfaProperty:documentSha256>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

function getSchoolNetworkHeader(school: any) {
  const network = school?.network || "ESTADUAL";
  if (network === "MUNICIPAL") {
    return {
      line1: `Prefeitura Municipal de ${school?.city || "Município"} • Secretaria Municipal de Educação`,
      line2: school?.nre ? `Supervisão / Regional: ${school.nre}` : "Secretaria Municipal de Educação",
      unitType: "Escola Municipal",
    };
  }
  if (network === "PRIVADA") {
    return {
      line1: "Rede de Ensino Particular / Privada",
      line2: school?.nre ? `Supervisão Regional: ${school.nre}` : "Diretoria de Ensino",
      unitType: "Instituição de Ensino",
    };
  }
  return {
    line1: `Governo do Estado ${school?.state === "PR" ? "do Paraná" : `de ${school?.state || "PR"}`} • Secretaria de Estado da Educação — SEED-PR`,
    line2: `Núcleo Regional de Educação de ${school?.nre || school?.city || "Ponta Grossa"}`,
    unitType: "Colégio Estadual",
  };
}

export async function generateAtaPdfA1b(
  minute: any,
  options: GeneratePdfOptions = {}
): Promise<PdfArchiveResult> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  // 1. Carrega fontes TrueType reais embarcadas
  const fontsDir = path.join(process.cwd(), "src/lib/assets/fonts");
  const regularFontBytes = fs.readFileSync(path.join(fontsDir, "LiberationSans-Regular.ttf"));
  const boldFontBytes = fs.readFileSync(path.join(fontsDir, "LiberationSans-Bold.ttf"));

  const fontRegular = await pdfDoc.embedFont(regularFontBytes);
  const fontBold = await pdfDoc.embedFont(boldFontBytes);

  // 2. Embarca Perfil de Cor sRGB ICC (ISO 19005-1 OutputIntent /GTS_PDFA1)
  const iccPath = path.join(process.cwd(), "src/lib/assets/srgb.icc");
  const iccBytes = fs.readFileSync(iccPath);
  const iccStream = pdfDoc.context.flateStream(iccBytes, {
    N: 3,
    Alternate: PDFName.of("DeviceRGB"),
  });
  const iccRef = pdfDoc.context.register(iccStream);

  const outputIntentDict = pdfDoc.context.obj({
    Type: PDFName.of("OutputIntent"),
    S: PDFName.of("GTS_PDFA1"),
    OutputConditionIdentifier: PDFString.of("sRGB IEC61966-2.1"),
    RegistryName: PDFString.of("http://www.color.org"),
    Info: PDFString.of("sRGB IEC61966-2.1"),
    DestOutputProfile: iccRef,
  });
  const outputIntentRef = pdfDoc.context.register(outputIntentDict);
  pdfDoc.catalog.set(PDFName.of("OutputIntents"), pdfDoc.context.obj([outputIntentRef]));

  // 3. Anonimização de outros menores (ECA Art. 143) se emitido para entrega a estudante/responsável específico
  const linkedStudents = ((minute.students || []) as any[]).map((s: any) => ({
    id: s.studentId,
    name: s.studentNameSnapshot || "",
  }));
  const isTargeted = Boolean(options.targetStudentId);
  const safeSubject = isTargeted
    ? anonymizeOtherMinorsInText(minute.subject, options.targetStudentId, linkedStudents)
    : minute.subject;
  const safeSummary = isTargeted
    ? anonymizeOtherMinorsInText(minute.summary, options.targetStudentId, linkedStudents)
    : minute.summary;
  const safeAgreements = isTargeted && minute.agreementsSummary
    ? anonymizeOtherMinorsInText(minute.agreementsSummary, options.targetStudentId, linkedStudents)
    : minute.agreementsSummary;

  // 4. Monta Páginas com Paginação A4 (595.28 x 841.89 pt)
  const PAGE_WIDTH = 595.28;
  const PAGE_HEIGHT = 841.89;
  const MARGIN_LEFT = 45;
  const MARGIN_RIGHT = 45;
  const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;

  let currentPage = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - 45;

  const checkPageBreak = (neededHeight: number) => {
    if (y - neededHeight < 45) {
      currentPage = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - 45;
      return true;
    }
    return false;
  };

  const drawWrappedText = (
    text: string,
    fontSize: number,
    font: typeof fontRegular,
    color = rgb(0.1, 0.1, 0.1),
    lineSpacing = 3
  ) => {
    const words = (text || "").replace(/\r\n/g, "\n").split(/\s+/);
    let currentLine = "";
    const lineHeight = fontSize + lineSpacing;

    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      if (!word) continue;
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const width = font.widthOfTextAtSize(testLine, fontSize);

      if (width > CONTENT_WIDTH && currentLine) {
        checkPageBreak(lineHeight);
        currentPage.drawText(currentLine, { x: MARGIN_LEFT, y, size: fontSize, font, color });
        y -= lineHeight;
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }

    if (currentLine) {
      checkPageBreak(lineHeight);
      currentPage.drawText(currentLine, { x: MARGIN_LEFT, y, size: fontSize, font, color });
      y -= lineHeight;
    }
  };

  // Cabeçalho Oficial
  const networkHeader = getSchoolNetworkHeader(minute.school);
  currentPage.drawText(networkHeader.line1, {
    x: MARGIN_LEFT,
    y,
    size: 9,
    font: fontBold,
    color: rgb(0.2, 0.2, 0.2),
  });
  y -= 13;
  currentPage.drawText(networkHeader.line2, {
    x: MARGIN_LEFT,
    y,
    size: 8,
    font: fontRegular,
    color: rgb(0.4, 0.4, 0.4),
  });
  y -= 13;

  const schoolName = minute.school?.name || "Colégio Estadual Leopoldina B. Pedroso";
  const inepText = minute.school?.inepCode ? ` • INEP: ${minute.school.inepCode}` : "";
  currentPage.drawText(`${schoolName}${inepText}`, {
    x: MARGIN_LEFT,
    y,
    size: 11,
    font: fontBold,
    color: rgb(0.05, 0.1, 0.2),
  });
  y -= 18;

  // Linha divisória
  currentPage.drawLine({
    start: { x: MARGIN_LEFT, y },
    end: { x: PAGE_WIDTH - MARGIN_RIGHT, y },
    thickness: 1,
    color: rgb(0.8, 0.8, 0.8),
  });
  y -= 18;

  // Tarja de status (se VOIDED ou isConfidential)
  if (minute.status === "VOIDED") {
    currentPage.drawRectangle({
      x: MARGIN_LEFT,
      y: y - 18,
      width: CONTENT_WIDTH,
      height: 24,
      color: rgb(0.99, 0.9, 0.9),
      borderColor: rgb(0.85, 0.2, 0.2),
      borderWidth: 1,
    });
    currentPage.drawText("DOCUMENTO TORNADO SEM EFEITO POR AVERBAÇÃO OFICIAL (LEI 14.063/2020)", {
      x: MARGIN_LEFT + 10,
      y: y - 11,
      size: 8.5,
      font: fontBold,
      color: rgb(0.7, 0.1, 0.1),
    });
    y -= 30;
  } else if (minute.isConfidential) {
    currentPage.drawRectangle({
      x: MARGIN_LEFT,
      y: y - 18,
      width: CONTENT_WIDTH,
      height: 24,
      color: rgb(0.98, 0.94, 0.9),
      borderColor: rgb(0.85, 0.5, 0.1),
      borderWidth: 1,
    });
    currentPage.drawText("CONFIDENCIAL — SIGILO REFORÇADO (ESTATUTO DA CRIANÇA E DO ADOLESCENTE, ART. 143)", {
      x: MARGIN_LEFT + 10,
      y: y - 11,
      size: 8,
      font: fontBold,
      color: rgb(0.6, 0.3, 0.0),
    });
    y -= 30;
  }

  // Título e Número da Ata
  const numStr = minute.ataNumber ? String(minute.ataNumber).padStart(3, "0") : "S/N";
  currentPage.drawText(`LIVRO OFICIAL DE ATAS • ATA Nº ${numStr}/${minute.year}`, {
    x: MARGIN_LEFT,
    y,
    size: 13,
    font: fontBold,
    color: rgb(0.05, 0.15, 0.3),
  });
  y -= 16;

  // Assunto e Categoria
  currentPage.drawText(`Pauta: ${safeSubject}`, {
    x: MARGIN_LEFT,
    y,
    size: 10,
    font: fontBold,
    color: rgb(0.15, 0.15, 0.15),
  });
  y -= 13;

  const attendedDateStr = minute.attendedAt
    ? new Date(minute.attendedAt).toLocaleDateString("pt-BR")
    : "";
  currentPage.drawText(`Data do Atendimento: ${attendedDateStr} • Categoria: ${minute.category || "ACOMPANHAMENTO_PEDAGOGICO"}`, {
    x: MARGIN_LEFT,
    y,
    size: 8.5,
    font: fontRegular,
    color: rgb(0.35, 0.35, 0.35),
  });
  y -= 18;

  // Estudantes Vinculados ou Docentes Envolvidos
  const studentsArr = (minute.students || []) as any[];
  if (studentsArr.length > 0) {
    const studentNamesList = studentsArr.map((s) => {
      if (isTargeted && s.studentId !== options.targetStudentId) {
        return `${s.studentNameSnapshot?.slice(0, 2)}***`;
      }
      return `${s.studentNameSnapshot}${s.classNameSnapshot ? ` (${s.classNameSnapshot})` : ""}`;
    }).join(", ");

    currentPage.drawText("Estudante(s):", {
      x: MARGIN_LEFT,
      y,
      size: 8.5,
      font: fontBold,
      color: rgb(0.2, 0.2, 0.2),
    });
    y -= 11;
    drawWrappedText(studentNamesList, 8.5, fontRegular, rgb(0.2, 0.2, 0.2), 2);
    y -= 6;
  } else {
    const participantsArr = (minute.participants || []) as any[];
    const teacherParticipants = participantsArr.filter(
      (p: any) => p.role === "PROFESSOR" || p.role === "EQUIPE_ESCOLAR" || p.role === "EQUIPE_PEDAGOGICA"
    );
    const targetTeachers = teacherParticipants.length > 0 ? teacherParticipants : participantsArr;
    if (targetTeachers.length > 0) {
      const teachersList = targetTeachers.map((p) => `${p.name}${p.kinship ? ` (${p.kinship})` : ""}`).join(", ");
      currentPage.drawText("Docente(s) / Servidor(es) Envolvido(s):", {
        x: MARGIN_LEFT,
        y,
        size: 8.5,
        font: fontBold,
        color: rgb(0.2, 0.2, 0.2),
      });
      y -= 11;
      drawWrappedText(teachersList, 8.5, fontRegular, rgb(0.2, 0.2, 0.2), 2);
      y -= 6;
    }
  }

  // Texto Formal da Ata (Preâmbulo e Corpo)
  y -= 6;
  currentPage.drawText("Termo de Lavratura:", {
    x: MARGIN_LEFT,
    y,
    size: 9,
    font: fontBold,
    color: rgb(0.1, 0.2, 0.4),
  });
  y -= 13;

  drawWrappedText(safeSummary, 8.5, fontRegular, rgb(0.1, 0.1, 0.1), 3.5);

  // Síntese de Combinados
  if (safeAgreements) {
    y -= 10;
    checkPageBreak(40);
    currentPage.drawText("Encaminhamentos e Prazos:", {
      x: MARGIN_LEFT,
      y,
      size: 9,
      font: fontBold,
      color: rgb(0.1, 0.2, 0.4),
    });
    y -= 12;
    drawWrappedText(safeAgreements, 8.5, fontRegular, rgb(0.15, 0.15, 0.15), 3);
  }

  // Termos de Aditamento ("Em tempo")
  const addendumsArr = (minute.addendums || []) as any[];
  if (addendumsArr.length > 0) {
    y -= 12;
    checkPageBreak(50);
    currentPage.drawText("Termos de Aditamento ('Em tempo'):", {
      x: MARGIN_LEFT,
      y,
      size: 9,
      font: fontBold,
      color: rgb(0.7, 0.35, 0.0),
    });
    y -= 12;

    addendumsArr.forEach((add, idx) => {
      checkPageBreak(35);
      const addDate = add.createdAt ? new Date(add.createdAt).toLocaleString("pt-BR") : "";
      currentPage.drawText(`Em tempo (${idx + 1}) — Lavrado por ${add.authorName || "Equipe Escolar"} em ${addDate}:`, {
        x: MARGIN_LEFT,
        y,
        size: 8,
        font: fontBold,
        color: rgb(0.3, 0.3, 0.3),
      });
      y -= 11;
      drawWrappedText(add.content, 8, fontRegular, rgb(0.15, 0.15, 0.15), 2.5);
      y -= 4;
      currentPage.drawText(`Hash Encadeado: ${add.addendumHash || ""}`, {
        x: MARGIN_LEFT,
        y,
        size: 6.5,
        font: fontRegular,
        color: rgb(0.5, 0.5, 0.5),
      });
      y -= 10;
    });
  }

  // Motivo de cancelamento se VOIDED
  if (minute.status === "VOIDED" && minute.voidReason) {
    y -= 10;
    checkPageBreak(40);
    currentPage.drawText("Motivo do Cancelamento:", {
      x: MARGIN_LEFT,
      y,
      size: 8.5,
      font: fontBold,
      color: rgb(0.7, 0.1, 0.1),
    });
    y -= 11;
    drawWrappedText(minute.voidReason, 8, fontRegular, rgb(0.4, 0.1, 0.1), 2.5);
    if (minute.voidedByName) {
      y -= 3;
      const voidDate = minute.voidedAt ? new Date(minute.voidedAt).toLocaleString("pt-BR") : "";
      currentPage.drawText(`Cancelado por ${minute.voidedByName} em ${voidDate}`, {
        x: MARGIN_LEFT,
        y,
        size: 7.5,
        font: fontRegular,
        color: rgb(0.5, 0.1, 0.1),
      });
      y -= 10;
    }
  }

  // Quadro de Participantes e Assinaturas
  const participantsArr = (minute.participants || []) as any[];
  if (participantsArr.length > 0) {
    y -= 12;
    checkPageBreak(50);
    currentPage.drawText("Participantes e Assinaturas:", {
      x: MARGIN_LEFT,
      y,
      size: 9,
      font: fontBold,
      color: rgb(0.1, 0.2, 0.4),
    });
    y -= 14;

    for (const p of participantsArr) {
      checkPageBreak(25);
      let sigStatus = "Presença Atestada";
      if (p.verifiedEmail) {
        sigStatus = `Assinado via OIDC Institucional (${p.verifiedEmail})`;
      } else if (p.biometricVerified) {
        sigStatus = "Assinado Digitalmente (Autenticação Biométrica Verificada)";
      } else if (p.signatureData) {
        sigStatus = "Assinado em Tela Digital";
      } else if (p.signatureMode === "REFUSED") {
        sigStatus = `Recusa Registrada: ${p.refusalReason || "Sem justificativa"}`;
      }

      const pDoc = p.documentNumber ? ` • Doc: ${p.documentNumber}` : "";
      currentPage.drawText(`• ${p.name} (${p.role || "Participante"}${pDoc})`, {
        x: MARGIN_LEFT + 5,
        y,
        size: 8,
        font: fontBold,
        color: rgb(0.15, 0.15, 0.15),
      });
      y -= 10;
      currentPage.drawText(`  Status: ${sigStatus}`, {
        x: MARGIN_LEFT + 5,
        y,
        size: 7.5,
        font: fontRegular,
        color: rgb(0.35, 0.35, 0.35),
      });
      y -= 12;
    }
  }

  // Rodapé e Chancela de Fé Pública / QR Code
  checkPageBreak(90);
  y -= 10;
  currentPage.drawLine({
    start: { x: MARGIN_LEFT, y },
    end: { x: PAGE_WIDTH - MARGIN_RIGHT, y },
    thickness: 0.8,
    color: rgb(0.8, 0.8, 0.8),
  });
  y -= 12;

  // Gera imagem do QR Code
  const validationUrl = minute.verificationCode
    ? getAtaValidationUrl(minute.verificationCode, options.verificationOrigin)
    : "";

  if (validationUrl) {
    try {
      const qrDataUrl = await QRCode.toDataURL(validationUrl, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 140,
      });
      const qrBase64 = qrDataUrl.replace(/^data:image\/png;base64,/, "");
      const qrImage = await pdfDoc.embedPng(Buffer.from(qrBase64, "base64"));
      const QR_SIZE = 64;

      currentPage.drawImage(qrImage, {
        x: PAGE_WIDTH - MARGIN_RIGHT - QR_SIZE,
        y: y - QR_SIZE + 5,
        width: QR_SIZE,
        height: QR_SIZE,
      });
    } catch {
      // Ignora erro de QR Code em fallback
    }
  }

  const footX = MARGIN_LEFT;
  currentPage.drawText("AUTENTICAÇÃO DIGITAL & PRESERVAÇÃO ARQUIVÍSTICA (LEI Nº 14.063/2020 • ISO 19005-1)", {
    x: footX,
    y,
    size: 7.5,
    font: fontBold,
    color: rgb(0.1, 0.2, 0.4),
  });
  y -= 10;

  const authLine = `Lavrada por: ${minute.authorName || "Equipe Escolar"} (${minute.authorEmail || ""}) • Cargo: ${minute.authorRole || "PEDAGOGA"}`;
  currentPage.drawText(authLine, {
    x: footX,
    y,
    size: 7,
    font: fontRegular,
    color: rgb(0.3, 0.3, 0.3),
  });
  y -= 10;

  const hashLine = `Hash SHA-256 Canônico: ${minute.contentHash || "Não emitido"}`;
  currentPage.drawText(hashLine, {
    x: footX,
    y,
    size: 6.5,
    font: fontRegular,
    color: rgb(0.4, 0.4, 0.4),
  });
  y -= 9;

  const verifLine = `Cód. Verificação: ${minute.verificationCode || "N/A"} • Validação Pública: ${validationUrl}`;
  currentPage.drawText(verifLine, {
    x: footX,
    y,
    size: 6.5,
    font: fontRegular,
    color: rgb(0.2, 0.4, 0.7),
  });

  // 5. Injeta Stream de Metadados XMP descompactado (Conformidade estrita ISO 19005-1 Level B)
  const xmpXml = buildXmpMetadata(minute, minute.contentHash || "");
  const xmpBytes = Buffer.from(xmpXml, "utf8");
  const xmpStream = pdfDoc.context.stream(xmpBytes, {
    Type: PDFName.of("Metadata"),
    Subtype: PDFName.of("XML"),
  });
  const xmpRef = pdfDoc.context.register(xmpStream);
  pdfDoc.catalog.set(PDFName.of("Metadata"), xmpRef);

  const finalPdfBytes = await pdfDoc.save({ useObjectStreams: false });
  const finalSha256 = crypto.createHash("sha256").update(finalPdfBytes).digest("hex");
  const filename = `Ata_${numStr}_${minute.year}_PDFA1b.pdf`;

  return {
    pdfBytes: finalPdfBytes,
    sha256: finalSha256,
    filename,
  };
}
