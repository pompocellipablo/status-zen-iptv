import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/recuperacao")({
  head: () => ({ meta: [{ title: "Recuperação de Clientes — MaxFlix" }] }),
  component: RecoveryPage,
});

const db = supabase as unknown as SupabaseClient;
type Status = "identificado" | "contatado" | "interessado" | "teste" | "recuperado" | "sem_interesse" | "nao_contatar";
type Permission = "desconhecida" | "autorizada" | "revogada";
type Origin = "agenda_off" | "painel_vencido" | "planilha" | "manual";
type FormerClient = {
  id: string; name: string; phone: string | null; server: string | null;
  origin: Origin; status: Status; contact_permission: Permission;
  monthly_value: number | null; notes: string | null; linked_client_id: string | null;
  last_contacted_at: string | null; recovered_at: string | null;
  created_at: string; updated_at: string;
};
type ExistingClient = { id: string; name: string; whatsapp: string | null; due_date: string };
type Event = { id: string; former_client_id: string; action: string; from_status: string | null; to_status: string | null; note: string | null; created_at: string };

const STATUS_LABELS: Record<Status,string> = {
  identificado: "Identificado", contatado: "Contatado", interessado: "Interessado",
  teste: "Em teste", recuperado: "Recuperado", sem_interesse: "Sem interesse",
  nao_contatar: "Não contatar",
};
const ORIGIN_LABELS: Record<Origin,string> = {
  agenda_off: "Agenda OFF", painel_vencido: "Vencidos no painel",
  planilha: "Planilha", manual: "Manual",
};
const PERMISSION_LABELS: Record<Permission,string> = {
  desconhecida: "Não verificada", autorizada: "Contato autorizado", revogada: "Não deseja contato",
};
const statuses = Object.keys(STATUS_LABELS) as Status[];
const permissions = Object.keys(PERMISSION_LABELS) as Permission[];
const origins = Object.keys(ORIGIN_LABELS) as Origin[];
const PAGE_SIZE=25;
function phoneDigits(value: string | null | undefined):string {
  const n=(value||"").replace(/\D/g,"");
  return n.length===10||n.length===11 ? "55"+n : n;
}
function money(value:number) { return value.toLocaleString("pt-BR",{style:"currency",currency:"BRL"}); }
function date(value:string | null) { return value?new Date(value).toLocaleDateString("pt-BR"):"—"; }

async function listAll<T>(table:"former_clients"|"former_client_events"):Promise<T[]> {
  const all:T[]=[];
  for(let offset=0;offset<50000;offset+=1000) {
    const {data,error}=await db.from(table).select("*").order("created_at",{ascending:false}).range(offset,offset+999);
    if(error)throw error;
    all.push(...(data as T[]||[]));
    if(!data||data.length<1000)break;
  }
  return all;
}

function RecoveryPage(){
  const [people,setPeople]=useState<FormerClient[]>([]);
  const [existing,setExisting]=useState<ExistingClient[]>([]);
  const [events,setEvents]=useState<Event[]>([]);
  const [expanded,setExpanded]=useState("");
  const [filter,setFilter]=useState<Status|"todos">("todos");
  const [search,setSearch]=useState("");
  const [page,setPage]=useState(1);
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [notice,setNotice]=useState("");
  const [showForm,setShowForm]=useState(false);
  const [name,setName]=useState("");
  const [phone,setPhone]=useState("");
  const [server,setServer]=useState("");
  const [origin,setOrigin]=useState<Origin>("agenda_off");
  const [permission,setPermission]=useState<Permission>("desconhecida");
  const [notes,setNotes]=useState("");

  const reload=async()=>{
    const rows=await listAll<FormerClient>("former_clients");
    setPeople(rows);
  };
  useEffect(()=>{
    let active=true;
    const load=async()=>{
      try{
        const [former,clientRows]=await Promise.all([
          listAll<FormerClient>("former_clients"),
          db.from("clients").select("id,name,whatsapp,due_date").limit(2000),
        ]);
        if(clientRows.error)throw clientRows.error;
        if(active){setPeople(former);setExisting(clientRows.data as ExistingClient[]||[]);}
      }catch{
        if(active)setNotice("Não foi possível carregar a base. Atualize a página e confira sua conexão.");
      }finally{if(active)setLoading(false);}
    };
    void load();
    return ()=>{active=false;};
  },[]);
  useEffect(()=>{
    if(!expanded){setEvents([]);return;}
    const load=async()=>{
      const {data}=await db.from("former_client_events").select("*")
        .eq("former_client_id",expanded).order("created_at",{ascending:false}).limit(30);
      setEvents(data as Event[]||[]);
    };
    void load();
  },[expanded,people]);

  const activeNumbers=useMemo(()=>{
    const byPhone=new Map<string,ExistingClient[]>();
    for(const c of existing){
      const key=phoneDigits(c.whatsapp);
      if(!key)continue;
      byPhone.set(key,[...(byPhone.get(key)||[]),c]);
    }
    return byPhone;
  },[existing]);
  const filtered=useMemo(()=>{
    const q=search.trim().toLocaleLowerCase("pt-BR");
    return people.filter(p=>(filter==="todos"||p.status===filter)
      && (!q || (p.name+" "+(p.phone||"")+" "+(p.server||"")+" "+(p.notes||"")).toLocaleLowerCase("pt-BR").includes(q)));
  },[people,filter,search]);
  const maxPage=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));
  const displayed=filtered.slice((Math.min(page,maxPage)-1)*PAGE_SIZE,Math.min(page,maxPage)*PAGE_SIZE);
  const stats=useMemo(()=>({
    total:people.length,
    contacted:people.filter(p=>["contatado","interessado","teste","recuperado","sem_interesse"].includes(p.status)).length,
    interested:people.filter(p=>["interessado","teste"].includes(p.status)).length,
    recovered:people.filter(p=>p.status==="recuperado").length,
    monthly:people.filter(p=>p.status==="recuperado").reduce((sum,p)=>sum+Number(p.monthly_value||0),0),
  }),[people]);

  const create=async(e:React.FormEvent)=>{
    e.preventDefault();
    const newName=name.trim();
    const digits=phoneDigits(phone);
    if(newName.length<2){setNotice("Preencha o nome do ex-cliente.");return;}
    if(phone.trim() && (digits.length<10 || digits.length>15)){
      setNotice("Telefone inválido: confira o DDD e o número.");return;
    }
    if(digits && people.some(p=>p.phone===digits)){
      setNotice("Esse telefone já está cadastrado na base de ex-clientes. Utilize o registro existente.");return;
    }
    const matches=digits?activeNumbers.get(digits)||[]:[];
    if(matches.length){
      const names=matches.map(c=>c.name).slice(0,3).join(", ");
      if(!window.confirm("Esse número já aparece entre os clientes do MaxFlix ("+names+"). Confira se a pessoa já voltou antes de registrar como ex-cliente. Deseja continuar?"))return;
    }
    setBusy(true);
    try{
      const {data,error}=await db.from("former_clients").insert({
        name:newName,phone:digits||null,server:server.trim()||null,
        origin,contact_permission:permission,notes:notes.trim()||null,
        status:"identificado",
      }).select("id").single();
      if(error)throw error;
      await db.from("former_client_events").insert({former_client_id:data.id,action:"criado",to_status:"identificado",note:"Cadastro manual"});
      await reload();
      setName("");setPhone("");setServer("");setNotes("");setOrigin("agenda_off");setPermission("desconhecida");setShowForm(false);
      setNotice("Ex-cliente adicionado à base histórica, sem criar uma assinatura ativa.");
    }catch(err){
      const msg=String((err as Error)?.message||"");
      setNotice(msg.includes("duplicate")?"Telefone já cadastrado. Confira a ficha existente.":"Não foi possível salvar. Confira os dados e tente novamente.");
    }finally{setBusy(false);}
  };

  const updateStatus=async(row:FormerClient,next:Status)=>{
    if(next===row.status)return;
    if(next==="recuperado" && !window.confirm("O pagamento do retorno foi realmente confirmado? Marque como recuperado somente após a confirmação."))return;
    if(next==="contatado" && row.contact_permission!=="autorizada" &&
      !window.confirm("A autorização para mensagens comerciais não está confirmada. Só registre contato iniciado se a pessoa procurou você ou consentiu. Continuar?"))return;
    setBusy(true);
    try{
      const patch:Record<string,unknown>={status:next,updated_at:new Date().toISOString()};
      if(next==="recuperado") {
        patch.recovered_at=new Date().toISOString();
        patch.monthly_value=row.monthly_value??35;
      }
      if(next==="nao_contatar")patch.contact_permission="revogada";
      if(next==="contatado")patch.last_contacted_at=new Date().toISOString();
      const {error}=await db.from("former_clients").update(patch).eq("id",row.id);
      if(error)throw error;
      const {error:logError}=await db.from("former_client_events").insert({
        former_client_id:row.id,action:next==="recuperado"?"recuperacao":"status",
        from_status:row.status,to_status:next,
      });
      await reload();
      setNotice(logError?"Status atualizado, mas o histórico não foi gravado.":"Status atualizado e registrado no histórico.");
    }catch{setNotice("Erro ao atualizar o status. Nada foi alterado nesta tentativa.");}
    finally{setBusy(false);}
  };

  const updatePermission=async(row:FormerClient,next:Permission)=>{
    if(next===row.contact_permission)return;
    setBusy(true);
    try{
      const patch:Record<string,unknown>={contact_permission:next,updated_at:new Date().toISOString()};
      if(next==="revogada")patch.status="nao_contatar";
      const {error}=await db.from("former_clients").update(patch).eq("id",row.id);
      if(error)throw error;
      await db.from("former_client_events").insert({
        former_client_id:row.id,action:"observacao",
        from_status:row.status,to_status:next==="revogada"?"nao_contatar":row.status,
        note:"Permissão de contato: "+PERMISSION_LABELS[next],
      });
      await reload();
      setNotice("Preferência de contato atualizada.");
    }catch{setNotice("Não foi possível atualizar a preferência de contato.");}
    finally{setBusy(false);}
  };

  const updateNotes=async(row:FormerClient)=>{
    const next=window.prompt("Observações de "+row.name,row.notes||"");
    if(next===null || next===(row.notes||""))return;
    setBusy(true);
    try{
      const {error}=await db.from("former_clients").update({notes:next.trim()||null,updated_at:new Date().toISOString()}).eq("id",row.id);
      if(error)throw error;
      await db.from("former_client_events").insert({former_client_id:row.id,action:"observacao",note:"Observações atualizadas"});
      await reload();setNotice("Observação salva.");
    }catch{setNotice("Não foi possível salvar a observação.");}
    finally{setBusy(false);}
  };

  const updateMonthly=async(row:FormerClient)=>{
    const raw=window.prompt("Valor mensal efetivamente pago ao retornar (R$)",String(row.monthly_value??35).replace(".",","));
    if(raw===null)return;
    const parsed=Number(raw.replace(",",".")); 
    if(!Number.isFinite(parsed)||parsed<0||parsed>99999){setNotice("Informe um valor válido.");return;}
    setBusy(true);
    try{
      const {error}=await db.from("former_clients").update({monthly_value:parsed,updated_at:new Date().toISOString()}).eq("id",row.id);
      if(error)throw error;
      await db.from("former_client_events").insert({former_client_id:row.id,action:"observacao",note:"Valor mensal atualizado"});
      await reload();setNotice("Valor mensal atualizado.");
    }catch{setNotice("Não foi possível atualizar o valor.");}
    finally{setBusy(false);}
  };

  return <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 text-frost sm:py-8">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-xs font-bold uppercase tracking-[.25em] text-cyan">MAXFLIX</p>
        <h1 className="font-display text-2xl font-bold sm:text-3xl">Recuperação de Clientes</h1>
        <p className="mt-1 text-sm text-mist">Sua base histórica de ex-clientes, separada das assinaturas atuais.</p>
      </div>
      <Link to="/" className="rounded-xl border border-line px-4 py-2 text-sm hover:bg-panel">Voltar ao painel</Link>
    </div>
    <section className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {[
        ["Ex-clientes",String(stats.total)],
        ["Contatados",String(stats.contacted)],
        ["Interessados / teste",String(stats.interested)],
        ["Recuperados",String(stats.recovered)],
        ["Conversão de abordados",stats.contacted?((stats.recovered/stats.contacted)*100).toFixed(1).replace(".",",")+"%":"—"],
        ["Receita mensal recuperada",money(stats.monthly)],
      ].map(([label,value])=><div key={label} className="rounded-xl bg-panel p-3 ring-1 ring-line">
        <div className="break-words text-lg font-bold text-cyan">{value}</div>
        <div className="text-xs text-mist">{label}</div>
      </div>)}
    </section>
    <div className="rounded-xl border border-line bg-panel/60 p-3 text-sm text-mist">
      Os clientes vencidos do painel principal não são importados automaticamente. O mesmo vale para os contatos marcados como OFF: vamos incluí-los somente depois da conferência da agenda, para não tratar clientes ativos como ex-clientes.
    </div>
    {notice && <p role="status" className="rounded-xl border border-cyan/30 bg-panel p-3 text-sm">{notice}</p>}
    <section className="space-y-3 rounded-2xl bg-panel p-4 ring-1 ring-line">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-semibold">Base de ex-clientes</h2>
        <button onClick={()=>setShowForm(!showForm)} className="rounded-xl bg-cyan px-4 py-2 text-sm font-bold text-ink">
          {showForm?"Fechar":"Adicionar ex-cliente"}
        </button>
      </div>
      {showForm&&<form onSubmit={e=>void create(e)} className="grid gap-3 rounded-xl border border-line bg-panel2 p-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">Nome *
          <input required maxLength={200} value={name} onChange={e=>setName(e.target.value)} placeholder="Nome do antigo cliente" className="block w-full rounded-lg border border-line bg-panel px-3 py-2"/>
        </label>
        <label className="space-y-1 text-sm">WhatsApp (opcional)
          <input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="DDD + número" inputMode="tel" className="block w-full rounded-lg border border-line bg-panel px-3 py-2"/>
        </label>
        <label className="space-y-1 text-sm">Servidor antigo (opcional)
          <input value={server} onChange={e=>setServer(e.target.value)} placeholder="Ex.: Five" maxLength={100} className="block w-full rounded-lg border border-line bg-panel px-3 py-2"/>
        </label>
        <label className="space-y-1 text-sm">Origem
          <select value={origin} onChange={e=>setOrigin(e.target.value as Origin)} className="block w-full rounded-lg border border-line bg-panel px-3 py-2">
            {origins.map(x=><option value={x} key={x}>{ORIGIN_LABELS[x]}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm">Preferência de comunicação
          <select value={permission} onChange={e=>setPermission(e.target.value as Permission)} className="block w-full rounded-lg border border-line bg-panel px-3 py-2">
            {permissions.map(x=><option value={x} key={x}>{PERMISSION_LABELS[x]}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm">Observações
          <textarea rows={2} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Ex.: saiu por falha de sinal" maxLength={2000} className="block w-full rounded-lg border border-line bg-panel px-3 py-2"/>
        </label>
        <button disabled={busy} type="submit" className="rounded-xl bg-cyan px-4 py-2 text-sm font-bold text-ink disabled:opacity-50 sm:col-span-2">Salvar ex-cliente</button>
      </form>}
      <div className="flex flex-wrap gap-2">
        <input value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}} placeholder="Buscar nome, telefone ou servidor"
          className="min-w-[180px] flex-1 rounded-lg border border-line bg-panel2 px-3 py-2 text-sm"/>
        <select value={filter} onChange={e=>{setFilter(e.target.value as Status|"todos");setPage(1);}}
          aria-label="Filtrar pelo status" className="rounded-lg border border-line bg-panel2 px-3 py-2 text-sm">
          <option value="todos">Todos os status</option>
          {statuses.map(s=><option value={s} key={s}>{STATUS_LABELS[s]}</option>)}
        </select>
      </div>
      {loading?<p className="p-4 text-sm text-mist">Carregando ex-clientes...</p>:
        !filtered.length?<p className="rounded-xl bg-panel2 p-5 text-center text-sm text-mist">
          {people.length?"Nenhum registro corresponde ao filtro.":"A base está vazia. Você pode incluir os primeiros contatos OFF quando estiverem conferidos."}
        </p>:<div className="space-y-2">
          {displayed.map(row=>{
            const current= row.phone?activeNumbers.get(row.phone)||[]:[];
            return <div key={row.id} className="space-y-2 rounded-xl border border-line bg-panel2 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="break-words font-semibold">{row.name}</div>
                  <p className="text-xs text-mist">{row.phone||"Sem telefone"} · {ORIGIN_LABELS[row.origin]}{row.server?" · "+row.server:""}</p>
                  {current.length>0 && <p className="mt-1 text-xs text-amber-400">Atenção: mesmo telefone aparece no cadastro atual do MaxFlix.</p>}
                </div>
                <button className="rounded-lg border border-line px-3 py-1 text-xs hover:bg-panel" onClick={()=>setExpanded(expanded===row.id?"":row.id)}>
                  {expanded===row.id?"Fechar detalhes":"Ver detalhes"}
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-xs text-mist">Status:
                  <select disabled={busy} value={row.status} onChange={e=>void updateStatus(row,e.target.value as Status)}
                    className="ml-2 rounded-lg border border-line bg-panel px-2 py-2 text-sm text-frost">
                    {statuses.map(s=><option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                  </select>
                </label>
                {row.status==="recuperado"&&<span className="rounded-lg bg-emerald-800/30 px-2 py-1 text-xs text-emerald-300">
                  {money(Number(row.monthly_value||0))}/mês · recuperado em {date(row.recovered_at)}
                </span>}
              </div>
              {expanded===row.id&&<div className="space-y-3 border-t border-line pt-3 text-sm">
                <label className="block">Permissão para mensagens comerciais:
                  <select value={row.contact_permission} disabled={busy} onChange={e=>void updatePermission(row,e.target.value as Permission)}
                    className="ml-2 rounded-lg border border-line bg-panel px-2 py-2 text-sm">
                    {permissions.map(x=><option key={x} value={x}>{PERMISSION_LABELS[x]}</option>)}
                  </select>
                </label>
                <p className="text-mist">Último contato: {date(row.last_contacted_at)} · Cadastro em: {date(row.created_at)}</p>
                <p className="whitespace-pre-wrap text-mist">{row.notes||"Sem observações."}</p>
                <div className="flex flex-wrap gap-2">
                  <button disabled={busy} onClick={()=>void updateNotes(row)} className="rounded-lg border border-line px-3 py-2 text-xs">Editar observações</button>
                  {row.status==="recuperado"&&<button disabled={busy} onClick={()=>void updateMonthly(row)} className="rounded-lg border border-line px-3 py-2 text-xs">Corrigir mensalidade recuperada</button>}
                </div>
                <div><p className="mb-1 font-semibold">Histórico recente</p>
                  {events.length?events.map(ev=><p key={ev.id} className="border-t border-line py-1 text-xs text-mist">
                    {date(ev.created_at)} · {ev.action==="recuperacao"?"Assinatura recuperada":ev.action==="status"?"Etapa alterada":"Atualização"}{ev.to_status?" — "+(STATUS_LABELS[ev.to_status as Status]||ev.to_status):""}
                  </p>):<p className="text-xs text-mist">Nenhum evento registrado ainda.</p>}
                </div>
              </div>}
            </div>;
          })}
          <div className="flex items-center justify-between gap-2 pt-2 text-xs text-mist">
            <span>{filtered.length} registros encontrados</span>
            <div className="flex items-center gap-2">
              <button disabled={page<=1} className="rounded-lg border border-line px-3 py-2 disabled:opacity-40" onClick={()=>setPage(p=>Math.max(1,p-1))}>Anterior</button>
              <span>{Math.min(page,maxPage)} / {maxPage}</span>
              <button disabled={page>=maxPage} className="rounded-lg border border-line px-3 py-2 disabled:opacity-40" onClick={()=>setPage(p=>Math.min(maxPage,p+1))}>Próxima</button>
            </div>
          </div>
        </div>}
    </section>
    <p className="text-xs text-mist">O registro de recuperação não altera automaticamente assinaturas nem envia mensagens. Apenas retornos com pagamento confirmado devem contar como recuperados.</p>
  </main>;
}
