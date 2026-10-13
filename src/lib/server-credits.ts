export type CreditMovement = {
  id: string;
  server: string;
  kind: string;
  quantity: number;
  created_at: string;
};

// An initial entry is a snapshot of stock when it was recorded, not a purchase.
// Use registration time: older renewals (even on the same day) are already
// reflected in that snapshot. occurred_on remains the historical business date.
export function creditBalance(entries: readonly CreditMovement[]): number {
  const initial = entries.find((entry) => entry.kind === "initial");
  if (!initial) return 0;
  const startedAt = new Date(initial.created_at).getTime();
  return entries.reduce((balance, entry) =>
    entry.kind !== "initial" && new Date(entry.created_at).getTime() > startedAt
      ? balance + entry.quantity
      : balance, initial.quantity);
}
