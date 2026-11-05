import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { isPackageCovered, planPanelDateCorrection, renewalDates, renewalMessageLink, type Client } from "./iptv";

describe("datas da renovação", () => {
  const renewalDay = new Date(2026, 8, 27);

  test("vencido: mensal usa dia da renovação para ambas as datas", () => {
    assert.deepEqual(renewalDates("2026-08-25", 1, renewalDay), {
      dueDate: "2026-10-27",
      financialDueDate: "2026-10-27",
    });
  });

  test("vencido: meses adiantados cobrem o período desde o dia do pagamento", () => {
    assert.deepEqual(renewalDates("2026-08-25", 2, renewalDay), {
      dueDate: "2026-10-27",
      financialDueDate: "2026-11-27",
    });
  });

  test("antecipado: mantém a data contratada como base", () => {
    assert.deepEqual(renewalDates("2026-10-15", 6, renewalDay), {
      dueDate: "2026-11-15",
      financialDueDate: "2027-04-15",
    });
  });

  test("crédito cobre só os ciclos anteriores ao vencimento financeiro", () => {
    const dates = renewalDates("2026-08-25", 2, renewalDay);
    const client = { due_date: dates.dueDate, financial_due_date: dates.financialDueDate } as Client;
    assert.equal(isPackageCovered(client), true);
    assert.equal(isPackageCovered({ ...client, due_date: dates.financialDueDate }), false);
  });

  test("limita meses inválidos", () => {
    assert.throws(() => renewalDates("2026-09-27", 0, renewalDay));
    assert.throws(() => renewalDates("2026-09-27", 2.5, renewalDay));
    assert.throws(() => renewalDates("2026-09-27", 121, renewalDay));
  });
});

describe("conciliação manual de vencimentos", () => {
  const base=new Date(2026,10,4);
  test("datas iguais acompanham a correção aprovada",()=>{
    assert.deepEqual(planPanelDateCorrection({due_date:"2026-11-10",financial_due_date:"2026-11-10"},"2026-11-12",base),{
      dueDate:"2026-11-12",financialDueDate:"2026-11-12",preservedFinancial:false,blockedReason:null,
    });
  });
  test("pacote pago mantém a data financeira sem nova cobrança",()=>{
    assert.deepEqual(planPanelDateCorrection({due_date:"2026-11-10",financial_due_date:"2027-03-10"},"2026-11-12",base),{
      dueDate:"2026-11-12",financialDueDate:"2027-03-10",preservedFinancial:true,blockedReason:null,
    });
  });
  test("não concilia automaticamente data vencida, inválida ou maior que a cobertura",()=>{
    assert.ok(planPanelDateCorrection({due_date:"2026-11-10",financial_due_date:"2027-03-10"},"2027-04-10",base).blockedReason);
    assert.ok(planPanelDateCorrection({due_date:"2026-11-10",financial_due_date:"2026-11-10"},"2026-10-10",base).blockedReason);
    assert.ok(planPanelDateCorrection({due_date:"2026-11-10",financial_due_date:"2026-11-10"},"2026-02-30",base).blockedReason);
  });
});

describe("mensagem de renovação", () => {
  const client = { name: "Ana", login: "ana", whatsapp: "21999999999", due_date: "2026-09-27", paid: 0, prev_paid: 35, server: "Five" } as Client;
  const base = new Date(2026, 8, 28);
  test("vencido recebe somente a mensagem de cobrança", () => {
    const url = new URL(renewalMessageLink(client, "Normal {nome}", "Venceu {nome}", base));
    assert.equal(url.searchParams.get("text"), "Venceu Ana");
    assert.equal(url.pathname, "/5521999999999");
  });
  test("renovação internacional usa o mesmo telefone do cadastro", () => {
    const url = new URL(renewalMessageLink({ ...client, whatsapp: "+351969682294" }, "Normal {nome}", "Venceu {nome}", base));
    assert.equal(url.pathname, "/351969682294");
    assert.equal(url.searchParams.get("text"), "Venceu Ana");
  });
  test("cliente que vence hoje ou depois recebe a mensagem normal", () => {
    for (const due_date of ["2026-09-28", "2026-09-29"]) {
      const url = new URL(renewalMessageLink({ ...client, due_date }, "Normal {nome}", "Venceu {nome}", base));
      assert.equal(url.searchParams.get("text"), "Normal Ana");
    }
  });
});