import {describe,it} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {panelRouteForClient,buildPanelRecargaBody,parsePanelRecargaResponse,isExternalSyncSafe,panelDateToISO,financialTransitionError,confirmedRenewalDatesFromPanel} from "./painel-recarga";

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
    const accidentalTwo={ok:true,resultados:[{usuario:"cliente_01",ok:true,ciclos_feitos:2,vencimento_novo:"01/12/2026 15:00:00"}]};
    assert.equal(parsePanelRecargaResponse(200,accidentalTwo,"cliente_01").status,"uncertain");
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

describe("Persistent simulation idempotency contract (static guards)",()=>{
  const edge=readFileSync(new URL("../../supabase/functions/painel-recarga-renovar/index.ts",import.meta.url),"utf8");
  const migration=readFileSync(new URL("../../supabase/migrations/20261105110000_external_simulation_jobs.sql",import.meta.url),"utf8");
  it("never invents a new key for an existing queued simulation",()=>{
    assert.match(edge,/"Idempotency-Key":simulationJob\.idempotency_key/);
    assert.match(edge,/\.in\("state",\["created","waiting","uncertain"\]\)/);
    assert.match(edge,/mode==="check_simulation"/);
    const simBranch=edge.slice(edge.indexOf('// SIMULATIONS ONLY:'),edge.indexOf('if(Deno.env.get("PAINEL_RECARGA_LIVE_ENABLED")'));
    assert.doesNotMatch(simBranch,/crypto\.randomUUID\(\)/);
  });
  it("durably reserves one pending attempt for each client and restricts access",()=>{
    assert.match(migration,/CREATE UNIQUE INDEX IF NOT EXISTS external_simulation_jobs_one_pending/);
    assert.match(migration,/WHERE state IN \('created','waiting','uncertain'\)/);
    assert.match(migration,/ALTER TABLE public\.external_simulation_jobs ENABLE ROW LEVEL SECURITY/);
    assert.match(migration,/GRANT SELECT, INSERT, UPDATE/);
    assert.doesNotMatch(migration,/GRANT[^\n]*DELETE/);
  });
  it("keeps external renewals disabled by their own explicit server-side switch",()=>{
    assert.match(edge,/PAINEL_RECARGA_LIVE_ENABLED/);
    assert.match(edge,/mode==="simulate"\|\|mode==="check_simulation"/);
  });
});

describe("Provider-authoritative renewal dates (no actual payments)",()=>{
  const due="2026-11-10";
  const client={due_date:due,financial_due_date:due};
  const monthly={months:1,dueDate:"2026-12-10",financialDueDate:"2026-12-10",paymentAmount:35,monthlyPaid:35,paymentCost:6};
  const check=(c:typeof client,v:typeof monthly,newDue:string,prev:string|undefined=due)=>
    confirmedRenewalDatesFromPanel(c,v,newDue,prev,"2026-11-05");
  it("monthly with equal dates follows the panel's actual new expiry for BOTH dates",()=>{
    assert.deepEqual(check(client,monthly,"15/12/2026 16:00:00"),{
      dueDate:"2026-12-15",financialDueDate:"2026-12-15",blockedReason:null,
    });
  });
  it("a paid 6-month package starts with one provider cycle and 6 total months",()=>{
    const semi={...monthly,months:6,dueDate:"2026-12-10",financialDueDate:"2027-05-10",paymentAmount:175};
    assert.deepEqual(check(client,semi,"10/12/2026 09:00:00"),{
      dueDate:"2026-12-10",financialDueDate:"2027-05-10",blockedReason:null,
    });
    assert.deepEqual(check(client,semi,"15/12/2026 09:00:00"),{
      dueDate:"2026-12-15",financialDueDate:"2027-05-15",blockedReason:null,
    });
  });
  it("a 12-month package advances finance without renewing 12 provider cycles",()=>{
    const year={...monthly,months:12,financialDueDate:"2027-11-10",paymentAmount:310};
    const result=check(client,year,"10/12/2026 09:00:00");
    assert.equal(result.dueDate,"2026-12-10");
    assert.equal(result.financialDueDate,"2027-11-10");
  });
  it("keeps the existing month-end anchor when actual panel date matches projection",()=>{
    const end={due_date:"2027-01-31",financial_due_date:"2027-01-31"};
    const plan={...monthly,months:6,dueDate:"2027-02-28",financialDueDate:"2027-07-31",paymentAmount:175};
    const result=confirmedRenewalDatesFromPanel(end,plan,"28/02/2027 00:00:00","31/01/2027 00:00:00","2027-01-20");
    assert.equal(result.financialDueDate,"2027-07-31");
  });
  it("preserves already-paid financial coverage without another payment",()=>{
    const prepaid={due_date:"2026-11-10",financial_due_date:"2027-03-10"};
    const values={...monthly,paymentAmount:0,monthlyPaid:0,paymentCost:0,financialDueDate:"2027-03-10"};
    assert.deepEqual(check(prepaid,values,"15/12/2026 09:00:00"),{
      dueDate:"2026-12-15",financialDueDate:"2027-03-10",blockedReason:null,
    });
    assert.match(check(prepaid,values,"15/04/2027 09:00:00").blockedReason??"",/ultrapassa/);
    assert.match(check(prepaid,{...values,paymentAmount:35},"15/12/2026 09:00:00").blockedReason??"",/Pacote já pago/);
  });
  it("cannot extend a new financial period without payment",()=>{
    const result=check(client,{...monthly,paymentAmount:0},"10/12/2026 09:00:00");
    assert.match(result.blockedReason??"",/sem pagamento/);
  });
  it("edge function uses provider-authoritative dates only after confirmation",()=>{
    const edge=readFileSync(new URL("../../supabase/functions/painel-recarga-renovar/index.ts",import.meta.url),"utf8");
    const confirmed=edge.slice(edge.indexOf('if(outcome.status==="confirmed"){'));
    assert.match(confirmed,/confirmedRenewalDatesFromPanel\(/);
    assert.match(confirmed,/financialTransitionError\(customer,validatedValues\)/);
    assert.match(confirmed,/local_values:validatedValues/);
    assert.doesNotMatch(confirmed,/providerDue!==job\.new_due_date/);
  });
  it("blocks a mismatch between confirmed previous expiry and local state",()=>{
    assert.match(check(client,monthly,"10/12/2026 09:00:00","09/11/2026 09:00:00").blockedReason??"",/difere/);
  });
  it("blocks invalid/missing provider expiry and technical date that did not advance",()=>{
    assert.ok(check(client,monthly,"not-a-date").blockedReason);
    assert.ok(check(client,monthly,"10/11/2026 12:00:00").blockedReason);
  });
});

describe("Atomic settlement of confirmed external renewal (contract guards)",()=>{
  const sql=readFileSync(new URL("../../supabase/migrations/20261105152000_atomic_external_renewal_sync.sql",import.meta.url),"utf8");
  const edge=readFileSync(new URL("../../supabase/functions/painel-recarga-renovar/index.ts",import.meta.url),"utf8");
  it("only posts a locally confirmed order into one database RPC transaction",()=>{
    assert.match(sql,/CREATE OR REPLACE FUNCTION public\.sync_external_renewal_job/);
    assert.match(sql,/SECURITY INVOKER/);
    assert.match(sql,/IF v_job\.state <> 'external_confirmed'/);
    assert.match(sql,/WHERE id = p_job_id\s+FOR UPDATE/);
    assert.match(sql,/WHERE id = v_job\.client_id FOR UPDATE/);
    assert.match(sql,/IF v_job\.state = 'synced'/);
    assert.match(sql,/INSERT INTO public\.payments/);
    assert.match(sql,/INSERT INTO public\.server_credit_movements/);
    assert.match(sql,/state='synced'/);
  });
  it("syncs by job ID instead of re-sending browser-provided financial values",()=>{
    const sync=edge.slice(edge.indexOf("  const syncLocal=async()=>{"),edge.indexOf('  if(job.state==="synced")'));
    assert.match(sync,/userDb\.rpc\("sync_external_renewal_job"/);
    assert.match(sync,/p_job_id:jobId/);
    assert.doesNotMatch(sync,/renew_client_with_credit/);
    assert.doesNotMatch(sync,/p_payment_amount:/);
  });
  it("refuses anonymous call, unconfirmed provider job and prepaid double payment",()=>{
    assert.match(sql,/REVOKE EXECUTE ON FUNCTION public\.sync_external_renewal_job\(uuid\) FROM PUBLIC, anon, authenticated/);
    assert.match(sql,/auth\.uid\(\)/);
    assert.match(sql,/IF v_payment_amount <> 0/);
    assert.match(sql,/v_job\.financial_due_date <> v_client\.financial_due_date/);
    assert.match(sql,/v_job\.new_due_date <= v_client\.due_date/);
  });
});
