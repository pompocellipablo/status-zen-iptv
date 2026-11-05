import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarClock, CheckCircle2, CircleAlert, FileSearch, Search, Server, ShieldCheck, Upload, Users, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { SERVERS, formatDate, getStatus, planPanelDateCorrection, type Client } from "@/lib/iptv";
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

  const queryClient=useQueryClient();
  const clientsQuery=useQuery({queryKey:["clients"],queryFn:fetchClients});
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
  const runSimulation=async(client:Client)=>{
    if(simulatingId)return;
    if(!panelRouteForClient(client.server))return;
    setSimulatingId(client.id);
    setSimulation(null);
    try{
      const {data,error}=await supabase.functions.invoke("painel-recarga-renovar",{
        body:{mode:"simulate",clientId:client.id,expectedDueDate:client.due_date},
      });
      let response=data as {simulated?:boolean;outcome?:{status?:string;message?:string};message?:string}|null;
      if(error){
        const http=(error as {context?:unknown}).context;
        if(http instanceof Response){try{response=await http.json();}catch{response=null;}}
        throw Error(response?.message ?? error.message);
      }
      const status=response?.outcome?.status;
      setSimulation({clientId:client.id,ok:response?.simulated===true&&status==="simulated",
        message:response?.outcome?.message??response?.message??"O painel não retornou um resultado reconhecido."});
    }catch(err){
      setSimulation({clientId:client.id,ok:false,message:err instanceof Error?err.message:"Não foi possível consultar o painel. Confira o deploy da função."});
    }finally{setSimulatingId(null);}
  };
  const choose=(name:string)=>{
    setLocalSelection(name);setMode("todos");setSearch("");setExpanded(false);
    setExported(null);setImportedFile(null);setImportError(null);setFullExport(false);setSimulation(null);
    setShowDateChecks(false);setCorrectionNotice(null);
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

  const approveDateCorrection=async(row:PanelAuditRow)=>{
    const client=row.client,account=row.account;
    if(!client||!account?.expires||correctingId)return;
    setCorrectionNotice(null);
    if(client.server!==selected||account.login!==client.login){
      setCorrectionNotice("Login ou servidor diferente: confira manualmente; nenhuma data foi alterada.");
      return;
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
      plan.preservedFinancial?"A cobertura financeira já paga será preservada.":"As datas eram iguais e continuarão iguais.",
      "Fonte: lista exportada manualmente. Confira a validade no painel antes de continuar.",
      "NÃO registra pagamento, renovação no servidor nem movimentação de créditos. Confirmar?",
    ].join("\n");
    if(!window.confirm(message))return;
    setCorrectingId(client.id);
    try{
      let request=supabase.from("clients").update({
        due_date:plan.dueDate,financial_due_date:plan.financialDueDate,
      }).eq("id",client.id).eq("server",selected).eq("login",client.login).eq("due_date",client.due_date);
      request=client.financial_due_date===null
        ?request.is("financial_due_date",null)
        :request.eq("financial_due_date",client.financial_due_date);
      const {data,error}=await request.select("id").maybeSingle();
      if(error)throw error;
      if(!data)throw Error("O cadastro foi modificado desde a exportação. Recarregue e confira novamente.");
      await queryClient.invalidateQueries({queryKey:["clients"]});
      setCorrectionNotice(client.name+": vencimento conferido e corrigido. Os dados financeiros seguem a regra de cobertura, sem lançar pagamento.");
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
          <p className="text-sm font-semibold text-cyan">Teste da integração — somente simulação</p>
          <p className="mt-1 text-xs text-mist">
            Para verificar a API, clique em "Simular" ao lado de um cliente.
            O modo envia simular: true e não registra renovação, pagamento ou consumo de créditos na MaxFlix.
            Se a simulação não estiver habilitada no servidor, o teste será bloqueado.
          </p>
          <p className="mt-2 text-xs text-mist">O resultado aparecerá junto ao cliente selecionado, sem alterar sua assinatura.</p>
        </div>}
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
                  disabled={simulatingId!==null} onClick={()=>void runSimulation(c)}
                  className="mt-1 min-h-9 rounded-lg bg-cyan/15 px-3 text-xs font-semibold text-cyan ring-1 ring-cyan/30 disabled:opacity-50">
                  {simulatingId===c.id?"Simulando…":"Simular no painel"}
                </button>}
                {simulation?.clientId===c.id&&<p role="status" aria-live="polite"
                  className={"mt-2 max-w-sm rounded-lg px-3 py-2 text-left text-xs ring-1 "+(simulation.ok?"bg-ok/10 text-ok ring-ok/20":"bg-warn/10 text-warn ring-warn/20")}>
                  {simulation.ok?"Simulação validada: ":"Simulação não validada: "}{simulation.message}
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
          Exporte uma lista CSV ou TXT do painel do servidor com a coluna de login. Se houver colunas
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
                    {plan.preservedFinancial?"Cobertura financeira mantida; somente o acesso será corrigido.":"As duas datas serão corrigidas juntas, porque eram iguais."}
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
