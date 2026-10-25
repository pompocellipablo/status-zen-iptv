import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import {
  MARKETING_SERVERS, parseMarketingM3U, normalizeMarketingTitle,
  type MarketingEntry, type MarketingKind, type MarketingServer,
} from "@/lib/marketing-catalog";

export const Route = createFileRoute("/_authenticated/marketing")({
  head: () => ({ meta:[{ title:"Marketing IA — MaxFlix" }] }),
  component: MarketingPage,
});

// As tabelas novas já foram criadas com RLS. A tipagem gerada será atualizada na próxima regeneração.
const db = supabase as unknown as SupabaseClient;
type CatalogRow = MarketingEntry & { id:string; first_seen_at:string };
type HistoryRow = {
  id:string; content_key:string; title:string; kind:MarketingKind;
  category:"novidades" | "fim_de_semana" | "manual"; published_at:string;
};
type Category = "novidades" | "fim_de_semana";

async function loadAll<T>(table:"marketing_catalog"|"marketing_recommendations"):Promise<T[]> {
  const rows:T[] = [];
  for(let start=0;start<60000;start+=1000){
    const {data,error}=await db.from(table).select("*").order("id",{ascending:true})
      .range(start,start+999);
    if(error)throw error;
    rows.push(...(data as T[] || []));
    if(!data || data.length < 1000)break;
  }
  return rows;
}

function MarketingPage(){
  const [catalog,setCatalog]=useState<CatalogRow[]>([]);
  const [history,setHistory]=useState<HistoryRow[]>([]);
  const [server,setServer]=useState<MarketingServer>("GF");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [category,setCategory]=useState<Category>("novidades");
  const [selected,setSelected]=useState<CatalogRow[]>([]);
  const [manualTitle,setManualTitle]=useState("");
  const [manualKind,setManualKind]=useState<MarketingKind>("filme");

  const refresh=async()=>{
    const [catalogRows,historyRows]=await Promise.all([
      loadAll<CatalogRow>("marketing_catalog"),
      loadAll<HistoryRow>("marketing_recommendations"),
    ]);
    setCatalog(catalogRows);
    setHistory(historyRows.sort((a,b)=>b.published_at.localeCompare(a.published_at)));
  };
  useEffect(()=>{void refresh().catch(()=>setMessage("Não foi possível consultar o histórico. Atualize a página e tente novamente."));},[]);

  const publishedKeys=useMemo(()=>new Set(history.map(h=>h.content_key)),[history]);
  const uniqueItems=useMemo(()=>{
    const unique = new Map<string,CatalogRow>();
    for(const row of catalog){
      const prior=unique.get(row.content_key);
      if(!prior || row.first_seen_at > prior.first_seen_at)unique.set(row.content_key,row);
    }
    return [...unique.values()];
  },[catalog]);
  const stats=useMemo(()=>({
    titles:uniqueItems.length,
    unpublished:uniqueItems.filter(x=>!publishedKeys.has(x.content_key)).length,
    published:history.length,
  }),[uniqueItems,publishedKeys,history]);
  const serversFor=(key:string)=>MARKETING_SERVERS
    .filter(s=>catalog.some(row=>row.content_key===key&&row.server===s)).join(" · ");

  const handleFile=async(file:File | undefined)=>{
    if(!file)return;
    if(file.size > 40*1024*1024){setMessage("O limite é 40 MB por arquivo M3U. Exporte uma lista menor.");return;}
    setBusy(true);
    setMessage("Lendo a lista localmente, sem enviar URLs de reprodução...");
    try{
      const parsed=parseMarketingM3U(await file.text(),server);
      if(!parsed.entries.length){
        setMessage("Nenhum filme ou série identificado. A lista pode conter só canais ao vivo ou usar outro padrão de nomes.");
        return;
      }
      for(let i=0;i<parsed.entries.length;i+=200){
        const chunk=parsed.entries.slice(i,i+200);
        const {error}=await db.from("marketing_catalog")
          .upsert(chunk,{onConflict:"server,content_key"});
        if(error)throw error;
        setMessage("Salvando metadados... "+Math.min(i+200,parsed.entries.length)+"/"+parsed.entries.length);
      }
      await refresh();
      setMessage(server+": "+parsed.entries.length+" títulos importados ou atualizados; "+
        parsed.skipped+" itens ignorados."+(parsed.truncated?" Limite de 12 mil títulos atingido.":"")+
        " Nenhuma URL, senha ou link de reprodução foi guardado.");
    }catch{
      setMessage("Falha durante a importação. Os títulos já salvos foram preservados; confira o arquivo e tente novamente.");
    }finally{setBusy(false);}
  };

  const generate=()=>{
    const candidates=uniqueItems.filter(row=>!publishedKeys.has(row.content_key));
    const shuffle=(items:CatalogRow[])=>items.sort(()=>Math.random()-.5);
    const films=shuffle(candidates.filter(row=>row.kind==="filme"));
    const shows=shuffle(candidates.filter(row=>row.kind==="serie"));
    const picks=[...films.slice(0,3),...shows.slice(0,2)];
    const used=new Set(picks.map(p=>p.content_key));
    const remaining=shuffle(candidates.filter(x=>!used.has(x.content_key)));
    setSelected([...picks,...remaining.slice(0,5-picks.length)].slice(0,5));
    setMessage("Seleção preliminar criada. Confirme cada título antes da publicação: avaliações e datas ainda não foram verificadas por uma API externa.");
  };

  const markPublished=async(row:CatalogRow)=>{
    if(!window.confirm("Registrar '"+row.title+"' como efetivamente publicado? O título deixará de ser sugerido."))return;
    setBusy(true);
    try{
      const {error}=await db.from("marketing_recommendations").insert({
        content_key:row.content_key,title:row.title,kind:row.kind,category,
      });
      if(error)throw error;
      await refresh();
      setSelected(prev=>prev.filter(p=>p.content_key!==row.content_key));
      setMessage("Publicação registrada: "+row.title);
    }catch{setMessage("Não foi possível registrar. Talvez o título já conste no histórico.");}
    finally{setBusy(false);}
  };
  const addManual=async()=>{
    const parsed=normalizeMarketingTitle(manualTitle.trim(),manualKind);
    if(!parsed){setMessage("Informe um título válido.");return;}
    if(publishedKeys.has(parsed.content_key)){setMessage("Esse título já está registrado como divulgado.");return;}
    setBusy(true);
    try{
      const {error}=await db.from("marketing_recommendations").insert({
        content_key:parsed.content_key,title:parsed.title,kind:manualKind,category:"manual",
      });
      if(error)throw error;
      setManualTitle("");
      await refresh();
      setMessage("Indicação anterior adicionada ao histórico.");
    }catch{setMessage("Não foi possível adicionar. Verifique se o conteúdo já existe.");}
    finally{setBusy(false);}
  };
  const removeHistory=async(row:HistoryRow)=>{
    if(!window.confirm("Remover a indicação de '"+row.title+"' do histórico? Ela poderá voltar a ser sugerida."))return;
    setBusy(true);
    try{
      const {error}=await db.from("marketing_recommendations").delete().eq("id",row.id);
      if(error)throw error;
      await refresh();
      setMessage("Registro removido do histórico.");
    }catch{setMessage("Não foi possível desfazer a marcação.");}
    finally{setBusy(false);}
  };

  return <main className="mx-auto max-w-5xl space-y-5 px-4 py-6 text-frost sm:py-8">
    <div className="flex items-center justify-between gap-3">
      <div><p className="text-xs font-bold uppercase tracking-[.25em] text-amber-400">MAXFLIX</p>
        <h1 className="font-display text-2xl font-bold sm:text-3xl">Marketing IA</h1>
        <p className="mt-1 text-sm text-mist">Catálogo GF · Five · Club e histórico de indicações, sem repetição.</p></div>
      <Link to="/" className="rounded-xl border border-line px-4 py-2 text-sm hover:bg-panel">Voltar</Link>
    </div>

    <section className="grid grid-cols-3 gap-2">
      {[["Títulos únicos",stats.titles],["Ainda não indicados",stats.unpublished],["Já divulgados",stats.published]]
        .map(([label,value])=><div key={label} className="rounded-xl bg-panel p-3 ring-1 ring-line">
          <div className="text-xl font-bold text-amber-400">{value}</div>
          <div className="text-xs text-mist">{label}</div></div>)}
    </section>
    {message&&<p role="status" className="rounded-xl border border-amber-500/40 bg-panel p-3 text-sm">{message}</p>}

    <section className="space-y-3 rounded-2xl bg-panel p-4 ring-1 ring-line">
      <h2 className="font-display text-lg font-semibold">1. Importar catálogo M3U</h2>
      <p className="text-sm text-mist">Baixe a playlist de uma conta de teste e selecione o arquivo aqui. A leitura identifica apenas filmes e séries; senhas e links de mídia não são salvos.</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-sm">Servidor
          <select className="block rounded-lg border border-line bg-panel2 p-2" value={server}
            onChange={e=>setServer(e.target.value as MarketingServer)}>
            {MARKETING_SERVERS.map(s=><option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm">Arquivo M3U / M3U8
          <input aria-label="Arquivo de catálogo" className="block max-w-full rounded-lg border border-line p-2 text-xs"
            type="file" accept=".m3u,.m3u8,.txt" disabled={busy}
            onChange={e=>{const file=e.target.files?.[0];void handleFile(file);e.target.value="";}}/>
        </label>
      </div>
      <p className="text-xs text-mist">Os links das contas não são armazenados no código, no banco nem no histórico. Nesta primeira versão a importação é por arquivo local.</p>
    </section>

    <section className="space-y-3 rounded-2xl bg-panel p-4 ring-1 ring-line">
      <h2 className="font-display text-lg font-semibold">2. Selecionar cinco destaques</h2>
      <p className="text-sm text-mist">A seleção inicial mistura até 3 filmes e 2 séries que não constam no histórico. As notas, datas e capas ainda exigem conferência externa.</p>
      <div className="flex flex-wrap items-center gap-3">
        <select aria-label="Tipo de publicação" value={category}
          onChange={e=>setCategory(e.target.value as Category)}
          className="rounded-lg border border-line bg-panel2 p-2 text-sm">
          <option value="novidades">Novidades da semana</option>
          <option value="fim_de_semana">Indicações do fim de semana</option>
        </select>
        <button disabled={busy||!stats.unpublished} onClick={generate}
          className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-black disabled:opacity-40">
          Sugerir 5 títulos
        </button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {selected.map(row=><div key={row.content_key} className="space-y-2 rounded-xl border border-line bg-panel2 p-3">
          <div className="font-semibold">{row.title}{row.release_year?" ("+row.release_year+")":""}</div>
          <p className="text-xs text-mist">{row.kind==="filme"?"Filme":"Série"} · {serversFor(row.content_key)} · Avaliação pendente</p>
          <button disabled={busy||publishedKeys.has(row.content_key)} onClick={()=>void markPublished(row)}
            className="rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-black disabled:opacity-40">
            Marcar como publicado
          </button>
        </div>)}
      </div>
      {!selected.length&&<p className="text-xs text-mist">Nenhuma seleção gerada ainda.</p>}
    </section>

    <section className="space-y-3 rounded-2xl bg-panel p-4 ring-1 ring-line">
      <h2 className="font-display text-lg font-semibold">3. Histórico de indicações</h2>
      <p className="text-sm text-mist">Adicione aqui títulos que você já anunciou anteriormente, para que nunca sejam sugeridos como inéditos.</p>
      <div className="flex flex-wrap items-center gap-2">
        <input value={manualTitle} onChange={e=>setManualTitle(e.target.value)}
          placeholder="Nome do filme ou série (ano)" className="min-w-[210px] flex-1 rounded-lg border border-line bg-panel2 p-2 text-sm"/>
        <select aria-label="Tipo de conteúdo" value={manualKind} onChange={e=>setManualKind(e.target.value as MarketingKind)}
          className="rounded-lg border border-line bg-panel2 p-2 text-sm">
          <option value="filme">Filme</option><option value="serie">Série</option>
        </select>
        <button disabled={busy||!manualTitle.trim()} onClick={()=>void addManual()}
          className="rounded-lg border border-amber-500 px-3 py-2 text-sm font-medium text-amber-400 disabled:opacity-40">
          Registrar anterior
        </button>
      </div>
      {history.length===0?<p className="text-sm text-mist">Nenhuma indicação registrada ainda.</p>:
        <div className="max-h-[440px] divide-y divide-line overflow-y-auto">
          {history.map(row=><div key={row.id} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0"><p className="truncate text-sm font-semibold">{row.title}</p>
              <p className="text-xs text-mist">{row.kind==="filme"?"Filme":"Série"} · {row.category.replaceAll("_"," ")} · {new Date(row.published_at).toLocaleDateString("pt-BR")}</p>
            </div>
            <button disabled={busy} onClick={()=>void removeHistory(row)}
              className="shrink-0 rounded-lg border border-line px-3 py-1 text-xs text-mist hover:text-frost disabled:opacity-40">
              Desfazer
            </button>
          </div>)}
        </div>}
    </section>
    <p className="text-xs text-mist">Etapa 1: catálogo e memória de publicações. Conferência automática de avaliações, capas licenciadas e geração de artes virão em uma próxima etapa.</p>
  </main>;
}
