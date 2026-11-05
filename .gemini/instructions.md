# Diretrizes Antigravity / Gemini CLI — Rede Ativa SaaS

Ao trabalhar neste repositório:
1. Consulte imediatamente o arquivo `AI_CONTEXT.md` na raiz do projeto para entender o histórico e as 7 Regras de Ouro.
2. A aplicação opera em modo SaaS multi-escola sob 4 níveis hierárquicos: `SUPERADMIN`, `GESTAO_SECRETARIA`, `GESTOR_ESCOLAR` e `PEDAGOGA`.
3. A Escola Piloto Fundadora é o Colégio Estadual Leopoldina B. Pedroso (INEP `41042730`). NUNCA apague ou mutacione dados de produção dessa unidade.
4. Garanta isolamento por `schoolId` em todas as consultas Prisma.
5. Sempre execute `npm test` (177+ testes) e `npm run build` para validar alterações antes de commitar.
