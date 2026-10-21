import { safeCsvText } from "./csv";
export type Client = {
  id: string;
  name: string;
  login: string;
  server: string;
  cost: number;
  paid: number;
  due_date: string;
  financial_due_date: string | null;
  whatsapp: string | null;
  prev_cost: number;
  prev_paid: number;
  created_at?: string;
};

export const SERVERS = [
  "Elite",
  "Now",
  "Five",
  "Uniplay",
  "UniP2P",
  "Fast",
  "All Play",
  "GF",
  "Blade",
  "Club",
] as const;

export const SERVER_COSTS: Record<string, number | null> = {
  Elite: 10,
  Now: 8.5,
  Five: 6.5,
  Uniplay: 6,
  UniP2P: 6,
  Fast: 6,
  "All Play": 6,
  GF: 6,
  Blade: 6,
  Club: 6,
};

export const DEFAULT_TEMPLATE =
  "Olá {nome}, tudo bem? Seu acesso vence em {vencimento}. Para continuar assistindo sem interrupção, faça a renovação no valor de R$ {valor}. Qualquer dúvida é só chamar!";

export const DEFAULT_OVERDUE_TEMPLATE =
  "Olá {nome}, tudo bem?\n\nO sistema me avisou aqui que sua assinatura venceu. Por isso o sinal deve ter caído.\n\nPra gente liberar de volta rapidinho, segue a chave:\n\n21980285635\n\nAssim que der, me manda o comprovante, por favor.";

/** Parse a YYYY-MM-DD string as a local date at midnight (no timezone drift). */
export function parseDate(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

export function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function today(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Whole-day difference, ignoring any time component. */
export function daysUntil(dateStr: string, base = today()): number {
  const target = parseDate(dateStr);
  return Math.round((target.getTime() - base.getTime()) / 86400000);
}

export function addMonths(date: Date, months: number): Date {
  const day = date.getDate();
  const result = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(day, lastDay));
  return result;
}

export function monthsRemaining(dateStr: string, base = today()): number {
  const target = parseDate(dateStr);
  let months =
    (target.getFullYear() - base.getFullYear()) * 12 + (target.getMonth() - base.getMonth());
  if (target.getDate() < base.getDate()) months -= 1;
  return Math.max(months, 0);
}

export type StatusKey = "vencido" | "hoje" | "breve" | "ativo";

export type Status = {
  key: StatusKey;
  label: string;
  /** days until due date (negative when overdue) */
  days: number;
};

export function getStatus(client: Client, base = today()): Status {
  const days = daysUntil(client.due_date, base);
  if (days < 0) return { key: "vencido", label: "Vencido", days };
  if (days === 0) return { key: "hoje", label: "Vence hoje", days };
  if (days <= 5)
    return { key: "breve", label: days === 1 ? "Vence em 1 dia" : `Vence em ${days} dias`, days };

  if (client.financial_due_date && daysUntil(client.financial_due_date, base) > 0) {
    const months = monthsRemaining(client.financial_due_date, base);
    if (months > 0) {
      return {
        key: "ativo",
        label: `Ativo — ${months} ${months === 1 ? "mês restante" : "meses restantes"}`,
        days,
      };
    }
  }
  return { key: "ativo", label: "Ativo", days };
}

/**
 * True when the client already paid a package that covers beyond the current
 * monthly cycle. In those months the paid amount is 0 (nothing is charged),
 * but the server credit cost keeps being deducted.
 */
export function isPackageCovered(client: Client): boolean {
  return !!client.financial_due_date && client.financial_due_date > client.due_date;
}


export function formatBRL(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function formatDate(value: string | null): string {
  if (!value) return "—";
  return parseDate(value).toLocaleDateString("pt-BR");
}

/**
 * Next monthly cycle. If the client is still active (due today or later),
 * adds 1 month to the current due date. If already expired, the new cycle
 * starts from the renewal day (today + 1 month).
 */
export function nextDueDate(dueDate: string, base = today()): string {
  const due = parseDate(dueDate);
  const start = due.getTime() < base.getTime() ? base : due;
  return toISODate(addMonths(start, 1));
}

/**
 * Paid months reuse the existing package credit: the service always moves one
 * cycle, while financial_due_date marks the end of prepaid coverage. An
 * overdue renewal starts on the payment day; an early renewal extends from
 * the current service due date without discarding remaining service time.
 * Revenue is recorded once in payments on the payment day, not each cycle.
 */
export function renewalDates(dueDate: string, months: number, base = today()) {
  if (!Number.isInteger(months) || months < 1 || months > 120) {
    throw new RangeError("A quantidade de meses deve ser entre 1 e 120.");
  }
  const due = parseDate(dueDate);
  const start = due.getTime() < base.getTime() ? base : due;
  return {
    dueDate: toISODate(addMonths(start, 1)),
    financialDueDate: toISODate(addMonths(start, months)),
  };
}

/**
 * WhatsApp links use E.164 digits (without '+'). Brazilian 10/11-digit numbers
 * default to +55; numbers with an explicit international prefix keep it.
 * Portuguese +351 numbers are also recognized when pasted without '+'.
 */
export function canonicalPhone(raw: string | null | undefined): string | null {
  const text = (raw ?? "").trim();
  if (!text || !/^\+?[\d\s().-]+$/.test(text)) return null;

  let digits = text.replace(/\D/g, "");
  const explicitInternational = text.startsWith("+") || digits.startsWith("00");
  if (digits.startsWith("00")) digits = digits.slice(2);

  if (explicitInternational) {
    return /^[1-9]\d{7,14}$/.test(digits) ? digits : null;
  }
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) return digits;
  if (digits.startsWith("351") && digits.length === 12) return digits;
  if (digits.length === 10 || digits.length === 11) return "55" + digits;
  return null;
}

export function whatsappLink(client: Client, template: string): string {
  const digits = canonicalPhone(client.whatsapp) ?? "";
  const message = template
    .replaceAll("{nome}", client.name)
    .replaceAll("{login}", client.login)
    .replaceAll("{vencimento}", formatDate(client.due_date))
    .replaceAll("{servidor}", client.server)
    .replaceAll("{valor}", (client.paid || client.prev_paid || 0).toFixed(2).replace(".", ","));
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

export function renewalMessageLink(client: Client, template: string, overdueTemplate: string, base = today()): string {
  return whatsappLink(client, getStatus(client, base).key === "vencido" ? overdueTemplate : template);
}

export function toCSV(clients: Client[]): string {
  const header = [
    "Nome",
    "Login",
    "Servidor",
    "Vencimento",
    "Vencimento financeiro",
    "Custo",
    "Valor pago",
    "Lucro",
    "WhatsApp",
    "Status",
  ];
  const rows = clients.map((c) => [
    safeCsvText(c.name),
    safeCsvText(c.login),
    safeCsvText(c.server),
    formatDate(c.due_date),
    formatDate(c.financial_due_date),
    c.cost.toFixed(2).replace(".", ","),
    c.paid.toFixed(2).replace(".", ","),
    (c.paid - c.cost).toFixed(2).replace(".", ","),
    safeCsvText(c.whatsapp ?? ""),
    safeCsvText(getStatus(c).label),
  ]);
  return [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(";"))
    .join("\n");
}
