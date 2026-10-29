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
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-size: 12px; color: #64748b; font-weight: 500;">Alerta Infrequência (&lt; 75%):</span>
              <span id="leo-panel-risco" style="font-size: 14px; font-weight: 700; color: #ef4444;">0</span>
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

    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['leopoldina_server_url', 'leopoldina_sync_token'], (res) => {
        if (inputUrl) {
          inputUrl.value = res.leopoldina_server_url || 'https://busca-ativa-lepoldina.vercel.app';
        }
        if (inputToken) {
          inputToken.value = res.leopoldina_sync_token || 'leopoldina-frequencia-2026-secret-sync';
        }
      });
    } else {
      if (inputUrl) inputUrl.value = 'https://busca-ativa-lepoldina.vercel.app';
      if (inputToken) inputToken.value = 'leopoldina-frequencia-2026-secret-sync';
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

    document.getElementById('leo-cfg-btn-vercel')?.addEventListener('click', () => {
      if (inputUrl) {
        inputUrl.value = 'https://busca-ativa-lepoldina.vercel.app';
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

    alunosCapturados.forEach(a => {
      const freqNum = parseFloat((a.mediaGeral || '').replace('%', '').replace(',', '.'));
      if (!isNaN(freqNum) && freqNum < 75) {
        risco++;
      }
    });

    const badge = document.getElementById('leo-count-badge');
    if (badge) badge.textContent = `${total} alunos`;

    const pCount = document.getElementById('leo-panel-count');
    if (pCount) pCount.textContent = total;

    const pRisco = document.getElementById('leo-panel-risco');
    if (pRisco) pRisco.textContent = `${risco} alunos`;
  }

  // Palavras de interface e metadados a ignorar
  const IGNORAR_NOMES = [
    'selecionar linha', 'rolar para cima', 'rolar para baixo', 'varias selecoes',
    'todos', 'outros', 'memoria', 'amparo legal', 'deficiencia', 'ganhando mundo',
    'rede', 'nre', 'escola', 'turma', 'idade', 'media geral', 'presenca', 'semana atual',
    'semana anterior', 'ponta grossa', 'aluno', 'cgm', 'total', 'formatação condicional',
    'formatacao condicional', 'formatação condicional adicional', 'formatacao condicional adicional'
  ];

  // Extrai linhas visíveis da tabela
  function extrairLinhasVisiveis() {
    const cgmRegex = /\b10\d{8}\b/;
    const percentRegex = /\d{1,3}[,\.]\d{1,2}%/g;

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

        // Se já capturou este CGM com nome real e percentuais, não precisa refazer
        if (existente && existente.nome && existente.nome !== 'Aluno' && existente.mediaGeral) {
          return;
        }

        const partes = fullText.split('\n').map(p => p.trim()).filter(Boolean);
        const percentuais = fullText.match(percentRegex) || [];

        // 1. Procura especificamente a parte que tem o padrão do Power BI: "NOME DO ALUNO - 10..."
        let alunoParte = partes.find(p => /^[A-Za-zÀ-ÿ\s\.\']+\s*-\s*10\d*/.test(p.trim()));

        // 2. Se não achar com prefixo de CGM, procura pelo texto com nome de pessoa
        if (!alunoParte) {
          alunoParte = partes.find(p => {
            const limpo = p.toLowerCase().trim();
            if (limpo.length < 5) return false;
            if (/^\d+$/.test(limpo)) return false;
            if (p.includes('%')) return false;
            if (/\d{2}\/\d{2}\/\d{4}/.test(limpo)) return false; // descarta datas
            if (IGNORAR_NOMES.some(ig => limpo.includes(ig))) return false;
            if (limpo.includes('série') || limpo.includes('serie') || limpo.includes('período') || limpo.includes('periodo') || limpo.includes('seriação')) return false;
            return /[A-Za-zÀ-ÿ]{3,}/.test(p);
          });
        }

        let nome = alunoParte
          ? alunoParte.replace(/\s*-\s*\d+.*$/, '').replace(/…/g, '').trim()
          : (existente && existente.nome !== 'Aluno' ? existente.nome : 'Aluno');

        // Isola a Turma
        const turma = partes.find(p => 
          p.includes('Série') || p.includes('Serie') || 
          p.includes('Período') || p.includes('Periodo') || 
          p.includes('Manhã') || p.includes('Tarde') || p.includes('Noite') || p.includes('Sem Seriação')
        ) || (existente ? existente.turma : '');

        const aluno = {
          cgm: cgm,
          nome: nome,
          turma: turma,
          mediaGeral: percentuais[0] || (existente ? existente.mediaGeral : ''),
          semanaAtual: percentuais[1] || (existente ? existente.semanaAtual : ''),
          semanaAnterior: percentuais[2] || (existente ? existente.semanaAnterior : ''),
          capturadoEm: new Date().toISOString()
        };

        if (!alunosCapturados.has(cgm)) {
          novos++;
        }
        alunosCapturados.set(cgm, aluno);
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

    const headers = ['CGM', 'Nome', 'Turma', 'Media_Geral_Presenca', 'Presenca_Semana_Atual', 'Presenca_Semana_Anterior'];
    const rows = [headers.join(';')];

    alunosCapturados.forEach(a => {
      rows.push([
        `"${a.cgm}"`,
        `"${a.nome.replace(/"/g, '""')}"`,
        `"${a.turma.replace(/"/g, '""')}"`,
        `"${a.mediaGeral}"`,
        `"${a.semanaAtual}"`,
        `"${a.semanaAnterior}"`
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
  function copiarJSON() {
    if (alunosCapturados.size === 0) {
      extrairLinhasVisiveis();
    }
    const lista = Array.from(alunosCapturados.values());
    navigator.clipboard.writeText(JSON.stringify(lista, null, 2)).then(() => {
      setStatus(`JSON com ${lista.length} alunos copiado!`, '#10b981');
    }).catch(() => {
      setStatus('Erro ao copiar para clipboard.', '#ef4444');
    });
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
    const baseUrl = (inputUrl?.value?.trim() || 'https://busca-ativa-lepoldina.vercel.app').replace(/\/+$/, '');
    const token = inputToken?.value?.trim() || 'leopoldina-frequencia-2026-secret-sync';

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
        setStatus(`🚀 Sincronizado na nuvem! ${atualizados} atualizados (${emRisco} em risco).`, '#10b981');
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
