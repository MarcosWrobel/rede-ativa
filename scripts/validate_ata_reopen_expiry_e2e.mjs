import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import assert from "node:assert/strict";
import { execFileSync, fork, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const file = fileURLToPath(import.meta.url);
const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(file), "..");

const playwrightPath =
  process.env.PLAYWRIGHT_PKG_PATH ||
  "/home/marcoswrobel/Documentos/BOT_RCOv1.0/.venv/lib/python3.14/site-packages/playwright/driver/package";
const firefoxPath =
  process.env.FIREFOX_EXECUTABLE_PATH ||
  "/home/marcoswrobel/.cache/ms-playwright/firefox-1511/firefox/firefox";
const headlessShellPath =
  "/home/marcoswrobel/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell";
const chromePath =
  process.env.CHROMIUM_EXECUTABLE_PATH ||
  (fs.existsSync(headlessShellPath)
    ? headlessShellPath
    : "/home/marcoswrobel/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome");

const SYNTHETIC_DB_URL =
  process.env.SYNTHETIC_DATABASE_URL ||
  "postgresql://redeativa_teste:redeativa_teste_local@127.0.0.1:32770/redeativa_local_sintetico?schema=public";

async function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

async function parent() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "redeativa-e2e-full-"));
  const child = fork(file, ["--child", temp, ...process.argv.slice(2)], {
    detached: true,
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });

  let resources;
  child.on("message", (msg) => {
    if (msg.type === "resources") resources = msg;
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {}
  }, 300000);

  const result = await new Promise((resolve) =>
    child.on("exit", (code, signal) => resolve({ code, signal }))
  );
  clearTimeout(timer);

  if (result.code !== 0 || timedOut) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {}
  }

  fs.rmSync(temp, { recursive: true, force: true });

  const portsClosed = resources
    ? await Promise.all(
        resources.ports.map(
          (port) =>
            new Promise((resolve) => {
              const socket = net.connect(port, "127.0.0.1");
              socket.once("connect", () => {
                socket.destroy();
                resolve(false);
              });
              socket.once("error", () => resolve(true));
              socket.setTimeout(1000, () => {
                socket.destroy();
                resolve(false);
              });
            })
        )
      )
    : [];

  const gone = !fs.existsSync(temp) && resources && portsClosed.every(Boolean);
  console.log(
    JSON.stringify({
      cleanup: {
        resourcesReported: Boolean(resources),
        portsClosed,
        tempRemoved: !fs.existsSync(temp),
        childExited: true,
        timedOut,
      },
      child: result,
    })
  );

  if (!gone || timedOut || result.code !== 0) {
    process.exitCode = 1;
  }
}

function prepareIsolatedAppDir(temp) {
  const appDir = path.join(temp, "app");
  fs.mkdirSync(appDir, { recursive: true });

  const dirsToCopy = ["src", "public", "prisma"];
  for (const dir of dirsToCopy) {
    fs.cpSync(path.join(repoRoot, dir), path.join(appDir, dir), { recursive: true });
  }

  const filesToCopy = [
    "package.json",
    "next.config.mjs",
    "next-env.d.ts",
    "postcss.config.mjs",
    "tailwind.config.ts",
    "tsconfig.json",
  ];
  for (const f of filesToCopy) {
    const srcPath = path.join(repoRoot, f);
    if (fs.existsSync(srcPath)) {
      fs.cpSync(srcPath, path.join(appDir, f));
    }
  }

  // Sem arquivo .env no diretório isolado para garantir que o banco de produção nunca seja carregado.
  fs.symlinkSync(path.join(repoRoot, "node_modules"), path.join(appDir, "node_modules"));
  return appDir;
}

async function waitForServer(baseUrl, getLogs, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (getLogs().includes("Ready in")) {
      try {
        const res = await fetch(`${baseUrl}/login`, {
          redirect: "manual",
          signal: AbortSignal.timeout(30000),
        });
        if (res.status >= 200 && res.status < 500) return;
      } catch {}
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timeout aguardando servidor em ${baseUrl}`);
}

function querySyntheticDb(sql) {
  return execFileSync(
    "docker",
    [
      "exec",
      "redeativa-local-sintetico",
      "psql",
      "-U",
      "redeativa_teste",
      "-d",
      "redeativa_local_sintetico",
      "-At",
      "-c",
      sql,
    ],
    { encoding: "utf8", timeout: 10000 }
  ).trim();
}

async function child(temp) {
  let pw;
  try {
    pw = require(playwrightPath);
  } catch {
    console.error("Playwright não encontrado:", playwrightPath);
    process.exit(1);
  }
  const { chromium, firefox } = pw;

  const appDir = prepareIsolatedAppDir(temp);
  const port = await findFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  if (process.send) process.send({ type: "resources", ports: [port] });

  const nextBin = path.join(repoRoot, "node_modules/next/dist/bin/next");
  const serverProc = spawn(
    process.execPath,
    [nextBin, "dev", "--webpack", "--hostname", "127.0.0.1", "--port", String(port)],
    {
    cwd: appDir,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: "development",
      DATABASE_URL: SYNTHETIC_DB_URL,
      ENABLE_DEV_AUTH: "true",
      AUTH_SECRET: "redeativa-e2e-sintetico-secret-1234567890",
      NEXTAUTH_URL: baseUrl,
      APP_URL: baseUrl,
      NEXT_PUBLIC_APP_URL: baseUrl,
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
    },
  });

  let serverLogs = "";
  serverProc.stdout.on("data", (d) => {
    serverLogs += d.toString();
  });
  serverProc.stderr.on("data", (d) => {
    serverLogs += d.toString();
  });

  const testSubject = `E2E Sintetico Ata ${Date.now()}`;
  let browser;

  try {
    await waitForServer(baseUrl, () => serverLogs, 90000);
    // Pré-aquece rotas públicas antes de abrir o navegador
    await Promise.all([
      fetch(`${baseUrl}/assinar/ata/warmup-compile`, { redirect: "manual" }).catch(() => {}),
      fetch(`${baseUrl}/api/atas/sign-token/warmup-compile`, { redirect: "manual" }).catch(() => {}),
      fetch(`${baseUrl}/api/atas/sign-token/warmup-compile`, { method: "POST", body: "{}" }).catch(() => {}),
    ]);

    const useFirefox = process.env.E2E_BROWSER !== "chromium" && fs.existsSync(firefoxPath);
    browser = useFirefox
      ? await firefox.launch({
          executablePath: firefoxPath,
          headless: true,
        })
      : await chromium.launch({
          executablePath: chromePath,
          headless: true,
          args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
        });

    const desktopContext = await browser.newContext({
      viewport: { width: 1366, height: 900 },
    });
    const mobileContext = await browser.newContext({
      viewport: { width: 412, height: 892 },
    });

    const desktopPage = await desktopContext.newPage();
    desktopPage.setDefaultTimeout(60000);
    const mobilePage = await mobileContext.newPage();
    mobilePage.setDefaultTimeout(60000);

    // Pré-aquece os bundles públicos antes de abrir o editor
    await mobilePage.goto(`${baseUrl}/assinar/ata/warmup-compile`, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});

    // 1. Login real com usuário sintético em /login -> /busca-ativa -> warmup -> /atas
    await desktopPage.goto(`${baseUrl}/login`, { waitUntil: "networkidle" });
    await desktopPage.fill("#dev-login-email", "teste.extensao@escola.pr.gov.br");
    await desktopPage.click("button:has-text('Entrar no ambiente local')");
    await desktopPage.waitForURL("**/busca-ativa**", { timeout: 30000 });

    // Pré-aquece todas as rotas de API e /atas enquanto ainda está em /busca-ativa
    await desktopPage.evaluate(async () => {
      await Promise.all([
        fetch("/atas").catch(() => {}),
        fetch("/api/users").catch(() => {}),
        fetch("/api/atas?year=2026").catch(() => {}),
        fetch("/api/atas/actions/alerts").catch(() => {}),
        fetch("/api/ai/test-key").catch(() => {}),
        fetch("/api/atas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        }).catch(() => {}),
        fetch("/api/atas/warmup-compile").catch(() => {}),
        fetch("/api/atas/warmup-compile?poll=1").catch(() => {}),
        fetch("/api/atas/warmup-compile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        }).catch(() => {}),
        fetch("/api/atas/warmup-compile/sign-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        }).catch(() => {}),
      ]);
    });

    await desktopPage.goto(`${baseUrl}/atas`, { waitUntil: "networkidle" });
    await desktopPage
      .getByText("Nenhuma ata encontrada")
      .or(desktopPage.locator("button:has-text('Editar')").first())
      .waitFor({ timeout: 30000 });

    // 2. Criar rascunho com 2 participantes sintéticos
    await desktopPage.click("button:has-text('Nova Ata')");
    await desktopPage.locator('input[placeholder*="alinhamento"]').first().waitFor({ timeout: 30000 });
    await desktopPage.locator('input[placeholder*="alinhamento"]').first().fill(testSubject);
    await desktopPage.locator("text=Estudante Sintético").first().click({ noWaitAfter: true });
    await desktopPage.click("button:has-text('Avançar para Redação & Assinatura')", { noWaitAfter: true });

    await desktopPage
      .locator('textarea[placeholder*="Redija o texto oficial da ata"]')
      .first()
      .fill("Registro sintético de validação integrada no banco local.");

    const nameInputs = desktopPage.locator('input[placeholder="Nome completo..."]');
    while ((await nameInputs.count()) < 2) {
      await desktopPage.click("button:has-text('Novo Presente')");
      await desktopPage.waitForTimeout(100);
    }
    await nameInputs.nth(0).fill("Responsável Sintético 1");
    await nameInputs.nth(1).fill("Responsável Sintético 2");

    // 3. Gerar QR (20 min) para Participante 1 e assinar desenhando no celular
    const qrButtons = desktopPage.locator("button:has-text('QR Celular (Biometria)')");
    await qrButtons.nth(0).scrollIntoViewIfNeeded();
    await qrButtons.nth(0).click({ noWaitAfter: true });
    await desktopPage.waitForSelector("a:has-text('Abrir em Nova Aba')", { timeout: 60000 });
    await desktopPage.waitForSelector("text=Válido até", { timeout: 20000 });

    const signUrl1 = await desktopPage.locator("a:has-text('Abrir em Nova Aba')").getAttribute("href");
    assert.ok(signUrl1 && signUrl1.includes("/assinar/ata/"), `URL de assinatura inválida: ${signUrl1}`);

    await mobilePage.goto(signUrl1, { waitUntil: "load", timeout: 45000 });
    await mobilePage.waitForSelector("text=Responsável Sintético 1", { timeout: 45000 });
    const canvas = mobilePage.locator("canvas").first();
    await canvas.waitFor({ state: "visible", timeout: 45000 });
    await canvas.scrollIntoViewIfNeeded();
    await mobilePage.waitForTimeout(300);
    const box = await canvas.boundingBox();
    assert.ok(box && box.width > 20 && box.height > 20, "Canvas de assinatura visível");

    await mobilePage.mouse.move(box.x + 25, box.y + 30);
    await mobilePage.mouse.down();
    await mobilePage.mouse.move(box.x + 120, box.y + 55, { steps: 6 });
    await mobilePage.mouse.up();

    const confirmSignBtn = mobilePage.locator("button:has-text('Confirmar Assinatura Oficial')");
    await mobilePage.waitForFunction(
      () => {
        const btn = Array.from(document.querySelectorAll("button")).find((b) =>
          (b.textContent || "").includes("Confirmar Assinatura Oficial")
        );
        return Boolean(btn && !btn.disabled);
      },
      { timeout: 20000 }
    );
    await confirmSignBtn.click();
    await mobilePage.waitForSelector("text=Assinatura Concluída!", { timeout: 45000 });

    // 4. Computador reconhece assinatura automaticamente e fecha painel
    await desktopPage.waitForFunction(() => !document.body.innerText.includes("Fechar Painel de Assinatura"), {
      timeout: 45000,
    });
    await desktopPage.waitForSelector("text=✓ Assinado Digitalmente", { timeout: 20000 });

    // 5. CENÁRIO PENDENTE 1: Atualizar página SEM clicar em "Salvar Rascunho" e reabrir a ata
    await desktopPage.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    await desktopPage.waitForSelector(`text=${testSubject}`, { timeout: 45000 });
    const rowEdit = desktopPage.locator('button:has-text("Editar")').first();
    await rowEdit.waitFor({ state: "visible", timeout: 30000 });
    await rowEdit.click({ noWaitAfter: true });

    await desktopPage.waitForSelector("text=✓ Assinado Digitalmente", { timeout: 45000 });
    await desktopPage.waitForFunction(
      () => !document.body.innerText.includes("Carregando dados completos da ata"),
      { timeout: 45000 }
    );
    const persistedBadgeCount = await desktopPage.locator("text=✓ Assinado Digitalmente").count();
    assert.ok(persistedBadgeCount >= 1, "Cenário 1 falhou: assinatura desenhada sumiu após reabrir sem salvar");

    // Confirma persistência real no PostgreSQL
    const dbPart1 = querySyntheticDb(
      `SELECT "hasSignature", "signatureMode", length(coalesce("signatureData", '')), "signedAt" IS NOT NULL FROM "PedagogicalMinuteParticipant" WHERE name = 'Responsável Sintético 1' ORDER BY "createdAt" DESC LIMIT 1;`
    );
    const [dbHasSig, dbMode, dbSigLen, dbSignedAtOk] = dbPart1.split("|");
    assert.equal(dbHasSig, "t", "PostgreSQL deve registrar hasSignature=true");
    assert.equal(dbMode, "MOBILE_QR", "PostgreSQL deve registrar signatureMode=MOBILE_QR");
    assert.ok(Number(dbSigLen) > 100, "PostgreSQL deve persistir signatureData não vazio");
    assert.equal(dbSignedAtOk, "t", "PostgreSQL deve persistir signedAt");

    // 6. CENÁRIO PENDENTE 2: Link de 20 min permanece válido e com prazo esperado no banco e na UI
    await desktopPage.locator("button:has-text('QR Celular (Biometria)')").first().click({ noWaitAfter: true });
    await desktopPage.waitForSelector("a:has-text('Abrir em Nova Aba')", { timeout: 45000 });
    const signUrl20m = await desktopPage.locator("a:has-text('Abrir em Nova Aba')").getAttribute("href");
    assert.ok(signUrl20m && signUrl20m.includes("/assinar/ata/"));
    const validity20mText = await desktopPage.locator("text=Válido até").first().innerText();
    assert.ok(validity20mText.includes("Válido até"), "Validade de 20m deve estar visível");

    const db20mSecondsLeft = Number(
      querySyntheticDb(
        `SELECT EXTRACT(EPOCH FROM ("mobileSignExpiresAt" - NOW()))::int FROM "PedagogicalMinuteParticipant" WHERE name = 'Responsável Sintético 2' ORDER BY "createdAt" DESC LIMIT 1;`
      )
    );
    assert.ok(
      db20mSecondsLeft >= 1140 && db20mSecondsLeft <= 1260,
      `Prazo de 20m esperado ~1200s no PostgreSQL, recebido ${db20mSecondsLeft}s`
    );

    const token20m = signUrl20m.split("/assinar/ata/")[1];
    const api20m = await fetch(`${baseUrl}/api/atas/sign-token/${token20m}`);
    assert.equal(api20m.status, 200, "GET /api/atas/sign-token/[20m] deve retornar 200");
    const api20mJson = await api20m.json();
    assert.equal(api20mJson.participant?.name, "Responsável Sintético 2");

    await mobilePage.goto(signUrl20m, { waitUntil: "domcontentloaded", timeout: 45000 });
    await mobilePage.waitForSelector("text=Responsável Sintético 2", { timeout: 45000 });

    // Aguarda 3s e confirma que o link de 20m continua válido sem renovação/invalidação
    await new Promise((r) => setTimeout(r, 3000));
    const api20mAfterWait = await fetch(`${baseUrl}/api/atas/sign-token/${token20m}`);
    assert.equal(api20mAfterWait.status, 200, "Link de 20m deve permanecer válido após aguardar");

    // 7. CENÁRIO PENDENTE 3: Trocar para 24 horas atualiza vencimento, emite novo link e invalida o anterior
    await desktopPage.click("button:has-text('24 horas (Remoto)')", { noWaitAfter: true });
    await desktopPage.waitForFunction(
      (prevHref) => {
        const a = Array.from(document.querySelectorAll("a")).find((el) =>
          (el.textContent || "").includes("Abrir em Nova Aba")
        );
        return Boolean(a && a.getAttribute("href") && a.getAttribute("href") !== prevHref);
      },
      signUrl20m,
      { timeout: 45000 }
    );
    const signUrl24h = await desktopPage.locator("a:has-text('Abrir em Nova Aba')").getAttribute("href");
    assert.notEqual(signUrl24h, signUrl20m, "Troca para 24h deve gerar novo link");

    const validity24hText = await desktopPage.locator("text=Válido até").first().innerText();
    assert.ok(validity24hText.includes("às "), `Validade 24h deve exibir data e hora (recebido: ${validity24hText})`);

    const db24hSecondsLeft = Number(
      querySyntheticDb(
        `SELECT EXTRACT(EPOCH FROM ("mobileSignExpiresAt" - NOW()))::int FROM "PedagogicalMinuteParticipant" WHERE name = 'Responsável Sintético 2' ORDER BY "createdAt" DESC LIMIT 1;`
      )
    );
    assert.ok(
      db24hSecondsLeft >= 86280 && db24hSecondsLeft <= 86520,
      `Prazo de 24h esperado ~86400s no PostgreSQL, recebido ${db24hSecondsLeft}s`
    );

    const oldTokenRes = await fetch(`${baseUrl}/api/atas/sign-token/${token20m}`);
    assert.equal(oldTokenRes.status, 404, "Link anterior de 20m deve ser invalidado após troca para 24h");
    await mobilePage.goto(signUrl20m, { waitUntil: "domcontentloaded", timeout: 30000 });
    await mobilePage.waitForSelector("text=Link Inválido, Substituído ou Já Utilizado", { timeout: 30000 });

    const token24h = signUrl24h.split("/assinar/ata/")[1];
    const newTokenRes = await fetch(`${baseUrl}/api/atas/sign-token/${token24h}`);
    assert.equal(newTokenRes.status, 200, "Novo link de 24h deve responder 200");
    await mobilePage.goto(signUrl24h, { waitUntil: "domcontentloaded", timeout: 30000 });
    await mobilePage.waitForSelector("text=Responsável Sintético 2", { timeout: 30000 });

    console.log(
      JSON.stringify({
        ok: true,
        browser: useFirefox ? "firefox" : "chromium",
        baseUrl,
        scenarios: ["reopen_without_saving", "valid_20m_token", "switch_20m_to_24h"],
        dbHasSig,
        dbSigLen: Number(dbSigLen),
        db20mSecondsLeft,
        db24hSecondsLeft,
        validity20mText,
        validity24hText,
      })
    );
  } catch (err) {
    console.error("E2E ERROR:", err);
    try {
      if (browser) {
        const pages = browser.contexts().flatMap((c) => c.pages());
        for (let i = 0; i < pages.length; i++) {
          const txt = await pages[i]
            .locator("body")
            .innerText({ timeout: 5000 })
            .catch((e) => `[ERR innerText: ${e.message}]`);
          console.error(`--- PAGE ${i} (${pages[i].url()}) ---\n${txt.slice(-1000)}`);
        }
      }
    } catch {}
    if (serverLogs) {
      console.error("--- NEXT SERVER LOGS (tail) ---\n" + serverLogs.slice(-3000));
    }
    throw err;
  } finally {
    if (browser) await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 8000))]).catch(() => {});
    try {
      const escaped = testSubject.replace(/'/g, "''");
      querySyntheticDb(`DELETE FROM "PedagogicalMinute" WHERE subject = '${escaped}';`);
    } catch {}
    if (serverProc.pid) {
      try {
        process.kill(-serverProc.pid, "SIGTERM");
      } catch {}
    }
  }
}

if (process.argv.includes("--child")) {
  const temp = process.argv[process.argv.indexOf("--child") + 1];
  child(temp).catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else {
  parent().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
