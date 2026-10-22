import { canonicalPhone, type Client } from "./iptv";

export type ReferralMovement = {
  id: string;
  client_id: string;
  referred_client_id: string | null;
  kind: "indicacao" | "resgate" | "expiracao";
  points: number;
  note: string | null;
  created_at: string;
};

export type ReferralReward = {
  id: string;
  client_id: string;
  movement_id: string;
  reward: "mes_gratis" | "fire_stick" | "hy320";
  status: "pendente" | "concluido";
  created_at: string;
  completed_at: string | null;
};

export const FREE_MONTH_COST = 2;
export const DEVICE_COST = 10;

export function referralBalance(clientId: string, movements: ReferralMovement[]): number {
  return Math.max(
    0,
    movements.reduce((total, movement) =>
      movement.client_id === clientId ? total + movement.points : total, 0),
  );
}

export function referralsToPrize(balance: number): number {
  return Math.max(0, DEVICE_COST - balance);
}

export function referralMessage(client: Pick<Client, "name">, availablePoints: number): string {
  const firstName = client.name.trim().split(/\s+/)[0] || "Olá";
  const points = Math.max(0, availablePoints);
  const missing = referralsToPrize(points);
  const nextStep = missing === 0
    ? "🏆 *PARABÉNS!* Você já tem pontos para solicitar seu *Fire TV Stick* ou *Projetor HY320*! 🎉"
    : `🔥 Faltam apenas *${missing} ${missing === 1 ? "indicação" : "indicações"}* para você conquistar um *Fire TV Stick* ou *Projetor HY320*!`;
  return `🍿 *OLÁ, ${firstName.toUpperCase()}!* 😊

🎁 *SEUS PONTOS NA MAXFLIX*

⭐ Você possui *${points} ${points === 1 ? "PONTO" : "PONTOS"}* disponíveis!

${nextStep}

💡 *VOCÊ ESCOLHE!*
✅ *2 pontos:* 1 mês grátis (1 tela).
🏆 *10 pontos:* Fire TV Stick ou Projetor HY320.

📲 Cada amigo que contratar e pagar a primeira mensalidade vale *1 ponto*!

⚠️ Para manter seus pontos, não fique com a assinatura desativada por mais de um dia.

💙 Indique seus amigos e continue acumulando! 😉`;
}

export function referralWhatsAppUrl(phone: string | null, message: string): string | null {
  const normalized = canonicalPhone(phone);
  return normalized ? `https://wa.me/${normalized}?text=${encodeURIComponent(message)}` : null;
}

export function pendingFreeMonths(clientId: string, rewards: ReferralReward[]): number {
  return rewards.filter(r =>
    r.client_id === clientId && r.reward === "mes_gratis" && r.status === "pendente"
  ).length;
}
