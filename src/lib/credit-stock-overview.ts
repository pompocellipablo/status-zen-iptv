import { belongsToCreditPool, creditPoolLabel } from './credit-pools';
import { creditBalance, type CreditMovement } from './server-credits';
import { SERVERS, daysUntil, today } from './iptv';

export type CreditStockClient = { server: string; due_date: string };
export type CreditStockAlert = { server: string; minimum_balance: number };

export type CreditStockRow = {
  name: string;
  label: string;
  configured: boolean;
  balance: number;
  floor: number;
  totalClients: number;
  today: number;
  five: number;
  ten: number;
  shortageFive: number;
  lowStock: boolean;
};

/**
 * One credit-stock pool can serve multiple client modalities.
 * Counts are all registered clients, while forecasts are only due dates
 * from today through the requested number of days (including today).
 * Forecasts are estimates; credits are deducted only upon actual renewal.
 */
export function creditStockOverview(
  movements: readonly CreditMovement[],
  alerts: readonly CreditStockAlert[],
  clients: readonly CreditStockClient[],
  base = today(),
): CreditStockRow[] {
  return SERVERS.filter((name) => name !== 'UniP2P').map((name) => {
    const entries = movements.filter((movement) => belongsToCreditPool(movement.server, name));
    const configured = entries.some((entry) => entry.kind === 'initial');
    const balance = creditBalance(entries);
    const floor = alerts.find((alert) => alert.server === name)?.minimum_balance ?? 0;
    const poolClients = clients.filter((client) => belongsToCreditPool(client.server, name));
    const countDue = (days: number) => poolClients.filter((client) => {
      const remaining = daysUntil(client.due_date, base);
      return remaining >= 0 && remaining <= days;
    }).length;
    const five = countDue(5);
    const shortageFive = configured ? Math.max(0, five - balance) : 0;

    return {
      name,
      label: creditPoolLabel(name),
      configured,
      balance,
      floor,
      totalClients: poolClients.length,
      today: countDue(0),
      five,
      ten: countDue(10),
      shortageFive,
      lowStock: configured && (balance <= floor || shortageFive > 0),
    };
  });
}
