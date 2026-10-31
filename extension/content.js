// content.js - Roda no contexto da página e gerencia a interface e coleta da tabela
(function() {
  if (window.__leopoldina_content_injected) return;
  window.__leopoldina_content_injected = true;

  console.log('[Leopoldina] Content script v1.1 carregado com sucesso.');

  // Armazena alunos únicos mapeados por CGM
  const alunosCapturados = new Map();
  let isScrolling = false;

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
        <span>Busca Ativa Leopoldina</span>
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
        width: 390px;
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
              <span>🎓</span> Busca Ativa & Frequência
            </div>
            <div style="font-size: 11px; color: #94a3b8;">Colégio Leopoldina B. Pedroso</div>
          </div>
          <button id="leo-close-btn" style="background: none; border: none; color: #94a3b8; font-size: 18px; cursor: pointer; padding: 4px;">&times;</button>
        </div>

        <div style="padding: 16px;">
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; margin-bottom: 14px;">
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
              <span>⚡</span> Rastrear Todos os Alunos (Auto-Scroll)
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
              <span>📋</span> Copiar JSON dos Alunos
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
              <span>🚀</span> Sincronizar com Sistema (Vercel)
            </button>
          </div>

          <details id="leo-settings-box" style="margin-top: 10px; font-size: 11px; color: #475569; background: #f8fafc; padding: 8px; border-radius: 8px; border: 1px solid #e2e8f0;">
            <summary style="cursor: pointer; font-weight: 600; color: #334155;">⚙️ Configuração de Envio (Vercel / Nuvem)</summary>
            <div style="margin-top: 8px; display: flex; flex-direction: column; gap: 6px;">
              <div>
                <label style="display: block; font-weight: 600; margin-bottom: 2px;">URL do Servidor:</label>
                <input id="leo-cfg-url" type="text" placeholder="https://seu-app.vercel.app" style="width: 100%; box-sizing: border-box; padding: 4px 6px; font-size: 11px; border: 1px solid #cbd5e1; border-radius: 4px; font-family: monospace;" />
              </div>
              <div>
                <label style="display: block; font-weight: 600; margin-bottom: 2px;">Chave de Sincronização:</label>
                <input id="leo-cfg-token" type="password" placeholder="Token secreto cadastrado na Vercel" style="width: 100%; box-sizing: border-box; padding: 4px 6px; font-size: 11px; border: 1px solid #cbd5e1; border-radius: 4px;" />
              </div>
              <div style="display: flex; gap: 4px; margin-top: 2px;">
                <button id="leo-cfg-btn-vercel" type="button" style="flex: 1; padding: 4px; font-size: 10px; border-radius: 4px; border: 1px solid #cbd5e1; background: #fff; cursor: pointer; font-weight: 600;">Usar Vercel</button>
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

    // Eventos da interface
    const pill = document.getElementById('leo-pill');
    const panel = document.getElementById('leo-panel');
    const closeBtn = document.getElementById('leo-close-btn');

    pill.addEventListener('click', () => {
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    });

    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.style.display = 'none';
    });

    // Carrega configurações salvas no storage
    const inputUrl = document.getElementById('leo-cfg-url');
    const inputToken = document.getElementById('leo-cfg-token');

    (async () => {
      if (chrome.storage && chrome.storage.local) {
        try {
          const res = await chrome.storage.local.get(['leopoldina_server_url', 'leopoldina_sync_token']);
          if (inputUrl) {
            inputUrl.value = res.leopoldina_server_url || 'https://busca-ativa-leopoldina.vercel.app';
          }
          if (inputToken) {
            inputToken.value = res.leopoldina_sync_token || '';
          }
        } catch (err) {
          console.warn('[Leopoldina] Falha ao ler storage:', err);
        }
      } else {
        if (inputUrl) inputUrl.value = 'https://busca-ativa-leopoldina.vercel.app';
      }
    })();

    const salvarConfigs = async () => {
      if (chrome.storage && chrome.storage.local) {
        await chrome.storage.local.set({
          leopoldina_server_url: inputUrl?.value?.trim() || '',
          leopoldina_sync_token: inputToken?.value?.trim() || '',
        });
      }
    };

    inputUrl?.addEventListener('change', salvarConfigs);
    inputToken?.addEventListener('change', salvarConfigs);

    document.getElementById('leo-cfg-btn-vercel')?.addEventListener('click', () => {
      if (inputUrl) {
        inputUrl.value = 'https://busca-ativa-leopoldina.vercel.app';
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
  }

  function setStatus(msg, cor = '#64748b') {
    const el = document.getElementById('leo-status-msg');
    if (el) {
      el.textContent = msg;
      el.style.color = cor;
    }
  }

  function atualizarContadores() {
    const total = alunosCapturados.size;
    let risco = 0;
    let amparos = 0;
    let ganhando = 0;

    alunosCapturados.forEach(a => {
      const freqNum = parseFloat((a.mediaGeral || '').replace('%', '').replace(',', '.'));
      if (!isNaN(freqNum) && freqNum < 75) {
        risco++;
      }
      if (a.amparoLegalVigencia) {
        amparos++;
      }
      if (a.ganhandoMundo) {
        ganhando++;
      }
    });

    const badge = document.getElementById('leo-count-badge');
    if (badge) badge.textContent = `${total} alunos`;

    const pCount = document.getElementById('leo-panel-count');
    if (pCount) pCount.textContent = total;

    const pRisco = document.getElementById('leo-panel-risco');
    if (pRisco) pRisco.textContent = `${risco} alunos`;

    const pAmparo = document.getElementById('leo-panel-amparo');
    if (pAmparo) pAmparo.textContent = `${amparos} alunos`;

    const pGanhando = document.getElementById('leo-panel-ganhando');
    if (pGanhando) pGanhando.textContent = `${ganhando} alunos`;
  }

  // Palavras de interface e metadados a ignorar
  const IGNORAR_NOMES = [
    'selecionar linha', 'rolar para cima', 'rolar para baixo', 'varias selecoes',
    'todos', 'outros', 'memoria', 'amparo legal', 'deficiencia', 'ganhando mundo',
    'rede', 'nre', 'escola', 'turma', 'idade', 'media geral', 'presenca', 'semana atual',
    'semana anterior', 'ponta grossa', 'aluno', 'cgm', 'total', 'formatação condicional',
    'formatacao condicional', 'formatação condicional adicional', 'formatacao condicional adicional'
  ];

  // Identifica a posição das colunas no cabeçalho do Power BI
  // Identifica a posição das colunas no cabeçalho do Power BI (aria-colindex e coordenadas X)
  function detectarIndicesColunas() {
    const headerCandidates = Array.from(
      document.querySelectorAll('[role="columnheader"], .columnHeaders .headerCell, th, .headerRow .header')
    );

    const map = {
      turma: { ariaCol: 1, left: -1, right: -1, found: false },
      mediaGeral: { ariaCol: 2, left: -1, right: -1, found: false },
      semanaAtual: { ariaCol: 3, left: -1, right: -1, found: false },
      semanaAnterior: { ariaCol: 4, left: -1, right: -1, found: false },
      amparo: { ariaCol: 5, left: -1, right: -1, found: false },
      deficiencia: { ariaCol: 6, left: -1, right: -1, found: false },
      ganhando: { ariaCol: 7, left: -1, right: -1, found: false },
      serp: { ariaCol: 8, left: -1, right: -1, found: false },
      idade: { ariaCol: 9, left: -1, right: -1, found: false },
    };

    headerCandidates.forEach((h) => {
      const txt = (h.innerText || h.getAttribute('title') || '').toLowerCase().trim();
      if (!txt) return;

      const colAttr = h.getAttribute('aria-colindex') || h.closest('[aria-colindex]')?.getAttribute('aria-colindex');
      const parsedCol = colAttr ? parseInt(colAttr, 10) : null;
      const rect = h.getBoundingClientRect();

      const assign = (key, fallbackCol) => {
        if (parsedCol) {
          map[key].ariaCol = parsedCol;
        } else if (!map[key].found) {
          map[key].ariaCol = fallbackCol;
        }
        if (rect.width > 0) {
          map[key].left = rect.left;
          map[key].right = rect.right;
        }
        map[key].found = true;
      };

      if (txt.includes('ganhando')) {
        assign('ganhando', 7);
      } else if (txt.includes('deficiên') || txt.includes('deficien')) {
        assign('deficiencia', 6);
      } else if (txt.includes('amparo')) {
        assign('amparo', 5);
      } else if (txt.includes('serp')) {
        assign('serp', 8);
      } else if (txt.includes('idade')) {
        assign('idade', 9);
      } else if (txt.includes('semana atual')) {
        assign('semanaAtual', 3);
      } else if (txt.includes('semana anterior')) {
        assign('semanaAnterior', 4);
      } else if (txt.includes('média') || txt.includes('media')) {
        assign('mediaGeral', 2);
      } else if (txt.includes('turma')) {
        assign('turma', 1);
      }
    });

    return map;
  }

  // Extrai linhas visíveis da tabela
  function extrairLinhasVisiveis() {
    const cgmRegex = /\b10\d{8}\b/;
    const percentRegex = /\d{1,3}[,\.]\d{1,2}%/g;
    const dateRegex = /\b(\d{1,2}\/\d{1,2}\/\d{4})\b/;

    const colMap = detectarIndicesColunas();
    const rows = document.querySelectorAll('[role="row"], .row, .tr');
    let novos = 0;

    rows.forEach(r => {
      // Coleta textos visíveis e atributos title (que contêm o nome completo sem reticências!)
      const cellTitles = Array.from(r.querySelectorAll('[title]')).map(el => el.getAttribute('title') || '');
      const rawText = (r.innerText || '').replace(/\u00A0/g, ' ');
      const fullText = cellTitles.join('\n') + '\n' + rawText;

      const matchCgm = fullText.match(cgmRegex);

      if (matchCgm) {
        const cgm = matchCgm[0];
        const existente = alunosCapturados.get(cgm);

        const partes = fullText.split('\n').map(p => p.trim()).filter(Boolean);
        const percentuais = fullText.match(percentRegex) || [];

        // Células individuais da linha (desduplica nós aninhados)
        const allCells = Array.from(r.querySelectorAll('[role="gridcell"], .pivotTableCellWrap, .bodyCells, .cell, td'));
        const distinctCells = allCells.filter(c => !allCells.some(other => other !== c && other.contains(c)));

        // Helper para testar se uma célula pertence a uma coluna específica
        const isCellForCol = (c, colKey) => {
          const target = colMap[colKey];
          if (!target) return false;

          const cAria = c.getAttribute('aria-colindex') || c.closest('[aria-colindex]')?.getAttribute('aria-colindex');
          if (cAria) {
            const parsed = parseInt(cAria, 10);
            if (parsed === target.ariaCol) return true;
          }

          if (target.left > 0 && target.right > 0) {
            const rect = c.getBoundingClientRect();
            if (rect.width > 0) {
              const center = (rect.left + rect.right) / 2;
              if (center >= target.left - 6 && center <= target.right + 6) {
                return true;
              }
            }
          }
          return false;
        };

        // 1. Nome do Aluno
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

        // 2. Turma
        const turma = partes.find(p => 
          p.includes('Série') || p.includes('Serie') || 
          p.includes('Período') || p.includes('Periodo') || 
          p.includes('Manhã') || p.includes('Tarde') || p.includes('Noite') || p.includes('Sem Seriação')
        ) || (existente ? existente.turma : '');

        // 3. Amparo Legal Vigência Máx (Data DD/MM/AAAA)
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

        // 4. Deficiência / Altas Habilidades (1 ou vazio)
        let deficienciaAltasHabilidades = false;
        const defCell = distinctCells.find(c => isCellForCol(c, 'deficiencia'));
        if (defCell) {
          const txt = (defCell.innerText || defCell.getAttribute('title') || '').trim();
          if (txt === '1' || txt.toLowerCase() === 'sim') {
            deficienciaAltasHabilidades = true;
          }
        }

        // 5. Ganhando Mundo (Intercâmbio Internacional - 1 ou vazio)
        let ganhandoMundo = false;
        const ganhandoCell = distinctCells.find(c => isCellForCol(c, 'ganhando'));
        if (ganhandoCell) {
          const txt = (ganhandoCell.innerText || ganhandoCell.getAttribute('title') || '').trim();
          if (txt === '1' || txt.toLowerCase() === 'sim') {
            ganhandoMundo = true;
          }
        }

        // Heurística de Resolução para colunas com "1" (Deficiência vs Ganhando Mundo)
        distinctCells.forEach(c => {
          const txt = (c.innerText || c.getAttribute('title') || '').trim();
          if (txt === '1' || txt.toLowerCase() === 'sim') {
            const ariaLabel = (c.getAttribute('aria-label') || '').toLowerCase();
            const title = (c.getAttribute('title') || '').toLowerCase();

            if (ariaLabel.includes('ganhando') || title.includes('ganhando')) {
              ganhandoMundo = true;
            } else if (ariaLabel.includes('deficiên') || ariaLabel.includes('deficien') || title.includes('deficiên') || title.includes('deficien')) {
              deficienciaAltasHabilidades = true;
            } else if (colMap.ganhando.left > 0 && colMap.deficiencia.left > 0) {
              const cRect = c.getBoundingClientRect();
              if (cRect.width > 0) {
                const cMid = (cRect.left + cRect.right) / 2;
                const distDef = Math.abs(cMid - (colMap.deficiencia.left + colMap.deficiencia.right) / 2);
                const distGanhando = Math.abs(cMid - (colMap.ganhando.left + colMap.ganhando.right) / 2);
                if (distGanhando < distDef) {
                  ganhandoMundo = true;
                } else {
                  deficienciaAltasHabilidades = true;
                }
              }
            }
          }
        });

        // 6. SERP? (Checkmark ou ícone)
        let serpAtivo = false;
        const serpCell = distinctCells.find(c => isCellForCol(c, 'serp'));
        if (serpCell) {
          const txt = (serpCell.innerText || serpCell.getAttribute('title') || '').trim();
          const hasIcon = Boolean(serpCell.querySelector('svg, i, .check, [role="img"]'));
          if (hasIcon || /[✓✔√☑]/.test(txt) || txt.toLowerCase() === 'sim' || (serpCell.getAttribute('title') || '').toLowerCase().includes('sim')) {
            serpAtivo = true;
          }
        }

        if (!serpAtivo) {
          distinctCells.forEach(c => {
            const txt = (c.innerText || c.getAttribute('title') || '').trim();
            const title = (c.getAttribute('title') || '').toLowerCase();
            const ariaLabel = (c.getAttribute('aria-label') || '').toLowerCase();
            const hasIcon = Boolean(c.querySelector('svg, i, .check, [role="img"]'));
            if (
              /[✓✔√☑]/.test(txt) ||
              (hasIcon && (title.includes('serp') || ariaLabel.includes('serp'))) ||
              (title.includes('serp') && title.includes('sim')) ||
              (ariaLabel.includes('serp') && ariaLabel.includes('sim'))
            ) {
              serpAtivo = true;
            }
          });
        }

        // 7. IDADE (Inteiro entre 5 e 99)
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

        const aluno = {
          cgm: cgm,
          nome: nome,
          turma: turma,
          mediaGeral: percentuais[0] || existente?.mediaGeral || '',
          semanaAtual: percentuais[1] || existente?.semanaAtual || '',
          semanaAnterior: percentuais[2] || existente?.semanaAnterior || '',
          amparoLegalVigencia: amparoLegalVigencia || existente?.amparoLegalVigencia || null,
          deficienciaAltasHabilidades: deficienciaAltasHabilidades || existente?.deficienciaAltasHabilidades || false,
          ganhandoMundo: ganhandoMundo || existente?.ganhandoMundo || false,
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
          if (aluno.ganhandoMundo && !prev.ganhandoMundo) { prev.ganhandoMundo = true; mudou = true; }
          if (aluno.serpAtivo && !prev.serpAtivo) { prev.serpAtivo = true; mudou = true; }
          if (aluno.deficienciaAltasHabilidades && !prev.deficienciaAltasHabilidades) { prev.deficienciaAltasHabilidades = true; mudou = true; }
          if (aluno.amparoLegalVigencia && !prev.amparoLegalVigencia) { prev.amparoLegalVigencia = aluno.amparoLegalVigencia; mudou = true; }
          if (aluno.idade && !prev.idade) { prev.idade = aluno.idade; mudou = true; }
          if (aluno.mediaGeral && !prev.mediaGeral) { prev.mediaGeral = aluno.mediaGeral; mudou = true; }
          if (mudou) {
            alunosCapturados.set(cgm, prev);
          }
        }
      }
    });

    if (novos > 0) {
      atualizarContadores();
    }
    return novos;
  }

  // Rastreamento automático por rolagem suave (Auto-Scroll)
  async function iniciarAutoScroll() {
    if (isScrolling) {
      isScrolling = false;
      setStatus('Rastreamento pausado.');
      const btn = document.getElementById('leo-btn-autoscroll');
      if (btn) btn.innerHTML = '<span>⚡</span> Continuar Rastreamento';
      return;
    }

    const containers = Array.from(document.querySelectorAll('.innerContainer, [role="grid"], .mid-viewport, .tableEx, .bodyCells'));
    const scrollable = containers.find(el => el.scrollHeight > el.clientHeight);

    if (!scrollable) {
      extrairLinhasVisiveis();
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
      extrairLinhasVisiveis();
      setStatus(`Rastreando... ${alunosCapturados.size} alunos capturados.`, '#0284c7');

      if (alunosCapturados.size === ultimosAlunos) {
        semMudancas++;
      } else {
        semMudancas = 0;
        ultimosAlunos = alunosCapturados.size;
      }

      if (semMudancas >= 30) {
        break;
      }

      if (scrollable.scrollTop + scrollable.clientHeight >= scrollable.scrollHeight - 5) {
        await new Promise(r => setTimeout(r, 600));
        extrairLinhasVisiveis();
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

  // Salva no Chrome Storage Local
  function salvarNoStorage() {
    const lista = Array.from(alunosCapturados.values());
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ 'leopoldina_alunos_frequencia': lista });
    }
  }

  // Baixa CSV formatado para Excel
  function baixarCSV() {
    if (alunosCapturados.size === 0) {
      extrairLinhasVisiveis();
      if (alunosCapturados.size === 0) {
        alert('Nenhum dado capturado ainda. Clique em "Rastrear Tabela" primeiro!');
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
    link.setAttribute('download', `Frequencia_Leopoldina_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setStatus('Planilha CSV gerada e baixada!', '#10b981');
  }

  // Copia JSON para clipboard
  async function copiarJSON() {
    if (alunosCapturados.size === 0) {
      extrairLinhasVisiveis();
    }
    const lista = Array.from(alunosCapturados.values());
    try {
      await navigator.clipboard.writeText(JSON.stringify(lista, null, 2));
      setStatus(`JSON com ${lista.length} alunos copiado!`, '#10b981');
    } catch {
      setStatus('Erro ao copiar para clipboard.', '#ef4444');
    }
  }

  // Sincroniza diretamente com a Vercel (ou Localhost)
  async function sincronizarComSistema() {
    if (alunosCapturados.size === 0) {
      extrairLinhasVisiveis();
      if (alunosCapturados.size === 0) {
        alert('Nenhum aluno capturado ainda. Use o botão "Rastrear Tabela" primeiro.');
        return;
      }
    }

    const inputUrl = document.getElementById('leo-cfg-url');
    const inputToken = document.getElementById('leo-cfg-token');
    const baseUrl = (inputUrl?.value?.trim() || 'https://busca-ativa-leopoldina.vercel.app').replace(/\/+$/, '');
    const token = inputToken?.value?.trim() || '';

    if (!token) {
      const settingsBox = document.getElementById('leo-settings-box');
      if (settingsBox) settingsBox.open = true;
      if (inputToken) inputToken.focus();
      setStatus('⚠️ Cole a Chave de Sincronização (botão "Chave da Extensão" em /faltas).', '#f59e0b');
      return;
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
        let extras = [];
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
    } catch (e) {
      setStatus(`Não foi possível conectar em ${baseUrl}. Verifique a URL.`, '#ef4444');
      console.log('Dados prontos para exportação:', lista);
    }
  }

  // Inicializa quando a página estiver pronta
  window.addEventListener('load', () => {
    setTimeout(criarInterfaceFlutuante, 2000);
  });
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(criarInterfaceFlutuante, 1000);
  }

  let timeoutScroll = null;
  window.addEventListener('scroll', () => {
    if (timeoutScroll) clearTimeout(timeoutScroll);
    timeoutScroll = setTimeout(extrairLinhasVisiveis, 400);
  }, true);
})();
