import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Minus, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { daysUntil, formatDate, SERVERS, toISODate, today, type Client } from "@/lib/iptv";

import { creditBalance, type CreditMovement } from "@/lib/server-credits";

type Movement = CreditMovement & { occurred_on: string; note: string | null };
type EntryKind = "initial" | "purchase" | "adjustment";
const field = "mt-1.5 w-full rounded-md border border-line bg-background px-3 py-2.5 text-sm text-frost outline-none focus:border-cyan";
const label = "block text-sm text-mist";

export const Route = createFileRoute("/_authenticated/creditos")({
  head: () => ({ meta: [
    { title: "Créditos dos servidores — MaxFlix" },
    { name: "description", content: "Acompanhe o saldo de créditos dos servidores, compras e renovações de clientes." },
    { property: "og:title", content: "Créditos dos servidores — MaxFlix" },
    { property: "og:description", content: "Saldos, compras, alertas e previsão de créditos para cada servidor MaxFlix." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: ServerCredits,
});

function ServerCredits() {
  const qc = useQueryClient();
  const [server, setServer] = useState<string>(SERVERS[0]);
  const [entry, setEntry] = useState<{ server: string; kind: EntryKind } | null>(null);
  const [quantity, setQuantity] = useState("");
  const [entryDate, setEntryDate] = useState(() => toISODate(today()));
  const [note, setNote] = useState("");
  const [minimum, setMinimum] = useState("");
  const [editingMinimum, setEditingMinimum] = useState(false);
  const [notice, setNotice] = useState("");

  const movementsQuery = useQuery({ queryKey: ["server-credit-movements"], queryFn: async () => {
    const { data, error } = await supabase.from("server_credit_movements").select("id,server,kind,quantity,occurred_on,note,created_at").order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as Movement[];
  } });
  const alertsQuery = useQuery({ queryKey: ["server-credit-alerts"], queryFn: async () => {
    const { data, error } = await supabase.from("server_credit_alerts").select("server,minimum_balance");
    if (error) throw error;
    return data ?? [];
  } });
  const clientsQuery = useQuery({ queryKey: ["clients"], queryFn: async () => {
    const { data, error } = await supabase.from("clients").select("id,server,due_date");
    if (error) throw error;
    return data ?? [];
  } });
  const movements = useMemo(() => movementsQuery.data ?? [], [movementsQuery.data]);
  const alerts = useMemo(() => alertsQuery.data ?? [], [alertsQuery.data]);
  const clients = useMemo(() => clientsQuery.data ?? [], [clientsQuery.data]);
  const rows = useMemo(() => SERVERS.map((name) => {
    const entries = movements.filter((item) => item.server === name);
    const initial = entries.find((item) => item.kind === "initial");
    const balance = creditBalance(entries);
    const floor = alerts.find((item) => item.server === name)?.minimum_balance ?? 0;
    const coming = (days: number) => clients.filter((client) => client.server === name && daysUntil(client.due_date) >= 0 && daysUntil(client.due_date) <= days).length;
    return { name, balance, floor, configured: Boolean(initial), today: coming(0), five: coming(5), ten: coming(10) };
  }), [movements, alerts, clients]);
  const selected = rows.find((row) => row.name === server);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["server-credit-movements"] });
  const saveEntry = useMutation({ mutationFn: async ({ name, kind, count, date, description }: { name: string; kind: EntryKind; count: number; date: string; description: string }) => {
    const { error } = await supabase.from("server_credit_movements").insert({ server: name, kind, quantity: count, occurred_on: date, note: description || null });
    if (error) throw error;
  }, onSuccess: () => { refresh(); setEntry(null); setNotice("Movimentação registrada."); }, onError: (error: Error) => setNotice(`Não foi possível salvar: ${error.message}`) });
  const saveMinimum = useMutation({ mutationFn: async (value: number) => {
    const { error } = await supabase.from("server_credit_alerts").upsert({ server, minimum_balance: value });
    if (error) throw error;
  }, onSuccess: () => { void qc.invalidateQueries({ queryKey: ["server-credit-alerts"] }); setEditingMinimum(false); setNotice("Limite de alerta salvo."); }, onError: (error: Error) => setNotice(`Não foi possível salvar: ${error.message}`) });
  const openEntry = (name: string, kind: EntryKind) => { setEntry({ server: name, kind }); setQuantity(""); setEntryDate(toISODate(today())); setNote(""); setNotice(""); };
  const submitEntry = (event: FormEvent) => {
    event.preventDefault();
    if (!entry) return;
    const count = Number(quantity);
    if (!Number.isSafeInteger(count) || (entry.kind === "adjustment" ? count === 0 : count < 0) || count > 1000000 || count < -1000000 || !/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) {
      setNotice("Informe uma quantidade inteira válida e uma data."); return;
    }
    saveEntry.mutate({ name: entry.server, kind: entry.kind, count, date: entryDate, description: note.trim() });
  };
  const error = movementsQuery.isError || alertsQuery.isError || clientsQuery.isError;
  const loading = movementsQuery.isLoading || alertsQuery.isLoading || clientsQuery.isLoading;

  return <main className="min-h-screen bg-background text-frost">
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="border-b border-line pb-6">
        <Link to="/" className="inline-flex items-center gap-1 text-sm text-mist hover:text-cyan"><ArrowLeft size={16} /> Clientes</Link>
        <h1 className="mt-3 font-display text-2xl font-semibold sm:text-3xl">Créditos dos servidores</h1>
      </header>
      {notice && <div role="status" className="mt-5 flex items-center justify-between gap-3 rounded-md border border-cyan/30 bg-cyan/10 px-3 py-2 text-sm text-cyan">{notice}<Button variant="ghost" size="icon" aria-label="Fechar aviso" onClick={() => setNotice("")}><X /></Button></div>}
      {error && <p role="alert" className="mt-5 text-sm text-danger">Não foi possível carregar os créditos. Atualize a página para tentar novamente.</p>}
      {loading && <p className="mt-5 text-sm text-mist">Carregando créditos…</p>}
      {!loading && !error && <>
        <section className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" aria-label="Saldos por servidor">
          {rows.map((row) => <Button key={row.name} variant="outline" onClick={() => { setServer(row.name); setEditingMinimum(false); }}
            className={`h-auto min-w-0 flex-col items-start gap-2 border-line px-4 py-4 text-left ${server === row.name ? "bg-cyan/10 ring-1 ring-cyan/40" : "bg-panel"}`}>
            <span className="w-full truncate font-display text-sm font-semibold text-frost">{row.name}</span>
            <span className={`font-display text-2xl font-semibold ${!row.configured ? "text-mist" : row.balance <= row.floor ? "text-danger" : "text-cyan"}`}>{row.configured ? row.balance : "—"}</span>
            <span className={`text-xs ${row.configured && row.balance <= row.floor ? "text-danger" : "text-mist"}`}>{!row.configured ? "Informar saldo" : row.balance <= row.floor ? "Estoque baixo" : "créditos disponíveis"}</span>
          </Button>)}
        </section>
        {selected && <>
          <section className="mt-9 border-t border-line pt-7">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div><h2 className="font-display text-xl font-semibold">{server}</h2><p className="mt-1 text-sm text-mist">{selected.configured ? `${selected.balance} créditos disponíveis` : "Saldo inicial ainda não informado"}</p></div>
              <div className="flex flex-wrap gap-2">
                {!selected.configured && <Button onClick={() => openEntry(server, "initial")}><Plus /> Saldo inicial</Button>}
                <Button variant="outline" className="border-line bg-panel text-cyan" onClick={() => openEntry(server, "purchase")}><Plus /> Registrar compra</Button>
                <Button variant="outline" className="border-line bg-panel text-mist" onClick={() => openEntry(server, "adjustment")}><Minus /> Ajustar saldo</Button>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-3 text-sm text-mist">
              <span>Alerta em <strong className="text-frost">{selected.floor}</strong> créditos ou menos</span>
              {editingMinimum ? <form className="flex items-center gap-2" onSubmit={(event) => { event.preventDefault(); const value = Number(minimum); if (Number.isSafeInteger(value) && value >= 0 && value <= 1000000) saveMinimum.mutate(value); else setNotice("Informe um limite inteiro válido."); }}>
                <input aria-label="Limite mínimo de créditos" type="number" min="0" max="1000000" step="1" value={minimum} onChange={(event) => setMinimum(event.target.value)} className="w-24 rounded-md border border-line bg-panel px-2 py-1.5 text-frost" />
                <Button size="sm" type="submit" disabled={saveMinimum.isPending}>Salvar</Button>
                <Button size="sm" type="button" variant="ghost" onClick={() => setEditingMinimum(false)}>Cancelar</Button>
              </form> : <Button size="sm" variant="ghost" className="text-cyan" onClick={() => { setMinimum(String(selected.floor)); setEditingMinimum(true); }}>Alterar limite</Button>}
            </div>
          </section>
          <section className="mt-9 border-t border-line pt-7">
            <h2 className="font-display text-xl font-semibold">Previsão de renovações</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {([{ title: "Hoje", count: selected.today }, { title: "Até 5 dias", count: selected.five }, { title: "Até 10 dias", count: selected.ten }]).map(({ title, count }) => {
                const after = selected.balance - count;
                return <div key={title} className="min-w-0 rounded-md border border-line bg-panel p-4">
                  <p className="text-xs text-mist">{title}</p><p className="mt-2 font-display text-2xl font-semibold">{count} <span className="text-sm font-normal text-mist">{count === 1 ? "renovação" : "renovações"}</span></p>
                  <p className={`mt-2 text-sm ${selected.configured && after <= selected.floor ? "text-danger" : "text-mist"}`}>{selected.configured ? `${after} créditos após as renovações${after < 0 ? " · faltam créditos" : after <= selected.floor ? " · abaixo do limite" : ""}` : "Informe o saldo para ver a previsão"}</p>
                </div>;
              })}
            </div>
            <p className="mt-3 text-xs text-mist">Previsão baseada nos vencimentos de clientes cadastrados. O desconto real acontece somente ao renovar.</p>
          </section>
          <section className="mt-9 border-t border-line pt-7">
            <h2 className="font-display text-xl font-semibold">Histórico de {server}</h2>
            <p className="mt-2 text-xs text-mist">O saldo parte da quantidade informada no cadastro inicial. Movimentações registradas antes dele ficam no histórico, mas não alteram o saldo atual.</p>
            <div className="mt-4 divide-y divide-line">
              {movements.filter((item) => item.server === server).length === 0 && <p className="py-5 text-sm text-mist">Nenhuma movimentação registrada.</p>}
              {movements.filter((item) => item.server === server).map((item) => <div key={item.id} className="flex items-center justify-between gap-3 py-3 text-sm"><div className="min-w-0"><p className="font-medium">{{ initial: "Saldo inicial", purchase: "Compra", adjustment: "Ajuste", renewal: "Renovação de cliente" }[item.kind] ?? item.kind}</p><p className="truncate text-xs text-mist">{formatDate(item.occurred_on)}{item.note ? ` · ${item.note}` : ""}</p></div><strong className={`shrink-0 font-display ${item.quantity < 0 ? "text-danger" : "text-ok"}`}>{item.quantity > 0 ? "+" : ""}{item.quantity}</strong></div>)}
            </div>
          </section>
        </>}
      </>}
    </div>
    {entry && <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-background/85 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !saveEntry.isPending) setEntry(null); }}>
      <section role="dialog" aria-modal="true" aria-label="Movimentação de créditos" className="w-full max-w-md rounded-md border border-line bg-panel p-5">
        <div className="flex items-center justify-between gap-2"><h2 className="font-display text-xl font-semibold">{entry.kind === "initial" ? "Saldo inicial" : entry.kind === "purchase" ? "Registrar compra" : "Ajustar saldo"} · {entry.server}</h2><Button size="icon" variant="ghost" aria-label="Fechar" onClick={() => setEntry(null)} disabled={saveEntry.isPending}><X /></Button></div>
        <form onSubmit={submitEntry} className="mt-5 space-y-4">
          <label className={label}>Quantidade {entry.kind === "adjustment" ? "(use negativo para reduzir)" : "de créditos"}<input autoFocus required type="number" step="1" min={entry.kind === "adjustment" ? -1000000 : 0} max={1000000} value={quantity} onChange={(event) => setQuantity(event.target.value)} className={field} /></label>
          {entry.kind === "initial" ? <p className="text-sm text-mist">Informe os créditos disponíveis agora no servidor. Somente movimentações registradas após este saldo inicial serão somadas ou descontadas.</p> : <label className={label}>Data<input required type="date" value={entryDate} onChange={(event) => setEntryDate(event.target.value)} className={field} /></label>}
          <label className={label}>Observação (opcional)<input maxLength={200} value={note} onChange={(event) => setNote(event.target.value)} className={field} /></label>
          <Button type="submit" disabled={saveEntry.isPending} className="w-full">{saveEntry.isPending ? "Salvando…" : "Salvar"}</Button>
        </form>
      </section>
    </div>}
  </main>;
}