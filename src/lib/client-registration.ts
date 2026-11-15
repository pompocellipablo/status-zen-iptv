import { addMonths, format, isValid, parseISO } from 'date-fns';

export type InitialPlan = {
  requestId: string;
  months: 1 | 6 | 12;
  startsOn: string;
  paidOn: string;
  paymentConfirmed: boolean;
  activationConfirmed: boolean;
  debitCredit: boolean;
};

export function planEnd(startsOn: string, months: number): string {
  if (![1, 6, 12].includes(months) || !/^\d{4}-\d{2}-\d{2}$/.test(startsOn)) return '';
  const start = parseISO(startsOn);
  if (!isValid(start) || format(start, 'yyyy-MM-dd') !== startsOn) return '';
  return format(addMonths(start, months), 'yyyy-MM-dd');
}

export function initialPlanError(plan: InitialPlan, amount: number, cost: number, due: string, today: string): string | null {
  const end = planEnd(plan.startsOn, plan.months);
  if (!end || plan.startsOn > today || !planEnd(plan.paidOn, 1) || plan.paidOn > today)
    return 'Informe datas válidas de início e pagamento, até hoje.';
  if (!plan.paymentConfirmed || !plan.activationConfirmed)
    return 'Confirme o recebimento e a ativação já realizada no servidor.';
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(cost) || cost < 0)
    return 'Informe um pagamento maior que zero e um custo válido.';
  if (!planEnd(due, 1) || due <= plan.startsOn || due > end || due < today)
    return 'O vencimento do servidor deve estar entre o início e o fim do plano, sem estar vencido.';
  return null;
}
