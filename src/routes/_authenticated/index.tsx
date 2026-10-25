import { creditStockOverview, prioritizeCreditStocks } from "@/lib/credit-stock-overview";
import type { CreditMovement } from "@/lib/server-credits";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ClientForm, type ClientDraft } from "@/components/ClientForm";
import { ReferralPanel } from "@/components/ReferralPanel";
import { StatusBadge } from "@/components/StatusBadge";
import { ImportDialog } from "@/components/ImportDialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { paginateClients } from "@/lib/client-pagination";
import { sortClients, type ClientSortMode } from "@/lib/client-sort";
import { MessageCircle, MoreHorizontal, RefreshCw } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ImportRow } from "@/lib/import-clients";
import {
  DEFAULT_TEMPLATE,
  DEFAULT_OVERDUE_TEMPLATE,
  SERVERS,
  SERVER_COSTS,
  daysUntil,
  formatBRL,
  formatDate,
  getStatus,
  isPackageCovered,
  nextDueDate,
  renewalDates,
  renewalMessageLink,
  toISODate,
  today,
  toCSV,
  type Client,
} from "@/lib/iptv";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "MaxFlix — Gestão de clientes IPTV" },

      {
        name: "description",
        content:
          "Painel para gerenciar clientes IPTV: vencimentos, renovações, lucro e mensagens de cobrança no WhatsApp.",
      },
      { property: "og:title", content: "MaxFlix — Gestão de clientes IPTV" },
      {
        property: "og:description",
        content:
          "Controle vencimentos, status automáticos, lucro e renovações dos seus clientes IPTV em um só painel.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Painel,
});

type Tab = "todos" | "vencidos" | "hoje" | "breve" | "cobranca";

type Payment = {
  id: string;
  client_name: string;
  server: string;
  amount: number;
  cost: number;
  paid_at: string;
};

type ForecastPeriod = 0 | 5 | 10;

type ForecastEntry = {
  client: Client;
  days: number;
  revenue: number;
  cost: number;
  profit: number;
  packageCovered: boolean;
};

type ServerPeriod = 0 | 5 | 10;

const num = (value: string) => Number(String(value).replace(",", ".")) || 0;

function Painel() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("todos");
  const [range, setRange] = useState(1);
  const [search, setSearch] = useState("");
  const [serverFilter, setServerFilter] = useState("todos");
  const [sortMode, setSortMode] = useState<ClientSortMode>("vencimento-asc");
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Client | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [referralsOpen, setReferralsOpen] = useState(false);
  const [referralClient, setReferralClient] = useState<Client | null>(null);
  const [forecastOpen, setForecastOpen] = useState(false);
  const [serverReportOpen, setServerReportOpen] = useState(false);
  const [renewingBusy, setRenewingBusy] = useState(false);
  const [financialsHidden, setFinancialsHidden] = useState(false);
  const [financialsReady, setFinancialsReady] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setFinancialsHidden(window.localStorage.getItem("maxflix-hide-financials") === "true");
    setFinancialsReady(true);
  }, []);

  const toggleFinancials = () => {
    setFinancialsHidden((hidden) => {
      const next = !hidden;
      window.localStorage.setItem("maxflix-hide-financials", String(next));
      return next;
    });
  };

  const money = (value: number) => !financialsReady || financialsHidden ? "••••••" : formatBRL(value);

  const importMutation = useMutation({
    mutationFn: async (rows: ImportRow[]) => {
      const payload = rows.map((r) => ({
        name: r.name,
        login: r.login,
        server: r.server,
        cost: r.cost,
        paid: r.paid,
        due_date: r.due_date,
        financial_due_date: r.financial_due_date,
        whatsapp: r.whatsapp,
        prev_cost: r.cost,
        prev_paid: r.paid,
      }));
      for (let i = 0; i < payload.length; i += 200) {
        const { error } = await supabase.from("clients").insert(payload.slice(i, i + 200));
        if (error) throw error;
      }
      return payload.length;
    },
    onSuccess: (count) => {
      setImportOpen(false);
      setNotice(`${count} cliente(s) importados com sucesso.`);
      invalidate();
    },
    onError: (error: Error) => setNotice(`Falha na importação: ${error.message}`),
  });

  const clientsQuery = useQuery({
    queryKey: ["clients"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("*")
        .order("due_date", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((c) => ({
        ...c,
        cost: Number(c.cost),
        paid: Number(c.paid),
        prev_cost: Number(c.prev_cost),
        prev_paid: Number(c.prev_paid),
      })) as Client[];
    },
  });

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("settings")
        .select("whatsapp_template, overdue_whatsapp_template")
        .eq("id", "default")
        .maybeSingle();
      if (error) throw error;
      return {
        regular: data?.whatsapp_template ?? DEFAULT_TEMPLATE,
        overdue: data?.overdue_whatsapp_template ?? DEFAULT_OVERDUE_TEMPLATE,
      };
    },
  });

  const paymentsQuery = useQuery({
    queryKey: ["payments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments")
        .select("*")
        .order("paid_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((p) => ({
        ...p,
        amount: Number(p.amount),
        cost: Number(p.cost),
      })) as Payment[];
    },
  });

  // Read-only dashboard snapshot: never insert, update or correct stock while loading it.
  const stockMovementsQuery = useQuery({
    queryKey: ["credit-stock-dashboard-movements"],
    queryFn: async () => {
      const entries: CreditMovement[] = [];
      const pageSize = 500;
      for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await supabase
          .from("server_credit_movements")
          .select("id,server,kind,quantity,created_at")
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(offset, offset + pageSize - 1);
        if (error) throw error;
        entries.push(...(data ?? []));
        if (!data || data.length < pageSize) return entries;
      }
    },
  });
  const stockAlertsQuery = useQuery({
    queryKey: ["credit-stock-dashboard-alerts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("server_credit_alerts")
        .select("server,minimum_balance");
      if (error) throw error;
      return data ?? [];
    },
  });

  const template = settingsQuery.data?.regular ?? DEFAULT_TEMPLATE;
  const overdueTemplate = settingsQuery.data?.overdue ?? DEFAULT_OVERDUE_TEMPLATE;
  const clients = useMemo(() => clientsQuery.data ?? [], [clientsQuery.data]);
  const payments = useMemo(() => paymentsQuery.data ?? [], [paymentsQuery.data]);
  const stockOverview = useMemo(
    () => prioritizeCreditStocks(creditStockOverview(stockMovementsQuery.data ?? [], stockAlertsQuery.data ?? [], clients)),
    [stockMovementsQuery.data, stockAlertsQuery.data, clients],
  );
  const stockLoading = stockMovementsQuery.isLoading || stockAlertsQuery.isLoading || clientsQuery.isLoading;
  const stockError = stockMovementsQuery.isError || stockAlertsQuery.isError || clientsQuery.isError;

  const invalidate = () => qc.invalidateQueries({ queryKey: ["clients"] });

  const saveMutation = useMutation({
    mutationFn: async ({ draft, id }: { draft: ClientDraft; id: string | null }) => {
      const cost = num(draft.cost);
      const paid = num(draft.paid);
      const payload = {
        name: draft.name.trim(),
        login: draft.login.trim(),
        server: draft.server,
        cost,
        paid,
        due_date: draft.due_date,
        financial_due_date: draft.financial_due_date || null,
        whatsapp: draft.whatsapp.trim() || null,
        referred_by_client_id: draft.referred_by_client_id || null,
        referral_first_payment_confirmed: draft.referral_first_payment_confirmed,
        prev_cost: cost,
        prev_paid: paid,
      };
      if (id) {
        const { error } = await supabase.from("clients").update(payload).eq("id", id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("clients").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: (_data, variables) => {
      setFormOpen(false);
      setEditing(null);
      setFormError(null);
      invalidate();
      void qc.invalidateQueries({ queryKey: ["referral-movements"] });
      if (variables.draft.referred_by_client_id && variables.draft.referral_first_payment_confirmed) {
        setNotice("Cliente salvo! A indicação foi registrada e o ponto creditado automaticamente.");
      } else if (variables.draft.referred_by_client_id) {
        setNotice("Cliente salvo! Indicação registrada e aguardando confirmação do primeiro pagamento.");
      }
    },
    onError: (error: Error) => {
      setFormError(`Não foi possível salvar o cliente: ${error.message}`);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      patch: {
        due_date?: string;
        cost?: number;
        paid?: number;
        prev_cost?: number;
        prev_paid?: number;
        financial_due_date?: string;
      };
    }) => {
      const { error } = await supabase.from("clients").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });


  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("clients").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  // Zera custo e valor pago de clientes vencidos, guardando os valores no histórico.
  useEffect(() => {
    const pending = clients.filter(
      (c) => getStatus(c).key === "vencido" && (c.cost > 0 || c.paid > 0),
    );
    if (pending.length === 0) return;
    void (async () => {
      for (const c of pending) {
        await supabase
          .from("clients")
          .update({
            prev_cost: c.cost > 0 ? c.cost : c.prev_cost,
            prev_paid: c.paid > 0 ? c.paid : c.prev_paid,
            cost: 0,
            paid: 0,
          })
          .eq("id", c.id);
      }
      invalidate();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients]);

  // Clientes com pacote já pago: valor pago do mês fica zerado (nada é cobrado),
  // mas o custo do crédito do servidor continua sendo descontado.
  useEffect(() => {
    const pending = clients.filter(
      (c) => getStatus(c).key !== "vencido" && isPackageCovered(c) && c.paid > 0,
    );
    if (pending.length === 0) return;
    void (async () => {
      for (const c of pending) {
        await supabase
          .from("clients")
          .update({ prev_paid: c.paid, paid: 0 })
          .eq("id", c.id);
      }
      invalidate();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients]);

  const [renewing, setRenewing] = useState<Client | null>(null);

  const performRenewal = async (client: Client, opts: { dueDate: string; financialDueDate: string; cost: number; monthlyPaid: number; prevPaid: number; paymentAmount: number; paymentCost: number }) => {
    if (renewingBusy) return false;
    setRenewingBusy(true);
    try {
      const { error } = await supabase.rpc("renew_client_with_credit", {
        p_client_id: client.id,
        p_expected_due_date: client.due_date,
        p_due_date: opts.dueDate,
        p_financial_due_date: opts.financialDueDate,
        p_cost: opts.cost,
        p_monthly_paid: opts.monthlyPaid,
        p_prev_paid: opts.prevPaid,
        p_payment_amount: opts.paymentAmount,
        p_payment_cost: opts.paymentCost,
      });
      if (error) throw error;
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["clients"] }),
        qc.invalidateQueries({ queryKey: ["payments"] }),
        qc.invalidateQueries({ queryKey: ["server-credit-movements"] }),
      ]);
      return true;
    } catch (error) {
      setNotice(`Não foi possível renovar ${client.name}: ${error instanceof Error ? error.message : "Tente novamente."}`);
      return false;
    } finally {
      setRenewingBusy(false);
    }
  };

  const useReferralMonth = async (client: Client): Promise<boolean> => {
    if (renewingBusy) return false;
    setRenewingBusy(true);
    try {
      const { error } = await supabase.rpc("referral_use_free_month", {
        p_client_id: client.id,
        p_expected_due_date: client.due_date,
      });
      if (error) throw error;
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["clients"] }),
        qc.invalidateQueries({ queryKey: ["payments"] }),
        qc.invalidateQueries({ queryKey: ["server-credit-movements"] }),
        qc.invalidateQueries({ queryKey: ["credit-stock-dashboard-movements"] }),
        qc.invalidateQueries({ queryKey: ["referral-rewards"] }),
      ]);
      setNotice(`Mês grátis de ${client.name} aplicado! Vencimento atualizado sem lançar pagamento.`);
      return true;
    } catch (error) {
      setNotice(`Não foi possível utilizar o mês grátis de ${client.name}: ${error instanceof Error ? error.message : "Tente novamente."}`);
      return false;
    } finally {
      setRenewingBusy(false);
    }
  };

  const renew = async (client: Client) => {
    const newDue = nextDueDate(client.due_date);
    const coveredByPackage = client.financial_due_date && client.financial_due_date >= newDue;
    if (coveredByPackage) {
      const done = await performRenewal(client, {
        dueDate: newDue,
        financialDueDate: client.financial_due_date ?? newDue,
        cost: client.cost || client.prev_cost,
        monthlyPaid: 0,
        prevPaid: client.prev_paid,
        paymentAmount: 0,
        paymentCost: 0,
      });
      if (done) setNotice(`Pacote pago até ${formatDate(client.financial_due_date)} — 1 crédito descontado de ${client.server} (${client.name})`);
      return;
    }
    const { data: freeMonths, error: rewardError } = await supabase.from("referral_rewards")
      .select("id").eq("client_id", client.id).eq("reward", "mes_gratis").eq("status", "pendente").limit(1);
    if (rewardError) {
      setNotice(`Não foi possível verificar os benefícios de ${client.name}: ${rewardError.message}`);
      return;
    }
    if (freeMonths?.length && window.confirm(`${client.name} possui 1 mês grátis resgatado. Deseja usar nesta renovação?`)) {
      await useReferralMonth(client);
      return;
    }
    setRenewing(client);
  };

  const confirmRenew = async (
    client: Client,
    opts: { months: number; cost: number; paid: number; monthlyCost: number; monthlyPaid: number },
  ) => {
    const { dueDate: newDue, financialDueDate } = renewalDates(client.due_date, opts.months);
    const done = await performRenewal(client, {
      dueDate: newDue,
      financialDueDate,
      cost: opts.monthlyCost,
      monthlyPaid: opts.monthlyPaid,
      prevPaid: opts.months > 1 ? client.prev_paid || client.paid : opts.monthlyPaid,
      paymentAmount: opts.paid,
      paymentCost: opts.cost,
    });
    if (!done) return;
    setRenewing(null);
    setNotice(
      opts.months > 1
        ? `${client.name}: pacote de ${opts.months} meses pago até ${formatDate(financialDueDate)}`
        : `${client.name}: novo vencimento em ${formatDate(newDue)}`,
    );
  };

  const summary = useMemo(() => {
    let ativos = 0;
    let vencidos = 0;
    let hoje = 0;
    let proximos = 0;
    let lucro = 0;
    for (const c of clients) {
      const s = getStatus(c);
      if (s.key === "vencido") vencidos += 1;
      else {
        lucro += c.paid - c.cost;
        ativos += 1;
        if (s.key === "hoje") hoje += 1;
        else if (s.key === "breve") proximos += 1;
      }
    }
    return { total: clients.length, ativos, vencidos, hoje, proximos, lucro };
  }, [clients]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return sortClients(
      clients.filter((c) => {
        const s = getStatus(c);
        if (tab === "todos" && s.key === "vencido") return false;
        if (tab === "vencidos" && s.key !== "vencido") return false;
        if (tab === "hoje" && s.key !== "hoje") return false;
        if (tab === "breve" && s.days !== range) return false;
        if (tab === "cobranca" && s.key !== "vencido" && s.key !== "hoje" && s.key !== "breve")
          return false;
        if (serverFilter !== "todos" && c.server !== serverFilter) return false;
        if (term && !`${c.name} ${c.login}`.toLowerCase().includes(term)) return false;
        return true;
      }),
      sortMode,
    );
  }, [clients, tab, range, search, serverFilter, sortMode]);
  
  // Apply search, status, server, and sort to the entire list BEFORE paging.
  // Reset page when those controls change; preserve overall summary and CSV export.
  useEffect(() => {
    setPage(1);
  }, [tab, range, search, serverFilter, sortMode]);

  const paginated = useMemo(() => paginateClients(filtered, page), [filtered, page]);
  const changePage = (nextPage: number) => {
    setPage(Math.max(1, Math.min(nextPage, paginated.totalPages)));
    document.getElementById("maxflix-client-results")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };


  const monthlyBilling = useMemo(() => {
    const map = new Map<string, { faturado: number; custo: number; count: number }>();
    for (const p of payments) {
      const key = p.paid_at.slice(0, 7); // YYYY-MM
      const entry = map.get(key) ?? { faturado: 0, custo: 0, count: 0 };
      entry.faturado += p.amount;
      entry.custo += p.cost;
      entry.count += 1;
      map.set(key, entry);
    }
    return [...map.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 6)
      .map(([month, v]) => ({ month, ...v, lucro: v.faturado - v.custo }));
  }, [payments]);

  const forecastEntries = useMemo<ForecastEntry[]>(
    () =>
      clients
        .map((client) => {
          const days = daysUntil(client.due_date);
          const packageCovered = isPackageCovered(client);
          const revenue = packageCovered ? 0 : client.paid;
          return {
            client,
            days,
            revenue,
            cost: client.cost,
            profit: revenue - client.cost,
            packageCovered,
          };
        })
        .filter((entry) => entry.days >= 0 && entry.days <= 10)
        .sort((a, b) => a.client.due_date.localeCompare(b.client.due_date)),
    [clients],
  );

  const serverReport = useMemo(
    () =>
      SERVERS.map((server) => {
        const serverClients = clients.filter((client) => client.server === server);
        const renewals = (days: ServerPeriod) =>
          serverClients.filter((client) => {
            const remaining = daysUntil(client.due_date);
            return remaining >= 0 && remaining <= days;
          });
        return {
          server,
          total: serverClients.length,
          active: serverClients.filter((client) => getStatus(client).key !== "vencido").length,
          expired: serverClients.filter((client) => getStatus(client).key === "vencido").length,
          today: renewals(0),
          fiveDays: renewals(5),
          tenDays: renewals(10),
        };
      }).filter((item) => item.total > 0),
    [clients],
  );

  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    await navigate({ to: "/auth", replace: true });
  };

  const exportCSV = () => {
    const blob = new Blob([`\uFEFF${toCSV(filtered)}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "clientes.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: "todos", label: "Todos" },
    { key: "vencidos", label: "Vencidos" },
    { key: "hoje", label: "Vence hoje" },
    { key: "breve", label: "Vencendo em breve" },
    { key: "cobranca", label: "Fila de cobrança" },
  ];

  const monthLabel = (ym: string) => {
    const [y, m] = ym.split("-").map(Number);
    return new Date(y ?? 1970, (m ?? 1) - 1, 1).toLocaleDateString("pt-BR", {
      month: "long",
      year: "numeric",
    });
  };

  const tabBtn = (active: boolean) =>
    `font-display text-sm font-medium px-3 py-1.5 rounded-lg ${
      active ? "bg-cyan/15 text-cyan ring-1 ring-cyan/30" : "text-mist hover:bg-frost/5"
    }`;

  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-frost">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 -right-40 h-[560px] w-[560px] rounded-[60%] bg-cyan/10 blur-3xl" />
        <div className="absolute bottom-0 -left-32 h-[420px] w-[420px] rounded-[60%] bg-cyan/5 blur-3xl" />
      </div>

      <div className="relative z-10 mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <header className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-cyan/15 ring-1 ring-cyan/30">
                <span className="font-display text-sm font-semibold text-cyan">M</span>
              </div>
              <div className="min-w-0 leading-none">
                <p className="font-display truncate text-base font-semibold">Max<span className="text-cyan">Flix</span></p>
                <p className="mt-1 text-[11px] tracking-wide text-mist">Gestão de clientes IPTV</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setFormError(null); setEditing(null); setFormOpen(true); }}
                className="font-display rounded-xl bg-cyan px-3 py-2 text-sm font-semibold text-background ring-1 ring-cyan/40 hover:brightness-110"
              >
                + Novo cliente
              </button>
              <button
                onClick={toggleFinancials}
                className={`grid size-9 shrink-0 place-items-center rounded-xl ring-1 ${financialsHidden ? "bg-cyan/15 text-cyan ring-cyan/30" : "bg-panel text-mist ring-line hover:text-frost"}`}
                aria-label={financialsHidden ? "Mostrar valores financeiros" : "Ocultar valores financeiros"}
                title={financialsHidden ? "Mostrar valores" : "Ocultar valores"}
              >
                {financialsHidden ? <EyeOffIcon /> : <EyeIcon />}
              </button>
              <button
                onClick={signOut}
                className="font-display rounded-xl bg-panel px-3 py-2 text-sm font-medium text-mist ring-1 ring-line hover:text-danger"
              >
                Sair
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-3 rounded-2xl bg-panel/40 p-3 ring-1 ring-line/60 lg:flex-row lg:items-center lg:justify-between">
            <nav aria-label="Navegação e relatórios" className="flex flex-wrap items-center gap-2">
              <Button asChild variant="outline" className="h-9 border-line bg-panel text-cyan hover:bg-panel2 hover:text-cyan">
                <Link to="/revendedores">Revendedores</Link>
              </Button>
              <Button asChild variant="outline" className="h-9 border-line bg-panel text-cyan hover:bg-panel2 hover:text-cyan">
                <Link to="/creditos">Créditos</Link>
              </Button>
              <Button asChild variant="outline" className="h-9 border-line bg-panel text-cyan hover:bg-panel2 hover:text-cyan">
                <Link to="/comunicacao">Comunicação</Link>
              </Button>
              <Button asChild variant="outline" className="h-9 border-line bg-panel text-cyan hover:bg-panel2 hover:text-cyan">
                <Link to="/marketing">✨ Marketing IA</Link>
              </Button>
              <Button asChild variant="outline" className="h-9 border-line bg-panel text-cyan hover:bg-panel2 hover:text-cyan">
                <Link to="/recuperacao">♻ Recuperação</Link>
              </Button>
              <Button onClick={() => { setReferralClient(null); setReferralsOpen(true); }}
                variant="outline" className="h-9 border-line bg-panel text-cyan hover:bg-panel2 hover:text-cyan">
                🎁 Indicações
              </Button>
              <button onClick={() => setForecastOpen(true)} className="font-display rounded-xl bg-panel px-3 py-2 text-sm font-medium text-cyan ring-1 ring-cyan/30 hover:bg-cyan/10">
                Previsão de lucro
              </button>
              <button onClick={() => setServerReportOpen(true)} className="font-display rounded-xl bg-panel px-3 py-2 text-sm font-medium text-cyan ring-1 ring-cyan/30 hover:bg-cyan/10">
                Servidores
              </button>
            </nav>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <label className="flex min-w-[180px] flex-1 items-center gap-2 rounded-xl bg-panel px-3 py-2 ring-1 ring-line lg:max-w-[235px]" aria-label="Buscar cliente">
                <span className="text-mist">⌕</span>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="min-w-0 w-full bg-transparent text-sm text-frost outline-none placeholder:text-mist/60"
                  placeholder="Buscar cliente"
                />
              </label>
              <button onClick={() => setSettingsOpen(true)} className="font-display rounded-xl bg-panel px-3 py-2 text-sm font-medium text-mist ring-1 ring-line hover:bg-frost/5">
                Mensagem
              </button>
              <button onClick={() => setImportOpen(true)} className="font-display rounded-xl bg-panel px-3 py-2 text-sm font-medium text-mist ring-1 ring-line hover:bg-frost/5">
                Importar
              </button>
            </div>
          </div>
        </header>

        <section className="mt-6 grid grid-cols-2 gap-3 sm:mt-8 sm:grid-cols-3 lg:grid-cols-6">
          <MetricCard label="Clientes" value={String(summary.total)} hint="total cadastrado" />
          <MetricCard
            label="Ativos"
            value={String(summary.ativos)}
            hint="todos não vencidos"
            valueClass="text-ok"
          />
          <MetricCard
            label="Vencidos"
            value={String(summary.vencidos)}
            hint="exigem ação"
            valueClass="text-danger"
            cardClass="bg-danger/10 ring-danger/40"
            labelClass="text-danger/80"
            hintClass="text-danger/70"
          />
          <MetricCard
            label="Vence hoje"
            value={String(summary.hoje)}
            hint="renovar agora"
            valueClass="text-today"
            cardClass="bg-today/10 ring-today/40"
            labelClass="text-today/90"
            hintClass="text-today/70"
          />
          <MetricCard
            label="Próx. 5 dias"
            value={String(summary.proximos)}
            hint="janela de cobrança"
            valueClass="text-warn"
          />
          <MetricCard
            label="Lucro total"
            value={money(summary.lucro)}
            hint="clientes não vencidos"
            valueClass="text-cyan text-[clamp(0.75rem,12cqi,1.5rem)]"
            cardClass="bg-cyan/10 ring-cyan/40"
            labelClass="text-cyan/80"
            hintClass="text-cyan/70"
          />
        </section>

        <section className="mt-4 rounded-2xl bg-panel/60 p-3 ring-1 ring-line sm:mt-5" aria-label="Resumo de créditos dos servidores">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-sm font-semibold text-frost">Estoque de créditos</h2>
            <Link to="/creditos" className="text-xs font-semibold text-cyan hover:underline">Ver detalhes →</Link>
          </div>
          {stockLoading ? (
            <p className="py-2 text-xs text-mist">Consultando saldos dos servidores…</p>
          ) : stockError ? (
            <p role="alert" className="py-2 text-xs text-warn">Não foi possível carregar os saldos. Abra Créditos para conferir.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 min-[360px]:grid-cols-3 md:grid-cols-5 xl:grid-cols-9" aria-label="Saldos resumidos por servidor">
              {stockOverview.map((row) => (
                <Link
                  key={row.name}
                  to="/creditos"
                  search={{ servidor: row.name }}
                  aria-label={`${row.label}: ${row.configured ? `${row.balance} créditos` : "saldo não informado"}, ${row.totalClients} ${row.totalClients === 1 ? "cliente" : "clientes"}`}
                  className={`flex min-h-[92px] min-w-0 flex-col gap-1 rounded-xl px-2.5 py-2.5 ring-1 transition-colors hover:bg-frost/5 sm:px-3 ${row.lowStock ? "bg-warn/5 ring-warn/40" : "bg-background/70 ring-line"}`}
                >
                  <span className="truncate text-[11px] font-medium text-mist" title={row.label}>{row.name === "Uniplay" ? "Uni / P2P" : row.label}</span>
                  <span className={`font-display text-lg font-semibold leading-tight sm:text-xl ${!row.configured ? "text-mist" : row.lowStock ? "text-warn" : "text-cyan"}`}>
                    {row.configured ? row.balance : "—"}
                    <span className="ml-1 text-[10px] font-normal text-mist">créd.</span>
                  </span>
                  <span className={`text-[10px] leading-tight ${row.shortageFive > 0 ? "font-semibold text-warn" : "text-mist"}`}>
                    {!row.configured ? "Informar saldo" : row.shortageFive > 0 ? `Faltam ${row.shortageFive} em 5 dias` : `${row.totalClients} ${row.totalClients === 1 ? "cliente" : "clientes"}`}
                  </span>
                </Link>
              ))}
            </div>
          )}
          {!stockLoading && !stockError && stockOverview.some((row) => row.shortageFive > 0) && (
            <p className="mt-1 text-[11px] text-mist">
              Previsão baseada nos vencimentos dos próximos 5 dias; créditos só são descontados nas renovações.
            </p>
          )}
        </section>

        <section className="mt-6 flex flex-wrap items-center gap-2 sm:mt-8">
          <nav className="flex flex-wrap items-center gap-1 rounded-xl bg-panel p-1 ring-1 ring-line">
            {tabs.map((t) => (
              <button key={t.key} onClick={() => setTab(t.key)} className={tabBtn(tab === t.key)}>
                {t.label}
              </button>
            ))}
          </nav>
          <div className="flex min-w-0 flex-wrap items-center gap-2 sm:ml-auto">
            <Select value={serverFilter} onValueChange={setServerFilter}>
              <SelectTrigger
                aria-label="Filtrar clientes por servidor"
                className="h-10 w-[175px] max-w-full rounded-xl border-0 bg-panel px-3 text-sm font-medium text-mist ring-1 ring-line hover:bg-panel2"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-line bg-panel2 text-frost shadow-lg">
                <SelectItem value="todos">Todos os servidores</SelectItem>
                {SERVERS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            {tab === "breve" && (
              <>
                <span className="hidden text-xs text-mist sm:inline">Vence em</span>
                <div className="flex items-center gap-1 rounded-xl bg-panel p-1 ring-1 ring-line">
                  {[1, 2, 3, 4, 5].map((d) => (
                    <button
                      key={d}
                      onClick={() => setRange(d)}
                      className={`font-display rounded-lg px-2.5 py-1 text-sm font-medium ${
                        range === d
                          ? "bg-cyan/15 text-cyan ring-1 ring-cyan/30"
                          : "text-mist hover:bg-frost/5"
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </>
            )}
            <div className="flex min-w-0 items-center gap-2">
              <span className="hidden whitespace-nowrap text-sm text-mist sm:inline">Ordenar por</span>
              <Select value={sortMode} onValueChange={(value) => setSortMode(value as ClientSortMode)}>
                <SelectTrigger
                  aria-label="Ordenar clientes"
                  className="h-10 w-[165px] max-w-full rounded-xl border-0 bg-panel px-3 text-sm font-medium text-frost ring-1 ring-line hover:bg-panel2"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-line bg-panel2 text-frost shadow-lg">
                  <SelectItem value="vencimento-asc">Vencimento ↑</SelectItem>
                  <SelectItem value="vencimento-desc">Vencimento ↓</SelectItem>
                  <SelectItem value="login-asc">Login A–Z</SelectItem>
                  <SelectItem value="login-desc">Login Z–A</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <button
              onClick={exportCSV}
              className="font-display rounded-xl bg-panel px-3 py-2 text-sm font-medium text-mist ring-1 ring-line hover:bg-frost/5"
            >
              Exportar CSV
            </button>
          </div>
        </section>

        <div id="maxflix-client-results" className="scroll-mt-4" aria-live="polite">
          {!clientsQuery.isLoading && (
            <p className="mt-4 text-xs text-mist">
              {paginated.count === 0
                ? "Nenhum cliente encontrado com os filtros atuais."
                : `Exibindo ${paginated.first}–${paginated.last} de ${paginated.count} clientes · 25 por página`}
            </p>
          )}
        </div>

        {notice && (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-cyan/10 px-3 py-2 text-sm text-cyan ring-1 ring-cyan/30">
            <span>{notice}</span>
            <button onClick={() => setNotice(null)} className="text-xs text-cyan/70">
              fechar
            </button>
          </div>
        )}

        {clientsQuery.isLoading ? (
          <p className="mt-6 text-sm text-mist">Carregando clientes…</p>
        ) : filtered.length === 0 ? (
          <p className="mt-6 rounded-xl bg-panel/60 px-4 py-6 text-center text-sm text-mist ring-1 ring-line">
            Nenhum cliente nesta visualização.
          </p>
        ) : (
          <>
            <section className="mt-4 space-y-3" aria-label="Clientes em cartões">
              {paginated.rows.map((c) => {
                const status = getStatus(c);
                return (
                  <div
                    key={c.id}
                    className={`min-w-0 rounded-2xl p-4 ring-1 sm:p-5 xl:grid xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,0.85fr)] xl:items-center xl:gap-5 ${
                      status.key === "vencido"
                        ? "bg-danger/10 ring-danger/40"
                        : "bg-panel/70 ring-line"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-display break-words text-base font-semibold sm:text-lg">{c.name}</p>
                        <p className="truncate text-xs text-mist">
                          {c.login} · {c.server}
                        </p>
                      </div>
                      <StatusBadge status={status} />
                    </div>
                    <p className="mt-2 text-xs text-mist">
                      Vence: <span className="font-medium text-frost">{formatDate(c.due_date)}</span>
                      {c.financial_due_date && c.financial_due_date !== c.due_date && (
                        <span> · Financeiro: {formatDate(c.financial_due_date)}</span>
                      )}
                    </p>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-background/40 p-3 sm:p-4 xl:mt-0">
                      <div className="min-w-0">
                        <p className="text-[11px] text-mist">Pago</p>
                        <p className="mt-1 break-words text-sm font-semibold sm:text-base">{money(c.paid)}</p>
                      </div>
                      <div className="min-w-0">
                        <p className="text-[11px] text-mist">Custo</p>
                        <p className="mt-1 break-words text-sm font-medium sm:text-base">{money(c.cost)}</p>
                      </div>
                      <div className="min-w-0">
                        <p className="text-[11px] text-mist">Lucro</p>
                        <p className={`mt-1 break-words text-sm font-semibold sm:text-base ${c.paid - c.cost >= 0 ? "text-ok" : "text-danger"}`}>
                          {money(c.paid - c.cost)}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex items-stretch gap-2 xl:mt-0">
                      <button
                        type="button"
                        onClick={() => renew(c)}
                        className="font-display flex min-h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl bg-cyan/15 px-2 text-sm font-semibold text-cyan ring-1 ring-cyan/30 hover:bg-cyan/25"
                      >
                        <RefreshCw size={15} aria-hidden="true" /> Renovar
                      </button>
                      <a
                        href={renewalMessageLink(c, template, overdueTemplate)}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Enviar renovação pelo WhatsApp para ${c.name}`}
                        className="font-display flex min-h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl bg-panel2 px-2 text-center text-sm font-medium text-frost ring-1 ring-line hover:bg-frost/5"
                      >
                        <MessageCircle size={17} aria-hidden="true" /> WhatsApp
                      </a>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            aria-label={`Mais ações para ${c.name}`}
                            title="Editar ou excluir"
                            className="grid size-11 shrink-0 place-items-center rounded-xl bg-panel2 text-mist ring-1 ring-line hover:text-frost"
                          >
                            <MoreHorizontal size={20} aria-hidden="true" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" sideOffset={5} className="min-w-[170px] border-line bg-panel2 text-frost">
                          <DropdownMenuItem onSelect={() => { setFormError(null); setEditing(c); setFormOpen(true); }}>
                            Editar cliente
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => { setReferralClient(c); setReferralsOpen(true); }}>
                            🎁 Indicações e pontos
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => deleteMutation.mutate(c.id)} className="text-danger focus:bg-danger/10 focus:text-danger">
                            Excluir cliente
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                );
              })}
            </section>
            {paginated.totalPages > 1 && (
              <nav aria-label="Páginas de clientes" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-panel/70 px-3 py-3 ring-1 ring-line">
                <p className="text-xs text-mist">
                  Exibindo {paginated.first}–{paginated.last} de {paginated.count} clientes
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={paginated.page <= 1}
                    onClick={() => changePage(paginated.page - 1)}
                    className="min-h-10 rounded-lg bg-panel2 px-3 text-sm font-medium text-frost ring-1 ring-line hover:bg-frost/5 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    ← Anterior
                  </button>
                  <div className="flex items-center gap-1.5 text-xs text-mist">
                    Página
                    <Select value={String(paginated.page)} onValueChange={(value) => changePage(Number(value))}>
                      <SelectTrigger aria-label="Selecionar página de clientes" className="h-10 w-[66px] rounded-lg border-0 bg-panel2 px-2 text-sm text-frost ring-1 ring-line">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="border-line bg-panel2 text-frost shadow-lg">
                        {Array.from({ length: paginated.totalPages }, (_, index) => index + 1).map((pageNumber) => (
                          <SelectItem key={pageNumber} value={String(pageNumber)}>{pageNumber}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    de {paginated.totalPages}
                  </div>
                  <button
                    type="button"
                    disabled={paginated.page >= paginated.totalPages}
                    onClick={() => changePage(paginated.page + 1)}
                    className="min-h-10 rounded-lg bg-panel2 px-3 text-sm font-medium text-frost ring-1 ring-line hover:bg-frost/5 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Próxima →
                  </button>
                </div>
              </nav>
            )}
          </>
        )}

        {monthlyBilling.length > 0 && (
          <section className="mt-8 rounded-2xl bg-panel/60 p-5 ring-1 ring-line backdrop-blur-sm">
            <h2 className="font-display text-base font-semibold">Faturamento por mês</h2>
            <p className="mt-1 text-xs text-mist">Renovações registradas no painel.</p>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {monthlyBilling.map((m) => (
                <div key={m.month} className="rounded-xl bg-panel p-4 ring-1 ring-line">
                  <p className="text-[11px] tracking-wide text-mist uppercase">
                    {monthLabel(m.month)}
                  </p>
                  <p className="font-display mt-2 text-lg leading-none font-semibold text-cyan">
                    {money(m.faturado)}
                  </p>
                  <p className="mt-2 text-xs text-mist">
                    {m.count} renovações · lucro{" "}
                    <span className={m.lucro >= 0 ? "text-ok" : "text-danger"}>
                      {money(m.lucro)}
                    </span>
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {referralsOpen && (
        <ReferralPanel
          clients={clients}
          initialClient={referralClient}
          onClose={() => { setReferralsOpen(false); setReferralClient(null); }}
          onUseFreeMonth={useReferralMonth}
        />
      )}
      {formOpen && (
        <ClientForm
          client={editing}
          clients={clients}
          saveError={formError}
          saving={saveMutation.isPending}
          onCancel={() => {
            setFormOpen(false);
            setEditing(null);
          }}
          onSave={(draft) => saveMutation.mutate({ draft, id: editing?.id ?? null })}
        />
      )}

      {importOpen && (
        <ImportDialog
          saving={importMutation.isPending}
          financialsHidden={financialsHidden}
          onClose={() => setImportOpen(false)}
          onImport={(rows) => importMutation.mutate(rows)}
        />
      )}

      {settingsOpen && (
        <TemplateDialog
          value={{ regular: template, overdue: overdueTemplate }}
          onClose={() => setSettingsOpen(false)}
          onSave={async (value) => {
            const { error } = await supabase.from("settings").update({ whatsapp_template: value.regular, overdue_whatsapp_template: value.overdue }).eq("id", "default");
            if (error) throw error;
            await qc.invalidateQueries({ queryKey: ["settings"] });
            setSettingsOpen(false);
          }}
        />
      )}

      {renewing && (
        <RenewDialog
          client={renewing}
          saving={renewingBusy}
          onCancel={() => setRenewing(null)}
          onConfirm={(opts) => confirmRenew(renewing, opts)}
        />
      )}

      {forecastOpen && (
        <ForecastDialog entries={forecastEntries} financialsHidden={financialsHidden} onClose={() => setForecastOpen(false)} />
      )}

      {serverReportOpen && (
        <ServerReportDialog report={serverReport} financialsHidden={financialsHidden} onClose={() => setServerReportOpen(false)} />
      )}
    </div>
  );
}

function ServerReportDialog({ report, financialsHidden, onClose }: { report: Array<{
  server: string;
  total: number;
  active: number;
  expired: number;
  today: Client[];
  fiveDays: Client[];
  tenDays: Client[];
}>; financialsHidden: boolean; onClose: () => void }) {
  const [period, setPeriod] = useState<ServerPeriod>(5);
  const periods: { value: ServerPeriod; label: string }[] = [
    { value: 0, label: "Hoje" },
    { value: 5, label: "Até 5 dias" },
    { value: 10, label: "Até 10 dias" },
  ];
  const selectedClients = (item: (typeof report)[number]) =>
    period === 0 ? item.today : period === 5 ? item.fiveDays : item.tenDays;
  const money = (value: number) => financialsHidden ? "••••••" : formatBRL(value);
  const orderedReport = useMemo(
    () =>
      [...report].sort((a, b) => {
        const renewalDifference = selectedClients(b).length - selectedClients(a).length;
        return renewalDifference || a.server.localeCompare(b.server, "pt-BR");
      }),
    [period, report],
  );

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-background/85 p-4 backdrop-blur-sm">
      <section className="mx-auto my-6 max-w-4xl rounded-2xl bg-panel2/95 p-5 ring-1 ring-line sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-semibold">Renovações por servidor</h2>
            <p className="mt-1 text-sm text-mist">Quantidade de clientes e vencimentos calculados com os dados atuais.</p>
          </div>
          <button onClick={onClose} aria-label="Fechar relatório" className="grid size-9 shrink-0 place-items-center rounded-xl bg-panel text-lg text-mist ring-1 ring-line">×</button>
        </div>

        <div className="mt-5 flex rounded-xl bg-panel p-1 ring-1 ring-line">
          {periods.map((item) => <button key={item.value} onClick={() => setPeriod(item.value)} className={`flex-1 rounded-lg px-2 py-2 text-xs font-medium sm:text-sm ${period === item.value ? "bg-cyan/15 text-cyan" : "text-mist"}`}>{item.label}</button>)}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {orderedReport.map((item, index) => {
            const renewals = selectedClients(item);
            const revenue = renewals.reduce((sum, client) => sum + (isPackageCovered(client) ? 0 : client.paid), 0);
            const cost = renewals.reduce((sum, client) => sum + client.cost, 0);
            const ranked = index < 3 && renewals.length > 0;
            return (
              <article key={item.server} className={`rounded-xl p-4 ring-1 ${ranked ? "bg-cyan/10 ring-cyan/40" : "bg-panel ring-line"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      {ranked && <span className="grid size-5 shrink-0 place-items-center rounded-full bg-cyan text-[10px] font-bold text-background">{index + 1}</span>}
                      <h3 className="font-display font-semibold">{item.server}</h3>
                    </div>
                    <p className="mt-1 text-xs text-mist">{item.total} clientes · {item.active} ativos · {item.expired} vencidos</p>
                  </div>
                  <span className="font-display text-2xl font-semibold text-cyan">{renewals.length}</span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-3 text-xs">
                  <div><p className="text-mist">Receita</p><p className="mt-1">{money(revenue)}</p></div>
                  <div><p className="text-mist">Custo</p><p className="mt-1">{money(cost)}</p></div>
                  <div><p className="text-mist">Lucro</p><p className={`mt-1 ${revenue - cost >= 0 ? "text-ok" : "text-danger"}`}>{money(revenue - cost)}</p></div>
                </div>
                {renewals.length > 0 && <details className="mt-3"><summary className="cursor-pointer text-xs text-cyan">Ver clientes</summary><div className="mt-2 space-y-1">{renewals.map((client) => <button key={client.id} onClick={() => { onClose(); }} className="flex w-full items-center justify-between rounded-lg bg-panel2 px-3 py-2 text-left text-xs"><span className="truncate">{client.name}</span><span className="shrink-0 text-mist">{formatDate(client.due_date)}</span></button>)}</div></details>}
              </article>
            );
          })}
        </div>
        {report.length === 0 && <p className="py-10 text-center text-sm text-mist">Nenhum servidor com clientes cadastrados.</p>}
      </section>
    </div>
  );
}

function ForecastDialog({ entries, financialsHidden, onClose }: { entries: ForecastEntry[]; financialsHidden: boolean; onClose: () => void }) {
  const [period, setPeriod] = useState<ForecastPeriod>(5);
  const periods: { days: ForecastPeriod; label: string }[] = [
    { days: 0, label: "Hoje" },
    { days: 5, label: "Até 5 dias" },
    { days: 10, label: "Até 10 dias" },
  ];

  const summarize = (days: ForecastPeriod) => {
    const selected = entries.filter((entry) => entry.days <= days);
    return selected.reduce(
      (total, entry) => ({
        count: total.count + 1,
        revenue: total.revenue + entry.revenue,
        cost: total.cost + entry.cost,
        profit: total.profit + entry.profit,
      }),
      { count: 0, revenue: 0, cost: 0, profit: 0 },
    );
  };

  const selectedEntries = entries.filter((entry) => entry.days <= period);
  const money = (value: number) => financialsHidden ? "••••••" : formatBRL(value);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-background/85 p-4 backdrop-blur-sm">
      <section className="mx-auto my-6 max-w-4xl rounded-2xl bg-panel2/95 p-5 ring-1 ring-line sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-semibold">Previsão de lucro</h2>
            <p className="mt-1 text-sm text-mist">Renovações previstas a partir de hoje.</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Fechar previsão"
            className="grid size-9 shrink-0 place-items-center rounded-xl bg-panel text-lg text-mist ring-1 ring-line hover:text-frost"
          >
            ×
          </button>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {periods.map((item) => {
            const total = summarize(item.days);
            const active = period === item.days;
            return (
              <button
                key={item.days}
                onClick={() => setPeriod(item.days)}
                className={`rounded-xl p-4 text-left ring-1 ${
                  active ? "bg-cyan/10 ring-cyan/40" : "bg-panel ring-line hover:bg-frost/5"
                }`}
              >
                <span className="text-[11px] tracking-wide text-mist uppercase">{item.label}</span>
                <span className={`font-display mt-2 block text-2xl font-semibold ${total.profit >= 0 ? "text-ok" : "text-danger"}`}>
                  {money(total.profit)}
                </span>
                <span className="mt-2 block text-xs text-mist">{total.count} clientes previstos</span>
                <span className="mt-1 block text-xs text-mist">
                  Receita {money(total.revenue)} · custo {money(total.cost)}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-5 overflow-hidden rounded-xl bg-panel ring-1 ring-line">
          <div className="border-b border-line px-4 py-3">
            <h3 className="font-display text-sm font-semibold">
              Clientes — {periods.find((item) => item.days === period)?.label}
            </h3>
          </div>
          {selectedEntries.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-mist">Nenhuma renovação prevista neste período.</p>
          ) : (
            <div className="max-h-[46vh] overflow-y-auto">
              {selectedEntries.map((entry) => (
                <div
                  key={entry.client.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-line/70 px-4 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_110px_110px_110px] sm:items-center"
                >
                  <div className="min-w-0">
                    <p className="font-display truncate text-sm font-medium">{entry.client.name}</p>
                    <p className="mt-0.5 truncate text-xs text-mist">
                      {entry.client.server} · {formatDate(entry.client.due_date)}
                      {entry.days === 0 ? " · hoje" : ` · em ${entry.days} ${entry.days === 1 ? "dia" : "dias"}`}
                    </p>
                    {entry.packageCovered && (
                      <p className="mt-1 text-xs text-warn">Pacote pago: receita zerada, custo mantido</p>
                    )}
                  </div>
                  <div className="text-right sm:text-left">
                    <p className="text-[10px] text-mist uppercase sm:hidden">Lucro</p>
                    <p className={entry.profit >= 0 ? "text-sm font-medium text-ok" : "text-sm font-medium text-danger"}>
                      {money(entry.profit)}
                    </p>
                  </div>
                  <div className="hidden sm:block">
                    <p className="text-[10px] text-mist uppercase">Receita</p>
                    <p className="mt-1 text-sm">{money(entry.revenue)}</p>
                  </div>
                  <div className="hidden sm:block">
                    <p className="text-[10px] text-mist uppercase">Custo</p>
                    <p className="mt-1 text-sm">{money(entry.cost)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <p className="mt-4 text-xs leading-relaxed text-mist">
          Os períodos são acumulados. Clientes com pacote já pago entram com receita zerada e mantêm o custo do servidor.
        </p>
      </section>
    </div>
  );
}

function EyeIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="2.75" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="m3 3 18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-2.1 2.8M6.2 6.2C3.8 8 2.5 12 2.5 12s3.5 6 9.5 6a9 9 0 0 0 3.1-.5M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  );
}

function MetricCard({
  label,
  value,
  hint,
  valueClass = "text-frost",
  cardClass = "bg-panel ring-line",
  labelClass = "text-mist",
  hintClass = "text-mist",
}: {
  label: string;
  value: string;
  hint: string;
  valueClass?: string;
  cardClass?: string;
  labelClass?: string;
  hintClass?: string;
}) {
  return (
    <div className={`@container min-w-0 rounded-xl p-4 ring-1 ${cardClass}`}>
      <p className={`text-[11px] tracking-wide uppercase ${labelClass}`}>{label}</p>
      <p className={`font-display mt-2 min-w-0 text-3xl leading-none font-semibold [overflow-wrap:anywhere] ${valueClass}`}>
        {value}
      </p>
      <p className={`mt-2 text-xs ${hintClass}`}>{hint}</p>
    </div>
  );
}

function TemplateDialog({
  value,
  onClose,
  onSave,
}: {
  value: { regular: string; overdue: string };
  onClose: () => void;
  onSave: (value: { regular: string; overdue: string }) => Promise<void>;
}) {
  const [text, setText] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setSaving(true);
    setError("");
    try {
      await onSave(text);
    } catch {
      setError("Não foi possível salvar as mensagens. Tente novamente.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-background/80 p-4 backdrop-blur-sm">
      <section role="dialog" aria-modal="true" aria-label="Mensagens do WhatsApp" className="mx-auto mt-10 max-w-xl rounded-2xl bg-panel2/90 p-6 ring-1 ring-line">
        <h2 className="font-display text-xl font-semibold">Mensagens do WhatsApp</h2>
        <p className="mt-1 text-sm text-mist">
          Use {"{nome}"}, {"{login}"}, {"{servidor}"}, {"{vencimento}"} e {"{valor}"} para preencher
          automaticamente.
        </p>
        <label htmlFor="regular-message" className="mt-5 block text-sm font-medium text-frost">Renovação</label>
        <textarea
          id="regular-message"
          value={text.regular}
          maxLength={1000}
          onChange={(e) => setText((current) => ({ ...current, regular: e.target.value }))}
          rows={6}
          className="mt-2 w-full rounded-xl bg-panel px-3 py-2.5 text-sm text-frost ring-1 ring-line outline-none focus:ring-cyan/50"
        />
        <label htmlFor="overdue-message" className="mt-5 block text-sm font-medium text-frost">Clientes vencidos</label>
        <textarea
          id="overdue-message"
          value={text.overdue}
          maxLength={1000}
          onChange={(e) => setText((current) => ({ ...current, overdue: e.target.value }))}
          rows={8}
          className="mt-2 w-full rounded-xl bg-panel px-3 py-2.5 text-sm text-frost ring-1 ring-line outline-none focus:ring-cyan/50"
        />
        {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
        <div className="mt-4 flex gap-3">
          <Button
            onClick={save}
            disabled={saving}
            className="font-display rounded-xl bg-cyan px-4 py-2.5 text-sm font-semibold text-background ring-1 ring-cyan/40"
          >
            {saving ? "Salvando..." : "Salvar mensagens"}
          </Button>
          <Button
            onClick={onClose}
            variant="outline"
            className="font-display rounded-xl border-line bg-panel px-4 py-2.5 text-sm font-medium text-mist"
          >
            Cancelar
          </Button>
        </div>
      </section>
    </div>
  );
}

function RenewDialog({
  client,
  saving,
  onCancel,
  onConfirm,
}: {
  client: Client;
  saving: boolean;
  onCancel: () => void;
  onConfirm: (opts: {
    months: number;
    cost: number;
    paid: number;
    monthlyCost: number;
    monthlyPaid: number;
  }) => void | Promise<void>;
}) {
  const defaultCost = client.cost || client.prev_cost || SERVER_COSTS[client.server] || 0;
  const defaultPaid = client.paid || client.prev_paid || 0;
  const [months, setMonths] = useState(1);
  const [cost, setCost] = useState(String(defaultCost).replace(".", ","));
  const [paid, setPaid] = useState(String(defaultPaid).replace(".", ","));

  const monthlyCost = num(cost);
  const paidValue = num(paid);
  const validMonths = Number.isInteger(months) && months >= 1 && months <= 120;
  const totalCost = monthlyCost * (validMonths ? months : 0);
  const monthlyPaid = months > 1 ? 0 : paidValue;
  const { dueDate: newDue, financialDueDate } = renewalDates(client.due_date, validMonths ? months : 1);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-background/80 p-4 backdrop-blur-sm">
      <section className="mx-auto mt-10 max-w-md rounded-2xl bg-panel2/90 p-6 ring-1 ring-line">
        <h2 className="font-display text-xl font-semibold">Renovar {client.name}</h2>
        <p className="mt-1 text-sm text-mist">
          Novo vencimento em {formatDate(newDue)} · servidor {client.server}
        </p>

        <label htmlFor="paid-months" className="mt-5 block text-xs tracking-wide text-mist uppercase">Meses pagos</label>
        <div className="mt-2 flex gap-2">
          {[1, 2, 3, 6, 12].map((m) => (
            <Button
              key={m}
              type="button"
              variant="outline"
              onClick={() => setMonths(m)}
              className={`font-display min-w-0 flex-1 rounded-xl px-1 py-2 text-sm font-medium ring-1 ${
                months === m
                  ? "bg-cyan/15 text-cyan ring-cyan/30"
                  : "bg-panel text-mist ring-line hover:bg-frost/5"
              }`}
            >
              {m}
            </Button>
          ))}
        </div>
        <input
          id="paid-months"
          type="number"
          min={1}
          max={120}
          step={1}
          value={months}
          onChange={(event) => {
            const value = Number(event.target.value);
            setMonths(value);
          }}
          className="mt-3 w-full rounded-xl bg-panel px-3 py-2.5 text-sm text-frost ring-1 ring-line outline-none focus:ring-cyan/50"
        />
        <p className="mt-2 text-xs text-mist">{validMonths ? `Financeiro até ${formatDate(financialDueDate)}` : "Informe de 1 a 120 meses."}</p>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs tracking-wide text-mist uppercase">
              Custo do crédito (mês)
            </label>
            <input
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              inputMode="decimal"
              className="mt-2 w-full rounded-xl bg-panel px-3 py-2.5 text-sm text-frost ring-1 ring-line outline-none focus:ring-cyan/50"
            />
          </div>
          <div>
            <label className="block text-xs tracking-wide text-mist uppercase">
              {months > 1 ? "Valor do pacote" : "Valor pago"}
            </label>
            <input
              value={paid}
              onChange={(e) => setPaid(e.target.value)}
              inputMode="decimal"
              className="mt-2 w-full rounded-xl bg-panel px-3 py-2.5 text-sm text-frost ring-1 ring-line outline-none focus:ring-cyan/50"
            />
          </div>
        </div>

        <div className="mt-4 rounded-xl bg-panel p-4 text-sm ring-1 ring-line">
          {months > 1 ? (
            <p className="text-mist">
              O valor de <span className="text-frost">{formatBRL(paidValue)}</span> entra uma vez no
              faturamento. Nos {months - 1} meses seguintes o valor pago fica R$ 0,00 e só o custo do
              crédito ({formatBRL(monthlyCost)}/mês) é descontado.
            </p>
          ) : (
            <p className="text-mist">
              Lucro do mês:{" "}
              <span className={paidValue - monthlyCost >= 0 ? "text-ok" : "text-danger"}>
                {formatBRL(paidValue - monthlyCost)}
              </span>
            </p>
          )}
        </div>

        <div className="mt-5 flex gap-3">
          <Button
            type="button"
            disabled={!validMonths || saving}
            onClick={() =>
              onConfirm({ months, cost: totalCost, paid: paidValue, monthlyCost, monthlyPaid })
            }
            className="font-display rounded-xl bg-cyan px-4 py-2.5 text-sm font-semibold text-background ring-1 ring-cyan/40"
          >
            {saving ? "Renovando…" : "Confirmar renovação"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={onCancel}
            className="font-display rounded-xl bg-panel px-4 py-2.5 text-sm font-medium text-mist ring-1 ring-line"
          >
            Cancelar
          </Button>
        </div>
      </section>
    </div>
  );
}
