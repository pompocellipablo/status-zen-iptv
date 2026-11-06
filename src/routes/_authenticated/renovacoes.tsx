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
import { panelRouteForClient } from "@/lib/painel-recarga";
import { sortClients, type ClientSortMode } from "@/lib/client-sort";
import { MessageCircle, MoreHorizontal, RefreshCw, Search } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMaxFlixNavigationAction } from "@/components/MaxFlixAppShell";
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

// Disabled by default. Enabling this UI alone does NOT enable real provider
// renewals; the Edge Function has a separate server-side safety switch.
const PANEL_PILOT_UI_ENABLED = import.meta.env["VITE_MAXFLIX_PANEL_PILOT"] === "true";
// Non-secret, build-time UI configuration. Backend independently checks
// PAINEL_RECARGA_PILOT_CLIENT_ID + PAINEL_RECARGA_PILOT_EXPECTED_DUE_DATE.
type PanelPilotTarget={clientId:string;expectedDueDate:string;server:string};
// UX-only allowlist obtained once from the owner-authorized Edge Function.
// The private backend validates the same list independently on every renewal.
const isPilotTarget=(client:Client,targets:readonly PanelPilotTarget[])=>
  PANEL_PILOT_UI_ENABLED&&targets.some(item=>
    item.clientId===client.id&&item.expectedDueDate===client.due_date
    &&item.server===client.server);

export const Route = createFileRoute("/_authenticated/renovacoes")({
  validateSearch: (search: Record<string, unknown>): { tab: Tab; access?: string; server?: string } => {
    const allowed: Tab[] = ["todos", "cadastrados", "vencidos", "hoje", "breve", "cobranca"];
    const tab = allowed.includes(search["tab"] as Tab) ? search["tab"] as Tab : "hoje";
    const allowedAccess = ["padrao", "pacote_pago", "gratuidade", "meu_acesso", "gratuitos"];
    return {tab, ...(allowedAccess.includes(search["access"] as string) ? {access:search["access"] as string} : {}), ...(typeof search["server"] === "string" && search["server"].length <= 100 ? {server:search["server"]} : {})};
  },
  head: () => ({
    meta: [
      { title: "MaxFlix — Renovações e clientes" },

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

type Tab = "todos" | "cadastrados" | "vencidos" | "hoje" | "breve" | "cobranca";

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
  const {tab: selectedTab,access: selectedAccess,server: selectedServer} = Route.useSearch();
  const { pendingAction, clearPendingAction } = useMaxFlixNavigationAction();
  const [tab, setTab] = useState<Tab>(selectedTab);
  useEffect(() => { setTab(selectedTab); }, [selectedTab]);
  const [range, setRange] = useState(0);
  const [search, setSearch] = useState("");
  const [serverFilter, setServerFilter] = useState(selectedServer ?? "todos");
  useEffect(() => setServerFilter(selectedServer ?? "todos"), [selectedServer]);
  const [accessFilter, setAccessFilter] = useState(selectedAccess ?? "todos");
  useEffect(() => setAccessFilter(selectedAccess ?? "todos"),[selectedAccess]);
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

  // The persistent navigation drawer can open home-only tools from other pages.
  useEffect(() => {
    if (!pendingAction) return;
    clearPendingAction();
    switch (pendingAction) {
      case "pontos":
        setReferralClient(null);
        setReferralsOpen(true);
        break;
      case "mensagem":
        setSettingsOpen(true);
        break;
      case "importar":
        setImportOpen(true);
        break;
      case "previsao":
        setForecastOpen(true);
        break;
      case "servidores":
        setServerReportOpen(true);
        break;
    }
  }, [pendingAction, clearPendingAction]);

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

  const boxLinkedClientsQuery = useQuery({
    queryKey: ["box-linked-client-ids"],
    queryFn: async () => {
      const { data, error } = await supabase.from("box_sale_clients").select("client_id");
      if (error) throw error;
      return new Set((data ?? []).map(item => item.client_id));
    },
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

  // This monitor is completely inactive unless an owner explicitly enables
  // the supervised provider pilot UI. It is read-only; no provider calls.
  const pilotTargetsQuery=useQuery({
    queryKey:["panel-pilot-targets"],
    enabled:PANEL_PILOT_UI_ENABLED,
    staleTime:60_000,
    refetchOnWindowFocus:false,
    queryFn:async():Promise<PanelPilotTarget[]>=>{
      const {data,error}=await supabase.functions.invoke("painel-recarga-renovar",{
        body:{mode:"pilot_targets"},
      });
      if(error||data?.ok!==true||data?.readOnly!==true||!Array.isArray(data.targets))
        throw Error("Lista segura de pilotos indisponível.");
      return data.targets.filter((target:PanelPilotTarget)=>
        typeof target.clientId==="string"&&typeof target.expectedDueDate==="string"
        &&typeof target.server==="string");
    },
  });

  const externalJobsQuery=useQuery({
    queryKey:["external-renewal-jobs"],
    enabled:PANEL_PILOT_UI_ENABLED,
    queryFn:async()=>{
      const {data,error}=await supabase.from("external_renewal_jobs")
        .select("id,client_id,client_name,login,server,state,created_at,external_message,expected_due_date")
        .neq("state","synced").order("created_at",{ascending:false}).limit(30);
      if(error)throw error;
      return data??[];
    },
    refetchOnWindowFocus:true,
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

  const template = settingsQuery.data?.regular ?? DEFAULT_TEMPLATE;
  const overdueTemplate = settingsQuery.data?.overdue ?? DEFAULT_OVERDUE_TEMPLATE;
  const clients = useMemo(() => clientsQuery.data ?? [], [clientsQuery.data]);
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
        access_type: draft.access_type,
        notes: draft.notes.trim() || null,
        referred_by_client_id: draft.referred_by_client_id || null,
        referral_first_payment_confirmed: draft.referral_first_payment_confirmed,
        // Editing a prepaid/free month must not erase the previous paid package amount.
        prev_cost: cost > 0 ? cost : (id ? (clients.find(c => c.id === id)?.prev_cost ?? cost) : cost),
        prev_paid: paid > 0 ? paid : (id ? (clients.find(c => c.id === id)?.prev_paid ?? 0) : 0),
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
  const [previewClient, setPreviewClient] = useState<Client | null>(null);

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

  const verifyExternalPilotJob=async(job:{
    client_id:string|null;client_name:string;expected_due_date:string;
    state:string;
  })=>{
    if(!PANEL_PILOT_UI_ENABLED||!job.client_id||renewingBusy)return;
    if(!["created","waiting","uncertain","external_confirmed"].includes(job.state)){
      setNotice("Pedido requer conciliação manual, não uma nova renovação.");
      return;
    }
    setRenewingBusy(true);
    try{
      const {data,error}=await supabase.functions.invoke("painel-recarga-renovar",{
        body:{mode:"check",clientId:job.client_id,expectedDueDate:job.expected_due_date},
      });
      let result=data as {renewed?:boolean;pending?:boolean;message?:string}|null;
      if(error){
        const context=(error as {context?:unknown}).context;
        if(context instanceof Response){try{result=await context.json();}catch{/* No JSON */}}
      }
      setNotice(job.client_name+": "+(result?.message??error?.message??"Pedido ainda sem confirmação."));
      await qc.invalidateQueries({queryKey:["external-renewal-jobs"]});
      if(result?.renewed){
        await Promise.all([
          qc.invalidateQueries({queryKey:["clients"]}),
          qc.invalidateQueries({queryKey:["payments"]}),
          qc.invalidateQueries({queryKey:["server-credit-movements"]}),
        ]);
      }
    }catch{
      setNotice("Não foi possível confirmar o pedido externo. Não inicie outra renovação: confira a fila.");
    }finally{setRenewingBusy(false);}
  };

  const confirmPanelPilot=async (
    client:Client,
    opts:{months:number;cost:number;paid:number;monthlyCost:number;monthlyPaid:number},
  )=>{
    if(!isPilotTarget(client,pilotTargetsQuery.data??[])||!panelRouteForClient(client.server))return;
    if(renewingBusy)return;
    if(opts.months!==1||opts.paid!==Number(client.paid)
      ||opts.monthlyCost!==Number(client.cost)){
      setNotice("Piloto mensal restrito a um ciclo e aos valores do cadastro: "+
        formatBRL(Number(client.paid))+" recebidos, custo "+
        formatBRL(Number(client.cost))+".");
      return;
    }
    if(client.access_type==="gratuidade"||client.access_type==="meu_acesso"){
      setNotice("Acesso gratuito: o fluxo de piloto não registra mensalidade. Continue usando a renovação manual.");
      return;
    }
    const {dueDate,financialDueDate}=renewalDates(client.due_date,opts.months);
    const hasPrepaidCoverage=!!client.financial_due_date&&client.financial_due_date>client.due_date;
    const covered=hasPrepaidCoverage&&client.financial_due_date!>=dueDate;
    if(hasPrepaidCoverage&&!covered){
      setNotice("Este cliente tem cobertura parcial, mas o próximo ciclo técnico ultrapassa "
        +"o vencimento financeiro. Concilie o saldo do pacote antes de renovar no painel.");
      return;
    }
    const values={
      months:covered?1:opts.months,
      dueDate,financialDueDate:covered?client.financial_due_date!:financialDueDate,
      cost:opts.monthlyCost,monthlyPaid:covered?0:opts.monthlyPaid,
      prevPaid:covered?client.prev_paid:(opts.months>1?client.prev_paid||client.paid:opts.monthlyPaid),
      paymentAmount:covered?0:opts.paid,paymentCost:covered?0:opts.cost,
    };

    // A read-only preflight MUST succeed before even offering a real renewal.
    // It never creates provider jobs and works while live renewals are off.
    let preflight:{
      ok?:boolean;previewOnly?:boolean;providerRequestSent?:boolean;
      message?:string;
    }|null=null;
    try{
      const {data,error}=await supabase.functions.invoke("painel-recarga-renovar",{
        body:{mode:"preflight",clientId:client.id,
          expectedDueDate:client.due_date,options:values},
      });
      preflight=data as typeof preflight;
      if(error){
        const context=(error as {context?:unknown}).context;
        if(context instanceof Response){try{preflight=await context.json();}catch{/* No JSON */}}
        if(!preflight?.message)preflight={ok:false,message:error.message};
      }
    }catch(error){
      preflight={ok:false,message:error instanceof Error?error.message:"Erro inesperado na validação."};
    }
    if(preflight?.ok!==true||preflight.previewOnly!==true||preflight.providerRequestSent!==false){
      setNotice(client.name+": o pré-teste bloqueou esta renovação: "+
        (preflight?.message??"Validação segura indisponível. Nenhum pedido externo enviado."));
      return;
    }

    const summary=[
      "PILOTO SUPERVISIONADO — Painel Recarga",
      "Cliente: "+client.name+" ("+client.login+")",
      "Servidor: "+client.server,
      "Acesso atual: "+formatDate(client.due_date),
      "Acesso projetado: "+formatDate(dueDate)+" (a data real virá do painel)",
      "Financeiro projetado: "+formatDate(covered?client.financial_due_date:financialDueDate),
      "Pagamento nesta renovação: "+formatBRL(covered?0:opts.paid),
      "Ciclos no servidor: 1",
      "",
      "Esta confirmação pode gerar UMA RENOVAÇÃO REAL se a função estiver habilitada.",
      "Confirma o envio deste cliente específico?",
    ].join("\n");
    if(!window.confirm(summary))return;
    setRenewingBusy(true);
    try{
      const {data,error}=await supabase.functions.invoke("painel-recarga-renovar",{
        body:{mode:"renew",confirm:true,clientId:client.id,
          expectedDueDate:client.due_date,options:values},
      });
      let result=data as {
        renewed?:boolean;pending?:boolean;needsReview?:boolean;
        disabled?:boolean;message?:string;dueDate?:string;financialDueDate?:string;
      }|null;
      if(error){
        const context=(error as {context?:unknown}).context;
        if(context instanceof Response){try{result=await context.json();}catch{/* No JSON */}}
      }
      if(result?.renewed){
        await Promise.all([
          qc.invalidateQueries({queryKey:["clients"]}),
          qc.invalidateQueries({queryKey:["payments"]}),
          qc.invalidateQueries({queryKey:["server-credit-movements"]}),
        ]);
        setNotice(client.name+": renovação confirmada no painel e registrada na MaxFlix. "
          +"Técnico "+formatDate(result.dueDate??dueDate)
          +", financeiro "+formatDate(result.financialDueDate??financialDueDate)+".");
      }else if(result?.disabled){
        setNotice("Piloto permanece bloqueado no servidor. Nenhum pedido real enviado.");
      }else{
        setNotice(client.name+": "+(result?.message??error?.message??"Resposta não conclusiva")
          +" — confira o mesmo pedido no Painel Recarga antes de qualquer novo clique.");
      }
      setRenewing(null);
      await qc.invalidateQueries({queryKey:["external-renewal-jobs"]});
    }catch(error){
      setNotice(client.name+": resultado da renovação externa desconhecido. "
        +"Não faça uma segunda renovação sem consultar o pedido original. "
        +(error instanceof Error?error.message:""));
      setRenewing(null);
    }finally{setRenewingBusy(false);}
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

  // Counts reflect the selected period and access category, independent of
  // the server chip or text search. This keeps the shortcuts useful while filtering.
  const periodClients = useMemo(() => clients.filter(c => {
    const s = getStatus(c);
    if (tab === "todos" && s.key === "vencido") return false;
    if (tab === "vencidos" && s.key !== "vencido") return false;
    if (tab === "hoje" && s.key !== "hoje") return false;
    if (tab === "breve" && (s.days < 1 || s.days > 5 || (range > 0 && s.days !== range))) return false;
    if (tab === "cobranca" && s.key !== "vencido" && s.key !== "hoje" && s.key !== "breve") return false;
    if (accessFilter === "gratuitos") {
      if (c.access_type !== "gratuidade" && c.access_type !== "meu_acesso") return false;
    } else if (accessFilter !== "todos" && (c.access_type ?? "padrao") !== accessFilter) return false;
    return true;
  }), [clients, tab, range, accessFilter]);

  const serverCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const client of periodClients) counts.set(client.server, (counts.get(client.server) ?? 0) + 1);
    const names = [...new Set([...SERVERS, ...counts.keys()])];
    return names.filter(name => (counts.get(name) ?? 0) > 0 || name === serverFilter)
      .map(name => ({name, count:counts.get(name) ?? 0}))
      .sort((a,b)=>b.count-a.count || a.name.localeCompare(b.name,"pt-BR"));
  }, [periodClients, serverFilter]);
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return sortClients(periodClients.filter(c =>
      (serverFilter === "todos" || c.server === serverFilter)
      && (!term || `${c.name} ${c.login}`.toLowerCase().includes(term))
    ), sortMode);
  }, [periodClients, search, serverFilter, sortMode]);

  // Apply search, status, server, and sort to the entire list BEFORE paging.
  // Reset page when those controls change; preserve overall summary and CSV export.
  useEffect(() => {
    setPage(1);
  }, [tab, range, search, serverFilter, sortMode, accessFilter]);

  const paginated = useMemo(() => paginateClients(filtered, page), [filtered, page]);
  const changePage = (nextPage: number) => {
    setPage(Math.max(1, Math.min(nextPage, paginated.totalPages)));
    document.getElementById("maxflix-client-results")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };


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
    { key: "todos", label: "Ativos" },
    { key: "cadastrados", label: "Todos os cadastros" },
    { key: "vencidos", label: "Vencidos" },
    { key: "hoje", label: "Vence hoje" },
    { key: "breve", label: "Vencendo em breve" },
    { key: "cobranca", label: "Fila de cobrança" },
  ];

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
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-cyan">Gestão diária</p>
            <h1 className="font-display text-xl font-semibold sm:text-2xl">Renovações e clientes</h1>
            <p className="mt-1 text-xs text-mist">Renove, cobre e gerencie seus clientes sem sair desta página.</p>
          </div>
          <Link to="/" className="rounded-xl bg-panel px-3 py-2 text-xs font-medium text-mist ring-1 ring-line hover:text-cyan">
            ← Voltar ao Dashboard
          </Link>
        </div>
        <header>
          <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-panel/40 p-2.5 ring-1 ring-line/60 sm:p-3">
            <button type="button"
              onClick={() => { setFormError(null); setEditing(null); setFormOpen(true); }}
              className="h-10 shrink-0 rounded-xl bg-cyan px-4 text-sm font-semibold text-background ring-1 ring-cyan/40 hover:brightness-110">
              + Novo cliente
            </button>
            <button type="button" onClick={toggleFinancials}
              className={"grid size-10 shrink-0 place-items-center rounded-xl ring-1 " + (financialsHidden
                ? "bg-cyan/15 text-cyan ring-cyan/30"
                : "bg-panel text-mist ring-line hover:text-frost")}
              aria-label={financialsHidden ? "Mostrar valores financeiros" : "Ocultar valores financeiros"}
              title={financialsHidden ? "Mostrar valores" : "Ocultar valores"}>
              {financialsHidden ? <EyeOffIcon /> : <EyeIcon />}
            </button>
            <label className="flex h-10 min-w-[160px] flex-1 items-center gap-2 rounded-xl bg-panel px-3 ring-1 ring-line"
              aria-label="Buscar cliente">
              <Search size={17} className="shrink-0 text-mist" aria-hidden="true" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full min-w-0 bg-transparent text-sm text-frost outline-none placeholder:text-mist/60"
                placeholder="Buscar cliente..."
              />
            </label>
          </div>
        </header>

        <section className="mt-6 flex flex-wrap items-center gap-2 sm:mt-8">
          <nav className="flex flex-wrap items-center gap-1 rounded-xl bg-panel p-1 ring-1 ring-line">
            {tabs.map((t) => (
              <button key={t.key} onClick={() => {
                setTab(t.key);
                void navigate({ to: "/renovacoes", search: { tab: t.key, ...(selectedAccess ? {access:selectedAccess}: {}), ...(serverFilter !== "todos" ? {server:serverFilter} : {}) }, replace: true });
              }} className={tabBtn(tab === t.key)}>
                {t.label}
              </button>
            ))}
          </nav>
          <div className="flex min-w-0 flex-wrap items-center gap-2 sm:ml-auto">
            <Select value={accessFilter} onValueChange={setAccessFilter}>
              <SelectTrigger aria-label="Filtrar por tipo de acesso"
                className="h-10 w-[180px] max-w-full rounded-xl border-0 bg-panel px-3 text-sm font-medium text-mist ring-1 ring-line">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-line bg-panel2 text-frost shadow-lg">
                <SelectItem value="todos">Todos os tipos</SelectItem>
                <SelectItem value="gratuitos">Todos os gratuitos</SelectItem>
                <SelectItem value="padrao">Padrão / a classificar</SelectItem>
                <SelectItem value="pacote_pago">Pacote pré-pago</SelectItem>
                <SelectItem value="gratuidade">Família / Amigos</SelectItem>
                <SelectItem value="meu_acesso">Meu Acesso / Testes</SelectItem>
              </SelectContent>
            </Select>
            {tab === "breve" && (
              <>
                <span className="hidden text-xs text-mist sm:inline">Vence em</span>
                <div className="flex items-center gap-1 rounded-xl bg-panel p-1 ring-1 ring-line">
                  {[0, 1, 2, 3, 4, 5].map((d) => (
                    <button
                      key={d}
                      onClick={() => setRange(d)}
                      className={`font-display rounded-lg px-2.5 py-1 text-sm font-medium ${
                        range === d
                          ? "bg-cyan/15 text-cyan ring-1 ring-cyan/30"
                          : "text-mist hover:bg-frost/5"
                      }`}
                    >
                      {d === 0 ? "5 dias" : d}
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

        <section aria-label="Renovações por servidor" className="mt-4 rounded-2xl bg-panel/70 p-3 ring-1 ring-line sm:p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="font-display text-sm font-semibold text-frost">
                {tab === "cadastrados" || tab === "todos" ? "Clientes por servidor" : "Renovações por servidor"}
              </h2>
              <p className="mt-1 text-xs text-mist">
                Toque no servidor para ver somente seus clientes. Os números acompanham o período selecionado.
              </p>
            </div>
            <Link to="/servidores" className="shrink-0 text-xs font-semibold text-cyan hover:underline">Ver servidores →</Link>
          </div>
          <div className="mt-3 flex gap-2 overflow-x-auto pb-2" role="group" aria-label="Filtrar lista por servidor">
            <button type="button" onClick={() => setServerFilter("todos")}
              aria-pressed={serverFilter === "todos"}
              className={`min-h-11 shrink-0 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-semibold ring-1 transition-colors ${serverFilter === "todos"
                ? "bg-cyan text-background ring-cyan"
                : "bg-panel2 text-frost ring-line hover:ring-cyan/40"}`}>
              Todos · {periodClients.length}
            </button>
            {serverCounts.map(({name,count}) => (
              <button key={name} type="button" onClick={() => setServerFilter(name)}
                aria-pressed={serverFilter === name}
                className={`min-h-11 shrink-0 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-semibold ring-1 transition-colors ${serverFilter === name
                  ? "bg-cyan text-background ring-cyan"
                  : "bg-panel2 text-frost ring-line hover:ring-cyan/40"}`}>
                {name === "UniP2P" ? "UniP2P" : name} · {count}
              </button>
            ))}
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

        {PANEL_PILOT_UI_ENABLED&&<section className="mt-4 rounded-xl bg-panel p-3 text-sm ring-1 ring-warn/25" aria-label="Acompanhamento do piloto Painel Recarga">
          <p className="font-semibold text-warn">Painel Recarga — piloto supervisionado</p>
          <p className="mt-1 text-xs text-mist">Somente pedidos externos já autorizados. Verificar andamento usa a mesma chave do pedido; não cria nova autorização.</p>
          {externalJobsQuery.isError&&<p className="mt-2 text-danger">Histórico externo indisponível. Consulte o painel antes de qualquer nova renovação.</p>}
          {externalJobsQuery.isLoading&&<p className="mt-2 text-mist">Verificando pedidos…</p>}
          {(externalJobsQuery.data??[]).length===0&&!externalJobsQuery.isLoading&&
            <p className="mt-2 text-xs text-mist">Nenhum pedido externo pendente ou em revisão.</p>}
          <div className="mt-2 space-y-2">
            {(externalJobsQuery.data??[]).map(job=><div key={job.id} className="rounded-lg bg-background/70 p-3 ring-1 ring-line">
              <p className="font-semibold">{job.client_name} · {job.login} · {job.server}</p>
              <p className="mt-1 text-xs text-mist">Estado: {job.state} · vencimento anterior: {formatDate(job.expected_due_date)}</p>
              {job.external_message&&<p className="mt-1 text-xs text-warn">{job.external_message}</p>}
              {["created","waiting","uncertain","external_confirmed"].includes(job.state)&&
                <button type="button" disabled={renewingBusy||!job.client_id}
                  onClick={()=>void verifyExternalPilotJob(job)}
                  className="mt-2 min-h-9 rounded-lg bg-panel2 px-3 text-xs font-semibold text-cyan ring-1 ring-line disabled:opacity-40">
                  {renewingBusy?"Verificando…":"Verificar andamento (mesma chave)"}
                </button>}
            </div>)}
          </div>
        </section>}

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
                        {c.access_type && c.access_type!=="padrao" && (
                          <p className="mt-1 text-[11px] font-medium text-cyan">
                            {c.access_type==="gratuidade"?"🎁 Família / Amigos":c.access_type==="meu_acesso"?"🧪 Meu Acesso / Testes":"💳 Pacote pré-pago"}
                          </p>
                        )}
                        {boxLinkedClientsQuery.data?.has(c.id) && (
                          <Link to="/aparelhos"
                            className="mt-1 inline-block text-[11px] font-semibold text-cyan hover:underline"
                            title="Venda de TV Box vinculada a esta assinatura; renovações continuam normalmente">
                            📺 TV Box + acesso · ver venda
                          </Link>
                        )}
                        {c.notes && (
                          <p className="mt-1 max-w-[320px] truncate text-[11px] text-warn"
                            title={c.notes}>📝 {c.notes}</p>
                        )}
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
                    <div className="mt-3 flex flex-wrap items-stretch gap-2 xl:mt-0">
                      <button
                        type="button"
                        disabled={isPilotTarget(c,pilotTargetsQuery.data??[])&&(externalJobsQuery.isLoading||externalJobsQuery.isError||
                          (externalJobsQuery.data??[]).some(job=>job.client_id===c.id
                            &&job.expected_due_date===c.due_date
                            &&["created","waiting","uncertain","external_confirmed","needs_review"].includes(job.state)))}
                        onClick={() => renew(c)}
                        className="font-display flex min-h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl bg-cyan/15 px-2 text-sm font-semibold text-cyan ring-1 ring-cyan/30 hover:bg-cyan/25"
                      >
                        <RefreshCw size={15} aria-hidden="true" /> Renovar
                      </button>
                      {isPilotTarget(c,pilotTargetsQuery.data??[])&&panelRouteForClient(c.server)&&(
                        <button type="button" disabled={renewingBusy}
                          onClick={()=>{
                            const next=nextDueDate(c.due_date);
                            if(c.financial_due_date && c.financial_due_date>=next){
                              const monthlyCost=c.cost||c.prev_cost||SERVER_COSTS[c.server]||0;
                              void confirmPanelPilot(c,{months:1,cost:0,paid:0,monthlyCost,monthlyPaid:0});
                            }else setRenewing(c);
                          }}
                          className="font-display min-h-11 rounded-xl bg-panel2 px-2 text-xs font-semibold text-warn ring-1 ring-warn/30 disabled:opacity-50">
                          Painel (piloto)
                        </button>
                      )}
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
                      {panelRouteForClient(c.server) && !!c.login.trim()
                        && c.access_type!=="gratuidade" && c.access_type!=="meu_acesso" && (
                        <button type="button"
                          onClick={() => setPreviewClient(c)}
                          className="min-h-10 basis-full rounded-lg bg-panel2 px-3 text-xs font-semibold text-cyan ring-1 ring-cyan/25 hover:bg-cyan/10">
                          Pré-validar renovação · sem alterar dados
                        </button>
                      )}
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

      {previewClient && (
        <PreflightDialog key={previewClient.id} client={previewClient}
          onClose={() => setPreviewClient(null)} />
      )}

      {renewing && (
        <RenewDialog
          client={renewing}
          saving={renewingBusy}
          onCancel={() => setRenewing(null)}
          onConfirm={(opts) => confirmRenew(renewing, opts)}
          {...(isPilotTarget(renewing,pilotTargetsQuery.data??[]) && panelRouteForClient(renewing.server)
            ? { onConfirmPilot: (opts: { months: number; cost: number; paid: number; monthlyCost: number; monthlyPaid: number }) => confirmPanelPilot(renewing, opts) }
            : {})}
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

/**
 * Safe renewal preview: only calls mode=preflight.
 * It cannot create provider requests, payments, credits or date changes.
 */
function PreflightDialog({client,onClose}:{client:Client;onClose:()=>void}) {
  const prepaid=!!client.financial_due_date&&client.financial_due_date>client.due_date;
  const [months,setMonths]=useState(1);
  const [paid,setPaid]=useState(String(client.paid||client.prev_paid||0).replace(".",","));
  const [cost,setCost]=useState(String(client.cost||client.prev_cost||SERVER_COSTS[client.server]||0).replace(".",","));
  const [busy,setBusy]=useState(false);
  const [outcome,setOutcome]=useState<{
    ok:boolean;message:string;
    pilotDiagnostic?:{
      clientId:"ok"|"missing"|"different";
      expectedDueDate:"ok"|"missing"|"different";
      liveEnabled:boolean;
    }|undefined;
  }|null>(null);
  const period=prepaid?1:months;
  const validMonths=Number.isInteger(period)&&period>=1&&period<=120;
  const dates=renewalDates(client.due_date,validMonths?period:1);
  const technicalDue=dates.dueDate;
  const financialDue=prepaid?(client.financial_due_date??dates.financialDueDate):dates.financialDueDate;
  const charged=prepaid?0:num(paid);
  const monthlyCost=num(cost);
  const blockedCoverage=prepaid&&financialDue<technicalDue;
  const inspect=async()=>{
    if(busy||!validMonths)return;
    setOutcome(null);
    setBusy(true);
    const options={
      months:period,dueDate:technicalDue,financialDueDate:financialDue,
      cost:monthlyCost,
      monthlyPaid:prepaid||period>1?0:charged,
      prevPaid:prepaid?client.prev_paid:(period>1?client.prev_paid||client.paid:charged),
      paymentAmount:charged,
      paymentCost:prepaid?0:monthlyCost*period,
    };
    try {
      const {data,error}=await supabase.functions.invoke("painel-recarga-renovar",{
        body:{mode:"preflight",clientId:client.id,
          expectedDueDate:client.due_date,options},
      });
      let response=data as {
        ok?:boolean;previewOnly?:boolean;providerRequestSent?:boolean;message?:string;
        estimatedDueDate?:string;estimatedFinancialDueDate?:string;paymentAmount?:number;
        pilotDiagnostic?:{
          clientId:"ok"|"missing"|"different";
          expectedDueDate:"ok"|"missing"|"different";
          liveEnabled:boolean;
        };
      }|null;
      if(error){
        const context=(error as {context?:unknown}).context;
        if(context instanceof Response){
          try{response=await context.json();}catch{/* fall back to error */}
        }
      }
      const approved=!error&&response?.ok===true&&response.previewOnly===true
        &&response.providerRequestSent===false
        &&response.estimatedDueDate===technicalDue
        &&response.estimatedFinancialDueDate===financialDue
        &&response.paymentAmount===charged;
      setOutcome({ok:approved,message:approved
        ?"Pré-validação aprovada. Nenhuma renovação, cobrança ou consumo de crédito foi realizado."
        :(response?.message??error?.message??"Pré-validação segura indisponível."),
        pilotDiagnostic:response?.pilotDiagnostic});
    }catch(error){
      setOutcome({ok:false,message:error instanceof Error?error.message:"Pré-validação indisponível."});
    }finally{setBusy(false);}
  };
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-background/85 p-4 backdrop-blur-sm">
      <section role="dialog" aria-modal="true" aria-label="Pré-validar renovação"
        className="mx-auto my-6 max-w-md rounded-2xl bg-panel2 p-5 ring-1 ring-line sm:p-6">
        <h2 className="font-display text-lg font-semibold">Pré-validar renovação</h2>
        <p className="mt-1 break-words text-sm text-mist">{client.name} · {client.login} · {client.server}</p>
        <p className="mt-3 rounded-lg bg-panel px-3 py-2 text-xs text-cyan ring-1 ring-cyan/20">
          Somente leitura: não renova no servidor, não cobra e não desconta créditos.
        </p>
        {prepaid?(
          <div className="mt-4 rounded-lg bg-panel p-3 text-sm ring-1 ring-line">
            <p className="font-medium text-frost">Pacote já pago</p>
            <p className="mt-1 text-xs text-mist">Um ciclo técnico previsto; financeiro preservado e nenhum novo pagamento.</p>
          </div>
        ):(
          <div className="mt-4">
            <p className="text-xs font-semibold text-mist">Quantidade de meses contratados</p>
            <div className="mt-2 grid grid-cols-5 gap-1.5">
              {[1,2,3,6,12].map(m=><button key={m} type="button"
                disabled={busy} aria-pressed={months===m}
                onClick={()=>{setMonths(m);setOutcome(null);}}
                className={months===m
                  ?"min-h-10 rounded-lg bg-cyan/15 text-sm font-semibold text-cyan ring-1 ring-cyan/40"
                  :"min-h-10 rounded-lg bg-panel text-sm text-mist ring-1 ring-line"}>
                {m}
              </button>)}
            </div>
            <label className="mt-3 block text-xs text-mist" htmlFor="preview-months">Meses</label>
            <input id="preview-months" type="number" min={1} max={120} step={1}
              disabled={busy} value={months}
              onChange={e=>{setMonths(Number(e.target.value));setOutcome(null);}}
              className="mt-1 w-full rounded-lg bg-panel px-3 py-2 text-sm ring-1 ring-line" />
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-mist" htmlFor="preview-paid">Valor pago (total)</label>
                <input id="preview-paid" inputMode="decimal" disabled={busy} value={paid}
                  onChange={e=>{setPaid(e.target.value);setOutcome(null);}}
                  className="mt-1 w-full rounded-lg bg-panel px-3 py-2 text-sm ring-1 ring-line" />
              </div>
              <div>
                <label className="text-xs text-mist" htmlFor="preview-cost">Custo por ciclo</label>
                <input id="preview-cost" inputMode="decimal" disabled={busy} value={cost}
                  onChange={e=>{setCost(e.target.value);setOutcome(null);}}
                  className="mt-1 w-full rounded-lg bg-panel px-3 py-2 text-sm ring-1 ring-line" />
              </div>
            </div>
          </div>
        )}
        <div className="mt-4 space-y-2 rounded-lg bg-panel px-3 py-3 text-sm ring-1 ring-line">
          <p className="text-xs font-semibold text-mist">Previsão sem renovação</p>
          <div className="flex justify-between gap-3"><span className="text-mist">Técnico atual</span><span>{formatDate(client.due_date)}</span></div>
          <div className="flex justify-between gap-3"><span className="text-mist">Financeiro atual</span><span>{formatDate(client.financial_due_date)}</span></div>
          <div className="flex justify-between gap-3"><span className="text-mist">Técnico projetado</span><span>{formatDate(technicalDue)}</span></div>
          <div className="flex justify-between gap-3"><span className="text-mist">Financeiro projetado</span><span>{formatDate(financialDue)}</span></div>
          <div className="flex justify-between gap-3"><span className="text-mist">Pagamento previsto</span><span>{formatBRL(charged)}</span></div>
          <p className="pt-1 text-xs text-mist">Um ciclo técnico. A data definitiva do painel será conhecida somente numa renovação real futura.</p>
        </div>
        {blockedCoverage&&<p className="mt-3 text-xs text-warn">Cobertura financeira insuficiente para o próximo ciclo. Corrija antes de renovar.</p>}
        {outcome&&<p role="status" className={outcome.ok
          ?"mt-3 rounded-lg bg-ok/10 px-3 py-2 text-sm text-ok"
          :"mt-3 rounded-lg bg-warn/10 px-3 py-2 text-sm text-warn"}>
          {outcome.ok?"Aprovado: ":"Revisão necessária: "}{outcome.message}
        </p>}
        {outcome?.pilotDiagnostic&&
          <div role="status" className="mt-3 rounded-lg bg-panel px-3 py-3 text-xs ring-1 ring-line">
            <p className="font-semibold">Diagnóstico seguro do piloto</p>
            <p className="mt-1 text-mist">Somente resultado das comparações. Nenhum valor secreto foi exibido.</p>
            <p className="mt-2">Identificação do cliente: <strong>{
              outcome.pilotDiagnostic.clientId==="ok"?"Correta":
              outcome.pilotDiagnostic.clientId==="missing"?"Secret não encontrado":"Valor diferente do esperado"
            }</strong></p>
            <p className="mt-1">Vencimento autorizado: <strong>{
              outcome.pilotDiagnostic.expectedDueDate==="ok"?"Correto":
              outcome.pilotDiagnostic.expectedDueDate==="missing"?"Secret não encontrado":"Valor diferente do esperado"
            }</strong></p>
            <p className="mt-1">Renovações reais: <strong>{
              outcome.pilotDiagnostic.liveEnabled?"Habilitadas — não renove durante o diagnóstico":"Desativadas (seguro)"
            }</strong></p>
          </div>}
        <div className="mt-5 flex flex-wrap gap-2">
          <Button type="button" disabled={busy||!validMonths}
            onClick={()=>void inspect()}
            className="min-h-11 flex-1 rounded-lg bg-cyan font-semibold text-background disabled:opacity-40">
            {busy?"Conferindo…":"Pré-validar sem renovar"}
          </Button>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}
            className="min-h-11 rounded-lg bg-panel px-4 ring-1 ring-line">
            Fechar
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
  onConfirmPilot,
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
  onConfirmPilot?: (opts: {
    months:number;cost:number;paid:number;monthlyCost:number;monthlyPaid:number;
  })=>void|Promise<void>;
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

        {onConfirmPilot&&<div className="mt-4 rounded-xl bg-warn/10 p-3 text-xs text-warn ring-1 ring-warn/25">
          <p>O piloto envia somente 1 ciclo ao Painel Recarga e usa o vencimento real confirmado. O financeiro segue o período pago. Exige sua confirmação.</p>
          <Button type="button" variant="outline" disabled={!validMonths||saving||paidValue<=0}
            onClick={()=>void onConfirmPilot({months,cost:totalCost,paid:paidValue,monthlyCost,monthlyPaid})}
            className="mt-3 w-full rounded-xl text-warn ring-1 ring-warn/30">
            Renovar também no Painel Recarga (piloto)
          </Button>
        </div>}
        <div className="mt-5 flex gap-3">
          {!onConfirmPilot && <Button
            type="button"
            disabled={!validMonths || saving}
            onClick={() =>
              onConfirm({ months, cost: totalCost, paid: paidValue, monthlyCost, monthlyPaid })
            }
            className="font-display rounded-xl bg-cyan px-4 py-2.5 text-sm font-semibold text-background ring-1 ring-cyan/40"
          >
            {saving ? "Renovando…" : "Confirmar renovação"}
          </Button>}
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
