# MaxFlix — atualização dos saldos de créditos (etapa 1)

## Escopo implementado no GitHub

- A aba **Créditos** relê o livro interno `server_credit_movements` a cada 30 segundos enquanto está aberta e quando a janela recupera foco. Também oferece **Atualizar controle**.
- O dashboard relê os movimentos de estoque interno a cada 30 segundos enquanto estiver aberto.
- As renovações manuais e as renovações confirmadas pelo Painel Recarga invalidam tanto o cache da aba quanto o cache do dashboard.
- Ajustes manuais invalidam ambos os caches. O botão **Conferir com saldo do painel** registra a diferença entre o saldo interno atual e o total **informado manualmente** pelo proprietário, preservando o histórico.
- Tela e dashboard passam a identificar os números como **saldos internos**, não como estoques reais do fornecedor. Uniplay IPTV e UniP2P continuam compartilhando o mesmo estoque local.

## Limitação do contrato da API (04/11/2026)

O documento `docs/PAINEL_RECARGA_INTEGRACAO.md` descreve apenas rotas de renovação/simulação e não fornece endpoint autenticado para obter os saldos reais de cada servidor. **Nenhuma rota de saldo foi inventada. Nenhuma chamada ao fornecedor foi adicionada.**

Para uma etapa 2 de sincronização real, é indispensável um contrato oficial **read-only** que retorne saldo total e servidor/modalidade; também será preciso homologar autenticação, unidades e pooling. O fluxo deve:
1. Consultar em backend autenticado do proprietário; nunca expor segredos no navegador.
2. Comparar saldo externo com o livro interno sem apagar movimentações.
3. Evitar duplo débito: a renovação integrada já insere um movimento `renewal: -1`.
4. Tratar respostas parciais, falhas e sessões offline como **saldo externo indisponível** — não aplicar ajuste automático nem mostrar `0` por suposição.
5. Registrar discrepâncias e somente depois de homologação considerar conciliação automática atômica, protegida de corridas com renovações.

**Publicação:** branch de desenvolvimento, sem implantação no Lovable Cloud, sem alteração de migrations, secrets, clientes, pagamentos ou créditos existentes.
