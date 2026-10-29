// popup.js - Lógica do popup da extensão
document.addEventListener('DOMContentLoaded', async () => {
  const countEl = document.getElementById('popup-count');
  const statusEl = document.getElementById('popup-status');

  // Carrega dados salvos no storage
  if (chrome.storage && chrome.storage.local) {
    const res = await chrome.storage.local.get(['leopoldina_alunos_frequencia']);
    const lista = res.leopoldina_alunos_frequencia || [];
    countEl.textContent = `${lista.length} alunos`;
  }

  // Ações via injeção de script ou mensagens
  document.getElementById('btn-popup-autoscroll').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url || !tab.url.includes('powerbi.com')) {
      statusEl.textContent = 'Abra o relatório do Power BI na aba ativa!';
      statusEl.style.color = '#ef4444';
      return;
    }

    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const btn = document.getElementById('leo-btn-autoscroll');
        if (btn) btn.click();
      }
    });
    statusEl.textContent = 'Auto-scroll iniciado na página!';
    statusEl.style.color = '#0284c7';
  });

  document.getElementById('btn-popup-csv').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const btn = document.getElementById('leo-btn-download-csv');
          if (btn) btn.click();
        }
      });
    }
  });

  document.getElementById('btn-popup-copy').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const btn = document.getElementById('leo-btn-copy-json');
          if (btn) btn.click();
        }
      });
    }
  });

  document.getElementById('btn-popup-sync').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const btn = document.getElementById('leo-btn-sync-api');
          if (btn) btn.click();
        }
      });
    }
  });
});
