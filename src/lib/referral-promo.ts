import { canonicalPhone } from "./whatsapp-campaign";
import { daysUntil } from "./iptv";

export const REFERRAL_CAMPAIGN_KEY = "indique-e-ganhe-2026-11";

export const REFERRAL_PROMO_MESSAGE = `🎁 *INDIQUE AMIGOS E GANHE PRÊMIOS!*

🍿 Na MaxFlix, suas indicações valem pontos que podem virar mensalidades grátis ou até um aparelho novinho! 😍

🚀 *COMO FUNCIONA?*
✅ Cada amigo que contratar e realizar o primeiro pagamento vale *1 PONTO!*

━━━━━━━━━━━━━━━━
🏆 *ESCOLHA SEU PRÊMIO!*

⭐ *2 PONTOS*
🎁 Ganhe *1 MÊS GRÁTIS* de uma tela!

🔥 *10 PONTOS*
🎁 Ganhe um *FIRE TV STICK ou PROJETOR HY320!*

━━━━━━━━━━━━━━━━
💡 *VOCÊ ESCOLHE!*
Pode trocar seus pontos por meses grátis ou acumular para ganhar um aparelho!

⚠️ *IMPORTANTE:*
Se sua assinatura ficar desativada por mais de 1 dia, seus pontos serão zerados.

📲 Peça aos amigos para informarem seu nome na contratação!

💙 Quanto mais indicar, mais perto do prêmio! 😉`;

export type ReferralPromoClient = {
  id: string;
  name: string;
  login: string;
  server: string;
  due_date: string;
  whatsapp: string | null;
  access_type: string;
};

export type ReferralRecipient = {
  key: string;
  phone: string | null;
  accounts: ReferralPromoClient[];
};

/** One outreach recipient per normalized number (not per IPTV account). */
export function buildReferralRecipients(
  clients: readonly ReferralPromoClient[],
  current?: Date,
): ReferralRecipient[] {
  const grouped = new Map<string, ReferralRecipient>();
  const eligible = clients
    .filter(client =>
      (client.access_type === "padrao" || client.access_type === "pacote_pago")
      && daysUntil(client.due_date, current) >= 0,
    )
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  for (const client of eligible) {
    const phone = canonicalPhone(client.whatsapp);
    const key = phone ?? "sem-telefone:" + client.id;
    const existing = grouped.get(key);
    if (existing) existing.accounts.push(client);
    else grouped.set(key, { key, phone, accounts: [client] });
  }
  return [...grouped.values()];
}
