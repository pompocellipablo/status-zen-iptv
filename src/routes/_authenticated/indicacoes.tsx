import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronDown, ChevronUp, Gift, Medal, RefreshCw, Search, Users, CheckCircle2, Clock3, Award } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { canReceiveNewReferral } from "@/lib/referrals";
import { getStatus, type Client } from "@/lib/iptv";
import { buildReferralRanking, type RankedReferral } from "@/lib/referral-ranking";
import type { ReferralMovement, ReferralReward } from "@/lib/referrals";

export const Route = createFileRoute("/_authenticated/indicacoes")({
  head: () => ({ meta: [{ title: "Ranking de Indicações — MaxFlix" }] }),
  component: ReferralRankingPage,
});

type SortOrder = "confirmadas" | "total" | "pendentes" | "pontos" | "nome";
type FilterMode = "todos" | "ativos" | "pendentes" | "premios";
const field = "rounded-xl border border-line bg-panel2 px-3 py-2.5 text-sm text-frost outline-none focus:border-cyan";
const action = "rounded-xl border border-line bg-panel px-3 py-2 text-xs font-semibold text-cyan hover:bg-panel2 disabled:cursor-not-allowed disabled:opacity-40";
const fmtNumber = (count:number) => count.toLocaleString("pt-BR");

function useLeaderboardData() {
  const clientQuery = useQuery({
    queryKey: ["referral-leaderboard-clients"],
    queryFn: async () => {
      const all: Client[] = [];
      for(let offset=0;offset<50000;offset+=500) {
        const {data,error}=await supabase.from("clients").select("*").order("name",{ascending:true}).range(offset,offset+499);
        if(error)throw error;
        all.push(...(data??[]) as Client[]);
        if(!data||data.length<500)break;
      }
      return all;
    },
  });
  const movementQuery = useQuery({
    queryKey:["referral-movements"],
    queryFn: async () => {
      const all: ReferralMovement[]=[];
      for(let offset=0;offset<50000;offset+=500){
        const {data,error}=await supabase.from("referral_point_movements").select("*")
          .order("created_at",{ascending:false}).range(offset,offset+499);
        if(error)throw error;
        all.push(...(data??[]) as ReferralMovement[]);
        if(!data||data.length<500)break;
      }
      return all;
    },
  });
  const rewardQuery = useQuery({
    queryKey:["referral-rewards"],
    queryFn: async () => {
      const all: ReferralReward[]=[];
      for(let offset=0;offset<50000;offset+=500){
        const {data,error}=await supabase.from("referral_rewards").select("*")
          .order("created_at",{ascending:false}).range(offset,offset+499);
        if(error)throw error;
        all.push(...(data??[]) as ReferralReward[]);
        if(!data||data.length<500)break;
      }
      return all;
    },
  });
  return {clientQuery,movementQuery,rewardQuery};
}

function ReferralRankingPage(){
  const qc=useQueryClient();
  const {clientQuery,movementQuery,rewardQuery}=useLeaderboardData();
  const [search,setSearch]=useState("");
  const [sort,setSort]=useState<SortOrder>("confirmadas");
  const [filter,setFilter]=useState<FilterMode>("todos");
  const [expanded,setExpanded]=useState<string|null>(null);
  const [notice,setNotice]=useState("");
  const [showAll,setShowAll]=useState(false);

  useEffect(()=>{
    // Same audited, idempotent expiration rule used by the existing Points panel.
    // Referrals stay in the historic ranking even when earned points expire.
    let cancelled=false;
    void (async()=>{
      const {error}=await supabase.rpc("referral_reset_expired");
      if(cancelled)return;
      if(error)setNotice("Não foi possível atualizar a expiração dos pontos. O ranking histórico permanece disponível.");
      else await qc.invalidateQueries({queryKey:["referral-movements"]});
    })();
    return ()=>{cancelled=true;};
  },[qc]);

  const ranked=useMemo(()=>buildReferralRanking(
    clientQuery.data??[],movementQuery.data??[],rewardQuery.data??[]
  ),[clientQuery.data,movementQuery.data,rewardQuery.data]);
  const summary=useMemo(()=>({
    indicators:ranked.length,
    confirmed:ranked.reduce((n,r)=>n+r.confirmed,0),
    pending:ranked.reduce((n,r)=>n+r.pending,0),
    available:ranked.reduce((n,r)=>n+r.pointsAvailable,0),
    prizesPending:ranked.reduce((n,r)=>n+r.pendingRewards,0),
  }),[ranked]);
  const filtered=useMemo(()=>{
    const q=search.trim().toLocaleLowerCase("pt-BR");
    const base=ranked.filter(entry=>{
      if(filter==="ativos"&&!canReceiveNewReferral(entry.client))return false;
      if(filter==="pendentes"&&entry.pending===0)return false;
      if(filter==="premios"&&entry.pendingRewards===0)return false;
      if(!q)return true;
      const haystack=[
        entry.client.name,entry.client.login,entry.client.server,entry.client.whatsapp??"",
        ...entry.referrals.flatMap(ref=>[ref.client.name,ref.client.login]),
      ].join(" ").toLocaleLowerCase("pt-BR");
      return haystack.includes(q);
    });
    return [...base].sort((a,b)=>{
      switch(sort){
        case "total":return b.total-a.total || b.confirmed-a.confirmed || a.client.name.localeCompare(b.client.name,"pt-BR");
        case "pendentes":return b.pending-a.pending || b.confirmed-a.confirmed || a.client.name.localeCompare(b.client.name,"pt-BR");
        case "pontos":return b.pointsAvailable-a.pointsAvailable || b.confirmed-a.confirmed || a.client.name.localeCompare(b.client.name,"pt-BR");
        case "nome":return a.client.name.localeCompare(b.client.name,"pt-BR");
        default:return b.confirmed-a.confirmed || b.total-a.total || a.client.name.localeCompare(b.client.name,"pt-BR");
      }
    });
  },[ranked,search,sort,filter]);
  const rows=showAll?filtered:filtered.slice(0,30);
  // Rank is always based on confirmed historical referrals, never on points
  // or filtering: a customer retains their overall place in search results.
  const globalRank=new Map(ranked.map((entry,index)=>[entry.client.id,index+1]));
  const maxConfirmed=Math.max(1,...ranked.map(item=>item.confirmed));

  const confirm=useMutation({
    mutationFn: async ({referrerId,referredId}:{referrerId:string;referredId:string})=>{
      const {error}=await supabase.rpc("referral_award",{
        p_client_id:referrerId,
        p_referred_client_id:referredId,
        p_payment_confirmed:true,
      });
      if(error)throw error;
    },
    onSuccess: async()=>{
      await Promise.all([
        qc.invalidateQueries({queryKey:["referral-leaderboard-clients"]}),
        qc.invalidateQueries({queryKey:["referral-movements"]}),
        qc.invalidateQueries({queryKey:["referral-rewards"]}),
        qc.invalidateQueries({queryKey:["clients"]}),
      ]);
      setNotice("Pagamento confirmado! A indicação foi pontuada e o ranking atualizado.");
    },
    onError:(error:Error)=>setNotice("Não foi possível confirmar: "+error.message),
  });
  const refresh=async()=>{
    setNotice("");
    await Promise.all([
      qc.invalidateQueries({queryKey:["referral-leaderboard-clients"]}),
      qc.invalidateQueries({queryKey:["referral-movements"]}),
      qc.invalidateQueries({queryKey:["referral-rewards"]}),
    ]);
  };
  const loading=clientQuery.isLoading||movementQuery.isLoading||rewardQuery.isLoading;
  const fetchError=clientQuery.error??movementQuery.error??rewardQuery.error;

  return <main className="mx-auto max-w-6xl space-y-5 px-3 py-5 text-frost sm:px-6 sm:py-8">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-xs font-bold uppercase tracking-[.23em] text-cyan">MAXFLIX · PROGRAMA DE INDICAÇÕES</p>
        <h1 className="mt-1 flex items-center gap-2 font-display text-2xl font-bold sm:text-3xl">
          <Medal className="text-cyan" size={29}/> Ranking de Indicações
        </h1>
        <p className="mt-1 text-sm text-mist">
          Quem mais trouxe clientes, quem aguarda confirmação e quantos pontos possui.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={()=>void refresh()} disabled={loading||confirm.isPending} className={action}>
          <RefreshCw className="mr-1 inline" size={14}/> Atualizar
        </button>
        <Link to="/" className={action}><ArrowLeft className="mr-1 inline" size={14}/> Painel principal</Link>
      </div>
    </div>

    <section className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {[
        {label:"Clientes que indicaram",value:summary.indicators,icon:Users},
        {label:"Indicações confirmadas",value:summary.confirmed,icon:CheckCircle2},
        {label:"Aguardando pagamento",value:summary.pending,icon:Clock3},
        {label:"Pontos disponíveis",value:summary.available,icon:Gift},
        {label:"Prêmios pendentes",value:summary.prizesPending,icon:Award},
      ].map(metric=><div key={metric.label} className="rounded-2xl bg-panel p-3 ring-1 ring-line sm:p-4">
        <metric.icon size={18} className="mb-2 text-cyan"/>
        <p className="font-display text-2xl font-bold tabular-nums text-frost">{fmtNumber(metric.value)}</p>
        <p className="mt-1 text-xs text-mist">{metric.label}</p>
      </div>)}
    </section>

    <section className="rounded-2xl bg-panel/70 p-3 ring-1 ring-line sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[195px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mist" size={17}/>
          <input className={field+" w-full pl-10"} placeholder="Buscar indicador ou indicado..."
            aria-label="Buscar cliente indicador ou indicado" value={search} onChange={e=>{setSearch(e.target.value);setShowAll(false);}}/>
        </label>
        <select className={field} aria-label="Ordenar ranking" value={sort} onChange={e=>setSort(e.target.value as SortOrder)}>
          <option value="confirmadas">Mais indicações pagas</option>
          <option value="total">Mais indicações no total</option>
          <option value="pendentes">Mais pagamentos pendentes</option>
          <option value="pontos">Mais pontos disponíveis</option>
          <option value="nome">Nome (A–Z)</option>
        </select>
        <select className={field} aria-label="Filtrar indicadores" value={filter} onChange={e=>{setFilter(e.target.value as FilterMode);setShowAll(false);}}>
          <option value="todos">Ativos e inativos</option>
          <option value="ativos">Somente indicadores ativos</option>
          <option value="pendentes">Com confirmação pendente</option>
          <option value="premios">Com prêmio pendente</option>
        </select>
      </div>
    </section>

    {notice&&<p role="status" className="rounded-xl border border-cyan/30 bg-panel p-3 text-sm">{notice}</p>}
    {loading?<div className="rounded-xl bg-panel p-8 text-center text-sm text-mist">Carregando indicações e pontos...</div>
      :fetchError?<div role="alert" className="rounded-xl bg-danger/10 p-5 text-sm text-danger">
        Não foi possível carregar o ranking. {fetchError instanceof Error?fetchError.message:"Atualize a página e tente novamente."}
      </div>:filtered.length===0?<div className="rounded-xl bg-panel p-8 text-center text-sm text-mist">
        {ranked.length===0?"Nenhuma indicação cadastrada até agora. Cadastre o primeiro indicado pelo painel principal.":"Nenhum indicador encontrado com esses filtros."}
      </div>:<section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-mist">
          <span>{fmtNumber(filtered.length)} indicador(es) encontrado(s)</span>
          <span>Ranking histórico · 1 indicação confirmada = 1 ponto recebido</span>
        </div>
        {rows.map((entry:RankedReferral)=>{
          const isOpen=expanded===entry.client.id;
          const place=globalRank.get(entry.client.id)??0;
          const active=canReceiveNewReferral(entry.client);
          const progress=100*entry.confirmed/maxConfirmed;
          return <article key={entry.client.id} className="overflow-hidden rounded-2xl bg-panel ring-1 ring-line">
            <button onClick={()=>setExpanded(isOpen?null:entry.client.id)}
              aria-expanded={isOpen}
              className="w-full px-3 py-4 text-left hover:bg-panel2/50 sm:px-5">
              <div className="flex flex-wrap items-center gap-3 sm:gap-4">
                <div className={"flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-lg font-bold "+(place===1?"bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/40":place===2?"bg-slate-400/15 text-slate-300":place===3?"bg-orange-500/15 text-orange-300":"bg-background text-mist")}>
                  {place<=3?["🥇","🥈","🥉"][place-1]:"#"+place}
                </div>
                <div className="min-w-[130px] flex-1">
                  <p className="break-words font-semibold text-frost">{entry.client.name}</p>
                  <p className="mt-1 break-words text-xs text-mist">{entry.client.login} · {entry.client.server} · {active?"Ativo":"Inativo — histórico mantido"}</p>
                  <div className="mt-2 h-1.5 w-full max-w-[300px] overflow-hidden rounded-full bg-background">
                    <div className="h-full rounded-full bg-cyan" style={{width:progress+"%"}}/>
                  </div>
                </div>
                <div className="grid flex-1 grid-cols-3 gap-2 text-center sm:max-w-[310px]">
                  <div><p className="font-display text-xl font-bold text-cyan tabular-nums">{entry.confirmed}</p><p className="text-[10px] text-mist">Confirmadas</p></div>
                  <div><p className="font-display text-xl font-bold tabular-nums">{entry.pending}</p><p className="text-[10px] text-mist">Pendentes</p></div>
                  <div><p className="font-display text-xl font-bold tabular-nums">{entry.pointsAvailable}</p><p className="text-[10px] text-mist">Pontos</p></div>
                </div>
                {isOpen?<ChevronUp size={19} className="shrink-0 text-cyan"/>:<ChevronDown size={19} className="shrink-0 text-mist"/>}
              </div>
            </button>
            {isOpen&&<div className="space-y-4 border-t border-line px-3 py-4 sm:px-5">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  ["Total de indicados",entry.total],
                  ["Indicados pagos e ativos",entry.activeReferred],
                  ["Pontos já resgatados",entry.pointsRedeemed],
                  ["Pontos expirados",entry.pointsExpired],
                ].map(([label,value])=><div key={label} className="rounded-xl bg-background/70 p-3">
                  <div className="font-display text-lg font-semibold">{value}</div>
                  <div className="text-xs text-mist">{label}</div>
                </div>)}
              </div>
              <p className="text-xs text-mist">
                Histórico de {entry.confirmed} indicação(ões) com primeiro pagamento confirmado.
                {entry.pointsRestored>0?" Pontos restaurados por correções: "+entry.pointsRestored+".":""}
                {entry.pendingRewards>0?" Prêmios aguardando entrega ou utilização: "+entry.pendingRewards+".":""}
              </p>
              <div>
                <h3 className="mb-2 text-sm font-bold">Quem esse cliente indicou</h3>
                {entry.referrals.length===0?<p className="text-sm text-mist">Nenhum indicado identificado no cadastro atual.</p>:
                  <div className="space-y-2">
                    {entry.referrals.map(ref=><div key={ref.client.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-background/70 px-3 py-3">
                      <div className="min-w-[180px] flex-1">
                        <p className="break-words text-sm font-semibold">{ref.client.name}</p>
                        <p className="text-xs text-mist">{ref.client.login} · {ref.client.server} · {ref.active?"Em dia":"Vencido"}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={"rounded-lg px-2 py-1 text-xs "+(ref.confirmed?"bg-emerald-500/10 text-emerald-300":"bg-amber-500/10 text-amber-300")}>
                          {ref.confirmed?"✓ Primeiro pagamento confirmado":"Aguardando pagamento"}
                        </span>
                        {!ref.confirmed&&
                          <button className={action}
                            disabled={!active||!ref.active||confirm.isPending}
                            title={!active?"O indicador precisa estar ativo":!ref.active?"Corrija o vencimento do indicado antes de pontuar":"Confirmar recebimento"}
                            onClick={()=>{
                              if(window.confirm("Confirma que "+ref.client.name+" pagou a primeira mensalidade? "+entry.client.name+" receberá 1 ponto.")){
                                confirm.mutate({referrerId:entry.client.id,referredId:ref.client.id});
                              }
                            }}>
                            Confirmar pagamento (+1)
                          </button>}
                      </div>
                    </div>)}
                  </div>}
              </div>
              {!active&&<p className="rounded-lg border border-amber-500/30 p-3 text-xs text-amber-300">
                Indicador inativo: a participação anterior continua no ranking, mas novas pontuações exigem assinatura ativa.
              </p>}
            </div>}
          </article>;
        })}
        {!showAll&&filtered.length>30&&<div className="text-center">
          <button className={action} onClick={()=>setShowAll(true)}>
            Mostrar todos os {filtered.length} indicadores
          </button>
        </div>}
      </section>}
    <p className="pb-4 text-xs text-mist">
      Os números do ranking são históricos. A quantidade de indicados não diminui quando pontos são resgatados ou expirados; apenas o saldo de pontos muda.
      Clientes sem confirmação do primeiro pagamento não geram pontos. O cadastro e as recompensas continuam no controle original.
    </p>
  </main>;
}
