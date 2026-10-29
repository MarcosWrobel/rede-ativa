// serp-content.js - Extrator de Fichas do SERP (Rede de Proteção - SEED-PR)
(function() {
  console.log('[SERP-SYNC] Extensão Leopoldina ativada no Sistema da Rede de Proteção (SERP)!');

  const fichasCapturadas = new Map(); // cgm ou nome -> objeto da ficha

  // Cria a interface flutuante no portal do SERP
  function criarInterfaceFlutuante() {
    if (document.getElementById('leo-serp-widget')) return;

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
        ">0 fichas</span>
      </div>

      <div id="leo-serp-panel" style="
        display: none;
        position: absolute;
        bottom: 58px;
        right: 0;
        width: 350px;
        background: white;
        border-radius: 16px;
        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
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
            <div style="font-weight: 800; font-size: 14px; display: flex; items-center; gap: 6px;">
              <span>🛡️</span> SERP • Rede de Proteção
            </div>
            <div style="font-size: 11px; opacity: 0.9; margin-top: 2px;">
              Sincronizador Oficial Leopoldina
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
            margin-bottom: 14px;
            font-size: 12px;
          ">
            <div>
              <span style="color: #6d28d9; display: block; font-size: 11px; font-weight: 600;">Fichas Capturadas</span>
              <strong id="leo-serp-count" style="font-size: 18px; color: #4c1d95;">0</strong>
            </div>
            <div style="text-align: right;">
              <span style="color: #6d28d9; display: block; font-size: 11px; font-weight: 600;">Conselho Tutelar</span>
              <strong id="leo-serp-ct-count" style="font-size: 18px; color: #b91c1c;">0</strong>
            </div>
          </div>

          <div style="display: flex; flex-direction: column; gap: 8px;">
            <button id="leo-serp-btn-scan" style="
              background: #7c3aed;
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
              <span>⚡</span> Rastrear Fichas nesta Tela
            </button>

            <button id="leo-serp-btn-download-csv" style="
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
              <span>📥</span> Baixar Relatório SERP (.CSV)
            </button>

            <button id="leo-serp-btn-copy-json" style="
              background: #f8fafc;
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
              <span>📋</span> Copiar JSON das Fichas
            </button>

            <button id="leo-serp-btn-sync" style="
              background: #4f46e5;
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

          <details style="margin-top: 10px; font-size: 11px; color: #475569; background: #f8fafc; padding: 8px; border-radius: 8px; border: 1px solid #e2e8f0;">
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

    // Eventos
    const pill = document.getElementById('leo-serp-pill');
    const panel = document.getElementById('leo-serp-panel');
    const closeBtn = document.getElementById('leo-serp-close-btn');

    pill.addEventListener('click', () => {
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
      if (panel.style.display === 'block') {
        extrairFichasDaTela();
      }
    });

    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.style.display = 'none';
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

    document.getElementById('leo-serp-btn-scan').addEventListener('click', extrairFichasDaTela);
    document.getElementById('leo-serp-btn-download-csv').addEventListener('click', baixarCSV);
    document.getElementById('leo-serp-btn-copy-json').addEventListener('click', copiarJSON);
    document.getElementById('leo-serp-btn-sync').addEventListener('click', sincronizarComVercel);
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

  // Extrai as tabelas de fichas abertas do SERP
  function extrairFichasDaTela() {
    const cgmRegex = /\b10\d{8}\b/;
    const dateRegex = /\b\d{2}\/\d{2}\/\d{4}\b/;
    const rows = document.querySelectorAll('table tr, tbody tr, .ui-datatable-data tr, .tabela-alunos tr');

    let novos = 0;

    rows.forEach((r) => {
      const text = (r.innerText || '').replace(/\u00A0/g, ' ').trim();
      if (!text || text.length < 5) return;

      const cells = Array.from(r.querySelectorAll('td, th')).map((c) => c.innerText.trim());
      const fullRowText = cells.join(' | ');

      // Tenta achar CGM na linha
      const matchCgm = fullRowText.match(cgmRegex);
      const cgm = matchCgm ? matchCgm[0] : '';

      // Tenta achar data
      const matchDate = fullRowText.match(dateRegex);
      const dataAbertura = matchDate ? matchDate[0] : '';

      // Tenta achar nome: textos em maiúsculas sem ser cabeçalho
      let nome = '';
      for (const c of cells) {
        if (/^[A-ZÁÉÍÓÚÀÂÊÔÃÕÇ\s\.\']{5,}$/.test(c) && !c.includes('ESTUDANTE') && !c.includes('ALUNO') && !c.includes('PARANÁ')) {
          nome = c;
          break;
        }
      }

      // Tenta achar situação/status (Conselho Tutelar, Em Acompanhamento, Ministério Público, etc.)
      let status = 'EM_ACOMPANHAMENTO';
      const upper = fullRowText.toUpperCase();
      if (upper.includes('CONSELHO') || upper.includes('CT')) {
        status = 'CONSELHO_TUTELAR';
      } else if (upper.includes('MINIST') || upper.includes('PROMOTOR') || upper.includes('MP')) {
        status = 'MINISTERIO_PUBLICO';
      } else if (upper.includes('ARQUIV') || upper.includes('NORMALIZ')) {
        status = 'ARQUIVADO';
      }

      // Protocolo da ficha
      const matchFicha = fullRowText.match(/\b\d{4,8}\/\d{4}\b|\b\d{5,8}\b/);
      const numeroFicha = matchFicha ? matchFicha[0] : '';

      // Se temos ao menos um CGM ou um Nome válido
      if (cgm || (nome && nome.length > 5)) {
        const key = cgm || nome;
        if (!fichasCapturadas.has(key)) {
          novos++;
        }

        fichasCapturadas.set(key, {
          cgm,
          nome,
          numeroFicha,
          status,
          dataAbertura,
          acoesRealizadas: fullRowText,
          capturadoEm: new Date().toISOString(),
        });
      }
    });

    atualizarContadores();
    if (fichasCapturadas.size > 0) {
      setStatus(`Varredura concluída: ${fichasCapturadas.size} fichas armazenadas (+${novos} novas).`, '#7c3aed');
    } else {
      setStatus('Nenhuma ficha detectada na tela atual. Navegue até a lista de fichas.', '#eab308');
    }
  }

  // Baixar CSV
  function baixarCSV() {
    if (fichasCapturadas.size === 0) {
      extrairFichasDaTela();
      if (fichasCapturadas.size === 0) {
        alert('Nenhuma ficha capturada ainda.');
        return;
      }
    }

    const headers = ['CGM', 'Nome', 'Numero_Ficha', 'Status_SERP', 'Data_Abertura', 'Detalhes_Completos'];
    const rows = [headers.join(';')];

    fichasCapturadas.forEach((f) => {
      rows.push([
        `"${f.cgm || ''}"`,
        `"${(f.nome || '').replace(/"/g, '""')}"`,
        `"${f.numeroFicha || ''}"`,
        `"${f.status}"`,
        `"${f.dataAbertura || ''}"`,
        `"${(f.acoesRealizadas || '').replace(/"/g, '""')}"`
      ].join(';'));
    });

    const csvContent = '\uFEFF' + rows.join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Fichas_SERP_Leopoldina_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    setStatus('Planilha de Fichas SERP baixada com sucesso!', '#10b981');
  }

  // Copiar JSON
  function copiarJSON() {
    if (fichasCapturadas.size === 0) {
      extrairFichasDaTela();
    }
    const lista = Array.from(fichasCapturadas.values());
    navigator.clipboard.writeText(JSON.stringify({ fichas: lista }, null, 2)).then(() => {
      setStatus(`JSON com ${lista.length} fichas copiado!`, '#10b981');
    }).catch(() => {
      setStatus('Erro ao copiar para clipboard.', '#ef4444');
    });
  }

  // Sincronizar com a Vercel
  async function sincronizarComVercel() {
    if (fichasCapturadas.size === 0) {
      extrairFichasDaTela();
      if (fichasCapturadas.size === 0) {
        alert('Nenhuma ficha capturada. Abra a tela de fichas do SERP primeiro.');
        return;
      }
    }

    const inputUrl = document.getElementById('leo-serp-cfg-url');
    const inputToken = document.getElementById('leo-serp-cfg-token');
    const baseUrl = (inputUrl?.value?.trim() || 'https://busca-ativa-leopoldina.vercel.app').replace(/\/+$/, '');
    const token = inputToken?.value?.trim() || 'leopoldina-frequencia-2026-secret-sync';

    const lista = Array.from(fichasCapturadas.values());
    setStatus(`Enviando ${lista.length} fichas para ${baseUrl}...`, '#6d28d9');

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
        setStatus(`🚀 Sincronizado na Vercel! ${atualizados} fichas atualizadas (${ct} Conselho Tutelar).`, '#10b981');
      } else if (resp.status === 401) {
        setStatus(`❌ Erro 401: Chave de API inválida na Vercel.`, '#ef4444');
      } else {
        const errJson = await resp.json().catch(() => ({}));
        setStatus(`Erro no servidor: ${errJson.error || ('HTTP ' + resp.status)}`, '#ef4444');
      }
    } catch (e) {
      setStatus(`Não foi possível conectar em ${baseUrl}.`, '#ef4444');
    }
  }

  // Inicializa quando a página estiver carregada
  window.addEventListener('load', () => {
    setTimeout(criarInterfaceFlutuante, 2000);
  });
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(criarInterfaceFlutuante, 1000);
  }
})();
