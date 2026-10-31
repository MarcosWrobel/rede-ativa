// popup.js - Lógica do popup da extensão (Power BI & SERP)
document.addEventListener('DOMContentLoaded', async () => {
  const countEl = document.getElementById('popup-count');
  const statusEl = document.getElementById('popup-status');
  const subtitleEl = document.getElementById('popup-mode-subtitle');
  const btnScan = document.getElementById('btn-popup-autoscroll');
  const toggleWhatsAppTab = document.getElementById('toggle-whatsapp-tab');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isPowerBi = Boolean(tab && tab.url && tab.url.includes('powerbi.com'));
  const isSerp = Boolean(tab && tab.url && tab.url.includes('redeprotecao.seed.pr.gov.br'));

  if (isSerp) {
    if (subtitleEl) subtitleEl.textContent = 'Módulo SERP (Rede de Proteção)';
    if (btnScan) btnScan.innerHTML = '<span>⚡</span> Rastrear Fichas SERP';
    statusEl.textContent = 'Portal SERP detectado na aba ativa.';
    statusEl.style.color = '#7c3aed';
  } else if (isPowerBi) {
    if (subtitleEl) subtitleEl.textContent = 'Módulo Power BI (Frequência)';
    if (btnScan) btnScan.innerHTML = '<span>⚡</span> Rastrear Tabela Power BI';
    statusEl.textContent = 'Relatório Power BI detectado.';
    statusEl.style.color = '#0284c7';
  } else {
    statusEl.textContent = 'Abra o Power BI ou o SERP na aba ativa.';
    statusEl.style.color = '#64748b';
  }

  // Carrega dados salvos no storage
  const inputCfgUrl = document.getElementById('popup-cfg-url');
  const inputCfgToken = document.getElementById('popup-cfg-token');
  const btnSaveCfg = document.getElementById('btn-popup-save-cfg');

  if (chrome.storage && chrome.storage.local) {
    const res = await chrome.storage.local.get([
      'leopoldina_alunos_frequencia',
      'opt_whatsapp_tab_reuse',
      'leopoldina_server_url',
      'leopoldina_sync_token'
    ]);
    const lista = res.leopoldina_alunos_frequencia || [];
    countEl.textContent = `${lista.length} alunos`;

    if (inputCfgUrl) {
      inputCfgUrl.value = res.leopoldina_server_url || 'https://busca-ativa-leopoldina.vercel.app';
    }
    if (inputCfgToken) {
      inputCfgToken.value = res.leopoldina_sync_token || '';
    }

    if (toggleWhatsAppTab) {
      toggleWhatsAppTab.checked = res.opt_whatsapp_tab_reuse !== false; // default true
      toggleWhatsAppTab.addEventListener('change', () => {
        chrome.storage.local.set({ opt_whatsapp_tab_reuse: toggleWhatsAppTab.checked });
      });
    }

    const saveSettings = async () => {
      const serverUrl = inputCfgUrl?.value?.trim() || 'https://busca-ativa-leopoldina.vercel.app';
      const syncToken = inputCfgToken?.value?.trim() || '';
      await chrome.storage.local.set({
        leopoldina_server_url: serverUrl,
        leopoldina_sync_token: syncToken,
      });
      statusEl.textContent = 'Configurações salvas com sucesso!';
      statusEl.style.color = '#10b981';
      setTimeout(() => {
        statusEl.textContent = isSerp
          ? 'Portal SERP detectado na aba ativa.'
          : isPowerBi
          ? 'Relatório Power BI detectado.'
          : 'Abra o Power BI ou o SERP na aba ativa.';
        statusEl.style.color = isSerp ? '#7c3aed' : isPowerBi ? '#0284c7' : '#64748b';
      }, 3000);
    };

    btnSaveCfg?.addEventListener('click', saveSettings);
    inputCfgUrl?.addEventListener('change', saveSettings);
    inputCfgToken?.addEventListener('change', saveSettings);
  }

  // Rastrear
  btnScan.addEventListener('click', async () => {
    if (!tab || !tab.id) return;
    if (!isPowerBi && !isSerp) {
      statusEl.textContent = 'Abra o Power BI ou o SERP na aba ativa!';
      statusEl.style.color = '#ef4444';
      return;
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (isS) => {
        if (isS) {
          const btn = document.getElementById('leo-serp-btn-scan');
          if (btn) btn.click();
        } else {
          const btn = document.getElementById('leo-btn-autoscroll');
          if (btn) btn.click();
        }
      },
      args: [isSerp],
    });
    statusEl.textContent = isSerp ? 'Rastreando fichas do SERP...' : 'Auto-scroll iniciado no Power BI!';
    statusEl.style.color = isSerp ? '#7c3aed' : '#0284c7';
  });

  // Download CSV
  document.getElementById('btn-popup-csv').addEventListener('click', async () => {
    if (tab && tab.id) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (isS) => {
          if (isS) {
            const btn = document.getElementById('leo-serp-btn-download-csv');
            if (btn) btn.click();
          } else {
            const btn = document.getElementById('leo-btn-download-csv');
            if (btn) btn.click();
          }
        },
        args: [isSerp],
      });
    }
  });

  // Copiar JSON
  document.getElementById('btn-popup-copy').addEventListener('click', async () => {
    if (tab && tab.id) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (isS) => {
          if (isS) {
            const btn = document.getElementById('leo-serp-btn-copy-json');
            if (btn) btn.click();
          } else {
            const btn = document.getElementById('leo-btn-copy-json');
            if (btn) btn.click();
          }
        },
        args: [isSerp],
      });
    }
  });

  // Sincronizar Vercel
  document.getElementById('btn-popup-sync').addEventListener('click', async () => {
    if (tab && tab.id) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (isS) => {
          if (isS) {
            const btn = document.getElementById('leo-serp-btn-sync');
            if (btn) btn.click();
          } else {
            const btn = document.getElementById('leo-btn-sync-api');
            if (btn) btn.click();
          }
        },
        args: [isSerp],
      });
    }
  });
});
