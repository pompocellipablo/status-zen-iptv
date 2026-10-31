import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight, CalendarClock, CircleAlert, Coins, Gift, LayoutDashboard,
  RefreshCw, Tv, Users, Wallet, Eye, EyeOff,
} from "lucide-react";
import { creditStockOverview, prioritizeCreditStocks } from "@/lib/credit-stock-overview";
import type { CreditMovement } from "@/lib/server-credits";
import { supabase } from "@/integrations/supabase/client";
import { formatBRL, getStatus, type Client } from "@/lib/iptv";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "MaxFlix — Dashboard" },
      { name: "description", content: "Visão geral de vencimentos, faturamento, créditos e custos da MaxFlix." },
    ],
  }),
  component: Dashboard,
});

type Payment = { id: string; amount: number; cost: number; paid_at: string };
type BoxSaleSummary = {
  id: string; quantity: number | null;
  amount_received: number | null; device_cost: number | null;
};

const tile = "rounded-2xl bg-panel/80 p-4 ring-1 ring-line transition-colors hover:bg-panel2 hover:ring-cyan/40";
const label = "text-[11px] font-medium uppercase tracking-wider text-mist";
const number = "mt-2 break-words font-display text-2xl font-semibold tabular-nums sm:text-3xl";

function Dashboard() {
  const [financialsHidden, setFinancialsHidden] = useState(true);
  const [financialsReady, setFinancialsReady] = useState(false);
  useEffect(() => {
    setFinancialsHidden(window.localStorage.getItem("maxflix-hide-financials") === "true");
    setFinancialsReady(true);
  }, []);
  const toggleFinancials = () => {
    setFinancialsHidden(previous => {
      const next = !previous;
      window.localStorage.setItem("maxflix-hide-financials", String(next));
      return next;
    });
  };
  const money = (value: number) => !financialsReady || financialsHidden ? "••••••" : formatBRL(value);

  const clientsQuery = useQuery({
    queryKey: ["clients"],
    queryFn: async () => {
      const all:Client[] = [];
      for(let offset=0;offset<25000;offset+=1000) {
        const {data,error}=await supabase.from("clients").select("*")
          .order("due_date", {ascending:true}).range(offset,offset+999);
        if(error)throw error;
        all.push(...(data??[]).map(c=>({
          ...c,cost:Number(c.cost),paid:Number(c.paid),prev_cost:Number(c.prev_cost),prev_paid:Number(c.prev_paid),
        })) as Client[]);
        if(!data||data.length<1000)break;
      }
      return all;
    },
  });
  const paymentsQuery = useQuery({
    queryKey: ["dashboard-payments"],
    queryFn: async () => {
      const all:Payment[]=[];
      for(let offset=0;offset<25000;offset+=1000){
        const {data,error}=await supabase.from("payments").select("id,amount,cost,paid_at")
          .order("paid_at",{ascending:false}).order("id",{ascending:false})
          .range(offset,offset+999);
        if(error)throw error;
        all.push(...(data??[]).map(p=>({
          id:p.id,paid_at:p.paid_at,amount:Number(p.amount),cost:Number(p.cost),
        })));
        if(!data||data.length<1000)break;
      }
      return all;
    },
  });
  const boxSalesQuery=useQuery({
    queryKey:["dashboard-box-sales"],
    queryFn:async()=>{
      const {data,error}=await supabase.from("box_sales")
        .select("id,quantity,amount_received,device_cost");
      if(error)throw error;
      return data as BoxSaleSummary[] ?? [];
    },
  });
  const creditsQuery=useQuery({
    queryKey:["credit-stock-dashboard-movements"],
    queryFn:async()=>{
      const all:CreditMovement[]=[];
      for(let offset=0;offset<20000;offset+=500){
        const {data,error}=await supabase.from("server_credit_movements")
          .select("id,server,kind,quantity,created_at")
          .order("created_at",{ascending:false}).order("id",{ascending:false})
          .range(offset,offset+499);
        if(error)throw error;
        all.push(...(data??[]));
        if(!data||data.length<500)break;
      }
      return all;
    },
  });
  const alertsQuery=useQuery({
    queryKey:["credit-stock-dashboard-alerts"],
    queryFn:async()=>{
      const {data,error}=await supabase.from("server_credit_alerts")
        .select("server,minimum_balance");
      if(error)throw error;
      return data??[];
    },
  });

  const clients = useMemo(()=>clientsQuery.data??[],[clientsQuery.data]);
  const payments = useMemo(()=>paymentsQuery.data??[],[paymentsQuery.data]);
  const stats = useMemo(()=>{
    const active=clients.filter(c=>getStatus(c).key!=="vencido");
    const today=active.filter(c=>getStatus(c).key==="hoje");
    const nextFive=active.filter(c=>{
      const days=getStatus(c).days;
      return days>=1&&days<=5;
    });
    const covered=today.filter(c=>{
      if(!c.financial_due_date)return false;
      const [y,m,d]=c.due_date.split("-").map(Number);
      const next=new Date(y ?? 1970,(m??1),1);
      const last=new Date(next.getFullYear(),next.getMonth()+1,0).getDate();
      const nextDue=[next.getFullYear(),String(next.getMonth()+1).padStart(2,"0"),String(Math.min(d??1,last)).padStart(2,"0")].join("-");
      return c.financial_due_date >= nextDue;
    });
    const free=active.filter(c=>c.access_type==="gratuidade"||c.access_type==="meu_acesso");
    const review=active.filter(c=>c.paid===0&&(c.access_type??"padrao")==="padrao"
      &&(!c.financial_due_date||c.financial_due_date<=c.due_date));
    return {
      total:clients.length,active:active.length,expired:clients.length-active.length,
      today:today.length,coveredToday:covered.length,nextFive:nextFive.length,
      cost:active.reduce((sum,c)=>sum+c.cost,0),
      freeCost:free.reduce((sum,c)=>sum+c.cost,0),
      freeCount:free.length,needsReview:review.length,
    };
  },[clients]);
  const months=useMemo(()=>{
    const byMonth=new Map<string,{amount:number;cost:number;count:number}>();
    for(const p of payments){
      const m=p.paid_at.slice(0,7);
      const prev=byMonth.get(m)??{amount:0,cost:0,count:0};
      prev.amount+=p.amount;prev.cost+=p.cost;prev.count+=1;
      byMonth.set(m,prev);
    }
    return [...byMonth].sort((a,b)=>b[0].localeCompare(a[0])).slice(0,6);
  },[payments]);
  const currentMonth=useMemo(()=>{
    const date=new Date();
    const key=[date.getFullYear(),String(date.getMonth()+1).padStart(2,"0")].join("-");
    return {key, ... (months.find(row=>row[0]===key)?.[1] ?? {amount:0,cost:0,count:0})};
  },[months]);
  const stocks=useMemo(()=>prioritizeCreditStocks(creditStockOverview(
    creditsQuery.data??[], alertsQuery.data??[], clients
  )),[creditsQuery.data,alertsQuery.data,clients]);
  const shortage=stocks.filter(row=>row.lowStock);
  const monthLabel=(ym:string)=>{
    const [year,month]=ym.split("-").map(Number);
    return new Date(year ?? 1970,(month ?? 1)-1,1).toLocaleDateString("pt-BR",{month:"short",year:"numeric"});
  };
  const boxSales=boxSalesQuery.data??[];
  const boxesConfirmed=boxSales.reduce((sum,s)=>sum+(s.quantity??0),0);
  const dataError=clientsQuery.isError||paymentsQuery.isError;

  return <main className="relative min-h-screen bg-background text-frost">
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute -right-40 -top-48 h-[600px] w-[600px] rounded-full bg-cyan/10 blur-3xl"/>
    </div>
    <div className="relative z-10 mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-cyan">Painel principal</p>
          <h1 className="mt-1 flex items-center gap-2 font-display text-2xl font-bold sm:text-3xl">
            <LayoutDashboard size={26} className="text-cyan"/> Dashboard MaxFlix
          </h1>
          <p className="mt-1 text-sm text-mist">Visão rápida do negócio e do que precisa ser feito hoje.</p>
        </div>
        <button type="button" onClick={toggleFinancials}
          title={financialsHidden?"Mostrar valores financeiros":"Ocultar valores financeiros"}
          aria-label={financialsHidden?"Mostrar valores financeiros":"Ocultar valores financeiros"}
          className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-panel px-3 py-2 text-xs font-semibold text-mist ring-1 ring-line hover:bg-panel2">
          {financialsHidden?<EyeOff size={17}/>:<Eye size={17}/>}
          {financialsHidden?"Mostrar valores":"Ocultar valores"}
        </button>
      </div>
      {dataError&&<p role="alert" className="rounded-xl bg-danger/10 p-3 text-sm text-danger ring-1 ring-danger/30">
        Não foi possível atualizar todos os indicadores. Confira a conexão e atualize a página.
      </p>}

      <section aria-label="Prioridades de hoje" className="rounded-2xl bg-panel/70 p-4 ring-1 ring-cyan/20 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-semibold">Prioridades de hoje</h2>
            <p className="mt-1 text-xs text-mist">Comece pelas renovações; o restante fica no menu lateral.</p>
          </div>
          <CalendarClock size={22} className="shrink-0 text-cyan"/>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Link to="/renovacoes" search={{tab:"hoje"}}
            className="rounded-xl bg-today/10 p-3 ring-1 ring-today/30 hover:bg-today/15">
            <p className={label+" text-today"}>Vence hoje</p>
            <p className={number+" text-today"}>{clientsQuery.isLoading?"—":stats.today}</p>
            <p className="mt-1 text-xs text-mist">Abrir vencimentos</p>
          </Link>
          <Link to="/renovacoes" search={{tab:"vencidos"}}
            className="rounded-xl bg-danger/10 p-3 ring-1 ring-danger/30 hover:bg-danger/15">
            <p className={label+" text-danger"}>Vencidos</p>
            <p className={number+" text-danger"}>{clientsQuery.isLoading?"—":stats.expired}</p>
            <p className="mt-1 text-xs text-mist">Recuperar pagamentos</p>
          </Link>
          <Link to="/renovacoes" search={{tab:"breve"}}
            className="col-span-2 rounded-xl bg-background/55 p-3 ring-1 ring-line hover:bg-frost/5 sm:col-span-1">
            <p className={label}>Próximos 5 dias</p>
            <p className={number+" text-warn"}>{clientsQuery.isLoading?"—":stats.nextFive}</p>
            <p className="mt-1 text-xs text-mist">Preparar cobranças</p>
          </Link>
        </div>
        <Link to="/renovacoes" search={{tab:"hoje"}}
          className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-cyan px-3 py-3 text-center text-sm font-bold text-background shadow-[0_0_15px_rgba(0,197,212,0.15)] transition-colors hover:brightness-110">
          <RefreshCw size={18}/> Ir para renovações de hoje <ArrowRight size={18}/>
        </Link>
        {!clientsQuery.isLoading&&stats.today>0&&stats.coveredToday>0&&
          <p className="mt-2 text-xs text-mist">{stats.coveredToday} dos vencimentos de hoje estão cobertos até o próximo ciclo por pacote já pago. Confira cada renovação antes de cobrar.</p>}
      </section>

      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-base font-semibold">Resumo do negócio</h2>
        <Link to="/renovacoes" search={{tab:"todos"}} className="text-xs font-semibold text-cyan hover:underline">Gerenciar clientes →</Link>
      </div>
      <section aria-label="Indicadores operacionais" className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Link to="/renovacoes" search={{tab:"todos"}} className={tile}>
          <Users size={18} className="text-cyan"/>
          <p className={number}>{clientsQuery.isLoading?"—":stats.active}</p>
          <p className="mt-1 text-xs text-mist">Clientes ativos</p>
          <p className="mt-1 text-[11px] text-mist/75">{stats.total} cadastrados</p>
        </Link>
        <Link to="/faturamento/$month" params={{month:currentMonth.key}} className={tile}>
          <Wallet size={18} className="text-cyan"/>
          <p className={number+" text-cyan"}>{paymentsQuery.isLoading?"—":money(currentMonth.amount)}</p>
          <p className="mt-1 text-xs text-mist">Recebido neste mês</p>
          <p className="mt-1 text-[11px] text-mist/75">{currentMonth.count} pagamentos registrados</p>
        </Link>
        <Link to="/creditos" className={tile}>
          <Coins size={18} className={shortage.length?"text-warn":"text-cyan"}/>
          <p className={number+(shortage.length?" text-warn":"")}>
            {creditsQuery.isLoading||alertsQuery.isLoading?"—":shortage.length}
          </p>
          <p className="mt-1 text-xs text-mist">Servidores com alerta de crédito</p>
          <p className="mt-1 text-[11px] text-mist/75">{stocks.filter(s=>s.configured).length} saldos configurados</p>
        </Link>
        <Link to="/renovacoes" search={{tab:"todos"}} className={tile}>
          <Wallet size={18} className="text-cyan"/>
          <p className={number}>{clientsQuery.isLoading?"—":money(stats.cost)}</p>
          <p className="mt-1 text-xs text-mist">Custo dos créditos dos ativos</p>
          <p className="mt-1 text-[11px] text-mist/75">Estimativa por ciclo, não gasto já pago</p>
        </Link>
        <Link to="/renovacoes" search={{tab:"todos",access:"gratuitos"}} className={tile}>
          <Gift size={18} className="text-cyan"/>
          <p className={number}>{clientsQuery.isLoading?"—":money(stats.freeCost)}</p>
          <p className="mt-1 text-xs text-mist">Família / amigos e meus testes</p>
          <p className="mt-1 text-[11px] text-mist/75">{stats.freeCount} acessos classificados · {stats.needsReview} a revisar</p>
        </Link>
        <Link to="/aparelhos" className={tile}>
          <Tv size={18} className="text-cyan"/>
          <p className={number}>{boxSalesQuery.isLoading?"—":boxSales.length}</p>
          <p className="mt-1 text-xs text-mist">Compradores de TV Box</p>
          <p className="mt-1 text-[11px] text-mist/75">{boxesConfirmed} aparelhos confirmados</p>
        </Link>
      </section>

      <section className="rounded-2xl bg-panel/70 p-4 ring-1 ring-line sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-base font-semibold">Faturamento por mês</h2>
            <p className="mt-1 text-xs text-mist">Recebimentos registrados nas renovações; toque para ver cada cliente.</p>
          </div>
          <Link to="/indicacoes" className="text-xs font-semibold text-cyan hover:underline">Indicações e ranking →</Link>
        </div>
        {paymentsQuery.isLoading?
          <p className="mt-3 text-xs text-mist">Carregando pagamentos...</p>
        :months.length===0?
          <p className="mt-3 text-xs text-mist">Nenhum pagamento registrado.</p>
        :<div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {months.map(([ym,values])=>
            <Link key={ym} to="/faturamento/$month" params={{month:ym}}
              className="rounded-xl bg-background/50 p-3 ring-1 ring-line transition-colors hover:bg-frost/5 hover:ring-cyan/40">
              <p className="text-[11px] font-semibold uppercase text-mist">{monthLabel(ym)}</p>
              <p className="mt-2 break-words font-display text-base font-semibold text-cyan">{money(values.amount)}</p>
              <p className="mt-1 text-[11px] text-mist">{values.count} recebimentos</p>
              <p className="mt-2 text-[11px] text-cyan">Ver detalhes →</p>
            </Link>
          )}
        </div>}
      </section>
      <section className="flex flex-wrap items-center gap-2 pb-4 text-xs text-mist">
        <CircleAlert size={16} className="text-warn"/>
        Os valores de vendas de TV Box não são somados ao faturamento de assinaturas para evitar dupla contagem.
        Pagamentos antecipados aparecem no mês em que foram registrados.
      </section>
    </div>
  </main>;
}
