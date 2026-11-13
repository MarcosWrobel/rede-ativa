import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import http from "node:http";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const file = fileURLToPath(import.meta.url);
const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(file), "..");

const playwrightPath =
  process.env.PLAYWRIGHT_PKG_PATH ||
  "/home/marcoswrobel/Documentos/BOT_RCOv1.0/.venv/lib/python3.14/site-packages/playwright/driver/package";
const chromePath =
  process.env.CHROMIUM_EXECUTABLE_PATH ||
  "/home/marcoswrobel/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome";

async function parent() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "redeativa-ata-reopen-"));
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
  }, 60000);

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
        profileRemoved: !fs.existsSync(temp),
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

async function child(temp) {
  let pw;
  try {
    pw = require(playwrightPath);
  } catch {
    console.error("Playwright não encontrado:", playwrightPath);
    process.exit(1);
  }
  const { chromium } = pw;
  const esbuild = require(path.join(repoRoot, "node_modules/esbuild"));

  const entrySource = `
    import React, { useState } from "react";
    import { createRoot } from "react-dom/client";
    import AtaEditorModal from "./src/components/ata/AtaEditorModal";

    function Harness() {
      const [minute, setMinute] = useState(null);
      const [isOpen, setIsOpen] = useState(false);

      window.__harness = {
        openMinute: (m) => {
          setMinute(m);
          setIsOpen(true);
        },
        close: () => setIsOpen(false),
      };

      return React.createElement(
        "div",
        null,
        isOpen
          ? React.createElement(AtaEditorModal, {
              isOpen,
              onClose: () => setIsOpen(false),
              availableStudents: [
                {
                  id: "stu-1",
                  name: "Estudante Teste",
                  cgm: "1001",
                  classGroup: { id: "cg-1", name: "6º Ano A" },
                },
              ],
              onSaved: () => {},
              existingMinute: minute,
            })
          : React.createElement("div", { id: "closed-marker" }, "closed")
      );
    }

    createRoot(document.getElementById("root")).render(React.createElement(Harness));
  `;

  const built = await esbuild.build({
    stdin: {
      contents: entrySource,
      resolveDir: repoRoot,
      loader: "tsx",
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    plugins: [
      {
        name: "stub-node-crypto",
        setup(build) {
          build.onResolve({ filter: /^crypto$/ }, () => ({
            path: "crypto",
            namespace: "stub-crypto",
          }));
          build.onLoad({ filter: /.*/, namespace: "stub-crypto" }, () => ({
            contents: "export default {}; export const randomBytes = () => new Uint8Array(16);",
            loader: "js",
          }));
        },
      },
    ],
  });

  const bundleJs = built.outputFiles[0].text;

  const server = http.createServer((req, res) => {
    if (req.url === "/bundle.js") {
      res.writeHead(200, { "Content-Type": "application/javascript" });
      res.end(bundleJs);
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<!doctype html><html><body><div id="root"></div><script src="/bundle.js"></script></body></html>`);
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  if (process.send) process.send({ type: "resources", ports: [port] });

  let browser;
  try {
    browser = await chromium.launch({
      executablePath: chromePath,
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const context = await browser.newContext({
      userDataDir: temp,
    });
    const page = await context.newPage();
    page.on("pageerror", (err) => console.error("[PAGEERROR]", err));

    const baseMinuteFromList = {
      id: "min-reopen-1",
      category: "ACOMPANHAMENTO_PEDAGOGICO",
      status: "DRAFT",
      verificationCode: "ATA-2026-0099",
      subject: "Reunião Inicial",
      rawNotes: "Relato inicial da reunião.",
      agreementsSummary: "Acordo inicial.",
      attendedAt: new Date().toISOString(),
      students: [{ studentId: "stu-1", studentNameSnapshot: "Estudante Teste" }],
      participants: [
        {
          id: "part-mob-1",
          role: "RESPONSAVEL",
          name: "Maria Responsável",
          signatureMode: "MOBILE_QR",
          signatureData: undefined,
          hasSignature: true,
          signedAt: "2026-11-12T14:05:00.000Z",
        },
        {
          id: "part-pend-2",
          role: "PROFESSOR",
          name: "Prof. João",
          signatureMode: "MOBILE_QR",
          signatureData: null,
          hasSignature: false,
        },
      ],
    };

    const hydratedMinute = {
      ...baseMinuteFromList,
      subject: "Assunto antigo do servidor",
      rawNotes: "Relato antigo do servidor",
      participants: [
        {
          ...baseMinuteFromList.participants[0],
          signatureData: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
          hasSignature: true,
        },
        baseMinuteFromList.participants[1],
      ],
    };

    let getBehavior = "immediate";
    let getCount = 0;
    let signTokenMode = "normal";
    let signTokenCalls = 0;

    await page.route("**/api/atas/min-reopen-1**", async (route) => {
      const url = route.request().url();
      const method = route.request().method();

      if (method === "GET" && url.includes("?poll=1")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            minuteId: "min-reopen-1",
            status: "DRAFT",
            participants: [
              {
                id: "part-pend-2",
                hasSignature: false,
                signatureMode: "MOBILE_QR",
                signedAt: null,
                verifiedEmail: null,
                activeMobileSign: true,
              },
            ],
          }),
        });
        return;
      }

      if (method === "GET") {
        getCount += 1;
        if (getBehavior === "error-once") {
          getBehavior = "immediate";
          await route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({ error: "Falha temporária ao carregar ata." }),
          });
          return;
        }
        if (getBehavior === "delayed") {
          await new Promise((r) => setTimeout(r, 350));
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ minute: hydratedMinute }),
        });
        return;
      }

      if (method === "PATCH") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ minute: hydratedMinute }),
        });
        return;
      }

      if (method === "POST" && url.endsWith("/sign-token")) {
        signTokenCalls += 1;
        const body = JSON.parse(route.request().postData() || "{}");
        const mins = Number(body.expiresInMinutes) || 20;
        const expiresAt = new Date(Date.now() + mins * 60_000).toISOString();
        if (signTokenMode === "delayed") {
          await new Promise((r) => setTimeout(r, 350));
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            token: `tok-${signTokenCalls}-${mins}`,
            expiresAt,
            validMinutes: mins,
            url: `https://redeativa.example/assinar/ata/tok-${signTokenCalls}-${mins}`,
          }),
        });
        return;
      }

      await route.continue();
    });

    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });

    // Cenário 1: Reabrir rascunho da listagem (sem signatureData) mantém "✓ Assinado Digitalmente" e hidrata
    await page.evaluate((m) => window.__harness.openMinute(m), baseMinuteFromList);
    await page.waitForSelector("text=✓ Assinado Digitalmente");
    await page.waitForFunction(() => !document.body.innerText.includes("Carregando dados completos da ata"));
    assert.equal(getCount, 1, "Cenário 1: deve buscar GET /api/atas/[id] ao abrir");
    const hasSignedBadge = await page.locator("text=✓ Assinado Digitalmente").count();
    assert.ok(hasSignedBadge >= 1, "Cenário 1: badge de assinatura desenhada deve permanecer visível");

    // Cenário 2: Edição local durante hidratação não é sobrescrita pelo retorno atrasado
    await page.evaluate(() => window.__harness.close());
    await page.waitForSelector("#closed-marker");
    getBehavior = "delayed";
    await page.evaluate((m) => window.__harness.openMinute(m), baseMinuteFromList);
    const notesInput = page.locator('textarea[placeholder*="Anotações dos fatos"]').first();
    await notesInput.waitFor({ state: "visible", timeout: 5000 });
    await notesInput.fill("Relato editado localmente", { timeout: 5000 });
    await page.waitForFunction(() => !document.body.innerText.includes("Carregando dados completos da ata"));
    const finalNotes = await notesInput.inputValue();
    assert.equal(
      finalNotes,
      "Relato editado localmente",
      "Cenário 2: hidratação atrasada não pode sobrescrever edição local"
    );

    // Cenário 3: Erro na hidratação bloqueia salvamento e recupera com "Tentar novamente"
    await page.evaluate(() => window.__harness.close());
    await page.waitForSelector("#closed-marker");
    getBehavior = "error-once";
    await page.evaluate((m) => window.__harness.openMinute(m), baseMinuteFromList);
    await page.waitForSelector("text=Tentar novamente");
    const saveDisabled = await page.locator("button:has-text('Salvar Rascunho')").isDisabled();
    assert.equal(saveDisabled, true, "Cenário 3: Salvar Rascunho deve ficar desabilitado durante erro");
    await page.click("button:has-text('Tentar novamente')");
    await page.waitForFunction(() => !document.body.innerText.includes("Tentar novamente"));
    const saveEnabledAfterRetry = await page.locator("button:has-text('Salvar Rascunho')").isDisabled();
    assert.equal(saveEnabledAfterRetry, false, "Cenário 3: Salvar Rascunho deve habilitar após nova tentativa");

    // Cenário 4: Gerar QR 20 min, exibir "Válido até", renovar para 24 horas e atualizar validade
    const qrButtons = page.locator("button:has-text('QR Celular (Biometria)')");
    await qrButtons.first().click();
    await page.waitForSelector("text=Válido até");
    const text20m = await page.locator("text=Válido até").first().innerText();
    assert.ok(text20m.includes("Válido até"), "Cenário 4: deve exibir horário de validade 20m");

    await page.click("button:has-text('24 horas (Remoto)')");
    await page.waitForFunction(() => document.body.innerText.includes("às "));
    const text24h = await page.locator("text=Válido até").first().innerText();
    assert.ok(text24h.includes("às "), "Cenário 4: renovação 24h deve exibir data e hora (dd/mm às HHhMM)");

    // Cenário 5: Fechar painel durante renovação atrasada não reabre painel ao concluir
    signTokenMode = "delayed";
    await page.click("button:has-text('20 min (Presencial)')");
    await page.waitForTimeout(40);
    await page.click("button:has-text('Fechar Painel de Assinatura')");
    await page.waitForTimeout(450);
    const panelStillClosed = await page.locator("text=Válido até").count();
    assert.equal(panelStillClosed, 0, "Cenário 5: painel fechado não deve reabrir com resposta atrasada");

    // Fechar modal desmonta timer sem erros
    await page.evaluate(() => window.__harness.close());
    await page.waitForSelector("#closed-marker");

    console.log(
      JSON.stringify({
        ok: true,
        scenarios: 5,
        getCount,
        signTokenCalls,
      })
    );
  } finally {
    if (browser) await browser.close();
    server.close();
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
