import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { creditStockOverview, prioritizeCreditStocks, type CreditStockRow } from './credit-stock-overview.ts';
import type { CreditMovement } from './server-credits.ts';

const base = new Date(2026, 9, 14);
const movement = (server: string, kind: string, quantity: number, at: string): CreditMovement => ({
  id: server + kind + at,
  server,
  kind,
  quantity,
  created_at: at,
});

describe('summary of shared credit stocks', () => {
  test('counts both modalities in one pool and ignores old debits before initial snapshot', () => {
    const movements = [
      movement('UniP2P', 'renewal', -50, '2026-10-01T00:00:00Z'),
      movement('Uniplay', 'initial', 10, '2026-10-10T00:00:00Z'),
      movement('UniP2P', 'renewal', -1, '2026-10-11T00:00:00Z'),
      movement('Uniplay', 'purchase', 5, '2026-10-12T00:00:00Z'),
    ];
    const clients = [
      { server: 'Uniplay', due_date: '2026-10-14' },
      { server: 'UniP2P', due_date: '2026-10-17' },
      { server: 'UniP2P', due_date: '2026-10-19' },
      { server: 'UniP2P', due_date: '2026-10-13' },
      { server: 'Five', due_date: '2026-10-15' },
    ];
    const rows = creditStockOverview(movements, [], clients, base);
    const uni = rows.find((row) => row.name === 'Uniplay');
    assert.ok(uni);
    assert.equal(rows.some((row) => row.name === 'UniP2P'), false);
    assert.equal(uni.label, 'Uniplay / UniP2P');
    assert.equal(uni.totalClients, 4);
    assert.equal(uni.today, 1);
    assert.equal(uni.five, 3);
    assert.equal(uni.ten, 3);
    assert.equal(uni.balance, 14);
    assert.equal(uni.shortageFive, 0);
    assert.equal(uni.lowStock, false);
  });

  test('warns only when configured credits are insufficient for upcoming renewals', () => {
    const movements = [movement('Uniplay', 'initial', 1, '2026-10-10T00:00:00Z')];
    const clients = [
      { server: 'Uniplay', due_date: '2026-10-14' },
      { server: 'UniP2P', due_date: '2026-10-15' },
      { server: 'UniP2P', due_date: '2026-10-19' },
    ];
    const rows = creditStockOverview(movements, [], clients, base);
    const uni = rows.find((row) => row.name === 'Uniplay');
    assert.ok(uni);
    assert.equal(uni.shortageFive, 2);
    assert.equal(uni.lowStock, true);
    const other = rows.find((row) => row.name === 'Five');
    assert.ok(other);
    assert.equal(other.configured, false);
    assert.equal(other.shortageFive, 0);
    assert.equal(other.lowStock, false);
  });

  test('home summary prioritizes shortage, then upcoming renewals, then client count', () => {
    const base: CreditStockRow = {
      name: 'Base', label: 'Base', configured: true, balance: 20, floor: 0,
      totalClients: 0, today: 0, five: 0, ten: 0, shortageFive: 0, lowStock: false,
    };
    const rows: CreditStockRow[] = [
      { ...base, name: 'Elite', label: 'Elite', totalClients: 1 },
      { ...base, name: 'Now', label: 'Now', totalClients: 75, five: 0 },
      { ...base, name: 'Uniplay', label: 'Uniplay / UniP2P', totalClients: 57, five: 8 },
      { ...base, name: 'Club', label: 'Club', totalClients: 56, five: 16, shortageFive: 3, lowStock: true },
      { ...base, name: 'Five', label: 'Five', totalClients: 181, five: 30, shortageFive: 16, lowStock: true },
      { ...base, name: 'Blade', label: 'Blade', totalClients: 7, five: 8 },
    ];
    const ordered = prioritizeCreditStocks(rows);
    assert.deepEqual(
      ordered.map(row => row.name),
      ['Five', 'Club', 'Uniplay', 'Blade', 'Now', 'Elite'],
    );
    // The helper must not rearrange the normal server order used in the credits page.
    assert.deepEqual(rows.map(row => row.name), ['Elite', 'Now', 'Uniplay', 'Club', 'Five', 'Blade']);
  });

  test('configured minimum stock alerts work independently of the 5-day forecast', () => {
    const movements = [movement('Five', 'initial', 4, '2026-10-10T00:00:00Z')];
    const rows = creditStockOverview(movements, [{server: 'Five', minimum_balance: 5}], [], base);
    const five = rows.find((row) => row.name === 'Five');
    assert.ok(five);
    assert.equal(five.totalClients, 0);
    assert.equal(five.shortageFive, 0);
    assert.equal(five.lowStock, true);
  });
});
