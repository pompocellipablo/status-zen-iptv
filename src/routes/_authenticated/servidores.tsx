import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CalendarClock, CheckCircle2, CircleAlert, FileSearch, Search, Server, ShieldCheck, Upload, Users, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { SERVERS, formatDate, getStatus, type Client } from "@/lib/iptv";
import { auditServerAccounts, parsePanelExport, type ParsedPanelExport, type PanelAuditRow } from "@/lib/server-panel-audit";

export const Route = createFileRoute("/_authenticated/servidores")({
  validateSearch: (query: Record<string, unknown>) => ({
    servidor: typeof query.servidor === "string" && query.servidor.length <= 100 ? query.servidor : undefined,
  }),
  head: () => ({meta:[{title:"Servidores e auditoria — MaxFlix"}]}),
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
  const choose=(name:string)=>{
    setLocalSelection(name);setMode("todos");setSearch("");setExpanded(false);
    setExported(null);setImportedFile(null);setImportError(null);setFullExport(false);
  };
  const handleFile=async (file:File|undefined)=>{
    setImportedFile(null);setExported(null);setImportError(null);setFullExport(false);
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
              <div className="text-right">
                <p className={"text-xs font-semibold "+(st.key==="vencido"?"text-danger":st.key==="hoje"?"text-today":"text-ok")}>
                  {st.key==="vencido"?"Vencido":st.key==="hoje"?"Vence hoje":"Ativo"}
                </p>
                <p className="mt-1 text-xs text-mist">Vence {formatDate(c.due_date)}</p>
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
          status e vencimento, podemos apontar também situações e datas divergentes. A comparação
          ocorre somente no navegador, sem modificar cadastros, pagamentos ou créditos.
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
            <button type="button" onClick={()=>{setExported(null);setImportedFile(null);setFullExport(false);}}
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
          <AuditGroup title="Datas de vencimento para revisar"
            detail="Podem existir diferenças legítimas entre o ciclo MaxFlix e a validade do painel, especialmente em pacotes."
            rows={audit.dateDifferences}/>
          {(audit.duplicatePanel.length>0||audit.duplicateMaxflix.length>0)&&<div className="rounded-xl bg-warn/10 p-3 text-xs text-warn ring-1 ring-warn/30">
            <p className="font-semibold">Logins duplicados ou ambíguos:</p>
            {audit.duplicatePanel.length>0&&<p>Painel: {audit.duplicatePanel.join(", ")}</p>}
            {audit.duplicateMaxflix.length>0&&<p>MaxFlix: {audit.duplicateMaxflix.join(", ")}</p>}
            <p>Estes logins não são comparados automaticamente enquanto houver duplicidade.</p>
          </div>}
          <div className="flex items-start gap-2 rounded-lg bg-background/55 p-3 text-xs text-mist ring-1 ring-line">
            <ShieldCheck size={18} className="shrink-0 text-ok"/>
            Nenhuma divergência gera exclusão, renovação, alteração de vencimento ou cobrança automática.
            Faça a conferência manual antes de corrigir qualquer registro.
          </div>
        </div>}
      </section>
    </>}
  </main>;
}
