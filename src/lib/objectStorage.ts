import crypto from "crypto";

export type StorageProvider = "DATABASE" | "S3" | "VERCEL_BLOB";

export interface DecodedFileData {
  buffer: Buffer;
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "application/pdf";
  sizeBytes: number;
  sha256: string;
}

export interface PutObjectResult {
  provider: StorageProvider;
  storageKey: string | null;
  sha256: string;
  sizeBytes: number;
  mimeType: string;
  fallbackBase64: string | null;
}

/**
 * Validação rigorosa de Magic Bytes binários reais para impedir MIME-Spoofing
 */
export function validateAndDecodeScanData(dataUrl: string): DecodedFileData {
  const match = dataUrl.trim().match(/^data:(image\/(png|jpeg|jpg|webp)|application\/pdf);base64,(.+)$/is);
  if (!match) {
    throw new Error("Formato de arquivo inválido. Envie imagem (PNG, JPEG, WEBP) ou PDF em Base64.");
  }

  const rawMime = match[1].toLowerCase();
  const base64Data = match[3];
  const buffer = Buffer.from(base64Data, "base64");

  if (buffer.length === 0) {
    throw new Error("Arquivo vazio ou inválido.");
  }

  if (buffer.length > 8 * 1024 * 1024) {
    throw new Error("O tamanho máximo do documento digitalizado é 8MB.");
  }

  // Validação estrita de Magic Bytes
  let detectedMime: DecodedFileData["mimeType"] | null = null;

  // PDF: %PDF- (0x25 0x50 0x44 0x46 0x2D)
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString("latin1") === "%PDF-") {
    detectedMime = "application/pdf";
  }
  // PNG: \x89PNG\r\n\x1a\n
  else if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    detectedMime = "image/png";
  }
  // JPEG: \xFF\xD8\xFF
  else if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    detectedMime = "image/jpeg";
  }
  // WEBP: RIFF....WEBP
  else if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("latin1") === "RIFF" &&
    buffer.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    detectedMime = "image/webp";
  }

  if (!detectedMime) {
    throw new Error("Conteúdo binário incompatível com a extensão informada (MIME spoofing detectado).");
  }

  // Normaliza jpeg/jpg
  const normalizedMime = rawMime === "image/jpg" ? "image/jpeg" : rawMime;
  if (normalizedMime !== detectedMime) {
    throw new Error(`Inconsistência entre cabeçalho MIME (${rawMime}) e os bytes do arquivo (${detectedMime}).`);
  }

  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");

  return {
    buffer,
    mimeType: detectedMime,
    sizeBytes: buffer.length,
    sha256,
  };
}

/**
 * Assinatura AWS Signature Version 4 nativa (HMAC-SHA256) sem dependência externa
 */
function createAwsSigV4Headers(params: {
  method: string;
  url: URL;
  bodySha256: string;
  contentType?: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
  date?: Date;
}): Record<string, string> {
  const d = params.date || new Date();
  const amzDate = d.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  const headers: Record<string, string> = {
    host: params.url.host,
    "x-amz-date": amzDate,
    "x-amz-content-sha256": params.bodySha256,
  };

  if (params.contentType) {
    headers["content-type"] = params.contentType;
  }

  // Canonical headers
  const sortedKeys = Object.keys(headers).sort();
  const canonicalHeaders = sortedKeys.map((k) => `${k}:${headers[k].trim()}\n`).join("");
  const signedHeaders = sortedKeys.join(";");

  // Canonical Request
  const canonicalUri = params.url.pathname || "/";
  const canonicalQuery = "";
  const canonicalRequest = [
    params.method.toUpperCase(),
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    params.bodySha256,
  ].join("\n");

  const credentialScope = `${dateStamp}/${params.region}/${params.service}/aws4_request`;
  const hashedCanonicalRequest = crypto.createHash("sha256").update(canonicalRequest, "utf8").digest("hex");

  // String to sign
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, hashedCanonicalRequest].join("\n");

  // Key derivation
  const hmac = (key: crypto.BinaryLike | crypto.KeyObject, data: string) =>
    crypto.createHmac("sha256", key).update(data, "utf8").digest();

  const kDate = hmac(`AWS4${params.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, params.region);
  const kService = hmac(kRegion, params.service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = crypto.createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");

  headers["Authorization"] = `AWS4-HMAC-SHA256 Credential=${params.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return headers;
}

/**
 * Driver S3 / Cloudflare R2 nativo
 */
class S3ObjectStorageDriver {
  private endpoint: string;
  private bucket: string;
  private accessKeyId: string;
  private secretAccessKey: string;
  private region: string;

  constructor() {
    this.endpoint = (process.env.S3_ENDPOINT || "https://s3.amazonaws.com").replace(/\/$/, "");
    this.bucket = process.env.S3_BUCKET || "";
    this.accessKeyId = process.env.S3_ACCESS_KEY_ID || "";
    this.secretAccessKey = process.env.S3_SECRET_ACCESS_KEY || "";
    this.region = process.env.S3_REGION || "auto";
  }

  isConfigured(): boolean {
    return Boolean(this.bucket && this.accessKeyId && this.secretAccessKey);
  }

  private getUrl(key: string): URL {
    const cleanKey = key.replace(/^\//, "");
    return new URL(`${this.endpoint}/${this.bucket}/${cleanKey}`);
  }

  async put(key: string, buffer: Buffer, mimeType: string): Promise<void> {
    const url = this.getUrl(key);
    const bodySha256 = crypto.createHash("sha256").update(buffer).digest("hex");

    const authHeaders = createAwsSigV4Headers({
      method: "PUT",
      url,
      bodySha256,
      contentType: mimeType,
      accessKeyId: this.accessKeyId,
      secretAccessKey: this.secretAccessKey,
      region: this.region,
      service: "s3",
    });

    const res = await fetch(url.toString(), {
      method: "PUT",
      headers: authHeaders,
      body: new Uint8Array(buffer),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Falha no upload para Object Storage (S3/R2): HTTP ${res.status} ${errText}`);
    }
  }

  async get(key: string): Promise<Buffer> {
    const url = this.getUrl(key);
    const bodySha256 = crypto.createHash("sha256").update("").digest("hex");

    const authHeaders = createAwsSigV4Headers({
      method: "GET",
      url,
      bodySha256,
      accessKeyId: this.accessKeyId,
      secretAccessKey: this.secretAccessKey,
      region: this.region,
      service: "s3",
    });

    const res = await fetch(url.toString(), {
      method: "GET",
      headers: authHeaders,
    });

    if (!res.ok) {
      throw new Error(`Falha ao ler objeto do Object Storage (S3/R2): HTTP ${res.status}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async delete(key: string): Promise<void> {
    const url = this.getUrl(key);
    const bodySha256 = crypto.createHash("sha256").update("").digest("hex");

    const authHeaders = createAwsSigV4Headers({
      method: "DELETE",
      url,
      bodySha256,
      accessKeyId: this.accessKeyId,
      secretAccessKey: this.secretAccessKey,
      region: this.region,
      service: "s3",
    });

    await fetch(url.toString(), {
      method: "DELETE",
      headers: authHeaders,
    }).catch(() => {});
  }
}

/**
 * Driver Vercel Blob REST
 */
class VercelBlobDriver {
  private token: string;

  constructor() {
    this.token = process.env.BLOB_READ_WRITE_TOKEN || "";
  }

  isConfigured(): boolean {
    return Boolean(this.token && this.token.length > 20);
  }

  async put(pathname: string, buffer: Buffer, mimeType: string): Promise<{ url: string }> {
    const res = await fetch(`https://blob.vercel-storage.com/${encodeURIComponent(pathname)}`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${this.token}`,
        "x-api-version": "7",
        "content-type": mimeType,
      },
      body: new Uint8Array(buffer),
    });

    if (!res.ok) {
      throw new Error(`Falha no upload para Vercel Blob: HTTP ${res.status}`);
    }

    const data = await res.json();
    return { url: data.url };
  }

  async get(urlOrPath: string): Promise<Buffer> {
    const targetUrl = urlOrPath.startsWith("http")
      ? urlOrPath
      : `https://blob.vercel-storage.com/${encodeURIComponent(urlOrPath)}`;

    const res = await fetch(targetUrl, {
      headers: { authorization: `Bearer ${this.token}` },
    });

    if (!res.ok) {
      throw new Error(`Falha ao ler do Vercel Blob: HTTP ${res.status}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async delete(urlOrPath: string): Promise<void> {
    await fetch("https://blob.vercel-storage.com/delete", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ urls: [urlOrPath] }),
    }).catch(() => {});
  }
}

const s3Driver = new S3ObjectStorageDriver();
const vercelBlobDriver = new VercelBlobDriver();

/**
 * Identifica qual provedor de armazenamento está ativo
 */
export function getActiveStorageProvider(): StorageProvider {
  if (s3Driver.isConfigured()) return "S3";
  if (vercelBlobDriver.isConfigured()) return "VERCEL_BLOB";
  return "DATABASE"; // Padrão Zero-Custo Escola Piloto Leopoldina
}

/**
 * Salva o arquivo no provedor ativo com fallback automático para PostgreSQL
 */
export async function savePhysicalScanFile(params: {
  schoolId: string;
  minuteId: string;
  year: number;
  dataUrl: string;
}): Promise<PutObjectResult> {
  const decoded = validateAndDecodeScanData(params.dataUrl);
  const provider = getActiveStorageProvider();

  const ext = decoded.mimeType === "application/pdf" ? "pdf" : decoded.mimeType.split("/")[1] || "bin";
  const storageKey = `atas/${params.schoolId}/${params.year}/${params.minuteId}-${decoded.sha256.slice(0, 12)}.${ext}`;

  if (provider === "S3") {
    try {
      await s3Driver.put(storageKey, decoded.buffer, decoded.mimeType);
      return {
        provider: "S3",
        storageKey,
        sha256: decoded.sha256,
        sizeBytes: decoded.sizeBytes,
        mimeType: decoded.mimeType,
        fallbackBase64: null, // Alivia o Postgres
      };
    } catch (err) {
      console.warn("[ObjectStorage] Falha no S3/R2, aplicando fallback automático para PostgreSQL:", err);
    }
  }

  if (provider === "VERCEL_BLOB") {
    try {
      const blobRes = await vercelBlobDriver.put(storageKey, decoded.buffer, decoded.mimeType);
      return {
        provider: "VERCEL_BLOB",
        storageKey: blobRes.url || storageKey,
        sha256: decoded.sha256,
        sizeBytes: decoded.sizeBytes,
        mimeType: decoded.mimeType,
        fallbackBase64: null, // Alivia o Postgres
      };
    } catch (err) {
      console.warn("[ObjectStorage] Falha no Vercel Blob, aplicando fallback automático para PostgreSQL:", err);
    }
  }

  // Fallback padrão Zero-Custo (PostgreSQL Base64)
  return {
    provider: "DATABASE",
    storageKey: null,
    sha256: decoded.sha256,
    sizeBytes: decoded.sizeBytes,
    mimeType: decoded.mimeType,
    fallbackBase64: params.dataUrl,
  };
}

/**
 * Recupera os bytes do arquivo a partir de qualquer provedor, validando integridade SHA-256
 */
export async function getPhysicalScanBuffer(minute: {
  physicalScanProvider?: string | null;
  physicalScanStorageKey?: string | null;
  physicalSignedScanData?: string | null;
  physicalScanSha256?: string | null;
  physicalScanMimeType?: string | null;
}): Promise<{ buffer: Buffer; mimeType: string; isVerifiedSha256: boolean }> {
  const provider = minute.physicalScanProvider || "DATABASE";
  let buffer: Buffer | null = null;
  let mimeType = minute.physicalScanMimeType || "application/pdf";

  if (provider === "S3" && minute.physicalScanStorageKey) {
    buffer = await s3Driver.get(minute.physicalScanStorageKey);
  } else if (provider === "VERCEL_BLOB" && minute.physicalScanStorageKey) {
    buffer = await vercelBlobDriver.get(minute.physicalScanStorageKey);
  } else if (minute.physicalSignedScanData) {
    const decoded = validateAndDecodeScanData(minute.physicalSignedScanData);
    buffer = decoded.buffer;
    mimeType = decoded.mimeType;
  }

  if (!buffer) {
    throw new Error("Arquivo da via física digitalizada não encontrado.");
  }

  // Validação forense de cadeia de custódia SHA-256 (Anti-Tampering)
  const calculatedSha = crypto.createHash("sha256").update(buffer).digest("hex");
  const isVerifiedSha256 = minute.physicalScanSha256
    ? calculatedSha.toLowerCase() === minute.physicalScanSha256.toLowerCase()
    : true;

  if (minute.physicalScanSha256 && !isVerifiedSha256) {
    console.error(`[Cadeia de Custódia] Alerta Crítico: Discrepância SHA-256 no scan. Esperado: ${minute.physicalScanSha256}, Calculado: ${calculatedSha}`);
  }

  return {
    buffer,
    mimeType,
    isVerifiedSha256,
  };
}

/**
 * Deleta o arquivo no provedor externo correspondente
 */
export async function deletePhysicalScanFile(minute: {
  physicalScanProvider?: string | null;
  physicalScanStorageKey?: string | null;
}): Promise<void> {
  const provider = minute.physicalScanProvider;
  if (!minute.physicalScanStorageKey) return;

  if (provider === "S3") {
    await s3Driver.delete(minute.physicalScanStorageKey);
  } else if (provider === "VERCEL_BLOB") {
    await vercelBlobDriver.delete(minute.physicalScanStorageKey);
  }
}
