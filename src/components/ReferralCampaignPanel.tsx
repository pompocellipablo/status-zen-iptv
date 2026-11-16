import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Gift, MessageCircle, Search, Undo2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { campaignWhatsAppLink } from "@/lib/whatsapp-campaign";
import {
  buildReferralRecipients, REFERRAL_CAMPAIGN_KEY, REFERRAL_PROMO_MESSAGE,
  type ReferralPromoClient, type ReferralRecipient,
} from "@/lib/referral-promo";

type SendRow = { phone: string; sent_at: string | null; client_id: string | null };
type Filter = "pendentes" | "enviados" | "sem-telefone" | "todos";

async function readAudience(): Promise<ReferralPromoClient[]> {
  const all: ReferralPromoClient[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from("clients")
      .select("id,name,login,server,due_date,whatsapp,access_type")
      .order("id", { ascending: true })
      .range(offset, offset + 499);
    if (error) throw error;
    all.push(...(data ?? []));
    if (!data || data.length < 500) return all;
  }
}

async function readSends(): Promise<SendRow[]> {
  const all: SendRow[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from("whatsapp_campaign_tracking")
      .select("phone,sent_at,client_id")
      .eq("campaign_key", REFERRAL_CAMPAIGN_KEY)
      .order("phone", { ascending: true })
      .range(offset, offset + 499);
    if (error) throw error;
    all.push(...(data ?? []));
    if (!data || data.length < 500) return all;
  }
}

const statusClass = "rounded-lg px-2.5 py-1 text-xs font-semibold ring-1";
const formatSent = (value: string) => new Date(value).toLocaleString("pt-BR", {
  timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit",
  year: "numeric", hour: "2-digit", minute: "2-digit",
});

export function ReferralCampaignPanel() {
  const qc = useQueryClient();
  const audienceQuery = useQuery({ queryKey: ["referral-campaign-audience"], queryFn: readAudience });
  const trackingQuery = useQuery({ queryKey: ["referral-campaign-tracking"], queryFn: readSends });
  const [filter, setFilter] = useState<Filter>("pendentes");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [busyPhone, setBusyPhone] = useState<string | null>(null);
  const [openedPhones, setOpenedPhones] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState("");
  const [showMessage, setShowMessage] = useState(false);
  const [message, setMessage] = useState(REFERRAL_PROMO_MESSAGE);

  const audience = useMemo(() =>
    buildReferralRecipients(audienceQuery.data ?? []), [audienceQuery.data]);
  const byPhone = useMemo(() =>
    new Map((trackingQuery.data ?? []).map(row => [row.phone, row])), [trackingQuery.data]);
  const sentDate = (recipient: ReferralRecipient) =>
    recipient.phone ? byPhone.get(recipient.phone)?.sent_at ?? null : null;

  const recipients = audience.filter(recipient => recipient.phone !== null);
  const sent = recipients.filter(recipient => !!sentDate(recipient)).length;
  const pending = recipients.length - sent;
  const withoutPhone = audience.length - recipients.length;

  const filtered = audience.filter(recipient => {
    const isSent = !!sentDate(recipient);
    if (filter === "pendentes" && (!recipient.phone || isSent)) return false;
    if (filter === "enviados" && !isSent) return false;
    if (filter === "sem-telefone" && recipient.phone) return false;
    const term = search.trim().toLocaleLowerCase("pt-BR");
    return !term || recipient.accounts.some(c =>
      [c.name, c.login, c.server, c.whatsapp ?? ""]
        .join(" ").toLocaleLowerCase("pt-BR").includes(term))
      || (recipient.phone ?? "").includes(term);
  });

  const pageCount = Math.max(1, Math.ceil(filtered.length / 15));
  const currentPage = Math.min(page, pageCount);
  const shown = filtered.slice((currentPage - 1) * 15, currentPage * 15);
  const trackingUnavailable = trackingQuery.isLoading || trackingQuery.isError;

  const changeFilter = (value: Filter) => {
    setFilter(value);
    setPage(1);
  };

  function openWhatsApp(recipient: ReferralRecipient) {
    if (!recipient.phone || trackingUnavailable || sentDate(recipient)) return;
    const url = campaignWhatsAppLink(recipient.phone, message);
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
    setOpenedPhones(old => ({ ...old, [recipient.phone!]: true }));
  }

  async function setSent(recipient: ReferralRecipient, wasSent: boolean) {
    if (!recipient.phone || trackingUnavailable || busyPhone) return;
    const client = recipient.accounts[0];
    if (!client) return;
    const confirmed = window.confirm(wasSent
      ? "Confirma que a mensagem da campanha Indique e Ganhe foi realmente enviada para este WhatsApp? A MaxFlix não consegue verificar o envio sozinha."
      : "Desfazer o registro de envio para este telefone? Ele voltará à lista de pendentes.");
    if (!confirmed) return;
    setBusyPhone(recipient.phone);
    setNotice("");
    try {
      const now = new Date().toISOString();
      const { error } = await supabase.from("whatsapp_campaign_tracking")
        .upsert({
          campaign_key: REFERRAL_CAMPAIGN_KEY,
          phone: recipient.phone,
          client_id: client.id,
          sent_at: wasSent ? now : null,
          updated_at: now,
        }, { onConflict: "campaign_key,phone" });
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["referral-campaign-tracking"] });
      setNotice(wasSent ? "Envio confirmado no controle da campanha." : "Envio desfeito. Contato novamente pendente.");
    } catch (error) {
      setNotice("Não foi possível gravar a confirmação. Verifique a conexão e tente novamente. " +
        (error instanceof Error ? error.message : ""));
    } finally {
      setBusyPhone(null);
    }
  }

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(message);
      setNotice("Texto da campanha copiado, com os asteriscos para o WhatsApp.");
    } catch {
      setShowMessage(true);
      setNotice("Não foi possível copiar automaticamente. Selecione o texto para copiar.");
    }
  }

  const filterOptions: { value: Filter; title: string; count: number }[] = [
    { value: "pendentes", title: "Pendentes", count: pending },
    { value: "enviados", title: "Enviados", count: sent },
    { value: "sem-telefone", title: "Sem telefone", count: withoutPhone },
    { value: "todos", title: "Todos", count: audience.length },
  ];

  return <section className="mt-7 space-y-5" aria-label="Campanha Indique e Ganhe">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold">
          <Gift size={25} className="text-cyan"/> Indique e Ganhe
        </h1>
        <p className="mt-1 text-sm text-mist">Divulgação para clientes pagantes ativos. Um envio por número, mesmo quando há vários logins.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void copyMessage()}
          className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-panel px-3 text-sm font-semibold text-cyan ring-1 ring-line hover:bg-panel2">
          <Copy size={16}/> Copiar texto
        </button>
        <button type="button" onClick={() => setShowMessage(value => !value)}
          className="min-h-10 rounded-xl bg-panel px-3 text-sm font-semibold text-frost ring-1 ring-line hover:bg-panel2">
          {showMessage ? "Ocultar texto" : "Ver/editar texto"}
        </button>
      </div>
    </div>

    {showMessage && <div className="rounded-xl bg-panel p-4 ring-1 ring-line">
      <label htmlFor="referral-promo-message" className="text-sm font-semibold">Mensagem da campanha</label>
      <p className="mt-1 text-xs text-mist">Edições valem apenas nesta sessão. Os asteriscos formatam negrito no WhatsApp.</p>
      <textarea id="referral-promo-message" rows={13} maxLength={6000}
        className="mt-3 w-full rounded-xl bg-background p-3 text-sm leading-relaxed ring-1 ring-line outline-none focus:ring-cyan/40"
        value={message} onChange={event => setMessage(event.target.value)}/>
      <button type="button" onClick={() => setMessage(REFERRAL_PROMO_MESSAGE)}
        className="mt-2 text-xs font-semibold text-cyan hover:underline">Restaurar mensagem original</button>
    </div>}

    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Progresso de divulgação">
      <Metric label="WhatsApps válidos" value={recipients.length} loading={audienceQuery.isLoading}/>
      <Metric label="Pendentes" value={pending} loading={audienceQuery.isLoading || trackingQuery.isLoading}/>
      <Metric label="Já enviados" value={sent} loading={audienceQuery.isLoading || trackingQuery.isLoading}/>
      <Metric label="Sem telefone" value={withoutPhone} loading={audienceQuery.isLoading}/>
    </div>
    <p className="text-xs text-mist">Contagem por destinatário (número), não por tela. Abertura do WhatsApp não comprova envio: confirme somente depois de enviar de verdade.</p>

    {trackingQuery.isError && <div role="alert" className="rounded-xl bg-danger/10 p-3 text-sm text-danger ring-1 ring-danger/30">
      Não foi possível ler o controle de envios. Os botões de envio ficam bloqueados para evitar duplicatas.
    </div>}
    {audienceQuery.isError && <div role="alert" className="rounded-xl bg-danger/10 p-3 text-sm text-danger ring-1 ring-danger/30">
      Não foi possível carregar os clientes.
    </div>}
    {notice && <div role="status" className="flex items-start justify-between gap-3 rounded-xl bg-cyan/10 p-3 text-sm text-cyan ring-1 ring-cyan/30">
      <span>{notice}</span><button type="button" title="Fechar aviso" aria-label="Fechar aviso" onClick={() => setNotice("")}><X size={16}/></button>
    </div>}

    <div className="flex flex-wrap gap-2" aria-label="Filtrar contatos por situação">
      {filterOptions.map(option => <button key={option.value} type="button"
        onClick={() => changeFilter(option.value)}
        aria-pressed={filter === option.value}
        className={"min-h-10 rounded-xl px-3 text-sm font-semibold ring-1 " + (filter === option.value
          ? "bg-cyan/15 text-cyan ring-cyan/40" : "bg-panel text-mist ring-line hover:text-frost")}>
        {option.title} ({option.count})
      </button>)}
    </div>

    <div className="flex h-11 items-center gap-2 rounded-xl bg-panel px-3 ring-1 ring-line focus-within:ring-cyan/50">
      <Search size={17} className="shrink-0 text-mist"/>
      <input type="search" aria-label="Buscar destinatário da campanha"
        placeholder="Buscar nome, login ou WhatsApp" value={search}
        onChange={event => { setSearch(event.target.value); setPage(1); }}
        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-mist/60 [&::-webkit-search-cancel-button]:hidden"/>
      {search.length > 0 && <button type="button" onClick={() => { setSearch(""); setPage(1); }}
        aria-label="Limpar busca" className="grid size-9 shrink-0 place-items-center rounded-lg text-mist hover:text-frost">
        <X size={17}/>
      </button>}
    </div>

    {audienceQuery.isLoading || trackingQuery.isLoading
      ? <p className="text-sm text-mist">Carregando contatos e registros de envio…</p>
      : !audienceQuery.isError && !trackingQuery.isError && <>
        <p className="text-xs text-mist">{filtered.length} destinatários nesta visualização · página {currentPage} de {pageCount}</p>
        {shown.length === 0 && <p className="rounded-xl bg-panel p-4 text-sm text-mist ring-1 ring-line">
          Nenhum destinatário encontrado neste filtro.
        </p>}
        <div className="space-y-3">
          {shown.map(recipient => {
            const account = recipient.accounts[0];
            if (!account) return null;
            const sentAt = sentDate(recipient);
            const isBusy = busyPhone === recipient.phone;
            return <article key={recipient.key} className="rounded-2xl bg-panel/80 p-4 ring-1 ring-line">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="font-display text-base font-semibold">{account.name}</h2>
                  <p className="mt-1 break-words text-xs text-mist">{recipient.accounts.map(c => c.login + " · " + c.server).join(" | ")}</p>
                  {recipient.accounts.length > 1 && <p className="mt-1 text-xs text-cyan">
                    {recipient.accounts.length} acessos no mesmo WhatsApp — enviar somente uma vez
                  </p>}
                  <p className="mt-2 text-sm text-frost">{account.whatsapp || "WhatsApp não cadastrado"}</p>
                </div>
                <span className={statusClass + " " + (sentAt
                  ? "bg-ok/10 text-ok ring-ok/30"
                  : recipient.phone ? "bg-warn/10 text-warn ring-warn/30"
                    : "bg-danger/10 text-danger ring-danger/30")}>
                  {sentAt ? "Enviado · " + formatSent(sentAt) : recipient.phone ? "Pendente" : "Sem telefone"}
                </span>
              </div>
              {recipient.phone ? <div className="mt-4 flex flex-wrap items-center gap-2">
                {!sentAt && <button type="button" disabled={trackingUnavailable || !!busyPhone}
                  onClick={() => openWhatsApp(recipient)}
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-cyan px-4 text-sm font-semibold text-background hover:brightness-110 disabled:opacity-40">
                  <MessageCircle size={16}/> Abrir WhatsApp
                </button>}
                <button type="button" disabled={trackingUnavailable || !!busyPhone}
                  onClick={() => void setSent(recipient, !sentAt)}
                  className={"inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-sm font-semibold ring-1 disabled:opacity-40 " + (sentAt
                    ? "bg-panel2 text-mist ring-line" : "bg-ok/10 text-ok ring-ok/30")}>
                  {sentAt ? <><Undo2 size={16}/> Desfazer envio</> : <><Check size={16}/> Marcar como enviado</>}
                </button>
              </div> : <div className="mt-3 text-xs text-warn">
                Corrija o WhatsApp no cadastro antes de enviar. <Link to="/renovacoes" search={{ tab: "cadastrados" }} className="font-semibold text-cyan underline">Gerenciar clientes</Link>
              </div>}
              {recipient.phone && openedPhones[recipient.phone] && !sentAt && <p className="mt-2 text-xs text-warn">
                Confirme o envio aqui depois de enviar a mensagem no WhatsApp; abrir a conversa não registra o envio.
              </p>}
              {isBusy && <p role="status" className="mt-2 text-xs text-mist">Salvando status…</p>}
            </article>;
          })}
        </div>
        {filtered.length > 15 && <div className="flex items-center justify-between gap-2">
          <button type="button" disabled={currentPage === 1} onClick={() => setPage(p => Math.max(1, p - 1))}
            className="min-h-10 rounded-xl bg-panel px-3 text-sm text-cyan ring-1 ring-line disabled:opacity-40">Anterior</button>
          <span className="text-xs text-mist">{currentPage}/{pageCount}</span>
          <button type="button" disabled={currentPage >= pageCount} onClick={() => setPage(p => Math.min(pageCount, p + 1))}
            className="min-h-10 rounded-xl bg-panel px-3 text-sm text-cyan ring-1 ring-line disabled:opacity-40">Próxima</button>
        </div>}
      </>}
  </section>;
}

function Metric({ label, value, loading }: { label: string; value: number; loading?: boolean }) {
  return <div className="rounded-xl bg-panel/80 p-3 ring-1 ring-line">
    <p className="text-[11px] uppercase tracking-wide text-mist">{label}</p>
    <p className="mt-2 font-display text-2xl font-semibold text-cyan">{loading ? "…" : value}</p>
  </div>;
}
