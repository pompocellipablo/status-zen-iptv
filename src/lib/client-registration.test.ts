import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialPlanError, planEnd, type InitialPlan } from './client-registration';
const plan: InitialPlan = { requestId: 'test', months: 6, startsOn: '2026-11-15', paidOn: '2026-11-15', paymentConfirmed: true, activationConfirmed: true, debitCredit: false };
test('six months coverage, one month technical expiry', () => {
  assert.equal(planEnd(plan.startsOn,6),'2027-05-15');
  assert.equal(initialPlanError(plan,175,6.5,'2026-12-15','2026-11-15'),null);
});
test('month end and leap year clamp correctly', () => {
  assert.equal(planEnd('2026-08-31',6),'2027-02-28');
  assert.equal(planEnd('2027-08-31',6),'2028-02-29');
  assert.equal(planEnd('2024-02-29',12),'2025-02-28');
});
test('invalid dates, periods and nonfinite amounts rejected', () => {
  assert.equal(planEnd('2026-02-30',6),'');
  assert.equal(planEnd('2026-11-15',5),'');
  for (const amount of [0,-1,NaN,Infinity]) assert.ok(initialPlanError(plan,amount,6.5,'2026-12-15','2026-11-15'));
});
test('payment and activation must be separately confirmed', () => {
  assert.ok(initialPlanError({...plan,paymentConfirmed:false},175,6.5,'2026-12-15','2026-11-15'));
  assert.ok(initialPlanError({...plan,activationConfirmed:false},175,6.5,'2026-12-15','2026-11-15'));
});
test('future payment or uncovered technical date rejected', () => {
  assert.ok(initialPlanError({...plan,paidOn:'2026-11-16'},175,6.5,'2026-12-15','2026-11-15'));
  assert.ok(initialPlanError(plan,175,6.5,'2027-06-15','2026-11-15'));
  assert.ok(initialPlanError(plan,175,6.5,'2026-11-15','2026-11-15'));
});
