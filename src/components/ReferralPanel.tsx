import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Gift, MessageCircle, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getStatus, isPackageCovered, formatDate, type Client } from "@/lib/iptv";
import {
  DEVICE_COST,
  FREE_MONTH_COST,
  pendingFreeMonths,
  referralBalance,
  referralMessage,
  referralsToPrize,
  referralWhatsAppUrl,
  type ReferralMovement,
  type ReferralReward,
} from "@/lib/referrals";

type Props = {
  clients: Client[];
  initialClient: Client | null;
  onClose: () => void;
  onUseFreeMonth: (client: Client) => Promise<boolean>;
};

const fieldClass =
  "mt-1 w-full min-w-0 rounded-xl bg-background px-3 py-2.5 text-sm text-frost ring-1 ring-line outline-none focus:ring-cyan/40";
const smallButton =
  "rounded-xl bg-panel2 px-3 py-2.5 text-sm font-medium text-frost ring-1 ring-line hover:bg-frost/5 disabled:cursor-not-allowed disabled:opacity-40";

export function ReferralPanel({ clients, initialClient, onClose, onUseFreeMonth }: Props) {
  const qc = useQueryClient();
  const [clientId, setClientId] = useState(
    initialClient?.id ?? clients.find(c => getStatus(c).key !== "vencido")?.id ?? ""
  );
  const [showInactiveHistory, setShowInactiveHistory] = useState(false);
  const [referredId, setReferredId] = useState("");
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const movementsQuery = useQuery({
    queryKey: ["referral-movements"],
    queryFn: async () => {
      const all: ReferralMovement[] = [];
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await supabase.from("referral_point_movements").select("*")
          .order("created_at", { ascending: false }).order("id", { ascending: false })
          .range(offset, offset + 499);
        if (error) throw error;
        all.push(...(data ?? []) as ReferralMovement[]);
        if (!data || data.length < 500) return all;
      }
    },
  });
  const rewardsQuery = useQuery({
    queryKey: ["referral-rewards"],
    queryFn: async () => {
      const all: ReferralReward[] = [];
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await supabase.from("referral_rewards").select("*")
          .order("created_at", { ascending: false }).order("id", { ascending: false })
          .range(offset, offset + 499);
        if (error) throw error;
        all.push(...(data ?? []) as ReferralReward[]);
        if (!data || data.length < 500) return all;
      }
    },
  });

  useEffect(() => {
    // The reset is idempotent and writes the audit entry only if an overdue client has points.
    let cancelled = false;
    void (async () => {
      const { error } = await supabase.rpc("referral_reset_expired");
      if (!cancelled) {
        if (error) setNotice(`Não foi possível verificar os pontos vencidos: ${error.message}`);
        else void qc.invalidateQueries({ queryKey: ["referral-movements"] });
      }
    })();
    return () => { cancelled = true; };
  }, [qc]);

  const movements = movementsQuery.data ?? [];
  const rewards = rewardsQuery.data ?? [];
  const client = clients.find(item => item.id === clientId);
  const balance = client ? referralBalance(client.id, movements) : 0;
  const earned = movements.filter(item => item.client_id === clientId && item.kind === "indicacao").length;
  const usedPoints = movements.filter(item => item.client_id === clientId && item.kind === "resgate")
    .reduce((total, item) => total - item.points, 0);
  const freeMonths = pendingFreeMonths(clientId, rewards);
  const history = movements.filter(item => item.client_id === clientId);
  const pendingPrizes = rewards.filter(item =>
    item.client_id === clientId && item.reward !== "mes_gratis" && item.status === "pendente"
  );
  const alreadyIndicated = useMemo(() =>
    new Set(movements.filter(item => item.kind === "indicacao").map(item => item.referred_client_id)),
    [movements],
  );
  const active = !!client && getStatus(client).key !== "vencido";
  const pendingLinked = clients.filter(item => item.referred_by_client_id === clientId && !alreadyIndicated.has(item.id));
  const message = client ? referralMessage(client, balance) : "";
  const messageLink = client ? referralWhatsAppUrl(client.whatsapp, message) : null;

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["referral-movements"] }),
      qc.invalidateQueries({ queryKey: ["referral-rewards"] }),
    ]);
  };

  const awardMutation = useMutation({
    mutationFn: async () => {
      if (!clientId || !referredId || !paymentConfirmed) throw new Error("Selecione o indicado e confirme o primeiro pagamento.");
      const { error } = await supabase.rpc("referral_award", {
        p_client_id: clientId, p_referred_client_id: referredId, p_payment_confirmed: true,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setPaymentConfirmed(false);
      setReferredId("");
      setNotice("Indicação confirmada! +1 ponto registrado no histórico.");
      await refresh();
      await qc.invalidateQueries({ queryKey: ["clients"] });
    },
    onError: (error: Error) => setNotice(`Falha ao registrar indicação: ${error.message}`),
  });

  const pendingPaymentMutation = useMutation({
    mutationFn: async (referredClientId: string) => {
      const { error } = await supabase.rpc("referral_award", {
        p_client_id: clientId,
        p_referred_client_id: referredClientId,
        p_payment_confirmed: true,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setNotice("Primeiro pagamento confirmado! +1 ponto creditado automaticamente.");
      await refresh();
      await qc.invalidateQueries({ queryKey: ["clients"] });
    },
    onError: (error: Error) => setNotice(`Não foi possível pontuar: ${error.message}`),
  });

  const claimMutation = useMutation({
    mutationFn: async (reward: "mes_gratis" | "fire_stick" | "hy320") => {
      const { error } = await supabase.rpc("referral_claim", { p_client_id: clientId, p_reward: reward });
      if (error) throw error;
      return reward;
    },
    onSuccess: async reward => {
      setNotice(reward === "mes_gratis"
        ? "2 pontos utilizados! 1 mês grátis reservado para a próxima renovação elegível."
        : "10 pontos utilizados! Prêmio físico registrado como pendente de entrega.");
      await refresh();
    },
    onError: (error: Error) => setNotice(`Falha ao resgatar: ${error.message}`),
  });

  const deliverMutation = useMutation({
    mutationFn: async (rewardId: string) => {
      const { error } = await supabase.rpc("referral_mark_delivered", { p_reward_id: rewardId });
      if (error) throw error;
    },
    onSuccess: async () => {
      setNotice("Entrega registrada com sucesso.");
      await refresh();
    },
    onError: (error: Error) => setNotice(`Falha ao registrar entrega: ${error.message}`),
  });

  const useMonth = async () => {
    if (!client || busy) return;
    setBusy(true);
    try {
      const done = await onUseFreeMonth(client);
      if (done) {
        setNotice("Mês grátis aplicado à renovação. Nenhum pagamento foi adicionado ao faturamento.");
        await refresh();
      } else {
        setNotice("Não foi possível aplicar o mês grátis. Confira o aviso no painel.");
      }
    } finally {
      setBusy(false);
    }
  };

  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setNotice("Mensagem com os asteriscos copiada!");
    } catch {
      setNotice("Não foi possível copiar automaticamente. Selecione a mensagem no campo abaixo.");
    }
  };

  const loading = movementsQuery.isLoading || rewardsQuery.isLoading;
  const error = movementsQuery.error ?? rewardsQuery.error;
  const actionBusy = awardMutation.isPending || pendingPaymentMutation.isPending || claimMutation.isPending || deliverMutation.isPending || busy;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-background/90 p-3 backdrop-blur-sm sm:p-6">
      <section className="mx-auto max-w-5xl rounded-2xl bg-panel2 p-4 text-frost ring-1 ring-line shadow-2xl sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-display text-xl font-semibold">
              <Gift size={22} className="text-cyan" /> Indicações e recompensas
            </h2>
            <p className="mt-1 text-xs text-mist">
              1 indicação paga = 1 ponto · 2 pontos = mês grátis · 10 pontos = aparelho.
            </p>
          </div>
          <button aria-label="Fechar indicações" onClick={onClose} className={smallButton}><X size={18} /></button>
        </div>

        <div className="mt-5">
          <label htmlFor="referral-client" className="text-xs font-semibold text-mist">Cliente indicador</label>
          <select id="referral-client" value={clientId}
            onChange={event => { setClientId(event.target.value); setReferredId(""); setNotice(""); }}
            className={fieldClass}>
            {clients
              .filter(c =>
                getStatus(c).key !== "vencido" || c.id === clientId || showInactiveHistory
              )
              .slice().sort((a,b) => a.name.localeCompare(b.name, "pt-BR"))
              .map(c => (
                <option key={c.id} value={c.id}>
                  {c.name} — {c.login} ({c.server})
                  {getStatus(c).key === "vencido" ? " · Inativo (histórico)" : ""}
                </option>
              ))}
          </select>
          <label className="mt-2 flex items-center gap-2 text-xs text-mist">
            <input type="checkbox" checked={showInactiveHistory}
              onChange={event => setShowInactiveHistory(event.target.checked)} />
            Mostrar clientes inativos somente para consultar histórico e corrigir pontos
          </label>
        </div>

        {loading ? <p className="mt-6 text-sm text-mist">Carregando pontos e resgates…</p>
          : error ? <p role="alert" className="mt-6 text-sm text-danger">
              Não foi possível carregar as indicações. {error instanceof Error ? error.message : "Tente novamente."}
            </p>
          : client && (
            <>
              <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
                {[
                  { label: "Pontos disponíveis", value: String(balance), highlight: true },
                  { label: "Indicações confirmadas", value: String(earned) },
                  { label: "Pontos já utilizados", value: String(usedPoints) },
                  { label: "Faltam para aparelho", value: String(referralsToPrize(balance)) },
                ].map(item => (
                  <div key={item.label} className="rounded-xl bg-background/70 p-3 ring-1 ring-line">
                    <p className="text-xs text-mist">{item.label}</p>
                    <p className={`mt-1 font-display text-2xl font-semibold ${item.highlight ? "text-cyan" : "text-frost"}`}>{item.value}</p>
                  </div>
                ))}
              </div>
              {!active && (
                <p role="alert" className="mt-4 rounded-xl bg-warn/10 p-3 text-sm text-warn ring-1 ring-warn/30">
                  Assinatura vencida. É necessário reativar para registrar indicações ou resgatar pontos.
                  Após mais de um dia de inatividade, o saldo é zerado.
                </p>
              )}
              {pendingLinked.length > 0 && (
                <section className="mt-5 rounded-xl bg-cyan/5 p-4 ring-1 ring-cyan/30">
                  <h3 className="font-display font-semibold">⏳ Aguardando primeiro pagamento ({pendingLinked.length})</h3>
                  <p className="mt-1 text-xs text-mist">
                    Estes clientes já informaram quem indicou no cadastro, mas ainda não geraram pontos.
                    Confirme somente após receber o pagamento.
                  </p>
                  <div className="mt-3 space-y-2">
                    {pendingLinked.map(pending => (
                      <div key={pending.id} className="flex flex-col gap-2 rounded-lg bg-panel p-3 ring-1 ring-line sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className="break-words text-sm font-medium">{pending.name}</p>
                          <p className="text-xs text-mist">{pending.login} · {pending.server}
                            {getStatus(pending).key === "vencido" ? " · Vencido: ajuste a data antes de confirmar" : ""}
                          </p>
                        </div>
                        <button className={smallButton}
                          disabled={!active || actionBusy || getStatus(pending).key === "vencido"}
                          onClick={() => {
                            if (window.confirm(`Confirma que ${pending.name} realizou o primeiro pagamento? O indicador receberá 1 ponto.`)) {
                              pendingPaymentMutation.mutate(pending.id);
                            }
                          }}>
                          Confirmar pagamento (+1 ponto)
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              )}
              <div className="mt-5 grid gap-4 lg:grid-cols-2">
                <section className="rounded-xl bg-background/60 p-4 ring-1 ring-line">
                  <h3 className="font-display font-semibold">➕ Registro manual (clientes antigos)</h3>
                  <p className="mt-1 text-xs text-mist">Para clientes novos, prefira o campo "Indicado por" no cadastro. Aqui você também pode registrar indicações antigas.</p>
                  <label htmlFor="referred-client" className="mt-4 block text-xs text-mist">Cliente indicado</label>
                  <select id="referred-client" value={referredId} onChange={e => setReferredId(e.target.value)}
                    className={fieldClass} disabled={!active || actionBusy}>
                    <option value="">Selecione um cliente cadastrado</option>
                    {clients.slice().sort((a,b) => a.name.localeCompare(b.name, "pt-BR"))
                      .filter(c => c.id !== clientId
                        && getStatus(c).key !== "vencido"
                        && !alreadyIndicated.has(c.id)
                        && (!c.referred_by_client_id || c.referred_by_client_id === clientId))
                      .map(c => <option key={c.id} value={c.id}>{c.name} — {c.login}</option>)}
                  </select>
                  <label className="mt-4 flex items-start gap-2 text-sm text-mist">
                    <input type="checkbox" checked={paymentConfirmed} onChange={e => setPaymentConfirmed(e.target.checked)}
                      disabled={!active || actionBusy} className="mt-1" />
                    Confirmo que o indicado realizou o primeiro pagamento.
                  </label>
                  <button className="mt-4 w-full rounded-xl bg-cyan px-4 py-2.5 text-sm font-semibold text-background disabled:opacity-40"
                    disabled={!active || !referredId || !paymentConfirmed || actionBusy}
                    onClick={() => awardMutation.mutate()}>
                    Confirmar indicação (+1 ponto)
                  </button>
                </section>

                <section className="rounded-xl bg-background/60 p-4 ring-1 ring-line">
                  <h3 className="font-display font-semibold">🎁 Resgatar recompensas</h3>
                  <p className="mt-1 text-xs text-mist">O resgate fica registrado e desconta os pontos imediatamente.</p>
                  <button onClick={() => claimMutation.mutate("mes_gratis")}
                    disabled={!active || balance < FREE_MONTH_COST || actionBusy}
                    className={`mt-4 w-full ${smallButton}`}>
                    Trocar 2 pontos por 1 mês grátis
                  </button>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button onClick={() => claimMutation.mutate("fire_stick")}
                      disabled={!active || balance < DEVICE_COST || actionBusy} className={smallButton}>
                      10 pts → Fire TV Stick
                    </button>
                    <button onClick={() => claimMutation.mutate("hy320")}
                      disabled={!active || balance < DEVICE_COST || actionBusy} className={smallButton}>
                      10 pts → Projetor HY320
                    </button>
                  </div>
                  <p className="mt-4 text-sm text-frost">📅 Meses grátis pendentes: <strong>{freeMonths}</strong></p>
                  {freeMonths > 0 && (
                    <>
                      <button onClick={useMonth}
                        disabled={actionBusy || isPackageCovered(client)}
                        className={`mt-2 w-full ${smallButton}`}>
                        Aplicar 1 mês grátis nesta renovação
                      </button>
                      {isPackageCovered(client) && (
                        <p className="mt-2 text-xs text-mist">
                          Aguarde terminar o período já pago ({formatDate(client.financial_due_date)}).
                          O mês grátis continuará reservado e não será perdido.
                        </p>
                      )}
                    </>
                  )}
                  {pendingPrizes.map(reward => (
                    <div key={reward.id} className="mt-3 rounded-lg bg-panel p-3 text-sm ring-1 ring-line">
                      🎁 {reward.reward === "hy320" ? "Projetor HY320" : "Fire TV Stick"} — aguardando entrega
                      <button onClick={() => deliverMutation.mutate(reward.id)} disabled={actionBusy}
                        className="mt-2 block text-xs font-semibold text-cyan hover:underline disabled:opacity-40">
                        Marcar como entregue
                      </button>
                    </div>
                  ))}
                </section>
              </div>

              <section className="mt-5 rounded-xl bg-background/60 p-4 ring-1 ring-line">
                <h3 className="font-display font-semibold">💬 Mensagem de incentivo personalizada</h3>
                <p className="mt-1 text-xs text-mist">
                  Mostra os pontos disponíveis e quantas indicações pagas faltam para o aparelho.
                  Apenas abre o WhatsApp; o envio é manual.
                </p>
                <textarea readOnly rows={8} value={message}
                  aria-label="Mensagem de incentivo" className={`${fieldClass} resize-y font-mono text-xs`} />
                <div className="mt-3 flex flex-wrap gap-2">
                  {messageLink && (
                    <a href={messageLink} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 rounded-xl bg-cyan px-4 py-2.5 text-sm font-semibold text-background">
                      <MessageCircle size={17} /> Abrir WhatsApp com texto
                    </a>
                  )}
                  <button onClick={copyMessage} className={smallButton}>Copiar mensagem com *</button>
                  {!messageLink && <span className="self-center text-xs text-warn">Cliente sem WhatsApp válido. Copie o texto.</span>}
                </div>
              </section>

              <section className="mt-5 rounded-xl bg-background/60 p-4 ring-1 ring-line">
                <h3 className="font-display font-semibold">📋 Histórico de pontos</h3>
                {history.length === 0 ? <p className="mt-2 text-sm text-mist">Nenhuma indicação ou resgate registrado ainda.</p> : (
                  <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
                    {history.map(movement => (
                      <div key={movement.id} className="flex items-start justify-between gap-3 rounded-lg bg-panel px-3 py-2 text-xs">
                        <div>
                          <p className="font-medium text-frost">
                            {movement.kind === "indicacao"
                              ? `Indicação de ${clients.find(c => c.id === movement.referred_client_id)?.name ?? "cliente excluído"}`
                              : movement.kind === "expiracao" ? "Saldo zerado por inatividade"
                              : movement.note ?? "Resgate"}
                          </p>
                          <p className="mt-1 text-mist">{new Date(movement.created_at).toLocaleString("pt-BR")}</p>
                        </div>
                        <span className={`shrink-0 font-bold ${movement.points > 0 ? "text-ok" : "text-warn"}`}>
                          {movement.points > 0 ? "+" : ""}{movement.points} pt{Math.abs(movement.points) === 1 ? "" : "s"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        {notice && <p role="status" className="mt-4 rounded-xl bg-cyan/10 p-3 text-sm text-cyan ring-1 ring-cyan/30">{notice}</p>}
        <div className="mt-5 flex justify-end">
          <button onClick={onClose} className={smallButton}>Fechar</button>
        </div>
      </section>
    </div>
  );
}
