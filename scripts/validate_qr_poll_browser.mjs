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
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "redeativa-qr-poll-"));
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
    console.error("Playwright não encontrado no caminho configurado:", playwrightPath);
    process.exit(1);
  }

  const esbuild = require(path.join(repoRoot, "node_modules/esbuild/lib/main.js"));
  const { chromium } = pw;

  // Empacota os componentes REAIS do repositório (useQrSignaturePolling + AtaQrPollStatusBanner)
  const entrySource = `
    import React, { useState } from "react";
    import { createRoot } from "react-dom/client";
    import { useQrSignaturePolling } from "${path.join(repoRoot, "src/components/ata/editor/useQrSignaturePolling.ts")}";
    import AtaQrPollStatusBanner from "${path.join(repoRoot, "src/components/ata/editor/AtaQrPollStatusBanner.tsx")}";

    function Harness() {
      const [qrModalInfo, setQrModalInfo] = useState({
        participantId: "p-1",
        url: "https://www.redeativa.app.br/assinar/ata/tok-1",
        name: "Responsável 1",
        expiresInMinutes: 20,
        participantRole: "RESPONSAVEL",
        openId: "open-1",
      });
      const [syncedCount, setSyncedCount] = useState(0);
      const [renewedCount, setRenewedCount] = useState(0);

      const { uiState, handleRetryAction } = useQrSignaturePolling({
        minuteId: "minute-browser-1",
        qrModalInfo,
        onParticipantsSynced: (parts) => setSyncedCount(parts.length),
        onCompletedClose: () => setQrModalInfo(null),
        onSaved: () => {},
      });

      window.__harness = {
        openFor: (participantId, openId) =>
          setQrModalInfo({
            participantId,
            url: "https://www.redeativa.app.br/assinar/ata/tok-" + openId,
            name: "Participante " + participantId,
            expiresInMinutes: 20,
            participantRole: "RESPONSAVEL",
            openId,
          }),
        close: () => setQrModalInfo(null),
      };

      return React.createElement(
        "div",
        null,
        React.createElement("div", { id: "modal-open" }, qrModalInfo ? "open" : "closed"),
        React.createElement("div", { id: "active-part" }, qrModalInfo ? qrModalInfo.participantId : "none"),
        React.createElement("div", { id: "poll-status" }, uiState.status),
        React.createElement("div", { id: "synced-count" }, String(syncedCount)),
        React.createElement("div", { id: "renewed-count" }, String(renewedCount)),
        qrModalInfo
          ? React.createElement(AtaQrPollStatusBanner, {
              state: uiState,
              onRetry: () => void handleRetryAction(),
              onClose: () => setQrModalInfo(null),
              onRenewLink: () => {
                setRenewedCount((c) => c + 1);
                setQrModalInfo((prev) =>
                  prev ? { ...prev, openId: prev.openId + "-renewed" } : null
                );
              },
            })
          : null
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

    const context = await browser.newContext();
    const page = await context.newPage();

    let scenario = "recovery";
    let pollCalls = 0;
    let fullCalls = 0;
    let abortedPolls = 0;
    let delayOldParticipantResponse = false;

    page.on("requestfailed", (req) => {
      if (req.url().includes("?poll=1") && req.failure()?.errorText === "net::ERR_ABORTED") {
        abortedPolls += 1;
      }
    });

    await page.route("**/api/atas/minute-browser-1*", async (route) => {
      const url = route.request().url();
      if (url.includes("?poll=1")) {
        pollCalls += 1;

        if (scenario === "switch_delayed" && delayOldParticipantResponse) {
          delayOldParticipantResponse = false;
          await new Promise((r) => setTimeout(r, 400));
          try {
            await route.fulfill({
              status: 200,
              contentType: "application/json",
              body: JSON.stringify({
                poll: true,
                minuteId: "minute-browser-1",
                participants: [
                  {
                    participantId: "p-1",
                    role: "RESPONSAVEL",
                    signatureMode: "MOBILE_QR",
                    hasSignature: true,
                    hasActiveSignLink: false,
                    institutionalVerificationComplete: false,
                    linkExpired: false,
                  },
                ],
              }),
            });
          } catch {}
          return;
        }

        if (scenario === "abort_on_close") {
          await new Promise((r) => setTimeout(r, 5000));
          try {
            await route.abort();
          } catch {}
          return;
        }

        if (scenario === "expired") {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              poll: true,
              minuteId: "minute-browser-1",
              participants: [
                {
                  participantId: "p-2",
                  role: "RESPONSAVEL",
                  signatureMode: "MOBILE_QR",
                  hasSignature: false,
                  hasActiveSignLink: false,
                  institutionalVerificationComplete: false,
                  linkExpired: true,
                },
              ],
            }),
          });
          return;
        }

        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            poll: true,
            minuteId: "minute-browser-1",
            participants: [
              {
                participantId: "p-1",
                role: "RESPONSAVEL",
                signatureMode: "MOBILE_QR",
                hasSignature: scenario === "recovery" && pollCalls >= 2,
                hasActiveSignLink: true,
                institutionalVerificationComplete: false,
                linkExpired: false,
              },
              {
                participantId: "p-2",
                role: "RESPONSAVEL",
                signatureMode: "MOBILE_QR",
                hasSignature: false,
                hasActiveSignLink: true,
                institutionalVerificationComplete: false,
                linkExpired: false,
              },
            ],
          }),
        });
        return;
      }

      // Busca completa
      fullCalls += 1;
      if (scenario === "recovery" && fullCalls <= 3) {
        await route.fulfill({ status: 500, body: "Erro 500" });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          minute: {
            id: "minute-browser-1",
            participants: [
              {
                id: "p-1",
                name: "Responsável 1",
                role: "RESPONSAVEL",
                signatureMode: "MOBILE_QR",
                hasSignature: true,
              },
            ],
          },
        }),
      });
    });

    await page.goto(`http://127.0.0.1:${port}/`);

    // 1. Cenário de falha na atualização final + clique real em "Tentar atualizar"
    await page.waitForFunction(
      () => document.body.innerText.includes("Assinatura recebida, mas não foi possível atualizar a tela."),
      { timeout: 12000 }
    );
    assert.equal(await page.textContent("#modal-open"), "open");

    await page.getByRole("button", { name: "Tentar atualizar" }).click();
    await page.waitForFunction(() => document.getElementById("modal-open")?.textContent === "closed", {
      timeout: 5000,
    });
    assert.equal(await page.textContent("#synced-count"), "1");

    // 2. Troca de participante enquanto resposta antiga de p-1 está atrasada
    scenario = "switch_delayed";
    delayOldParticipantResponse = true;
    await page.evaluate(() => window.__harness.openFor("p-1", "open-2"));
    await new Promise((r) => setTimeout(r, 2600)); // dispara poll para p-1 que vai demorar 400ms
    await page.evaluate(() => window.__harness.openFor("p-2", "open-3")); // troca antes de resolver
    await new Promise((r) => setTimeout(r, 800));
    assert.equal(await page.textContent("#modal-open"), "open");
    assert.equal(await page.textContent("#active-part"), "p-2");

    // 3. Link expirado + clique real em "Gerar novo QR Code"
    scenario = "expired";
    await page.waitForFunction(
      () => document.body.innerText.includes("Este link de assinatura expirou."),
      { timeout: 6000 }
    );
    await page.getByRole("button", { name: "Gerar novo QR Code" }).click();
    assert.equal(await page.textContent("#renewed-count"), "1");

    // 4. Pausa e retomada por visibilidade (visibilitychange)
    scenario = "waiting_ok";
    const callsBeforeHide = pollCalls;
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await new Promise((r) => setTimeout(r, 3000));
    assert.equal(pollCalls, callsBeforeHide, "Polling não deveria disparar com aba oculta");

    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await new Promise((r) => setTimeout(r, 300));
    assert(pollCalls > callsBeforeHide, "Polling deveria retomar imediatamente ao voltar à aba");

    // 5. Cancelamento durante requisição em andamento ao fechar o modal
    scenario = "abort_on_close";
    await new Promise((r) => setTimeout(r, 2700)); // deixa entrar no fetch de 5s
    await page.evaluate(() => window.__harness.close());
    await new Promise((r) => setTimeout(r, 200));
    assert(abortedPolls >= 1, `Requisição em andamento deveria ser abortada ao fechar (abortedPolls=${abortedPolls})`);

    console.log(
      JSON.stringify({
        ok: true,
        pollCalls,
        fullCalls,
        abortedPolls,
        scenarios: ["recovery_click", "switch_participant_race", "expired_renew_click", "visibility_pause_resume", "abort_on_close"],
      })
    );
  } finally {
    if (browser) await browser.close();
    server.close();
  }
}

if (process.argv[2] === "--child") {
  child(process.argv[3]).catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else {
  parent();
}
