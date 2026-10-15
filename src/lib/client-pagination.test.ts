import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { CLIENTS_PER_PAGE, paginateClients } from './client-pagination.ts';

describe('client listing pagination', () => {
  const rows = Array.from({length: 336}, (_,i) => ({ id: String(i+1) }));
  test('25 per page, and last page has remaining clients', () => {
    const first = paginateClients(rows, 1);
    assert.equal(CLIENTS_PER_PAGE, 25);
    assert.equal(first.totalPages, 14);
    assert.equal(first.first, 1);
    assert.equal(first.last, 25);
    assert.equal(first.rows.length, 25);
    const last = paginateClients(rows, 14);
    assert.equal(last.rows.length, 11);
    assert.equal(last.first, 326);
    assert.equal(last.last, 336);
  });
  test('results are paginated only after search and filters', () => {
    const subset = rows.filter((_,i)=>i%10===0);
    const second = paginateClients(subset, 2);
    assert.equal(second.count, 34);
    assert.equal(second.rows.length, 9);
    assert.equal(second.first, 26);
    assert.equal(second.last, 34);
  });
  test('page remains valid after deletion or changed filter', () => {
    const result = paginateClients(rows.slice(0, 10), 99);
    assert.equal(result.page, 1);
    assert.equal(result.rows.length, 10);
  });
  test('empty lists display no rows and have a valid first page', () => {
    const result = paginateClients([], 3);
    assert.deepEqual(result.rows, []);
    assert.equal(result.page, 1);
    assert.equal(result.totalPages, 1);
    assert.equal(result.first, 0);
    assert.equal(result.last, 0);
  });
});
