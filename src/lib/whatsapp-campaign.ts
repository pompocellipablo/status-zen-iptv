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

export const MIGRATION_MESSAGE = `📢 *NOVO WHATSAPP DE ATENDIMENTO*

Oi! Tudo bem? 😊

Tenho uma novidade: meu atendimento agora vai se chamar *MaxFlix*. Mas pode ficar tranquilo: *sou eu mesmo que continuo te atendendo!* 🤝

📲 *Novo WhatsApp: (21) 99534-4044*

Por favor, salve como *Pablo — MaxFlix* e me mande um *“Oi”* por lá, para já conversarmos pelo contato novo.

*Daqui para frente, suporte, renovações e avisos serão feitos por esse número.* O WhatsApp antigo deixará de ser utilizado para esses assuntos.

💳 *Chave Pix (celular): (21) 99534-4044*
Esse também é o número da minha chave Pix. Confira os dados do recebedor antes de pagar.

Obrigado pela confiança de sempre! 💙
*MaxFlix — Tudo em um só lugar*`;

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
