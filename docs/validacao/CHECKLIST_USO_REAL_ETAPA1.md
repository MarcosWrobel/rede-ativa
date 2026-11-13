# Checklist de Validação em Uso Real — Atas, Encaminhamentos e Assinaturas (Etapa 1)

Este roteiro reúne os testes manuais recomendados em ambiente real (desktop + celular) para validar as correções implementadas na **Etapa 1**.

> [!NOTE]
> Use dados ou registros de teste controlados em homologação/ambiente de validação. Nunca realize testes destrutivos sobre registros históricos reais da escola piloto.

---

## 1. Preparação Rápida do Teste

- [x] Ter acesso a uma conta autenticada da equipe pedagógica ou gestão escolar (`PEDAGOGA` ou `GESTOR_ESCOLAR`).
- [x] Ter um **computador** (navegador principal) e um **celular** (ou segunda aba/dispositivo independente) para simular assinatura via QR Code e disputa simultânea.
- [x] Garantir que haja ao menos 1 estudante/docente de teste disponível para abrir o modal de **Nova Ata** (ou editar uma ata em rascunho).

---

## 2. Encaminhamentos com `Docente / Professor` e Prazos

### 2.1. Criação no editor de atas
- [x] Abrir o modal de ata e ir até **Encaminhamentos e Prazos:**.
- [x] Clicar em **Novo Encaminhamento** e abrir o dropdown de responsável.
- [x] Confirmar que aparecem as opções: `Família`, `Estudante`, `Docente / Professor`, `Escola` e `Rede / CT`.
- [x] Criar um encaminhamento com responsável **Docente / Professor** e **deixar o campo de data vazio** (`dd/mm/aaaa`).
- [x] Criar um segundo encaminhamento com responsável **Docente / Professor** e **preencher uma data futura**.
- [x] Clicar em **Salvar Rascunho**, fechar o modal e reabrir a mesma ata.
- [x] Confirmar que ambos os encaminhamentos permaneceram salvos com o responsável `Docente / Professor` e que o primeiro manteve a data vazia.

### 2.2. Acompanhamento na página `/encaminhamentos`
- [x] Lavrar uma ata de teste contendo o encaminhamento de `Docente / Professor` sem data e outro de `Escola` (ou testar após salvar/lavrar conforme visibilidade da lista).
- [x] Acessar `/encaminhamentos`.
- [x] No filtro de responsável, selecionar **Docente / Professor** e confirmar que apenas os encaminhamentos atribuídos a docentes são listados.
- [x] Confirmar que o badge do item de docente exibe **Docente / Professor** e o badge institucional exibe **Escola / Equipe**.
- [x] Confirmar que o encaminhamento salvo sem data exibe o selo **Sem prazo definido** (sem marcar como vencido) e permite concluir normalmente (dar baixa).

---

## 3. Formalização com IA (`Formalizar & Revisar`) e Preservação de Prazos

### 3.1. Sugestão inicial sem prazo automático
- [x] Em uma nova ata sem encaminhamentos preenchidos (ou sem itens manuais), preencher **Fatos Observados** mencionando ações futuras (ex.: *"Combinou-se que o professor acompanhará a entrega das atividades e a família comparecerá à escola na próxima semana"*).
- [x] Clicar em **Formalizar & Revisar** e aguardar o retorno.
- [x] Confirmar que **todos os encaminhamentos sugeridos pela IA chegam com o campo de data vazio**, mesmo quando o texto mencionar prazos ou dias da semana.
- [x] Confirmar que o usuário consegue editar livremente a descrição, o responsável e adicionar uma data manualmente se desejar.

### 3.2. Preservação de itens e prazos já existentes
- [x] Antes de rodar a IA novamente, adicionar ou editar manualmente um encaminhamento com **prazo definido** (ex.: data escolhida manualmente).
- [x] Clicar novamente em **Formalizar & Revisar**.
- [x] Confirmar que a IA **não sobrescreve silenciosamente** os encaminhamentos existentes: deve aparecer o aviso informando quantos encaminhamentos foram sugeridos, com os botões **Manter atuais** e **Substituir pelos sugeridos**.
- [x] Testar clicar em **Manter atuais** e verificar que o encaminhamento manual e a data preenchida permanecem intactos.
- [x] Repetir e testar **Substituir pelos sugeridos**, verificando que os itens são substituídos pelos novos (com datas limpas).

### 3.3. Resposta atrasada da IA durante edição manual (teste de corrida)
- [x] Preencher **Fatos Observados**, clicar em **Formalizar & Revisar** e, **enquanto a requisição ainda estiver carregando**, clicar imediatamente em **Novo Encaminhamento**, digitar uma ação e preencher uma data manualmente.
- [x] Quando a resposta da IA chegar, confirmar que o item digitado durante a espera **não foi apagado** — o sistema deve exibir o banner de confirmação (**Manter atuais** / **Substituir pelos sugeridos**) preservando o trabalho em andamento.

---

## 4. Vínculo / Função dos Presentes (Fim do `"Mãe/Pai"` Indevido)

### 4.1. Novos participantes e troca de papel
- [x] Em **Presentes e Assinaturas:**, clicar em **Novo Presente**.
- [x] Confirmar que o campo de vínculo/função inicia vazio e com placeholder contextual:
  - `Família / Responsável`: `"Parentesco (opcional, ex.: Mãe, Pai)"`
  - `Professor(a)` ou `Equipe / Gestão Escolar`: `"Função / Disciplina (opcional)"`
  - Demais papéis (`Estudante`, `Conselho Tutelar / Rede`, `Outro`): `"Vínculo / Órgão (opcional)"`
- [x] Adicionar uma servidora como `Equipe / Gestão Escolar` deixando função vazia ou preenchendo `"Pedagoga"`. Salvar e conferir na visualização/impressão da ata que **não aparece `"Mãe/Pai"`**.
- [x] Adicionar um participante inicialmente como `Família / Responsável` com parentesco `"Mãe/Pai"`. Sem assinar nem gerar QR, trocar o papel para `Professor(a)` ou `Equipe / Gestão Escolar`.
- [x] Confirmar que o campo `"Mãe/Pai"` é limpo imediatamente na tela e permanece limpo após salvar e reabrir.
- [x] Fazer o mesmo teste digitando uma função legítima (ex.: `"Filosofia"`) em `Professor(a)` e verificar que ela **não** é apagada ao salvar ou trocar entre `Professor(a)` e `Equipe / Gestão Escolar`.

### 4.2. Proteção de atas históricas já lavradas / assinadas
- [x] Abrir uma ata antiga que já esteja lavrada ou que possua participante já assinado com vínculo legado (caso exista no ambiente de teste).
- [x] Confirmar que a visualização histórica e o código de validação permanecem íntegros e que nenhuma edição silenciosa acontece em participantes já assinados.

---

## 5. Proteção de Identidade com Assinatura ou QR Code Ativo

### 5.1. Bloqueio durante QR Code ativo (antes da assinatura) *(parcialmente validado — confirmar passo inicial)*
- [ ] Em uma ata em rascunho, adicionar um participante (`Família / Responsável`, `Professor(a)` ou outro) e salvar ou gerar o link **QR Celular (Biometria)**.
- [x] Com o QR Code exibido/ativo na tela, verificar que aparece o aviso *"Link QR ativo aguardando assinatura. Cancele o link antes de alterar nome, documento ou função."* e que os campos de identidade e vínculo estão bloqueados: **Papel**, **Nome**, **Tipo de documento**, **CPF/RG**, **E-mail** (quando houver) e **Vínculo / função**.
- [x] Confirmar que o campo **Telefone de contato (opcional)** continua editável mesmo com QR ativo.
- [x] Clicar em **Cancelar link QR e editar**.
- [x] Confirmar que o painel do QR fecha e os campos de identidade/função voltam a ficar editáveis.
- [x] Tentar abrir no celular o link QR que acabou de ser cancelado e confirmar que ele **não permite mais assinar** (link inválido/revogado).

### 5.2. Bloqueio após assinatura concluída (na tela ou no celular)
- [x] Assinar um participante via **Assinar na Tela** ou pelo **QR Celular (Biometria)**.
- [x] Confirmar que aparece o aviso *"Identidade e função bloqueadas após assinatura. Para alterar esses dados, use "Refazer assinatura"."* e que todos os campos de identidade e vínculo/função ficam bloqueados, enquanto **Telefone** segue editável.
- [x] Editar apenas o **Telefone** do participante já assinado e clicar em **Salvar Rascunho**. Confirmar que o salvamento funciona sem apagar a assinatura existente.

### 5.3. Fluxo de **Refazer assinatura** (persistência no servidor)
- [x] Em um participante já assinado (em rascunho), clicar em **Refazer assinatura**.
- [x] **Teste de sucesso:** com conexão normal, confirmar que:
  1. A requisição é concluída no servidor antes de liberar os campos.
  2. Aparece o aviso: *"Assinatura anterior removida. Os campos foram liberados e será necessária uma nova assinatura."*
  3. Ao recarregar a página (`F5`) sem clicar em mais nada, o participante **já está sem assinatura** no banco (não volta como assinado).
- [x] **Teste de falha de rede (offline / DevTools Network Offline):** em outro participante assinado, colocar o navegador em modo *Offline* no DevTools e clicar em **Refazer assinatura**.
  1. Confirmar que **uma mensagem de erro é exibida**.
  2. Confirmar que **a assinatura atual continua reconhecida e os campos permanecem bloqueados** (não libera localmente sem confirmação do servidor).
  3. Voltar o navegador para *Online* e recarregar: a assinatura original continua intacta.

### 5.4. Fluxo de **Recusa** e **Cancelar recusa** *(re-testar após correção de proteção de `REFUSED`)*
- [ ] Em um participante ainda não assinado, clicar em **Recusa**, preencher `"Motivo alegado para a recusa..."` e `"Nome da testemunha escolar presente..."` e clicar em **Confirmar Termo de Recusa**.
- [ ] Confirmar que os campos de identidade e função ficam **imediatamente bloqueados** com o aviso *"Identidade e função bloqueadas após registro de recusa. Para alterar esses dados, use "Cancelar recusa"."*, mantendo **Telefone** editável.
- [ ] Editar apenas o **Telefone** (opcional), clicar em **Salvar Rascunho**, recarregar a página (`F5`) e reabrir a ata: confirmar que o badge **Recusou-se a assinar**, o motivo, a testemunha e o bloqueio dos campos de identidade/função permanecem preservados.
- [ ] **Teste de falha de rede ao cancelar recusa (offline / DevTools Network Offline):** clicar em **Cancelar recusa** estando *Offline* e confirmar que erro é exibido, a recusa/motivo/testemunha são mantidos e os campos continuam bloqueados; ao voltar *Online* e recarregar, a recusa continua intacta.
- [ ] **Teste de sucesso ao cancelar recusa:** estando *Online*, clicar em **Cancelar recusa**, confirmar indicação de processamento (`Cancelando...`) sem oscilação confusa e liberação após confirmação do servidor com aviso *"Registro de recusa cancelado. Os campos foram liberados."*; recarregar (`F5`) e confirmar que os campos seguem liberados e sem recusa no banco.

---

## 6. Cenários Reais de Concorrência (Computador vs. Celular)

### 6.1. Celular assina logo antes de o computador cancelar QR ou alterar identidade
- [x] No computador, abrir o rascunho e gerar **QR Celular (Biometria)** para um participante.
- [x] Abrir o link/QR no celular e deixar pronto na tela de assinatura (sem enviar ainda).
- [x] **Ordem A (celular envia primeiro):** concluir a assinatura no celular e, imediatamente depois no computador (sem recarregar a tela antes), clicar em **Cancelar link QR e editar** ou tentar alterar dados/salvar o participante.
- [x] Confirmar que o computador **recusa a operação conflitante** (não sobrescreve nem apaga a assinatura recém-gravada pelo celular) e exibe o participante devidamente assinado pela pessoa original.

### 6.2. Computador cancela QR / altera participante antes de o celular concluir
- [x] Repetir a preparação: abrir a página de assinatura no celular com o QR ativo.
- [x] **Ordem B (computador age primeiro):** no computador, clicar em **Cancelar link QR e editar** (ou alterar a identidade do participante após cancelar e salvar) **antes** de enviar a assinatura no celular.
- [x] Em seguida, tentar concluir a assinatura na tela já aberta do celular.
- [x] Confirmar que o celular **é impedido de assinar** (erro de link inválido/expirado/revogado) e a identidade alterada no computador permanece protegida sem assinatura da pessoa errada.

---

## 7. Lavratura (`FINALIZED`) e Verificação Pós-Lavratura *(parcialmente validado — confirmar passo inicial)*

- [ ] Com todos os participantes resolvidos (assinados, dispensados conforme regra aplicável ou com recusa registrada) e encaminhamentos revisados, clicar em **Lavrar Ata**.
- [x] Confirmar a autoria com o PIN quando solicitado e verificar que a ata passa para o estado finalizado.
- [x] Tentar editar texto, alterar participante, gerar novo QR, cancelar QR ou clicar em **Refazer assinatura** nessa ata lavrada e confirmar que o sistema **bloqueia todas essas alterações**.
- [x] Abrir a versão de **Impressão / PDF** e o **Portal de Validação (`/validar/ata/[code]`)** e conferir que:
  - Os presentes mostram a função/vínculo correto (sem `"Mãe/Pai"` em docentes/equipe).
  - Os encaminhamentos atribuídos a docente aparecem corretamente.
  - A verificação de integridade / conferência pública da ata finalizada funciona sem falhas.

---

## Escopo ainda não incluído nesta etapa (previsto para Etapa 2)

> [!IMPORTANT]
> Os itens abaixo **não fazem parte da Etapa 1** e não devem ser reportados como regressão durante estes testes:
> - Carregamento automático de listas de estudantes associados, responsáveis cadastrados ou seleção assistida de servidores/docentes ao escolher o papel em **Presentes e Assinaturas:**.
> - Na Etapa 1, após selecionar o papel em **Presentes e Assinaturas:**, o nome, documento, telefone e função continuam com preenchimento manual pela equipe.
