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
  buildPanelRecargaBody, panelRouteForClient, parsePanelRecargaResponse,
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
type Mode="simulate"|"renew"|"check";
type ClientRow={id:string;name:string;login:string;server:string;due_date:string};
type Options={months:number;dueDate:string;financialDueDate:string;cost:number;monthlyPaid:number;prevPaid:number;paymentAmount:number;paymentCost:number};
type Job={
  id:string;client_id:string|null;login:string;server:string;expected_due_date:string;
  new_due_date:string;financial_due_date:string;idempotency_key:string;
  state:string;local_values:Options;external_order_id:string|null;
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
  if(!["simulate","renew","check"].includes(mode))
    return reply(400,{ok:false,message:"Modo inválido."});
  if(typeof input.clientId!=="string"||!isDate(input.expectedDueDate))
    return reply(400,{ok:false,message:"Cliente e vencimento esperado obrigatórios."});
  const {data:client,error:clientError}=await userDb.from("clients")
    .select("id,name,login,server,due_date")
    .eq("id",input.clientId).maybeSingle();
  if(clientError||!client)return reply(404,{ok:false,message:"Cliente não encontrado ou sem autorização."});
  const customer=client as ClientRow;
  if(!customer.login.trim())
    return reply(400,{ok:false,message:"Cliente sem login do painel."});
  const base=RECARGA_BASE_URL;
  const expected=input.expectedDueDate as string;

  // A simulation never renews remotely or in MaxFlix and never creates jobs.
  if(mode==="simulate"){
    if(customer.due_date!==expected)
      return reply(409,{ok:false,message:"Vencimento alterado; atualize a lista antes da simulação."});
    const route=panelRouteForClient(customer.server);
    if(!route)return reply(422,{ok:false,message:"Este servidor ainda não possui rota de renovação validada."});
    try{
      const result=await fetch(base+route.path,{
        method:"POST",
        headers:{"X-Auth-Token":token,"Idempotency-Key":crypto.randomUUID(),"Content-Type":"application/json"},
        body:JSON.stringify(buildPanelRecargaBody(customer.login,true)),
        signal:AbortSignal.timeout(125_000),
      });
      const raw=await result.text();
      let data:unknown;
      try{data=JSON.parse(raw);}catch{data=null;}
      const outcome=parsePanelRecargaResponse(result.status,data,customer.login,true);
      return reply(200,{ok:true,simulated:true,remoteHttpStatus:result.status,outcome,
        note:"Simulação não altera o painel nem os créditos da MaxFlix."});
    }catch{
      return reply(502,{ok:false,simulated:true,message:"Simulação indisponível; nenhuma renovação foi solicitada."});
    }
  }

  if(Deno.env.get("PAINEL_RECARGA_LIVE_ENABLED")!=="true")
    return reply(503,{ok:false,disabled:true,message:"Renovação real ainda bloqueada. Use apenas o modo simulação."});

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
    const values=job!.local_values;
    const {error}=await userDb.rpc("renew_client_with_credit",{
      p_client_id:customer.id,
      p_expected_due_date:expected,
      p_due_date:values.dueDate,
      p_financial_due_date:values.financialDueDate,
      p_cost:values.cost,
      p_monthly_paid:values.monthlyPaid,
      p_prev_paid:values.prevPaid,
      p_payment_amount:values.paymentAmount,
      p_payment_cost:values.paymentCost,
    });
    if(error){
      await updateJob({state:"needs_review",external_message:"Confirmado no painel, mas a atualização da MaxFlix falhou: "+error.message.slice(0,250)});
      return reply(409,{ok:false,needsReview:true,externalConfirmed:true,
        message:"Painel renovado, mas a MaxFlix não foi atualizada. Não renove novamente: concilie este pedido.",orderId:job!.external_order_id});
    }
    await updateJob({state:"synced",synced_at:new Date().toISOString(),external_message:"Renovação sincronizada com a MaxFlix."});
    return reply(200,{ok:true,renewed:true,orderId:job!.external_order_id,
      message:"Renovação confirmada no painel e registrada na MaxFlix."});
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
    await updateJob({...common,state:"external_confirmed"});
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
