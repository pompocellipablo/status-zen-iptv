/**
 * Credit-stock pools are independent from the service used by each client.
 * Uniplay and UniP2P use the same purchased credits, but remain distinct in clients
 * and in payment / financial reports.
 */
export const SHARED_UNIPLAY_POOL = 'Uniplay';

export function creditPoolForServer(server: string): string {
  return server === 'Uniplay' || server === 'UniP2P' ? SHARED_UNIPLAY_POOL : server;
}

export function creditPoolLabel(pool: string): string {
  return pool === SHARED_UNIPLAY_POOL ? 'Uniplay / UniP2P' : pool;
}

export function belongsToCreditPool(server: string, pool: string): boolean {
  return creditPoolForServer(server) === pool;
}

export function creditPoolServerNames(pool: string): string[] {
  return pool === SHARED_UNIPLAY_POOL ? ['Uniplay', 'UniP2P'] : [pool];
}
