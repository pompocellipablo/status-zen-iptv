import { daysUntil, type Client } from "./iptv";

export type CampaignAccess = Pick<Client, "id" | "name" | "login" | "server" | "due_date" | "whatsapp">;

export type CampaignTracking = {
  client_id: string;
  phone_reviewed: boolean;
  agenda_updated: boolean;
  sent_at: string | null;
  replied_at: string | null;
  payer_name: string | null;
  updated_at?: string;
};

export const NEW_WHATSAPP = "21995344044";

export const MIGRATION_MESSAGE = `Tenho uma novidade: agora meu atendimento vai ter um nome, *MaxFlix*, e um WhatsApp exclusivo para os clientes. Continuo sendo eu cuidando de tudo! 🤝

Essa mudança é para organizar melhor as conversas, separar o atendimento das mensagens pessoais e do trabalho e conseguir dar mais atenção ao suporte e às renovações.

📲 *Meu novo número de atendimento: (21) 99534-4044*

💳 *Chave Pix (celular): (21) 99534-4044*
Se for fazer um pagamento por Pix, você também pode usar esse número como chave. Confirme os dados do recebedor antes de concluir a transferência.

Salve este contato como *Pablo — MaxFlix*. A partir de agora, este será o novo canal para receber nossas atualizações, avisos importantes e promoções.

Também é importante salvar o novo número na sua agenda. Se o contato não estiver salvo, você poderá deixar de receber essas informações.

Daqui para frente, peço que me chame por esse número para tratar de suporte, renovações e outras dúvidas. 😊

Obrigado pela confiança de sempre! Essa organização vai facilitar para todo mundo. 💙`;

export function eligibleForMigration(client: CampaignAccess, current?: Date): boolean {
  return daysUntil(client.due_date, current) >= -10;
}

/** Remove separators, accept 10-11 BR local digits or 12-13 with prefix 55. */
export function canonicalPhone(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) return digits;
  if (digits.length === 10 || digits.length === 11) return "55" + digits;
  return null;
}

export function campaignWhatsAppLink(phone: string, message = MIGRATION_MESSAGE): string | null {
  const digits = canonicalPhone(phone);
  return digits ? "https://wa.me/" + digits + "?text=" + encodeURIComponent(message) : null;
}

export function effectiveTracking(
  clientId: string,
  statuses: Record<string, CampaignTracking>,
): CampaignTracking {
  return statuses[clientId] ?? {
    client_id: clientId,
    phone_reviewed: false,
    agenda_updated: false,
    sent_at: null,
    replied_at: null,
    payer_name: null,
  };
}

export function samePhoneAlreadySent(
  access: CampaignAccess,
  all: CampaignAccess[],
  statuses: Record<string, CampaignTracking>,
  phones: Record<string, string>,
): boolean {
  const phone = canonicalPhone(phones[access.id] ?? access.whatsapp);
  if (!phone) return false;
  return all.some(other =>
    other.id !== access.id &&
    canonicalPhone(phones[other.id] ?? other.whatsapp) === phone &&
    !!statuses[other.id]?.sent_at
  );
}
