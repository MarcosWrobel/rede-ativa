# Scripts Legados e de Migração Inicial

Esta pasta contém scripts utilitários executados durante as fases iniciais de homologação e migração do projeto, mantidos exclusivamente para referência histórica e auditoria:

- `consolidate_users.cjs`: Script executado para unificar contas legadas de servidores durante a migração para a allowlist centralizada da Fase 1.
- `deduplicate_templates.cjs`: Rotina executada localmente para expurgar modelos de mensagens duplicados criados nos primeiros testes.
- `deduplicate_templates_http.cjs`: Variante da rotina de desduplicação via chamadas HTTP aos endpoints de homologação.
- `extract_data.py`: Script Python executado na fase inicial para extrair dados brutos de planilhas locais para estruturação inicial do banco.

> **Atenção:** Estes scripts não fazem parte do ciclo de vida ativo da plataforma Rede Ativa SaaS. Para rotinas ativas de build e seed, utilize os scripts na pasta raiz `scripts/` (`package_extension.cjs`, `vercel_db_push.cjs` e `seed.cjs`).
