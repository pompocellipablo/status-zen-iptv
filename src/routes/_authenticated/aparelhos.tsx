import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, CircleAlert, Pencil, Plus, Search, Tv, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatBRL, formatDate, getStatus, type Client } from "@/lib/iptv";
import type { Database } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/aparelhos")({
  head: () => ({meta:[{title:"TV Box + Acesso — MaxFlix"}]}),
  component: DevicesPage,
});

type Sale=Database["public"]["Tables"]["box_sales"]["Row"];
type LinkRow=Database["public"]["Tables"]["box_sale_clients"]["Row"];
type Draft={
  customer_name:string; model:string; sale_date:string; quantity:string;
  amount_received:string; device_cost:string; extra_cost:string;
  months_included:string; notes:string; client_ids:string[];
};
const blank:Draft={
  customer_name:"",model:"",sale_date:"",quantity:"1",
  amount_received:"",device_cost:"",extra_cost:"0",months_included:"12",notes:"",client_ids:[],
};
const fieldClass="mt-1.5 min-h-11 w-full rounded-xl bg-panel px-3 py-2.5 text-sm text-frost ring-1 ring-line outline-none focus:ring-cyan/50";
const labelClass="text-xs font-medium text-mist";
function parseOptionalCurrency(value:string):number|null {
  if(!value.trim()) return null;
  let cleaned=value.trim().replace(/[R$\s]/g,"");
  if(cleaned.includes(",")) cleaned=cleaned.replace(/\./g,"").replace(",",".");
  const parsed=Number(cleaned);
  return Number.isFinite(parsed)&&parsed>=0?parsed:null;
}
function prettyCurrency(value:number|null|undefined){return value==null?"A informar":formatBRL(Number(value));}
function draftFrom(sale:Sale,links:LinkRow[]):Draft {
  return {
    customer_name:sale.customer_name,
    model:sale.model??"",
    sale_date:sale.sale_date??"",
    quantity:sale.quantity==null?"":String(sale.quantity),
    amount_received:sale.amount_received==null?"":String(sale.amount_received).replace(".",","),
    device_cost:sale.device_cost==null?"":String(sale.device_cost).replace(".",","),
    extra_cost:String(sale.extra_cost).replace(".",","),
    months_included:String(sale.months_included),
    notes:sale.notes??"",
    client_ids:links.filter(x=>x.sale_id===sale.id).map(x=>x.client_id),
  };
}
function DevicesPage(){
  const qc=useQueryClient();
  const [editing,setEditing]=useState<Sale|null>(null);
  const [draft,setDraft]=useState<Draft|null>(null);
  const [clientSearch,setClientSearch]=useState("");
  const [search,setSearch]=useState("");
  const [onlyPending,setOnlyPending]=useState(false);
  const [alert,setAlert]=useState<string|null>(null);

  const salesQ=useQuery({queryKey:["box-sales"],queryFn:async()=>{
    const {data,error}=await supabase.from("box_sales").select("*").order("created_at",{ascending:true});
    if(error)throw error;return data??[];
  }});
  const linksQ=useQuery({queryKey:["box-sale-links"],queryFn:async()=>{
    const {data,error}=await supabase.from("box_sale_clients").select("sale_id,client_id");
    if(error)throw error;return data??[];
  }});
  const clientsQ=useQuery({queryKey:["box-sale-client-lookup"],queryFn:async()=>{
    const all:Client[]=[];
    for(let offset=0;offset<20000;offset+=1000){
      const {data,error}=await supabase.from("clients").select("*")
        .order("name",{ascending:true}).range(offset,offset+999);
      if(error)throw error;
      all.push(...(data??[]).map(c=>({...c,cost:Number(c.cost),prev_cost:Number(c.prev_cost),paid:Number(c.paid),prev_paid:Number(c.prev_paid)})) as Client[]);
      if(!data||data.length<1000)break;
    }
    return all;
  }});

  const sales=salesQ.data??[];
  const links=linksQ.data??[];
  const clients=clientsQ.data??[];
  const clientMap=useMemo(()=>new Map(clients.map(c=>[c.id,c])),[clients]);
  const linkedClients=(saleId:string)=>links.filter(l=>l.sale_id===saleId).map(l=>clientMap.get(l.client_id)).filter((c):c is Client=>!!c);
  const monthlyAccessCost=(saleId:string)=>linkedClients(saleId).reduce((sum,c)=>sum+(c.cost||c.prev_cost||0),0);
  const complete=(sale:Sale)=>sale.amount_received!=null&&sale.device_cost!=null&&
    sale.quantity!=null&&linkedClients(sale.id).length>0;
  const profit=(sale:Sale)=>{
    if(!complete(sale))return null;
    return Number(sale.amount_received)-Number(sale.device_cost)-Number(sale.extra_cost)
      -Number(sale.months_included)*monthlyAccessCost(sale.id);
  };
  const stats=useMemo(()=>{
    const completeSales=sales.filter(complete);
    return {
      customers:sales.length,
      needsReview:sales.filter(s=>!complete(s)).length,
      units:sales.reduce((v,s)=>v+(s.quantity??0),0),
      unitsUnknown:sales.filter(s=>s.quantity==null).length,
      received: sales.reduce((v,s)=>v+(s.amount_received==null?0:Number(s.amount_received)),0),
      receivedEntries:sales.filter(s=>s.amount_received!=null).length,
      profit:completeSales.reduce((v,s)=>v+(profit(s)??0),0),
      completeCount:completeSales.length,
    };
  // sales and client links are updated via query invalidation.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[sales,links,clients]);
  const visible=useMemo(()=>{
    const term=search.toLocaleLowerCase("pt-BR").trim();
    return sales.filter(s=>(!onlyPending||!complete(s))&&(!term||[
      s.customer_name,s.model??"",s.notes??"",...linkedClients(s.id).flatMap(c=>[c.name,c.login,c.server])
    ].join(" ").toLocaleLowerCase("pt-BR").includes(term)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[sales,search,onlyPending,links,clients]);

  const save=useMutation({
    mutationFn:async(value:Draft)=>{
      const received=parseOptionalCurrency(value.amount_received);
      const cost=parseOptionalCurrency(value.device_cost);
      const extra=parseOptionalCurrency(value.extra_cost);
      const quantity=value.quantity.trim()?Number(value.quantity):null;
      const months=Number(value.months_included);
      if(!value.customer_name.trim())throw new Error("Informe o nome do comprador.");
      if(value.amount_received.trim()&&received==null)throw new Error("Valor recebido inválido.");
      if(value.device_cost.trim()&&cost==null)throw new Error("Custo dos aparelhos inválido.");
      if(extra==null)throw new Error("Outras despesas inválidas.");
      if(quantity!==null&&(!Number.isInteger(quantity)||quantity<1||quantity>100))throw new Error("Informe uma quantidade válida.");
      if(!Number.isInteger(months)||months<1||months>120)throw new Error("Informe o número de meses inclusos.");
      if(!editing&&!value.client_ids.length)throw new Error("Selecione pelo menos um cadastro de acesso.");
      if(!editing&&(received==null||cost==null||quantity==null)){
        throw new Error("Para vendas novas, preencha valor recebido, custo dos aparelhos e quantidade. Para vendas antigas, edite os registros importados.");
      }
      const payload={
        customer_name:value.customer_name.trim(),model:value.model.trim()||null,
        sale_date:value.sale_date||null,quantity,
        amount_received:received,device_cost:cost,extra_cost:extra,
        months_included:months,notes:value.notes.trim()||null,
        updated_at:new Date().toISOString(),
      };
      let saleId=editing?.id;
      if(editing){
        const {error}=await supabase.from("box_sales").update(payload).eq("id",editing.id);
        if(error)throw error;
      }else{
        const {data,error}=await supabase.from("box_sales").insert(payload).select("id").single();
        if(error)throw error;
        saleId=data.id;
      }
      if(!saleId)throw new Error("Não foi possível obter a venda.");
      const oldIds=links.filter(x=>x.sale_id===saleId).map(x=>x.client_id);
      const desired=[...new Set(value.client_ids)];
      const removed=oldIds.filter(id=>!desired.includes(id));
      const added=desired.filter(id=>!oldIds.includes(id));
      if(removed.length){
        const {error}=await supabase.from("box_sale_clients").delete().eq("sale_id",saleId).in("client_id",removed);
        if(error)throw error;
      }
      if(added.length){
        const {error}=await supabase.from("box_sale_clients").insert(added.map(client_id=>({sale_id:saleId!,client_id})));
        if(error)throw error;
      }
    },
    onSuccess:()=>{
      void Promise.all([
        qc.invalidateQueries({queryKey:["box-sales"]}),
        qc.invalidateQueries({queryKey:["box-sale-links"]}),
        qc.invalidateQueries({queryKey:["box-linked-client-ids"]}),
      ]);
      setDraft(null);setEditing(null);setAlert("Venda salva. Os vencimentos e a lista de renovações não foram alterados.");
    },
    onError:(error:Error)=>setAlert(error.message),
  });
  const change=(patch:Partial<Draft>)=>setDraft(d=>d?{...d,...patch}:d);
  const beginCreate=()=>{setEditing(null);setDraft({...blank,client_ids:[]});setClientSearch("");setAlert(null);};
  const beginEdit=(s:Sale)=>{setEditing(s);setDraft(draftFrom(s,links));setClientSearch("");setAlert(null);};
  const matches=clients.filter(c=>!clientSearch.trim()||[c.name,c.login,c.server].join(" ").toLocaleLowerCase("pt-BR").includes(clientSearch.toLocaleLowerCase("pt-BR").trim()));
  return <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 text-frost sm:px-6 sm:py-8">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-cyan">MAXFLIX · VENDAS</p>
        <h1 className="mt-1 flex items-center gap-2 font-display text-2xl font-bold"><Tv className="text-cyan"/> TV Box + Acesso</h1>
        <p className="mt-1 max-w-2xl text-sm text-mist">Venda do aparelho com meses de acesso inclusos, separada das renovações mensais.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link to="/" className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-panel px-3 py-2 text-sm ring-1 ring-line hover:bg-panel2"><ArrowLeft size={15}/> Painel</Link>
        <button onClick={beginCreate} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-cyan px-3 py-2 text-sm font-bold text-background hover:brightness-110"><Plus size={17}/> Nova venda</button>
      </div>
    </div>

    <div className="rounded-xl bg-cyan/10 p-3 text-xs text-cyan ring-1 ring-cyan/30">
      <strong>Renovações preservadas:</strong> clientes vinculados continuam aparecendo normalmente quando o vencimento mensal chegar. Durante a cobertura pré-paga, a renovação deve continuar sem nova cobrança conforme o vencimento financeiro já cadastrado. Registrar uma venda aqui não muda datas, créditos ou pagamentos de assinaturas.
    </div>
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      {[
        ["Compradores cadastrados",String(stats.customers)],
        ["Aparelhos confirmados",stats.unitsUnknown?stats.units+" (+ pendentes)":String(stats.units)],
        ["Vendas a completar",String(stats.needsReview)],
        ["Recebido informado",formatBRL(stats.received)],
      ].map(([label,value])=><div key={label} className="rounded-xl bg-panel p-3 ring-1 ring-line">
        <p className="break-words font-display text-xl font-bold text-frost">{value}</p>
        <p className="mt-1 text-xs text-mist">{label}</p>
      </div>)}
    </div>
    <div className="rounded-xl bg-panel p-4 ring-1 ring-line">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-frost">Margem estimada de vendas completas</p>
          <p className="mt-1 text-xs text-mist">Receita − custo dos aparelhos − outras despesas − créditos estimados de todos os acessos pelos meses inclusos.</p>
        </div>
        <p className="font-display text-xl font-bold text-cyan">{stats.completeCount?formatBRL(stats.profit):"A informar"}</p>
      </div>
      <p className="mt-2 text-xs text-mist">
        {stats.completeCount} venda(s) com dados suficientes. {stats.needsReview} aguardando dados.
        Estimativa usa o custo de crédito atual de cada servidor, não necessariamente o custo histórico. 
        Valores registrados aqui não são lançados novamente em Pagamentos ou em Faturamento por mês.
      </p>
    </div>
    {alert&&<div role="status" className="flex items-center justify-between gap-3 rounded-xl bg-panel p-3 text-sm text-cyan ring-1 ring-cyan/30">
      <span>{alert}</span><button onClick={()=>setAlert(null)} aria-label="Fechar aviso"><X size={17}/></button></div>}
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex min-w-48 flex-1 items-center gap-2 rounded-xl bg-panel px-3 ring-1 ring-line">
        <Search size={17} className="text-mist"/>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar comprador ou acesso..."
          className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none"/>
      </label>
      <label className="flex min-h-11 items-center gap-2 rounded-xl bg-panel px-3 text-sm text-mist ring-1 ring-line">
        <input type="checkbox" checked={onlyPending} onChange={e=>setOnlyPending(e.target.checked)} className="size-4 accent-cyan-500"/> Só pendentes
      </label>
    </div>
    {(salesQ.isLoading||linksQ.isLoading||clientsQ.isLoading)&&<p className="text-sm text-mist">Carregando vendas e acessos...</p>}
    {(salesQ.isError||linksQ.isError||clientsQ.isError)&&<p role="alert" className="text-sm text-danger">
      Erro ao carregar registros: {salesQ.error?.message||linksQ.error?.message||clientsQ.error?.message}
    </p>}
    <div className="grid gap-3 md:grid-cols-2">
      {visible.map(s=>{
        const linked=linkedClients(s.id);
        const estimated=Number(s.months_included)*monthlyAccessCost(s.id);
        const p=profit(s);
        const pending=!complete(s);
        return <article key={s.id} className="min-w-0 rounded-2xl bg-panel p-4 ring-1 ring-line">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="break-words font-display text-base font-semibold text-frost">{s.customer_name}</h2>
              <p className="mt-1 text-xs text-mist">{s.model||"Modelo não informado"} · {s.sale_date?formatDate(s.sale_date):"Data da venda desconhecida"}</p>
            </div>
            <button onClick={()=>beginEdit(s)} aria-label={"Editar venda de "+s.customer_name}
              className="flex min-h-10 items-center gap-1.5 rounded-lg border border-line bg-panel2 px-3 text-xs text-cyan"><Pencil size={15}/> Editar</button>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-xs">
            {pending?<CircleAlert size={15} className="text-warn"/>:<CheckCircle2 size={15} className="text-ok"/>}
            <span className={pending?"text-warn":"text-ok"}>{pending?"Valores, quantidade ou vínculos pendentes":"Dados preenchidos"}</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {linked.map(c=><span key={c.id} className="rounded-lg bg-background/75 px-2 py-1 text-[11px] text-mist ring-1 ring-line" title={"Vence: "+formatDate(c.due_date)+" / Financeiro: "+formatDate(c.financial_due_date)}>
              {c.login} · {c.server}</span>)}
            {!linked.length&&<span className="text-xs text-warn">Nenhum acesso vinculado</span>}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div><span className="text-mist">Quantidade</span><p className="font-semibold">{s.quantity??"A confirmar"}</p></div>
            <div><span className="text-mist">Recebido</span><p className="font-semibold">{prettyCurrency(s.amount_received)}</p></div>
            <div><span className="text-mist">Custo aparelho(s)</span><p className="font-semibold">{prettyCurrency(s.device_cost)}</p></div>
            <div><span className="text-mist">Acesso incluso</span><p className="font-semibold">{s.months_included} meses</p></div>
            <div><span className="text-mist">Custo de acesso estimado</span><p className="font-semibold">{formatBRL(estimated)}</p></div>
            <div><span className="text-mist">Margem estimada</span><p className={"font-semibold "+(p==null?"text-mist":p>=0?"text-ok":"text-danger")}>{p==null?"A calcular":formatBRL(p)}</p></div>
          </div>
          {s.notes&&<p className="mt-3 border-t border-line pt-3 text-xs text-mist">Observações: {s.notes}</p>}
        </article>;
      })}
    </div>
    {!salesQ.isLoading&&!visible.length&&<p className="rounded-xl bg-panel p-6 text-sm text-mist ring-1 ring-line">Nenhuma venda encontrada com os filtros.</p>}
    {draft&&<div className="fixed inset-0 z-50 overflow-y-auto bg-background/85 p-3 backdrop-blur-md sm:p-6">
      <section className="mx-auto my-3 max-w-2xl rounded-2xl bg-panel2 p-4 ring-1 ring-line sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-bold">{editing?"Editar venda de TV Box":"Registrar venda de TV Box"}</h2>
            <p className="mt-1 text-xs text-mist">Campos antigos desconhecidos podem permanecer vazios. Novas vendas exigem preço, custo e quantidade.</p>
          </div>
          <button type="button" aria-label="Fechar edição" onClick={()=>{setDraft(null);setEditing(null);}} className="rounded-lg p-2 text-mist hover:bg-panel"><X size={22}/></button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-2"><span className={labelClass}>Nome do comprador</span>
            <input className={fieldClass} maxLength={120} value={draft.customer_name} onChange={e=>change({customer_name:e.target.value})}/></label>
          <label className="block"><span className={labelClass}>Modelo do aparelho</span>
            <input className={fieldClass} value={draft.model} maxLength={120} placeholder="Ex.: TV Box 4K" onChange={e=>change({model:e.target.value})}/></label>
          <label className="block"><span className={labelClass}>Data da venda</span>
            <input type="date" className={fieldClass} value={draft.sale_date} onChange={e=>change({sale_date:e.target.value})}/></label>
          <label className="block"><span className={labelClass}>Quantidade de aparelhos</span>
            <input inputMode="numeric" type="number" min="1" max="100" className={fieldClass} value={draft.quantity} placeholder="A confirmar" onChange={e=>change({quantity:e.target.value})}/></label>
          <label className="block"><span className={labelClass}>Meses de acesso incluídos</span>
            <input inputMode="numeric" type="number" min="1" max="120" className={fieldClass} value={draft.months_included} onChange={e=>change({months_included:e.target.value})}/></label>
          <label className="block"><span className={labelClass}>Valor total recebido (R$)</span>
            <input inputMode="decimal" className={fieldClass} value={draft.amount_received} placeholder="Ex.: 579,00" onChange={e=>change({amount_received:e.target.value})}/></label>
          <label className="block"><span className={labelClass}>Custo total do(s) aparelho(s) (R$)</span>
            <input inputMode="decimal" className={fieldClass} value={draft.device_cost} placeholder="Valor real pago" onChange={e=>change({device_cost:e.target.value})}/></label>
          <label className="block sm:col-span-2"><span className={labelClass}>Frete, taxas e outras despesas (R$)</span>
            <input inputMode="decimal" className={fieldClass} value={draft.extra_cost} onChange={e=>change({extra_cost:e.target.value})}/></label>
          <div className="sm:col-span-2 rounded-xl bg-background/50 p-3 ring-1 ring-line">
            <p className="text-sm font-semibold">Acessos de IPTV associados</p>
            <p className="mt-1 text-xs text-mist">Selecione os cadastros atendidos pela venda. Eles permanecem na lista normal de renovações. Para duas telas ou dois logins, marque ambos. Isso não confirma a quantidade de aparelhos.</p>
            <input className={fieldClass} value={clientSearch} onChange={e=>setClientSearch(e.target.value)} placeholder="Buscar por nome, login ou servidor"/>
            <p className="mt-2 text-xs text-mist">{draft.client_ids.length} acesso(s) selecionado(s)</p>
            <div className="mt-2 max-h-44 space-y-1 overflow-y-auto rounded-xl bg-panel p-2 ring-1 ring-line">
              {matches.slice(0,100).map(c=><label key={c.id} className="flex min-h-9 items-start gap-2 rounded-lg px-2 py-2 text-xs text-frost hover:bg-panel2">
                <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-cyan-500"
                  checked={draft.client_ids.includes(c.id)}
                  onChange={e=>change({client_ids:e.target.checked?[...draft.client_ids,c.id]:draft.client_ids.filter(id=>id!==c.id)})}/>
                <span className="break-all">{c.name} · {c.login} · {c.server}
                  <span className="block text-mist">Vence {formatDate(c.due_date)} · {getStatus(c).key==="vencido"?"Vencido":"Ativo"}</span>
                </span>
              </label>)}
              {!matches.length&&<p className="p-2 text-xs text-mist">Nenhum cliente encontrado.</p>}
            </div>
            {draft.client_ids.length>0&&<div className="mt-2 flex flex-wrap gap-1">
              {draft.client_ids.map(id=>clientMap.get(id)).filter((c):c is Client=>!!c).map(c=>
                <button key={c.id} type="button" onClick={()=>change({client_ids:draft.client_ids.filter(id=>id!==c.id)})}
                  className="rounded-lg bg-cyan/10 px-2 py-1 text-[11px] text-cyan">{c.login} ×</button>)}
            </div>}
          </div>
          <label className="sm:col-span-2"><span className={labelClass}>Observações da venda (opcional)</span>
            <textarea rows={3} maxLength={3000} className={fieldClass+" resize-y"} value={draft.notes}
              onChange={e=>change({notes:e.target.value})} placeholder="Ex.: venda antiga, confirmar valores; retirada pessoal; garantia do aparelho"/></label>
        </div>
        <p className="mt-4 text-xs text-mist">
          Os custos de servidor são estimativas pelos cadastros atuais. Esta tela não muda os vencimentos financeiros e não registra o recebimento novamente em Faturamento por mês.
        </p>
        {alert&&<p role="alert" className="mt-3 rounded-lg bg-background p-2 text-sm text-warn">{alert}</p>}
        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" disabled={save.isPending} onClick={()=>save.mutate(draft)}
            className="min-h-11 rounded-xl bg-cyan px-5 py-2 text-sm font-semibold text-background disabled:opacity-50">
            {save.isPending?"Salvando...":"Salvar venda"}
          </button>
          <button type="button" onClick={()=>{setDraft(null);setEditing(null);}}
            className="min-h-11 rounded-xl bg-panel px-5 py-2 text-sm ring-1 ring-line">Cancelar</button>
        </div>
      </section>
    </div>}
  </main>;
}
