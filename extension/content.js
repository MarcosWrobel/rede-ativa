// content.js - Extrator Power BI Multi-Relatório (Frequência & BI Aprendizagem v1.7.0)
(function() {
  if (window.__leopoldina_content_injected) return;
  window.__leopoldina_content_injected = true;

  console.log('[Rede Ativa] Content script v1.7.0 carregado com sucesso.');

  // Armazena alunos únicos mapeados por CGM (Modo Presente na Escola / Frequência)
  const alunosCapturados = new Map();

  // Acumuladores do BI Aprendizagem Estadual (Abas ESCOLA, TURMA e MAPA)
  const councilTurmasMap = new Map();       // chave: codturma || turmaRaw
  const councilEscolaByRowIdx = new Map();  // merge horizontal por aria-rowindex na aba ESCOLA
  const councilAlunosTurmaMap = new Map();  // chave: cgm
  const councilMapaCellsMap = new Map();    // chave: `${cgm}|${subjectCode}|${trimester}`

  let isScrolling = false;

  const OFFICIAL_SYNC_HTTPS_HOSTS = new Set([
    'redeativa.app.br',
    'www.redeativa.app.br',
    'app.redeativa.app.br',
    'redeativa.com.br',
    'www.redeativa.com.br',
    'app.redeativa.com.br',
    'registro-leopoldina.vercel.app',
    'busca-ativa-leopoldina.vercel.app',
  ]);

  function isTrustedSyncServerUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return false;
    try {
      const url = new URL(rawUrl.trim());
      const host = url.hostname.toLowerCase();
      if (url.protocol === 'https:' && OFFICIAL_SYNC_HTTPS_HOSTS.has(host)) return true;
      if (url.protocol === 'http:' && (host === 'localhost' || host === '127.0.0.1')) return true;
    } catch {}
    return false;
  }

  function normText(val) {
    return String(val || '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function normKeyAscii(val) {
    return normText(val)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase();
  }

  function getElementFullText(el) {
    if (!el) return '';
    const title = normText(el.getAttribute && el.getAttribute('title'));
    const inner = normText(el.innerText || el.textContent);
    if (title && title.length >= inner.length) return title;
    return inner || title;
  }

  // Detecta automaticamente o relatório / aba ativa do Power BI
  function detectarModoPowerBi() {
    const headerNodes = Array.from(
      document.querySelectorAll(
        '[role="columnheader"], .columnHeaders *, .pivotTableHeaderWrap, .pivotTableHeaderWrap *, .pivotTableHeader, th, .headerCell, .tablix-column-header'
      )
    );

    const headerTexts = [];
    for (let i = 0; i < headerNodes.length; i++) {
      const txt = getElementFullText(headerNodes[i]);
      if (txt) headerTexts.push(txt);
    }

    const joinedAscii = headerTexts.map(normKeyAscii).join(' | ');
    const hasSubTri = headerTexts.some((t) => /^[123]\s*[º°o]?\s*tri$/i.test(normText(t)));
    const hasDisciplinaHeader = headerTexts.some((t) =>
      /^[A-ZÀ-Ÿ0-9.\s/]{2,}\s*-\s*\d{2,6}$/i.test(normText(t)) &&
      !/TURMA|SERIE|PERIODO|SEM SERIACAO/i.test(normKeyAscii(t))
    );

    if ((hasSubTri && hasDisciplinaHeader) || (hasSubTri && joinedAscii.includes('ALUNO - CGM'))) {
      return 'APRENDIZAGEM_MAPA';
    }

    if (
      joinedAscii.includes('CGMKEY') ||
      (joinedAscii.includes('CODTURMA') && joinedAscii.includes('NOTA MEDIA'))
    ) {
      return 'APRENDIZAGEM_TURMA';
    }

    if (
      joinedAscii.includes('TURMA') &&
      (joinedAscii.includes('ABAIXO DO BASICO') ||
        joinedAscii.includes('NIVEIS PREOCUPANTES') ||
        joinedAscii.includes('EQUIVALENCIA SERIACAO')) &&
      !joinedAscii.includes('CGMKEY')
    ) {
      return 'APRENDIZAGEM_ESCOLA';
    }

    return 'FREQUENCIA_PRESENTE';
  }

  function isAprendizagemMode(mode) {
    return (
      mode === 'APRENDIZAGEM_MAPA' ||
      mode === 'APRENDIZAGEM_TURMA' ||
      mode === 'APRENDIZAGEM_ESCOLA'
    );
  }

  function hasAnyAprendizagemData() {
    return (
      councilMapaCellsMap.size > 0 ||
      councilAlunosTurmaMap.size > 0 ||
      councilTurmasMap.size > 0
    );
  }

  function getEffectiveSyncTarget() {
    const mode = detectarModoPowerBi();
    if (isAprendizagemMode(mode)) return 'CONSELHO_BI';
    if (alunosCapturados.size === 0 && hasAnyAprendizagemData()) return 'CONSELHO_BI';
    return 'FREQUENCIA_BI';
  }

  function getModeBadgeLabel(mode) {
    if (mode === 'APRENDIZAGEM_MAPA') return 'BI Aprendizagem • Aba MAPA';
    if (mode === 'APRENDIZAGEM_TURMA') return 'BI Aprendizagem • Aba TURMA';
    if (mode === 'APRENDIZAGEM_ESCOLA') return 'BI Aprendizagem • Aba ESCOLA';
    return 'Presente na Escola • Frequência';
  }

  // Cria ou atualiza a interface flutuante
  function criarInterfaceFlutuante() {
    if (document.getElementById('leopoldina-floating-widget')) return;

    const container = document.createElement('div');
    container.id = 'leopoldina-floating-widget';
    container.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 9999999;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    `;

    container.innerHTML = `
      <div id="leo-pill" style="
        background: #0f172a;
        color: #fff;
        border: 2px solid #10b981;
        padding: 10px 18px;
        border-radius: 9999px;
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4);
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 10px;
        font-weight: 600;
        font-size: 14px;
        transition: all 0.2s ease;
      ">
        <span style="font-size: 18px;">🎓</span>
        <span>Sincronizador • Rede Ativa</span>
        <span id="leo-count-badge" style="
          background: #10b981;
          color: #042f2e;
          padding: 2px 8px;
          border-radius: 9999px;
          font-size: 12px;
          font-weight: 700;
        ">0 alunos</span>
      </div>

      <div id="leo-panel" style="
        display: none;
        position: absolute;
        bottom: 55px;
        right: 0;
        width: 400px;
        background: #ffffff;
        color: #1e293b;
        border-radius: 16px;
        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.25), 0 8px 10px -6px rgba(0, 0, 0, 0.2);
        border: 1px solid #e2e8f0;
        overflow: hidden;
      ">
        <div style="background: #0f172a; color: #fff; padding: 14px 18px; display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div style="font-weight: 700; font-size: 15px; display: flex; align-items: center; gap: 6px;">
              <span>🎓</span> Rede Ativa • Power BI
            </div>
            <div id="leo-mode-label" style="font-size: 11px; color: #38bdf8; font-weight: 600;">Detectando relatório...</div>
          </div>
          <button id="leo-close-btn" style="background: none; border: none; color: #94a3b8; font-size: 18px; cursor: pointer; padding: 4px;">&times;</button>
        </div>

        <div style="padding: 16px;">
          <div id="leo-stats-freq" style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; margin-bottom: 14px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
              <span style="font-size: 12px; color: #64748b; font-weight: 500;">Alunos Capturados:</span>
              <span id="leo-panel-count" style="font-size: 16px; font-weight: 800; color: #0f172a;">0</span>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
              <span style="font-size: 12px; color: #64748b; font-weight: 500;">Alerta Infrequência (&lt; 75%):</span>
              <span id="leo-panel-risco" style="font-size: 13px; font-weight: 700; color: #ef4444;">0</span>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
              <span style="font-size: 12px; color: #64748b; font-weight: 500;">🩺 Amparo Legal Vigente:</span>
              <span id="leo-panel-amparo" style="font-size: 13px; font-weight: 700; color: #8b5cf6;">0</span>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-size: 12px; color: #64748b; font-weight: 500;">✈️ Ganhando Mundo:</span>
              <span id="leo-panel-ganhando" style="font-size: 13px; font-weight: 700; color: #0284c7;">0</span>
            </div>
          </div>

          <div id="leo-stats-council" style="display: none; background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 10px; padding: 12px; margin-bottom: 14px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
              <span style="font-size: 12px; color: #0369a1; font-weight: 600;">Notas Matriz (MAPA):</span>
              <span id="leo-bi-mapa-count" style="font-size: 14px; font-weight: 800; color: #0f172a;">0 células</span>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
              <span style="font-size: 12px; color: #0369a1; font-weight: 600;">Médias / Idades (TURMA):</span>
              <span id="leo-bi-turma-count" style="font-size: 13px; font-weight: 700; color: #0284c7;">0 alunos</span>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-size: 12px; color: #0369a1; font-weight: 600;">Turmas (ESCOLA):</span>
              <span id="leo-bi-escola-count" style="font-size: 13px; font-weight: 700; color: #0284c7;">0 turmas</span>
            </div>
          </div>

          <div style="display: flex; flex-direction: column; gap: 8px;">
            <button id="leo-btn-autoscroll" style="
              background: #0284c7;
              color: white;
              border: none;
              padding: 10px;
              border-radius: 8px;
              font-weight: 600;
              font-size: 13px;
              cursor: pointer;
              display: flex;
              align-items: center;
              justify-content: center;
              gap: 8px;
            ">
              <span>⚡</span> Rastrear Aba Ativa (Auto-Scroll)
            </button>

            <button id="leo-btn-download-csv" style="
              background: #10b981;
              color: white;
              border: none;
              padding: 10px;
              border-radius: 8px;
              font-weight: 600;
              font-size: 13px;
              cursor: pointer;
              display: flex;
              align-items: center;
              justify-content: center;
              gap: 8px;
            ">
              <span>📥</span> Baixar Planilha (.CSV para Excel)
            </button>

            <button id="leo-btn-copy-json" style="
              background: #f1f5f9;
              color: #334155;
              border: 1px solid #cbd5e1;
              padding: 9px;
              border-radius: 8px;
              font-weight: 600;
              font-size: 13px;
              cursor: pointer;
              display: flex;
              align-items: center;
              justify-content: center;
              gap: 8px;
            ">
              <span>📋</span> Copiar JSON
            </button>

            <button id="leo-btn-sync-api" style="
              background: #6366f1;
              color: white;
              border: none;
              padding: 10px;
              border-radius: 8px;
              font-weight: 600;
              font-size: 13px;
              cursor: pointer;
              display: flex;
              align-items: center;
              justify-content: center;
              gap: 8px;
            ">
              <span>🚀</span> Sincronizar com Rede Ativa
            </button>
          </div>

          <details id="leo-settings-box" style="margin-top: 10px; font-size: 11px; color: #475569; background: #f8fafc; padding: 8px; border-radius: 8px; border: 1px solid #e2e8f0;">
            <summary style="cursor: pointer; font-weight: 600; color: #334155;">⚙️ Configuração de Envio (Nuvem / Local)</summary>
            <div style="margin-top: 8px; display: flex; flex-direction: column; gap: 6px;">
              <div>
                <label style="display: block; font-weight: 600; margin-bottom: 2px;">URL do Servidor:</label>
                <input id="leo-cfg-url" type="text" placeholder="https://www.redeativa.app.br" style="width: 100%; box-sizing: border-box; padding: 4px 6px; font-size: 11px; border: 1px solid #cbd5e1; border-radius: 4px; font-family: monospace;" />
              </div>
              <div>
                <label style="display: block; font-weight: 600; margin-bottom: 2px;">Chave de Sincronização:</label>
                <input id="leo-cfg-token" type="password" placeholder="Token secreto da escola" style="width: 100%; box-sizing: border-box; padding: 4px 6px; font-size: 11px; border: 1px solid #cbd5e1; border-radius: 4px;" />
              </div>
              <div style="display: flex; gap: 4px; margin-top: 2px;">
                <button id="leo-cfg-btn-vercel" type="button" style="flex: 1; padding: 4px; font-size: 10px; border-radius: 4px; border: 1px solid #cbd5e1; background: #fff; cursor: pointer; font-weight: 600;">Usar Produção</button>
                <button id="leo-cfg-btn-local" type="button" style="flex: 1; padding: 4px; font-size: 10px; border-radius: 4px; border: 1px solid #cbd5e1; background: #fff; cursor: pointer; font-weight: 600;">Usar Localhost:3001</button>
              </div>
            </div>
          </details>

          <div id="leo-status-msg" style="
            margin-top: 12px;
            font-size: 11px;
            color: #64748b;
            text-align: center;
            min-height: 16px;
            font-weight: 500;
          "></div>
        </div>
      </div>
    `;

    document.body.appendChild(container);

    const pill = document.getElementById('leo-pill');
    const panel = document.getElementById('leo-panel');
    const closeBtn = document.getElementById('leo-close-btn');

    pill.addEventListener('click', () => {
      atualizarContadores();
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    });

    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.style.display = 'none';
    });

    const inputUrl = document.getElementById('leo-cfg-url');
    const inputToken = document.getElementById('leo-cfg-token');

    (async () => {
      if (chrome.storage && chrome.storage.local) {
        try {
          const res = await chrome.storage.local.get(['leopoldina_server_url', 'leopoldina_sync_token']);
          if (inputUrl) {
            inputUrl.value = res.leopoldina_server_url || 'https://www.redeativa.app.br';
          }
          if (inputToken) {
            inputToken.value = res.leopoldina_sync_token || '';
          }
        } catch (err) {
          console.warn('[Rede Ativa] Falha ao ler storage:', err);
        }
      } else {
        if (inputUrl) inputUrl.value = 'https://www.redeativa.app.br';
      }
    })();

    const salvarConfigs = async () => {
      const candidateUrl = inputUrl?.value?.trim() || 'https://www.redeativa.app.br';
      if (!isTrustedSyncServerUrl(candidateUrl)) {
        setStatus('❌ URL não autorizada. Utilize um endereço oficial Rede Ativa ou localhost.', '#ef4444');
        return;
      }
      if (chrome.storage && chrome.storage.local) {
        await chrome.storage.local.set({
          leopoldina_server_url: candidateUrl,
          leopoldina_sync_token: inputToken?.value?.trim() || '',
        });
      }
    };

    inputUrl?.addEventListener('change', salvarConfigs);
    inputToken?.addEventListener('change', salvarConfigs);

    document.getElementById('leo-cfg-btn-vercel')?.addEventListener('click', () => {
      if (inputUrl) {
        inputUrl.value = 'https://www.redeativa.app.br';
        salvarConfigs();
      }
    });

    document.getElementById('leo-cfg-btn-local')?.addEventListener('click', () => {
      if (inputUrl) {
        inputUrl.value = 'http://localhost:3001';
        salvarConfigs();
      }
    });

    document.getElementById('leo-btn-autoscroll').addEventListener('click', iniciarAutoScroll);
    document.getElementById('leo-btn-download-csv').addEventListener('click', baixarCSV);
    document.getElementById('leo-btn-copy-json').addEventListener('click', copiarJSON);
    document.getElementById('leo-btn-sync-api').addEventListener('click', sincronizarComSistema);

    atualizarContadores();
  }

  function setStatus(msg, cor = '#64748b') {
    const el = document.getElementById('leo-status-msg');
    if (el) {
      el.textContent = msg;
      el.style.color = cor;
    }
  }

  function atualizarContadores() {
    const mode = detectarModoPowerBi();
    const target = getEffectiveSyncTarget();

    const modeEl = document.getElementById('leo-mode-label');
    if (modeEl) {
      modeEl.textContent = getModeBadgeLabel(mode);
    }

    const statsFreq = document.getElementById('leo-stats-freq');
    const statsCouncil = document.getElementById('leo-stats-council');
    const btnSync = document.getElementById('leo-btn-sync-api');
    const badge = document.getElementById('leo-count-badge');

    if (target === 'CONSELHO_BI') {
      if (statsFreq) statsFreq.style.display = 'none';
      if (statsCouncil) statsCouncil.style.display = 'block';
      if (btnSync) {
        btnSync.textContent = '🚀 Sincronizar Conselho de Classe';
      }

      const mapaEl = document.getElementById('leo-bi-mapa-count');
      const turmaEl = document.getElementById('leo-bi-turma-count');
      const escolaEl = document.getElementById('leo-bi-escola-count');

      if (mapaEl) mapaEl.textContent = `${councilMapaCellsMap.size} células`;
      if (turmaEl) turmaEl.textContent = `${councilAlunosTurmaMap.size} alunos`;
      if (escolaEl) escolaEl.textContent = `${councilTurmasMap.size} turmas`;

      if (badge) {
        if (councilMapaCellsMap.size > 0) {
          badge.textContent = `${councilMapaCellsMap.size} notas`;
        } else if (councilAlunosTurmaMap.size > 0) {
          badge.textContent = `${councilAlunosTurmaMap.size} alunos`;
        } else {
          badge.textContent = `${councilTurmasMap.size} turmas`;
        }
      }
      return;
    }

    if (statsFreq) statsFreq.style.display = 'block';
    if (statsCouncil) statsCouncil.style.display = 'none';
    if (btnSync) {
      btnSync.textContent = '🚀 Sincronizar Frequência com Rede Ativa';
    }

    const total = alunosCapturados.size;
    let risco = 0;
    let amparos = 0;
    let ganhando = 0;

    alunosCapturados.forEach(a => {
      const freqNum = parseFloat((a.mediaGeral || '').replace('%', '').replace(',', '.'));
      if (!isNaN(freqNum) && freqNum < 75) risco++;
      if (a.amparoLegalVigencia && !a.ganhandoMundo) amparos++;
      if (a.ganhandoMundo) ganhando++;
    });

    if (badge) badge.textContent = `${total} alunos`;

    const pCount = document.getElementById('leo-panel-count');
    if (pCount) pCount.textContent = String(total);

    const pRisco = document.getElementById('leo-panel-risco');
    if (pRisco) pRisco.textContent = `${risco} alunos`;

    const pAmparo = document.getElementById('leo-panel-amparo');
    if (pAmparo) pAmparo.textContent = `${amparos} alunos`;

    const pGanhando = document.getElementById('leo-panel-ganhando');
    if (pGanhando) {
      pGanhando.textContent = `${ganhando} aluno${ganhando === 1 ? '' : 's'}`;
      if (ganhando > 0) {
        pGanhando.style.color = '#0284c7';
        pGanhando.style.fontWeight = '800';
      }
    }
  }

  // =========================================================================
  // MODO 1: PRESENTE NA ESCOLA (FREQUÊNCIA — COMPORTAMENTO ORIGINAL PRESERVADO)
  // =========================================================================

  const IGNORAR_NOMES = [
    'selecionar linha', 'rolar para cima', 'rolar para baixo', 'varias selecoes',
    'todos', 'outros', 'memoria', 'amparo legal', 'deficiencia', 'ganhando mundo',
    'rede', 'nre', 'escola', 'turma', 'idade', 'media geral', 'presenca', 'semana atual',
    'semana anterior', 'ponta grossa', 'aluno', 'cgm', 'total', 'formatação condicional',
    'formatacao condicional', 'formatação condicional adicional', 'formatacao condicional adicional'
  ];

  function detectarIndicesColunas() {
    const allHeaderNodes = Array.from(
      document.querySelectorAll(
        '[role="columnheader"], [role="columnheader"] *, .columnHeaders *, .pivotTableHeaderWrap, .pivotTableHeaderWrap *, .pivotTableHeader, th, th *, .headerCell, .tablix-column-header, .tablix-column-header *'
      )
    );

    const map = {
      turma: { ariaCol: null, left: -1, right: -1, found: false },
      mediaGeral: { ariaCol: null, left: -1, right: -1, found: false },
      semanaAtual: { ariaCol: null, left: -1, right: -1, found: false },
      semanaAnterior: { ariaCol: null, left: -1, right: -1, found: false },
      amparo: { ariaCol: null, left: -1, right: -1, found: false },
      deficiencia: { ariaCol: null, left: -1, right: -1, found: false },
      ganhando: { ariaCol: null, left: -1, right: -1, found: false },
      serp: { ariaCol: null, left: -1, right: -1, found: false },
      idade: { ariaCol: null, left: -1, right: -1, found: false },
    };

    allHeaderNodes.forEach((h) => {
      const txt = (h.innerText || h.getAttribute('title') || '').toLowerCase().trim();
      if (!txt) return;

      const colAttr = h.getAttribute('aria-colindex') || h.closest('[aria-colindex]')?.getAttribute('aria-colindex');
      const parsedCol = colAttr ? parseInt(colAttr, 10) : null;
      const rect = h.getBoundingClientRect();

      const assign = (key) => {
        if (parsedCol && !Number.isNaN(parsedCol)) {
          map[key].ariaCol = parsedCol;
        }
        if (rect.width > 0) {
          if (map[key].left === -1 || (rect.width >= 20 && rect.width < (map[key].right - map[key].left))) {
            map[key].left = rect.left;
            map[key].right = rect.right;
          }
        }
        map[key].found = true;
      };

      if (txt.includes('ganhando')) {
        assign('ganhando');
      } else if (txt.includes('deficiên') || txt.includes('deficien')) {
        assign('deficiencia');
      } else if (txt.includes('amparo')) {
        assign('amparo');
      } else if (txt.includes('serp')) {
        assign('serp');
      } else if (txt.includes('idade')) {
        assign('idade');
      } else if (txt.includes('semana atual')) {
        assign('semanaAtual');
      } else if (txt.includes('semana anterior')) {
        assign('semanaAnterior');
      } else if (txt.includes('média') || txt.includes('media')) {
        assign('mediaGeral');
      } else if (txt.includes('turma')) {
        assign('turma');
      }
    });

    return map;
  }

  function extrairLinhasFrequenciaVisiveis() {
    const cgmRegex = /\b10\d{8}\b/;
    const percentRegex = /\d{1,3}[,\.]\d{1,2}%/g;
    const dateRegex = /\b(\d{1,2}\/\d{1,2}\/\d{4})\b/;

    const colMap = detectarIndicesColunas();
    const rows = document.querySelectorAll('[role="row"], .row, .tr');
    let novos = 0;

    rows.forEach(r => {
      const cellTitles = Array.from(r.querySelectorAll('[title]')).map(el => el.getAttribute('title') || '');
      const rawText = (r.innerText || '').replace(/\u00A0/g, ' ');
      const fullText = cellTitles.join('\n') + '\n' + rawText;

      const matchCgm = fullText.match(cgmRegex);

      if (matchCgm) {
        const cgm = matchCgm[0];
        const existente = alunosCapturados.get(cgm);

        const partes = fullText.split('\n').map(p => p.trim()).filter(Boolean);
        const percentuais = fullText.match(percentRegex) || [];

        const allCells = Array.from(r.querySelectorAll('[role="gridcell"], .pivotTableCellWrap, .bodyCells, .cell, td'));
        const distinctCells = allCells.filter(c => !allCells.some(other => other !== c && other.contains(c)));

        const isCellForCol = (c, colKey) => {
          const target = colMap[colKey];
          if (!target || !target.found) return false;

          const cAria = c.getAttribute('aria-colindex') || c.closest('[aria-colindex]')?.getAttribute('aria-colindex');
          if (cAria && target.ariaCol !== null) {
            const parsed = parseInt(cAria, 10);
            if (!Number.isNaN(parsed)) {
              return parsed === target.ariaCol;
            }
          }

          if (target.left > 0 && target.right > 0) {
            const rect = c.getBoundingClientRect();
            if (rect.width > 0) {
              const center = (rect.left + rect.right) / 2;
              if (center >= target.left && center <= target.right) return true;
            }
          }
          return false;
        };

        let alunoParte = partes.find(p => /^[A-Za-zÀ-ÿ\s\.\']+\s*-\s*10\d*/.test(p.trim()));
        if (!alunoParte) {
          alunoParte = partes.find(p => {
            const limpo = p.toLowerCase().trim();
            if (limpo.length < 5) return false;
            if (/^\d+$/.test(limpo)) return false;
            if (p.includes('%')) return false;
            if (/\d{1,2}\/\d{1,2}\/\d{4}/.test(limpo)) return false;
            if (IGNORAR_NOMES.some(ig => limpo.includes(ig))) return false;
            if (limpo.includes('série') || limpo.includes('serie') || limpo.includes('período') || limpo.includes('periodo') || limpo.includes('seriação')) return false;
            return /[A-Za-zÀ-ÿ]{3,}/.test(p);
          });
        }

        let nome = alunoParte
          ? alunoParte.replace(/\s*-\s*\d+.*$/, '').replace(/…/g, '').trim()
          : (existente && existente.nome !== 'Aluno' ? existente.nome : 'Aluno');

        const turma = partes.find(p =>
          p.includes('Série') || p.includes('Serie') ||
          p.includes('Período') || p.includes('Periodo') ||
          p.includes('Manhã') || p.includes('Tarde') || p.includes('Noite') || p.includes('Sem Seriação')
        ) || (existente ? existente.turma : '');

        let amparoLegalVigencia = null;
        const amparoCell = distinctCells.find(c => isCellForCol(c, 'amparo'));
        if (amparoCell) {
          const txt = (amparoCell.innerText || amparoCell.getAttribute('title') || '').trim();
          const m = txt.match(dateRegex);
          if (m) amparoLegalVigencia = m[1];
        }
        if (!amparoLegalVigencia) {
          const m = fullText.match(dateRegex);
          if (m) amparoLegalVigencia = m[1];
        }

        let deficienciaAltasHabilidades = false;
        let ganhandoMundo = false;
        let serpAtivo = false;

        const isExplicitPositiveText = (txt) => {
          const lower = txt.toLowerCase();
          return /[✓✔√☑]/.test(txt) || txt === '1' || lower === 'sim' || lower === 'true';
        };

        const hasBadgeIcon = (cell) => {
          const iconEl = cell.querySelector('svg, i, .check, [role="img"], polygon, path, circle');
          if (!iconEl) return false;
          const iconMeta = (
            (iconEl.getAttribute('aria-label') || '') + ' ' +
            (iconEl.getAttribute('title') || '')
          ).toLowerCase();
          if (/(classificar|ordenar|sort|chevron|seta|arrow)/.test(iconMeta)) return false;
          return true;
        };

        const ganhandoCell = distinctCells.find(c => isCellForCol(c, 'ganhando'));
        if (ganhandoCell) {
          const txt = (ganhandoCell.innerText || ganhandoCell.getAttribute('title') || '').trim();
          const title = (ganhandoCell.getAttribute('title') || '').toLowerCase();
          const ariaLabel = (ganhandoCell.getAttribute('aria-label') || '').toLowerCase();
          if (isExplicitPositiveText(txt) || hasBadgeIcon(ganhandoCell) || title.includes('ganhando') || ariaLabel.includes('ganhando')) {
            ganhandoMundo = true;
          }
        }

        const serpCell = distinctCells.find(c => isCellForCol(c, 'serp'));
        if (serpCell) {
          const txt = (serpCell.innerText || serpCell.getAttribute('title') || '').trim();
          const title = (serpCell.getAttribute('title') || '').toLowerCase();
          const ariaLabel = (serpCell.getAttribute('aria-label') || '').toLowerCase();
          if (isExplicitPositiveText(txt) || hasBadgeIcon(serpCell) || title.includes('serp') || ariaLabel.includes('serp')) {
            serpAtivo = true;
          }
        }

        const defCell = distinctCells.find(c => isCellForCol(c, 'deficiencia'));
        if (defCell) {
          const txt = (defCell.innerText || defCell.getAttribute('title') || '').trim();
          if (isExplicitPositiveText(txt)) {
            deficienciaAltasHabilidades = true;
          }
        }

        distinctCells.forEach(c => {
          const txt = (c.innerText || c.getAttribute('title') || '').trim();
          const title = (c.getAttribute('title') || '').toLowerCase();
          const ariaLabel = (c.getAttribute('aria-label') || '').toLowerCase();
          const hasPositive = isExplicitPositiveText(txt);

          if (title.includes('ganhando') || ariaLabel.includes('ganhando')) {
            if (hasPositive || hasBadgeIcon(c)) ganhandoMundo = true;
          }
          if (title.includes('serp') || ariaLabel.includes('serp')) {
            if (hasPositive || hasBadgeIcon(c)) serpAtivo = true;
          }
          if (title.includes('deficiên') || title.includes('deficien') || ariaLabel.includes('deficiên') || ariaLabel.includes('deficien')) {
            if (hasPositive) deficienciaAltasHabilidades = true;
          }
        });

        let idade = null;
        const idadeCell = distinctCells.find(c => isCellForCol(c, 'idade'));
        if (idadeCell) {
          const txt = (idadeCell.innerText || idadeCell.getAttribute('title') || '').trim();
          if (/^\d{1,2}$/.test(txt)) {
            const num = parseInt(txt, 10);
            if (num >= 5 && num <= 99) idade = num;
          }
        }
        if (!idade) {
          for (let i = partes.length - 1; i >= 0; i--) {
            const p = partes[i];
            if (/^\d{2}$/.test(p)) {
              const num = parseInt(p, 10);
              if (num >= 10 && num <= 25) {
                idade = num;
                break;
              }
            }
          }
        }

        const isGanhando = colMap.ganhando.found
          ? Boolean(ganhandoMundo)
          : Boolean(existente?.ganhandoMundo);
        const isDeficiencia = colMap.deficiencia.found
          ? Boolean(deficienciaAltasHabilidades)
          : Boolean(existente?.deficienciaAltasHabilidades);
        const vigenciaAtestado = isGanhando ? null : (amparoLegalVigencia || existente?.amparoLegalVigencia || null);

        const aluno = {
          cgm: cgm,
          nome: nome,
          turma: turma,
          mediaGeral: percentuais[0] || existente?.mediaGeral || '',
          semanaAtual: percentuais[1] || existente?.semanaAtual || '',
          semanaAnterior: percentuais[2] || existente?.semanaAnterior || '',
          amparoLegalVigencia: vigenciaAtestado,
          deficienciaAltasHabilidades: isDeficiencia,
          ganhandoMundo: isGanhando,
          serpAtivo: serpAtivo || existente?.serpAtivo || false,
          idade: idade || existente?.idade || null,
          capturadoEm: new Date().toISOString()
        };

        if (!alunosCapturados.has(cgm)) {
          novos++;
          alunosCapturados.set(cgm, aluno);
        } else {
          const prev = alunosCapturados.get(cgm);
          let mudou = false;
          if (aluno.ganhandoMundo !== prev.ganhandoMundo && colMap.ganhando.found) {
            prev.ganhandoMundo = aluno.ganhandoMundo;
            mudou = true;
          }
          if (aluno.serpAtivo && !prev.serpAtivo) { prev.serpAtivo = true; mudou = true; }
          if (aluno.deficienciaAltasHabilidades !== prev.deficienciaAltasHabilidades && colMap.deficiencia.found) {
            prev.deficienciaAltasHabilidades = aluno.deficienciaAltasHabilidades;
            mudou = true;
          }
          if (aluno.amparoLegalVigencia && !prev.amparoLegalVigencia && !prev.ganhandoMundo && !aluno.ganhandoMundo) {
            prev.amparoLegalVigencia = aluno.amparoLegalVigencia;
            mudou = true;
          }
          if (aluno.idade && !prev.idade) { prev.idade = aluno.idade; mudou = true; }
          if (aluno.mediaGeral && !prev.mediaGeral) { prev.mediaGeral = aluno.mediaGeral; mudou = true; }
          if (aluno.semanaAtual && !prev.semanaAtual) { prev.semanaAtual = aluno.semanaAtual; mudou = true; }
          if (aluno.semanaAnterior && !prev.semanaAnterior) { prev.semanaAnterior = aluno.semanaAnterior; mudou = true; }
          if (aluno.turma && (!prev.turma || prev.turma.includes('Período') || prev.turma.includes('Periodo')) && (aluno.turma.includes('Série') || aluno.turma.includes('Serie'))) {
            prev.turma = aluno.turma;
            mudou = true;
          }
          if (prev.ganhandoMundo && prev.amparoLegalVigencia) {
            prev.amparoLegalVigencia = null;
            mudou = true;
          }
          if (mudou) alunosCapturados.set(cgm, prev);
        }
      }
    });

    if (novos > 0) atualizarContadores();
    return novos;
  }

  // =========================================================================
  // MODO 2: BI APRENDIZAGEM ESTADUAL 2026 (ABAS ESCOLA, TURMA E MAPA)
  // =========================================================================

  function parsePtBrGradeClient(raw) {
    const cleaned = normText(raw);
    if (!cleaned || cleaned === '-' || cleaned === '--') return null;
    if (!/^\d{1,2}(?:[,.]\d{1,2})?$/.test(cleaned)) return null;
    const num = parseFloat(cleaned.replace(',', '.'));
    if (!Number.isFinite(num) || num < 0 || num > 10) return null;
    return Math.round(num * 100) / 100;
  }

  function parsePtBrIntClient(raw) {
    const cleaned = normText(raw).replace(/\./g, '');
    if (!cleaned || !/^\d{1,6}$/.test(cleaned)) return null;
    const num = parseInt(cleaned, 10);
    return Number.isFinite(num) ? num : null;
  }

  function detectarCabecalhosTabela(container) {
    const root = container || document;
    const nodes = Array.from(
      root.querySelectorAll('[role="columnheader"], .columnHeaders *, th, .headerCell, .tablix-column-header')
    );
    const cols = [];
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      const text = getElementFullText(el);
      if (!text) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      const ariaColAttr = el.getAttribute('aria-colindex') || el.closest('[aria-colindex]')?.getAttribute('aria-colindex');
      cols.push({
        el,
        text,
        key: normKeyAscii(text),
        rect,
        ariaCol: ariaColAttr ? parseInt(ariaColAttr, 10) : null,
      });
    }
    return cols;
  }

  function encontrarCelulaDaColuna(cells, colHeader) {
    if (!colHeader) return null;
    if (colHeader.ariaCol) {
      const byAria = cells.find((c) => {
        const attr = c.getAttribute('aria-colindex') || c.closest('[aria-colindex]')?.getAttribute('aria-colindex');
        return attr && parseInt(attr, 10) === colHeader.ariaCol;
      });
      if (byAria) return byAria;
    }
    const colLeft = colHeader.rect.left;
    const colRight = colHeader.rect.right;
    return cells.find((c) => {
      const r = c.getBoundingClientRect();
      if (r.width <= 0) return false;
      const cx = (r.left + r.right) / 2;
      return cx >= colLeft - 4 && cx <= colRight + 4;
    }) || null;
  }

  // ABA ESCOLA (Imagens 1 e 2)
  function extrairAbaEscolaVisivel() {
    const cols = detectarCabecalhosTabela(document);
    const pickCol = (predicate) => {
      const matches = cols.filter(predicate);
      if (matches.length === 0) return null;
      return matches.sort((a, b) => a.rect.width - b.rect.width)[0];
    };

    const colTurma = pickCol((c) => c.key === 'TURMA');
    const colPeriodo = pickCol((c) => c.key.includes('PERIODO AVALIACAO'));
    const colMatriculados = pickCol((c) => c.key.includes('ALUNOS MATRICULADOS'));
    const colAvaliados = pickCol((c) => c.key.includes('ALUNOS AVALIADOS') && !c.key.includes('%'));
    const colEquivalencia = pickCol((c) => c.key.includes('EQUIVALENCIA SERIACAO'));
    const colCurso = pickCol((c) => c.key === 'CURSO');

    const rows = Array.from(document.querySelectorAll('[role="row"], .row, .tr'));
    let novidades = 0;

    rows.forEach((r, domIdx) => {
      const allCells = Array.from(r.querySelectorAll('[role="gridcell"], .pivotTableCellWrap, .bodyCells, .cell, td'));
      const cells = allCells.filter((c) => !allCells.some((o) => o !== c && o.contains(c)));
      if (cells.length === 0) return;

      const ariaRowAttr = r.getAttribute('aria-rowindex') || r.getAttribute('row-index');
      const rowIndexKey = ariaRowAttr ? `aria:${ariaRowAttr}` : null;

      const turmaCell = colTurma ? encontrarCelulaDaColuna(cells, colTurma) : null;
      const periodoCell = colPeriodo ? encontrarCelulaDaColuna(cells, colPeriodo) : null;
      const matricCell = colMatriculados ? encontrarCelulaDaColuna(cells, colMatriculados) : null;
      const avalCell = colAvaliados ? encontrarCelulaDaColuna(cells, colAvaliados) : null;
      const equivCell = colEquivalencia ? encontrarCelulaDaColuna(cells, colEquivalencia) : null;
      const cursoCell = colCurso ? encontrarCelulaDaColuna(cells, colCurso) : null;

      let turmaRaw = turmaCell ? getElementFullText(turmaCell) : '';
      if (turmaRaw && /^total$/i.test(turmaRaw)) return;

      let registro = null;
      if (turmaRaw) {
        const codMatch = turmaRaw.match(/-\s*(\d{5,10})\s*$/);
        const codturma = codMatch ? codMatch[1] : null;
        const mapKey = codturma || turmaRaw;
        registro = councilTurmasMap.get(mapKey) || {
          turmaRaw,
          codturma,
          periodoAvaliacao: null,
          equivalenciaSeriacao: null,
          curso: null,
          alunosMatriculados: null,
          alunosAvaliados: null,
        };
        if (rowIndexKey) {
          councilEscolaByRowIdx.set(rowIndexKey, mapKey);
        }
        if (!councilTurmasMap.has(mapKey)) novidades++;
        councilTurmasMap.set(mapKey, registro);
      } else if (rowIndexKey && councilEscolaByRowIdx.has(rowIndexKey)) {
        const mapKey = councilEscolaByRowIdx.get(rowIndexKey);
        registro = councilTurmasMap.get(mapKey) || null;
      }

      if (!registro) return;

      if (periodoCell) {
        const pv = getElementFullText(periodoCell);
        if (pv !== undefined) registro.periodoAvaliacao = pv;
      }
      if (matricCell) {
        const m = parsePtBrIntClient(getElementFullText(matricCell));
        if (m !== null) registro.alunosMatriculados = m;
      }
      if (avalCell) {
        const a = parsePtBrIntClient(getElementFullText(avalCell));
        if (a !== null) registro.alunosAvaliados = a;
      }
      if (equivCell) {
        const eq = getElementFullText(equivCell);
        if (eq) registro.equivalenciaSeriacao = eq;
      }
      if (cursoCell) {
        const cs = getElementFullText(cursoCell);
        if (cs) registro.curso = cs;
      }
    });

    if (novidades > 0) atualizarContadores();
    return novidades;
  }

  // ABA TURMA (Imagens 3 e 4)
  function extrairAbaTurmaVisivel() {
    const cols = detectarCabecalhosTabela(document);
    const pickCol = (predicate) => {
      const matches = cols.filter(predicate);
      if (matches.length === 0) return null;
      return matches.sort((a, b) => a.rect.width - b.rect.width)[0];
    };

    const colAluno = pickCol((c) => c.key.includes('ALUNO') && c.key.includes('CGM'));
    const colCgmKey = pickCol((c) => c.key === 'CGMKEY');
    const colCodTurma = pickCol((c) => c.key === 'CODTURMA');
    const colPeriodo = pickCol((c) => c.key === 'PERIODOAVA');
    const colMed1 = pickCol((c) => c.key.includes('NOTA MEDIA 1'));
    const colMed2 = pickCol((c) => c.key.includes('NOTA MEDIA 2'));
    const colMed3 = pickCol((c) => c.key.includes('NOTA MEDIA 3'));
    const colAb = pickCol((c) => c.key.includes('ABAIXO DO BASICO'));
    const colBa = pickCol((c) => c.key.startsWith('BASICO'));
    const colAd = pickCol((c) => c.key.startsWith('ADEQUADO'));
    const colAv = pickCol((c) => c.key.startsWith('AVANCADO'));
    const colQtde = pickCol((c) => c.key.includes('QTDE DE NOTAS'));

    const rows = Array.from(document.querySelectorAll('[role="row"], .row, .tr'));
    let novos = 0;

    rows.forEach((r) => {
      const allCells = Array.from(r.querySelectorAll('[role="gridcell"], .pivotTableCellWrap, .bodyCells, .cell, td'));
      const cells = allCells.filter((c) => !allCells.some((o) => o !== c && o.contains(c)));
      if (cells.length === 0) return;

      const cgmKeyCell = colCgmKey ? encontrarCelulaDaColuna(cells, colCgmKey) : null;
      const cgmKeyText = cgmKeyCell ? getElementFullText(cgmKeyCell) : '';
      const keyMatch = cgmKeyText.match(/^(\d{7,12})(?:-(\d{1,2}))?$/);

      const alunoCell = colAluno ? encontrarCelulaDaColuna(cells, colAluno) : null;
      const alunoText = alunoCell ? getElementFullText(alunoCell) : '';
      const alunoCgmMatch = alunoText.match(/-\s*(\d{8,11})\s*$/);

      const cgm = (keyMatch && keyMatch[1]) || (alunoCgmMatch && alunoCgmMatch[1]) || '';
      if (!cgm) return;

      const prev = councilAlunosTurmaMap.get(cgm) || {
        cgm,
        cgmkey: cgmKeyText || null,
        nome: alunoText || null,
        codturma: null,
        periodoava: null,
        media1Tri: null,
        media2Tri: null,
        media3Tri: null,
        abaixoBasicoCount: null,
        basicoCount: null,
        adequadoCount: null,
        avancadoCount: null,
        qtdeNotasDadas: null,
      };

      if (!councilAlunosTurmaMap.has(cgm)) novos++;

      if (cgmKeyText) prev.cgmkey = cgmKeyText;
      if (alunoText && (!prev.nome || prev.nome.includes('...') || alunoText.length > prev.nome.length)) {
        prev.nome = alunoText;
      }

      const codCell = colCodTurma ? encontrarCelulaDaColuna(cells, colCodTurma) : null;
      if (codCell) {
        const ct = getElementFullText(codCell);
        if (/^\d{4,10}$/.test(ct)) prev.codturma = ct;
      }

      const perCell = colPeriodo ? encontrarCelulaDaColuna(cells, colPeriodo) : null;
      if (perCell) {
        const pv = getElementFullText(perCell);
        if (pv) prev.periodoava = pv;
      }

      const m1Cell = colMed1 ? encontrarCelulaDaColuna(cells, colMed1) : null;
      if (m1Cell) {
        const g = parsePtBrGradeClient(getElementFullText(m1Cell));
        if (g !== null) prev.media1Tri = g;
      }

      const m2Cell = colMed2 ? encontrarCelulaDaColuna(cells, colMed2) : null;
      if (m2Cell) {
        const g = parsePtBrGradeClient(getElementFullText(m2Cell));
        if (g !== null) prev.media2Tri = g;
      }

      const m3Cell = colMed3 ? encontrarCelulaDaColuna(cells, colMed3) : null;
      if (m3Cell) {
        const g = parsePtBrGradeClient(getElementFullText(m3Cell));
        if (g !== null) prev.media3Tri = g;
      }

      const abCell = colAb ? encontrarCelulaDaColuna(cells, colAb) : null;
      if (abCell) {
        const n = parsePtBrIntClient(getElementFullText(abCell));
        if (n !== null) prev.abaixoBasicoCount = n;
      }

      const baCell = colBa ? encontrarCelulaDaColuna(cells, colBa) : null;
      if (baCell) {
        const n = parsePtBrIntClient(getElementFullText(baCell));
        if (n !== null) prev.basicoCount = n;
      }

      const adCell = colAd ? encontrarCelulaDaColuna(cells, colAd) : null;
      if (adCell) {
        const n = parsePtBrIntClient(getElementFullText(adCell));
        if (n !== null) prev.adequadoCount = n;
      }

      const avCell = colAv ? encontrarCelulaDaColuna(cells, colAv) : null;
      if (avCell) {
        const n = parsePtBrIntClient(getElementFullText(avCell));
        if (n !== null) prev.avancadoCount = n;
      }

      const qtCell = colQtde ? encontrarCelulaDaColuna(cells, colQtde) : null;
      if (qtCell) {
        const n = parsePtBrIntClient(getElementFullText(qtCell));
        if (n !== null) prev.qtdeNotasDadas = n;
      }

      councilAlunosTurmaMap.set(cgm, prev);
    });

    if (novos > 0) atualizarContadores();
    return novos;
  }

  // ABA MAPA (Imagens 5 a 10) — Extração 2D com Viewport Guard Estrito
  function localizarContainerMatrizNotas() {
    const grids = Array.from(document.querySelectorAll('[role="grid"], .pivotTable'));
    let bestGrid = null;
    let bestScore = -1;

    for (let i = 0; i < grids.length; i++) {
      const grid = grids[i];
      const rect = grid.getBoundingClientRect();
      if (rect.width < 250 || rect.height < 140) continue;

      const textSample = normKeyAscii((grid.innerText || '').slice(0, 3500));
      let score = 0;
      if (textSample.includes('ALUNO - CGM')) score += 100;
      if (/1\s*[º°O]?\s*TRI/.test(textSample)) score += 40;
      if (/\b10\d{7,9}\b/.test(textSample)) score += 60;
      if (textSample.includes('PONTOS AVALIADOS')) score -= 200;
      if (grid.querySelector('[role="grid"], .pivotTable')) score -= 30;

      if (score > bestScore) {
        bestScore = score;
        bestGrid = grid;
      }
    }

    if (bestScore <= 0) return null;
    return bestGrid;
  }

  function calcularLimitesVisiveisMatriz(grid) {
    const gridRect = grid.getBoundingClientRect();
    const colHeaderWrap = grid.querySelector('.columnHeaders');
    const rowHeaderWrap = grid.querySelector('.rowHeaders');
    const bodyWrap = grid.querySelector('.bodyCells');
    const bodyViewport = bodyWrap
      ? (bodyWrap.closest('.mid-viewport') || bodyWrap.querySelector('.mid-viewport') || bodyWrap)
      : null;
    const cornerEl =
      grid.querySelector('.corner') ||
      grid.querySelector('.pivotTableCorner');

    const colRect = colHeaderWrap ? colHeaderWrap.getBoundingClientRect() : null;
    const rowHeaderRect = rowHeaderWrap ? rowHeaderWrap.getBoundingClientRect() : null;
    const bodyRect = bodyWrap ? bodyWrap.getBoundingClientRect() : null;
    const bodyVpRect = bodyViewport ? bodyViewport.getBoundingClientRect() : null;
    const cornerRect = cornerEl ? cornerEl.getBoundingClientRect() : null;

    // Estima borda esquerda real dos dados a partir dos cabeçalhos de linha/canto
    let dataLeft = gridRect.left;
    if (cornerRect && cornerRect.width > 10 && cornerRect.right > dataLeft) {
      dataLeft = cornerRect.right;
    }
    if (rowHeaderRect && rowHeaderRect.width > 10 && rowHeaderRect.right > dataLeft) {
      dataLeft = rowHeaderRect.right;
    }
    if (colRect && colRect.width > 20 && colRect.left > dataLeft) {
      dataLeft = colRect.left;
    }

    // Estima borda superior real dos dados (nunca usando .mid-viewport do cabeçalho)
    let dataTop = gridRect.top;
    if (colRect && colRect.height > 10 && colRect.bottom > dataTop && colRect.bottom < gridRect.bottom - 20) {
      dataTop = colRect.bottom;
    } else {
      const triHeaders = Array.from(grid.querySelectorAll('.columnHeaders [role="columnheader"], .columnHeaders .pivotTableCellWrap'));
      let maxTriBottom = 0;
      for (let i = 0; i < triHeaders.length; i++) {
        const txt = getElementFullText(triHeaders[i]);
        if (/^[123]\s*[º°o]?\s*tri$/i.test(txt) || /^total$/i.test(txt)) {
          const r = triHeaders[i].getBoundingClientRect();
          if (r.height > 0 && r.bottom > maxTriBottom && r.bottom < gridRect.bottom - 20) {
            maxTriBottom = r.bottom;
          }
        }
      }
      if (maxTriBottom > dataTop) dataTop = maxTriBottom;
    }

    const useBodyRect = bodyRect && bodyRect.width > 80 && bodyRect.height > 60;
    const useBodyVp = bodyVpRect && bodyVpRect.width > 80 && bodyVpRect.height > 60;

    if (useBodyRect && bodyRect.left > dataLeft) {
      dataLeft = Math.max(dataLeft, bodyRect.left);
    }
    if (useBodyRect && bodyRect.top > dataTop) {
      dataTop = Math.max(dataTop, bodyRect.top);
    }

    let dataRight = gridRect.right - 8;
    if (colRect && colRect.width > 80) dataRight = Math.min(dataRight, colRect.right);
    if (useBodyVp) dataRight = Math.min(dataRight, bodyVpRect.right);
    if (useBodyRect && bodyRect.right <= gridRect.right + 4) dataRight = Math.min(dataRight, bodyRect.right);

    let dataBottom = gridRect.bottom - 8;
    if (useBodyVp) dataBottom = Math.min(dataBottom, bodyVpRect.bottom);
    if (useBodyRect && bodyRect.bottom <= gridRect.bottom + 4) dataBottom = Math.min(dataBottom, bodyRect.bottom);

    return {
      gridRect,
      dataLeft,
      dataRight,
      dataTop,
      dataBottom,
      rowHeaderLeft: rowHeaderRect ? rowHeaderRect.left : gridRect.left,
      rowHeaderRight: rowHeaderRect ? rowHeaderRect.right : dataLeft,
      colHeaderTop: colRect ? colRect.top : gridRect.top,
      colHeaderBottom: dataTop,
    };
  }

  function expandToColumnHeaderBox(leafEl, expectedText, headerRoot) {
    let current = leafEl;
    const targetNorm = normText(expectedText);
    for (let depth = 0; depth < 4 && current && current.parentElement; depth++) {
      const parent = current.parentElement;
      if (headerRoot && !headerRoot.contains(parent)) break;
      const parentText = getElementFullText(parent);
      if (normText(parentText) !== targetNorm) break;
      current = parent;
      if (current.matches && current.matches('[role="columnheader"]')) break;
    }
    return current.getBoundingClientRect();
  }

  function getVisibleMapaColumnSignature(grid) {
    if (!grid) return '';
    const bounds = calcularLimitesVisiveisMatriz(grid);
    const headerRoot = grid.querySelector('.columnHeaders') || grid;
    const nodes = Array.from(
      headerRoot.querySelectorAll('.pivotTableCellWrap, [role="columnheader"]')
    );
    const seen = new Set();
    const visibleNames = [];
    for (let i = 0; i < nodes.length; i++) {
      const txt = getElementFullText(nodes[i]);
      if (!txt || /^[123]\s*[º°o]?\s*tri$/i.test(txt) || /^total$/i.test(txt)) continue;
      if (/\s-\s*\d{2,6}$/.test(txt) && !seen.has(txt)) {
        const r = nodes[i].getBoundingClientRect();
        if (r.width > 0 && r.right >= bounds.dataLeft && r.left <= bounds.dataRight) {
          seen.add(txt);
          visibleNames.push(txt);
        }
      }
    }
    return visibleNames.join('|');
  }

  function getVisibleMapaRowSignature(grid) {
    if (!grid) return '';
    const rowHeaderRoot = grid.querySelector('.rowHeaders') || grid;
    const nodes = Array.from(rowHeaderRoot.querySelectorAll('.pivotTableCellWrap, [role="rowheader"]'));
    const cgms = [];
    const seen = new Set();
    for (let i = 0; i < nodes.length; i++) {
      const txt = getElementFullText(nodes[i]);
      const m = txt.match(/-\s*(\d{8,11})\s*$/);
      if (m && !seen.has(m[1])) {
        seen.add(m[1]);
        cgms.push(m[1]);
      }
    }
    return cgms.join('|');
  }

  function extrairMapaNotasVisiveis() {
    const grid = localizarContainerMatrizNotas();
    if (!grid) return { novos: 0, bounds: null };

    const bounds = calcularLimitesVisiveisMatriz(grid);
    if (bounds.dataRight <= bounds.dataLeft + 40 || bounds.dataBottom <= bounds.dataTop + 20) {
      return { novos: 0, bounds };
    }

    const TOL = 2;
    const headerRoot = grid.querySelector('.columnHeaders') || grid;
    const rawHeaderNodes = Array.from(
      headerRoot.querySelectorAll('.pivotTableCellWrap, [role="columnheader"]')
    );
    const leafHeaderNodes = rawHeaderNodes.filter(
      (el) => !rawHeaderNodes.some((other) => other !== el && other.contains(el))
    );

    const discCandidatesMap = new Map();
    const subColCandidates = [];

    for (let i = 0; i < leafHeaderNodes.length; i++) {
      const el = leafHeaderNodes[i];
      const text = getElementFullText(el);
      if (!text) continue;
      const leafRect = el.getBoundingClientRect();
      if (leafRect.width <= 0 || leafRect.height <= 0) continue;

      const triMatch = text.match(/^([123])\s*[º°o]?\s*tri$/i);
      if (triMatch) {
        const triRect = expandToColumnHeaderBox(el, text, headerRoot);
        subColCandidates.push({
          trimester: parseInt(triMatch[1], 10),
          rect: triRect,
          centerX: (triRect.left + triRect.right) / 2,
        });
        continue;
      }

      const discMatch = text.match(/^([A-ZÀ-ÿ0-9.\s/]+?)\s*-\s*(\d{2,6})$/i);
      if (discMatch) {
        const upperCheck = normKeyAscii(discMatch[1]);
        if (upperCheck === 'ALUNO' || upperCheck.includes('SERIE') || upperCheck.includes('PERIODO')) {
          continue;
        }
        const boxRect = expandToColumnHeaderBox(el, text, headerRoot);
        if (boxRect.width < 20) continue;

        const key = `${discMatch[2]}|${text}`;
        const prev = discCandidatesMap.get(key);
        if (!prev || boxRect.width > (prev.right - prev.left)) {
          discCandidatesMap.set(key, {
            disciplinaRaw: text,
            subjectCode: discMatch[2],
            left: boxRect.left,
            right: boxRect.right,
            centerX: (boxRect.left + boxRect.right) / 2,
            bottom: boxRect.bottom,
          });
        }
      }
    }

    const sortedDisciplines = Array.from(discCandidatesMap.values()).sort(
      (a, b) => a.centerX - b.centerX
    );

    if (sortedDisciplines.length === 0 || subColCandidates.length === 0) {
      return { novos: 0, bounds };
    }

    // Define território horizontal de cada disciplina entre vizinhas
    const discWithTerritory = sortedDisciplines.map((d, idx) => {
      const prev = idx > 0 ? sortedDisciplines[idx - 1] : null;
      const next = idx < sortedDisciplines.length - 1 ? sortedDisciplines[idx + 1] : null;
      const terrLeft = prev ? (prev.centerX + d.centerX) / 2 : Math.min(d.left - 80, bounds.dataLeft - 20);
      const terrRight = next ? (d.centerX + next.centerX) / 2 : Math.max(d.right + 120, bounds.dataRight + 20);
      return {
        ...d,
        terrLeft,
        terrRight,
        isHeaderFullyVisible:
          d.left >= bounds.dataLeft - TOL &&
          d.right <= bounds.dataRight + TOL,
        subsByTri: new Map(),
      };
    });

    // Filtra subcolunas integralmente visíveis na área de dados (descartando bordas cortadas)
    const widths = subColCandidates.map((s) => s.rect.width).sort((a, b) => a - b);
    const medianSubWidth = widths[Math.floor(widths.length / 2)] || 28;
    const minSubWidth = Math.max(14, medianSubWidth * 0.6);

    for (let i = 0; i < subColCandidates.length; i++) {
      const sub = subColCandidates[i];
      const r = sub.rect;
      if (
        r.width < minSubWidth ||
        r.left < bounds.dataLeft - TOL ||
        r.right > bounds.dataRight + TOL
      ) {
        continue;
      }

      const ownerDisc = discWithTerritory.find(
        (d) => sub.centerX >= d.terrLeft && sub.centerX <= d.terrRight
      );
      if (!ownerDisc || !ownerDisc.isHeaderFullyVisible) continue;

      if (!ownerDisc.subsByTri.has(sub.trimester)) {
        ownerDisc.subsByTri.set(sub.trimester, {
          trimester: sub.trimester,
          subjectCode: ownerDisc.subjectCode,
          disciplinaRaw: ownerDisc.disciplinaRaw,
          left: r.left,
          right: r.right,
          centerX: sub.centerX,
        });
      }
    }

    // Viewport Guard Horizontal Estrito: somente disciplinas com cabeçalho e os 3 trimestres visíveis
    const visibleSubColumns = [];
    for (let i = 0; i < discWithTerritory.length; i++) {
      const disc = discWithTerritory[i];
      if (!disc.isHeaderFullyVisible) continue;
      if (!disc.subsByTri.has(1) || !disc.subsByTri.has(2) || !disc.subsByTri.has(3)) {
        continue;
      }
      visibleSubColumns.push(
        disc.subsByTri.get(1),
        disc.subsByTri.get(2),
        disc.subsByTri.get(3)
      );
    }

    if (visibleSubColumns.length === 0) {
      return { novos: 0, bounds };
    }

    // 2. Coleta rowHeaders (<NOME> - <CGM>) com suporte a linhas compactas (>= 6px) e Viewport Guard vertical
    const rowHeaderRoot = grid.querySelector('.rowHeaders') || grid;
    const rawRowHeaderNodes = Array.from(
      rowHeaderRoot.querySelectorAll('.pivotTableCellWrap, [role="rowheader"]')
    );
    const leafRowNodes = rawRowHeaderNodes.filter(
      (el) => !rawRowHeaderNodes.some((other) => other !== el && other.contains(el))
    );

    const visibleRowsMap = new Map();
    for (let i = 0; i < leafRowNodes.length; i++) {
      const el = leafRowNodes[i];
      const text = getElementFullText(el);
      if (!text) continue;
      const m = text.match(/^(.*?)\s*-\s*(\d{8,11})\s*$/);
      if (!m) continue;

      const cleanNome = normText(m[1]);
      if (/S[EÉ]RIE|PER[IÍ]ODO|SEM SERIA[CÇ][AÃ]O/i.test(cleanNome)) continue;

      const rect = el.getBoundingClientRect();
      if (rect.height < 6 || rect.top < bounds.dataTop - TOL || rect.bottom > bounds.dataBottom + TOL) {
        continue;
      }

      const existing = visibleRowsMap.get(m[2]);
      if (!existing || rect.height > existing.height) {
        visibleRowsMap.set(m[2], {
          cgm: m[2],
          nome: `${cleanNome} - ${m[2]}`,
          top: rect.top,
          bottom: rect.bottom,
          centerY: (rect.top + rect.bottom) / 2,
          height: rect.height,
        });
      }
    }

    const visibleRows = Array.from(visibleRowsMap.values());
    if (visibleRows.length === 0) {
      return { novos: 0, bounds };
    }

    // 3. Coleta células de nota dentro da área de dados (.bodyCells)
    const bodyRoot = grid.querySelector('.bodyCells') || grid;
    const rawBodyCells = Array.from(
      bodyRoot.querySelectorAll('.pivotTableCellWrap, [role="gridcell"]')
    );
    const leafBodyCells = rawBodyCells.filter((el) => {
      if (el.closest('.rowHeaders') || el.closest('.columnHeaders')) return false;
      return !rawBodyCells.some((other) => other !== el && other.contains(el));
    });

    let novos = 0;
    for (let i = 0; i < leafBodyCells.length; i++) {
      const cell = leafBodyCells[i];
      const gradeNum = parseMapaGradeCellText(getElementFullText(cell));
      if (gradeNum === null) continue;

      const rect = cell.getBoundingClientRect();
      if (
        rect.width <= 0 ||
        rect.height <= 0 ||
        rect.left < bounds.dataLeft - TOL ||
        rect.right > bounds.dataRight + TOL ||
        rect.top < bounds.dataTop - TOL ||
        rect.bottom > bounds.dataBottom + TOL
      ) {
        continue;
      }

      const cx = (rect.left + rect.right) / 2;
      const cy = (rect.top + rect.bottom) / 2;

      const matchedSub = visibleSubColumns.find(
        (sub) => cx >= sub.left - 3 && cx <= sub.right + 3
      );
      if (!matchedSub) continue;

      let matchedRow = null;
      let bestDistY = Infinity;
      for (let rIdx = 0; rIdx < visibleRows.length; rIdx++) {
        const row = visibleRows[rIdx];
        const distY = Math.abs(cy - row.centerY);
        const maxDistY = Math.max(8, row.height * 0.65);
        if (distY <= maxDistY && distY < bestDistY) {
          bestDistY = distY;
          matchedRow = row;
        }
      }
      if (!matchedRow) continue;

      const cellKey = `${matchedRow.cgm}|${matchedSub.subjectCode}|${matchedSub.trimester}`;
      if (!councilMapaCellsMap.has(cellKey)) {
        novos++;
      }
      councilMapaCellsMap.set(cellKey, {
        cgm: matchedRow.cgm,
        nome: matchedRow.nome,
        disciplinaRaw: matchedSub.disciplinaRaw,
        disciplinaCode: matchedSub.subjectCode,
        trimester: matchedSub.trimester,
        gradeNum,
      });
    }

    if (novos > 0) atualizarContadores();
    return { novos, bounds };
  }

  function parseMapaGradeCellText(raw) {
    return parsePtBrGradeClient(raw);
  }

  function extrairTabelaAtiva() {
    const mode = detectarModoPowerBi();
    if (mode === 'APRENDIZAGEM_MAPA') return extrairMapaNotasVisiveis().novos;
    if (mode === 'APRENDIZAGEM_TURMA') return extrairAbaTurmaVisivel();
    if (mode === 'APRENDIZAGEM_ESCOLA') return extrairAbaEscolaVisivel();
    return extrairLinhasFrequenciaVisiveis();
  }

  // =========================================================================
  // AUTO-SCROLL (VERTICAL PARA FREQUÊNCIA/TURMA E 2D EM SERPENTINA PARA MAPA/ESCOLA)
  // =========================================================================

  function findScrollContainers(root) {
    const candidates = Array.from(
      (root || document).querySelectorAll('.bodyCells, .mid-viewport, .innerContainer, [role="grid"], .tableEx, .pivotTable, .scroll-wrapper')
    );
    const vTarget = candidates.find((el) => el.scrollHeight > el.clientHeight + 8) || null;
    const hTarget = candidates.find((el) => el.scrollWidth > el.clientWidth + 8) || null;
    return { vTarget, hTarget };
  }

  function dispatchWheel(el, deltaX, deltaY) {
    if (!el) return;
    try {
      el.dispatchEvent(
        new WheelEvent('wheel', {
          deltaX,
          deltaY,
          deltaMode: 0,
          bubbles: true,
          cancelable: true,
        })
      );
    } catch {}
  }

  function findScrollbarThumb(root, orientation) {
    const scopes = [];
    if (root) scopes.push(root);
    const outer =
      root && root !== document && root.closest
        ? root.closest('.innerContainer, .pivotTable, .visualContainer')
        : null;
    if (outer && outer !== root) scopes.push(outer);
    if (scopes.length === 0) scopes.push(document);

    for (let sIdx = 0; sIdx < scopes.length; sIdx++) {
      const bars = Array.from(scopes[sIdx].querySelectorAll('.scroll-bar-part-bar'));
      const matched = bars.find((bar) => {
        const track = bar.parentElement;
        if (!track) return false;
        const tr = track.getBoundingClientRect();
        const br = bar.getBoundingClientRect();
        if (orientation === 'horizontal') {
          return tr.width > tr.height * 2 && tr.width > br.width + 6;
        }
        return tr.height > tr.width * 2 && tr.height > br.height + 6;
      });
      if (matched) return matched;
    }
    return null;
  }

  function dragScrollbarThumb(bar, orientation, deltaPx) {
    if (!bar) return false;
    const br = bar.getBoundingClientRect();
    const startX = br.left + br.width / 2;
    const startY = br.top + br.height / 2;
    const endX = orientation === 'horizontal' ? startX + deltaPx : startX;
    const endY = orientation === 'vertical' ? startY + deltaPx : startY;

    try {
      if (typeof PointerEvent === 'function') {
        bar.dispatchEvent(new PointerEvent('pointerdown', { clientX: startX, clientY: startY, bubbles: true, pointerId: 1 }));
      }
      bar.dispatchEvent(new MouseEvent('mousedown', { clientX: startX, clientY: startY, bubbles: true }));
      if (typeof PointerEvent === 'function') {
        document.dispatchEvent(new PointerEvent('pointermove', { clientX: endX, clientY: endY, bubbles: true, pointerId: 1 }));
      }
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: endX, clientY: endY, bubbles: true }));
      if (typeof PointerEvent === 'function') {
        document.dispatchEvent(new PointerEvent('pointerup', { clientX: endX, clientY: endY, bubbles: true, pointerId: 1 }));
      }
      document.dispatchEvent(new MouseEvent('mouseup', { clientX: endX, clientY: endY, bubbles: true }));
      return true;
    } catch {
      return false;
    }
  }

  function dragHorizontalScrollbarStep(grid, deltaPx) {
    const horizBar = findScrollbarThumb(grid, 'horizontal');
    return dragScrollbarThumb(horizBar, 'horizontal', deltaPx);
  }

  function dragVerticalScrollbarStep(grid, deltaPx) {
    const vertBar = findScrollbarThumb(grid, 'vertical');
    return dragScrollbarThumb(vertBar, 'vertical', deltaPx);
  }

  function getRowSignatureFallback(root) {
    const rows = Array.from((root || document).querySelectorAll('[role="row"], .row, .tr'));
    return rows
      .slice(0, 8)
      .map((r) => normText(r.innerText).slice(0, 40))
      .filter(Boolean)
      .join('|');
  }

  async function scanVerticalPass(vTarget, direction, extractFn, statusPrefix, opts) {
    const grid = opts?.grid || null;
    const wheelArea = opts?.wheelArea || vTarget || grid;
    const vertBar = findScrollbarThumb(grid || document, 'vertical');

    if (!vTarget && !vertBar) {
      extractFn();
      return;
    }

    const stepSize = vTarget
      ? Math.max(120, Math.floor((vTarget.clientHeight || 400) * 0.55))
      : 260;
    let idleTicks = 0;
    let guardSteps = 0;

    while (isScrolling && guardSteps < 80) {
      guardSteps++;
      extractFn();
      setStatus(statusPrefix(), '#0284c7');

      let usedNative = false;
      if (vTarget && vTarget.scrollHeight > vTarget.clientHeight + 8) {
        const prevTop = vTarget.scrollTop;
        const maxTop = Math.max(0, vTarget.scrollHeight - vTarget.clientHeight);
        const atEdge = direction > 0 ? prevTop >= maxTop - 4 : prevTop <= 4;

        if (atEdge) {
          await new Promise((r) => setTimeout(r, 400));
          extractFn();
          break;
        }

        vTarget.scrollTop = Math.max(0, Math.min(maxTop, prevTop + direction * stepSize));
        if (Math.abs(vTarget.scrollTop - prevTop) >= 2) {
          usedNative = true;
          idleTicks = 0;
          await new Promise((r) => setTimeout(r, 240));
          continue;
        }
      }

      // Fallback para barra de rolagem virtualizada do Power BI
      const beforeSig = grid ? getVisibleMapaRowSignature(grid) : getRowSignatureFallback(document);
      const currentVertBar = findScrollbarThumb(grid || document, 'vertical');
      if (currentVertBar) {
        const br = currentVertBar.getBoundingClientRect();
        const thumbStep = Math.max(18, Math.round(br.height * 0.45));
        dragScrollbarThumb(currentVertBar, 'vertical', direction * thumbStep);
      } else if (!usedNative && wheelArea) {
        dispatchWheel(wheelArea, 0, direction * 260);
      } else {
        break;
      }

      await new Promise((r) => setTimeout(r, 280));
      extractFn();
      const afterSig = grid ? getVisibleMapaRowSignature(grid) : getRowSignatureFallback(document);
      if (afterSig === beforeSig) {
        idleTicks++;
        if (idleTicks >= 3) break;
      } else {
        idleTicks = 0;
      }
    }
  }

  async function iniciarAutoScroll2DMapa() {
    const grid = localizarContainerMatrizNotas();
    const { vTarget, hTarget } = findScrollContainers(grid || document);
    const wheelArea = (grid && (grid.querySelector('.bodyCells, .mid-viewport') || grid)) || hTarget || vTarget;

    if (!vTarget && !hTarget && !grid) {
      extrairMapaNotasVisiveis();
      setStatus(`Matriz lida! Total: ${councilMapaCellsMap.size} células capturadas.`, '#10b981');
      return;
    }

    isScrolling = true;
    const btn = document.getElementById('leo-btn-autoscroll');
    if (btn) btn.innerHTML = '<span>⏸️</span> Pausar Rastreamento';

    // Retorna para o início horizontal e vertical antes de iniciar a serpentina
    if (hTarget) hTarget.scrollLeft = 0;
    if (vTarget) vTarget.scrollTop = 0;
    const initHorizBar = findScrollbarThumb(grid, 'horizontal');
    if (initHorizBar) {
      const tr = initHorizBar.parentElement.getBoundingClientRect();
      dragScrollbarThumb(initHorizBar, 'horizontal', -(tr.width + 40));
    }
    const initVertBar = findScrollbarThumb(grid, 'vertical');
    if (initVertBar) {
      const tr = initVertBar.parentElement.getBoundingClientRect();
      dragScrollbarThumb(initVertBar, 'vertical', -(tr.height + 40));
    }
    await new Promise((r) => setTimeout(r, 350));

    let sliceIdx = 0;
    let direction = 1; // 1 = desce (slices pares), -1 = sobe (slices ímpares)
    let stuckHorizontal = 0;

    while (isScrolling && sliceIdx < 60) {
      const snap = extrairMapaNotasVisiveis();
      const visibleDataWidth =
        snap.bounds && snap.bounds.dataRight > snap.bounds.dataLeft
          ? snap.bounds.dataRight - snap.bounds.dataLeft
          : 420;
      const horizStep = Math.max(120, Math.floor(visibleDataWidth * 0.45));

      await scanVerticalPass(
        vTarget,
        direction,
        () => extrairMapaNotasVisiveis(),
        () => `Serpentina 2D (fatia ${sliceIdx + 1})... ${councilMapaCellsMap.size} notas capturadas.`,
        { grid, wheelArea }
      );

      if (!isScrolling) break;

      // Avança horizontalmente para a próxima fatia de disciplinas preservando ~55% de sobreposição
      let movedNativeHoriz = false;
      if (hTarget && hTarget.scrollWidth > hTarget.clientWidth + 8) {
        const prevLeft = hTarget.scrollLeft;
        const maxLeft = Math.max(0, hTarget.scrollWidth - hTarget.clientWidth);
        if (prevLeft >= maxLeft - 4) break;
        hTarget.scrollLeft = Math.min(maxLeft, prevLeft + horizStep);
        await new Promise((r) => setTimeout(r, 320));
        if (Math.abs(hTarget.scrollLeft - prevLeft) >= 2) {
          movedNativeHoriz = true;
          stuckHorizontal = 0;
        }
      }

      if (!movedNativeHoriz) {
        const beforeSig = getVisibleMapaColumnSignature(grid);
        const horizBar = findScrollbarThumb(grid, 'horizontal');
        if (horizBar) {
          const br = horizBar.getBoundingClientRect();
          const thumbStep = Math.max(18, Math.round(br.width * 0.45));
          dragScrollbarThumb(horizBar, 'horizontal', thumbStep);
        } else {
          dispatchWheel(wheelArea, horizStep, 0);
        }
        await new Promise((r) => setTimeout(r, 360));
        extrairMapaNotasVisiveis();
        const afterSig = getVisibleMapaColumnSignature(grid);
        if (afterSig === beforeSig) {
          stuckHorizontal++;
          if (stuckHorizontal >= 3) break;
        } else {
          stuckHorizontal = 0;
        }
      }

      direction = direction * -1;
      sliceIdx++;
    }

    isScrolling = false;
    if (btn) btn.innerHTML = '<span>⚡</span> Rastrear Novamente';
    atualizarContadores();
    salvarBiAprendizagemNoStorage();
    setStatus(`✅ Concluído (MAPA)! ${councilMapaCellsMap.size} notas trimestrais capturadas.`, '#10b981');
  }

  async function iniciarAutoScrollEscolaOuTurma(mode) {
    const { vTarget, hTarget } = findScrollContainers(document);
    const extractFn =
      mode === 'APRENDIZAGEM_TURMA' ? extrairAbaTurmaVisivel : extrairAbaEscolaVisivel;
    const vertBar = findScrollbarThumb(document, 'vertical');

    if (!vTarget && !vertBar) {
      extractFn();
      if (hTarget) {
        const prevLeft = hTarget.scrollLeft;
        hTarget.scrollLeft = Math.max(0, hTarget.scrollWidth - hTarget.clientWidth);
        await new Promise((r) => setTimeout(r, 300));
        extractFn();
        hTarget.scrollLeft = prevLeft;
      }
      atualizarContadores();
      salvarBiAprendizagemNoStorage();
      setStatus(
        mode === 'APRENDIZAGEM_TURMA'
          ? `✅ Concluído (TURMA)! ${councilAlunosTurmaMap.size} alunos capturados.`
          : `✅ Concluído (ESCOLA)! ${councilTurmasMap.size} turmas capturadas.`,
        '#10b981'
      );
      return;
    }

    isScrolling = true;
    const btn = document.getElementById('leo-btn-autoscroll');
    if (btn) btn.innerHTML = '<span>⏸️</span> Pausar Rastreamento';

    if (vTarget) vTarget.scrollTop = 0;
    if (hTarget) hTarget.scrollLeft = 0;
    await new Promise((r) => setTimeout(r, 250));

    // Passagem vertical capturando colunas da esquerda
    await scanVerticalPass(
      vTarget,
      1,
      extractFn,
      () =>
        mode === 'APRENDIZAGEM_TURMA'
          ? `Rastreando TURMA... ${councilAlunosTurmaMap.size} alunos capturados.`
          : `Rastreando ESCOLA... ${councilTurmasMap.size} turmas capturadas.`
    );

    // Se houver scroll horizontal (ex: Equivalência Seriação / CURSO na aba ESCOLA ou Qtde Notas na aba TURMA)
    if (isScrolling && hTarget && hTarget.scrollWidth > hTarget.clientWidth + 10) {
      const horizStep = Math.max(200, Math.floor(hTarget.clientWidth * 0.7));
      const maxLeft = hTarget.scrollWidth - hTarget.clientWidth;
      let nextLeft = horizStep;
      let dir = -1;
      while (isScrolling) {
        hTarget.scrollLeft = Math.min(maxLeft, nextLeft);
        await new Promise((r) => setTimeout(r, 280));
        await scanVerticalPass(
          vTarget,
          dir,
          extractFn,
          () => `Lendo colunas complementares...`
        );
        if (hTarget.scrollLeft >= maxLeft - 4) break;
        nextLeft += horizStep;
        dir = dir * -1;
      }
      hTarget.scrollLeft = 0;
    }

    isScrolling = false;
    if (btn) btn.innerHTML = '<span>⚡</span> Rastrear Novamente';
    atualizarContadores();
    salvarBiAprendizagemNoStorage();
    setStatus(
      mode === 'APRENDIZAGEM_TURMA'
        ? `✅ Concluído (TURMA)! ${councilAlunosTurmaMap.size} alunos capturados.`
        : `✅ Concluído (ESCOLA)! ${councilTurmasMap.size} turmas capturadas.`,
      '#10b981'
    );
  }

  async function iniciarAutoScroll() {
    if (isScrolling) {
      isScrolling = false;
      setStatus('Rastreamento pausado.');
      const btn = document.getElementById('leo-btn-autoscroll');
      if (btn) btn.innerHTML = '<span>⚡</span> Continuar Rastreamento';
      return;
    }

    const mode = detectarModoPowerBi();
    if (mode === 'APRENDIZAGEM_MAPA') {
      await iniciarAutoScroll2DMapa();
      return;
    }
    if (mode === 'APRENDIZAGEM_TURMA' || mode === 'APRENDIZAGEM_ESCOLA') {
      await iniciarAutoScrollEscolaOuTurma(mode);
      return;
    }

    // Modo Frequência (Presente na Escola)
    const containers = Array.from(document.querySelectorAll('.innerContainer, [role="grid"], .mid-viewport, .tableEx, .bodyCells'));
    const scrollable = containers.find(el => el.scrollHeight > el.clientHeight);

    if (!scrollable) {
      extrairLinhasFrequenciaVisiveis();
      setStatus(`Tabela lida! Total: ${alunosCapturados.size} alunos.`);
      return;
    }

    isScrolling = true;
    const btn = document.getElementById('leo-btn-autoscroll');
    if (btn) btn.innerHTML = '<span>⏸️</span> Pausar Rastreamento';

    setStatus('Rastreando tabela da escola inteira...', '#0284c7');

    let ultimosAlunos = 0;
    let semMudancas = 0;

    while (isScrolling) {
      extrairLinhasFrequenciaVisiveis();
      setStatus(`Rastreando... ${alunosCapturados.size} alunos capturados.`, '#0284c7');

      if (alunosCapturados.size === ultimosAlunos) {
        semMudancas++;
      } else {
        semMudancas = 0;
        ultimosAlunos = alunosCapturados.size;
      }

      if (semMudancas >= 30) break;

      if (scrollable.scrollTop + scrollable.clientHeight >= scrollable.scrollHeight - 5) {
        await new Promise(r => setTimeout(r, 600));
        extrairLinhasFrequenciaVisiveis();
        if (scrollable.scrollTop + scrollable.clientHeight >= scrollable.scrollHeight - 5) {
          break;
        }
      }

      scrollable.scrollTop += 180;
      await new Promise(r => setTimeout(r, 260));
    }

    isScrolling = false;
    if (btn) btn.innerHTML = '<span>⚡</span> Rastrear Novamente';
    setStatus(`✅ Concluído! ${alunosCapturados.size} alunos capturados com sucesso!`, '#10b981');
    salvarNoStorage();
  }

  function salvarNoStorage() {
    const lista = Array.from(alunosCapturados.values());
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ 'leopoldina_alunos_frequencia': lista });
    }
  }

  function buildConselhoBiPayload() {
    const groupedNotas = new Map();

    councilMapaCellsMap.forEach((cell) => {
      const key = `${cell.cgm}|${cell.disciplinaCode || cell.disciplinaRaw}`;
      let rec = groupedNotas.get(key);
      if (!rec) {
        const turmaInfo = councilAlunosTurmaMap.get(cell.cgm);
        rec = {
          cgm: cell.cgm,
          nome: cell.nome,
          codturma: turmaInfo?.codturma || undefined,
          disciplinaRaw: cell.disciplinaRaw,
          disciplinaCode: cell.disciplinaCode || undefined,
          nota1Tri: null,
          nota2Tri: null,
          nota3Tri: null,
        };
        groupedNotas.set(key, rec);
      }
      if (cell.trimester === 1) rec.nota1Tri = cell.gradeNum;
      if (cell.trimester === 2) rec.nota2Tri = cell.gradeNum;
      if (cell.trimester === 3) rec.nota3Tri = cell.gradeNum;
    });

    return {
      year: 2026,
      turmas: Array.from(councilTurmasMap.values()),
      alunosTurma: Array.from(councilAlunosTurmaMap.values()),
      notasMapa: Array.from(groupedNotas.values()),
    };
  }

  function salvarBiAprendizagemNoStorage() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({
        redeativa_bi_aprendizagem_cache: buildConselhoBiPayload(),
      });
    }
  }

  function baixarCSV() {
    if (getEffectiveSyncTarget() === 'CONSELHO_BI') {
      if (!hasAnyAprendizagemData()) {
        extrairTabelaAtiva();
        if (!hasAnyAprendizagemData()) {
          alert('Nenhum dado do BI Aprendizagem capturado ainda. Clique em "Rastrear Aba Ativa" primeiro!');
          return;
        }
      }

      const payload = buildConselhoBiPayload();
      const headers = [
        'CGM',
        'Nome',
        'CodTurma',
        'Disciplina_Codigo',
        'Disciplina',
        'Nota_1Tri',
        'Nota_2Tri',
        'Nota_3Tri',
      ];
      const rows = [headers.join(';')];

      payload.notasMapa.forEach((n) => {
        rows.push([
          `"${n.cgm || ''}"`,
          `"${String(n.nome || '').replace(/"/g, '""')}"`,
          `"${n.codturma || ''}"`,
          `"${n.disciplinaCode || ''}"`,
          `"${String(n.disciplinaRaw || '').replace(/"/g, '""')}"`,
          `"${n.nota1Tri !== null && n.nota1Tri !== undefined ? String(n.nota1Tri).replace('.', ',') : ''}"`,
          `"${n.nota2Tri !== null && n.nota2Tri !== undefined ? String(n.nota2Tri).replace('.', ',') : ''}"`,
          `"${n.nota3Tri !== null && n.nota3Tri !== undefined ? String(n.nota3Tri).replace('.', ',') : ''}"`,
        ].join(';'));
      });

      const csvContent = '\uFEFF' + rows.join('\r\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `BI_Aprendizagem_Conselho_RedeAtiva_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setStatus('Planilha CSV do Conselho de Classe gerada!', '#10b981');
      return;
    }

    if (alunosCapturados.size === 0) {
      extrairLinhasFrequenciaVisiveis();
      if (alunosCapturados.size === 0) {
        alert('Nenhum dado capturado ainda. Clique em "Rastrear Aba Ativa" primeiro!');
        return;
      }
    }

    const headers = [
      'CGM',
      'Nome',
      'Turma',
      'Media_Geral_Presenca',
      'Presenca_Semana_Atual',
      'Presenca_Semana_Anterior',
      'Amparo_Legal_Vigencia_Max',
      'Deficiencia_Altas_Habilidades',
      'Ganhando_Mundo',
      'SERP',
      'Idade'
    ];
    const rows = [headers.join(';')];

    alunosCapturados.forEach(a => {
      rows.push([
        `"${a.cgm}"`,
        `"${a.nome.replace(/"/g, '""')}"`,
        `"${a.turma.replace(/"/g, '""')}"`,
        `"${a.mediaGeral}"`,
        `"${a.semanaAtual}"`,
        `"${a.semanaAnterior}"`,
        `"${a.amparoLegalVigencia || ''}"`,
        `"${a.deficienciaAltasHabilidades ? '1' : ''}"`,
        `"${a.ganhandoMundo ? '1' : ''}"`,
        `"${a.serpAtivo ? 'Sim' : ''}"`,
        `"${a.idade ?? ''}"`
      ].join(';'));
    });

    const csvContent = '\uFEFF' + rows.join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Frequencia_RedeAtiva_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setStatus('Planilha CSV gerada e baixada!', '#10b981');
  }

  async function copiarJSON() {
    if (getEffectiveSyncTarget() === 'CONSELHO_BI') {
      if (!hasAnyAprendizagemData()) {
        extrairTabelaAtiva();
      }
      const payload = buildConselhoBiPayload();
      try {
        await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
        setStatus(`JSON copiado (${payload.notasMapa.length} registros de notas)!`, '#10b981');
      } catch {
        setStatus('Erro ao copiar para clipboard.', '#ef4444');
      }
      return;
    }

    if (alunosCapturados.size === 0) {
      extrairLinhasFrequenciaVisiveis();
    }
    const lista = Array.from(alunosCapturados.values());
    try {
      await navigator.clipboard.writeText(JSON.stringify(lista, null, 2));
      setStatus(`JSON com ${lista.length} alunos copiado!`, '#10b981');
    } catch {
      setStatus('Erro ao copiar para clipboard.', '#ef4444');
    }
  }

  async function sincronizarConselhoComSistema(baseUrl, token) {
    if (!hasAnyAprendizagemData()) {
      extrairTabelaAtiva();
      if (!hasAnyAprendizagemData()) {
        alert('Nenhum dado do BI Aprendizagem capturado ainda. Use "Rastrear Aba Ativa" primeiro.');
        return;
      }
    }

    const payload = buildConselhoBiPayload();
    const CHUNK_SIZE = 3000;
    const totalNotas = payload.notasMapa.length;
    const numChunks = Math.max(1, Math.ceil(totalNotas / CHUNK_SIZE));

    let totalNotasGravadas = 0;
    let totalDisciplinasCriadas = 0;
    let totalAbaixoMedia = 0;
    let ultimoTurmasAfetadas = 0;
    let ultimoAlunosPareados = 0;

    setStatus(`Enviando BI Aprendizagem para ${baseUrl} (${numChunks} lote${numChunks > 1 ? 's' : ''})...`, '#6366f1');

    try {
      for (let i = 0; i < numChunks; i++) {
        const chunkPayload = {
          year: payload.year,
          turmas: i === 0 ? payload.turmas : [],
          alunosTurma: i === 0 ? payload.alunosTurma : [],
          notasMapa: payload.notasMapa.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
        };

        const resp = await fetch(`${baseUrl}/api/conselho-classe/sync`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify(chunkPayload),
        });

        if (!resp.ok) {
          if (resp.status === 401) {
            setStatus('❌ Erro 401: Chave de Sincronização inválida no servidor.', '#ef4444');
            return;
          }
          const errJson = await resp.json().catch(() => ({}));
          setStatus(`Erro no servidor: ${errJson.error || ('HTTP ' + resp.status)}`, '#ef4444');
          return;
        }

        const resJson = await resp.json();
        totalNotasGravadas += resJson.notasGravadas ?? 0;
        totalDisciplinasCriadas += resJson.disciplinasCriadas ?? 0;
        totalAbaixoMedia = Math.max(totalAbaixoMedia, resJson.abaixoDaMediaDetectados ?? 0);
        ultimoTurmasAfetadas = Math.max(ultimoTurmasAfetadas, resJson.turmasAfetadas ?? 0);
        ultimoAlunosPareados = Math.max(ultimoAlunosPareados, resJson.alunosPareados ?? 0);
      }

      setStatus(
        `🚀 Conselho sincronizado! ${ultimoTurmasAfetadas} turmas, ${ultimoAlunosPareados} alunos, ${totalNotasGravadas} notas (${totalDisciplinasCriadas} novas disciplinas).`,
        '#10b981'
      );
    } catch {
      setStatus(`Não foi possível conectar em ${baseUrl}. Verifique a URL.`, '#ef4444');
    }
  }

  async function sincronizarComSistema() {
    const inputUrl = document.getElementById('leo-cfg-url');
    const inputToken = document.getElementById('leo-cfg-token');
    const rawBaseUrl = (inputUrl?.value?.trim() || 'https://www.redeativa.app.br').replace(/\/+$/, '');
    const baseUrl = rawBaseUrl.replace(/^https?:\/\/redeativa\.app\.br(?=\/|$)/i, 'https://www.redeativa.app.br');
    const token = inputToken?.value?.trim() || '';

    if (!isTrustedSyncServerUrl(baseUrl)) {
      setStatus('❌ URL de servidor não autorizada. Envio bloqueado para proteger sua chave.', '#ef4444');
      return;
    }

    if (!token) {
      const settingsBox = document.getElementById('leo-settings-box');
      if (settingsBox) settingsBox.open = true;
      if (inputToken) inputToken.focus();
      setStatus('⚠️ Cole a Chave de Sincronização (disponível em /faltas ou /gestao).', '#f59e0b');
      return;
    }

    if (getEffectiveSyncTarget() === 'CONSELHO_BI') {
      await sincronizarConselhoComSistema(baseUrl, token);
      return;
    }

    if (alunosCapturados.size === 0) {
      extrairLinhasFrequenciaVisiveis();
      if (alunosCapturados.size === 0) {
        alert('Nenhum aluno capturado ainda. Use o botão "Rastrear Aba Ativa" primeiro.');
        return;
      }
    }

    const lista = Array.from(alunosCapturados.values());
    setStatus(`Enviando ${lista.length} alunos para ${baseUrl}...`, '#6366f1');

    try {
      const resp = await fetch(`${baseUrl}/api/frequencia/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ alunos: lista })
      });

      if (resp.ok) {
        const resJson = await resp.json();
        const atualizados = resJson.atualizados ?? lista.length;
        const emRisco = resJson.emRiscoCount ?? 0;
        const amparos = resJson.amparosCriados ?? 0;
        const enriquecidos = resJson.estudantesEnriquecidos ?? 0;
        const extras = [];
        if (amparos > 0) extras.push(`${amparos} atestados criados`);
        if (enriquecidos > 0) extras.push(`${enriquecidos} enriquecidos`);
        const extraText = extras.length > 0 ? ` (${extras.join(', ')})` : '';
        setStatus(`🚀 Sincronizado na nuvem! ${atualizados} alunos (${emRisco} em risco)${extraText}.`, '#10b981');
      } else if (resp.status === 401) {
        setStatus(`❌ Erro 401: Chave de Sincronização inválida no servidor.`, '#ef4444');
      } else {
        const errJson = await resp.json().catch(() => ({}));
        setStatus(`Erro no servidor: ${errJson.error || ('HTTP ' + resp.status)}`, '#ef4444');
      }
    } catch {
      setStatus(`Não foi possível conectar em ${baseUrl}. Verifique a URL.`, '#ef4444');
    }
  }

  window.addEventListener('load', () => {
    setTimeout(criarInterfaceFlutuante, 2000);
  });
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(criarInterfaceFlutuante, 1000);
  }

  let timeoutScroll = null;
  window.addEventListener('scroll', () => {
    if (timeoutScroll) clearTimeout(timeoutScroll);
    timeoutScroll = setTimeout(() => {
      extrairTabelaAtiva();
      atualizarContadores();
    }, 400);
  }, true);
})();
