import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, MessageCircle, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { SERVERS, daysUntil, formatDate } from "@/lib/iptv";
import { eligibleForMigration, canonicalPhone, campaignWhatsAppLink,
  effectiveTracking, MIGRATION_MESSAGE, samePhoneAlreadySent,
  type CampaignAccess, type CampaignTracking } from "@/lib/whatsapp-campaign";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

type Filter = "todos" | "pendentes" | "enviados" | "sem-telefone" | "confirmados";

async function readClients(): Promise<CampaignAccess[]> {
  const all: CampaignAccess[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from("clients")
      .select("id,name,login,server,due_date,whatsapp")
      .order("id", { ascending: true })
      .range(offset, offset + 499);
    if (error) throw error;
    all.push(...(data ?? []));
    if (!data || data.length < 500) return all;
  }
}

async function readTracking(): Promise<CampaignTracking[]> {
  const all: CampaignTracking[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from("whatsapp_migration_tracking")
      .select("client_id,phone_reviewed,agenda_updated,sent_at,replied_at,payer_name,updated_at")
      .order("client_id", { ascending: true })
      .range(offset, offset + 499);
    if (error) throw error;
    all.push(...(data ?? []));
    if (!data || data.length < 500) return all;
  }
}

export const Route = createFileRoute("/_authenticated/comunicacao")({
  head: () => ({ meta: [{ title: "Comunicação — MaxFlix" }] }),
  component: CommunicationPage,
});

function CommunicationPage() {
  const qc = useQueryClient();
  const clientsQuery = useQuery({ queryKey: ["clients", "migration"], queryFn: readClients });
  const trackingQuery = useQuery({
    queryKey: ["whatsapp-migration-tracking"],
    queryFn: readTracking,
  });
  const [draftPhones, setDraftPhones] = useState<Record<string, string>>({});
  const [server, setServer] = useState("todos");
  const [filter, setFilter] = useState<Filter>("todos");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const [showMessage, setShowMessage] = useState(false);
  const [message, setMessage] = useState(MIGRATION_MESSAGE);

  const eligible = useMemo(() => (clientsQuery.data ?? [])
    .filter(c => eligibleForMigration(c))
    .sort((a, b) => a.server.localeCompare(b.server, "pt-BR") ||
      a.due_date.localeCompare(b.due_date) || a.login.localeCompare(b.login, "pt-BR")),
    [clientsQuery.data]);
  const tracking = useMemo<Record<string, CampaignTracking>>(
    () => Object.fromEntries((trackingQuery.data ?? []).map(t => [t.client_id, t])),
    [trackingQuery.data],
  );
  // A single phone field in public.clients; Renovacoes reads the same client row.
  const phoneFor = (c: CampaignAccess) => c.whatsapp ?? "";
  const sentByOther = (c: CampaignAccess) =>
    samePhoneAlreadySent(c, eligible, tracking, {});
  const isAvisado = (c: CampaignAccess) => !!tracking[c.id]?.sent_at || sentByOther(c);
  const sent = eligible.filter(c => !!tracking[c.id]?.sent_at).length;
  const avisados = eligible.filter(isAvisado).length;
  const missing = eligible.filter(c => !canonicalPhone(phoneFor(c))).length;
  const replied = eligible.filter(c => !!tracking[c.id]?.replied_at).length;
  const filtered = eligible.filter(c => {
    const t = effectiveTracking(c.id, tracking);
    if (server !== "todos" && c.server !== server) return false;
    if (filter === "pendentes" && isAvisado(c)) return false;
    if (filter === "enviados" && !isAvisado(c)) return false;
    if (filter === "sem-telefone" && canonicalPhone(phoneFor(c))) return false;
    if (filter === "confirmados" && !t.replied_at) return false;
    const term = search.toLocaleLowerCase("pt-BR").trim();
    return !term || [c.name, c.login, c.server, phoneFor(c)]
      .join(" ").toLocaleLowerCase("pt-BR").includes(term);
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / 20));
  const currentPage = Math.min(totalPages, page);
  const items = filtered.slice((currentPage - 1) * 20, currentPage * 20);

  async function mark(c: CampaignAccess, patch: Partial<CampaignTracking>) {
    if (trackingQuery.isLoading || trackingQuery.isError) return;
    setBusy(c.id);
    setNotice("");
    try {
      const row: CampaignTracking = {
        ...effectiveTracking(c.id, tracking),
        ...patch,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from("whatsapp_migration_tracking")
        .upsert(row, { onConflict: "client_id" });
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["whatsapp-migration-tracking"] });
    } catch {
      setNotice("O status da campanha nao foi salvo. Verifique a conexao e tente novamente.");
    } finally {
      setBusy("");
    }
  }

  async function savePhone(c: CampaignAccess) {
    if (trackingQuery.isLoading || trackingQuery.isError) {
      setNotice("Controle de envios indisponivel. O telefone nao foi alterado.");
      return;
    }
    const raw = (draftPhones[c.id] ?? phoneFor(c)).replace(/\D/g, "");
    const valid = raw ? canonicalPhone(raw) : null;
    if (raw && !valid) {
      setNotice("Informe DDD + numero (10 ou 11 digitos), com ou sem 55.");
      return;
    }
    if (canonicalPhone(c.whatsapp) === valid) {
      setDraftPhones(old => { const next = { ...old }; delete next[c.id]; return next; });
      setNotice("Esse numero ja consta no cadastro.");
      return;
    }
    setBusy(c.id);
    setNotice("");
    let phoneSaved = false;
    try {
      const { data, error } = await supabase.from("clients")
        .update({ whatsapp: valid }).eq("id", c.id).select("id,whatsapp").single();
      if (error || data?.id !== c.id) throw error ?? new Error("Cliente nao confirmado");
      phoneSaved = true;
      // Never treat a NEW telephone as notified when an OLD telephone was contacted.
      const result = await supabase.from("whatsapp_migration_tracking")
        .upsert({
          ...effectiveTracking(c.id, tracking),
          phone_reviewed: false,
          sent_at: null,
          replied_at: null,
          updated_at: new Date().toISOString(),
        }, { onConflict: "client_id" });
      if (result.error) throw result.error;
      setDraftPhones(old => { const next = { ...old }; delete next[c.id]; return next; });
      setNotice("Numero salvo! O mesmo telefone sera usado na aba Renovacoes.");
    } catch {
      setNotice(phoneSaved
        ? "Telefone salvo, mas o status de envio nao foi reiniciado. Confira antes de avisar."
        : "Falha ao gravar o telefone. Nenhum numero foi alterado.");
    } finally {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["clients"] }),
        qc.invalidateQueries({ queryKey: ["whatsapp-migration-tracking"] }),
      ]);
      setBusy("");
    }
  }

  function openDraft(c: CampaignAccess) {
    const url = campaignWhatsAppLink(phoneFor(c), message);
    if (!url || !effectiveTracking(c.id, tracking).phone_reviewed || sentByOther(c)) return;
    window.open(url, "_blank", "noopener,noreferrer");
    setOpened(old => ({ ...old, [c.id]: true }));
  }

  const dateText = (iso: string | null) => iso ? new Date(iso).toLocaleDateString("pt-BR") : "";
  const disabledTracking = trackingQuery.isLoading || trackingQuery.isError;

  return <main className="min-h-screen bg-background text-frost">
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <nav aria-label="Áreas do MaxFlix" className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
        <Link to="/" className="inline-flex items-center gap-1 text-mist hover:text-cyan"><ArrowLeft size={16}/> Dashboard</Link>
        <Link to="/" search={{ aba: "renovacoes" }} className="text-mist hover:text-cyan">Renovações</Link>
        <Link to="/creditos" className="text-mist hover:text-cyan">Créditos</Link>
        <Link to="/revendedores" className="text-mist hover:text-cyan">Revendedores</Link>
        <span aria-current="page" className="font-semibold text-cyan">Comunicação</span>
      </nav>

      <div className="mt-7 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-display text-2xl font-semibold">
            <MessageCircle className="text-cyan"/> Troca do número
          </h1>
          <p className="mt-1 text-sm text-mist">Ativos e vencidos há até 10 dias. Trabalhe um servidor por vez.</p>
        </div>
        <Button variant="outline" className="border-line text-cyan" onClick={() => setShowMessage(v => !v)}>
          {showMessage ? "Ocultar mensagem" : "Conferir mensagem pronta"}
        </Button>
      </div>

      {disabledTracking && <div role="alert" className="mt-4 rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
        A tabela de acompanhamento ainda não foi habilitada. Não use esta página para envios até corrigir a configuração.
      </div>}
      {notice && <div role="status" className="mt-4 flex justify-between gap-3 rounded-xl bg-panel2 p-3 text-sm text-cyan ring-1 ring-line">
        <span>{notice}</span><button type="button" onClick={() => setNotice("")} aria-label="Fechar"><X size={16}/></button>
      </div>}
      {showMessage && <section className="mt-4 rounded-xl bg-panel/80 p-4 ring-1 ring-line">
        <h2 className="font-semibold">Texto de migração para o novo WhatsApp</h2>
        <p className="mt-1 text-xs text-mist">Editável nesta sessão. O número novo e a chave Pix foram confirmados. A data de encerramento do atendimento anterior ainda não foi definida.</p>
        <textarea rows={12} aria-label="Mensagem da campanha" value={message}
          onChange={e => setMessage(e.target.value)} maxLength={6000}
          className="mt-3 w-full rounded-xl bg-background p-3 text-sm leading-relaxed ring-1 ring-line outline-none focus:ring-cyan/40"/>
        <Button variant="outline" className="mt-2 border-line text-cyan" onClick={() => { setMessage(MIGRATION_MESSAGE); }}>Restaurar mensagem</Button>
      </section>}

      <section className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Andamento da campanha">
        <Metric label="Acessos elegíveis" value={clientsQuery.isLoading ? "…" : String(eligible.length)}/>
        <Metric label="Avisados (acessos)" value={String(avisados)}/>
        <Metric label="Sem telefone válido" value={String(missing)}/>
        <Metric label="Chamaram no novo" value={String(replied)}/>
      </section>
      <p className="mt-2 text-xs text-mist">{sent} mensagens confirmadas manualmente. Mesmo telefone: outro login é considerado avisado, mas não recebe nova mensagem. A contagem é de logins, não de pessoas.</p>

      <div className="mt-6 grid gap-3 rounded-2xl bg-panel/70 p-4 ring-1 ring-line sm:grid-cols-3">
        <input type="search" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
          placeholder="Buscar nome, login ou telefone" aria-label="Buscar cliente"
          className="h-10 min-w-0 rounded-xl bg-background px-3 text-sm ring-1 ring-line outline-none focus:ring-cyan/40"/>
        <Select value={server} onValueChange={v => { setServer(v); setPage(1); }}>
          <SelectTrigger className="h-10 border-line bg-background text-frost" aria-label="Servidor"><SelectValue/></SelectTrigger>
          <SelectContent className="border-line bg-panel2 text-frost">
            <SelectItem value="todos">Todos os servidores</SelectItem>
            {SERVERS.map(s => <SelectItem value={s} key={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filter} onValueChange={v => { setFilter(v as Filter); setPage(1); }}>
          <SelectTrigger className="h-10 border-line bg-background text-frost" aria-label="Situação da campanha"><SelectValue/></SelectTrigger>
          <SelectContent className="border-line bg-panel2 text-frost">
            <SelectItem value="todos">Todos os acessos</SelectItem>
            <SelectItem value="pendentes">Pendentes de aviso</SelectItem>
            <SelectItem value="enviados">Já avisados</SelectItem>
            <SelectItem value="sem-telefone">Sem telefone</SelectItem>
            <SelectItem value="confirmados">Chamaram no novo número</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {clientsQuery.isLoading || trackingQuery.isLoading
        ? <p className="mt-5 text-sm text-mist">Carregando clientes…</p>
        : clientsQuery.isError ? <p role="alert" className="mt-5 text-sm text-danger">Falha ao carregar os clientes.</p>
        : <>
          <p className="mt-4 text-xs text-mist">{filtered.length} acessos · página {currentPage} de {totalPages}</p>
          <div className="mt-3 space-y-3">
          {items.map(c => {
            const t = effectiveTracking(c.id, tracking);
            const phone = phoneFor(c);
            const draft = draftPhones[c.id] ?? phone;
            const dirty = draft.replace(/\D/g, "") !== phone.replace(/\D/g, "");
            const validPhone = !!canonicalPhone(phone);
            const otherSent = sentByOther(c);
            const isBusy = busy === c.id;
            return <article className="rounded-2xl bg-panel/80 p-4 ring-1 ring-line sm:p-5" key={c.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="break-words font-display text-lg font-semibold">{c.name}</h2>
                  <p className="mt-1 break-words text-sm text-cyan">{c.login} · {c.server}</p>
                  <p className="mt-1 text-xs text-mist">Vence {formatDate(c.due_date)} · {daysUntil(c.due_date) < 0 ? "Vencido há " + String(-daysUntil(c.due_date)) + " dia(s)" : daysUntil(c.due_date) === 0 ? "Vence hoje" : "Ativo"}</p>
                </div>
                <span className={t.sent_at || t.replied_at ? "rounded-full bg-ok/10 px-3 py-1.5 text-xs font-semibold text-ok ring-1 ring-ok/30" :
                    otherSent ? "rounded-full bg-cyan/10 px-3 py-1.5 text-xs font-semibold text-cyan ring-1 ring-cyan/30" :
                    "rounded-full bg-warn/10 px-3 py-1.5 text-xs font-semibold text-warn ring-1 ring-warn/30"}>
                  {t.replied_at ? "Chamou no número novo" : t.sent_at ? "Enviado em " + dateText(t.sent_at) : otherSent ? "Avisado no mesmo telefone" : "Mensagem pendente"}
                </span>
              </div>
              <div className="mt-4 flex flex-wrap items-end gap-2">
                <label className="min-w-[210px] flex-1 text-xs text-mist">
                  Número celular / WhatsApp
                  <input type="tel" inputMode="tel" maxLength={22}
                    aria-label={"WhatsApp de " + c.name} placeholder="21999999999"
                    value={draft} onChange={e => setDraftPhones(old => ({ ...old, [c.id]: e.target.value }))}
                    className="mt-1.5 h-10 w-full rounded-xl bg-background px-3 text-sm text-frost ring-1 ring-line outline-none focus:ring-cyan/40"/>
                </label>
                <Button variant="outline" className="h-10 border-line text-cyan"
                  disabled={!dirty || isBusy || disabledTracking} onClick={() => void savePhone(c)}>
                  Salvar número
                </Button>
              </div>
              <div className="mt-4 flex flex-wrap gap-x-6 gap-y-3">
                <label className="flex items-center gap-2 text-xs text-mist">
                  <input type="checkbox" className="size-4 accent-cyan" checked={t.phone_reviewed}
                    disabled={isBusy || !validPhone || dirty || disabledTracking}
                    onChange={e => void mark(c, { phone_reviewed: e.target.checked })}/>
                  Conferi o telefone
                </label>
                <label className="flex items-center gap-2 text-xs text-mist">
                  <input type="checkbox" className="size-4 accent-cyan" checked={t.agenda_updated}
                    disabled={isBusy || disabledTracking}
                    onChange={e => void mark(c, { agenda_updated: e.target.checked })}/>
                  Corrigi nome na agenda do iPhone
                </label>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button type="button" disabled={isBusy || !validPhone || dirty || !t.phone_reviewed || otherSent || !!t.sent_at || disabledTracking}
                  onClick={() => openDraft(c)} className="min-h-10 bg-cyan text-background hover:bg-cyan/80 disabled:opacity-40">
                  <MessageCircle size={17}/> Enviar pelo WhatsApp
                </Button>
                {!t.sent_at && !otherSent && <Button variant="outline" disabled={isBusy || !validPhone || dirty || !t.phone_reviewed || disabledTracking}
                  onClick={() => { if (window.confirm("Você realmente enviou a mensagem para este número?")) void mark(c, { sent_at: new Date().toISOString() }); }}
                  className="min-h-10 border-ok/40 text-ok"><Check size={16}/> Confirmar envio</Button>}
                {t.sent_at && <>
                  <Button variant="outline" className="min-h-10 border-line text-mist" disabled={isBusy || disabledTracking}
                    onClick={() => void mark(c, { sent_at: null, replied_at: null })}>Desfazer envio</Button>
                  <Button variant="outline" className="min-h-10 border-line text-cyan" disabled={isBusy || disabledTracking}
                    onClick={() => void mark(c, { replied_at: t.replied_at ? null : new Date().toISOString() })}>
                    {t.replied_at ? "Desfazer confirmação" : "Chamou no novo número"}
                  </Button>
                </>}
              </div>
              {otherSent && <p className="mt-2 text-xs text-warn">Este celular já foi avisado por outro login. Confira se é o mesmo responsável para evitar mensagem repetida.</p>}
              {!validPhone && <p className="mt-2 text-xs text-warn">Cadastre e salve o celular antes de preparar a mensagem.</p>}
              {!t.phone_reviewed && validPhone && !dirty && !t.sent_at && <p className="mt-2 text-xs text-mist">Confirme o telefone para habilitar o envio.</p>}
              {opened[c.id] && !t.sent_at && <p className="mt-2 text-xs text-warn">Abertura do WhatsApp não prova envio. Confirme no MaxFlix somente depois de enviar a mensagem.</p>}
            </article>;
          })}
          </div>
          {filtered.length > 20 && <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-mist">Exibindo {(currentPage - 1) * 20 + 1}–{Math.min(currentPage * 20, filtered.length)} de {filtered.length}</p>
            <div className="flex items-center gap-2">
              <Button variant="outline" className="border-line text-cyan" disabled={currentPage === 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}>Anterior</Button>
              <span className="text-xs text-mist">{currentPage}/{totalPages}</span>
              <Button variant="outline" className="border-line text-cyan" disabled={currentPage >= totalPages}
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}>Próxima</Button>
            </div>
          </div>}
          {filtered.length === 0 && <p className="mt-5 rounded-xl bg-panel/70 p-5 text-center text-sm text-mist">Nenhum acesso encontrado.</p>}
        </>
      }
    </div>
  </main>;
}

function Metric({label, value}: {label:string; value:string}) {
  return <div className="rounded-xl bg-panel/80 p-3 ring-1 ring-line sm:p-4">
    <p className="text-[11px] uppercase tracking-wide text-mist">{label}</p>
    <p className="mt-2 font-display text-2xl font-semibold text-cyan">{value}</p>
  </div>;
}
