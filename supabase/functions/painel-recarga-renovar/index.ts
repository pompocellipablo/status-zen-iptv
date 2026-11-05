/**
 * Server-only Painel Recarga bridge.
 *
 * IMPORTANT:
 * - This is inert until PAINEL_RECARGA_ENABLED=true, and real renewals are
 *   further gated behind PAINEL_RECARGA_LIVE_ENABLED=true.
 * - Save PAINEL_RECARGA_TOKEN only as an Edge Function secret, never VITE_*.
 * - Do not use the browser to call the provider API directly.
 * - For every new MaxFlix monthly renewal, send ONE external cycle (ciclos:1).
 * - 202, 207, incerto, network timeouts, or failed results NEVER commit locally.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildPanelRecargaBody, confirmedRenewalDatesFromPanel, financialTransitionError, panelRouteForClient, parsePanelRecargaResponse, validatePanelRenewalDraft,
  RECARGA_BASE_URL, type ExternalOutcome,
} from "../_shared/painel-recarga.ts";

const ownerId="c70b3e1f-e5d2-4caf-ae09-019964dbf30e";
const headers={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization,apikey,x-client-info,content-type",
  "Access-Control-Allow-Methods":"POST,OPTIONS",
  "Content-Type":"application/json; charset=utf-8",
};
const reply=(status:number,payload:Record<string,unknown>)=>
  new Response(JSON.stringify(payload),{status,headers});
type Mode="simulate"|"check_simulation"|"preflight"|"renew"|"check";
type ClientRow={id:string;name:string;login:string;server:string;due_date:string;financial_due_date:string|null;access_type:string|null};
type Options={months:number;dueDate:string;financialDueDate:string;cost:number;monthlyPaid:number;prevPaid:number;paymentAmount:number;paymentCost:number};
type Job={
  id:string;client_id:string|null;login:string;server:string;expected_due_date:string;
  new_due_date:string;financial_due_date:string;idempotency_key:string;
  state:string;local_values:Options;external_order_id:string|null;
};
type SimulationJob={
  id:string;client_id:string|null;login:string;server:string;expected_due_date:string;
  idempotency_key:string;state:"created"|"waiting"|"uncertain"|"completed"|"failed";
  panel_due_date:string|null;external_order_id:string|null;external_message:string|null;
  external_http_status:number|null;created_at:string;
};
const isDate=(value:unknown):value is string=>typeof value==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(value);
const safeNumber=(value:unknown)=>typeof value==="number"&&Number.isFinite(value)&&value>=0&&value<=1_000_000;
function parseLocalOptions(input:unknown):Options|null{
  if(typeof input!=="object"||!input||Array.isArray(input))return null;
  const o=input as Record<string,unknown>;
  if(!Number.isInteger(o.months)||Number(o.months)<1||Number(o.months)>120)return null;
  if(!isDate(o.dueDate)||!isDate(o.financialDueDate)||o.financialDueDate<o.dueDate)return null;
  for(const key of ["cost","monthlyPaid","prevPaid","paymentAmount","paymentCost"]){
    if(!safeNumber(o[key]))return null;
  }
  return o as unknown as Options;
}

Deno.serve(async(request)=>{
  if(request.method==="OPTIONS")return new Response(null,{status:204,headers});
  if(request.method!=="POST")return reply(405,{ok:false,message:"Método não permitido."});
  if(Deno.env.get("PAINEL_RECARGA_ENABLED")!=="true")
    return reply(503,{ok:false,disabled:true,message:"Integração desativada até configuração e validação do token."});

  const supabaseUrl=Deno.env.get("SUPABASE_URL");
  const anonKey=Deno.env.get("SUPABASE_ANON_KEY")??Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  const token=Deno.env.get("PAINEL_RECARGA_TOKEN");
  if(!supabaseUrl||!anonKey||!token)
    return reply(503,{ok:false,message:"Integração sem credenciais seguras configuradas."});
  const bearer=request.headers.get("Authorization")??"";
  if(!bearer.startsWith("Bearer "))return reply(401,{ok:false,message:"Autenticação necessária."});
  const userDb=createClient(supabaseUrl,anonKey,{
    auth:{persistSession:false,autoRefreshToken:false},
    global:{headers:{Authorization:bearer}},
  });
  const {data:auth,error:authError}=await userDb.auth.getUser(bearer.slice(7));
  if(authError||auth.user?.id!==ownerId)
    return reply(403,{ok:false,message:"Conta não autorizada para renovações."});

  let input:Record<string,unknown>;
  try{
    const parsed=await request.json();
    if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))throw Error("Invalid JSON");
    input=parsed as Record<string,unknown>;
  }catch{
    return reply(400,{ok:false,message:"Corpo JSON inválido."});
  }
  const mode=input.mode as Mode;
  if(!["simulate","check_simulation","preflight","renew","check"].includes(mode))
    return reply(400,{ok:false,message:"Modo inválido."});
  if(typeof input.clientId!=="string"||!isDate(input.expectedDueDate))
    return reply(400,{ok:false,message:"Cliente e vencimento esperado obrigatórios."});
  const {data:client,error:clientError}=await userDb.from("clients")
    .select("id,name,login,server,due_date,financial_due_date,access_type")
    .eq("id",input.clientId).maybeSingle();
  if(clientError||!client)return reply(404,{ok:false,message:"Cliente não encontrado ou sem autorização."});
  const customer=client as ClientRow;
  if(!customer.login.trim())
    return reply(400,{ok:false,message:"Cliente sem login do painel."});
  const base=RECARGA_BASE_URL;
  const expected=input.expectedDueDate as string;


  // READ-ONLY PREVIEW. Never calls the provider, never reserves a job,
  // and never creates payments, credits or date changes.
  if(mode==="preflight"){
    if(customer.due_date!==expected)
      return reply(409,{ok:false,previewOnly:true,message:"Vencimento do cadastro alterado; atualize a página."});
    if(!panelRouteForClient(customer.server))
      return reply(422,{ok:false,previewOnly:true,message:"Servidor não homologado para esta integração."});
    const values=parseLocalOptions(input.options);
    if(!values)
      return reply(400,{ok:false,previewOnly:true,message:"Plano, valores ou vencimentos inválidos."});
    const issue=validatePanelRenewalDraft(customer,values,
      new Date().toLocaleDateString("sv-SE",{timeZone:"America/Sao_Paulo"}));
    if(issue)
      return reply(409,{ok:false,previewOnly:true,message:issue});
    const {data:existing,error:existingError}=await userDb.from("external_renewal_jobs")
      .select("id,state").eq("client_id",customer.id)
      .eq("expected_due_date",expected).maybeSingle();
    if(existingError)
      return reply(503,{ok:false,previewOnly:true,
        message:"Histórico externo indisponível. Não é seguro iniciar uma renovação."});
    if(existing)
      return reply(409,{ok:false,previewOnly:true,existingJob:true,jobState:existing.state,
        message:"Já existe pedido externo para este cliente e ciclo. Confira o pedido existente."});
    return reply(200,{ok:true,previewOnly:true,providerRequestSent:false,
      clientName:customer.name,server:customer.server,
      cycles:1,months:values.months,
      estimatedDueDate:values.dueDate,
      estimatedFinancialDueDate:values.financialDueDate,
      paymentAmount:values.paymentAmount,
      note:"Pré-visualização local aprovada. O vencimento técnico definitivo virá do painel após uma renovação real autorizada."});
  }

  // SIMULATIONS ONLY: the provider can queue an operation when the session is
  // offline. Persist the UUID BEFORE sending; reconnect/recheck MUST reuse it.
  // No provider call is allowed if the durable ledger cannot be reached.
  if(mode==="simulate"||mode==="check_simulation"){
    if(customer.due_date!==expected)
      return reply(409,{ok:false,message:"Vencimento alterado; atualize o cadastro antes da conferência."});
    const route=panelRouteForClient(customer.server);
    if(!route)return reply(422,{ok:false,message:"Este servidor ainda não possui rota de conferência validada."});

    const table=userDb.from("external_simulation_jobs");
    const active=await table.select("*").eq("client_id",customer.id)
      .in("state",["created","waiting","uncertain"]).maybeSingle();
    if(active.error)return reply(503,{ok:false,message:"Registro persistente de consultas indisponível. Nenhum pedido foi enviado."});
    let simulationJob=active.data as SimulationJob|null;

    if(simulationJob && (simulationJob.login!==customer.login||simulationJob.server!==customer.server||
      simulationJob.expected_due_date!==expected))
      return reply(409,{ok:false,pending:true,simulationJobId:simulationJob.id,
        message:"Existe uma consulta pendente para este cliente com dados anteriores. Confira a fila do Painel Recarga antes de iniciar outra."});

    // Don't create a fresh request if a recent identical check has already
    // succeeded or failed. A new check after the cache window is a new audit.
    if(!simulationJob){
      const recent=await table.select("*").eq("client_id",customer.id)
        .order("created_at",{ascending:false}).limit(1).maybeSingle();
      if(recent.error)return reply(503,{ok:false,message:"Histórico de consultas indisponível. Nenhum pedido foi enviado."});
      const previous=recent.data as SimulationJob|null;
      const same=!!previous&&previous.login===customer.login&&previous.server===customer.server
        &&previous.expected_due_date===expected;
      const finished=same&&(previous!.state==="completed"||previous!.state==="failed");
      const fresh=finished&&Number.isFinite(Date.parse(previous!.created_at))
        &&Date.now()-Date.parse(previous!.created_at)<120_000;
      if(finished&&(mode==="check_simulation"||fresh)){
        const ok=previous!.state==="completed";
        return reply(200,{ok,simulated:true,cached:true,dateInspectionSupported:true,
          simulationJobId:previous!.id,
          outcome:{status:ok?"simulated":"failed",
            message:previous!.external_message??(ok?"Simulação concluída.":"Simulação recusada.")},
          panelDueDate:ok?previous!.panel_due_date:null});
      }
      if(mode==="check_simulation")
        return reply(404,{ok:false,message:"Nenhuma consulta pendente para acompanhar. Use Conferir no painel."});

      const created=await table.insert({
        client_id:customer.id,login:customer.login,server:customer.server,
        expected_due_date:expected,state:"created",
      }).select("*").single();
      if(created.error){
        if(created.error.code!=="23505")
          return reply(503,{ok:false,message:"Não foi possível reservar a conferência. Nenhum pedido foi enviado."});
        // Another browser/tab won the unique pending-client reservation:
        // reuse the existing UUID rather than generating another provider job.
        const concurrent=await table.select("*").eq("client_id",customer.id)
          .in("state",["created","waiting","uncertain"]).maybeSingle();
        if(concurrent.error||!concurrent.data)
          return reply(409,{ok:false,message:"Consulta concorrente: atualize a página para acompanhar o pedido existente."});
        simulationJob=concurrent.data as SimulationJob;
      }else simulationJob=created.data as SimulationJob;
    }
    if(!simulationJob)return reply(503,{ok:false,message:"Consulta sem identificação persistente; nenhuma operação enviada."});
    if(simulationJob.login!==customer.login||simulationJob.server!==customer.server||
       simulationJob.expected_due_date!==expected)
      return reply(409,{ok:false,pending:true,simulationJobId:simulationJob.id,
        message:"A solicitação em andamento usa login ou vencimento diferente. Concilie antes de prosseguir."});
    const persist=async(fields:Record<string,unknown>)=>{
      const {error}=await table.update({...fields,updated_at:new Date().toISOString()}).eq("id",simulationJob!.id);
      return !error;
    };
    let response:Response;
    let remoteData:unknown;
    try{
      // Replaying the SAME body + UUID is the provider's documented retry
      // method. A different key would create another queued request.
      response=await fetch(base+route.path,{
        method:"POST",
        headers:{"X-Auth-Token":token,"Idempotency-Key":simulationJob.idempotency_key,
          "Content-Type":"application/json"},
        body:JSON.stringify(buildPanelRecargaBody(simulationJob.login,true)),
        signal:AbortSignal.timeout(125_000),
      });
      const raw=await response.text();
      try{remoteData=JSON.parse(raw);}catch{remoteData=null;}
    }catch{
      await persist({state:"uncertain",external_message:"Resposta incerta: confirme pela mesma chave, não crie outra consulta."});
      return reply(202,{ok:false,simulated:true,pending:true,dateInspectionSupported:true,
        simulationJobId:simulationJob.id,
        outcome:{status:"uncertain",message:"A consulta pode estar na fila. Verifique o andamento; nenhuma nova chave deve ser gerada."}});
    }
    const outcome=parsePanelRecargaResponse(response.status,remoteData,simulationJob.login,true);
    const newState=outcome.status==="simulated"?"completed":outcome.status==="waiting"?"waiting":
      outcome.status==="failed"?"failed":"uncertain";
    const due=outcome.status==="simulated"?outcome.previousDue??null:null;
    const stored=await persist({
      state:newState,external_http_status:response.status,
      external_message:outcome.message.slice(0,400),panel_due_date:due,
      ...(outcome.orderId?{external_order_id:outcome.orderId}:{}),
      ...(newState==="completed"||newState==="failed"?{completed_at:new Date().toISOString()}:{}),
    });
    if(!stored)
      return reply(503,{ok:false,simulated:true,pending:true,simulationJobId:simulationJob.id,
        outcome:{status:"uncertain",message:"O painel respondeu, mas não foi possível gravar o resultado; confira o mesmo pedido."}});
    return reply(200,{ok:outcome.status==="simulated",simulated:true,dateInspectionSupported:true,
      simulationJobId:simulationJob.id,pending:newState==="waiting"||newState==="uncertain",
      remoteHttpStatus:response.status,outcome,panelDueDate:due,
      note:"Consulta sem renovação, pagamento ou consumo de crédito da MaxFlix."});
  }

  if(Deno.env.get("PAINEL_RECARGA_LIVE_ENABLED")!=="true")
    return reply(503,{ok:false,disabled:true,message:"Renovação real ainda bloqueada. Use apenas o modo simulação."});

  // SINGLE-CLIENT LIVE PILOT, fail closed. This is an ADDITIONAL backend
  // safeguard after the existing live switch and owner JWT check. A VITE_
  // flag in the browser is NOT authorization to renew other customers.
  // Only 'renew' is constrained; 'check' must stay available to reconcile
  // an already-issued job even if the pilot configuration changes later.
  if(mode==="renew"){
    const allowedPilotId=Deno.env.get("PAINEL_RECARGA_PILOT_CLIENT_ID")?.trim();
    if(!allowedPilotId||allowedPilotId!==customer.id)
      return reply(403,{ok:false,pilotRestricted:true,
        message:"Piloto real restrito ao cliente autorizado no backend. Nenhuma renovação enviada."});
  }

  // For live operations, persist a stable idempotency key BEFORE the provider call.
  const {data:stored,error:queryError}=await userDb.from("external_renewal_jobs")
    .select("*").eq("client_id",customer.id).eq("expected_due_date",expected).maybeSingle();
  if(queryError)return reply(503,{ok:false,message:"Livro de pedidos indisponível; nenhuma renovação foi enviada."});
  let job=stored as Job|null;
  if(mode==="check"&&!job)return reply(404,{ok:false,message:"Nenhum pedido anterior para este cliente e ciclo."});
  if(mode==="renew"&&!job){
    if(input.confirm!==true)return reply(400,{ok:false,message:"Confirmação explícita obrigatória para renovar."});
    if(customer.due_date!==expected)
      return reply(409,{ok:false,message:"Vencimento alterado; atualize a página antes de renovar."});
    const route=panelRouteForClient(customer.server);
    if(!route)return reply(422,{ok:false,message:"Servidor não homologado para esta integração."});
    const values=parseLocalOptions(input.options);
    if(!values||values.dueDate<=expected||values.financialDueDate<values.dueDate)
      return reply(400,{ok:false,message:"Datas, valores ou período da renovação inválidos."});
    const draftIssue=validatePanelRenewalDraft(customer,values,
      new Date().toLocaleDateString("sv-SE",{timeZone:"America/Sao_Paulo"}));
    if(draftIssue)return reply(409,{ok:false,message:draftIssue});
    const financeError=financialTransitionError(customer,values);
    if(financeError)return reply(409,{ok:false,message:financeError});
    // The API cycles are not the same as months paid to MaxFlix.
    // We must consume a single credit in the panel and local ledger per click.
    const payload={
      client_id:customer.id,client_name:customer.name,login:customer.login,
      server:customer.server,expected_due_date:expected,new_due_date:values.dueDate,
      financial_due_date:values.financialDueDate,local_values:values,
      state:"created",
    };
    const created=await userDb.from("external_renewal_jobs").insert(payload).select("*").single();
    if(created.error){
      // Another tab may have created the same job. Load and reuse its key.
      if(created.error.code!=="23505")return reply(503,{ok:false,message:"Não foi possível reservar o pedido; nenhuma renovação foi enviada."});
      const prior=await userDb.from("external_renewal_jobs")
        .select("*").eq("client_id",customer.id).eq("expected_due_date",expected).maybeSingle();
      if(prior.error||!prior.data)return reply(409,{ok:false,message:"Pedido concorrente detectado; atualize a página."});
      job=prior.data as Job;
    }else job=created.data as Job;
  }
  if(!job)return reply(404,{ok:false,message:"Pedido não encontrado."});
  const jobId=job.id;
  const updateJob=async(patch:Record<string,unknown>)=>{
    const {error}=await userDb.from("external_renewal_jobs")
      .update({...patch,updated_at:new Date().toISOString()}).eq("id",jobId);
    if(error)throw Error("Não foi possível salvar o andamento do pedido.");
  };
  const syncLocal=async()=>{
    // ONE atomic PostgreSQL transaction now:
    //   lock external job -> lock client -> update due/finance -> add payment
    //   -> debit exactly one credit -> mark job synced.
    // The job ID is the only RPC argument. The client cannot inject payment
    // details a second time or race this transaction with another browser.
    const {data:result,error}=await userDb.rpc("sync_external_renewal_job",{
      p_job_id:jobId,
    });
    if(error){
      // A timeout can happen AFTER a successful database commit. Re-read
      // the ledger before claiming that settlement has failed.
      const {data:latest}=await userDb.from("external_renewal_jobs")
        .select("state,external_order_id").eq("id",jobId).maybeSingle();
      if(latest?.state==="synced")
        return reply(200,{ok:true,renewed:true,alreadyProcessed:true,
          orderId:latest.external_order_id,
          message:"Renovação já sincronizada no banco; nenhum novo pedido foi enviado."});
      // Keep external_confirmed for a safe retry of the SAME local
      // transaction. Do NOT re-send the provider's renewal.
      return reply(409,{ok:false,externalConfirmed:true,needsReview:true,
        orderId:job!.external_order_id,
        message:"Painel confirmado, mas o registro financeiro ainda precisa de conferência: "
          +error.message.slice(0,180)+". Não renove novamente no servidor."});
    }
    const confirmed=result as {
      ok?:boolean;alreadyProcessed?:boolean;dueDate?:string;
      financialDueDate?:string;orderId?:string|null;
    }|null;
    if(confirmed?.ok!==true){
      return reply(409,{ok:false,externalConfirmed:true,needsReview:true,
        message:"O banco não confirmou o lançamento financeiro. Verifique este pedido antes de outra ação."});
    }
    return reply(200,{ok:true,renewed:true,
      alreadyProcessed:confirmed.alreadyProcessed===true,
      dueDate:confirmed.dueDate,
      financialDueDate:confirmed.financialDueDate,
      orderId:confirmed.orderId??job!.external_order_id,
      message:confirmed.alreadyProcessed
        ?"Esta renovação já havia sido sincronizada, sem novo débito."
        :"Vencimento do painel, financeiro, pagamento e crédito sincronizados em uma transação."});
  };
  if(job.state==="synced")
    return reply(200,{ok:true,renewed:true,alreadyProcessed:true,orderId:job.external_order_id,message:"Esta renovação já foi concluída."});
  if(job.state==="needs_review")
    return reply(409,{ok:false,needsReview:true,externalConfirmed:true,orderId:job.external_order_id,
      message:"Pedido exige conciliação manual; não enviar outra renovação."});
  if(job.state==="external_confirmed")return await syncLocal();
  if(mode==="renew"&&job.state==="failed")
    return reply(409,{ok:false,needsReview:true,message:"Pedido anterior falhou. Confira antes de abrir um novo pedido."});
  if(customer.login!==job.login||customer.server!==job.server)
    return reply(409,{ok:false,needsReview:true,message:"Login ou servidor mudou desde o pedido. Confira manualmente."});

  // Manual renewals can happen through the existing MaxFlix button.
  // Before the FIRST provider send, re-read the current local state; a manual
  // operation might have completed between initial SELECT and job creation.
  // Never initiate a new remote cycle for an already changed due date.
  if(job.state==="created"){
    const {data:latestClient,error:latestError}=await userDb.from("clients")
      .select("due_date,login,server").eq("id",customer.id).maybeSingle();
    if(latestError||!latestClient)
      return reply(503,{ok:false,needsReview:true,message:"Não foi possível verificar o cliente antes do envio externo."});
    if(latestClient.due_date!==expected||latestClient.login!==job.login||latestClient.server!==job.server){
      await updateJob({state:"needs_review",
        external_message:"Cadastro mudou antes do envio; nenhum novo pedido deve ser feito."});
      return reply(409,{ok:false,needsReview:true,
        message:"Cliente ou vencimento alterado antes da solicitação. Confira o histórico antes de tentar renovar."});
    }
  }
  const route=panelRouteForClient(job.server);
  if(!route)return reply(422,{ok:false,message:"Servidor não suportado para este pedido."});

  // Replaying the SAME key with the SAME body is the provider's documented way
  // to check an in-flight or network-interrupted operation.
  let response:Response;
  let body:unknown;
  try{
    response=await fetch(base+route.path,{
      method:"POST",
      headers:{
        "X-Auth-Token":token,
        "Idempotency-Key":job.idempotency_key,
        "Content-Type":"application/json",
      },
      body:JSON.stringify(buildPanelRecargaBody(job.login,false)),
      signal:AbortSignal.timeout(125_000),
    });
    const raw=await response.text();
    try{body=JSON.parse(raw);}catch{body=null;}
  }catch{
    try{await updateJob({state:"uncertain",external_message:"Falha de rede; consulta deve repetir a mesma chave."});}catch{}
    return reply(202,{ok:false,pending:true,needsReview:true,
      message:"Conexão interrompida. Não renove novamente; consulte o mesmo pedido."});
  }
  const outcome:ExternalOutcome=parsePanelRecargaResponse(response.status,body,job.login,false);
  const common={
    external_http_status:response.status,
    external_message:outcome.message.slice(0,400),
    ...(outcome.orderId?{external_order_id:outcome.orderId}:{}),
  };
  if(outcome.status==="confirmed"){
    // Technical expiry is authoritative ONLY after the provider confirms
    // exactly this login and one cycle. Never update finance from a simulation.
    // Package coverage follows existing MaxFlix rules, not the provider's fees.
    const providerDates=confirmedRenewalDatesFromPanel(
      customer,job.local_values,outcome.nextDue,outcome.previousDue,
      new Date().toLocaleDateString("sv-SE",{timeZone:"America/Sao_Paulo"}),
    );
    if(providerDates.blockedReason||!providerDates.dueDate||!providerDates.financialDueDate){
      const reason=providerDates.blockedReason??"Datas não confirmadas pelo painel.";
      await updateJob({...common,state:"needs_review",external_message:reason});
      return reply(409,{ok:false,externalConfirmed:true,needsReview:true,
        orderId:outcome.orderId,providerDue:outcome.nextDue??null,
        message:reason+" O pedido externo já pode ter sido executado. Não renove novamente."});
    }

    const validatedValues:Options={
      ...job.local_values,
      dueDate:providerDates.dueDate,
      financialDueDate:providerDates.financialDueDate,
    };
    const financeIssue=financialTransitionError(customer,validatedValues);
    if(financeIssue){
      await updateJob({...common,state:"needs_review",external_message:financeIssue});
      return reply(409,{ok:false,externalConfirmed:true,needsReview:true,
        orderId:outcome.orderId,
        message:financeIssue+" O pedido externo já pode ter sido executado. Não renove novamente."});
    }

    // Persist the verified provider dates BEFORE marking external_confirmed.
    // A subsequent check will sync precisely the same dates and payment,
    // even after a network interruption, without replaying a new renewal.
    await updateJob({
      ...common,state:"external_confirmed",new_due_date:validatedValues.dueDate,
      financial_due_date:validatedValues.financialDueDate,local_values:validatedValues,
    });
    job={
      ...job,state:"external_confirmed",new_due_date:validatedValues.dueDate,
      financial_due_date:validatedValues.financialDueDate,local_values:validatedValues,
      external_order_id:outcome.orderId??job.external_order_id,
    };
    return await syncLocal();
  }
  const state=outcome.status==="waiting"?"waiting":outcome.status==="failed"?"failed":"uncertain";
  await updateJob({...common,state});
  return reply(outcome.status==="failed"?422:202,{
    ok:false,pending:outcome.status!=="failed",
    needsReview:outcome.status==="uncertain",orderId:outcome.orderId,
    providerState:outcome.status,message:outcome.message,
  });
});
