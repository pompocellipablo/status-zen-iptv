import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  belongsToCreditPool,
  creditPoolForServer,
  creditPoolLabel,
  creditPoolServerNames,
} from './credit-pools.ts';

describe('Uniplay and UniP2P share purchased credits', () => {
  test('two client service types select one stock pool', () => {
    assert.equal(creditPoolForServer('Uniplay'), 'Uniplay');
    assert.equal(creditPoolForServer('UniP2P'), 'Uniplay');
    assert.equal(creditPoolLabel('Uniplay'), 'Uniplay / UniP2P');
    assert.deepEqual(creditPoolServerNames('Uniplay'), ['Uniplay', 'UniP2P']);
  });

  test('both service types consume the same stock and forecast', () => {
    const sampleClients = ['Uniplay', 'UniP2P', 'Five', 'UniP2P'];
    const renewals = sampleClients.filter((name) => belongsToCreditPool(name, 'Uniplay'));
    assert.equal(renewals.length, 3);
    assert.equal(20 - renewals.length, 17);
  });

  test('unrelated server balances are unaffected', () => {
    assert.equal(creditPoolForServer('Five'), 'Five');
    assert.equal(creditPoolLabel('Five'), 'Five');
    assert.deepEqual(creditPoolServerNames('Five'), ['Five']);
    assert.equal(belongsToCreditPool('UniP2P', 'Five'), false);
  });
});
