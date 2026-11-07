# MaxFlix × Painel Recarga — integração de renovações

Documento técnico baseado no PDF "API · Painel Recarga" enviado em 04/11/2026.
**Integração real DESLIGADA até homologação com uma conta de teste.**

## Arquitetura preparada

- Adaptador compartilhado em supabase/functions/_shared/painel-recarga.ts: rotas permitidas e login exato.
- Proxy protegido em supabase/functions/painel-recarga-renovar/index.ts.
- public.external_renewal_jobs: uma chave UUID por cliente e ciclo para evitar duplicidade, com RLS restrita.
- simulate nunca renova; renew e check ficam desativados até configuração de secrets.
- O botão atual da MaxFlix NÃO foi alterado nesta fase.

## Segredos de ambiente (nunca GitHub, console, planilha ou VITE_*)

- PAINEL_RECARGA_TOKEN: gerar em Painel Recarga > Aparelhos > Token à mão.
- PAINEL_RECARGA_ENABLED=true: permitir consulta/simulação no servidor.
- PAINEL_RECARGA_LIVE_ENABLED=true: somente após autorizar e testar o piloto.

O Lovable Cloud já deve prover SUPABASE_URL e SUPABASE_ANON_KEY ou
SUPABASE_PUBLISHABLE_KEY. O JWT é validado e só o proprietário da MaxFlix tem acesso.

## Contrato documentado

Base: https://painelrecarga.dev
Headers: X-Auth-Token, Idempotency-Key UUID, Content-Type application/json.

Rotas IPTV (POST):
- All Play /renovar/iptv/allplay
- Blade IPTV /renovar/iptv/blade (rota da API, não utilizada pelos clientes Blade atuais da MaxFlix)
- Club /renovar/iptv/club
- Five /renovar/iptv/five
- GF /renovar/iptv/gf (documentada pelo fornecedor, mas bloqueada na MaxFlix por falta de acesso habilitado)
- Now /renovar/iptv/now
- Uniplay /renovar/iptv/uniplay

Rotas P2P existem para Blade/Five/GF/Uniplay. O proprietário confirmou:
- Blade na MaxFlix = Blade P2P: /renovar/p2p/blade (confirmado pelo proprietário em 04/11/2026; não há clientes Blade IPTV cadastrados)
- UniP2P na MaxFlix = Uniplay P2P: /renovar/p2p/uniplay
- Uniplay na MaxFlix = Uniplay IPTV: /renovar/iptv/uniplay

GF, Elite e Fast permanecem manuais na MaxFlix; não possuem rota habilitada no adaptador.

Esse mapeamento foi implementado no adaptador com testes para evitar
confundir as duas modalidades. Elite e demais servidores sem mapeamento
continuam manuais. Mesmo com a rota mapeada, simulações e homologação
do resultado do painel são obrigatórias antes de qualquer renovação real.

Corpo de um alvo: usuario (login exato), ciclos:1. Para consulta inclua simular:true.
A API aceita ciclos 1, 3, 6, 12. Importante: UM CICLO É UMA REPETIÇÃO
DO PLANO DO CLIENTE NO PAINEL — NÃO NECESSARIAMENTE UM MÊS.
O vínculo com os vencimentos da MaxFlix deve ser homologado servidor por servidor.

- HTTP 200: verificar global ok, resultados por usuario, ok e incerto.
- HTTP 202: fila, sessão ausente ou confirmação manual; esperar até 24h.
  NÃO atualizar a MaxFlix; consultar com a MESMA Idempotency-Key.
- HTTP 207: lote parcialmente resolvido, requer revisão.
- 400,401,403,404,422: não atualizar localmente.
- Timeout, 5xx ou incerto: nunca assumir sucesso ou gerar outra chave.
- A API recomenda timeout de 130s.

## Fluxo seguro

1. Cliente e servidor são lidos pelo servidor da MaxFlix com JWT válido;
   não aceitar login arbitrário enviado pelo navegador.
2. Simulação com login exato e conferência da validade e do plano.
3. Gerar e persistir idempotency_key ANTES de enviar o pedido real.
4. Enviar somente um alvo. A repetição do mesmo pedido usa chave e corpo idênticos.
5. Se pendente/incerto, manter auditoria, sem atualizar vencimento,
   pagamentos nem créditos na MaxFlix.
6. Se confirmado, validar data de vencimento externa contra data esperada.
   Se houver divergência, suspender sincronização e exigir conciliação.
7. Somente então executar a RPC renew_client_with_credit: data, pagamento e
   crédito local na mesma transação. Marcar job como synced.

## Regras atuais da MaxFlix que devemos preservar

- Pacotes pré-pagos de 6/12 meses são consumidos mensalmente na MaxFlix.
- Meses grátis por indicação têm RPC distinta e precisam de tratamento próprio.
- A sessão no painel pode expirar e retornar 202 mesmo após o usuário clicar.
- GF usa chave configurada em "Chaves e logins"; outros pedem sessão do painel.
- Nenhum pedido real deve ser disparado até validação de token, permissões,
  login, vencimento, crédito, retorno 202 e retry com mesma chave.

## O que falta antes de substituir o botão Renovar

- Token gerado no Painel Recarga e cadastrado como SECRET no projeto Lovable certo.
- Deploy do endpoint no mesmo Lovable Cloud da MaxFlix, não Supabase homônimo.
- Testes simulados sem consumo, seguidos de um piloto real autorizado.
- Comparação real dos vencimentos retornados e regras de ciclo por servidor.
- Painel de pedidos pendentes/incertos e conciliação manual.
- Tratamento das renovações gratuitas por indicação e de pacotes pré-pagos.
- Só depois habilitar fluxo ao clicar no botão principal, sem ação dupla.


## 05/11/2026 — acompanhamento seguro de simulações (PREPARADO, NÃO PUBLICADO)

O desenvolvedor confirmou a regra: **uma nova Idempotency-Key representa uma nova solicitação**.
Se a primeira solicitação ficou aguardando a sessão e foi executada ao reconectar,
reconsultar com uma chave nova pode duplicar o registro de pedido.
O corpo, login, servidor, ciclos e a chave devem ser idênticos na reconsulta.

Mudança preparada no GitHub (não chamar o agente Lovable sem autorização):
- Migração `20261105110000_external_simulation_jobs.sql`: tabela separada das renovações
  financeiras, UUID imutável por solicitação, índice único por cliente com consulta
  aberta e políticas RLS somente para o proprietário.
- `mode=simulate`: reserva o pedido antes de chamar a API. Se já houver consulta
  `created`, `waiting` ou `uncertain`, reutiliza **a mesma chave**;
  não cria outro pedido. Resultado final recente pode vir de cache (até 2 minutos).
- `mode=check_simulation`: verifica a solicitação existente com a mesma chave,
  sem gerar nova. Se já está concluída, devolve o resultado armazenado.
- Resposta `202`, rede indisponível ou estado incerto: preserva a consulta pendente,
  não atualiza vencimentos, pagamento nem créditos.
- Falha no banco de consultas: **falha fechada**, sem enviar pedido ao fornecedor.
- Endpoint `renew`/ `check` de operações reais mantém seu controle independente
  `external_renewal_jobs` e a chave existente por cliente/ciclo.

**Sequência obrigatória na publicação:**
1. Validar GitHub Actions e revisar migration/Edge Function.
2. Aplicar a migração ao Lovable Cloud do projeto MaxFlix CORRETO.
3. Só então publicar a versão atualizada da função `painel-recarga-renovar`.
4. Testar com `simular:true` e uma conta autorizada; na pendência, consultar o
   mesmo pedido, nunca renovar. Não habilitar `PAINEL_RECARGA_LIVE_ENABLED`.
5. Separadamente, atualizar o frontend para apresentar "Verificar andamento"
   e recuperar histórico após recarregar a página (não liberado ainda).

**Não confundir**: preparar código/migration no GitHub não instala a tabela
nem altera a Edge Function em produção. Até a implantação, a tela de auditoria
tem somente bloqueios de pendência temporários e solicitações de simulação
podem seguir gerando novas chaves após recarga. Não repetir manualmente
uma consulta em espera na versão antiga sem conferir a fila.


## 07/11/2026 — preparação do botão único e auditoria aprovada

**Estado:** código e SQL implementados; ativação geral de renovações permanece desabilitada por padrão.

- `Renovar` continua manual para GF, Elite, Fast e para qualquer cliente sem autorização da integração.
- Somente com **ambos** os Secrets privados `PAINEL_RECARGA_LIVE_ENABLED=true` **e** `PAINEL_RECARGA_ROLLOUT_ENABLED=true` o botão único encaminha contas comuns suportadas ao Painel Recarga.
- Publicar a nova Edge Function **não habilita a renovação geral**. Não cadastrar ou ativar o Secret do rollout sem autorização separada.
- O proprietário confirma explicitamente cada operação no navegador; a Edge valida novamente cliente, login, servidor, vencimento esperado, plano, valor e cobertura financeira antes de reservar o pedido.
- Mensal: valor exatamente igual ao cadastro, um crédito/ciclo externo e datas financeiras/técnicas acompanhando a validade do fornecedor.
- Contratação de 6 ou 12 meses: registra um pagamento do pacote, envia somente **um** ciclo técnico externo e calcula a cobertura financeira sem conceder ciclos adicionais no servidor.
- Plano já pago: apenas um ciclo técnico, **zero** pagamento novo, conserva a data financeira; recusa se o acesso técnico superar a cobertura.
- Acessos gratuitos e meses grátis por indicação **não entram no rollout geral**; exigem fluxo próprio, mantendo o piloto gratuito estritamente autorizado separado.
- Pedidos externos criados, pendentes, incertos ou em revisão impedem a renovação manual concorrente. Reconciliar com a mesma chave ou manualmente após evidência do provedor.
- A função já existente de comparação de vencimentos continua usando simulação com login exato e sem alterar cliente automaticamente.
- A aprovação de correção manual agora usa `approve_panel_date_correction`, função de banco com transação e RLS de proprietário, que **preserva o financeiro** e não registra pagamento nem crédito. O histórico permanente fica em `panel_due_date_corrections`, com antiga/nova data, operador e fonte.
- Para fonte de simulação, a função valida a data contra uma consulta autenticada registrada há no máximo 24 horas; para exportação CSV/TXT exige confirmação do proprietário. Em ambos os casos, bloqueia se existir pedido de renovação externo em aberto.
- A correção manual só pode ser aplicada dentro da cobertura financeira já existente. Se o servidor informar validade posterior ao financeiro, exigir revisão financeira separada; não aumentar a cobrança nem a cobertura silenciosamente.

**Pendências antes do uso geral:** publicar a Edge Function, homologar um pagamento real no AllPlay, revalidar um novo contrato mensal, um pacote de 6/12 meses e um ciclo técnico pré-pago; após isso, habilitar os dois switches com consentimento explícito. Não habilitar em massa durante a homologação.

**Recuperação:** código versionado em GitHub, banco contém audit log; alterações ao esquema são aditivas, e nenhum vencimento de cliente foi modificado ao criar a funcionalidade.
