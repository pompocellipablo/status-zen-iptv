import {describe,it} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {panelRouteForClient,buildPanelRecargaBody,parsePanelRecargaResponse,isExternalSyncSafe,panelDateToISO,financialTransitionError,confirmedRenewalDatesFromPanel,validatePanelRenewalDraft,parsePanelPilotBatch,rolloutRenewalIssue,lealPauloPackage6Issue,LEAL_PAULO_PACKAGE6,lealPauloPrepaidSecondIssue,LEAL_PAULO_PREPAID_SECOND} from "./painel-recarga";

describe("Rollout opt-in guards (no real requests)",()=>{
  const client={due_date:"2026-11-11",financial_due_date:"2026-11-11",
    access_type:"padrao",paid:35,cost:6,prev_paid:35};
  const monthly={months:1,dueDate:"2026-12-11",financialDueDate:"2026-12-11",
    cost:6,monthlyPaid:35,prevPaid:35,paymentAmount:35,paymentCost:6};
  it("uses two independent server flags and never sends real requests after code publication alone",()=>{
    const edge=readFileSync(new URL("../../supabase/functions/painel-recarga-renovar/index.ts",import.meta.url),"utf8");
    assert.match(edge,/PAINEL_RECARGA_ROLLOUT_ENABLED/);
    assert.match(edge,/PAINEL_RECARGA_LIVE_ENABLED/);
    assert.match(edge,/if\(!authorizedCase\)/);
    assert.match(edge,/rolloutRenewalIssue\(customer,values\)/);
    assert.match(edge,/rolloutEnabled:false/);
  });
  it("permits one paid monthly cycle only at exact price and cost",()=>{
    assert.equal(rolloutRenewalIssue(client,monthly),null);
    assert.match(String(rolloutRenewalIssue(client,{...monthly,paymentAmount:2})),/Plano mensal/);
    assert.match(String(rolloutRenewalIssue(client,{...monthly,cost:10})),/Custo/);
  });
  it("keeps prepaid finance fixed with zero payment and one credit",()=>{
    const prepaid={...client,due_date:"2026-11-11",financial_due_date:"2027-05-11",paid:0,prev_paid:35};
    const args={...monthly,months:1,financialDueDate:"2027-05-11",
      paymentAmount:0,paymentCost:0,monthlyPaid:0};
    assert.equal(rolloutRenewalIssue(prepaid,args),null);
    assert.match(String(rolloutRenewalIssue(prepaid,{...args,paymentAmount:35})),/Pacote ativo/);
    assert.match(String(rolloutRenewalIssue(prepaid,{...args,dueDate:"2027-06-11"})),/Pacote ativo/);
  });
  it("permits paid 6/12-month packages but blocks a one-month payment for a year",()=>{
    const six={...monthly,months:6,financialDueDate:"2027-05-11",
      monthlyPaid:0,paymentAmount:175,paymentCost:36};
    const annual={...monthly,months:12,financialDueDate:"2027-11-11",
      monthlyPaid:0,paymentAmount:310,paymentCost:72};
    assert.equal(rolloutRenewalIssue(client,six),null);
    assert.equal(rolloutRenewalIssue(client,annual),null);
    assert.match(String(rolloutRenewalIssue(client,{...annual,paymentAmount:35})),/Pacote/);
    assert.match(String(rolloutRenewalIssue(client,{...annual,financialDueDate:"2030-01-01"})),/cobertura/);
  });
  it("never enrolls complimentary clients into broad provider renewals",()=>{
    assert.match(String(rolloutRenewalIssue({...client,paid:0,access_type:"meu_acesso"},
      {...monthly,paymentAmount:0})),/gratuito/);
  });
});

describe("Immutable server-date correction audit",()=>{
  it("requires owner confirmation and prevents payment, credit or financial date edits",()=>{
    const sql=readFileSync(new URL("../../supabase/migrations/20261107020000_panel_date_correction_audit.sql",import.meta.url),"utf8");
    assert.match(sql,/CREATE TABLE IF NOT EXISTS public\.panel_due_date_corrections/);
    assert.match(sql,/ALTER TABLE public\.panel_due_date_corrections ENABLE ROW LEVEL SECURITY/);
    assert.match(sql,/p_confirmed IS DISTINCT FROM true/);
    assert.match(sql,/v_client\.financial_due_date<v_client\.due_date/);
    assert.match(sql,/j\.state IN/);
    assert.match(sql,/j\.state='completed'/);
    assert.match(sql,/UPDATE public\.clients SET due_date=p_panel_due_date/);
    assert.doesNotMatch(sql,/SET financial_due_date=/);
    assert.doesNotMatch(sql,/INSERT INTO public\.(payments|server_credit_movements)/);
    const ui=readFileSync(new URL("../routes/_authenticated/servidores.tsx",import.meta.url),"utf8");
    assert.match(ui,/supabase\.rpc\("approve_panel_date_correction"/);
    assert.match(ui,/Histórico de correções aprovadas/);
  });
});

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
    assert.match(check(prepaid,values,"15/04/2027 09:00:00").blockedReason??"",/ultrapassa|muito distante/);
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
  it("rejects a provider one-cycle reply that would advance access by a year",()=>{
    const result=check(client,monthly,"10/11/2027 09:00:00");
    assert.equal(result.dueDate,null);
    assert.match(result.blockedReason??"",/muito distante/);
  });
  it("allows up to a normal 30-day cycle from today when the original access is long expired",()=>{
    const expired={due_date:"2026-06-14",financial_due_date:"2026-06-14"};
    const values={...monthly,dueDate:"2026-12-05",financialDueDate:"2026-12-05"};
    const result=confirmedRenewalDatesFromPanel(expired,values,"05/12/2026 10:00:00",
      "14/06/2026 10:00:00","2026-11-05");
    assert.deepEqual(result,{dueDate:"2026-12-05",financialDueDate:"2026-12-05",blockedReason:null});
  });
  it("keeps early renewals anchored to the current technical due date",()=>{
    const early={due_date:"2026-12-15",financial_due_date:"2026-12-15"};
    const value={...monthly,dueDate:"2027-01-15",financialDueDate:"2027-01-15"};
    const result=confirmedRenewalDatesFromPanel(early,value,"15/01/2027 09:00:00",
      "15/12/2026 09:00:00","2026-11-05");
    assert.equal(result.blockedReason,null);
    assert.equal(result.financialDueDate,"2027-01-15");
  });
  it("blocks invalid/missing provider expiry and technical date that did not advance",()=>{
    assert.ok(check(client,monthly,"not-a-date").blockedReason);
    assert.ok(check(client,monthly,"10/11/2026 12:00:00").blockedReason);
  });
});

describe("Safe package preflight - no provider calls",()=>{
  const client={due_date:"2026-11-10",financial_due_date:"2026-11-10",access_type:"padrao",paid:35};
  const month={months:1,dueDate:"2026-12-10",financialDueDate:"2026-12-10",
    paymentAmount:35,monthlyPaid:35,paymentCost:6};
  it("6 months: charge once, send ONE technical cycle, preserve 6-month coverage",()=>{
    const plan={...month,months:6,financialDueDate:"2027-05-10",
      paymentAmount:175,monthlyPaid:0,paymentCost:36};
    assert.equal(validatePanelRenewalDraft(client,plan,"2026-11-06"),null);
    assert.deepEqual(confirmedRenewalDatesFromPanel(client,plan,
      "10/12/2026 12:00:00","10/11/2026 12:00:00","2026-11-06"),
      {dueDate:"2026-12-10",financialDueDate:"2027-05-10",blockedReason:null});
    assert.deepEqual(buildPanelRecargaBody("cliente_pacote",false),
      {usuario:"cliente_pacote",ciclos:1});
  });
  it("12 months: financial paid-through moves a year, server only one month",()=>{
    const plan={...month,months:12,financialDueDate:"2027-11-10",
      paymentAmount:320,monthlyPaid:0,paymentCost:72};
    assert.equal(validatePanelRenewalDraft(client,plan,"2026-11-06"),null);
    assert.deepEqual(confirmedRenewalDatesFromPanel(client,plan,
      "10/12/2026 12:00:00","10/11/2026 12:00:00","2026-11-06"),
      {dueDate:"2026-12-10",financialDueDate:"2027-11-10",blockedReason:null});
    assert.deepEqual(buildPanelRecargaBody("cliente_anual",false),
      {usuario:"cliente_anual",ciclos:1});
  });
  it("already-paid package: renew technical cycle with no new money",()=>{
    const existing={...client,financial_due_date:"2027-05-10"};
    const paidThrough={...month,monthlyPaid:0,paymentAmount:0,paymentCost:0,
      financialDueDate:"2027-05-10"};
    assert.equal(validatePanelRenewalDraft(existing,paidThrough,"2026-11-06"),null);
    assert.deepEqual(confirmedRenewalDatesFromPanel(existing,paidThrough,
      "10/12/2026 12:00:00","10/11/2026 12:00:00","2026-11-06"),
      {dueDate:"2026-12-10",financialDueDate:"2027-05-10",blockedReason:null});
    assert.match(validatePanelRenewalDraft(existing,{...paidThrough,
      paymentAmount:35},"2026-11-06")??"",/Pacote já pago/);
  });
  it("rejects provider next-cycle beyond prepaid financial end",()=>{
    const existing={...client,financial_due_date:"2026-11-20"};
    const plan={...month,monthlyPaid:0,paymentAmount:0,paymentCost:0,
      financialDueDate:"2026-11-20"};
    assert.match(validatePanelRenewalDraft(existing,plan,"2026-11-06")??"",
      /não cobre|financeiro/i);
    assert.ok(confirmedRenewalDatesFromPanel(existing,plan,
      "10/12/2026 12:00:00","10/11/2026 12:00:00","2026-11-06").blockedReason);
  });
});

describe("Brazil business date posting, regression",()=>{
  const migration=readFileSync(new URL("../../supabase/migrations/20261106230000_renewal_business_date_sao_paulo.sql",import.meta.url),"utf8");
  it("patches all three renewal transactions and guards against schema drift",()=>{
    for(const fn of ["renew_client_with_credit","sync_external_renewal_job","sync_external_free_pilot_job"]){
      assert.match(migration,new RegExp(fn));
    }
    assert.match(migration,/America\/Sao_Paulo/);
    assert.match(migration,/v_occurrences<>v_expected/);
    assert.match(migration,/EXECUTE replace\(v_definition,'CURRENT_DATE'/);
  });
  it("limits historic date correction to audited exact payment and credit IDs",()=>{
    assert.match(migration,/f94201af-21ac-4763-b4c5-c224b96de125/);
    assert.match(migration,/38e6aae7-dc43-432e-8002-1d449a81cf82/);
    assert.match(migration,/67563f4b-9cf7-40a2-8e3f-aee26ec88ea8/);
    assert.match(migration,/GET DIAGNOSTICS v_count=ROW_COUNT/);
    assert.doesNotMatch(migration,/UPDATE public\.clients\b/);
    assert.doesNotMatch(migration,/INSERT INTO public\.payments\b/);
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
    assert.match(sync,/freePilot\?"sync_external_free_pilot_job":"sync_external_renewal_job"/);
    assert.match(sync,/p_job_id:jobId/);
    assert.doesNotMatch(sync,/renew_client_with_credit/);
    assert.doesNotMatch(sync,/p_payment_amount:/);
  });
  it("refuses anonymous call, unconfirmed provider job and prepaid double payment",()=>{
    assert.match(sql,/REVOKE EXECUTE ON FUNCTION public\.sync_external_renewal_job\(uuid\) FROM PUBLIC, anon, authenticated/);
    assert.match(sql,/auth\.uid\(\)/);
    assert.match(sql,/OR v_payment_amount <> 0/);
    assert.match(sql,/v_job\.financial_due_date <> v_client\.financial_due_date/);
    assert.match(sql,/v_job\.new_due_date <= v_client\.due_date/);
  });
});

describe("Manual versus external renewal concurrency guard",()=>{
  const sql=readFileSync(new URL("../../supabase/migrations/20261105153000_guard_manual_renewal_during_external_job.sql",import.meta.url),"utf8");
  const edge=readFileSync(new URL("../../supabase/functions/painel-recarga-renovar/index.ts",import.meta.url),"utf8");
  it("keeps existing manual RPC API and rejects open external jobs before payment",()=>{
    assert.match(sql,/CREATE OR REPLACE FUNCTION public\.renew_client_with_credit/);
    assert.match(sql,/IF EXISTS \([\s\S]*?FROM public\.external_renewal_jobs/);
    assert.match(sql,/state IN \('created','waiting','uncertain','external_confirmed','needs_review'\)/);
    assert.ok(sql.indexOf("state IN ('created'")<sql.indexOf("UPDATE public.clients"));
  });
  it("revalidates current login and expiry before the first external send",()=>{
    const part=edge.slice(edge.indexOf('if(job.state==="created"){'),edge.indexOf('const route=panelRouteForClient(job.server)'));
    assert.match(part,/select\("due_date,login,server"\)/);
    assert.match(part,/latestClient\.due_date!==expected/);
    assert.match(part,/state:"needs_review"/);
  });
});

describe("Supervised pilot UI safety",()=>{
  const screen=readFileSync(new URL("../routes/_authenticated/renovacoes.tsx",import.meta.url),"utf8");
  it("uses an opt-in frontend gate, with existing manual renewal preserved",()=>{
    assert.match(screen,/const PANEL_PILOT_UI_ENABLED = import\.meta\.env(?:\["VITE_MAXFLIX_PANEL_PILOT"\]|\.VITE_MAXFLIX_PANEL_PILOT) === "true";/);
    assert.match(screen,/const isExternalTarget=/);
    assert.match(screen,/isExternalTarget\(c,pilotTargetsQuery\.data\)/);
    assert.match(screen,/supabase\.rpc\("renew_client_with_credit"/);
  });
  it("requires a named-client confirmation before making an external request",()=>{
    const handler=screen.slice(screen.indexOf("const confirmPanelPilot=async"),screen.indexOf("const confirmRenew = async"));
    assert.match(handler,/window\.confirm\(summary\)/);
    assert.match(handler,/mode:"renew",confirm:true,clientId:client\.id/);
    assert.match(handler,/Ciclos no servidor: 1/);
    assert.match(handler,/hasPrepaidCoverage&&!covered/);
    assert.match(handler,/Concilie o saldo do pacote antes de renovar no painel/);
  });
  it("tracks external status with the same job, not another confirm call",()=>{
    const check=screen.slice(screen.indexOf("const verifyExternalPilotJob=async"),screen.indexOf("const confirmPanelPilot=async"));
    assert.match(check,/mode:"check"/);
    assert.doesNotMatch(check,/confirm:true/);
    assert.match(screen,/queryKey:\["external-renewal-jobs"\],[\s\S]*?enabled:true/);
  });
});

describe("Read-only provider renewal preflight (no remote requests)",()=>{
  const base={due_date:"2026-11-10",financial_due_date:"2026-11-10",access_type:"padrao"};
  const monthly={months:1,dueDate:"2026-12-10",financialDueDate:"2026-12-10",
    paymentAmount:35,monthlyPaid:35,paymentCost:6};
  const validate=(client:typeof base,opts:typeof monthly)=>validatePanelRenewalDraft(client,opts,"2026-11-05");
  it("accepts a monthly renewal with matching technical and financial due dates",()=>{
    assert.equal(validate(base,monthly),null);
  });
  it("accepts a paid six-month package without sending six provider cycles",()=>{
    assert.equal(validate(base,{...monthly,months:6,financialDueDate:"2027-05-10",
      paymentAmount:175,monthlyPaid:0,paymentCost:36}),null);
  });
  it("accepts a paid twelve-month package",()=>{
    assert.equal(validate(base,{...monthly,months:12,financialDueDate:"2027-11-10",
      paymentAmount:310,monthlyPaid:0,paymentCost:72}),null);
  });
  it("accepts a fully prepaid month without another payment or financial shift",()=>{
    const prepaid={...base,financial_due_date:"2027-03-10",access_type:"pacote_pago"};
    assert.equal(validate(prepaid,{...monthly,financialDueDate:"2027-03-10",
      paymentAmount:0,monthlyPaid:0,paymentCost:0}),null);
  });
  it("blocks a partially covered prepaid cycle and accidental double payment",()=>{
    const prepaid={...base,financial_due_date:"2026-11-20"};
    assert.match(validate(prepaid,{...monthly,financialDueDate:"2026-11-20",
      paymentAmount:0,monthlyPaid:0,paymentCost:0})??"",/não cobre/);
    const full={...base,financial_due_date:"2027-03-10"};
    assert.match(validate(full,{...monthly,financialDueDate:"2027-03-10",
      paymentAmount:35,monthlyPaid:0,paymentCost:0})??"",/Pacote já pago/);
  });
  it("rejects zero payment, free accounts, invalid dates, and payment before service",()=>{
    assert.match(validate(base,{...monthly,paymentAmount:0})??"",/pagamento positivo/);
    assert.match(validate({...base,access_type:"gratuidade"},monthly)??"",/gratuito/);
    assert.match(validate({...base,access_type:"meu_acesso"},monthly)??"",/gratuito/);
    assert.match(validate(base,{...monthly,dueDate:"2026-02-30"})??"",/Datas/);
    assert.match(validate(base,{...monthly,dueDate:"2026-12-10",financialDueDate:"2026-11-30"})??"",/não cobre/);
  });
  it("allows an overdue renewal starting on the actual payment date",()=>{
    const expired={...base,due_date:"2026-06-10",financial_due_date:"2026-06-10"};
    assert.equal(validate(expired,{...monthly,dueDate:"2026-12-05",financialDueDate:"2026-12-05"}),null);
  });
  it("rejects a suspiciously distant one-cycle projection",()=>{
    assert.match(validate(base,{...monthly,dueDate:"2027-11-10",financialDueDate:"2027-11-10"})??"",/distante/);
  });
  it("the Edge preview does not post to provider, create jobs or update the ledger",()=>{
    const edge=readFileSync(new URL("../../supabase/functions/painel-recarga-renovar/index.ts",import.meta.url),"utf8");
    const start=edge.indexOf('if(mode==="preflight"){');
    const end=edge.indexOf('// SIMULATIONS ONLY:',start);
    assert.ok(start>0&&end>start);
    const preview=edge.slice(start,end);
    assert.doesNotMatch(preview,/\bfetch\(/);
    assert.doesNotMatch(preview,/\.insert\(/);
    assert.doesNotMatch(preview,/\.update\(/);
    assert.doesNotMatch(preview,/\.rpc\(/);
    assert.match(preview,/providerRequestSent:false/);
    assert.match(preview,/validatePanelRenewalDraft/);
    assert.ok(edge.indexOf('if(mode==="preflight"){')<edge.indexOf('if(Deno.env.get("PAINEL_RECARGA_LIVE_ENABLED")'));
  });
  it("the pilot UI requests preflight before offering confirmation or real renewal",()=>{
    const screen=readFileSync(new URL("../routes/_authenticated/renovacoes.tsx",import.meta.url),"utf8");
    const begin=screen.indexOf("const confirmPanelPilot=async");
    const end=screen.indexOf("const confirmRenew = async",begin);
    assert.ok(begin>0&&end>begin);
    const pilot=screen.slice(begin,end);
    assert.ok(pilot.indexOf('mode:"preflight"')<pilot.indexOf("window.confirm(summary)"));
    assert.ok(pilot.indexOf("window.confirm(summary)")<pilot.indexOf('mode:"renew"'));
    assert.match(pilot,/preflight\.previewOnly!==true/);
    assert.match(pilot,/preflight\.providerRequestSent!==false/);
  });
});
describe("Per-client preview button (safe by default)",()=>{
  const screen=readFileSync(new URL("../routes/_authenticated/renovacoes.tsx",import.meta.url),"utf8");
  it("is separately available even while the live pilot is disabled",()=>{
    assert.match(screen,/Pré-validar renovação · sem alterar dados/);
    assert.match(screen,/setPreviewClient\(c\)/);
    assert.match(screen,/\{previewClient && \(/);
  });
  it("calls only the read-only preflight mode and never posts a renewal",()=>{
    const start=screen.indexOf("function PreflightDialog(");
    const end=screen.indexOf("function RenewDialog(",start);
    assert.ok(start>0 && end>start);
    const body=screen.slice(start,end);
    assert.match(body,/mode:"preflight"/);
    assert.doesNotMatch(body,/mode:"renew"|mode:"simulate"/);
    assert.doesNotMatch(body,/\.rpc\(/);
    assert.doesNotMatch(body,/\.update\(|\.insert\(|\.delete\(/);
    assert.match(body,/response\.providerRequestSent===false/);
    assert.match(body,/response\.previewOnly===true/);
  });
  it("previews one technical cycle and never charges a prepaid customer",()=>{
    const start=screen.indexOf("function PreflightDialog(");
    const end=screen.indexOf("function RenewDialog(",start);
    const body=screen.slice(start,end);
    assert.match(body,/const period=prepaid\?1:months/);
    assert.match(body,/const charged=prepaid\?0:num\(paid\)/);
    assert.match(body,/financialDue=prepaid\?/);
    assert.match(body,/paymentCost:prepaid\|\|pilotKind==="unpaid"\?0:/);
  });
});

describe("Batch pilot strict allowlist: a single setup for six providers",()=>{
  const a="11111111-1111-4111-8111-111111111111";
  const b="22222222-2222-4222-8222-222222222222";
  const c="33333333-3333-4333-8333-333333333333";
  const first={clientId:a,expectedDueDate:"2026-11-08",server:"Five",kind:"paid"};
  const second={clientId:b,expectedDueDate:"2026-11-20",server:"Uniplay",kind:"paid"};
  it("parses exact authorized client, server, and due-date pairs",()=>{
    assert.deepEqual(parsePanelPilotBatch(JSON.stringify([first,second])),[first,second]);
  });
  it("fails closed for missing, malformed, empty, or oversized allowlists",()=>{
    assert.deepEqual(parsePanelPilotBatch(undefined),[]);
    assert.deepEqual(parsePanelPilotBatch("not json"),[]);
    assert.deepEqual(parsePanelPilotBatch("[]"),[]);
    assert.deepEqual(parsePanelPilotBatch("x".repeat(4097)),[]);
  });
  it("rejects duplicates, unknown server, invalid date, and invalid id",()=>{
    for(const cases of [
      [first,{...first,clientId:c}],
      [first,{...second,clientId:a}],
      [{...first,server:"GF"}],
      [{...first,server:"Elite"}],
      [{...first,server:"Fast"}],
      [{...first,expectedDueDate:"2026-02-30"}],
      [{...first,clientId:"bad"}],
    ])assert.deepEqual(parsePanelPilotBatch(JSON.stringify(cases)),[]);
  });
  it("denies any batch entry without an explicit paid/unpaid type",()=>{
    assert.deepEqual(parsePanelPilotBatch(JSON.stringify([{clientId:a,expectedDueDate:"2026-11-08",server:"Five"}])),[]);
    assert.deepEqual(parsePanelPilotBatch(JSON.stringify([{...first,kind:"admin"}])),[]);
  });
  it("unpaid technical pilots allow one zero-revenue month and preserve date safety",()=>{
    const freeClient={due_date:"2026-11-30",financial_due_date:"2026-11-30",access_type:"meu_acesso",paid:0};
    const freeValues={months:1,dueDate:"2026-12-30",financialDueDate:"2026-12-30",
      paymentAmount:0,paymentCost:0,monthlyPaid:0,pilotKind:"unpaid" as const};
    assert.equal(validatePanelRenewalDraft(freeClient,freeValues,"2026-11-06"),null);
    assert.deepEqual(confirmedRenewalDatesFromPanel(freeClient,freeValues,"2026-12-30","2026-11-30","2026-11-06"),
      {dueDate:"2026-12-30",financialDueDate:"2026-12-30",blockedReason:null});
    assert.match(String(validatePanelRenewalDraft(freeClient,{...freeValues,paymentAmount:30},"2026-11-06")),/gratuito/i);
    assert.match(String(validatePanelRenewalDraft({...freeClient,paid:30},freeValues,"2026-11-06")),/gratuito/i);
    assert.match(String(validatePanelRenewalDraft({...freeClient,financial_due_date:"2027-01-30"},freeValues,"2026-11-06")),/gratuito/i);
    assert.equal(confirmedRenewalDatesFromPanel(freeClient,freeValues,"2027-02-02","2026-11-30","2026-11-06").dueDate,null);
    assert.equal(confirmedRenewalDatesFromPanel(freeClient,freeValues,"2026-12-30","2026-12-01","2026-11-06").dueDate,null);
  });
  it("free settlement uses isolated owner-only function, not a paid payment ledger",()=>{
    const db=readFileSync(new URL("../../supabase/migrations/20261106190000_free_panel_pilot_settlement.sql",import.meta.url),"utf8");
    assert.match(db,/CREATE OR REPLACE FUNCTION public\.sync_external_free_pilot_job/);
    assert.match(db,/SECURITY INVOKER/);
    assert.match(db,/v_job\.state<>'external_confirmed'/);
    assert.match(db,/v_client\.paid<>0/);
    assert.match(db,/v_values->>'pilotKind' IS DISTINCT FROM 'unpaid'/);
    assert.match(db,/INSERT INTO public\.server_credit_movements/);
    assert.doesNotMatch(db,/INSERT INTO public\.payments/);
    const edge=readFileSync(new URL("../../supabase/functions/painel-recarga-renovar/index.ts",import.meta.url),"utf8");
    assert.match(edge,/freePilot\?"sync_external_free_pilot_job":"sync_external_renewal_job"/);
  });
  it("limits to six distinct supported providers",()=>{
    const all=["Five","Uniplay","UniP2P","Blade","Now","All Play"].map((server,i)=>({
      clientId:String(i+1).repeat(8)+"-"+String(i+1).repeat(4)+"-4"+String(i+1).repeat(3)
        +"-8"+String(i+1).repeat(3)+"-"+String(i+1).repeat(12),
      expectedDueDate:"2026-11-08",server,kind:i>=3?"unpaid":"paid",
    }));
    assert.equal(parsePanelPilotBatch(JSON.stringify(all)).length,6);
    assert.deepEqual(parsePanelPilotBatch(JSON.stringify([...all,first])),[]);
  });
  const edge=readFileSync(new URL("../../supabase/functions/painel-recarga-renovar/index.ts",import.meta.url),"utf8");
  const screen=readFileSync(new URL("../routes/_authenticated/renovacoes.tsx",import.meta.url),"utf8");
  it("backend requires global live flag AND exact batch case before provider renewal",()=>{
    const live=edge.indexOf('if(Deno.env.get("PAINEL_RECARGA_LIVE_ENABLED")!=="true"&&!exclusivePilotLive)');
    const guard=edge.indexOf('// SIX-SERVER BATCH PILOT');
    const reserve=edge.indexOf('// For live operations, persist a stable idempotency key');
    assert.ok(live>0&&guard>live&&reserve>guard);
    const code=edge.slice(guard,reserve);
    assert.match(code,/mode==="renew"/);
    assert.match(code,/item\.clientId===customer\.id/);
    assert.match(code,/item\.server===customer\.server/);
    assert.match(code,/item\.expectedDueDate===expected/);
    assert.match(code,/return reply\(403/);
  });
  it("keeps authorizedCase in function scope before both renewal guards",()=>{
    // Regression: a const inside if(mode==="renew") caused HTTP 500
    // ReferenceError in the later if(mode==="renew"&&!job) block.
    const index=edge.indexOf("const authorizedCase=packagePilot.find");
    const guard=edge.indexOf('if(mode==="renew"){',index);
    const job=edge.indexOf('if(mode==="renew"&&!job){',guard);
    const use=edge.indexOf('const amountsMatch=lealPauloPrepaidSecondIssue(customer,values)===null;',job);
    assert.ok(index>0 && guard>index && job>guard && use>job);
    assert.match(edge.slice(index,guard),/const authorizedCase=packagePilot\.find/);
    assert.match(edge.slice(job,use),/if\(authorizedCase\)/);
    assert.doesNotMatch(edge.slice(guard,job),/const authorizedCase=/);
  });
  it("never accepts prepaid package or edited payment amount during pilots",()=>{
    const block=edge.slice(edge.indexOf('if(mode==="renew"&&!job){'),
      edge.indexOf('// The API cycles are not the same as months'));
    assert.match(block,/const amountsMatch=lealPauloPrepaidSecondIssue\(customer,values\)===null/);
    assert.match(block,/if\(!amountsMatch\)/);
    assert.match(edge,/if\(!authorizedCase\)/);
  });
  it("read-only authorized targets do not call providers or mutate ledger",()=>{
    const begin=edge.indexOf('if(mode==="pilot_targets")');
    const end=edge.indexOf('if(typeof input.clientId',begin);
    assert.ok(begin>0&&end>begin);
    assert.match(edge.slice(begin,end),/readOnly:true/);
    assert.match(edge.slice(begin,end),/targets:packagePilot/);
    assert.doesNotMatch(edge.slice(begin,end),/\bfetch\(|\.update\(|\.insert\(|\.rpc\(/);
  });
  it("UI displays pilot buttons only for cases returned by owner-only backend",()=>{
    assert.match(screen,/mode:"pilot_targets"/);
    assert.match(screen,/const isPilotTarget=/);
    assert.match(screen,/isExternalTarget\(c,pilotTargetsQuery\.data\)/);
    assert.match(screen,/isExternalTarget\(renewing,pilotTargetsQuery\.data\)/);
    assert.match(screen,/if\(!isExternalTarget\(client,pilotTargetsQuery\.data\)/);
    assert.match(screen,/\{!onConfirmPilot && <Button/);
    assert.match(screen,/opts\.months!==1\|\|opts\.paid!==Number\(client\.paid\)/);
    assert.match(screen,/target\.kind==="unpaid"/);
  });
  it("pilot requires preflight before an individual human approval",()=>{
    const pilot=screen.slice(screen.indexOf("const confirmPanelPilot=async"),
      screen.indexOf("const confirmRenew = async"));
    assert.ok(pilot.indexOf('mode:"preflight"')>=0);
    assert.ok(pilot.indexOf('window.confirm(summary)')>pilot.indexOf('mode:"preflight"'));
    assert.ok(pilot.indexOf('mode:"renew"')>pilot.indexOf('window.confirm(summary)'));
  });
  it("keeps ordinary read-only preflight available to every client",()=>{
    const start=edge.indexOf('if(mode==="preflight"){');
    const end=edge.indexOf('// SIMULATIONS ONLY:',start);
    const preview=edge.slice(start,end);
    assert.match(preview,/if\(values\.pilotKind==="unpaid"&&selectedCase\?\.kind!=="unpaid"\)/);
    assert.doesNotMatch(preview,/if\(!selectedCase/);
  });
  it("read-only diagnosis never discloses raw secret, login password or token",()=>{
    const from=edge.indexOf('if(mode==="preflight"){');
    const until=edge.indexOf('// SIMULATIONS ONLY:',from);
    const preview=edge.slice(from,until);
    assert.match(preview,/pilotDiagnostic/);
    assert.match(preview,/providerRequestSent:false/);
    assert.doesNotMatch(preview,/\bfetch\(|\.insert\(|\.update\(|\.rpc\(/);
    assert.doesNotMatch(preview,/console\.log|PAINEL_RECARGA_TOKEN/);
  });
});

describe("Exact LealPaulo six-month pilot (no provider calls)",()=>{
  const client={
    id:LEAL_PAULO_PACKAGE6.clientId,login:"LealPaulo",server:"Five",
    due_date:"2026-11-19",financial_due_date:"2026-11-19",
    access_type:"padrao",paid:0,prev_paid:150,cost:6.50,
  };
  const values={
    months:6,dueDate:"2026-12-19",financialDueDate:"2027-05-19",
    cost:6.50,monthlyPaid:0,prevPaid:150,paymentAmount:150,paymentCost:39,
  };
  it("accepts only this exact 6-month R$150 case, one Five provider cycle",()=>{
    assert.equal(lealPauloPackage6Issue(client,values),null);
    assert.deepEqual(buildPanelRecargaBody("LealPaulo",false),
      {usuario:"LealPaulo",ciclos:1});
    assert.equal(validatePanelRenewalDraft(client,values,"2026-11-06"),null);
    assert.deepEqual(confirmedRenewalDatesFromPanel(client,values,
      "19/12/2026 00:00:00","19/11/2026 00:00:00","2026-11-06"),{
      dueDate:"2026-12-19",financialDueDate:"2027-05-19",blockedReason:null,
    });
  });
  it("fails closed for other clients, costs, packages, dates, access and money",()=>{
    const invalidClients=[
      {...client,id:"00000000-0000-0000-0000-000000000000"},
      {...client,login:"other"},
      {...client,server:"Club"},
      {...client,due_date:"2026-11-20"},
      {...client,financial_due_date:"2027-05-19"},
      {...client,paid:35},
      {...client,prev_paid:35},
      {...client,cost:7},
      {...client,access_type:"meu_acesso"},
    ];
    for(const c of invalidClients)assert.ok(lealPauloPackage6Issue(c,values));
    const invalidOptions=[
      {...values,months:1}, {...values,months:12},
      {...values,paymentAmount:35},{...values,paymentAmount:175},
      {...values,paymentCost:6.5},{...values,paymentCost:0},
      {...values,monthlyPaid:150},{...values,prevPaid:0},
      {...values,cost:7},{...values,dueDate:"2027-05-19"},
      {...values,financialDueDate:"2026-12-19"},
      {...values,pilotKind:"unpaid"},
    ];
    for(const opts of invalidOptions)assert.ok(lealPauloPackage6Issue(client,opts));
  });
  it("requires a separate private default-off switch and never enables bulk rollout",()=>{
    const edge=readFileSync(new URL("../../supabase/functions/painel-recarga-renovar/index.ts",import.meta.url),"utf8");
    const screen=readFileSync(new URL("../routes/_authenticated/renovacoes.tsx",import.meta.url),"utf8");
    assert.doesNotMatch(edge,/const packagePilot=packagePilotOn \? \[LEAL_PAULO_PACKAGE6\]/);
    assert.match(edge,/const packagePilot=packagePilotOn \? \[LEAL_PAULO_PREPAID_SECOND\]/);
    assert.match(edge,/const amountsMatch=lealPauloPrepaidSecondIssue\(customer,values\)===null/);
    assert.match(edge,/lealPauloPrepaidSecondIssue\(customer,values\)/);
    assert.match(edge,/PAINEL_RECARGA_LIVE_ENABLED/);
    assert.match(edge,/if\(!authorizedCase\)/);
    assert.match(screen,/pilotPackage6\s*\?\s*6\s*:\s*1/);
    assert.match(screen,/const isScopedPackageCandidate=/);
    assert.match(screen,/PANEL_PILOT_UI_ENABLED\|\|isScopedPackageCandidate\(c\)/);
    assert.match(screen,/opts\.months!==6\|\|opts\.paid!==150/);
    assert.match(screen,/mode:"preflight"/);
  });
});

describe("Temporary exclusive LealPaulo access (static backend security)",()=>{
  const edge=readFileSync(new URL("../../supabase/functions/painel-recarga-renovar/index.ts",import.meta.url),"utf8");
  it("hides old batch pilots and mass rollout from real-use discovery",()=>{
    const begin=edge.indexOf('if(mode==="pilot_targets")');
    const end=edge.indexOf('if(typeof input.clientId',begin);
    assert.ok(begin>0&&end>begin);
    const body=edge.slice(begin,end);
    assert.match(body,/targets:packagePilot/);
    assert.match(body,/rolloutEnabled:false/);
    assert.doesNotMatch(body,/targets:authorizedPilots/);
  });
  it("blocks every other client and old pilot before job access/provider POST",()=>{
    const gate=edge.indexOf('if((mode==="renew"||mode==="check")&&(');
    const jobs=edge.indexOf('const {data:stored,error:queryError}');
    const provider=edge.indexOf('response=await fetch(base+route.path',jobs);
    assert.ok(gate>0&&gate<jobs&&jobs<provider);
    const check=edge.slice(gate,jobs);
    assert.match(check,/!packagePilotOn/);
    assert.match(check,/customer\.id!==LEAL_PAULO_PREPAID_SECOND\.clientId/);
    assert.match(check,/customer\.login!=="LealPaulo"/);
    assert.match(check,/customer\.server!==LEAL_PAULO_PREPAID_SECOND\.server/);
    assert.match(check,/expected!==LEAL_PAULO_PREPAID_SECOND\.expectedDueDate/);
    assert.match(check,/return reply\(403/);
    assert.match(check,/mode==="renew"&&!exclusiveWindowOpen/);
  });
  it("enables only a new scoped secret without changing the old global live flag",()=>{
    const gate=edge.indexOf('if((mode==="renew"||mode==="check")&&(');
    const scoped=edge.indexOf('const exclusivePilotLive=packagePilotOn');
    const request=edge.indexOf('const {data:stored,error:queryError}');
    assert.ok(gate>0 && scoped>gate && request>scoped);
    assert.match(edge,/PAINEL_RECARGA_LEALPAULO_PREPAID2_LIVE_ENABLED/);
    assert.match(edge,/if\(Deno\.env\.get\("PAINEL_RECARGA_LIVE_ENABLED"\)!=="true"&&!exclusivePilotLive\)/);
    assert.match(edge,/liveEnabled:packagePilotOn&&exclusiveWindowOpen/);
    assert.match(edge,/const authorizedCase=packagePilot\.find/);
  });
  it("closes new renewals at 03:00 BRT, while allowing same-job check reconciliation",()=>{
    assert.match(edge,/Date\.parse\("2026-11-07T06:00:00Z"\)/);
    assert.match(edge,/const exclusiveWindowOpen=Date\.now\(\)<exclusiveLiveUntilMs/);
    assert.match(edge,/if\(mode==="renew"&&!exclusiveWindowOpen\)/);
    assert.doesNotMatch(edge,/mode==="check"&&!exclusiveWindowOpen/);
    assert.match(edge,/liveEnabled:packagePilotOn&&exclusiveWindowOpen/);
    assert.match(edge,/mode==="check"&&!job/);
  });
});

describe("LealPaulo already-paid second technical cycle (no provider calls)",()=>{
  const c={
    id:LEAL_PAULO_PREPAID_SECOND.clientId,login:"LealPaulo",server:"Five",
    due_date:"2026-12-19",financial_due_date:"2027-05-19",
    access_type:"padrao",paid:0,prev_paid:150,cost:6.5,
  };
  const v={
    months:1,dueDate:"2027-01-19",financialDueDate:"2027-05-19",
    cost:6.5,monthlyPaid:0,prevPaid:150,paymentAmount:0,paymentCost:0,
  };
  it("moves only the technical due date and uses one credit with no second payment",()=>{
    assert.equal(lealPauloPrepaidSecondIssue(c,v),null);
    assert.equal(validatePanelRenewalDraft(c,v,"2026-11-07"),null);
    assert.equal(financialTransitionError(c,v),null);
    assert.deepEqual(confirmedRenewalDatesFromPanel(c,v,
      "19/01/2027 00:00:00","19/12/2026 00:00:00","2026-11-07"),{
      dueDate:"2027-01-19",financialDueDate:"2027-05-19",blockedReason:null,
    });
    assert.deepEqual(buildPanelRecargaBody(c.login,false),
      {usuario:"LealPaulo",ciclos:1});
  });
  it("rejects the old first-cycle due date, another account, and changed financial coverage",()=>{
    for(const altered of [
      {...c,due_date:"2026-11-19"},
      {...c,due_date:"2027-01-19"},
      {...c,id:"00000000-0000-0000-0000-000000000000"},
      {...c,login:"LealPaulo2"},
      {...c,server:"Club"},
      {...c,financial_due_date:"2027-06-19"},
      {...c,paid:35},
      {...c,prev_paid:0},
      {...c,cost:7},
      {...c,access_type:"gratuidade"},
    ]) assert.ok(lealPauloPrepaidSecondIssue(altered,v));
  });
  it("refuses new revenue, future prepaid extension, wrong credit cost and months",()=>{
    for(const altered of [
      {...v,paymentAmount:150},{...v,paymentAmount:35},
      {...v,paymentCost:6.5},{...v,monthlyPaid:35},
      {...v,months:2},{...v,months:6},
      {...v,financialDueDate:"2027-06-19"},
      {...v,dueDate:"2027-02-19"},
      {...v,cost:13},{...v,prevPaid:0},
      {...v,pilotKind:"unpaid"},
    ]) assert.ok(lealPauloPrepaidSecondIssue(c,altered));
  });
  it("can be confirmed in UI only through scoped pilot and accepts zero payment",()=>{
    const screen=readFileSync(new URL("../routes/_authenticated/renovacoes.tsx",import.meta.url),"utf8");
    const edge=readFileSync(new URL("../../supabase/functions/painel-recarga-renovar/index.ts",import.meta.url),"utf8");
    assert.match(screen,/target\?\.kind==="prepaid2"/);
    assert.match(screen,/pilotPrepaid2/);
    assert.match(screen,/\(!pilotPrepaid2&&paidValue<=0\)/);
    assert.match(screen,/opts\.months!==1\|\|opts\.paid!==0/);
    assert.match(edge,/PAINEL_RECARGA_LEALPAULO_PREPAID2_ENABLED/);
    assert.match(edge,/PAINEL_RECARGA_LEALPAULO_PREPAID2_LIVE_ENABLED/);
    assert.match(edge,/if\(authorizedCase\?\.kind!=="prepaid2"/);
    assert.match(edge,/const authorizedCase=packagePilot\.find/);
    assert.doesNotMatch(edge,/const packagePilot=packagePilotOn \? \[LEAL_PAULO_PACKAGE6\]/);
  });
});
