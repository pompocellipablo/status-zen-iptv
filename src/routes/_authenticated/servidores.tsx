import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarClock, CheckCircle2, CircleAlert, FileSearch, Search, Server, ShieldCheck, Upload, Users, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { SERVERS, formatDate, getStatus, isPanelAuditEligible, planPanelDateCorrection, type Client } from "@/lib/iptv";
import { auditServerAccounts, parsePanelExport, type ParsedPanelExport, type PanelAuditRow } from "@/lib/server-panel-audit";
import {panelRouteForClient} from "@/lib/painel-recarga";

export const Route = createFileRoute("/_authenticated/servidores")({
  validateSearch: (query: Record<string, unknown>): { servidor?: string | undefined } => ({
    servidor: typeof query["servidor"] === "string" && query["servidor"].length <= 100 ? query["servidor"] : undefined,
  }),
  head: () => ({ meta: [{"title": "Servidores e auditoria — MaxFlix"}, {"name": "description", "content": "Confira clientes e auditorias dos servidores MaxFlix."}, {"property": "og:title", "content": "Servidores e auditoria — MaxFlix"}, {"property": "og:description", "content": "Confira clientes e auditorias dos servidores MaxFlix."}, {"property": "og:type", "content": "website"}, {"name": "twitter:card", "content": "summary"}] }),
  component: ServersPage,
});

type ViewMode="todos"|"ativos"|"vencidos";
type DirectCheck={server:string;login:string;panelDue:string|null;status:"same"|"different"|"unavailable"|"failed"|"pending";message:string};
const tile="rounded-2xl bg-panel/80 p-3.5 text-left ring-1 ring-line transition-all hover:bg-panel2 hover:ring-cyan/40";
const filterClass=(active:boolean)=>"min-h-10 shrink-0 rounded-xl px-3 py-2 text-xs font-semibold ring-1 transition-colors "+(active?"bg-cyan text-background ring-cyan":"bg-panel2 text-frost ring-line hover:ring-cyan/40");

async function fetchClients():Promise<Client[]> {
  const all:Client[]=[];
  for(let offset=0;offset<25000;offset+=1000){
    const {data,error}=await supabase.from("clients").select("*").order("name",{ascending:true}).range(offset,offset+999);
    if(error)throw error;
    all.push(...(data??[]).map(c=>({...c,cost:Number(c.cost),paid:Number(c.paid),prev_cost:Number(c.prev_cost),prev_paid:Number(c.prev_paid)})) as Client[]);
    if(!data || data.length<1000)break;
  }
  return all;
}
/**
 * Read-only inspection: always sends simular:true to the owner-protected
 * Edge Function. Never changes a provider account or local payment/credit.
 * Never infer a date from "vencimento_novo".
 */
async function inspectClientOnPanel(client:Client,mode:"simulate"|"check_simulation"="simulate"):Promise<DirectCheck> {
  try {
    const {data,error}=await supabase.functions.invoke("painel-recarga-renovar",{
      body:{mode,clientId:client.id,expectedDueDate:client.due_date},
    });
    let response=data as {simulated?:boolean;dateInspectionSupported?:boolean;panelDueDate?:string|null;outcome?:{status?:string;message?:string};message?:string;note?:string}|null;
    if(error){
      const http=(error as {context?:unknown}).context;
      if(http instanceof Response){try{response=await http.json();}catch{response=null;}}
      throw Error(response?.message??error.message);
    }
    const remoteStatus=response?.outcome?.status;
    // A queued simulation will run after the provider session reconnects.
    // Do not treat waiting/uncertain results as failures that should be retried.
    if(response?.simulated===true&&(remoteStatus==="waiting"||remoteStatus==="uncertain")){
      return {server:client.server,login:client.login,panelDue:null,status:"pending",
        message:remoteStatus==="waiting"
          ?"Aguardando sessão do painel. O Painel Recarga pode executar esta simulação automaticamente ao reconectar. Consulte a fila antes de tentar novamente."
          :"O resultado da solicitação é incerto. Confira a fila do Painel Recarga antes de reenviar."};
    }
    const confirmed=response?.simulated===true&&remoteStatus==="simulated";
    // A simulated login is not necessarily a trustworthy date lookup.
    // Fast's API can return a historic "vencimento_antes"; never offer
    // date-correction actions using that unverified value.
    const dateTrusted=response?.dateInspectionSupported===true&&client.server!=="Fast";
    const panelDue=confirmed&&dateTrusted&&/^\d{4}-\d{2}-\d{2}$/.test(response?.panelDueDate??"")
      ?response!.panelDueDate!:null;
    const message=response?.outcome?.message??response?.message??"O painel não retornou um resultado reconhecido.";
    const noBackend=confirmed&&!dateTrusted;
    return {
      server:client.server,login:client.login,panelDue,
      status:confirmed?(panelDue?(panelDue===client.due_date?"same":"different"):"unavailable"):"failed",
      message:noBackend?(response?.note??"Login confirmado em simulação; a data do painel ainda não está homologada. Confira manualmente, sem corrigir o cadastro."):confirmed&&!panelDue
        ?"O login foi localizado, mas o painel não informou o vencimento atual.":message,
    };
  }catch(error){
    return {server:client.server,login:client.login,panelDue:null,status:"failed",
      message:error instanceof Error?error.message:"Não foi possível consultar o painel."};
  }
}

function AuditGroup({title,detail,rows,variant}:{title:string,detail:string,rows:PanelAuditRow[],variant?:"warn"|"normal"}) {
  if(!rows.length)return null;
  return <section className={"rounded-xl p-3 ring-1 "+(variant==="warn"?"bg-warn/5 ring-warn/30":"bg-background/50 ring-line")}>
    <h3 className="text-sm font-semibold text-frost">{title} · {rows.length}</h3>
    <p className="mt-1 text-xs text-mist">{detail}</p>
    <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
      {rows.map((r,index)=><div key={r.login+"-"+index} className="rounded-lg bg-panel px-3 py-2 text-xs ring-1 ring-line">
        <p className="break-words font-semibold text-frost">{r.client?.name??r.login}</p>
        <p className="mt-1 break-all text-mist">Login: {r.login}</p>
        {r.client&&<p className="mt-1 text-mist">MaxFlix: {getStatus(r.client).key==="vencido"?"Vencido":"Ativo"} · vence {formatDate(r.client.due_date)}</p>}
        {r.account&&<p className="mt-1 text-mist">Painel: {r.account.status==="active"?"Ativo":r.account.status==="inactive"?"Inativo":"Status não informado"}{r.account.expires?" · validade "+formatDate(r.account.expires):""}</p>}
      </div>)}
    </div>
  </section>;
}
function ServersPage() {
  const {servidor}=Route.useSearch();
  const [localSelection,setLocalSelection]=useState<string|null>(null);
  const [mode,setMode]=useState<ViewMode>("todos");
  const [search,setSearch]=useState("");
  const [expanded,setExpanded]=useState(false);
  const [exported,setExported]=useState<ParsedPanelExport|null>(null);
  const [importedFile,setImportedFile]=useState<string|null>(null);
  const [importError,setImportError]=useState<string|null>(null);
  const [fullExport,setFullExport]=useState(false);
  const [showDateChecks,setShowDateChecks]=useState(false);
  const [correctingId,setCorrectingId]=useState<string|null>(null);
  const [correctionNotice,setCorrectionNotice]=useState<string|null>(null);
  const [simulatingId,setSimulatingId]=useState<string|null>(null);
  const [simulation,setSimulation]=useState<{clientId:string;ok:boolean;message:string}|null>(null);
  const [directChecks,setDirectChecks]=useState<Record<string,DirectCheck>>({});
  const [lastCheckedId,setLastCheckedId]=useState<string|null>(null);
  const [batchBusy,setBatchBusy]=useState(false);
  const [batchProgress,setBatchProgress]=useState({done:0,total:0});
  const [batchNotice,setBatchNotice]=useState<string|null>(null);
  const batchStopRef=useRef(false);
  const batchBusyRef=useRef(false);

  const queryClient=useQueryClient();
  const clientsQuery=useQuery({queryKey:["clients"],queryFn:fetchClients});
  // Owner-only table: pending provider requests survive a browser refresh.
  const pendingJobsQuery=useQuery({
    queryKey:["panel-simulation-pending"],
    queryFn:async()=>{
      const {data,error}=await supabase.from("external_simulation_jobs")
        .select("client_id,login,server,expected_due_date,state,external_message")
        .in("state",["created","waiting","uncertain"]);
      if(error)throw error;
      return data??[];
    },
    staleTime:10_000,
    refetchOnWindowFocus:true,
  });
  const clients=useMemo(()=>clientsQuery.data??[],[clientsQuery.data]);
  const counts=useMemo(()=>{
    const grouped=new Map<string,{total:number;active:number;expired:number;today:number;soon:number}>();
    for(const c of clients){
      const row=grouped.get(c.server)??{total:0,active:0,expired:0,today:0,soon:0};
      row.total++;
      const status=getStatus(c);
      if(status.key==="vencido")row.expired++;else row.active++;
      if(status.key==="hoje")row.today++;
      if(status.days>=1&&status.days<=5)row.soon++;
      grouped.set(c.server,row);
    }
    return [...new Set([...SERVERS,...grouped.keys()])]
      .map(name=>({name,...(grouped.get(name)??{total:0,active:0,expired:0,today:0,soon:0})}))
      .filter(row=>row.total>0)
      .sort((a,b)=>b.total-a.total||a.name.localeCompare(b.name,"pt-BR"));
  },[clients]);
  const selected=localSelection ?? (servidor&&counts.some(s=>s.name===servidor)?servidor:"");
  const correctionHistoryQuery=useQuery({
    queryKey:["panel-date-corrections",selected],
    enabled:Boolean(selected),
    queryFn:async()=>{
      const {data,error}=await supabase.from("panel_due_date_corrections")
        .select("id,client_name,client_login,server,previous_due_date,corrected_due_date,preserved_financial_due_date,source,created_at")
        .eq("server",selected).order("created_at",{ascending:false}).limit(12);
      if(error)throw error;
      return data??[];
    },
  });
  const serverClients=useMemo(()=>clients.filter(c=>c.server===selected),[clients,selected]);
  const total=counts.reduce((acc,row)=>acc+row.total,0);
  const totalActive=counts.reduce((acc,row)=>acc+row.active,0);
  const totalExpired=counts.reduce((acc,row)=>acc+row.expired,0);
  const selectedSummary=counts.find(row=>row.name===selected);
  const filtered=useMemo(()=>{
    const term=search.trim().toLocaleLowerCase("pt-BR");
    return serverClients.filter(c=>{
      const active=getStatus(c).key!=="vencido";
      if(mode==="ativos"&&!active)return false;
      if(mode==="vencidos"&&active)return false;
      return !term||[c.name,c.login].join(" ").toLocaleLowerCase("pt-BR").includes(term);
    }).sort((a,b)=>a.due_date.localeCompare(b.due_date)||a.name.localeCompare(b.name,"pt-BR"));
  },[serverClients,mode,search]);
  const audit=useMemo(()=>exported?auditServerAccounts(serverClients,exported.accounts):null,[serverClients,exported]);
  // Exclude expired accounts only from automated requests; retain them in
  // MaxFlix, normal server views, CSV reports and individual inspection.
  const batchEligibleClients=serverClients.filter(c=>c.login.trim()&&isPanelAuditEligible(c));
  const expiredExcluded=serverClients.filter(c=>!isPanelAuditEligible(c)).length;
  const missingLoginExcluded=serverClients.filter(c=>isPanelAuditEligible(c)&&!c.login.trim()).length;
  const persistedPending=useMemo(()=>new Map(
    (pendingJobsQuery.data??[]).filter(job=>job.client_id).map(job=>[job.client_id!,job])
  ),[pendingJobsQuery.data]);
  const auditChecks=useMemo(()=>{
    const merged={...directChecks};
    for(const client of serverClients){
      const job=persistedPending.get(client.id);
      if(!job)continue;
      const changed=job.login!==client.login||job.server!==client.server||job.expected_due_date!==client.due_date;
      merged[client.id]={
        server:client.server,login:client.login,panelDue:null,status:"pending",
        message:changed
          ?"Há consulta pendente com login, servidor ou vencimento anterior. Confira a fila antes de reenviar."
          :job.external_message??"Pedido em andamento. Use Verificar andamento.",
      };
    }
    return merged;
  },[directChecks,persistedPending,serverClients]);
  const directCandidate=batchEligibleClients.find(c=>auditChecks[c.id]?.status!=="pending")??null;
  const lastChecked=lastCheckedId?auditChecks[lastCheckedId]:undefined;
  const lastClient=lastCheckedId?serverClients.find(c=>c.id===lastCheckedId):undefined;
  const reviewedClients=batchEligibleClients.filter(c=>{
    const r=auditChecks[c.id];
    return r?.server===c.server&&r.login===c.login;
  });
  const outstandingClients=batchEligibleClients.filter(c=>{
    const r=auditChecks[c.id];
    return !r||r.server!==c.server||r.login!==c.login;
  });
  const changedClients=reviewedClients.filter(c=>auditChecks[c.id]?.status==="different");
  const sameCount=reviewedClients.filter(c=>auditChecks[c.id]?.status==="same").length;
  const unavailableCount=reviewedClients.filter(c=>auditChecks[c.id]?.status==="unavailable").length;
  const pendingClients=reviewedClients.filter(c=>auditChecks[c.id]?.status==="pending");
  const failedClients=reviewedClients.filter(c=>auditChecks[c.id]?.status==="failed");
  const failedCount=failedClients.length;
  const runSimulation=async(client:Client,mode:"simulate"|"check_simulation"="simulate")=>{
    if(simulatingId||batchBusyRef.current||!panelRouteForClient(client.server)
      ||(mode==="simulate"&&auditChecks[client.id]?.status==="pending"))return;
    setSimulatingId(client.id);
    setSimulation(null);
    try{
      const check=await inspectClientOnPanel(client,mode);
      setDirectChecks(previous=>({...previous,[client.id]:check}));
      setSimulation({clientId:client.id,ok:check.status==="same"||check.status==="different"||check.status==="unavailable",message:check.message});
      setLastCheckedId(client.id);
      await queryClient.invalidateQueries({queryKey:["panel-simulation-pending"]});
    }finally{setSimulatingId(null);}
  };
  const inspectNextBatch=async()=>{
    if(batchBusyRef.current||simulatingId||!panelRouteForClient(selected))return;
    const targets=outstandingClients.slice(0,10);
    if(!targets.length)return;
    batchBusyRef.current=true;
    batchStopRef.current=false;
    setBatchBusy(true);
    setBatchNotice(null);
    setBatchProgress({done:0,total:targets.length});
    try{
      for(const client of targets){
        if(batchStopRef.current)break;
        const result=await inspectClientOnPanel(client);
        if(batchStopRef.current)break;
        setDirectChecks(previous=>({...previous,[client.id]:result}));
        setBatchProgress(progress=>({...progress,done:progress.done+1}));
        await queryClient.invalidateQueries({queryKey:["panel-simulation-pending"]});
        if(result.status==="pending"){
          setBatchNotice("Consulta interrompida: existe pedido aguardando sessão ou confirmação no Painel Recarga. Confira a fila antes de reenviar.");
          break;
        }
        if(result.status==="failed"&&/sess[aã]o|login expirado|aguardando/i.test(result.message)){
          setBatchNotice("Consulta interrompida: a sessão do servidor precisa ser reconectada.");
          break;
        }
      }
    }finally{
      batchBusyRef.current=false;
      setBatchBusy(false);
    }
  };
  const choose=(name:string)=>{
    batchStopRef.current=true;
    setBatchNotice(null);setBatchProgress({done:0,total:0});
    setLocalSelection(name);setMode("todos");setSearch("");setExpanded(false);
    setExported(null);setImportedFile(null);setImportError(null);setFullExport(false);setSimulation(null);
    setShowDateChecks(false);setCorrectionNotice(null);setLastCheckedId(null);setDirectChecks({});
  };
  const handleFile=async (file:File|undefined)=>{
    setImportedFile(null);setExported(null);setImportError(null);setFullExport(false);
    setShowDateChecks(false);setCorrectionNotice(null);
    if(!file)return;
    if(file.size>2_000_000){setImportError("O arquivo excede 2 MB. Exporte apenas os logins deste servidor.");return;}
    try{
      const parsed=parsePanelExport(await file.text());
      if(!parsed.accounts.length){
        setImportError("Não identifiquei logins. Use CSV com coluna login/usuário/username ou TXT com um login por linha.");
        return;
      }
      setImportedFile(file.name);
      setExported(parsed);
    }catch(e){
      setImportError(e instanceof Error?e.message:"Não foi possível ler o arquivo.");
    }
  };

  const approveDateCorrection=async(row:PanelAuditRow,source:"arquivo"|"simulacao"="arquivo")=>{
    const client=row.client,account=row.account;
    if(!client||!account?.expires||correctingId)return;
    setCorrectionNotice(null);
    if(client.server!==selected||account.login!==client.login){
      setCorrectionNotice("Login ou servidor diferente: confira manualmente; nenhuma data foi alterada.");
      return;
    }
    if(source==="simulacao"){
      const direct=directChecks[client.id];
      if(!direct||direct.server!==client.server||direct.login!==client.login||direct.status!=="different"||direct.panelDue!==account.expires){
        setCorrectionNotice("A consulta direta não está confirmada para este cliente. Refaça a conferência.");
        return;
      }
    }
    const plan=planPanelDateCorrection(client,account.expires);
    if(plan.blockedReason){
      setCorrectionNotice(plan.blockedReason+" Nenhuma data foi alterada.");
      return;
    }
    const message=[
      "Conferir e aprovar a correção de vencimento:",
      client.name+" · "+client.server+" · "+client.login,
      "Acesso MaxFlix: "+formatDate(client.due_date)+" → "+formatDate(plan.dueDate),
      "Financeiro: "+formatDate(client.financial_due_date)+" → "+formatDate(plan.financialDueDate),
      "A data financeira existente será preservada. Conferência não registra recebimento.",
      source==="simulacao"
        ?"Fonte: simulação autenticada do Painel Recarga. Confirme a validade antes de prosseguir."
        :"Fonte: lista exportada manualmente. Confira a validade no painel antes de continuar.",
      "NÃO registra pagamento, renovação no servidor nem movimentação de créditos. Confirmar?",
    ].join("\n");
    if(!window.confirm(message))return;
    setCorrectingId(client.id);
    try{
      const {data,error}=await supabase.rpc("approve_panel_date_correction",{
        p_client_id:client.id,
        p_expected_login:client.login,
        p_expected_server:selected,
        p_expected_due_date:client.due_date,
        p_expected_financial_due_date:client.financial_due_date!,
        p_panel_due_date:plan.dueDate,
        p_source:source,
        p_confirmed:true,
      });
      if(error)throw error;
      if(!data||typeof data!=="object"||Array.isArray(data)||data["ok"]!==true)
        throw Error("A transação do banco não confirmou a correção. Nenhum novo pedido ao painel será enviado.");
      await Promise.all([
        queryClient.invalidateQueries({queryKey:["clients"]}),
        queryClient.invalidateQueries({queryKey:["panel-date-corrections",selected]}),
      ]);
      setDirectChecks(s=>{const next={...s};delete next[client.id];return next;});
      setCorrectionNotice(client.name+": vencimento corrigido e registrado no histórico de auditoria. Financeiro preservado; nenhum pagamento ou crédito consumido.");
    }catch(error){
      setCorrectionNotice("Correção não realizada: "+(error instanceof Error?error.message:"erro desconhecido")+".");
    }finally{
      setCorrectingId(null);
    }
  };

  return <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 text-frost sm:px-6 sm:py-8">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-cyan">MAXFLIX · GESTÃO</p>
        <h1 className="mt-1 flex items-center gap-2 font-display text-2xl font-bold sm:text-3xl">
          <Server size={25} className="text-cyan"/> Servidores
        </h1>
        <p className="mt-1 text-sm text-mist">Cadastros por painel, vencimentos e comparação de listas para auditoria.</p>
      </div>
      <Link to="/" className="flex min-h-10 items-center gap-2 rounded-xl bg-panel px-3 py-2 text-sm ring-1 ring-line hover:bg-panel2">
        <ArrowLeft size={16}/> Dashboard
      </Link>
    </div>
    {clientsQuery.isError&&<p role="alert" className="rounded-xl bg-danger/10 p-3 text-sm text-danger ring-1 ring-danger/30">
      Erro ao carregar clientes: {clientsQuery.error?.message}
    </p>}
    <section className="grid grid-cols-3 gap-2 sm:gap-3" aria-label="Resumo geral por servidor">
      {[
        {name:"Cadastrados",value:total,color:"text-frost"},
        {name:"Ativos",value:totalActive,color:"text-ok"},
        {name:"Vencidos",value:totalExpired,color:"text-danger"},
      ].map(item=><div key={item.name} className="rounded-xl bg-panel p-3 ring-1 ring-line">
        <p className={"font-display text-2xl font-semibold tabular-nums "+item.color}>{clientsQuery.isLoading?"—":item.value}</p>
        <p className="mt-1 text-[11px] text-mist">{item.name}</p>
      </div>)}
    </section>
    <section aria-label="Escolher servidor" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-base font-semibold">Escolha um servidor</h2>
        <Link to="/creditos" className="text-xs font-semibold text-cyan hover:underline">Estoque de créditos →</Link>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {counts.map(s=><button key={s.name} type="button"
          onClick={()=>choose(s.name)} aria-pressed={selected===s.name}
          className={tile+(selected===s.name?" bg-cyan/10 ring-cyan/60":"")}>
          <div className="flex items-center justify-between gap-1">
            <p className="break-all font-display text-base font-semibold text-frost">{s.name}</p>
            {selected===s.name&&<CheckCircle2 size={17} className="shrink-0 text-cyan"/>}
          </div>
          <p className="mt-3 text-2xl font-bold tabular-nums text-cyan">{s.total}</p>
          <p className="mt-1 text-xs text-ok">{s.active} ativos</p>
          <p className="mt-1 text-xs text-danger">{s.expired} vencidos</p>
          <p className="mt-1 text-[11px] text-mist">{s.today} hoje · {s.soon} próximos 5 dias</p>
        </button>)}
      </div>
      {!clientsQuery.isLoading&&counts.length===0&&<p className="rounded-xl bg-panel p-4 text-sm text-mist">Nenhum cliente encontrado nos servidores.</p>}
    </section>

    {selected&&selectedSummary&&<>
      <section className="rounded-2xl bg-panel/70 p-3 ring-1 ring-cyan/20 sm:p-4" aria-label={"Clientes do servidor "+selected}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="font-display text-xl font-semibold text-frost">{selected} · {selectedSummary.total} cadastros</h2>
            <p className="mt-1 text-xs text-mist">Situação calculada pelo vencimento cadastrado na MaxFlix.</p>
          </div>
          <Link to="/renovacoes" search={{tab:"hoje",server:selected}}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-cyan px-3 py-2 text-xs font-bold text-background hover:brightness-110">
            <CalendarClock size={16}/> Renovações de hoje
          </Link>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {([
            {key:"todos",title:"Todos",count:selectedSummary.total},
            {key:"ativos",title:"Ativos",count:selectedSummary.active},
            {key:"vencidos",title:"Vencidos",count:selectedSummary.expired},
          ] as const).map(x=><button key={x.key} type="button"
            aria-pressed={mode===x.key} className={filterClass(mode===x.key)}
            onClick={()=>{setMode(x.key);setExpanded(false);}}>{x.title} · {x.count}</button>)}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="flex min-w-[180px] flex-1 items-center gap-2 rounded-xl bg-panel2 px-3 ring-1 ring-line">
            <Search size={16} className="text-mist"/>
            <input value={search} onChange={e=>{setSearch(e.target.value);setExpanded(false);}}
              placeholder="Buscar nome ou login" className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none"/>
          </label>
          <Link to="/renovacoes" search={{tab:mode==="vencidos"?"vencidos":mode==="ativos"?"todos":"cadastrados",server:selected}}
            className="flex min-h-10 items-center rounded-xl bg-panel2 px-3 text-xs font-semibold text-cyan ring-1 ring-line hover:bg-panel">
            Abrir na gestão de clientes →
          </Link>
        </div>
        {panelRouteForClient(selected)&&<div className="mt-4 rounded-xl bg-cyan/5 p-3 ring-1 ring-cyan/20">
          <p className="text-sm font-semibold text-cyan">Conferência direta de login e vencimento — sem arquivo</p>
          <p className="mt-1 text-xs text-mist">
            A MaxFlix consulta o Painel Recarga em modo simulação (simular: true), confirma o login exato e
            compara a data do acesso quando o fornecedor a informar. Não renova, cobra ou consome crédito.
            A primeira consulta verifica se o servidor disponibiliza a data atual.
          </p>
          <button type="button" disabled={!directCandidate||simulatingId!==null||batchBusy||pendingJobsQuery.isError||pendingJobsQuery.isPending}
            onClick={()=>{if(directCandidate)void runSimulation(directCandidate);}}
            className="mt-3 min-h-10 rounded-xl bg-cyan px-3 py-2 text-xs font-bold text-background disabled:opacity-40">
            {simulatingId?"Consultando o servidor…":"Conferir vencimento diretamente (1 cliente)"}
          </button>
          <div className="mt-3 rounded-xl bg-panel p-3 ring-1 ring-line">
            <p className="text-sm font-semibold">Conferência por lotes · {reviewedClients.length}/{batchEligibleClients.length}</p>
            <p className="mt-1 text-xs text-mist">
              Somente clientes não vencidos (incluindo quem vence hoje), em grupos de até 10 consultas sequenciais. Sem arquivo, renovações ou alterações. Pedidos pendentes permanecem registrados depois de recarregar a tela; resultados concluídos desta visualização são temporários.
            </p>
            <p className="mt-2 text-xs text-mist">
              {expiredExcluded} vencido(s) fora da consulta automática — permanecem cadastrados e podem ser conferidos individualmente.
              {missingLoginExcluded>0?` ${missingLoginExcluded} ativo(s) sem login válido também foram ignorados.`:""}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <span className="text-ok">Datas iguais: {sameCount}</span>
              <span className="text-warn">Datas diferentes: {changedClients.length}</span>
              <span className="text-mist">Sem data: {unavailableCount}</span>
              <span className="text-danger">Falhas: {failedCount}</span>
              <span className="text-warn">Pendentes: {pendingClients.length}</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={()=>void inspectNextBatch()}
                disabled={batchBusy||simulatingId!==null||outstandingClients.length===0||pendingJobsQuery.isError||pendingJobsQuery.isPending}
                className="min-h-10 rounded-lg bg-cyan/15 px-3 text-xs font-semibold text-cyan ring-1 ring-cyan/30 disabled:opacity-40">
                {batchBusy?`Consultando ${batchProgress.done}/${batchProgress.total}…`:`Conferir próximos ${Math.min(10,outstandingClients.length)} clientes`}
              </button>
              {batchBusy&&<button type="button" onClick={()=>{batchStopRef.current=true;setBatchNotice("Parada solicitada. A consulta atual pode terminar antes de interromper.");}}
                className="min-h-10 rounded-lg bg-panel2 px-3 text-xs text-mist ring-1 ring-line">
                Parar após a consulta atual
              </button>}
            </div>
            {pendingJobsQuery.isError&&<p role="status" className="mt-2 text-xs text-warn">
              Histórico de consultas indisponível. Não repita pedidos que possam estar na fila do Painel Recarga.
            </p>}
            {batchNotice&&<p role="status" className="mt-2 text-xs text-warn">{batchNotice}</p>}
            {pendingClients.length>0&&<section className="mt-3 space-y-2" aria-label="Consultas aguardando sessão">
              <h3 className="text-xs font-semibold text-warn">Aguardando no Painel Recarga · {pendingClients.length}</h3>
              <p className="text-xs text-mist">A consulta pode terminar quando a sessão reconectar. O pedido usa uma chave persistente; Verificar andamento reutiliza essa chave.</p>
              <div className="max-h-72 space-y-2 overflow-y-auto">
                {pendingClients.map(client=><div key={client.id} className="rounded-lg bg-background/80 p-3 text-xs ring-1 ring-line">
                  <p className="break-words font-semibold">{client.name} · {client.login}</p>
                  <p className="mt-1 text-warn">{auditChecks[client.id]?.message}</p>
                  <button type="button" disabled={batchBusy||simulatingId!==null||pendingJobsQuery.isError}
                    onClick={()=>void runSimulation(client,"check_simulation")}
                    className="mt-2 min-h-9 rounded-lg bg-panel2 px-3 font-semibold text-cyan ring-1 ring-line disabled:opacity-40">
                    {simulatingId===client.id?"Verificando…":"Verificar andamento (mesmo pedido)"}
                  </button>
                </div>)}
              </div>
            </section>}
            {failedClients.length>0&&<section className="mt-3 space-y-2" aria-label="Falhas de consulta">
              <h3 className="text-xs font-semibold text-danger">Falhas de consulta · {failedClients.length}</h3>
              <p className="text-xs text-mist">Falha não significa que o cliente foi excluído do painel. Confira a mensagem antes de agir.</p>
              <div className="max-h-80 space-y-2 overflow-y-auto">
                {failedClients.map(client=>{
                  const check=auditChecks[client.id]!;
                  return <div key={client.id} className="rounded-lg bg-background/80 p-3 text-xs ring-1 ring-line">
                    <p className="break-words font-semibold">{client.name} · {client.login}</p>
                    <p className="mt-1 break-words text-warn">{check.message}</p>
                    <button type="button" disabled={batchBusy||simulatingId!==null}
                      onClick={()=>void runSimulation(client)}
                      className="mt-2 min-h-9 rounded-lg bg-panel2 px-3 font-semibold text-cyan ring-1 ring-line disabled:opacity-40">
                      {simulatingId===client.id?"Reconsultando…":"Tentar novamente somente este cliente"}
                    </button>
                  </div>;
                })}
              </div>
            </section>}
            {changedClients.length>0&&<div className="mt-3 max-h-96 space-y-2 overflow-y-auto">
              <p className="text-xs font-semibold text-warn">Divergências encontradas — nenhuma será corrigida automaticamente</p>
              {changedClients.map(client=>{
                const result=auditChecks[client.id]!;
                const plan=result.panelDue?planPanelDateCorrection(client,result.panelDue):null;
                return <div key={client.id} className="rounded-lg bg-background/80 p-3 text-xs ring-1 ring-line">
                  <p className="break-words font-semibold">{client.name} · {client.login}</p>
                  <p className="mt-1 text-mist">MaxFlix: {formatDate(client.due_date)} · Painel: {formatDate(result.panelDue)} · Financeiro: {formatDate(client.financial_due_date)}</p>
                  {plan?.blockedReason&&<p className="mt-1 text-warn">{plan.blockedReason}</p>}
                  {!plan?.blockedReason&&<p className="mt-1 text-mist">Conferir a data no painel antes de aprovar eventual correção individual.</p>}
                </div>;
              })}
            </div>}
          </div>
          {lastChecked&&lastClient&&lastChecked.server===selected&&<div role="status" aria-live="polite"
            className="mt-3 rounded-lg bg-panel p-3 text-xs ring-1 ring-line">
            <p className="font-semibold">{lastClient.name} · {lastChecked.login}</p>
            <p className="mt-1">MaxFlix: {formatDate(lastClient.due_date)} · Financeiro: {formatDate(lastClient.financial_due_date)}</p>
            {lastChecked.panelDue&&<p className="mt-1">Painel Recarga: <strong>{formatDate(lastChecked.panelDue)}</strong></p>}
            <p className={"mt-2 "+(lastChecked.status==="same"?"text-ok":lastChecked.status==="different"?"text-warn":"text-mist")}>
              {lastChecked.status==="same"?"Datas de acesso iguais.":lastChecked.status==="different"?"Datas de acesso divergentes.":lastChecked.message}
            </p>
            {lastChecked.status==="different"&&lastChecked.panelDue&&planPanelDateCorrection(lastClient,lastChecked.panelDue).blockedReason&&
              <p className="mt-2 text-xs text-warn">{planPanelDateCorrection(lastClient,lastChecked.panelDue).blockedReason}</p>}
            {lastChecked.status==="different"&&lastChecked.panelDue&&<button type="button"
              disabled={correctingId!==null||!!planPanelDateCorrection(lastClient,lastChecked.panelDue).blockedReason}
              onClick={()=>void approveDateCorrection({login:lastClient.login,client:lastClient,
                account:{login:lastChecked.login,status:"unknown",expires:lastChecked.panelDue}},"simulacao")}
              className="mt-3 min-h-10 rounded-lg bg-warn/10 px-3 font-semibold text-warn ring-1 ring-warn/30 disabled:opacity-40">
              {planPanelDateCorrection(lastClient,lastChecked.panelDue).blockedReason?"Revisão financeira necessária":"Revisar e aprovar correção"}
            </button>}
          </div>}
          {correctionNotice&&<p role="status" className="mt-2 text-xs text-mist">{correctionNotice}</p>}
        </div>}
        {selected&&<section className="mt-4 rounded-xl bg-panel p-3 ring-1 ring-line" aria-label="Histórico de correções de vencimento">
          <h3 className="text-sm font-semibold text-frost">Histórico de correções aprovadas</h3>
          <p className="mt-1 text-xs text-mist">Registro permanente das datas técnicas alteradas por confirmação. O financeiro não é modificado.</p>
          {correctionHistoryQuery.isError&&<p role="status" className="mt-2 text-xs text-warn">Não foi possível consultar o histórico de correções.</p>}
          {correctionHistoryQuery.data?.length===0&&<p className="mt-2 text-xs text-mist">Nenhuma correção registrada neste servidor.</p>}
          {(correctionHistoryQuery.data??[]).map(log=><div key={log.id} className="mt-2 rounded-lg bg-background/70 p-3 text-xs ring-1 ring-line">
            <p className="font-semibold text-frost">{log.client_name} · {log.client_login}</p>
            <p className="mt-1 text-mist">Técnico: {formatDate(log.previous_due_date)} → <strong className="text-cyan">{formatDate(log.corrected_due_date)}</strong></p>
            <p className="mt-1 text-mist">Financeiro preservado: {formatDate(log.preserved_financial_due_date)}</p>
            <p className="mt-1 text-mist">Fonte: {log.source==="simulacao"?"Painel Recarga":"Arquivo exportado"} · {new Date(log.created_at).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"})}</p>
          </div>)}
        </section>}
        <p className="mt-3 text-xs text-mist">{filtered.length} cliente(s) nesta visualização.</p>
        <div className="mt-2 space-y-2">
          {(expanded?filtered:filtered.slice(0,50)).map(c=>{
            const st=getStatus(c);
            return <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-background/65 p-3 ring-1 ring-line">
              <div className="min-w-0">
                <p className="break-words text-sm font-semibold">{c.name}</p>
                <p className="break-all text-xs text-mist">{c.login} · {c.server}</p>
                {c.financial_due_date&&c.financial_due_date!==c.due_date&&
                  <p className="mt-1 text-xs text-mist">Cobertura financeira até {formatDate(c.financial_due_date)}</p>}
              </div>
              <div className="flex flex-col items-end gap-1 text-right">
                <p className={"text-xs font-semibold "+(st.key==="vencido"?"text-danger":st.key==="hoje"?"text-today":"text-ok")}>
                  {st.key==="vencido"?"Vencido":st.key==="hoje"?"Vence hoje":"Ativo"}
                </p>
                <p className="text-xs text-mist">Vence {formatDate(c.due_date)}</p>
                {panelRouteForClient(c.server)&&<button type="button"
                  disabled={simulatingId!==null||batchBusy||auditChecks[c.id]?.status==="pending"||pendingJobsQuery.isError||pendingJobsQuery.isPending} onClick={()=>void runSimulation(c)}
                  className="mt-1 min-h-9 rounded-lg bg-cyan/15 px-3 text-xs font-semibold text-cyan ring-1 ring-cyan/30 disabled:opacity-50">
                  {simulatingId===c.id?"Conferindo…":auditChecks[c.id]?.status==="pending"?"Aguardando sessão":"Conferir no painel"}
                </button>}
                {simulation?.clientId===c.id&&<p role="status" aria-live="polite"
                  className={"mt-2 max-w-sm rounded-lg px-3 py-2 text-left text-xs ring-1 "+(simulation.ok?"bg-ok/10 text-ok ring-ok/20":"bg-warn/10 text-warn ring-warn/20")}>
                  {directChecks[c.id]?.status==="pending"?"Aguardando sessão: ":simulation.ok?"Login validado: ":"Consulta não validada: "}{simulation.message}
                </p>}
                {directChecks[c.id]?.server===selected&&directChecks[c.id]?.panelDue&&
                  <p className={"mt-1 text-xs "+(directChecks[c.id]?.status==="same"?"text-ok":"text-warn")}>
                    Painel: {formatDate(directChecks[c.id]!.panelDue)} · {directChecks[c.id]?.status==="same"?"Datas iguais":"Datas diferentes"}
                  </p>}
                {auditChecks[c.id]?.status==="unavailable"&&<p className="mt-1 max-w-sm text-xs text-warn">
                  {auditChecks[c.id]?.message}
                </p>}
              </div>
            </div>;
          })}
        </div>
        {filtered.length>50&&<button type="button" onClick={()=>setExpanded(x=>!x)}
          className="mt-3 min-h-10 rounded-xl bg-panel2 px-4 text-xs font-semibold text-cyan ring-1 ring-line">
          {expanded?"Mostrar menos":"Mostrar todos os "+filtered.length+" clientes"}
        </button>}
      </section>

      <section className="rounded-2xl bg-panel/70 p-4 ring-1 ring-line sm:p-5" aria-label={"Auditoria de "+selected}>
        <div className="flex items-center gap-2">
          <FileSearch size={20} className="text-cyan"/>
          <h2 className="font-display text-base font-semibold">Auditoria · {selected}</h2>
        </div>
        <p className="mt-2 text-xs text-mist">
          Alternativa opcional à conferência direta: exporte uma lista CSV ou TXT do painel com a coluna de login. Se houver colunas
          status e vencimento, podemos apontar também situações e datas divergentes. A comparação ocorre no navegador. Só uma correção de data individual, confirmada por você, pode atualizar
          o cadastro; nunca registra renovação, pagamento ou consumo de créditos.
        </p>
        <label className="mt-4 flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-cyan/50 bg-cyan/5 px-3 py-3 text-center text-sm font-semibold text-cyan hover:bg-cyan/10">
          <Upload size={18}/> Selecionar lista exportada (.csv ou .txt)
          <input type="file" accept=".csv,.txt,text/csv,text/plain" className="sr-only"
            onChange={e=>{void handleFile(e.currentTarget.files?.[0]);e.currentTarget.value="";}}/>
        </label>
        <p className="mt-2 text-[11px] text-mist">Exemplo CSV: login;status;vencimento — ou TXT com um login em cada linha. Não envie senhas nem links M3U.</p>
        {importError&&<p role="alert" className="mt-3 rounded-xl bg-danger/10 p-3 text-xs text-danger ring-1 ring-danger/30">{importError}</p>}
        {exported&&audit&&<div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">Arquivo: {importedFile} · {exported.accounts.length} registros</p>
            <button type="button" onClick={()=>{setExported(null);setImportedFile(null);setFullExport(false);setShowDateChecks(false);setCorrectionNotice(null);}}
              className="flex min-h-9 items-center gap-1 rounded-lg bg-panel2 px-3 text-xs ring-1 ring-line">
              <X size={14}/> Limpar
            </button>
          </div>
          <label className="flex items-start gap-2 rounded-lg bg-background/60 p-3 text-xs text-mist ring-1 ring-line">
            <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-cyan-500"
              checked={fullExport} onChange={e=>setFullExport(e.target.checked)}/>
            Confirmo que a lista exportada contém TODOS os logins do servidor {selected}, incluindo ativos e inativos.
          </label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[
              {label:"Só no painel",value:audit.panelOnly.length},
              {label:"Só na MaxFlix",value:audit.maxflixOnly.length},
              {label:"Status diferente",value:audit.statusDifferences.length},
              {label:"Datas diferentes",value:audit.dateDifferences.length},
              {label:"Correspondências sem conflito",value:audit.matching},
              {label:"Logins duplicados",value:audit.duplicateMaxflix.length+audit.duplicatePanel.length},
            ].map(x=><div key={x.label} className="rounded-lg bg-background p-3 ring-1 ring-line">
              <p className="text-xl font-semibold tabular-nums text-cyan">{x.value}</p>
              <p className="mt-1 text-xs text-mist">{x.label}</p>
            </div>)}
          </div>
          {!fullExport&&<p className="rounded-xl bg-warn/10 p-3 text-xs text-warn ring-1 ring-warn/20">
            Lista possivelmente parcial: contas ausentes no arquivo ainda não devem ser tratadas como divergência confirmada.
          </p>}
          {!exported.hasStatus&&<p className="text-xs text-mist">Sem coluna de status reconhecida: não é possível confrontar ativo/inativo.</p>}
          {!exported.hasExpiry&&<p className="text-xs text-mist">Sem coluna de vencimento reconhecida: comparação de datas indisponível.</p>}
          <AuditGroup title="No servidor, mas não na MaxFlix"
            detail="Logins presentes no arquivo do painel sem correspondência no cadastro deste servidor."
            rows={audit.panelOnly} variant="warn"/>
          <AuditGroup title={fullExport?"Na MaxFlix, mas não no servidor":"Não encontrados no arquivo (conferência pendente)"}
            detail={fullExport?"Logins cadastrados na MaxFlix ausentes na lista completa do servidor.":"Podem faltar apenas porque o arquivo exportado está incompleto."}
            rows={audit.maxflixOnly} variant="warn"/>
          <AuditGroup title="Situação ativo/inativo divergente"
            detail="A classificação do painel não corresponde ao vencimento do cadastro; confira antes de alterar."
            rows={audit.statusDifferences} variant="warn"/>
          {exported.hasExpiry&&<section className="rounded-xl bg-background/60 p-3 ring-1 ring-line" aria-label="Conferir vencimentos">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold">Conferência de vencimentos · {audit.dateDifferences.length}</h3>
                <p className="mt-1 text-xs text-mist">A data vem do arquivo importado, não de uma consulta direta à API. Confirme cada diferença no painel antes de aceitar.</p>
              </div>
              <button type="button" onClick={()=>setShowDateChecks(v=>!v)}
                className="min-h-10 rounded-xl bg-cyan/15 px-3 text-xs font-semibold text-cyan ring-1 ring-cyan/40">
                {showDateChecks?"Ocultar datas":"Conferir datas"}
              </button>
            </div>
            {correctionNotice&&<p role="status" className="mt-3 rounded-lg bg-panel p-3 text-xs text-frost ring-1 ring-line">{correctionNotice}</p>}
            {showDateChecks&&<div className="mt-3 max-h-[36rem] space-y-3 overflow-y-auto">
              {audit.dateDifferences.length===0&&<p className="text-xs text-ok">Nenhuma divergência de datas nas contas com login correspondente.</p>}
              {audit.dateDifferences.map((r,index)=>{
                const client=r.client,account=r.account;
                if(!client||!account?.expires)return null;
                const plan=planPanelDateCorrection(client,account.expires);
                const exactLogin=account.login===client.login;
                const canApprove=exactLogin&&!plan.blockedReason&&correctingId===null;
                return <article key={client.id+"-"+index} className="rounded-lg bg-panel p-3 ring-1 ring-line">
                  <p className="break-words text-sm font-semibold">{client.name}</p>
                  <p className="mt-1 break-all text-xs text-mist">{client.login} · {selected}</p>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <p>MaxFlix: <strong>{formatDate(client.due_date)}</strong></p>
                    <p>Painel: <strong>{formatDate(account.expires)}</strong></p>
                    <p>Financeiro atual: <strong>{formatDate(client.financial_due_date)}</strong></p>
                    <p>Após aprovação: <strong>{formatDate(plan.financialDueDate)}</strong></p>
                  </div>
                  <p className="mt-2 text-xs text-mist">
                    {plan.preservedFinancial?"Cobertura financeira preservada; somente o acesso poderá ser corrigido.":"A conferência não comprova pagamento: esta diferença exige revisão financeira manual."}
                  </p>
                  {!exactLogin&&<p className="mt-2 text-xs text-warn">Login não idêntico (maiúsculas/minúsculas). Correção automática bloqueada.</p>}
                  {plan.blockedReason&&<p className="mt-2 text-xs text-warn">{plan.blockedReason}</p>}
                  <button type="button" disabled={!canApprove} onClick={()=>void approveDateCorrection(r)}
                    className="mt-3 min-h-10 rounded-lg bg-cyan/15 px-3 text-xs font-semibold text-cyan ring-1 ring-cyan/30 disabled:cursor-not-allowed disabled:opacity-40">
                    {correctingId===client.id?"Conferindo…":"Aprovar correção deste cliente"}
                  </button>
                </article>;
              })}
            </div>}
          </section>}
          {(audit.duplicatePanel.length>0||audit.duplicateMaxflix.length>0)&&<div className="rounded-xl bg-warn/10 p-3 text-xs text-warn ring-1 ring-warn/30">
            <p className="font-semibold">Logins duplicados ou ambíguos:</p>
            {audit.duplicatePanel.length>0&&<p>Painel: {audit.duplicatePanel.join(", ")}</p>}
            {audit.duplicateMaxflix.length>0&&<p>MaxFlix: {audit.duplicateMaxflix.join(", ")}</p>}
            <p>Estes logins não são comparados automaticamente enquanto houver duplicidade.</p>
          </div>}
          <div className="flex items-start gap-2 rounded-lg bg-background/55 p-3 text-xs text-mist ring-1 ring-line">
            <ShieldCheck size={18} className="shrink-0 text-ok"/>
            A comparação nunca altera dados automaticamente. Correções individuais exigem sua confirmação
            e não geram cobrança ou consumo de crédito. Datas no passado, cobertura ultrapassada e logins ambíguos ficam bloqueados.
          </div>
        </div>}
      </section>
    </>}
  </main>;
}
