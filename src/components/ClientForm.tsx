import { useEffect, useState } from "react";
import {
  SERVERS,
  SERVER_COSTS,
  formatBRL,
  formatDate,
  getStatus,
  type Client,
} from "@/lib/iptv";

export type ClientDraft = {
  name: string;
  login: string;
  server: string;
  cost: string;
  paid: string;
  due_date: string;
  financial_due_date: string;
  whatsapp: string;
  referred_by_client_id: string;
  referral_first_payment_confirmed: boolean;
};

function toDraft(client: Client | null): ClientDraft {
  if (!client) {
    return {
      name: "",
      login: "",
      server: SERVERS[0],
      cost: String(SERVER_COSTS[SERVERS[0]] ?? ""),
      paid: "",
      due_date: "",
      financial_due_date: "",
      whatsapp: "",
      referred_by_client_id: "",
      referral_first_payment_confirmed: false,
    };
  }
  return {
    name: client.name,
    login: client.login,
    server: client.server,
    cost: String(client.cost),
    paid: String(client.paid),
    due_date: client.due_date,
    financial_due_date: client.financial_due_date ?? "",
    whatsapp: client.whatsapp ?? "",
    referred_by_client_id: client.referred_by_client_id ?? "",
    referral_first_payment_confirmed: client.referral_first_payment_confirmed ?? false,
  };
}

const fieldClass =
  "mt-1.5 w-full rounded-xl bg-panel ring-1 ring-line px-3 py-2.5 text-sm text-frost placeholder:text-mist/50 outline-none focus:ring-cyan/50";
const labelClass = "text-xs uppercase tracking-wide text-mist";

export function ClientForm({
  client,
  clients,
  onCancel,
  onSave,
  saving,
  saveError,
}: {
  client: Client | null;
  clients: Client[];
  saveError?: string | null;
  onCancel: () => void;
  onSave: (draft: ClientDraft) => void;
  saving: boolean;
}) {
  const [draft, setDraft] = useState<ClientDraft>(() => toDraft(client));
  const [error, setError] = useState<string | null>(null);
  const [referrerSearch, setReferrerSearch] = useState("");

  useEffect(() => {
    setDraft(toDraft(client));
    setError(null);
    setReferrerSearch("");
  }, [client]);

  const cost = Number(draft.cost.replace(",", ".")) || 0;
  const paid = Number(draft.paid.replace(",", ".")) || 0;
  const profit = paid - cost;
  const referrer = clients.find(item => item.id === draft.referred_by_client_id);
  const referralAlreadyConfirmed = !!client?.referral_first_payment_confirmed;

  const set = (patch: Partial<ClientDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const onServerChange = (server: string) => {
    const preset = SERVER_COSTS[server];
    set({ server, ...(preset != null ? { cost: String(preset) } : {}) });
  };

  const submit = () => {
    if (!draft.name.trim() || !draft.login.trim() || !draft.due_date) {
      setError("Preencha nome, login e data de vencimento.");
      return;
    }
    if (draft.referral_first_payment_confirmed && !draft.referred_by_client_id) {
      setError("Selecione quem indicou o cliente antes de confirmar o pagamento.");
      return;
    }
    if (!referralAlreadyConfirmed && draft.referral_first_payment_confirmed && paid <= 0) {
      setError("Para confirmar o primeiro pagamento, informe um valor pago maior que zero.");
      return;
    }
    setError(null);
    onSave(draft);
  };

  const packageNotice =
    draft.financial_due_date && draft.due_date && draft.financial_due_date > draft.due_date
      ? `Renovação sem custo — pacote pago até ${formatDate(draft.financial_due_date)}`
      : null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-background/80 p-4 backdrop-blur-sm">
      <section className="mx-auto mt-6 max-w-3xl rounded-2xl bg-panel2/90 p-5 ring-1 ring-line sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-xl font-semibold text-frost">
              {client ? "Editar cliente" : "Novo cliente"}
            </h2>
            <p className="mt-1 max-w-[45ch] text-sm text-mist text-pretty">
              O custo é preenchido pelo servidor e o lucro é recalculado automaticamente.
            </p>
          </div>
          <button onClick={onCancel} className="font-display shrink-0 text-sm font-medium text-mist hover:text-frost">
            Fechar
          </button>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block">
            <span className={labelClass}>Nome do cliente</span>
            <input
              className={fieldClass}
              value={draft.name}
              maxLength={120}
              onChange={(e) => set({ name: e.target.value })}
              placeholder="Ex.: Marcos Vieira"
            />
          </label>
          <label className="block">
            <span className={labelClass}>Login IPTV</span>
            <input
              className={fieldClass}
              value={draft.login}
              maxLength={120}
              onChange={(e) => set({ login: e.target.value })}
              placeholder="marcos_vieira"
            />
          </label>
          <label className="block">
            <span className={labelClass}>Servidor</span>
            <select
              className={fieldClass}
              value={draft.server}
              onChange={(e) => onServerChange(e.target.value)}
            >
              {SERVERS.map((s) => (
                <option key={s} value={s} className="bg-panel">
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={labelClass}>Custo do crédito</span>
            <div className="mt-1.5 flex items-center rounded-xl bg-panel px-3 ring-1 ring-line">
              <span className="text-sm text-mist">R$</span>
              <input
                className="w-full bg-transparent py-2.5 pl-2 text-sm text-frost outline-none"
                value={draft.cost}
                inputMode="decimal"
                onChange={(e) => set({ cost: e.target.value })}
                placeholder="0,00"
              />
            </div>
          </label>
          <label className="block">
            <span className={labelClass}>Valor pago pelo cliente</span>
            <div className="mt-1.5 flex items-center rounded-xl bg-panel px-3 ring-1 ring-line">
              <span className="text-sm text-mist">R$</span>
              <input
                className="w-full bg-transparent py-2.5 pl-2 text-sm text-frost outline-none"
                value={draft.paid}
                inputMode="decimal"
                onChange={(e) => set({ paid: e.target.value })}
                placeholder="0,00"
              />
            </div>
          </label>
          <div className="block">
            <span className={labelClass}>Lucro (automático)</span>
            <div className="mt-1.5 flex items-center justify-between rounded-xl bg-ok/10 px-3 py-2.5 ring-1 ring-ok/30">
              <span className="text-sm text-ok/80">valor pago − custo</span>
              <span className="font-display text-sm font-semibold text-ok">{formatBRL(profit)}</span>
            </div>
          </div>
          <label className="block">
            <span className={labelClass}>Data de vencimento</span>
            <input
              type="date"
              className={fieldClass}
              value={draft.due_date}
              onChange={(e) => set({ due_date: e.target.value })}
            />
          </label>
          <label className="block">
            <span className={labelClass}>Vencimento financeiro (pacote)</span>
            <input
              type="date"
              className={fieldClass}
              value={draft.financial_due_date}
              onChange={(e) => set({ financial_due_date: e.target.value })}
            />
          </label>
          <div className="sm:col-span-2 rounded-xl bg-background/70 p-4 ring-1 ring-cyan/20">
            <p className="font-display text-sm font-semibold text-frost">🎁 Indicação de cliente</p>
            <p className="mt-1 text-xs text-mist">
              Quem indicou este cliente? Se não houve indicação, deixe como "Sem indicação".
            </p>
            <label className="mt-3 block">
              <span className={labelClass}>Indicado por (opcional)</span>
              <input
                type="search"
                className={fieldClass}
                value={referrerSearch}
                onChange={e => setReferrerSearch(e.target.value)}
                placeholder="Buscar pelo nome, login ou WhatsApp"
                aria-label="Pesquisar cliente indicador"
                disabled={referralAlreadyConfirmed}
              />
              <select
                className={fieldClass}
                value={draft.referred_by_client_id}
                disabled={referralAlreadyConfirmed}
                onChange={e => {
                  set({
                    referred_by_client_id: e.target.value,
                    referral_first_payment_confirmed: false,
                  });
                  setReferrerSearch("");
                }}
              >
                <option value="">Sem indicação</option>
                {clients
                  .filter(candidate => candidate.id !== client?.id)
                  .filter(candidate =>
                    !referrerSearch.trim()
                    || candidate.id === draft.referred_by_client_id
                    || `${candidate.name} ${candidate.login} ${candidate.whatsapp ?? ""}`
                      .toLocaleLowerCase("pt-BR").includes(referrerSearch.trim().toLocaleLowerCase("pt-BR"))
                  )
                  .slice()
                  .sort((a,b) => a.name.localeCompare(b.name, "pt-BR"))
                  .map(candidate => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name} — {candidate.whatsapp || candidate.login}
                    </option>
                  ))}
              </select>
            </label>
            {draft.referred_by_client_id && (
              <>
                <label className="mt-3 flex items-start gap-2 text-sm text-frost">
                  <input
                    type="checkbox"
                    className="mt-1 size-4 accent-cyan-500"
                    checked={draft.referral_first_payment_confirmed}
                    disabled={referralAlreadyConfirmed}
                    onChange={e => set({ referral_first_payment_confirmed: e.target.checked })}
                  />
                  <span>
                    <strong>Primeiro pagamento confirmado</strong>
                    <span className="mt-1 block text-xs text-mist">
                      {referralAlreadyConfirmed
                        ? "Indicação já pontuada. O vínculo permanece protegido no histórico."
                        : "Marque somente após receber o pagamento. Ao salvar, o indicador ganha 1 ponto automaticamente."}
                    </span>
                  </span>
                </label>
                {referrer && getStatus(referrer).key === "vencido" && !referralAlreadyConfirmed && (
                  <p className="mt-2 text-xs text-warn">
                    O indicador está com a assinatura vencida; é necessário regularizá-la antes de creditar pontos.
                  </p>
                )}
                {!draft.referral_first_payment_confirmed && (
                  <p className="mt-2 text-xs text-cyan">
                    A indicação ficará pendente, sem pontuar, até você confirmar o primeiro pagamento.
                  </p>
                )}
              </>
            )}
          </div>
          <label className="block sm:col-span-2">
            <span className={labelClass}>WhatsApp</span>
            <input
              className={fieldClass}
              value={draft.whatsapp}
              maxLength={30}
              onChange={(e) => set({ whatsapp: e.target.value })}
              placeholder="+55 11 91234-5678"
            />
          </label>
        </div>

        {packageNotice && (
          <p className="mt-4 rounded-xl bg-cyan/10 px-3 py-2 text-xs text-cyan ring-1 ring-cyan/30">
            {packageNotice}
          </p>
        )}
        {(error || saveError) && <p role="alert" className="mt-4 text-sm text-danger">{error || saveError}</p>}

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            onClick={submit}
            disabled={saving}
            className="font-display w-full rounded-xl bg-cyan px-4 py-2.5 text-sm font-semibold text-background ring-1 ring-cyan/40 transition-transform hover:-translate-y-px disabled:opacity-60 sm:w-auto"
          >
            {saving ? "Salvando…" : "Salvar cliente"}
          </button>
          <button
            onClick={onCancel}
            className="font-display w-full rounded-xl bg-panel px-4 py-2.5 text-sm font-medium text-mist ring-1 ring-line hover:bg-frost/5 sm:w-auto"
          >
            Cancelar
          </button>
          <p className="text-xs text-mist text-pretty sm:ml-auto sm:max-w-[38ch]">
            Clientes vencidos têm custo e valor zerados; renovar restaura o último valor do
            histórico.
          </p>
        </div>
      </section>
    </div>
  );
}
