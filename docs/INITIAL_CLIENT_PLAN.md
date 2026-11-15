# Cadastro com pagamento inicial — migração aplicada

## Comportamento
- Preserva o cadastro simples e a edição, sem criar receitas retroativas.
- Novo modo “Novo cliente com pagamento inicial”: mensal, semestral ou anual.
- Semestral sugere R$ 175; mensal sugere R$ 35; ambos editáveis. Anual exige informar o preço.
- Início e data do recebimento explícitos. Cobertura financeira calculada em meses de calendário; vencimento técnico deve ser o confirmado no servidor.
- Exige confirmação de recebimento e de ativação já realizada. Não envia pedido ao Painel Recarga.
- Registra uma única receita e conserva o cálculo existente de margem: custo mensal × meses do pacote reservado no lançamento.
- Desconta apenas 1 crédito técnico se marcado explicitamente como ainda não contabilizado. A opção começa desmarcada. Não serve para contabilizar ativações que consumiram vários créditos.
- Pacotes novos ficam com paid=0 e prev_paid=0, access_type=pacote_pago; o valor total nunca é restaurado como mensalidade. Observações e registro imutável preservam período e valor original.
- Ao terminar a cobertura, a confirmação manual exige novo pagamento positivo. Não transforma pacote em gratuidade.
- O mesmo requestId com os mesmos dados retorna o cadastro existente; dados diferentes exigem conferência. Login repetido no mesmo servidor é rejeitado, inclusive para outra chave concorrente.
- Cliente, pagamento, eventual crédito, indicação e auditoria são salvos numa única transação SECURITY INVOKER. As políticas existentes continuam limitando as tabelas operacionais ao proprietário.

## Validação
- TypeScript e build locais aprovados.
- A verificação visual em navegador local ficou indisponível por restrição do ambiente; conferir a interface na prévia autenticada antes da publicação.
- Testes de calendário, confirmações, valores e cobertura em src/lib/client-registration.test.ts.
- scripts/check-client-registration.sql.py emite fixtures PostgreSQL usando somente tabelas/função pg_temp, com ROLLBACK: mensal, semestral, anual, pagamento único, chave repetida, chave alterada, login repetido, rollback parcial e chamada sem autenticação.
- Essas fixtures passaram no PostgreSQL gerenciado; nenhum registro real foi inserido ou renovado.
- CI valida testes existentes, novo teste, SQL, tipos da função existente, tipos da interface e build.

## Estado em 15/11/2026
- Migração 0004_client_initial_registration aplicada em uma única solicitação ao agente, custo 3,1 créditos.
- Função SECURITY INVOKER, RLS ligado, acesso anônimo negado; SELECT/INSERT autenticados e ausência de UPDATE confirmados diretamente.
- Nenhum cadastro de cliente real ou pedido ao fornecedor foi criado durante a implantação.

## Publicação
1. Aplicar docs/sql/register-client-with-payment.sql por UMA migração gerenciada, preservando o journal e snapshots Drizzle gerados. Não alterar SQLs históricos.
2. Confirmar a função, RLS e grants; não cadastrar cliente real para testar.
3. Integrar o PR somente depois da migração. Conferir CI e publicar interface pelo comando direto de hospedagem.
4. Verificar o formulário com a sessão do proprietário, sem salvar cadastro fictício em produção.

A migração não é acessível pelos conectores Supabase: o banco ativo é gerenciado pelo Lovable. Query SQL está disponível, mas a regra AGENTS.md exige migração gerenciada e journal. Não usar DDL sem rastreamento para contornar isso. A etapa do agente depende de autorização específica para créditos. Uma única solicitação autorizada aplicou a migração; nenhuma nova solicitação é necessária.

## Reversão
Reverter apenas a interface deixa o fluxo antigo intacto. Não remover pagamentos, clientes ou auditorias já criados. A função nova não altera funções de renovação existentes e não possui tarefas automáticas.
