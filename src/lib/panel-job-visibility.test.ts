import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { visiblePanelJobs } from './panel-job-visibility.ts';

const cancelled = { id: 'order-1', client_id: 'client-1', expected_due_date: '2026-11-15', state: 'cancelled' };

describe('Painel Recarga operational warnings', () => {
  test('keeps a cancelled order visible until the manual renewal is recorded in MaxFlix', () => {
    assert.deepEqual(visiblePanelJobs([cancelled], [{ id: 'client-1', due_date: '2026-11-15' }]), [cancelled]);
  });
  test('hides a cancelled warning after the same client has a later due date', () => {
    assert.deepEqual(visiblePanelJobs([cancelled], [{ id: 'client-1', due_date: '2026-12-15' }]), []);
  });
  test('never hides an unresolved provider order just because the client date changed', () => {
    const review = { ...cancelled, id: 'order-2', state: 'needs_review' };
    assert.deepEqual(visiblePanelJobs([review], [{ id: 'client-1', due_date: '2026-12-15' }]), [review]);
  });
  test('does not hide an unlinked or unknown cancelled job', () => {
    const unknown = { ...cancelled, client_id: null };
    assert.deepEqual(visiblePanelJobs([unknown, cancelled], [{ id: 'client-2', due_date: '2026-12-15' }]), [unknown, cancelled]);
  });
  test('only hides the older cancelled attempt, not the newer one for the same client', () => {
    const newer = { ...cancelled, id: 'order-3', expected_due_date: '2026-12-15' };
    assert.deepEqual(visiblePanelJobs([cancelled, newer], [{ id: 'client-1', due_date: '2026-12-15' }]), [newer]);
  });
});
