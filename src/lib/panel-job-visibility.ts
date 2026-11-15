/** State and date fields needed to decide which provider jobs still need attention. */
export type PanelJobForVisibility = {
  client_id: string | null;
  expected_due_date: string;
  state: string;
};
export type ClientForPanelVisibility = {
  id: string;
  due_date: string;
};

/**
 * Keep the original cancellation for audit, but remove its warning from the
 * operational list once the linked client's due date has moved beyond the
 * date of the cancelled attempt (as happens after manual registration).
 * Unresolved cancellations and all other non-synced states remain visible.
 */
export function visiblePanelJobs<T extends PanelJobForVisibility>(
  jobs: readonly T[],
  clients: readonly ClientForPanelVisibility[],
): T[] {
  const dueByClientId = new Map(clients.map((c) => [c.id, c.due_date]));
  return jobs.filter((job) => {
    if (job.state !== "cancelled") return true;
    const currentDue = job.client_id ? dueByClientId.get(job.client_id) : undefined;
    return !currentDue || currentDue <= job.expected_due_date;
  });
}
