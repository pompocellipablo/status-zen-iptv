import {describe,it} from "node:test";
import assert from "node:assert/strict";
import {panelRouteForClient,buildPanelRecargaBody,parsePanelRecargaResponse,isExternalSyncSafe,panelDateToISO,financialTransitionError} from "./painel-recarga";

describe("Painel Recarga integration guardrails",()=>{
  it("maps only documented IPTV panels",()=>{
    assert.equal(panelRouteForClient("Five")?.path,"/renovar/iptv/five");
    assert.equal(panelRouteForClient("GF"),null); // Not homologated: manual only
    assert.equal(panelRouteForClient("Club")?.path,"/renovar/iptv/club");
    assert.deepEqual(panelRouteForClient("Blade"),{kind:"p2p",panel:"blade",path:"/renovar/p2p/blade"});
    assert.deepEqual(panelRouteForClient("UniP2P"),{kind:"p2p",panel:"uniplay",path:"/renovar/p2p/uniplay"});
    assert.deepEqual(panelRouteForClient("Uniplay"),{kind:"iptv",panel:"uniplay",path:"/renovar/iptv/uniplay"});
    assert.equal(panelRouteForClient("Elite"),null);
  });
  it("always sends exactly one server cycle regardless of customer prepaid plan",()=>{
    assert.deepEqual(buildPanelRecargaBody("cliente_01",false),{usuario:"cliente_01",ciclos:1});
    assert.deepEqual(buildPanelRecargaBody("cliente_01",true),{usuario:"cliente_01",ciclos:1,simular:true});
  });
  it("accepts only an exact confirmed result, never a similar login",()=>{
    const success={ok:true,resultados:[{usuario:"cliente_01",ok:true,pedido_id:"QX7ABC",vencimento_novo:"01/12/2026 15:00:00"}]};
    assert.equal(parsePanelRecargaResponse(200,success,"cliente_01").status,"confirmed");
    assert.equal(parsePanelRecargaResponse(200,success,"cliente_02").status,"uncertain");
    assert.equal(isExternalSyncSafe(parsePanelRecargaResponse(200,success,"cliente_01",true)),false);
  });
  it("blocks sync on waiting session, partial batch, unknown and uncertain result",()=>{
    assert.equal(parsePanelRecargaResponse(202,{ok:false,precisa_login:true},"one").status,"waiting");
    assert.equal(parsePanelRecargaResponse(207,{ok:true,resultados:[{usuario:"one",ok:true}]},"one").status,"uncertain");
    assert.equal(parsePanelRecargaResponse(200,{ok:true,resultados:[{usuario:"one",ok:true,incerto:true}]},"one").status,"uncertain");
    assert.equal(parsePanelRecargaResponse(200,{},"one").status,"uncertain");
    assert.equal(parsePanelRecargaResponse(503,{},"one").status,"uncertain");
  });
  it("never treats a bad request as successful",()=>{
    assert.equal(parsePanelRecargaResponse(401,{ok:false,erro:"Token inválido"},"one").status,"failed");
    assert.equal(parsePanelRecargaResponse(422,{ok:false,erro:"Chave reutilizada"},"one").status,"failed");
  });
});

describe("Provider dates",()=>{
  it("parses dd/MM/yyyy and ISO, and rejects invalid dates",()=>{
    assert.equal(panelDateToISO("04/11/2026 17:12:51"),"2026-11-04");
    assert.equal(panelDateToISO("2026-11-04T17:12:51"),"2026-11-04");
    assert.equal(panelDateToISO("31/02/2026 10:00:00"),null);
    assert.equal(panelDateToISO(undefined),null);
  });
});


describe("Read-only panel expiry inspection",()=>{
  it("extracts expiry only from exact-login successful simulation",()=>{
    const response={ok:true,resultados:[{ok:true,usuario:"cliente1",vencimento_antes:"10/11/2026 10:00:00",vencimento_novo:"10/12/2026 10:00:00"}]};
    const match=parsePanelRecargaResponse(200,response,"cliente1",true);
    assert.equal(match.status,"simulated");
    assert.equal(match.previousDue,"2026-11-10");
    assert.equal(match.nextDue,undefined);
    const wrong=parsePanelRecargaResponse(200,response,"cliente2",true);
    assert.equal(wrong.status,"failed");
    assert.equal(wrong.previousDue,undefined);
  });
  it("never guesses expiry from projected new date or an invalid date",()=>{
    for(const response of [
      {ok:true,resultados:[{ok:true,usuario:"cliente1",vencimento_novo:"10/12/2026 10:00:00"}]},
      {ok:true,resultados:[{ok:true,usuario:"cliente1",vencimento_antes:"31/02/2026 10:00:00"}]},
    ]) {
      const outcome=parsePanelRecargaResponse(200,response,"cliente1",true);
      assert.equal(outcome.status,"simulated");
      assert.equal(outcome.previousDue,undefined);
    }
  });
});

describe("Financial coverage safety",()=>{
  const month={months:1,dueDate:"2026-12-10",financialDueDate:"2026-12-10",paymentAmount:35,monthlyPaid:35,paymentCost:6};
  it("allows a new paid month when technical and financial dates were equal",()=>{
    assert.equal(financialTransitionError({due_date:"2026-11-10",financial_due_date:"2026-11-10"},month),null);
  });
  it("requires both dates to advance together for a new monthly payment",()=>{
    assert.match(financialTransitionError({due_date:"2026-11-10",financial_due_date:"2026-11-10"},
      {...month,financialDueDate:"2027-01-10"})??" ",/juntos/);
  });
  it("preserves prepaid financial due date without creating payment",()=>{
    const current={due_date:"2026-11-10",financial_due_date:"2027-03-10"};
    const planned={...month,financialDueDate:"2027-03-10",paymentAmount:0,monthlyPaid:0,paymentCost:0};
    assert.equal(financialTransitionError(current,planned),null);
    assert.match(financialTransitionError(current,{...planned,financialDueDate:"2027-04-10"})??" ",/preservado/);
    assert.match(financialTransitionError(current,{...planned,paymentAmount:35})??" ",/cobrança/);
    assert.match(financialTransitionError(current,{...planned,dueDate:"2027-04-10"})??" ",/ultrapassa/);
  });
});
