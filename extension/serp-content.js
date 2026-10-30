// serp-content.js - Extrator de Fichas do SERP (Rede de Proteção - SEED-PR) com Auto-Paginação Resiliente e Logs
(function() {
  console.log('[SERP-SYNC] Módulo Leopoldina ativo em redeprotecao.seed.pr.gov.br');

  // Logs em memória para diagnóstico
  const logsExecucao = [];

  function addLog(msg, tipo = 'info') {
    const timestamp = new Date().toLocaleTimeString('pt-BR');
    const logItem = `[${timestamp}] ${msg}`;
    logsExecucao.push(logItem);
    console.log(`[SERP-LOG] ${logItem}`);

    const logBox = document.getElementById('leo-serp-log-box');
    if (logBox) {
      logBox.value = logsExecucao.slice(-30).join('\n');
      logBox.scrollTop = logBox.scrollHeight;
    }
  }

  // Mapa de fichas capturadas
  const fichasCapturadas = new Map();

  // Carrega fichas já salvas nesta sessão (garante que não perca dados se a página recarregar)
  function carregarDoSessionStorage() {
    try {
      const saved = sessionStorage.getItem('leo_serp_fichas_cache');
      if (saved) {
        const arr = JSON.parse(saved);
        arr.forEach(f => {
          const key = `${f.nome}_${f.turma}_${f.dataAbertura}`;
          fichasCapturadas.set(key, f);
        });
        addLog(`Recuperadas ${fichasCapturadas.size} fichas do cache da sessão.`);
      }
    } catch (e) {
      console.warn('Erro ao carregar cache do sessionStorage:', e);
    }
  }

  function salvarNoSessionStorage() {
    try {
      const arr = Array.from(fichasCapturadas.values());
      sessionStorage.setItem('leo_serp_fichas_cache', JSON.stringify(arr));
    } catch (e) {
      console.warn('Erro ao salvar no sessionStorage:', e);
    }
  }

  // Cria a interface flutuante no portal do SERP
  function criarInterfaceFlutuante() {
    if (document.getElementById('leo-serp-widget')) return;

    carregarDoSessionStorage();

    const container = document.createElement('div');
    container.id = 'leo-serp-widget';
    container.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 9999999;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    `;

    container.innerHTML = `
      <div id="leo-serp-pill" style="
        background: #7c3aed;
        color: white;
        padding: 10px 18px;
        border-radius: 9999px;
        box-shadow: 0 10px 25px -5px rgba(124, 58, 237, 0.5), 0 8px 10px -6px rgba(124, 58, 237, 0.3);
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 10px;
        font-weight: 700;
        font-size: 13px;
        border: 2px solid #a78bfa;
        user-select: none;
      ">
        <span style="font-size: 18px;">🛡️</span>
        <span>SERP Leopoldina</span>
        <span id="leo-serp-badge" style="
          background: #5b21b6;
          padding: 2px 8px;
          border-radius: 999px;
          font-size: 11px;
        ">${fichasCapturadas.size} fichas</span>
      </div>

      <div id="leo-serp-panel" style="
        display: none;
        position: absolute;
        bottom: 58px;
        right: 0;
        width: 380px;
        background: white;
        border-radius: 16px;
        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
        border: 1px solid #e2e8f0;
        overflow: hidden;
      ">
        <div style="
          background: linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%);
          color: white;
          padding: 14px 16px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        ">
          <div>
            <div style="font-weight: 800; font-size: 14px; display: flex; align-items: center; gap: 6px;">
              <span>🛡️</span> SERP • Rede de Proteção
            </div>
            <div style="font-size: 11px; opacity: 0.9; margin-top: 2px;">
              Colégio Estadual Leopoldina B. Pedroso
            </div>
          </div>
          <button id="leo-serp-close-btn" style="
            background: rgba(255, 255, 255, 0.2);
            border: none;
            color: white;
            width: 26px;
            height: 26px;
            border-radius: 50%;
            cursor: pointer;
            font-weight: bold;
          ">&times;</button>
        </div>

        <div style="padding: 16px;">
          <div style="
            display: flex;
            justify-content: space-between;
            background: #f5f3ff;
            border: 1px solid #ddd6fe;
            padding: 10px 14px;
            border-radius: 10px;
            margin-bottom: 12px;
            font-size: 12px;
          ">
            <div>
              <span style="color: #6d28d9; display: block; font-size: 11px; font-weight: 600;">Total Armazenado</span>
              <strong id="leo-serp-count" style="font-size: 18px; color: #4c1d95;">${fichasCapturadas.size}</strong>
            </div>
            <div style="text-align: right;">
              <span style="color: #6d28d9; display: block; font-size: 11px; font-weight: 600;">Conselho Tutelar (CT)</span>
              <strong id="leo-serp-ct-count" style="font-size: 18px; color: #dc2626;">0</strong>
            </div>
          </div>

          <div style="display: flex; flex-direction: column; gap: 8px;">
            <button id="leo-serp-btn-auto-all" style="
              background: #7c3aed;
              color: white;
              border: none;
              padding: 10px;
              border-radius: 8px;
              font-weight: 700;
              font-size: 13px;
              cursor: pointer;
              display: flex;
              align-items: center;
              justify-content: center;
              gap: 8px;
              box-shadow: 0 2px 4px rgba(124, 58, 237, 0.3);
            ">
              <span>⚡</span> Rastrear Todas as Páginas (Auto-Next)
            </button>

            <div style="display: flex; gap: 6px;">
              <button id="leo-serp-btn-scan" style="
                flex: 1;
                background: #ede9fe;
                color: #5b21b6;
                border: 1px solid #c4b5fd;
                padding: 8px;
                border-radius: 8px;
                font-weight: 600;
                font-size: 11px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 4px;
              ">
                <span>📄</span> Página Atual
              </button>

              <button id="leo-serp-btn-clear" style="
                background: #f1f5f9;
                color: #64748b;
                border: 1px solid #cbd5e1;
                padding: 8px 12px;
                border-radius: 8px;
                font-weight: 600;
                font-size: 11px;
                cursor: pointer;
              ">
                Limpar
              </button>
            </div>

            <button id="leo-serp-btn-download-csv" style="
              background: #10b981;
              color: white;
              border: none;
              padding: 9px;
              border-radius: 8px;
              font-weight: 600;
              font-size: 12px;
              cursor: pointer;
              display: flex;
              align-items: center;
              justify-content: center;
              gap: 6px;
            ">
              <span>📥</span> Baixar Relatório SERP (.CSV)
            </button>

            <button id="leo-serp-btn-copy-json" style="
              background: #f8fafc;
              color: #334155;
              border: 1px solid #cbd5e1;
              padding: 8px;
              border-radius: 8px;
              font-weight: 600;
              font-size: 12px;
              cursor: pointer;
              display: flex;
              align-items: center;
              justify-content: center;
              gap: 6px;
            ">
              <span>📋</span> Copiar JSON das Fichas
            </button>

            <button id="leo-serp-btn-sync" style="
              background: #4f46e5;
              color: white;
              border: none;
              padding: 10px;
              border-radius: 8px;
              font-weight: 700;
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

          <!-- Console de Logs Integrado -->
          <details open style="margin-top: 10px; font-size: 11px; color: #475569; background: #0f172a; padding: 8px; border-radius: 8px; border: 1px solid #334155;">
            <summary style="cursor: pointer; font-weight: 700; color: #38bdf8; display: flex; justify-content: space-between; align-items: center;">
              <span>📜 Console de Execução & Logs</span>
              <span id="leo-serp-btn-copy-log" style="color: #94a3b8; font-size: 10px; text-decoration: underline;">Copiar Logs</span>
            </summary>
            <textarea id="leo-serp-log-box" readonly rows="5" style="
              width: 100%;
              box-sizing: border-box;
              margin-top: 6px;
              padding: 6px;
              background: #020617;
              color: #a5f3fc;
              border: 1px solid #1e293b;
              border-radius: 6px;
              font-family: monospace;
              font-size: 10px;
              line-height: 1.4;
              resize: none;
            "></textarea>
          </details>

          <details style="margin-top: 8px; font-size: 11px; color: #475569; background: #f8fafc; padding: 8px; border-radius: 8px; border: 1px solid #e2e8f0;">
            <summary style="cursor: pointer; font-weight: 600; color: #334155;">⚙️ Configuração de Envio (Vercel)</summary>
            <div style="margin-top: 8px; display: flex; flex-direction: column; gap: 6px;">
              <div>
                <label style="display: block; font-weight: 600; margin-bottom: 2px;">URL do Servidor:</label>
                <input id="leo-serp-cfg-url" type="text" value="https://busca-ativa-leopoldina.vercel.app" style="width: 100%; box-sizing: border-box; padding: 4px 6px; font-size: 11px; border: 1px solid #cbd5e1; border-radius: 4px; font-family: monospace;" />
              </div>
              <div>
                <label style="display: block; font-weight: 600; margin-bottom: 2px;">Chave de Sincronização:</label>
                <input id="leo-serp-cfg-token" type="password" value="leopoldina-frequencia-2026-secret-sync" style="width: 100%; box-sizing: border-box; padding: 4px 6px; font-size: 11px; border: 1px solid #cbd5e1; border-radius: 4px;" />
              </div>
            </div>
          </details>

          <div id="leo-serp-status" style="
            margin-top: 10px;
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

    // Eventos
    const pill = document.getElementById('leo-serp-pill');
    const panel = document.getElementById('leo-serp-panel');
    const closeBtn = document.getElementById('leo-serp-close-btn');

    pill.addEventListener('click', () => {
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
      if (panel.style.display === 'block') {
        extrairFichasDaTela(false);
      }
    });

    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.style.display = 'none';
    });

    // Copiar logs
    document.getElementById('leo-serp-btn-copy-log')?.addEventListener('click', (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(logsExecucao.join('\n')).then(() => {
        setStatus('Logs copiados para o clipboard!', '#10b981');
      });
    });

    // Limpar cache
    document.getElementById('leo-serp-btn-clear')?.addEventListener('click', () => {
      fichasCapturadas.clear();
      sessionStorage.removeItem('leo_serp_fichas_cache');
      sessionStorage.removeItem('leo_serp_autopaging');
      atualizarContadores();
      addLog('Memória e cache local limpos.');
      setStatus('Dados locais limpos.', '#64748b');
    });

    // Carrega configs salvas
    const inputUrl = document.getElementById('leo-serp-cfg-url');
    const inputToken = document.getElementById('leo-serp-cfg-token');
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['leopoldina_server_url', 'leopoldina_sync_token'], (res) => {
        if (inputUrl && res.leopoldina_server_url) inputUrl.value = res.leopoldina_server_url;
        if (inputToken && res.leopoldina_sync_token) inputToken.value = res.leopoldina_sync_token;
      });
    }

    const salvarConfigs = () => {
      if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({
          leopoldina_server_url: inputUrl?.value?.trim() || '',
          leopoldina_sync_token: inputToken?.value?.trim() || '',
        });
      }
    };
    inputUrl?.addEventListener('change', salvarConfigs);
    inputToken?.addEventListener('change', salvarConfigs);

    document.getElementById('leo-serp-btn-auto-all').addEventListener('click', iniciarOuPararAutoPaginacao);
    document.getElementById('leo-serp-btn-scan').addEventListener('click', () => extrairFichasDaTela(true));
    document.getElementById('leo-serp-btn-download-csv').addEventListener('click', baixarCSV);
    document.getElementById('leo-serp-btn-copy-json').addEventListener('click', copiarJSON);
    document.getElementById('leo-serp-btn-sync').addEventListener('click', sincronizarComVercel);

    atualizarContadores();
    addLog('Interface SERP Leopoldina carregada.');

    // Se estiver em modo de autopaginação após recarregar a página, continua!
    verificarContinuacaoAutoPaginacao();
  }

  function setStatus(msg, cor = '#64748b') {
    const el = document.getElementById('leo-serp-status');
    if (el) {
      el.textContent = msg;
      el.style.color = cor;
    }
  }

  function atualizarContadores() {
    const total = fichasCapturadas.size;
    let ct = 0;
    fichasCapturadas.forEach((f) => {
      const s = (f.status || '').toUpperCase();
      if (s.includes('CONSELHO') || s.includes('CT')) ct++;
    });

    const badge = document.getElementById('leo-serp-badge');
    if (badge) badge.textContent = `${total} fichas`;

    const countEl = document.getElementById('leo-serp-count');
    if (countEl) countEl.textContent = total;

    const ctEl = document.getElementById('leo-serp-ct-count');
    if (ctEl) ctEl.textContent = ct;
  }

  // Detecta o texto de paginação atual na tela (ex: "Página 1 de 12 : (Total de 119 registros)")
  function detectarInfoPaginacao() {
    const fullText = document.body.innerText;
    const match = fullText.match(/Página\s+(\d+)\s+de\s+(\d+)/i);
    if (match) {
      return {
        atual: parseInt(match[1], 10),
        total: parseInt(match[2], 10),
      };
    }
    return { atual: null, total: null };
  }

  // Extrai com precisão cirúrgica a tabela de fichas da tela atual
  function extrairFichasDaTela(mostrarAlerta = false) {
    const pageInfo = detectarInfoPaginacao();
    addLog(`Iniciando extração na Página ${pageInfo.atual || '?'}/${pageInfo.total || '?'}`);

    const tables = document.querySelectorAll('table');
    let tabelaAlunos = null;

    tables.forEach(t => {
      const txt = (t.innerText || '').toLowerCase();
      if (txt.includes('turma') && txt.includes('aberto em') && txt.includes('situa')) {
        tabelaAlunos = t;
      }
    });

    if (!tabelaAlunos) {
      let maxRows = 0;
      tables.forEach(t => {
        const rows = t.querySelectorAll('tr');
        if (rows.length > maxRows) {
          maxRows = rows.length;
          tabelaAlunos = t;
        }
      });
    }

    if (!tabelaAlunos) {
      addLog('ERRO: Nenhuma tabela de infrequência localizada no DOM!', 'error');
      if (mostrarAlerta) setStatus('Nenhuma tabela localizada.', '#ef4444');
      return { novos: 0, primeiraLinhaId: '' };
    }

    // Mapeamento dos cabeçalhos
    const headerRow = tabelaAlunos.querySelector('tr:has(th)') || tabelaAlunos.querySelector('tr');
    let idxNome = 5;
    let idxTurma = 4;
    let idxAberto = 6;
    let idxEncerrado = 7;
    let idxSituacao = 8;

    if (headerRow) {
      const headers = Array.from(headerRow.querySelectorAll('th, td')).map(el => el.innerText.trim().toLowerCase());
      headers.forEach((h, i) => {
        if (h === 'nome' || (h.includes('nome') && !h.includes('estabelecimento'))) idxNome = i;
        else if (h.includes('turma')) idxTurma = i;
        else if (h.includes('aberto')) idxAberto = i;
        else if (h.includes('encerrado')) idxEncerrado = i;
        else if (h.includes('situa')) idxSituacao = i;
      });
    }

    const rows = tabelaAlunos.querySelectorAll('tr');
    let novos = 0;
    let primeiraLinhaId = '';

    rows.forEach((r) => {
      const cells = Array.from(r.querySelectorAll('td'));
      if (cells.length < 5) return;

      const rawNome = (cells[idxNome]?.innerText || '').replace(/\u00A0/g, ' ').trim();
      const rawTurma = (cells[idxTurma]?.innerText || '').replace(/\u00A0/g, ' ').trim();
      const rawAberto = (cells[idxAberto]?.innerText || '').replace(/\u00A0/g, ' ').trim();
      const rawEncerrado = (cells[idxEncerrado]?.innerText || '').replace(/\u00A0/g, ' ').trim();
      const rawSituacao = (cells[idxSituacao]?.innerText || '').replace(/\u00A0/g, ' ').trim();

      if (rawNome.toLowerCase() === 'nome' || rawTurma.toLowerCase() === 'turma') return;
      if (!rawNome || rawNome.length < 3) return;

      if (!primeiraLinhaId) {
        primeiraLinhaId = `${rawNome}_${rawTurma}_${rawAberto}`;
      }

      // Normaliza status
      let statusEnum = 'EM_ACOMPANHAMENTO';
      const situacaoUpper = rawSituacao.toUpperCase();
      if (situacaoUpper.includes('CONSELHO') || situacaoUpper.includes('CT')) {
        statusEnum = 'CONSELHO_TUTELAR';
      } else if (situacaoUpper.includes('MINIST') || situacaoUpper.includes('MP')) {
        statusEnum = 'MINISTERIO_PUBLICO';
      } else if (situacaoUpper.includes('ENCERRADO') || situacaoUpper.includes('ARQUIV')) {
        statusEnum = 'ARQUIVADO';
      }

      // Procura ID nos links
      let numeroFicha = '';
      const allLinks = r.querySelectorAll('a, button, img, [onclick]');
      allLinks.forEach(el => {
        const fullAttr = (el.getAttribute('href') || '') + ' ' + (el.getAttribute('onclick') || '') + ' ' + (el.getAttribute('title') || '');
        const matchId = fullAttr.match(/\b\d{5,9}\b/);
        if (matchId && !numeroFicha) numeroFicha = matchId[0];
      });

      // Procura CGM
      let cgm = '';
      const matchCgm = (r.innerText || '').match(/\b10\d{8}\b/);
      if (matchCgm) cgm = matchCgm[0];

      const key = `${rawNome}_${rawTurma}_${rawAberto}`;

      if (!fichasCapturadas.has(key)) {
        novos++;
      }

      fichasCapturadas.set(key, {
        cgm,
        nome: rawNome,
        turma: rawTurma,
        dataAbertura: rawAberto,
        dataEncerramento: rawEncerrado,
        situacao: rawSituacao,
        status: statusEnum,
        numeroFicha,
        acoesRealizadas: `Situação: ${rawSituacao} | Turma: ${rawTurma} | Aberto em: ${rawAberto}${rawEncerrado ? ' | Encerrado em: ' + rawEncerrado : ''}`,
        capturadoEm: new Date().toISOString(),
      });
    });

    salvarNoSessionStorage();
    atualizarContadores();

    addLog(`Página extraída: +${novos} novas fichas adicionadas. Total acumulado: ${fichasCapturadas.size}.`);
    if (mostrarAlerta) {
      setStatus(`Capturados ${fichasCapturadas.size} alunos (+${novos} novos).`, '#7c3aed');
    }

    return { novos, primeiraLinhaId };
  }

  // Localiza com inteligência o elemento "Próxima"
  function encontrarBotaoProxima() {
    const candidates = Array.from(document.querySelectorAll('a, button, span, img, input[type="button"], input[type="submit"]'));
    
    for (const el of candidates) {
      const txt = (el.innerText || '').trim().toLowerCase();
      const title = (el.getAttribute('title') || '').toLowerCase();
      const alt = (el.getAttribute('alt') || '').toLowerCase();
      const value = (el.getAttribute('value') || '').toLowerCase();
      const href = (el.getAttribute('href') || '').toLowerCase();

      // Verifica se é o link 'Próxima'
      if (
        txt === 'próxima' || txt === 'proxima' ||
        title === 'próxima' || title === 'proxima' ||
        alt === 'próxima' || alt === 'proxima' ||
        value === 'próxima' || value === 'proxima' ||
        (txt.includes('próxima') && !txt.includes('página anterior'))
      ) {
        addLog(`Botão 'Próxima' identificado: tag=<${el.tagName}> texto="${txt}" href="${href || 'none'}"`);
        return el;
      }
    }

    addLog('Aviso: Botão "Próxima" não encontrado (provavelmente última página).');
    return null;
  }

  // Escuta confirmações da ponte nativa (Main World)
  window.addEventListener('LEO_SERP_BRIDGE_READY', (e) => {
    addLog(`Ponte nativa conectada ao SERP! (window.paginar: ${e.detail?.hasPaginar ? 'OK' : 'Pendente'})`);
  });

  window.addEventListener('LEO_SERP_BRIDGE_EXECUTADO', (e) => {
    const d = e.detail || {};
    if (d.sucesso) {
      addLog(`[PONTE] Navegação executada com sucesso via: ${d.metodo}`);
    } else {
      addLog(`[PONTE] Erro na execução: ${d.erro}`, 'error');
    }
  });

  // Executa código JavaScript diretamente no contexto principal da página (Main World)
  function executarScriptNoMundoPrincipal(codigo) {
    try {
      const script = document.createElement('script');
      script.textContent = codigo;
      (document.head || document.documentElement).appendChild(script);
      script.remove();
      addLog(`[INJEÇÃO NATIVA] Enviado ao DOM: ${codigo}`);
    } catch (e) {
      addLog(`Erro ao injetar script: ${e.message}`, 'error');
    }
  }

  // Dispara a navegação para a próxima página utilizando a ponte nativa e injeção
  function dispararNavegacao(el, proximaPaginaAlvo, totalRegistros) {
    const href = (el?.getAttribute('href') || '').trim();
    const onclick = (el?.getAttribute('onclick') || '').trim();
    const fullAttr = href + ' ' + onclick;

    let scriptCode = '';
    const matchPaginar = fullAttr.match(/paginar\((\d+),\s*(\d+)\)/i);
    if (matchPaginar) {
      scriptCode = `paginar(${matchPaginar[1]}, ${matchPaginar[2]});`;
    } else if (href.toLowerCase().startsWith('javascript:')) {
      scriptCode = href.substring(11).trim();
    } else if (onclick) {
      scriptCode = onclick;
    } else if (proximaPaginaAlvo) {
      scriptCode = `paginar(${proximaPaginaAlvo}, ${totalRegistros || 119});`;
    }

    addLog(`Disparando comando de navegação para página ${proximaPaginaAlvo}: ${scriptCode}`);

    // Dispara via Ponte Nativa (Main World)
    window.dispatchEvent(new CustomEvent('LEO_SERP_NATIVE_PAGINAR', {
      detail: {
        pagina: proximaPaginaAlvo,
        total: totalRegistros || 119,
        scriptCode: scriptCode
      }
    }));

    // Dispara também via injeção no DOM como contingência
    if (scriptCode) {
      executarScriptNoMundoPrincipal(scriptCode);
    }

    // E tenta o clique simulado no elemento
    if (el) {
      try {
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
        el.click();
      } catch (e) {}
    }
  }

  // Iniciar ou Parar Auto-Paginação
  async function iniciarOuPararAutoPaginacao() {
    const isAtivo = sessionStorage.getItem('leo_serp_autopaging') === 'true';

    if (isAtivo) {
      sessionStorage.removeItem('leo_serp_autopaging');
      const btn = document.getElementById('leo-serp-btn-auto-all');
      if (btn) btn.innerHTML = '<span>⚡</span> Rastrear Todas as Páginas (Auto-Next)';
      addLog('Auto-paginação interrompida pelo usuário.');
      setStatus('Auto-paginação interrompida.', '#eab308');
      return;
    }

    sessionStorage.setItem('leo_serp_autopaging', 'true');
    const btn = document.getElementById('leo-serp-btn-auto-all');
    if (btn) btn.innerHTML = '<span>⏹️</span> Parar Auto-Paginação';

    addLog('=== INICIANDO AUTO-PAGINAÇÃO COMPLETA ===');
    executarPassoAutoPaginacao();
  }

  // Executa um passo do ciclo de paginação
  async function executarPassoAutoPaginacao() {
    const pageInfo = detectarInfoPaginacao();
    const btn = document.getElementById('leo-serp-btn-auto-all');
    if (btn) btn.innerHTML = '<span>⏹️</span> Parar Auto-Paginação';

    // 1. Extrai a página atual
    const { novos, primeiraLinhaId } = extrairFichasDaTela(false);
    setStatus(`Pág. ${pageInfo.atual || '?'}/${pageInfo.total || '?'}: ${fichasCapturadas.size} fichas coletadas.`, '#7c3aed');

    // 2. Se já estiver na última página
    if (pageInfo.atual && pageInfo.total && pageInfo.atual >= pageInfo.total) {
      finalizarAutoPaginacao('Chegou à última página da listagem.');
      return;
    }

    // 3. Busca o botão Próxima
    const nextBtn = encontrarBotaoProxima();
    if (!nextBtn) {
      finalizarAutoPaginacao('Nenhum botão "Próxima" disponível.');
      return;
    }

    const proximaPag = (pageInfo.atual || 1) + 1;
    addLog(`Navegando para página ${proximaPag}...`);
    dispararNavegacao(nextBtn, proximaPag, 119);

    // 4. Aguarda a transição de página
    let mudou = false;
    const inicio = Date.now();
    const firstRowEl = document.querySelector('table tr:not(:has(th))');
    const initialRowText = (firstRowEl?.innerText || '').trim();

    while (Date.now() - inicio < 7000) {
      await new Promise(r => setTimeout(r, 500));
      
      const newPageInfo = detectarInfoPaginacao();
      if (pageInfo.atual && newPageInfo.atual && newPageInfo.atual !== pageInfo.atual) {
        addLog(`Transição detectada: Página mudou para ${newPageInfo.atual}!`);
        mudou = true;
        break;
      }

      const currentRowEl = document.querySelector('table tr:not(:has(th))');
      const currentRowText = (currentRowEl?.innerText || '').trim();
      if (currentRowText && currentRowText !== initialRowText) {
        addLog(`Transição detectada: Registros da tabela foram atualizados!`);
        mudou = true;
        break;
      }
    }

    if (sessionStorage.getItem('leo_serp_autopaging') === 'true') {
      if (mudou) {
        await new Promise(r => setTimeout(r, 600)); // Pequena pausa para estabilização
        executarPassoAutoPaginacao();
      } else {
        addLog('Aviso: A página não respondeu em 7 segundos. Tentando finalizar.');
        finalizarAutoPaginacao('Tempo limite esgotado sem mudança de página.');
      }
    }
  }

  function finalizarAutoPaginacao(motivo) {
    sessionStorage.removeItem('leo_serp_autopaging');
    const btn = document.getElementById('leo-serp-btn-auto-all');
    if (btn) btn.innerHTML = '<span>⚡</span> Rastrear Todas as Páginas (Auto-Next)';
    
    addLog(`=== AUTO-PAGINAÇÃO FINALIZADA === (${motivo})`);
    addLog(`Total final: ${fichasCapturadas.size} fichas armazenadas.`);
    setStatus(`Finalizado! ${fichasCapturadas.size} fichas coletadas no total.`, '#10b981');
  }

  // Verifica se o navegador recarregou enquanto estava em modo autopaging
  function verificarContinuacaoAutoPaginacao() {
    if (sessionStorage.getItem('leo_serp_autopaging') === 'true') {
      addLog('Retomando auto-paginação após recarregamento de página...');
      const panel = document.getElementById('leo-serp-panel');
      if (panel) panel.style.display = 'block';
      setTimeout(executarPassoAutoPaginacao, 1200);
    }
  }

  // Baixar CSV
  function baixarCSV() {
    if (fichasCapturadas.size === 0) {
      extrairFichasDaTela(true);
      if (fichasCapturadas.size === 0) {
        alert('Nenhuma ficha capturada ainda.');
        return;
      }
    }

    const headers = ['CGM', 'Nome', 'Turma', 'Status_SERP', 'Situacao_Oficial', 'Data_Abertura', 'Data_Encerramento', 'Numero_Ficha'];
    const rows = [headers.join(';')];

    fichasCapturadas.forEach((f) => {
      rows.push([
        `"${f.cgm || ''}"`,
        `"${(f.nome || '').replace(/"/g, '""')}"`,
        `"${(f.turma || '').replace(/"/g, '""')}"`,
        `"${f.status}"`,
        `"${(f.situacao || '').replace(/"/g, '""')}"`,
        `"${f.dataAbertura || ''}"`,
        `"${f.dataEncerramento || ''}"`,
        `"${f.numeroFicha || ''}"`
      ].join(';'));
    });

    const csvContent = '\uFEFF' + rows.join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Fichas_SERP_Leopoldina_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    addLog('Arquivo CSV gerado e baixado.');
    setStatus('Planilha de Fichas SERP gerada e baixada!', '#10b981');
  }

  // Copiar JSON
  function copiarJSON() {
    if (fichasCapturadas.size === 0) {
      extrairFichasDaTela(true);
    }
    const lista = Array.from(fichasCapturadas.values());
    navigator.clipboard.writeText(JSON.stringify({ fichas: lista }, null, 2)).then(() => {
      addLog(`JSON com ${lista.length} fichas copiado para o clipboard.`);
      setStatus(`JSON com ${lista.length} fichas copiado!`, '#10b981');
    }).catch(() => {
      setStatus('Erro ao copiar para clipboard.', '#ef4444');
    });
  }

  // Sincronizar com a Vercel
  async function sincronizarComVercel() {
    if (fichasCapturadas.size === 0) {
      extrairFichasDaTela(true);
      if (fichasCapturadas.size === 0) {
        alert('Nenhuma ficha capturada para sincronizar.');
        return;
      }
    }

    const inputUrl = document.getElementById('leo-serp-cfg-url');
    const inputToken = document.getElementById('leo-serp-cfg-token');
    const baseUrl = (inputUrl?.value?.trim() || 'https://busca-ativa-leopoldina.vercel.app').replace(/\/+$/, '');
    const token = inputToken?.value?.trim() || 'leopoldina-frequencia-2026-secret-sync';

    const lista = Array.from(fichasCapturadas.values());
    setStatus(`Enviando ${lista.length} fichas para ${baseUrl}...`, '#6d28d9');
    addLog(`Disparando POST com ${lista.length} fichas para ${baseUrl}/api/serp/sync`);

    try {
      const resp = await fetch(`${baseUrl}/api/serp/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ fichas: lista })
      });

      if (resp.ok) {
        const resJson = await resp.json();
        const atualizados = resJson.atualizados ?? lista.length;
        const ct = resJson.conselhoTutelarCount ?? 0;
        addLog(`Sucesso no servidor: ${atualizados} fichas atualizadas (${ct} Conselho Tutelar).`);
        setStatus(`🚀 Vercel: ${atualizados} fichas atualizadas (${ct} Conselho Tutelar)!`, '#10b981');
      } else if (resp.status === 401) {
        addLog('Erro 401: Chave de API inválida na Vercel.', 'error');
        setStatus(`❌ Erro 401: Chave de Sincronização inválida na Vercel.`, '#ef4444');
      } else {
        const errJson = await resp.json().catch(() => ({}));
        addLog(`Erro HTTP ${resp.status}: ${errJson.error || ''}`, 'error');
        setStatus(`Erro no servidor: ${errJson.error || ('HTTP ' + resp.status)}`, '#ef4444');
      }
    } catch (e) {
      addLog(`Falha de conexão com ${baseUrl}: ${e.message}`, 'error');
      setStatus(`Não foi possível conectar em ${baseUrl}.`, '#ef4444');
    }
  }

  // Inicializa quando a página estiver carregada
  window.addEventListener('load', () => {
    setTimeout(criarInterfaceFlutuante, 1200);
  });
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(criarInterfaceFlutuante, 600);
  }
})();
