import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CalendarDays, Download, Search, Receipt } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatBRL } from "@/lib/iptv";

export const Route = createFileRoute("/_authenticated/faturamento/$month")({
  head: () => ({ meta: [{title:"Faturamento detalhado — MaxFlix"}] }),
  component: MonthlyPaymentsPage,
});

type Payment = {
  id:string;client_id:string|null;client_name:string;server:string;
  amount:number;cost:number;paid_at:string;created_at:string;
};
type ClientLookup = {id:string;login:string;name:string};

function parseMonth(value:string) {
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(value))return null;
  const [y,m]=value.split("-").map(Number);
  const monthEnd=new Date(Date.UTC(y,m,1)).toISOString().slice(0,10);
  return {
    start:value+"-01",end:monthEnd,
    label:new Date(Date.UTC(y,m-1,1)).toLocaleDateString("pt-BR",{month:"long",year:"numeric",timeZone:"UTC"}),
  };
}
function csvField(value:unknown):string {
  const content=String(value??"");
  const safe=/^[=+\-@\t\r]/.test(content)? "'"+content:content;
  return '"'+safe.replaceAll('"','""')+'"';
}
function paymentCsv(rows:Payment[],clientMap:Map<string,ClientLookup>):string {
  const header=["Data","Cliente","Login","Servidor","Valor recebido","Custo","Lucro"];
  const lines=rows.map(row=>[
    row.paid_at,row.client_name,row.client_id?clientMap.get(row.client_id)?.login??"":"",row.server,
    row.amount.toFixed(2).replace(".",","),row.cost.toFixed(2).replace(".",","), (row.amount-row.cost).toFixed(2).replace(".",","),
  ]);
  return "\uFEFF"+[header,...lines].map(r=>r.map(csvField).join(";")).join("\r\n");
}
function MonthlyPaymentsPage() {
  const {month}=Route.useParams();
  const selection=parseMonth(month);
  const [search,setSearch]=useState("");
  const [server,setServer]=useState("todos");
  const [hideMoney,setHideMoney]=useState(true);

  useEffect(()=>{
    setHideMoney(window.localStorage.getItem("maxflix-hide-financials")==="true");
  },[]);
  const result=useQuery({
    queryKey:["payments-by-month",month],
    enabled:!!selection,
    queryFn:async()=>{
      if(!selection)return [] as Payment[];
      const all:Payment[]=[];
      for(let offset=0;offset<50000;offset+=1000){
        const {data,error}=await supabase.from("payments").select("id,client_id,client_name,server,amount,cost,paid_at,created_at")
          .gte("paid_at",selection.start).lt("paid_at",selection.end)
          .order("paid_at",{ascending:true}).order("created_at",{ascending:true})
          .range(offset,offset+999);
        if(error)throw error;
        const rows=(data??[]).map(p=>({...p,amount:Number(p.amount),cost:Number(p.cost)}));
        all.push(...rows);
        if(rows.length<1000)break;
      }
      return all;
    },
  });
  const clientsQuery=useQuery({
    queryKey:["billing-client-lookup"],
    queryFn:async()=>{
      const all:ClientLookup[]=[];
      for(let offset=0;offset<50000;offset+=1000){
        const {data,error}=await supabase.from("clients").select("id,login,name")
          .order("name",{ascending:true}).range(offset,offset+999);
        if(error)throw error;
        all.push(...(data??[]));
        if(!data||data.length<1000)break;
      }
      return all;
    },
  });
  const clientMap=useMemo(()=>new Map((clientsQuery.data??[]).map(p=>[p.id,p])),[clientsQuery.data]);
  const full=result.data??[];
  const servers=useMemo(()=>[...new Set(full.map(p=>p.server))].sort((a,b)=>a.localeCompare(b,"pt-BR")),[full]);
  const filtered=useMemo(()=>{
    const term=search.trim().toLocaleLowerCase("pt-BR");
    return full.filter(p=>
      (server==="todos"||p.server===server)&&(!term||
      [p.client_name,p.server,p.client_id?clientMap.get(p.client_id)?.login??"":""]
        .join(" ").toLocaleLowerCase("pt-BR").includes(term)));
  },[full,server,search,clientMap]);
  const total=useMemo(()=>filtered.reduce((s,p)=>({amount:s.amount+p.amount,cost:s.cost+p.cost}),{amount:0,cost:0}),[filtered]);
  const mask=(value:number)=>hideMoney?"••••••":formatBRL(value);
  const exportCsv=()=>{
    if(hideMoney){
      if(!window.confirm("Você ocultou os valores financeiros. Deseja exportar a planilha com os valores reais?"))return;
    }
    const content=paymentCsv(filtered,clientMap);
    const blob=new Blob([content],{type:"text/csv;charset=utf-8;"});
    const href=URL.createObjectURL(blob);
    const anchor=document.createElement("a");anchor.href=href;anchor.download="faturamento-maxflix-"+month+".csv";anchor.click();
    URL.revokeObjectURL(href);
  };

  return <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 text-frost sm:px-6 sm:py-8">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-cyan">MAXFLIX · FINANCEIRO</p>
        <h1 className="mt-1 flex items-center gap-2 font-display text-2xl font-bold sm:text-3xl">
          <Receipt size={24} className="text-cyan"/> Faturamento detalhado
        </h1>
        <p className="mt-1 flex items-center gap-1 text-sm capitalize text-mist">
          <CalendarDays size={15}/> {selection?.label??"Mês inválido"}
        </p>
      </div>
      <Link to="/" className="flex min-h-10 items-center gap-2 rounded-xl border border-line bg-panel px-3 py-2 text-sm hover:bg-panel2">
        <ArrowLeft size={16}/> Voltar ao painel
      </Link>
    </div>
    {!selection?<div className="rounded-xl bg-panel p-6 text-sm text-danger">
      O mês informado não é válido. Abra uma referência diretamente pelo painel de faturamento.
    </div>:<>
      <p className="text-xs text-mist">
        Valores históricos registrados em Pagamentos pela data de recebimento. Pacotes pagos antecipadamente aparecem no mês em que foram recebidos, não novamente em cada mês de uso.
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["Lançamentos",String(filtered.length)],
          ["Recebido",mask(total.amount)],
          ["Custo registrado",mask(total.cost)],
          ["Resultado dos lançamentos",mask(total.amount-total.cost)],
        ].map(([title,value])=><div key={title} className="min-w-0 rounded-xl bg-panel p-3 ring-1 ring-line">
          <p className="break-words font-display text-lg font-bold text-cyan">{value}</p>
          <p className="mt-1 text-xs text-mist">{title}</p>
        </div>)}
      </div>
      <section className="rounded-xl bg-panel p-3 ring-1 ring-line">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[190px] flex-1">
            <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mist"/>
            <input className="h-10 w-full rounded-lg border border-line bg-panel2 pl-10 pr-3 text-sm outline-none focus:border-cyan"
              placeholder="Buscar cliente ou login" value={search} onChange={e=>setSearch(e.target.value)} />
          </div>
          <select aria-label="Filtrar por servidor" className="h-10 rounded-lg border border-line bg-panel2 px-3 text-sm"
            value={server} onChange={e=>setServer(e.target.value)}>
            <option value="todos">Todos os servidores</option>
            {servers.map(s=><option key={s} value={s}>{s}</option>)}
          </select>
          <button className="flex min-h-10 items-center gap-2 rounded-lg border border-line bg-panel2 px-3 py-2 text-xs font-semibold text-frost"
            type="button" onClick={()=>setHideMoney(v=>!v)}>
            {hideMoney?"Mostrar valores":"Ocultar valores"}
          </button>
          <button disabled={filtered.length===0} className="flex min-h-10 items-center gap-2 rounded-lg border border-line bg-panel2 px-3 py-2 text-xs font-semibold text-cyan disabled:opacity-40"
            onClick={exportCsv}>
            <Download size={15}/> CSV
          </button>
        </div>
      </section>
      {result.isLoading?<p className="rounded-xl bg-panel p-6 text-sm text-mist">Consultando os pagamentos...</p>
       :result.error?<p role="alert" className="rounded-xl bg-panel p-6 text-sm text-danger">
         Erro ao buscar pagamentos. {result.error.message}
       </p>
       :filtered.length===0?<p className="rounded-xl bg-panel p-6 text-sm text-mist">Nenhum lançamento encontrado com esses filtros.</p>
       :<div className="space-y-2">
         {filtered.map(p=><article key={p.id} className="grid min-w-0 gap-3 rounded-xl bg-panel p-3 ring-1 ring-line sm:grid-cols-[110px_minmax(0,1fr)_150px_110px_100px_100px] sm:items-center sm:gap-2">
           <div className="text-xs font-medium text-mist">{p.paid_at.split("-").reverse().join("/")}</div>
           <div className="min-w-0">
             <p className="break-words text-sm font-semibold text-frost">{p.client_name}</p>
             {p.client_id&&clientMap.get(p.client_id)&&<p className="break-all text-xs text-mist">Login: {clientMap.get(p.client_id)?.login}</p>}
           </div>
           <p className="text-xs text-mist">{p.server}</p>
           <div className="min-w-0"><p className="text-[10px] text-mist sm:hidden">Recebido</p><p className="break-words text-sm text-cyan">{mask(p.amount)}</p></div>
           <div className="min-w-0"><p className="text-[10px] text-mist sm:hidden">Custo</p><p className="break-words text-xs">{mask(p.cost)}</p></div>
           <div className="min-w-0"><p className="text-[10px] text-mist sm:hidden">Lucro</p><p className={"break-words text-xs "+(p.amount-p.cost>=0?"text-ok":"text-danger")}>{mask(p.amount-p.cost)}</p></div>
         </article>)}
       </div>}
      <p className="pb-3 text-xs text-mist">
        O custo e o resultado aqui representam os valores armazenados em cada lançamento de pagamento. Custos de crédito consumidos em meses pré-pagos podem aparecer em outros períodos e não devem ser confundidos com lucro contábil mensal.
      </p>
    </>}
  </main>;
}
