// serp-bridge.js - Ponte de Execução Nativa no Mundo Principal (Main World) do SERP
(function() {
  console.log('[SERP-BRIDGE] Ponte nativa Leopoldina injetada no mundo principal do SERP!');

  // Informa ao content script que a ponte nativa está pronta
  window.dispatchEvent(new CustomEvent('LEO_SERP_BRIDGE_READY', {
    detail: { hasPaginar: typeof window.paginar === 'function' }
  }));

  // Escuta comandos de navegação nativa vindos do content script
  window.addEventListener('LEO_SERP_NATIVE_PAGINAR', function(e) {
    const detail = e.detail || {};
    const proximaPag = detail.pagina;
    const totalReg = detail.total || 119;
    const scriptCode = detail.scriptCode;

    console.log('[SERP-BRIDGE] Recebida solicitação de navegação:', { proximaPag, totalReg, scriptCode });

    try {
      // 1. Se a função global paginar existir no escopo global
      if (typeof window.paginar === 'function') {
        console.log(`[SERP-BRIDGE] Chamando window.paginar(${proximaPag}, ${totalReg})`);
        window.paginar(proximaPag, totalReg);
        window.dispatchEvent(new CustomEvent('LEO_SERP_BRIDGE_EXECUTADO', { detail: { sucesso: true, metodo: 'window.paginar' } }));
        return;
      }

      // 2. Se foi passado o código da chamada (ex: "paginar(2, 119);")
      if (scriptCode) {
        console.log(`[SERP-BRIDGE] Executando via Function: ${scriptCode}`);
        const fn = new Function(scriptCode);
        fn();
        window.dispatchEvent(new CustomEvent('LEO_SERP_BRIDGE_EXECUTADO', { detail: { sucesso: true, metodo: 'new Function' } }));
        return;
      }

      // 3. Procura no DOM o link com href correspondente e clica no contexto da página
      const links = document.querySelectorAll('a[href*="paginar"]');
      for (const a of links) {
        const href = a.getAttribute('href') || '';
        if (href.includes(`paginar(${proximaPag}`) || a.innerText.trim().toLowerCase() === 'próxima') {
          console.log('[SERP-BRIDGE] Clicando no link no mundo principal:', href);
          a.click();
          window.dispatchEvent(new CustomEvent('LEO_SERP_BRIDGE_EXECUTADO', { detail: { sucesso: true, metodo: 'a.click()' } }));
          return;
        }
      }

      // 4. Procura formulários com campo de página
      const form = document.querySelector('form');
      const inputPagina = document.querySelector('input[name="pagina"], input[name="numPagina"], input[id*="pagina"]');
      if (form && inputPagina) {
        inputPagina.value = proximaPag;
        form.submit();
        window.dispatchEvent(new CustomEvent('LEO_SERP_BRIDGE_EXECUTADO', { detail: { sucesso: true, metodo: 'form.submit()' } }));
        return;
      }

      throw new Error('Nenhum método de paginação nativo pôde ser executado.');
    } catch (err) {
      console.error('[SERP-BRIDGE] Erro na execução nativa:', err);
      window.dispatchEvent(new CustomEvent('LEO_SERP_BRIDGE_EXECUTADO', { detail: { sucesso: false, erro: err.message } }));
    }
  });
})();
