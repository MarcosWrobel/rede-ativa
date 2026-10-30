// popup.js - Lógica do popup da extensão (Power BI & SERP)
document.addEventListener('DOMContentLoaded', async () => {
  const countEl = document.getElementById('popup-count');
  const statusEl = document.getElementById('popup-status');
  const subtitleEl = document.getElementById('popup-mode-subtitle');
  const btnScan = document.getElementById('btn-popup-autoscroll');

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
  if (chrome.storage && chrome.storage.local) {
    const res = await chrome.storage.local.get(['leopoldina_alunos_frequencia']);
    const lista = res.leopoldina_alunos_frequencia || [];
    countEl.textContent = `${lista.length} alunos`;
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
