import {describe,it} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {panelRouteForClient,buildPanelRecargaBody,parsePanelRecargaResponse,isExternalSyncSafe,panelDateToISO,financialTransitionError,confirmedRenewalDatesFromPanel,validatePanelRenewalDraft} from "./painel-recarga";

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
    assert.match(screen,/isFirstPilotClient\(c\)&&panelRouteForClient/);
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
    assert.match(screen,/enabled:PANEL_PILOT_UI_ENABLED/);
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
    assert.match(body,/paymentCost:prepaid\?0:/);
  });
});

describe("First real panel pilot is restricted to one backend-approved customer",()=>{
  const edge=readFileSync(new URL("../../supabase/functions/painel-recarga-renovar/index.ts",import.meta.url),"utf8");
  it("never starts a real renewal when the feature flag is disabled",()=>{
    assert.match(edge,/PAINEL_RECARGA_LIVE_ENABLED/);
    assert.match(edge,/if\(Deno\.env\.get\("PAINEL_RECARGA_LIVE_ENABLED"\)!=="true"\)/);
  });
  it("requires an exact client UUID allowlist before reading or creating real jobs",()=>{
    const gate=edge.indexOf('if(mode==="renew"){\n    const allowedPilotId=');
    const jobs=edge.indexOf('// For live operations, persist a stable idempotency key');
    assert.ok(gate>0&&jobs>gate);
    const guard=edge.slice(gate,jobs);
    assert.match(guard,/PAINEL_RECARGA_PILOT_CLIENT_ID/);
    assert.match(guard,/PAINEL_RECARGA_PILOT_EXPECTED_DUE_DATE/);
    assert.match(guard,/allowedPilotId!==customer\.id/);
    assert.match(guard,/allowedExpectedDue!==expected/);
    assert.match(guard,/customer\.financial_due_date!==customer\.due_date/);
    assert.match(guard,/return reply\(403,/);
  });
  it("first pilot rejects prepaid packages or multiple paid cycles",()=>{
    const block=edge.slice(edge.indexOf('if(mode==="renew"&&!job){'),edge.indexOf('// The API cycles are not the same as months'));
    assert.match(block,/values\.months!==1/);
    assert.match(block,/values\.paymentAmount<=0/);
  });
  it("continues to permit status checking of older authorized jobs",()=>{
    const gate=edge.slice(edge.indexOf('// SINGLE-CLIENT LIVE PILOT'),edge.indexOf('// For live operations, persist a stable idempotency key'));
    assert.match(gate,/if\(mode==="renew"\)/);
    assert.doesNotMatch(gate,/if\(mode==="check"\)/);
  });
  it("the read-only preview remains accessible without a pilot client configured",()=>{
    const preview=edge.indexOf('if(mode==="preflight"){');
    const pilot=edge.indexOf('PAINEL_RECARGA_PILOT_CLIENT_ID');
    assert.ok(preview>0&&pilot>preview);
  });
});

describe("Jardel pilot UI: one client, no accidental manual renewal",()=>{
  const screen=readFileSync(new URL("../routes/_authenticated/renovacoes.tsx",import.meta.url),"utf8");
  const publicEnv=readFileSync(new URL("../../.env",import.meta.url),"utf8");
  it("only reveals pilot actions to the preselected client and expected due date",()=>{
    assert.match(publicEnv,/^VITE_MAXFLIX_PANEL_PILOT=true$/m);
    assert.match(screen,/const FIRST_PILOT_CLIENT_ID = /);
    assert.match(screen,/const FIRST_PILOT_EXPECTED_DUE = "2026-11-19"/);
    assert.match(screen,/const isFirstPilotClient = /);
    assert.match(screen,/isFirstPilotClient\(c\)&&panelRouteForClient/);
    assert.match(screen,/isFirstPilotClient\(renewing\) && panelRouteForClient/);
    assert.match(screen,/if\(!isFirstPilotClient\(client\)/);
  });
  it("keeps ordinary manual renewals on other customers, but hides manual confirm during the Jardel pilot",()=>{
    assert.match(screen,/\{!onConfirmPilot && <Button/);
    assert.match(screen,/onConfirmPilot&&<div/);
    assert.match(screen,/Piloto inicial restrito a um mês, R\$ 30 recebidos/);
    assert.match(screen,/opts\.months!==1\|\|opts\.paid!==30\|\|opts\.monthlyCost!==6/);
  });
  it("continues to require preflight and final user confirmation for the actual pilot",()=>{
    const pilot=screen.slice(screen.indexOf("const confirmPanelPilot=async"),screen.indexOf("const confirmRenew = async"));
    assert.ok(pilot.indexOf('mode:"preflight"')>=0);
    assert.ok(pilot.indexOf('window.confirm(summary)')>pilot.indexOf('mode:"preflight"'));
    assert.ok(pilot.indexOf('mode:"renew"')>pilot.indexOf('window.confirm(summary)'));
  });
});
