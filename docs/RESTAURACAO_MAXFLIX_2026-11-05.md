# MaxFlix — ponto de restauração antes da renovação real

Criado em **05/11/2026** para proteger a integração Painel Recarga.

## Ponto estável de código (revisável)

- Branch: `backup/maxflix-antes-renovacao-automatica-2026-11-05`
- Commit: `ebdbb6a1dafc2b0bf8975c7aefdbe3bb43c7bf1d`
- Situação: versão do código com a Edge Function `painel-recarga-renovar` publicada
  anteriormente, antes da lógica que ajusta vencimento técnico conforme
  `vencimento_novo` do fornecedor.
- Repositório original: `pompocellipablo/status-zen-iptv`.
- **Nunca mesclar ou excluir o ramo de backup durante os testes.**
- Configuração obrigatória: `PAINEL_RECARGA_LIVE_ENABLED=false` até nova
  autorização explícita de operação real.
- Restauração do código NÃO implica restauração da base de dados.

## Procedimento se uma nova publicação falhar

1. **Congelar renovações reais** no ambiente de produção:
   `PAINEL_RECARGA_LIVE_ENABLED=false`. Não repetir pedidos com estado
   incerto; reconsultar a mesma `Idempotency-Key` ou conciliar manualmente.
2. Conferir `external_renewal_jobs` e a fila do Painel Recarga. Salvar
   lista dos pedidos com estado `waiting`, `uncertain`,
   `external_confirmed` ou `needs_review`. Um rollback de código não
   cancela as solicitações que já foram recebidas pelo fornecedor.
3. Recuperar **somente os arquivos que falharam** do branch de backup por
   `git restore --source=backup/maxflix-antes-renovacao-automatica-2026-11-05 -- <arquivo>`
   e criar novo commit com testes passando; ou reverter pelo histórico do
   Lovable para a versão correspondente. Evitar dar `reset --hard` no
   `main`: poderia eliminar outras melhorias recentes.
4. Publicar de novo SOMENTE a Edge Function `painel-recarga-renovar`, caso
   o defeito esteja nela. A sincronização GitHub/Lovable do código **não**
   garante republicação automática de uma Edge Function.
5. Conferir `PAINEL_RECARGA_LIVE_ENABLED=false`, funcionamento do login
   e simulação de leitura, sem disparar renovação real.
6. Conferir quantidades atuais de clientes, pagamentos e movimentos de crédito
   sem apagar ou editar os registros. Reconciliar qualquer pedido já concluído
   no fornecedor que não foi registrado no banco da MaxFlix.

## Sobre o banco (proteger separadamente)

- **Código:** versionado no GitHub e no histórico do Lovable.
- **Banco:** dados de clientes, pagamentos e movimentos **não** estão incluídos
  nessa branch. Restaurar um backup total do banco apaga quaisquer registros
  legítimos feitos após o ponto escolhido. Preferir correções transacionais
  individuais, com auditoria, para incidentes de renovação.
- O Lovable Cloud pode disponibilizar backup diário em
  Cloud > Database > Backups; verificar existência e data do backup na
  interface antes de depender dele. Não assumir que um backup foi criado.
- Antes do primeiro piloto real, conferir um backup recuperável, registrar
  a contagem de clientes e o estado da fila externa, e autorizar explicitamente
  qual cliente e qual operação serão testados.
- Não inserir senhas, tokens de fornecedores nem cópias de dados pessoais no
  GitHub. O `PAINEL_RECARGA_TOKEN` permanece somente em secret do backend.

## Critério para permitir um piloto real

- Roteiro de `idempotency` validado e mesmo pedido persistente.
- `vencimento_antes` e `vencimento_novo` tratados no backend.
- Cobertura financeira preservada nos pacotes pagos; um ciclo técnico por vez.
- Mesmo pedido tem no máximo um débito de crédito e um lançamento financeiro.
- Erros e resultados incertos não provocam outro pedido automaticamente.
- Verificação do plano do servidor, do saldo e do vencimento técnico ANTES
  de registrar a operação local; com desvio, bloquear e apresentar revisão.
- Operação real desativada até autorização explícita do usuário.

## Linha de base observada antes do piloto (05/11/2026)

Consulta somente de leitura no Lovable Cloud MaxFlix, útil para auditoria,
**não é uma cópia restaurável dos registros**:

| Registro | Quantidade |
|---|---:|
| Clientes cadastrados | 347 |
| Pagamentos históricos | 320 |
| Movimentos de crédito | 385 |
| Pedidos externos de renovação real | 0 |
| Simulações registradas | 2 |
| Simulações em aberto | 0 |

As quantidades podem mudar com o uso normal do app. Antes de qualquer piloto
real, fazer nova leitura e comparar movimentos do cliente escolhido, não
concluir segurança pela contagem total isoladamente.
