import { execFileSync, spawn } from "node:child_process";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const require = createRequire(path.join(repoRoot, "package.json"));
const { PrismaClient } = require("@prisma/client");

function resolveE2eDbUrl() {
  let candidate = process.env.E2E_DB_URL;
  if (!candidate) {
    const hostPort =
      process.env.E2E_PG_HOSTPORT ||
      execFileSync("docker", ["port", "redeativa-local-sintetico", "5432/tcp"], { encoding: "utf8" })
        .split(/\r?\n/)[0]
        .trim();
    candidate = `postgresql://redeativa_teste:redeativa_teste_local@${hostPort}/redeativa_e2e_sintetico`;
  }
  const parsed = new URL(candidate);
  if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
    throw new Error(`Refusing non-local database host "${parsed.hostname}" for synthetic browser E2E.`);
  }
  return candidate;
}

function resolveChromeBinary() {
  const explicit = process.env.CHROME_BIN || process.env.CHROMIUM_EXECUTABLE_PATH;
  if (explicit && fs.existsSync(explicit)) return explicit;

  const msPlaywrightDir = path.join(os.homedir(), ".cache", "ms-playwright");
  if (fs.existsSync(msPlaywrightDir)) {
    const entries = fs.readdirSync(msPlaywrightDir).sort().reverse();
    for (const dir of entries) {
      const candidates = [
        path.join(msPlaywrightDir, dir, "chrome-headless-shell-linux64", "chrome-headless-shell"),
        path.join(msPlaywrightDir, dir, "chrome-linux64", "chrome"),
        path.join(msPlaywrightDir, dir, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
      ];
      for (const c of candidates) {
        if (fs.existsSync(c)) return c;
      }
    }
  }

  for (const bin of ["chromium", "chromium-browser", "google-chrome"]) {
    try {
      const found = execFileSync("which", [bin], { encoding: "utf8" }).trim();
      if (found) return found;
    } catch {}
  }

  throw new Error("Chromium/Chrome binary not found. Set CHROME_BIN or CHROMIUM_EXECUTABLE_PATH.");
}

const E2E_DB_URL = resolveE2eDbUrl();
const APP_PORT = Number(process.env.E2E_APP_PORT || 3099);
const APP_URL = `http://127.0.0.1:${APP_PORT}`;
const CDP_PORT = Number(process.env.E2E_CDP_PORT || 9299);
const CHROME_BIN = resolveChromeBinary();

const prisma = new PrismaClient({
  datasources: { db: { url: E2E_DB_URL } },
});

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
    this.ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method) {
        const handlers = this.listeners.get(msg.method) || [];
        for (const fn of handlers) fn(msg.params);
      }
    });
  }

  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const res = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (res.exceptionDetails) {
      throw new Error(
        `Browser JS exception: ${JSON.stringify(res.exceptionDetails)}`
      );
    }
    return res.result?.value;
  }

  async waitFor(fnExpr, timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const ok = await this.eval(`Boolean((${fnExpr})())`);
      if (ok) return;
      await delay(100);
    }
    const debugText = await this.eval(`document.body.innerText.slice(0, 600)`);
    throw new Error(`Timeout waiting for ${fnExpr}. Page snippet: ${debugText}`);
  }

  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

async function seedSyntheticData() {
  const schoolId = "e2e-fase2-school";
  await prisma.pedagogicalMinute.deleteMany({ where: { schoolId } });
  await prisma.studentContact.deleteMany({
    where: { student: { schoolId } },
  });
  await prisma.student.deleteMany({ where: { schoolId } });
  await prisma.classGroup.deleteMany({ where: { schoolId } });
  await prisma.userSchool.deleteMany({ where: { schoolId } });
  await prisma.user.deleteMany({
    where: {
      email: { in: ["pedagoga.fase2@escola.pr.gov.br", "carlos.fase2@escola.pr.gov.br"] },
    },
  });
  await prisma.school.deleteMany({ where: { id: schoolId } });

  await prisma.school.create({
    data: {
      id: schoolId,
      inepCode: "99887766",
      name: "Escola Sintética Fase 2",
      city: "Curitiba",
      state: "PR",
      nre: "Curitiba",
      network: "ESTADUAL",
      active: true,
    },
  });

  const pedUser = await prisma.user.create({
    data: {
      id: "e2e-user-pedagoga",
      email: "pedagoga.fase2@escola.pr.gov.br",
      name: "Bruna Pedagoga E2E",
      role: "PEDAGOGA",
      active: true,
      schoolId,
    },
  });
  await prisma.userSchool.create({
    data: { userId: pedUser.id, schoolId, role: "PEDAGOGA", active: true },
  });

  const staffUser = await prisma.user.create({
    data: {
      id: "e2e-user-staff",
      email: "carlos.fase2@escola.pr.gov.br",
      name: "Carlos Equipe E2E",
      role: "GESTOR_ESCOLAR",
      active: true,
      schoolId,
    },
  });
  await prisma.userSchool.create({
    data: { userId: staffUser.id, schoolId, role: "GESTOR_ESCOLAR", active: true },
  });

  const turma = await prisma.classGroup.create({
    data: {
      id: "e2e-turma-6a",
      name: "6º 1 E2E",
      shift: "MANHA",
      segment: "FUNDAMENTAL_II",
      schoolId,
    },
  });

  await prisma.student.create({
    data: {
      id: "stu-e2e-a",
      cgm: "91001",
      name: "João Fase2",
      email: "joao.fase2@escola.pr.gov.br",
      phone: "42999991111",
      guardianName: "Maria Mãe",
      schoolId,
      classGroupId: turma.id,
      active: true,
      contacts: {
        create: [
          {
            id: "cnt-e2e-mae",
            name: "Maria Mãe",
            kinship: "MAE",
            phone: "42999991111",
            isPrimary: true,
          },
          {
            id: "cnt-e2e-recado",
            name: "Vizinho Recado",
            kinship: "RECADO",
            phone: "42988887777",
            isPrimary: false,
          },
          {
            id: "cnt-e2e-proprio",
            name: "João Próprio",
            kinship: "PROPRIO_ALUNO",
            phone: "42977776666",
            isPrimary: false,
          },
        ],
      },
    },
  });

  await prisma.student.create({
    data: {
      id: "stu-e2e-b",
      cgm: "91002",
      name: "Lucas Único",
      email: "lucas.fase2@escola.pr.gov.br",
      phone: "42999992222",
      guardianName: "Ana Única",
      schoolId,
      classGroupId: turma.id,
      active: true,
    },
  });

  // Ata histórica de 2025 (anterior à Fase 2) com role: RESPONSAVEL e contentHash canônico SHA-256
  const histAttendedAt = new Date("2025-09-10T14:00:00.000Z");
  const histSig =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const histCanonical = {
    schoolId: schoolId.trim(),
    year: 2025,
    ataNumber: 7,
    attendedAt: histAttendedAt.toISOString(),
    category: "BUSCA_ATIVA_FALTAS",
    isConfidential: false,
    isExtemporaneous: false,
    extemporaneousReason: "",
    subject: "Ata Histórica 2025 Fase 2",
    summary: "Registro histórico lavrado em 2025 antes da Fase 2 para conferência de integridade.",
    agreementsSummary: "",
    authorEmail: "pedagoga.fase2@escola.pr.gov.br",
    students: [
      { studentId: "stu-e2e-a", name: "João Fase2", className: "6º 1 E2E", cgm: "91001" },
    ],
    participants: [
      {
        role: "RESPONSAVEL",
        name: "Maria Mãe",
        doc: "11122233344",
        mode: "SCREEN_CANVAS",
        sigHash: crypto.createHash("sha256").update(histSig).digest("hex"),
        hasSig: true,
        bio: false,
        email: "",
        refusal: "",
      },
    ],
    actionItems: [],
  };
  const histHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(histCanonical), "utf8")
    .digest("hex");

  await prisma.pedagogicalMinute.create({
    data: {
      id: "ata-e2e-hist",
      schoolId,
      year: 2025,
      ataNumber: 7,
      status: "FINALIZED",
      category: "BUSCA_ATIVA_FALTAS",
      isConfidential: false,
      attendedAt: histAttendedAt,
      finalizedAt: new Date("2025-09-10T15:00:00.000Z"),
      subject: "Ata Histórica 2025 Fase 2",
      summary: "Registro histórico lavrado em 2025 antes da Fase 2 para conferência de integridade.",
      authorId: pedUser.id,
      authorName: pedUser.name,
      authorEmail: pedUser.email,
      authorRole: "PEDAGOGA",
      contentHash: histHash,
      verificationCode: "HIST-E2E-2025",
      students: {
        create: [
          {
            studentId: "stu-e2e-a",
            studentNameSnapshot: "João Fase2",
            classNameSnapshot: "6º 1 E2E",
            cgmSnapshot: "91001",
          },
        ],
      },
      participants: {
        create: [
          {
            id: "mp-e2e-hist-1",
            role: "RESPONSAVEL",
            name: "Maria Mãe",
            kinship: "Mãe/Pai",
            documentType: "CPF",
            documentNumber: "111.222.333-44",
            signatureMode: "SCREEN_CANVAS",
            signatureData: histSig,
            hasSignature: true,
            signedAt: new Date("2025-09-10T14:30:00.000Z"),
          },
        ],
      },
    },
  });

  // Rascunho com 3 participantes protegidos: assinatura canvas, recusa e QR ativo
  await prisma.pedagogicalMinute.create({
    data: {
      id: "ata-e2e-prot",
      schoolId,
      year: 2026,
      status: "DRAFT",
      category: "ACOMPANHAMENTO_PEDAGOGICO",
      isConfidential: false,
      attendedAt: new Date("2026-11-12T14:00:00.000Z"),
      subject: "Assuntos Protegidos E2E",
      rawNotes: "Notas protegidas",
      summary: "Resumo com assinatura, recusa e QR ativo para homologação de bloqueios.",
      authorId: pedUser.id,
      authorName: pedUser.name,
      authorEmail: pedUser.email,
      authorRole: "PEDAGOGA",
      students: {
        create: [
          {
            studentId: "stu-e2e-a",
            studentNameSnapshot: "João Fase2",
            classNameSnapshot: "6º 1 E2E",
            cgmSnapshot: "91001",
          },
        ],
      },
      participants: {
        create: [
          {
            id: "mp-e2e-prot-sig",
            role: "RESPONSAVEL",
            name: "Assinado Canvas",
            kinship: "Mãe/Pai",
            documentType: "CPF",
            documentNumber: "222.333.444-55",
            signatureMode: "SCREEN_CANVAS",
            signatureData: histSig,
            hasSignature: true,
            signedAt: new Date("2026-11-12T14:10:00.000Z"),
          },
          {
            id: "mp-e2e-prot-ref",
            role: "FAMILIAR_CONTATO",
            name: "Recusa Termo",
            kinship: "Contato de recado",
            documentType: "RG",
            documentNumber: "99887766",
            signatureMode: "REFUSED",
            refusalReason: "Recusa motivada",
            witnessName: "Testemunha Maria",
            hasSignature: false,
          },
          {
            id: "mp-e2e-prot-qr",
            role: "FAMILIAR_CONTATO",
            name: "QR Ativo",
            kinship: "Tio / Tia",
            documentType: "RG",
            documentNumber: "44556677",
            signatureMode: "MOBILE_QR",
            hasSignature: false,
            hasActiveSignLink: true,
            mobileSignToken: "tok-e2e-qr-ativo",
            mobileSignExpiresAt: new Date(Date.now() + 3600_000),
          },
        ],
      },
    },
  });
}

async function waitForHttp(url, timeoutMs = 45000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch {}
    await delay(300);
  }
  throw new Error(`Timeout waiting for ${url}`);
}

async function main() {
  await seedSyntheticData();

  const server = spawn("npx", ["next", "dev", "-p", String(APP_PORT), "-H", "127.0.0.1"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_ENV: "development",
      VERCEL: "0",
      DATABASE_URL: E2E_DB_URL,
      DIRECT_URL: E2E_DB_URL,
      NEXTAUTH_URL: APP_URL,
      AUTH_URL: APP_URL,
      AUTH_SECRET: "e2e-fase2-synthetic-secret",
      NEXTAUTH_SECRET: "e2e-fase2-synthetic-secret",
      ENABLE_DEV_AUTH: "true",
    },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "chrome-e2e-fase2-"));
  const chrome = spawn(
    CHROME_BIN,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${userDataDir}`,
      "about:blank",
    ],
    { detached: true, stdio: ["ignore", "pipe", "pipe"] }
  );

  let cdp;
  const networkResponses = [];

  try {
    await waitForHttp(`${APP_URL}/login`);
    await waitForHttp(`http://127.0.0.1:${CDP_PORT}/json/version`);

    const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
    const pageTarget = targets.find((t) => t.type === "page") || targets[0];
    cdp = new CdpClient(pageTarget.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable");

    cdp.on("Network.responseReceived", (params) => {
      if (params.response.url.includes("/api/atas/participant-candidates")) {
        networkResponses.push({
          url: params.response.url,
          status: params.response.status,
        });
      }
    });

    // 1. Login como PEDAGOGA via dev auth
    await cdp.send("Page.navigate", { url: `${APP_URL}/login` });
    await cdp.waitFor(`() => document.querySelector('input[type="email"]') !== null`);
    await cdp.eval(`(() => {
      const input = document.querySelector('input[type="email"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'pedagoga.fase2@escola.pr.gov.br');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const form = input.closest('form');
      const btn = form.querySelector('button[type="submit"]');
      btn.click();
    })()`);

    await cdp.waitFor(`() => !window.location.pathname.startsWith('/login')`);

    // 2. Ir para /atas e abrir modal Nova Ata
    await cdp.send("Page.navigate", { url: `${APP_URL}/atas` });
    await cdp.waitFor(`() => Array.from(document.querySelectorAll('button')).some(b => b.textContent.includes('Nova Ata'))`);
    await cdp.eval(`(() => {
      Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Nova Ata')).click();
    })()`);
    await cdp.waitFor(`() => document.body.innerText.includes('João Fase2')`);

    // Verificar carga separada de staff com status 200 (sem 403 para PEDAGOGA!)
    const staffDeadline = Date.now() + 12000;
    while (Date.now() < staffDeadline && !networkResponses.some((r) => r.url.includes("part=staff"))) {
      await delay(150);
    }
    assert(
      networkResponses.some((r) => r.url.includes("part=staff") && r.status === 200),
      `Expected PEDAGOGA part=staff 200, got: ${JSON.stringify(networkResponses)}`
    );
    assert(
      !networkResponses.some((r) => r.status === 403),
      `Unexpected 403 for PEDAGOGA: ${JSON.stringify(networkResponses)}`
    );

    // CENÁRIO A: João Fase2 (Mãe + Recado + Próprio Aluno)
    await cdp.eval(`(() => {
      const p = Array.from(document.querySelectorAll('p')).find(el => el.textContent && el.textContent.trim() === 'João Fase2');
      p.closest('[class*="cursor-pointer"]').click();
    })()`);
    await cdp.waitFor(`() => document.body.innerText.includes('1 selecionado')`);
    await cdp.eval(`(() => {
      Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Avançar para Redação')).click();
    })()`);
    await cdp.waitFor(`() => Array.from(document.querySelectorAll('button')).some(b => b.textContent.includes('Novo Presente'))`);
    await cdp.eval(`(() => {
      Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Novo Presente')).click();
    })()`);

    // Deve carregar os contatos de João Fase2 sem auto-preencher Maria Mãe (porque há Recado) e sem PROPRIO_ALUNO
    await cdp.waitFor(`() => {
      const sel = document.querySelector('select[aria-label="Selecionar cadastro para o participante 1"]');
      return sel && sel.innerText.includes('Vizinho Recado');
    }`);
    const pickerHtmlA = await cdp.eval(`document.querySelector('select[aria-label="Selecionar cadastro para o participante 1"]').innerHTML`);
    assert(pickerHtmlA.includes("Maria Mãe"), "Picker deve listar Maria Mãe");
    assert(pickerHtmlA.includes("Vizinho Recado"), "Picker deve listar Vizinho Recado");
    assert(!pickerHtmlA.includes("João Próprio"), "Picker NÃO deve incluir PROPRIO_ALUNO");
    const initialNameA = await cdp.eval(`document.querySelector('input[aria-label="Nome completo do participante 1"]').value`);
    assert.equal(initialNameA, "", "Não deve auto-preencher quando há Mãe + Recado");

    // Selecionar Vizinho Recado -> papel documental DEVE mudar para FAMILIAR_CONTATO
    await cdp.eval(`(() => {
      const sel = document.querySelector('select[aria-label="Selecionar cadastro para o participante 1"]');
      const opt = Array.from(sel.options).find(o => o.text.includes('Vizinho Recado'));
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(sel, opt.value);
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    const roleAfterRecado = await cdp.eval(`document.querySelector('select[aria-label="Papel do participante 1"]').value`);
    assert.equal(roleAfterRecado, "FAMILIAR_CONTATO");
    const noticeText = await cdp.eval(`document.body.innerText`);
    assert(noticeText.includes("não comprova guarda ou representação legal"), "Deve exibir aviso contextual de recado");

    // CENÁRIO B: Troca de papel ESTUDANTE -> RESPONSAVEL limpa CGM/email + Escolha explícita preservada ao desmarcar
    await cdp.eval(`(() => {
      Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Novo Presente')).click();
    })()`);
    await cdp.waitFor(`() => document.querySelector('select[aria-label="Papel do participante 2"]') !== null`);
    await cdp.eval(`(() => {
      const sel = document.querySelector('select[aria-label="Papel do participante 2"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(sel, 'ESTUDANTE');
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    // Estudante único na pauta auto-preencheu João Fase2 com CGM 91001
    await cdp.waitFor(`() => document.querySelector('input[aria-label="Documento do participante 2"]').value === '91001'`);
    // Trocar de volta para RESPONSAVEL -> deve limpar CGM e dados do estudante!
    await cdp.eval(`(() => {
      const sel = document.querySelector('select[aria-label="Papel do participante 2"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(sel, 'RESPONSAVEL');
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    const docAfterSwitch = await cdp.eval(`document.querySelector('input[aria-label="Documento do participante 2"]').value`);
    const nameAfterSwitch = await cdp.eval(`document.querySelector('input[aria-label="Nome completo do participante 2"]').value`);
    assert.equal(docAfterSwitch, "", "CGM do estudante NÃO pode permanecer após trocar papel para RESPONSAVEL");
    assert.equal(nameAfterSwitch, "", "Nome do estudante NÃO pode permanecer após trocar papel para RESPONSAVEL");

    // Escolher Maria Mãe explicitamente no participante 2
    await cdp.eval(`(() => {
      const sel = document.querySelector('select[aria-label="Selecionar cadastro para o participante 2"]');
      const opt = Array.from(sel.options).find(o => o.text.includes('Maria Mãe'));
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(sel, opt.value);
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);

    // Voltar para Passo 1, marcar Lucas Único e desmarcar João Fase2 -> escolhas explícitas 1 e 2 devem permanecer
    await cdp.eval(`(() => {
      Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Alunos & Pauta')).click();
    })()`);
    await cdp.waitFor(`() => document.body.innerText.includes('João Fase2')`);
    await cdp.eval(`(() => {
      const p = Array.from(document.querySelectorAll('div[class*="cursor-pointer"] p')).find(el => el.textContent && el.textContent.trim() === 'Lucas Único');
      p.closest('[class*="cursor-pointer"]').click();
    })()`);
    await cdp.waitFor(`() => document.body.innerText.includes('2 selecionados')`);
    await cdp.eval(`(() => {
      const p = Array.from(document.querySelectorAll('div[class*="cursor-pointer"] p')).find(el => el.textContent && el.textContent.trim() === 'João Fase2');
      p.closest('[class*="cursor-pointer"]').click();
    })()`);
    await cdp.waitFor(`() => document.body.innerText.includes('1 selecionado')`);
    await cdp.eval(`(() => {
      Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Redação Oficial & Assinaturas')).click();
    })()`);
    await cdp.waitFor(`() => document.querySelector('input[aria-label="Nome completo do participante 2"]')?.value === 'Maria Mãe'`);
    const keptRecado = await cdp.eval(`document.querySelector('input[aria-label="Nome completo do participante 1"]').value`);
    assert.equal(keptRecado, "Vizinho Recado");

    // CENÁRIO C: Auto-fill -> Salvar Rascunho (PERSISTED) -> Desmarcar estudante -> Permanece!
    await cdp.eval(`(() => {
      Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Fechar').click();
    })()`);
    await delay(200);
    await cdp.eval(`(() => {
      Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Nova Ata')).click();
    })()`);
    await cdp.waitFor(`() => document.body.innerText.includes('Lucas Único')`);
    await cdp.eval(`(() => {
      const p = Array.from(document.querySelectorAll('div[class*="cursor-pointer"] p')).find(el => el.textContent && el.textContent.trim() === 'Lucas Único');
      p.closest('[class*="cursor-pointer"]').click();
    })()`);
    await cdp.waitFor(`() => document.body.innerText.includes('1 selecionado')`);
    await cdp.eval(`(() => {
      Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Avançar para Redação')).click();
    })()`);
    await cdp.waitFor(`() => document.querySelector('input[aria-label="Nome completo do participante 1"]')?.value === 'Ana Única'`);
    // Salvar rascunho -> promove Ana Única (AUTO_SUGGESTED) para PERSISTED
    await cdp.eval(`(() => {
      Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Salvar Rascunho')).click();
    })()`);
    await cdp.waitFor(`() => document.body.innerText.includes('Rascunho salvo com sucesso!')`);

    // Voltar ao Passo 1, marcar João Fase2 e desmarcar Lucas Único -> Ana Única deve PERMANECER (PERSISTED!)
    await cdp.eval(`(() => {
      Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Alunos & Pauta')).click();
    })()`);
    await cdp.waitFor(`() => document.body.innerText.includes('Lucas Único')`);
    await cdp.eval(`(() => {
      const p = Array.from(document.querySelectorAll('div[class*="cursor-pointer"] p')).find(el => el.textContent && el.textContent.trim() === 'João Fase2');
      p.closest('[class*="cursor-pointer"]').click();
    })()`);
    await cdp.waitFor(`() => document.body.innerText.includes('2 selecionados')`);
    await cdp.eval(`(() => {
      const p = Array.from(document.querySelectorAll('div[class*="cursor-pointer"] p')).find(el => el.textContent && el.textContent.trim() === 'Lucas Único');
      p.closest('[class*="cursor-pointer"]').click();
    })()`);
    await cdp.waitFor(`() => document.body.innerText.includes('1 selecionado')`);
    await cdp.eval(`(() => {
      Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Redação Oficial & Assinaturas')).click();
    })()`);
    await cdp.waitFor(`() => document.querySelector('input[aria-label="Nome completo do participante 1"]')?.value === 'Ana Única'`);

    // CENÁRIO D: Interceptação CDP de resposta atrasada vs seleção mais recente
    await cdp.eval(`(() => {
      Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Fechar').click();
    })()`);
    await delay(200);
    await cdp.send("Fetch.enable", {
      patterns: [{ urlPattern: "*participant-candidates*part=contacts*", requestStage: "Request" }],
    });

    const delayedRequests = [];
    cdp.on("Fetch.requestPaused", async (params) => {
      const url = params.request.url;
      if (url.includes("stu-e2e-a") && !url.includes("stu-e2e-b")) {
        delayedRequests.push(params.requestId);
        return; // Segura resposta #1 (stu-e2e-a)
      }
      // Responde imediatamente a requisição mais recente (stu-e2e-b)
      await cdp.send("Fetch.continueRequest", { requestId: params.requestId });
    });

    await cdp.eval(`(() => {
      Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Nova Ata')).click();
    })()`);
    await cdp.waitFor(`() => document.body.innerText.includes('João Fase2')`);
    // Clica em João Fase2 (dispara req #1 atrasada) e imediatamente troca para Lucas Único (req #2 rápida)
    await cdp.eval(`(() => {
      const p = Array.from(document.querySelectorAll('div[class*="cursor-pointer"] p')).find(el => el.textContent && el.textContent.trim() === 'João Fase2');
      p.closest('[class*="cursor-pointer"]').click();
    })()`);
    await delay(100);
    await cdp.eval(`(() => {
      const p = Array.from(document.querySelectorAll('div[class*="cursor-pointer"] p')).find(el => el.textContent && el.textContent.trim() === 'João Fase2');
      p.closest('[class*="cursor-pointer"]').click();
    })()`);
    await delay(30);
    await cdp.eval(`(() => {
      const p = Array.from(document.querySelectorAll('div[class*="cursor-pointer"] p')).find(el => el.textContent && el.textContent.trim() === 'Lucas Único');
      p.closest('[class*="cursor-pointer"]').click();
    })()`);
    await cdp.waitFor(`() => document.body.innerText.includes('1 selecionado')`);
    await delay(400);

    // Libera agora a resposta atrasada #1 se houver
    for (const reqId of delayedRequests) {
      try {
        await cdp.send("Fetch.continueRequest", { requestId: reqId });
      } catch {}
    }
    await delay(300);

    await cdp.eval(`(() => {
      Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Avançar para Redação')).click();
    })()`);
    await cdp.waitFor(`() => document.querySelector('select[aria-label="Selecionar cadastro para o participante 1"]') !== null`);
    const finalPickerHtml = await cdp.eval(
      `document.querySelector('select[aria-label="Selecionar cadastro para o participante 1"]').innerHTML`
    );
    assert(finalPickerHtml.includes("Ana Única"), "Seleção atual (Lucas Único -> Ana Única) deve prevalecer");
    assert(!finalPickerHtml.includes("Vizinho Recado"), "Resposta atrasada da seleção anterior NÃO pode sobrescrever a atual");

    await cdp.send("Fetch.disable");

    // CENÁRIO E: Homologação 3 — FAMILIAR_CONTATO na visualização, impressão, PDF/A, validação pública e ata histórica 2025
    // 1) Configura PIN do servidor e lavra uma ata real via API autenticada do navegador com FAMILIAR_CONTATO
    const finalizedResJson = await cdp.eval(`(async () => {
      const pinRes = await fetch('/api/user/signing-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'setup', pin: '739152' }),
      });
      if (!pinRes.ok) throw new Error('PIN setup failed: ' + await pinRes.text());

      const createRes = await fetch('/api/atas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attendedAt: new Date().toISOString(),
          category: 'ACOMPANHAMENTO_PEDAGOGICO',
          subject: 'Atendimento Homologação Familiar Contato',
          rawNotes: 'Contato de recado compareceu para orientação.',
          summary: 'Atendimento registrado com contato de recado para entrega de comunicado escolar.',
          studentIds: ['stu-e2e-a'],
          participants: [
            {
              role: 'FAMILIAR_CONTATO',
              name: 'Vizinho Recado',
              kinship: 'Contato de recado',
              documentType: 'RG',
              documentNumber: '55443322',
              signatureMode: 'SCREEN_CANVAS',
              signatureData: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
              phone: '42988887777',
            },
          ],
          actionItems: [],
        }),
      });
      const created = await createRes.json();
      if (!createRes.ok) throw new Error('Create ata failed: ' + JSON.stringify(created));

      const finRes = await fetch('/api/atas/' + created.minute.id + '/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signingPin: '739152' }),
      });
      const finJson = await finRes.json();
      if (!finRes.ok) throw new Error('Finalize ata failed: ' + JSON.stringify(finJson));
      return finJson.minute;
    })()`);

    assert(finalizedResJson?.id, "Ata FAMILIAR_CONTATO deve ser lavrada com sucesso");
    assert(finalizedResJson?.verificationCode, "Ata lavrada deve gerar verificationCode");

    // 2) Baixa PDF/A real do servidor autenticado e verifica texto extraído via pdftotext
    const pdfBase64 = await cdp.eval(`(async () => {
      const r = await fetch('/api/atas/' + ${JSON.stringify(finalizedResJson.id)} + '/pdfa');
      if (!r.ok) throw new Error('PDF/A failed: ' + r.status + ' ' + await r.text());
      const buf = new Uint8Array(await r.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
      return btoa(bin);
    })()`);
    const pdfBuffer = Buffer.from(pdfBase64, "base64");
    assert(pdfBuffer.slice(0, 5).toString("latin1") === "%PDF-", "PDF/A deve iniciar com %PDF-");
    const tmpPdfPath = path.join(os.tmpdir(), `e2e_fase2_pdfa_${Date.now()}.pdf`);
    let extractedPdfText = "";
    try {
      fs.writeFileSync(tmpPdfPath, pdfBuffer);
      extractedPdfText = execFileSync("pdftotext", [tmpPdfPath, "-"], { encoding: "utf8" });
    } finally {
      try {
        fs.unlinkSync(tmpPdfPath);
      } catch {}
    }
    assert(
      extractedPdfText.includes("Vizinho Recado (Familiar / Contato") &&
        extractedPdfText.includes("Contato de recado"),
      `PDF/A deve identificar Familiar / Contato e parentesco. Extraído: ${extractedPdfText.slice(0, 800)}`
    );
    assert(
      !extractedPdfText.includes("FAMILIAR_CONTATO") && !extractedPdfText.includes("Responsável Legal"),
      `PDF/A NÃO pode conter enum cru nem 'Responsável Legal' para FAMILIAR_CONTATO`
    );

    // 3) Valida visualização Tela B no modal /atas
    await cdp.send("Page.navigate", { url: `${APP_URL}/atas` });
    await delay(250);
    await cdp.waitFor(`() => document.body?.innerText?.includes('Atendimento Homologação Familiar Contato')`);
    await cdp.eval(`(() => {
      const cards = Array.from(document.querySelectorAll('div')).filter(d => d.textContent && d.textContent.includes('Atendimento Homologação Familiar Contato'));
      for (const c of cards.reverse()) {
        const btn = Array.from(c.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Ver Detalhes'));
        if (btn) { btn.click(); return; }
      }
      throw new Error('Botão Ver Detalhes não encontrado');
    })()`);
    await cdp.waitFor(`() => document.body?.innerText?.includes('Hash SHA-256 Original')`);
    const telaBText = await cdp.eval(`document.body.innerText`);
    assert(
      telaBText.includes("Familiar / Contato") && telaBText.includes("Contato de recado"),
      "Visualização modal Tela B deve exibir Familiar / Contato e Contato de recado"
    );
    assert(
      !telaBText.includes("FAMILIAR_CONTATO"),
      "Visualização modal Tela B NÃO pode exibir enum cru FAMILIAR_CONTATO"
    );

    // 4) Valida rota de impressão /atas/[id]/imprimir
    await cdp.send("Page.navigate", { url: `${APP_URL}/atas/${finalizedResJson.id}/imprimir` });
    await delay(250);
    await cdp.waitFor(`() => document.body?.innerText?.includes('Vizinho Recado')`);
    const printText = await cdp.eval(`document.body.innerText`);
    assert(
      printText.toUpperCase().includes("FAMILIAR / CONTATO") &&
        printText.toUpperCase().includes("CONTATO DE RECADO"),
      "Impressão A4 deve identificar FAMILIAR / CONTATO e Contato de recado"
    );
    assert(
      !printText.toUpperCase().includes("RESPONSÁVEL LEGAL") && !printText.includes("FAMILIAR_CONTATO"),
      "Impressão A4 NÃO deve tratar FAMILIAR_CONTATO como Responsável Legal nem mostrar enum cru"
    );

    // 5) Valida portal público /validar/ata/[code] para a nova ata FAMILIAR_CONTATO E para ata histórica 2025
    await cdp.send("Page.navigate", { url: `${APP_URL}/validar/ata/${finalizedResJson.verificationCode}` });
    await delay(250);
    await cdp.waitFor(`() => document.body?.innerText?.includes('Ata pedagógica autêntica')`);
    const publicFamText = await cdp.eval(`document.body.innerText`);
    assert(
      publicFamText.includes("Familiar / Contato") && !publicFamText.includes("FAMILIAR_CONTATO"),
      "Portal público deve exibir Familiar / Contato sem enum cru"
    );

    await cdp.send("Page.navigate", { url: `${APP_URL}/validar/ata/HIST-E2E-2025` });
    await delay(250);
    await cdp.waitFor(`() => document.body?.innerText?.includes('HIST-E2E-2025') || document.body?.innerText?.includes('007/2025')`);
    const publicHistText = await cdp.eval(`document.body.innerText`);
    assert(
      publicHistText.includes("Ata pedagógica autêntica") && publicHistText.includes("Responsável Legal"),
      `Ata histórica 2025 deve manter validação SHA-256 íntegra. Texto: ${publicHistText.slice(0, 500)}`
    );

    // CENÁRIO F: Homologação 5 — Assinaturas, recusas e QR ativo protegidos na UI e no servidor (HTTP 409)
    await cdp.send("Page.navigate", { url: `${APP_URL}/atas` });
    await delay(250);
    await cdp.waitFor(`() => document.body?.innerText?.includes('Assuntos Protegidos E2E')`);
    await cdp.eval(`(() => {
      const cards = Array.from(document.querySelectorAll('div')).filter(d => d.textContent && d.textContent.includes('Assuntos Protegidos E2E'));
      for (const c of cards.reverse()) {
        const btn = Array.from(c.querySelectorAll('button')).find(b => b.textContent && b.textContent.trim() === 'Editar');
        if (btn) { btn.click(); return; }
      }
      throw new Error('Botão Editar do rascunho protegido não encontrado');
    })()`);
    await cdp.waitFor(`() => document.querySelector('input[aria-label="Nome completo do participante 1"]')?.value === 'Assinado Canvas'`);
    const lockCheck = await cdp.eval(`(() => {
      const locks = [1, 2, 3].map((idx) => ({
        nameDisabled: document.querySelector('input[aria-label="Nome completo do participante ' + idx + '"]')?.disabled,
        roleDisabled: document.querySelector('select[aria-label="Papel do participante ' + idx + '"]')?.disabled,
        docDisabled: document.querySelector('input[aria-label="Documento do participante ' + idx + '"]')?.disabled,
      }));
      const txt = document.body.innerText;
      return {
        locks,
        hasRefazer: txt.includes('Refazer assinatura'),
        hasCancelarRecusa: txt.includes('Cancelar recusa'),
        hasCancelarQr: txt.includes('Cancelar link QR e editar'),
      };
    })()`);
    // Assinado (idx 0) e Recusado (idx 1) bloqueiam nome, papel e documento;
    // QR ativo (idx 2) bloqueia nome e documento e intercepta troca de papel via handleCancelParticipantQr
    assert.equal(lockCheck.locks[0].nameDisabled, true, "Nome deve estar bloqueado para assinado");
    assert.equal(lockCheck.locks[0].roleDisabled, true, "Papel deve estar bloqueado para assinado");
    assert.equal(lockCheck.locks[0].docDisabled, true, "Documento deve estar bloqueado para assinado");
    assert.equal(lockCheck.locks[1].nameDisabled, true, "Nome deve estar bloqueado para recusa");
    assert.equal(lockCheck.locks[1].roleDisabled, true, "Papel deve estar bloqueado para recusa");
    assert.equal(lockCheck.locks[1].docDisabled, true, "Documento deve estar bloqueado para recusa");
    assert.equal(lockCheck.locks[2].nameDisabled, true, "Nome deve estar bloqueado para QR ativo");
    assert.equal(lockCheck.locks[2].docDisabled, true, "Documento deve estar bloqueado para QR ativo");
    assert(lockCheck.hasRefazer && lockCheck.hasCancelarRecusa && lockCheck.hasCancelarQr, "Controles explícitos de desbloqueio devem aparecer na UI");

    // Tentativas de adulteração no servidor via PATCH para cada participante protegido -> 409 CONFLICT
    const patchStatuses = await cdp.eval(`(async () => {
      const baseParticipants = [
        { id: 'mp-e2e-prot-sig', role: 'RESPONSAVEL', name: 'Assinado Canvas', kinship: 'Mãe/Pai', documentType: 'CPF', documentNumber: '222.333.444-55', signatureMode: 'SCREEN_CANVAS' },
        { id: 'mp-e2e-prot-ref', role: 'FAMILIAR_CONTATO', name: 'Recusa Termo', kinship: 'Contato de recado', documentType: 'RG', documentNumber: '99887766', signatureMode: 'REFUSED' },
        { id: 'mp-e2e-prot-qr', role: 'FAMILIAR_CONTATO', name: 'QR Ativo', kinship: 'Tio / Tia', documentType: 'RG', documentNumber: '44556677', signatureMode: 'MOBILE_QR' },
      ];
      const sendTamper = async (idx, patch) => {
        const clone = baseParticipants.map((p, i) => (i === idx ? { ...p, ...patch } : p));
        const res = await fetch('/api/atas/ata-e2e-prot', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ participants: clone }),
        });
        return res.status;
      };
      const qrPhoneStatus = await sendTamper(2, { phone: '42999998888' });
      const qrTokenStillActiveRes = await fetch('/api/atas/sign-token/tok-e2e-qr-ativo');
      const qrTamperStatus = await sendTamper(2, { name: 'QR Adulterado' });
      const qrTokenBurnedRes = await fetch('/api/atas/sign-token/tok-e2e-qr-ativo');
      return {
        signedTamperStatus: await sendTamper(0, { name: 'Outro Nome' }),
        refusedTamperStatus: await sendTamper(1, { role: 'RESPONSAVEL' }),
        qrPhoneStatus,
        qrTokenStillActiveStatus: qrTokenStillActiveRes.status,
        qrTamperStatus,
        qrTokenBurnedStatus: qrTokenBurnedRes.status,
      };
    })()`);
    assert.equal(patchStatuses.signedTamperStatus, 409, "Alterar participante assinado deve retornar 409");
    assert.equal(patchStatuses.refusedTamperStatus, 409, "Alterar participante com recusa deve retornar 409");
    assert.equal(patchStatuses.qrPhoneStatus, 200, "Atualizar apenas telefone deve preservar QR ativo");
    assert.equal(patchStatuses.qrTokenStillActiveStatus, 200, "QR ativo deve permanecer válido após atualizar apenas telefone");
    assert.equal(patchStatuses.qrTamperStatus, 200);
    assert.equal(patchStatuses.qrTokenBurnedStatus, 404, "Alterar identidade em PATCH deve queimar imediatamente o token QR anterior");

    const dbProtected = await prisma.pedagogicalMinuteParticipant.findMany({
      where: { minuteId: "ata-e2e-prot" },
      orderBy: { id: "asc" },
    });
    assert.equal(dbProtected.find((p) => p.id === "mp-e2e-prot-qr")?.mobileSignToken, null);
    assert.equal(dbProtected.find((p) => p.id === "mp-e2e-prot-ref")?.refusalReason, "Recusa motivada");
    assert.equal(dbProtected.find((p) => p.id === "mp-e2e-prot-ref")?.witnessName, "Testemunha Maria");
    assert.equal(dbProtected.find((p) => p.id === "mp-e2e-prot-sig")?.name, "Assinado Canvas");

    console.log("ALL E2E BROWSER SCENARIOS PASSED SUCCESSFULLY");
  } finally {
    cdp?.close();
    try {
      process.kill(-chrome.pid, "SIGKILL");
    } catch {}
    try {
      process.kill(-server.pid, "SIGKILL");
    } catch {}
    await prisma.pedagogicalMinute.deleteMany({ where: { schoolId: "e2e-fase2-school" } });
    await prisma.studentContact.deleteMany({
      where: { student: { schoolId: "e2e-fase2-school" } },
    });
    await prisma.student.deleteMany({ where: { schoolId: "e2e-fase2-school" } });
    await prisma.classGroup.deleteMany({ where: { schoolId: "e2e-fase2-school" } });
    await prisma.userSchool.deleteMany({ where: { schoolId: "e2e-fase2-school" } });
    await prisma.user.deleteMany({
      where: {
        email: { in: ["pedagoga.fase2@escola.pr.gov.br", "carlos.fase2@escola.pr.gov.br"] },
      },
    });
    await prisma.school.deleteMany({ where: { id: "e2e-fase2-school" } });
    await prisma.$disconnect();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("E2E FAILED:", err);
    process.exit(1);
  });
