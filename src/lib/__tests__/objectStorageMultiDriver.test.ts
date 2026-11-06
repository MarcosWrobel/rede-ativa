import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  validateAndDecodeScanData,
  getActiveStorageProvider,
  savePhysicalScanFile,
  getPhysicalScanBuffer,
} from "../objectStorage";
import { GET as getPhysicalScanRoute } from "@/app/api/atas/[id]/physical-scan/route";
import { prisma } from "../prisma";

const mockSession = {
  user: {
    id: "usr_pedagoga_1",
    name: "Natiele Pacheco",
    email: "natiele.pacheco@escola.pr.gov.br",
    role: "PEDAGOGA",
    schoolId: "school-leopoldina",
  },
};

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => mockSession),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: () => undefined })),
  headers: vi.fn(async () => new Headers({ host: "localhost:3000" })),
}));

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(async () => {}),
  extractClientIp: vi.fn(() => "127.0.0.1"),
}));

vi.mock("@/lib/currentSchool", () => ({
  getCurrentSchool: vi.fn(async (schoolId?: string | null) => ({
    id: schoolId || "school-leopoldina",
    name: "Colégio Estadual Leopoldina B. Pedroso",
    inepCode: "41042730",
  })),
}));

describe("STORAGE-01: Object Storage Multi-Driver & Custódia de Scans Físicos", () => {
  // Amostra válida de PDF: %PDF-1.4 ... %%EOF
  const validPdfBase64 = "data:application/pdf;base64,JVBERi0xLjQKJcTl8uXrp/Og0MTGCjQgMCBvYmoKPDwgL0xlbmd0aCA1IDAgUiAvRmlsdGVyIC9GbGF0ZURlY29kZSA+PgpzdHJlYW0KeAEr5AIAAZAAnQplbmRzdHJlYW0KZW5kb2JqCg==";
  // Amostra válida de PNG de 1x1 pixel
  const validPngBase64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  it("identifica 'DATABASE' como provedor padrão zero-custo na ausência de credenciais externas", () => {
    delete process.env.S3_BUCKET;
    delete process.env.BLOB_READ_WRITE_TOKEN;

    const provider = getActiveStorageProvider();
    expect(provider).toBe("DATABASE");
  });

  it("decodifica arquivo e valida magic bytes legítimos de PDF e PNG com SHA-256", () => {
    const pdfDecoded = validateAndDecodeScanData(validPdfBase64);
    expect(pdfDecoded.mimeType).toBe("application/pdf");
    expect(pdfDecoded.sizeBytes).toBeGreaterThan(0);
    expect(pdfDecoded.sha256).toMatch(/^[a-f0-9]{64}$/);

    const pngDecoded = validateAndDecodeScanData(validPngBase64);
    expect(pngDecoded.mimeType).toBe("image/png");
    expect(pngDecoded.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("bloqueia tentativa de MIME Spoofing (cabeçalho PDF com bytes que não são PDF)", () => {
    const fakePdf = "data:application/pdf;base64,SGVsbG8gV29ybGQgbm90IGEgcGRm"; // texto simples
    expect(() => validateAndDecodeScanData(fakePdf)).toThrow(/MIME spoofing|incompatível/i);
  });

  it("savePhysicalScanFile grava no fallback de banco com hash SHA-256 no cenário zero-custo", async () => {
    delete process.env.S3_BUCKET;
    delete process.env.BLOB_READ_WRITE_TOKEN;

    const result = await savePhysicalScanFile({
      schoolId: "school-leopoldina",
      minuteId: "ata-1",
      year: 2026,
      dataUrl: validPdfBase64,
    });

    expect(result.provider).toBe("DATABASE");
    expect(result.storageKey).toBeNull();
    expect(result.fallbackBase64).toBe(validPdfBase64);
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.sizeBytes).toBeGreaterThan(0);
  });

  it("getPhysicalScanBuffer recupera e valida a integridade SHA-256 da via física", async () => {
    const decoded = validateAndDecodeScanData(validPdfBase64);

    const minuteWithScan = {
      physicalScanProvider: "DATABASE",
      physicalSignedScanData: validPdfBase64,
      physicalScanSha256: decoded.sha256,
      physicalScanMimeType: "application/pdf",
    };

    const retrieved = await getPhysicalScanBuffer(minuteWithScan);
    expect(retrieved.mimeType).toBe("application/pdf");
    expect(retrieved.isVerifiedSha256).toBe(true);
    expect(retrieved.buffer.length).toBe(decoded.sizeBytes);
  });

  it("GET /api/atas/[id]/physical-scan entrega o arquivo com cabeçalhos de segurança e integridade", async () => {
    const decoded = validateAndDecodeScanData(validPdfBase64);

    vi.spyOn(prisma.pedagogicalMinute, "findUnique").mockResolvedValueOnce({
      id: "ata-scan-1",
      schoolId: "school-leopoldina",
      ataNumber: 15,
      year: 2026,
      subject: "Atendimento Pedagógico",
      isConfidential: false,
      authorId: "usr_pedagoga_1",
      authorEmail: "natiele.pacheco@escola.pr.gov.br",
      physicalSignedScanData: validPdfBase64,
      physicalScanStorageKey: null,
      physicalScanProvider: "DATABASE",
      physicalScanMimeType: "application/pdf",
      physicalScanSizeBytes: decoded.sizeBytes,
      physicalScanSha256: decoded.sha256,
    } as any);

    const req = new Request("http://localhost/api/atas/ata-scan-1/physical-scan");
    const res = await getPhysicalScanRoute(req, { params: Promise.resolve({ id: "ata-scan-1" }) });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("X-Scan-SHA256")).toBe(decoded.sha256);
    expect(res.headers.get("X-Scan-Integrity-Verified")).toBe("true");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("GET /api/atas/[id]/physical-scan bloqueia acesso a ata de outra escola (anti-IDOR)", async () => {
    vi.spyOn(prisma.pedagogicalMinute, "findUnique").mockResolvedValueOnce({
      id: "ata-alien",
      schoolId: "escola-de-outro-municipio",
      isConfidential: false,
    } as any);

    const req = new Request("http://localhost/api/atas/ata-alien/physical-scan");
    const res = await getPhysicalScanRoute(req, { params: Promise.resolve({ id: "ata-alien" }) });

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain("Acesso negado");
  });
});
