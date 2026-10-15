/** Sorting happens after filters but before the 25-client pagination. */
export type ClientSortMode =
  | "vencimento-asc"
  | "vencimento-desc"
  | "login-asc"
  | "login-desc";

type SortableClient = { name: string; login: string; due_date: string };
const collator = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });

export function sortClients<T extends SortableClient>(clients: readonly T[], mode: ClientSortMode): T[] {
  const [field, direction] = mode.split("-") as ["vencimento" | "login", "asc" | "desc"];
  const order = direction === "desc" ? -1 : 1;
  return [...clients].sort((a, b) => {
    const comparison = field === "vencimento"
      ? a.due_date.localeCompare(b.due_date)
      : collator.compare(a.login, b.login);
    if (comparison !== 0) return comparison * order;
    // Keep client ordering predictable when their chosen field is equal.
    return collator.compare(a.name, b.name) || collator.compare(a.login, b.login);
  });
}
