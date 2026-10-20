import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { ArrowLeft, Eye, EyeOff, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { formatBRL, formatDate, toISODate, today } from "@/lib/iptv";

type Reseller = { id: string; name: string; sale_price: number; cost_price: number };
type Sale = { id: string; reseller_id: string; sold_at: string; quantity: number; sale_price: number; cost_price: number };
type ResellerForm = { name: string; sale_price: string; cost_price: string };
type SaleForm = { reseller_id: string; sold_at: string; quantity: string; sale_price: string; cost_price: string };

const moneyInput = z.coerce.number().finite().min(0).max(99999999);
const resellerSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome.").max(120, "Nome muito longo."),
  sale_price: moneyInput,
  cost_price: moneyInput,
});
const saleSchema = z.object({
  reseller_id: z.string().uuid(),
  sold_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  quantity: z.coerce.number().int().positive().max(1000000),
  sale_price: moneyInput,
  cost_price: moneyInput,
});
const emptyReseller: ResellerForm = { name: "", sale_price: "", cost_price: "" };
const emptySale: SaleForm = { reseller_id: "", sold_at: "", quantity: "", sale_price: "", cost_price: "" };
const numberText = (value: number) => String(value).replace(".", ",");
const parsePrice = (value: string) => Number(value.replace(",", "."));
const inputClass = "mt-1.5 w-full rounded-md border border-line bg-background px-3 py-2.5 text-sm text-frost outline-none focus:border-cyan";
const labelClass = "block text-sm text-mist";
const totals = (sales: Sale[]) => sales.reduce((result, sale) => ({
  quantity: result.quantity + sale.quantity,
  received: result.received + sale.quantity * sale.sale_price,
  spent: result.spent + sale.quantity * sale.cost_price,
}), { quantity: 0, received: 0, spent: 0 });

export const Route = createFileRoute("/_authenticated/revendedores")({
  head: () => ({ meta: [
    { title: "Revendedores — MaxFlix" },
    { name: "description", content: "Controle separado de vendas de créditos para revendedores MaxFlix." },
    { property: "og:title", content: "Revendedores — MaxFlix" },
    { property: "og:description", content: "Vendas, gastos e lucros dos créditos vendidos aos revendedores." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: Revendedores,
});

function Revendedores() {
  const qc = useQueryClient();
  const [month, setMonth] = useState(() => toISODate(today()).slice(0, 7));
  const [hidden, setHidden] = useState(true);
  const [privacyReady, setPrivacyReady] = useState(false);
  const [resellerOpen, setResellerOpen] = useState(false);
  const [saleOpen, setSaleOpen] = useState(false);
  const [editingReseller, setEditingReseller] = useState<string | null>(null);
  const [editingSale, setEditingSale] = useState<string | null>(null);
  const [resellerForm, setResellerForm] = useState<ResellerForm>(emptyReseller);
  const [saleForm, setSaleForm] = useState<SaleForm>(emptySale);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setHidden(window.localStorage.getItem("maxflix-hide-financials") === "true");
    setPrivacyReady(true);
  }, []);
  const resellersQuery = useQuery({
    queryKey: ["resellers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("resellers").select("*").order("name");
      if (error) throw error;
      return (data ?? []).map((row) => ({ ...row, sale_price: Number(row.sale_price), cost_price: Number(row.cost_price) })) as Reseller[];
    },
  });
  const salesQuery = useQuery({
    queryKey: ["reseller-sales"],
    queryFn: async () => {
      const { data, error } = await supabase.from("reseller_sales").select("*").order("sold_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((row) => ({ ...row, sale_price: Number(row.sale_price), cost_price: Number(row.cost_price) })) as Sale[];
    },
  });
  const resellers = resellersQuery.data ?? [];
  const sales = salesQuery.data ?? [];
  const monthlySales = useMemo(() => sales.filter((sale) => month === "all" || sale.sold_at.startsWith(month)), [sales, month]);
  const summary = useMemo(() => totals(monthlySales), [monthlySales]);
  const months = useMemo(() => [...new Set(sales.map((sale) => sale.sold_at.slice(0, 7)))].sort().reverse(), [sales]);
  const display = (value: number) => !privacyReady || hidden ? "••••••" : formatBRL(value);

  const refresh = () => { void qc.invalidateQueries({ queryKey: ["resellers"] }); void qc.invalidateQueries({ queryKey: ["reseller-sales"] }); };
  const saveReseller = useMutation({
    mutationFn: async ({ id, values }: { id: string | null; values: z.infer<typeof resellerSchema> }) => {
      const result = id ? await supabase.from("resellers").update(values).eq("id", id) : await supabase.from("resellers").insert(values);
      if (result.error) throw result.error;
    },
    onSuccess: () => { refresh(); setResellerOpen(false); setNotice("Revendedor salvo."); },
    onError: (failure: Error) => setError(failure.message),
  });
  const saveSale = useMutation({
    mutationFn: async ({ id, values }: { id: string | null; values: z.infer<typeof saleSchema> }) => {
      const result = id ? await supabase.from("reseller_sales").update(values).eq("id", id) : await supabase.from("reseller_sales").insert(values);
      if (result.error) throw result.error;
    },
    onSuccess: () => { refresh(); setSaleOpen(false); setNotice("Venda registrada."); },
    onError: (failure: Error) => setError(failure.message),
  });
  const deleteReseller = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("resellers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { refresh(); setNotice("Revendedor excluído."); },
    onError: () => setNotice("Não é possível excluir um revendedor com vendas. Exclua as vendas primeiro."),
  });
  const deleteSale = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("reseller_sales").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { refresh(); setNotice("Venda excluída."); },
    onError: (failure: Error) => setNotice(`Não foi possível excluir: ${failure.message}`),
  });
  const openReseller = (reseller?: Reseller) => {
    setEditingReseller(reseller?.id ?? null);
    setResellerForm(reseller ? { name: reseller.name, sale_price: numberText(reseller.sale_price), cost_price: numberText(reseller.cost_price) } : emptyReseller);
    setError(""); setResellerOpen(true);
  };
  const openSale = (sale?: Sale, reseller?: Reseller) => {
    setEditingSale(sale?.id ?? null);
    const selected = reseller ?? resellers.find((item) => item.id === sale?.reseller_id) ?? resellers[0];
    setSaleForm(sale ? { reseller_id: sale.reseller_id, sold_at: sale.sold_at, quantity: String(sale.quantity), sale_price: numberText(sale.sale_price), cost_price: numberText(sale.cost_price) } : {
      ...emptySale, reseller_id: selected?.id ?? "", sold_at: toISODate(today()), sale_price: selected ? numberText(selected.sale_price) : "", cost_price: selected ? numberText(selected.cost_price) : "",
    });
    setError(""); setSaleOpen(true);
  };
  const submitReseller = (event: FormEvent) => {
    event.preventDefault(); setError("");
    const values = resellerSchema.safeParse({ name: resellerForm.name, sale_price: parsePrice(resellerForm.sale_price), cost_price: parsePrice(resellerForm.cost_price) });
    if (!values.success) return setError("Informe nome e valores válidos, maiores ou iguais a zero.");
    saveReseller.mutate({ id: editingReseller, values: values.data });
  };
  const submitSale = (event: FormEvent) => {
    event.preventDefault(); setError("");
    const values = saleSchema.safeParse({ reseller_id: saleForm.reseller_id, sold_at: saleForm.sold_at, quantity: Number(saleForm.quantity), sale_price: parsePrice(saleForm.sale_price), cost_price: parsePrice(saleForm.cost_price) });
    if (!values.success || Number.isNaN(Date.parse(saleForm.sold_at))) return setError("Informe data, quantidade e valores válidos.");
    saveSale.mutate({ id: editingSale, values: values.data });
  };

  return (
    <main className="min-h-screen bg-background text-frost">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 border-b border-line pb-6 sm:flex sm:items-center">
          <div className="min-w-0">
            <nav aria-label="Áreas do MaxFlix" className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <Link to="/" className="inline-flex items-center gap-1 text-mist hover:text-cyan"><ArrowLeft size={16} /> Dashboard</Link>
          <Link to="/" search={{ aba: "renovacoes" }} className="text-mist hover:text-cyan">Renovações</Link>
          <Link to="/creditos" className="text-mist hover:text-cyan">Créditos</Link>
          <Link to="/revendedores" className="text-mist hover:text-cyan">Revendedores</Link>
          <Link to="/responsaveis" className="text-mist hover:text-cyan">Responsáveis</Link>
          <Link to="/comunicacao" className="text-mist hover:text-cyan">Comunicação</Link>
        </nav>
            <h1 className="mt-3 truncate font-display text-2xl font-semibold sm:text-3xl">Revendedores</h1>
            <p className="mt-1 text-sm text-mist">Vendas de créditos</p>
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:ml-auto">
            <Button variant="outline" size="icon" title={hidden ? "Mostrar valores" : "Ocultar valores"} aria-label={hidden ? "Mostrar valores" : "Ocultar valores"} onClick={() => {
              const next = !hidden; setHidden(next); window.localStorage.setItem("maxflix-hide-financials", String(next));
            }} className="border-line bg-panel text-mist">{hidden ? <EyeOff /> : <Eye />}</Button>
            <Button onClick={() => openReseller()} className="hidden sm:inline-flex"><Plus /> Novo revendedor</Button>
          </div>
        </header>
        <div className="mt-4 flex flex-wrap items-center gap-2 sm:hidden"><Button onClick={() => openReseller()}><Plus /> Novo revendedor</Button></div>
        <div className="mt-7 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-lg font-semibold">Resumo de vendas</h2>
          <select aria-label="Período das vendas" value={month} onChange={(event) => setMonth(event.target.value)} className="rounded-md border border-line bg-panel px-3 py-2 text-sm text-frost outline-none focus:border-cyan">
            <option value="all">Todos os meses</option>
            {!months.includes(toISODate(today()).slice(0, 7)) && <option value={toISODate(today()).slice(0, 7)}>Mês atual</option>}
            {months.map((value) => <option key={value} value={value}>{new Date(`${value}-01T12:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}</option>)}
          </select>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Créditos vendidos" value={String(summary.quantity)} />
          <Stat label="Recebido" value={display(summary.received)} />
          <Stat label="Gasto" value={display(summary.spent)} />
          <Stat label="Lucro" value={display(summary.received - summary.spent)} accent />
        </div>
        {notice && <p role="status" className="mt-5 rounded-md border border-cyan/30 bg-cyan/10 px-3 py-2 text-sm text-cyan">{notice} <Button variant="ghost" size="sm" onClick={() => setNotice("")}>Fechar</Button></p>}
        {(resellersQuery.isError || salesQuery.isError) && <p role="alert" className="mt-5 text-danger">Não foi possível carregar os dados. Atualize a página para tentar novamente.</p>}
        <div className="mt-9 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-xl font-semibold">Seus revendedores <span className="text-mist">({resellers.length})</span></h2>
          {resellers.length > 0 && <Button onClick={() => openSale()}><Plus /> Registrar venda</Button>}
        </div>
        {(resellersQuery.isLoading || salesQuery.isLoading) && <p className="mt-5 text-sm text-mist">Carregando…</p>}
        {!resellersQuery.isLoading && resellers.length === 0 && <p className="mt-5 border-t border-line py-8 text-sm text-mist">Nenhum revendedor cadastrado.</p>}
        <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {resellers.map((reseller) => {
            const items = monthlySales.filter((sale) => sale.reseller_id === reseller.id);
            const total = totals(items);
            return <article key={reseller.id} className="min-w-0 rounded-md border border-line bg-panel p-4">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                <h3 className="min-w-0 break-words font-display text-lg font-semibold">{reseller.name}</h3>
                <div className="flex shrink-0 gap-1">
                  <Button size="icon" variant="ghost" aria-label={`Editar ${reseller.name}`} title="Editar revendedor" onClick={() => openReseller(reseller)}><Pencil /></Button>
                  <Button size="icon" variant="ghost" aria-label={`Excluir ${reseller.name}`} title="Excluir revendedor" onClick={() => { if (window.confirm(`Excluir ${reseller.name}?`)) deleteReseller.mutate(reseller.id); }}><Trash2 /></Button>
                </div>
              </div>
              <p className="mt-2 text-sm text-mist">Venda/crédito <span className="text-frost">{display(reseller.sale_price)}</span> · Custo/crédito <span className="text-frost">{display(reseller.cost_price)}</span></p>
              <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-line pt-3 text-sm">
                <span className="text-mist">{total.quantity} créditos</span><span className="text-right text-mist">{items.length} {items.length === 1 ? "venda" : "vendas"}</span>
                <span className="text-mist">Recebido {display(total.received)}</span><span className="text-right text-mist">Gasto {display(total.spent)}</span>
                <span className="col-span-2 font-display font-semibold text-cyan">Lucro {display(total.received - total.spent)}</span>
              </div>
              <Button variant="outline" size="sm" onClick={() => openSale(undefined, reseller)} className="mt-4 border-cyan/30 bg-cyan/10 text-cyan hover:bg-cyan/15 hover:text-cyan"><Plus /> Registrar venda</Button>
            </article>;
          })}
        </div>
        <section className="mt-10 border-t border-line pt-7">
          <h2 className="font-display text-xl font-semibold">Histórico de vendas</h2>
          {monthlySales.length === 0 && !salesQuery.isLoading && <p className="mt-5 text-sm text-mist">Nenhuma venda neste período.</p>}
          <div className="mt-4 divide-y divide-line">
            {monthlySales.map((sale) => {
              const reseller = resellers.find((row) => row.id === sale.reseller_id);
              return <div key={sale.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                <div className="min-w-0"><p className="truncate font-medium">{reseller?.name ?? "Revendedor"}</p><p className="text-xs text-mist">{formatDate(sale.sold_at)} · {sale.quantity} {sale.quantity === 1 ? "crédito" : "créditos"}</p></div>
                <div className="hidden text-sm text-mist sm:block">Recebido {display(sale.quantity * sale.sale_price)}<br />Gasto {display(sale.quantity * sale.cost_price)}</div>
                <div className="flex shrink-0 items-center gap-1"><span className="mr-1 text-sm font-semibold text-cyan">{display(sale.quantity * (sale.sale_price - sale.cost_price))}</span>
                  <Button size="icon" variant="ghost" aria-label={`Editar venda de ${reseller?.name ?? "revendedor"} em ${formatDate(sale.sold_at)}`} onClick={() => openSale(sale)}><Pencil /></Button>
                  <Button size="icon" variant="ghost" aria-label={`Excluir venda de ${reseller?.name ?? "revendedor"} em ${formatDate(sale.sold_at)}`} onClick={() => { if (window.confirm("Excluir esta venda?")) deleteSale.mutate(sale.id); }}><Trash2 /></Button>
                </div>
              </div>;
            })}
          </div>
        </section>
      </div>
      {resellerOpen && <Dialog title={editingReseller ? "Editar revendedor" : "Novo revendedor"} onClose={() => setResellerOpen(false)}>
        <form onSubmit={submitReseller} className="space-y-4">
          <label className={labelClass}>Nome<input autoFocus required maxLength={120} value={resellerForm.name} onChange={(e) => setResellerForm({ ...resellerForm, name: e.target.value })} className={inputClass} /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className={labelClass}>Venda por crédito (R$)<input required inputMode="decimal" value={resellerForm.sale_price} onChange={(e) => setResellerForm({ ...resellerForm, sale_price: e.target.value })} className={inputClass} /></label>
            <label className={labelClass}>Custo por crédito (R$)<input required inputMode="decimal" value={resellerForm.cost_price} onChange={(e) => setResellerForm({ ...resellerForm, cost_price: e.target.value })} className={inputClass} /></label>
          </div>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <Button type="submit" disabled={saveReseller.isPending} className="w-full">{saveReseller.isPending ? "Salvando…" : "Salvar revendedor"}</Button>
        </form>
      </Dialog>}
      {saleOpen && <Dialog title={editingSale ? "Editar venda" : "Registrar venda"} onClose={() => setSaleOpen(false)}>
        <form onSubmit={submitSale} className="space-y-4">
          <label className={labelClass}>Revendedor<select required value={saleForm.reseller_id} onChange={(e) => { const reseller = resellers.find((row) => row.id === e.target.value); setSaleForm({ ...saleForm, reseller_id: e.target.value, sale_price: reseller ? numberText(reseller.sale_price) : "", cost_price: reseller ? numberText(reseller.cost_price) : "" }); }} className={inputClass}>{resellers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <div className="grid grid-cols-2 gap-3">
            <label className={labelClass}>Data<input required type="date" value={saleForm.sold_at} onChange={(e) => setSaleForm({ ...saleForm, sold_at: e.target.value })} className={inputClass} /></label>
            <label className={labelClass}>Quantidade<input required type="number" min="1" max="1000000" step="1" value={saleForm.quantity} onChange={(e) => setSaleForm({ ...saleForm, quantity: e.target.value })} className={inputClass} /></label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className={labelClass}>Venda/crédito (R$)<input required inputMode="decimal" value={saleForm.sale_price} onChange={(e) => setSaleForm({ ...saleForm, sale_price: e.target.value })} className={inputClass} /></label>
            <label className={labelClass}>Custo/crédito (R$)<input required inputMode="decimal" value={saleForm.cost_price} onChange={(e) => setSaleForm({ ...saleForm, cost_price: e.target.value })} className={inputClass} /></label>
          </div>
          {saleForm.quantity && Number(saleForm.quantity) > 0 && Number.isFinite(parsePrice(saleForm.sale_price)) && Number.isFinite(parsePrice(saleForm.cost_price)) && <div className="grid grid-cols-3 gap-2 border-t border-line pt-3 text-xs text-mist"><div>Recebido<br /><strong className="break-all text-frost">{display(Number(saleForm.quantity) * parsePrice(saleForm.sale_price))}</strong></div><div>Gasto<br /><strong className="break-all text-frost">{display(Number(saleForm.quantity) * parsePrice(saleForm.cost_price))}</strong></div><div>Lucro<br /><strong className="break-all text-cyan">{display(Number(saleForm.quantity) * (parsePrice(saleForm.sale_price) - parsePrice(saleForm.cost_price)))}</strong></div></div>}
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <Button type="submit" disabled={saveSale.isPending} className="w-full">{saveSale.isPending ? "Salvando…" : "Salvar venda"}</Button>
        </form>
      </Dialog>}
    </main>
  );
}

function Stat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return <div className="min-w-0 rounded-md border border-line bg-panel px-4 py-4"><p className="text-xs text-mist">{label}</p><p className={`mt-2 break-all font-display text-lg font-semibold sm:text-xl ${accent ? "text-cyan" : "text-frost"}`}>{value}</p></div>;
}
function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 px-4 py-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-label={title} className="max-h-full w-full max-w-md overflow-y-auto rounded-md border border-line bg-panel p-5 shadow-xl">
      <div className="mb-5 flex items-center justify-between gap-3"><h2 className="font-display text-xl font-semibold">{title}</h2><Button size="icon" variant="ghost" onClick={onClose} aria-label="Fechar"><X /></Button></div>
      {children}
    </section>
  </div>;
}
