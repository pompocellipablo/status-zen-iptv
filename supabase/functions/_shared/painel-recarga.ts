/**
 * Painel Recarga API adapter (04/11/2026, api.pdf).
 * No tokens or panel credentials are ever handled by the browser.
 * MaxFlix renews server credit one cycle at a time, including prepaid packages.
 */
export const RECARGA_BASE_URL = "https://painelrecarga.dev";
export type PanelRoute = {kind: "iptv" | "p2p"; panel: string; path: string};
const IPTV_PANELS: Record<string,string> = {
  "All Play":"allplay", "Club":"club",
  "Fast":"fast", "Five":"five", "GF":"gf", "Now":"now", "Uniplay":"uniplay",
};

/**
 * "UniP2P" is the Uniplay P2P panel (confirmed by the MaxFlix owner).
 * It must not go through the distinct Uniplay IPTV endpoint.
 */
export function panelRouteForClient(server: string):PanelRoute|null {
  if(server==="UniP2P")
    return {kind:"p2p",panel:"uniplay",path:"/renovar/p2p/uniplay"};
  // All currently registered Blade customers use Blade P2P, not Blade IPTV.
  if(server==="Blade")
    return {kind:"p2p",panel:"blade",path:"/renovar/p2p/blade"};
  const name=IPTV_PANELS[server];
  if(!name)return null;
  return {kind:"iptv",panel:name,path:"/renovar/iptv/"+name};
}

/**
 * Preserve coverage already paid in MaxFlix. Never convert a monthly server
 * renewal into a second payment, or shift the financial date of a package.
 */
export function financialTransitionError(
  client: {due_date:string;financial_due_date:string|null},
  values: {months:number;dueDate:string;financialDueDate:string;paymentAmount:number;monthlyPaid:number;paymentCost:number},
):string|null {
  const previousFinancial=client.financial_due_date??client.due_date;
  if(previousFinancial<client.due_date)
    return "Vencimento financeiro anterior ao técnico: conciliação manual necessária.";
  if(previousFinancial>client.due_date){
    if(values.financialDueDate!==previousFinancial)
      return "Pacote já pago: o vencimento financeiro precisa ser preservado.";
    if(values.dueDate>previousFinancial)
      return "O próximo ciclo ultrapassa a cobertura paga; revise o novo pagamento manualmente.";
    if(values.paymentAmount!==0 || values.monthlyPaid!==0 || values.paymentCost!==0)
      return "Pacote já pago: não registrar outra cobrança nesta renovação.";
  }else if(values.months===1 && values.financialDueDate!==values.dueDate){
    return "Plano mensal: os vencimentos técnico e financeiro precisam avançar juntos.";
  }
  return null;
}

/**
 * Batch-pilot allowlist; configured ONCE as a private Edge secret.
 * Strict fail-closed parsing: at most one monthly test per provider.
 * Unknown services, duplicate IDs, malformed dates or oversized input
 * invalidate the whole list (never fall back to an open server list).
 */
export type PanelPilotCase={
  clientId:string; expectedDueDate:string; server:string; kind:"paid"|"unpaid"|"package6"|"prepaid2";
};
export const PANEL_PILOT_BATCH_SERVERS=[
  "Five","Uniplay","UniP2P","Blade","Now","All Play",
] as const;

/** Owner-approved daily integration: Fast real cycle passed; All Play simulation passed. Elite remains excluded. */
export const PANEL_GENERAL_SERVERS=["Club","Five","Uniplay","UniP2P","Blade","Now","GF","Fast","All Play"] as const;
/** Individual pilot entries still require exact ID, server and original expiry. */
export const PANEL_ROLLOUT_SERVERS=[...PANEL_GENERAL_SERVERS] as const;
export type PanelRolloutTarget={clientId:string;server:typeof PANEL_ROLLOUT_SERVERS[number];expectedDueDate:string};
export function parsePanelRolloutTargets(raw:string|undefined|null):PanelRolloutTarget[]{
  if(!raw||raw.length>4096)return [];
  let value:unknown;
  try{value=JSON.parse(raw);}catch{return [];}
  if(!Array.isArray(value)||value.length===0||value.length>8)return [];
  const servers=new Set<string>(PANEL_ROLLOUT_SERVERS),seen=new Set<string>();
  const out:PanelRolloutTarget[]=[];
  for(const item of value){
    if(!item||typeof item!=="object"||Array.isArray(item))return [];
    const t=item as Record<string,unknown>;
    if(Object.keys(t).length!==3||!("clientId" in t)||!("server" in t)||!("expectedDueDate" in t)
      ||typeof t["clientId"]!=="string"
      ||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t["clientId"])
      ||typeof t["server"]!=="string"||!servers.has(t["server"])
      ||typeof t["expectedDueDate"]!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(t["expectedDueDate"])
      ||seen.has(t["clientId"]))return [];
    seen.add(t["clientId"]);
    out.push({clientId:t["clientId"],server:t["server"] as PanelRolloutTarget["server"],expectedDueDate:t["expectedDueDate"]});
  }
  return out;
}
export function isPanelRolloutTarget(
  client:{id:string;server:string;due_date:string},targets:readonly PanelRolloutTarget[]
):boolean{
  return targets.some(t=>t.clientId===client.id&&t.server===client.server&&t.expectedDueDate===client.due_date);
}

/**
 * General daily rollout eligibility. Exact client pilots remain separate.
 * Only active paid monthly contracts and already-covered prepaid cycles
 * are allowed; no expired/free/zero-cost clients or new package sales.
 */
export function broadPanelRenewalEligible(
  client:{server:string;due_date:string;financial_due_date:string|null;
    access_type:string|null;paid:number;cost:number},
  todayISO:string,
):boolean{
  if(!PANEL_GENERAL_SERVERS.includes(client.server as typeof PANEL_GENERAL_SERVERS[number]))return false;
  if(!["padrao","pacote_pago"].includes(client.access_type??""))return false;
  if(!Number.isFinite(client.cost)||client.cost<=0)return false;
  const due=panelDateToISO(client.due_date);
  const finance=panelDateToISO(client.financial_due_date??undefined);
  const today=panelDateToISO(todayISO);
  if(!due||!finance||!today||due<today||finance<due)return false;
  if(finance===due)return Number.isFinite(client.paid)&&client.paid>0;
  const nextDue=addMonthsISO(due,1);
  return !!nextDue&&finance>=nextDue;
}

/**
 * Exact one-client overdue-paid renewal test. No authorization for other
 * expired clients; payment date is the new monthly anniversary.
 */
export const HUMBERTO_OVERDUE_PILOT={
  clientId:"9cb4336f-5df6-4f09-9022-90bb514277c8",
  login:"HumbertoFelipe",server:"Five",expectedDueDate:"2026-11-05",
  paymentDate:"2026-11-10",lastTestDate:"2026-11-12",
  nextDueDate:"2026-12-10",amount:35,cost:6.5,
} as const;
export function humbertoOverdueIssue(
 client:{id:string;login:string;server:string;due_date:string;financial_due_date:string|null;
  access_type:string|null;paid:number;prev_paid:number;cost:number;prev_cost:number},
 values:{months:number;dueDate:string;financialDueDate:string;cost:number;
  monthlyPaid:number;prevPaid:number;paymentAmount:number;paymentCost:number;pilotKind?:string},
 todayISO:string,
):string|null{
 const t=HUMBERTO_OVERDUE_PILOT;
 if(client.id!==t.clientId||client.login!==t.login||client.server!==t.server
   ||client.due_date!==t.expectedDueDate||client.financial_due_date!==t.expectedDueDate
   ||client.access_type!=="padrao"
   ||client.paid!==0||client.cost!==0||client.prev_paid!==t.amount||client.prev_cost!==t.cost)
   return "Cadastro do Humberto diferente do histórico vencido; nenhum pedido enviado.";
 if(todayISO<t.paymentDate||todayISO>t.lastTestDate)
   return "O prazo do piloto vencido expirou; nenhum pedido enviado.";
 if(values.pilotKind!=="overdue"||values.months!==1
   ||values.dueDate!==t.nextDueDate||values.financialDueDate!==t.nextDueDate
   ||values.cost!==t.cost||values.monthlyPaid!==t.amount||values.prevPaid!==t.amount
   ||values.paymentAmount!==t.amount||values.paymentCost!==t.cost)
   return "Pagamento ou vencimento do teste vencido divergente; nenhum pedido enviado.";
 return null;
}

/**
 * Dedicated, fail-closed package test. Only the owner can enable its private
 * Edge Function flag; this identifier is not a credential or a client-side
 * authorization. It never enables the general rollout.
 */
export const LEAL_PAULO_PACKAGE6 = {
  clientId:"7666f0e4-9dbe-47cb-bb90-8a67a2a0a822",
  expectedDueDate:"2026-11-19",
  server:"Five",
  kind:"package6",
} as const;

export function lealPauloPackage6Issue(
  client:{id:string;login:string;server:string;due_date:string;
    financial_due_date:string|null;access_type:string|null;
    paid:number;prev_paid:number;cost:number},
  values:{months:number;dueDate:string;financialDueDate:string;
    cost:number;monthlyPaid:number;prevPaid:number;
    paymentAmount:number;paymentCost:number;pilotKind?:string},
):string|null {
  if(client.id!==LEAL_PAULO_PACKAGE6.clientId ||
     client.login!=="LealPaulo" ||
     client.server!==LEAL_PAULO_PACKAGE6.server ||
     client.due_date!==LEAL_PAULO_PACKAGE6.expectedDueDate)
    return "Piloto semestral não corresponde ao cliente, servidor ou vencimento autorizado.";
  if(client.financial_due_date!==client.due_date ||
     client.access_type!=="padrao" || Number(client.paid)!==0 ||
     Number(client.prev_paid)!==150 || Number(client.cost)!==6.50)
    return "Cadastro financeiro do piloto mudou; revise antes da renovação.";
  const technical=addMonthsISO(client.due_date,1);
  const financial=addMonthsISO(client.due_date,6);
  if(values.pilotKind!==undefined || values.months!==6 ||
     values.dueDate!==technical || values.financialDueDate!==financial ||
     values.cost!==6.50 || values.monthlyPaid!==0 ||
     values.prevPaid!==150 || values.paymentAmount!==150 ||
     values.paymentCost!==39)
    return "Piloto LealPaulo: apenas 6 meses por R$ 150,00 e um ciclo técnico a R$ 6,50.";
  return null;
}

/**
 * Only the SECOND technical cycle of the already-paid LealPaulo six-month
 * package. No new payment, no change to its existing financial paid-through
 * date. The first package authorization never applies to this new cycle.
 */
export const LEAL_PAULO_PREPAID_SECOND = {
  clientId:LEAL_PAULO_PACKAGE6.clientId,
  expectedDueDate:"2026-12-19",
  server:"Five",
  kind:"prepaid2",
} as const;

export function lealPauloPrepaidSecondIssue(
  client:{id:string;login:string;server:string;due_date:string;
    financial_due_date:string|null;access_type:string|null;
    paid:number;prev_paid:number;cost:number},
  values:{months:number;dueDate:string;financialDueDate:string;
    cost:number;monthlyPaid:number;prevPaid:number;
    paymentAmount:number;paymentCost:number;pilotKind?:string},
):string|null {
  if(client.id!==LEAL_PAULO_PREPAID_SECOND.clientId ||
     client.login!=="LealPaulo" ||
     client.server!==LEAL_PAULO_PREPAID_SECOND.server ||
     client.due_date!==LEAL_PAULO_PREPAID_SECOND.expectedDueDate)
    return "Piloto de segundo ciclo não corresponde ao cliente, servidor ou vencimento autorizado.";
  if(client.financial_due_date!=="2027-05-19" ||
     client.access_type!=="padrao" || Number(client.paid)!==0 ||
     Number(client.prev_paid)!==150 || Number(client.cost)!==6.50)
    return "Cobertura já paga ou cadastro do LealPaulo mudou; não renovar sem conciliação.";
  if(values.pilotKind!==undefined || values.months!==1 ||
     values.dueDate!=="2027-01-19" ||
     values.financialDueDate!=="2027-05-19" ||
     values.cost!==6.50 || values.monthlyPaid!==0 ||
     values.prevPaid!==150 || values.paymentAmount!==0 ||
     values.paymentCost!==0)
    return "Segundo ciclo já pago: somente 1 crédito Five, R$ 0,00 novo e financeiro até 19/05/2027.";
  return null;
}

export function parsePanelPilotBatch(raw:string|undefined|null):PanelPilotCase[]{
  if(!raw||raw.length>4096)return [];
  let parsed:unknown;
  try{parsed=JSON.parse(raw);}catch{return [];}
  if(!Array.isArray(parsed)||parsed.length<1||parsed.length>6)return [];
  const allowed=new Set<string>(PANEL_PILOT_BATCH_SERVERS);
  const seenServers=new Set<string>();
  const seenClients=new Set<string>();
  const entries:PanelPilotCase[]=[];
  for(const entry of parsed){
    if(!entry||typeof entry!=="object"||Array.isArray(entry))return [];
    const p=entry as Record<string,unknown>;
    const {clientId,expectedDueDate,server,kind}=p;
    if(typeof clientId!=="string"||
       !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId)
       ||typeof expectedDueDate!=="string"
       ||!/^\d{4}-\d{2}-\d{2}$/.test(expectedDueDate)
       ||panelDateToISO(expectedDueDate)!==expectedDueDate
       ||typeof server!=="string"||!allowed.has(server)
       ||(kind!=="paid"&&kind!=="unpaid")
       ||seenServers.has(server)||seenClients.has(clientId))return [];
    seenServers.add(server);
    seenClients.add(clientId);
    entries.push({clientId,expectedDueDate,server,kind});
  }
  return entries;
}

/**
 * Preflight validation only: validates a planned renewal BEFORE any
 * external job is reserved or posted. This does not authorize payment.
 * The final confirmation is validated a second time against the actual
 * provider dates and inside the atomic database settlement.
 */
/**
 * Explicit opt-in daily rollout. The server never trusts browser-supplied
 * payment/cost numbers for a provider renewal. Only monthly, 6/12-month
 * paid contracts, or an already-paid technical cycle are eligible.
 * Free accounts remain a separate, narrowly authorized pilot.
 */
export function rolloutRenewalIssue(
  client:{due_date:string;financial_due_date:string|null;access_type?:string|null;
    paid:number;cost:number;prev_paid:number},
  values:{months:number;dueDate:string;financialDueDate:string;cost:number;
    monthlyPaid:number;prevPaid:number;paymentAmount:number;paymentCost:number;pilotKind?:string},
):string|null {
  if(!["padrao","pacote_pago"].includes(client.access_type??""))
    return "Acesso gratuito ou especial exige aprovação separada; não pode usar renovação geral.";
  if(values.pilotKind!==undefined)
    return "A renovação geral não aceita autorização de piloto gratuito.";
  if(!Number.isFinite(values.cost)||values.cost!==client.cost||client.cost<0)
    return "Custo do ciclo diferente do cadastro; revise antes de renovar.";
  const finance=client.financial_due_date;
  if(!finance||finance<client.due_date)
    return "Cobertura financeira ausente ou anterior ao vencimento técnico.";
  const previousPaid=client.prev_paid||client.paid;
  if(finance>client.due_date){
    if(values.months!==1||values.financialDueDate!==finance||
       values.dueDate>finance||values.paymentAmount!==0||values.paymentCost!==0||
       values.monthlyPaid!==0||values.prevPaid!==client.prev_paid)
      return "Pacote ativo: somente um ciclo técnico dentro da cobertura, sem outro pagamento.";
    return null;
  }
  if(client.paid<=0||values.paymentAmount<=0)
    return "Período financeiro novo exige pagamento positivo registrado.";
  if(values.months===1){
    if(values.paymentAmount!==client.paid||values.monthlyPaid!==client.paid||
       values.prevPaid!==client.paid||values.paymentCost!==client.cost||
       values.financialDueDate!==values.dueDate)
      return "Plano mensal: valor e custo devem coincidir com o cadastro, avançando as duas datas.";
    return null;
  }
  if(values.months!==6&&values.months!==12)
    return "Lote geral aceita apenas planos de 1, 6 ou 12 meses.";
  if(values.monthlyPaid!==0||values.prevPaid!==previousPaid||
     values.paymentAmount<=client.paid||
     values.paymentCost!==client.cost*values.months)
    return "Pacote: valores, meses ou custo total diferentes da contratação.";
  const minFinance=addMonthsISO(values.dueDate,values.months-1);
  const maxFinance=minFinance?addDaysISO(minFinance,4):null;
  if(!minFinance||!maxFinance||values.financialDueDate<minFinance||
     values.financialDueDate>maxFinance)
    return "A cobertura do pacote não corresponde à quantidade de meses contratados.";
  return null;
}

export function validatePanelRenewalDraft(
  client:{due_date:string;financial_due_date:string|null;access_type?:string|null;paid?:number},
  values:{
    months:number;dueDate:string;financialDueDate:string;
    paymentAmount:number;monthlyPaid:number;paymentCost:number;pilotKind?:"unpaid";
  },
  todayISO:string,
):string|null {
  const due=panelDateToISO(client.due_date);
  const finance=panelDateToISO(client.financial_due_date??undefined);
  const planned=panelDateToISO(values.dueDate);
  const plannedFinance=panelDateToISO(values.financialDueDate);
  const today=panelDateToISO(todayISO);
  if(!due||!finance||!planned||!plannedFinance||!today)
    return "Datas técnicas ou financeiras inválidas; revise o cadastro.";
  if(values.pilotKind!=="unpaid"
    &&(client.access_type==="gratuidade"||client.access_type==="meu_acesso"))
    return "Acesso gratuito exige fluxo específico de renovação.";
  if(!Number.isInteger(values.months)||values.months<1||values.months>120)
    return "Número de meses inválido para a renovação.";
  if(finance<due)
    return "O financeiro está anterior ao acesso técnico; concilie antes de renovar.";
  if(planned<=today||planned<=due)
    return "Próximo vencimento técnico inválido ou não avançou.";
  const anchorDate=due>today?due:today;
  const maxOneCycle=addDaysISO(anchorDate,45);
  if(!maxOneCycle||planned>maxOneCycle)
    return "A projeção de um único ciclo ficou muito distante; revise o plano.";
  if(plannedFinance<planned)
    return "O vencimento financeiro não cobre o novo ciclo técnico.";
  if(!Number.isFinite(values.paymentAmount)||values.paymentAmount<0||
     !Number.isFinite(values.monthlyPaid)||values.monthlyPaid<0||
     !Number.isFinite(values.paymentCost)||values.paymentCost<0)
    return "Valores financeiros inválidos.";

  // Free pilot: zero revenue, exactly one technical provider cycle. The
  // financial *date* follows the free access, but no payment is recorded.
  // No existing prepaid coverage is allowed here.
  if(values.pilotKind==="unpaid"){
    if(client.paid!==0 || finance!==due || values.months!==1
      ||values.financialDueDate!==values.dueDate
      ||values.paymentAmount!==0 || values.monthlyPaid!==0 || values.paymentCost!==0
      ||!["meu_acesso","padrao"].includes(client.access_type??""))
      return "Piloto gratuito inválido: exigir acesso próprio/gratuito, um ciclo e nenhum pagamento.";
    return null;
  }
  if(finance>due){
    if(values.months!==1||values.financialDueDate!==finance
      ||values.paymentAmount!==0||values.monthlyPaid!==0
      ||values.paymentCost!==0)
      return "Pacote já pago: somente um ciclo técnico, sem nova cobrança e com financeiro preservado.";
  } else {
    if(values.paymentAmount<=0)
      return "Nova renovação financeira exige valor de pagamento positivo.";
    if(values.months===1&&plannedFinance!==planned)
      return "Plano mensal exige vencimento técnico e financeiro iguais.";
    if(values.months>1&&plannedFinance<=planned)
      return "Plano de vários meses precisa cobrir mais de um ciclo.";
  }
  return null;
}

/**
 * Provider-authoritative technical due date after a confirmed ONE-cycle renewal.
 *
 * Prepaid coverage is immutable. A fresh payment with equal old dates extends
 * financial coverage by the contracted period; for end-of-month dates retain
 * the MaxFlix calendar anchor if the provider returns the expected technical due.
 * A mismatch on the provider's *previous* expiry must be reconciled manually.
 *
 * This function only calculates a plan. It never renews, writes payments,
 * consumes credits, or changes provider accounts.
 */
export function confirmedRenewalDatesFromPanel(
  client: {due_date:string;financial_due_date:string|null},
  values: {
    months:number;dueDate:string;financialDueDate:string;
    paymentAmount:number;monthlyPaid:number;paymentCost:number;pilotKind?:"unpaid";
  },
  providerNextDue:string|undefined,
  providerPreviousDue:string|undefined,
  todayISO:string,
): {dueDate:string|null;financialDueDate:string|null;blockedReason:string|null} {
  const blocked=(reason:string)=>({dueDate:null,financialDueDate:null,blockedReason:reason});
  const newDue=panelDateToISO(providerNextDue);
  if(!newDue)return blocked("Painel não informou um vencimento novo válido. Concilie antes de registrar.");
  if(newDue<=todayISO || newDue<=client.due_date)
    return blocked("O vencimento novo do servidor não confirma avanço de um ciclo válido.");
  const currentFinance=client.financial_due_date;
  if(!currentFinance)
    return blocked("Vencimento financeiro ausente. Revise o cadastro antes de registrar.");
  if(currentFinance<client.due_date)
    return blocked("Vencimento financeiro anterior ao técnico. Revise o cadastro.");
  if(!Number.isInteger(values.months)||values.months<1||values.months>120)
    return blocked("Quantidade de meses inválida.");

  // A provider cycle represents roughly one month, not an unlimited period.
  // When the account has already expired, providers can restart its 30-day
  // cycle from payment day; for an early renewal the next cycle starts from
  // the existing expiration. Accept calendar months plus a generous buffer,
  // but never let a surprising one-cycle response advance finance by a year.
  const anchor=client.due_date>todayISO?client.due_date:todayISO;
  const maxOneCycle=addDaysISO(anchor,45);
  if(!maxOneCycle||newDue>maxOneCycle)
    return blocked("O painel informou vencimento muito distante para apenas um ciclo. Verifique manualmente antes de registrar.");

  // The previous expiry is not mandatory in the provider response. If present,
  // it must corroborate the MaxFlix state; otherwise manual reconciliation.
  if(providerPreviousDue!==undefined){
    const previous=panelDateToISO(providerPreviousDue);
    if(!previous || previous!==client.due_date)
      return blocked("O vencimento anterior informado pelo painel difere da MaxFlix. Revise antes de atualizar.");
  }

  if(values.pilotKind==="unpaid"){
    if(currentFinance!==client.due_date||values.months!==1
      ||values.paymentAmount!==0||values.monthlyPaid!==0||values.paymentCost!==0
      ||values.financialDueDate!==values.dueDate)
      return blocked("Piloto gratuito inválido; não avance o financeiro sem validação.");
    // Both dates advance for the free access; the ledger never gains revenue.
    return {dueDate:newDue,financialDueDate:newDue,blockedReason:null};
  }
  if(currentFinance>client.due_date){
    if(values.months!==1||values.financialDueDate!==currentFinance
      ||values.paymentAmount!==0||values.monthlyPaid!==0||values.paymentCost!==0)
      return blocked("Pacote já pago: não avance o financeiro nem registre outra cobrança.");
    if(newDue>currentFinance)
      return blocked("O novo vencimento técnico ultrapassa o período financeiro pago.");
    return {dueDate:newDue,financialDueDate:currentFinance,blockedReason:null};
  }

  // Equal technical and financial dates signal a new paid period.
  // Free referral months have a distinct workflow; never silently create a
  // fresh paid financial period from a zero-payment provider renewal.
  if(values.paymentAmount<=0)
    return blocked("Novo período financeiro sem pagamento registrado. Revise o tipo de renovação.");
  // Always align the NEXT technical due to the actual provider result.
  if(values.months===1)
    return {dueDate:newDue,financialDueDate:newDue,blockedReason:null};

  // For a 6-/12-month package, one cycle is already provided by the panel.
  // Use the original anchor if the provider agreed with the expected date;
  // otherwise attach remaining prepaid months to the date actually confirmed.
  if(!/^\d{4}-\d{2}-\d{2}$/.test(values.dueDate))
    return blocked("Data de renovação planejada inválida.");
  const plannedFinance=newDue===values.dueDate?panelDateToISO(values.financialDueDate):null;
  if(newDue===values.dueDate && !plannedFinance)
    return blocked("Cobertura financeira planejada inválida.");
  const financialDue=plannedFinance ?? addMonthsISO(newDue,values.months-1);
  if(!financialDue || financialDue<newDue)
    return blocked("Não foi possível calcular a cobertura do pacote com segurança.");
  return {dueDate:newDue,financialDueDate:financialDue,blockedReason:null};
}

function addDaysISO(value:string,days:number):string|null {
  const parsed=panelDateToISO(value);
  if(!parsed||!Number.isInteger(days)||days<0||days>365)return null;
  const [year,month,day]=parsed.split("-").map(Number);
  const next=new Date(Date.UTC(year!,month!-1,day!+days));
  return next.toISOString().slice(0,10);
}

function addMonthsISO(value:string,months:number):string|null {
  const parsed=panelDateToISO(value);
  if(!parsed || !Number.isInteger(months)||months<0||months>120)return null;
  const [year,month,day]=parsed.split("-").map(Number);
  const start=new Date(Date.UTC(year!,month!-1+months,1));
  const maxDay=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+1,0)).getUTCDate();
  const due=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth(),Math.min(day!,maxDay)));
  return due.toISOString().slice(0,10);
}

export function buildPanelRecargaBody(login:string,simulate:boolean):{
  usuario:string;ciclos:1;simular?:true
} {
  if(!login || !login.trim() || login.length>160)throw Error("Login ausente ou inválido.");
  return simulate
    ? {usuario:login,ciclos:1,simular:true}
    : {usuario:login,ciclos:1};
}

export type ExternalRenewalState="confirmed"|"simulated"|"waiting"|"uncertain"|"failed";
export type ExternalOutcome={
  status:ExternalRenewalState;
  message:string;
  orderId?:string;
  previousDue?:string;
  nextDue?:string;
  candidates?:string[];
};

/**
 * Never infer success from HTTP 200 alone. The API can answer 202 (queued),
 * 207 (mixed batch), or mark a result as incerto. A simulated request is
 * NEVER confirmation of renewal.
 */
export function parsePanelRecargaResponse(
  httpStatus:number,data:unknown,expectedLogin:string,simulated=false,
):ExternalOutcome {
  if(typeof data!=="object"||data===null||Array.isArray(data))
    return {status:"uncertain",message:"Resposta não reconhecida; confira o pedido no painel."};
  const root=data as Record<string,unknown>;
  const orderId=typeof root["pedido_id"]==="string"?root["pedido_id"]:undefined;
  const results=Array.isArray(root["resultados"])?root["resultados"]:[];
  const row=results.length===1&&typeof results[0]==="object"&&results[0]!==null
    ? results[0] as Record<string,unknown> : null;
  const id=(row&&typeof row["pedido_id"]==="string"?row["pedido_id"]:orderId);
  const base={...(id?{orderId:id}:{})};
  if(httpStatus===202||root["precisa_login"]===true||root["aguardando_sessao"])
    return {...base,status:"waiting",message:"Pedido aguardando sessão ou confirmação no painel; não atualizar a MaxFlix."};
  if(row?.["incerto"]===true||root["incerto"]===true)
    return {...base,status:"uncertain",message:"Painel não confirmou o resultado. Verifique antes de tentar novamente."};
  if(simulated) {
    if(httpStatus===200 && root["ok"]===true && row?.["ok"]===true && row["usuario"]===expectedLogin){
      // The documented "vencimento_antes" may be omitted in simulations.
      // Never mistake vencimento_novo (projected post-renewal) for the current expiry.
      // Only expose a real, validated date bound to the *exact* matched login.
      const before=typeof row["vencimento_antes"]==="string"?row["vencimento_antes"]:undefined;
      const verified=panelDateToISO(before);
      return {...base,status:"simulated",
        message:"Usuário localizado na simulação; nenhum crédito foi consumido.",
        ...(verified?{previousDue:verified}:{}),
      };
    }
    return {...base,status:"failed",message:typeof root["erro"]==="string"?root["erro"]:"A simulação não confirmou o login exato."};
  }
  if(httpStatus===207)
    return {...base,status:"uncertain",message:"Resposta parcial (207); verifique cada item antes de atualizar a MaxFlix."};
  if(httpStatus>=500||httpStatus===408||httpStatus===429)
    return {...base,status:"uncertain",message:"Falha ou indisponibilidade do servidor; consulte o mesmo pedido."};
  if(httpStatus!==200){
    const err=typeof root["erro"]==="string"?root["erro"]:"Pedido não confirmado pelo painel.";
    const candidates=Array.isArray(row?.["candidatos"])?(row["candidatos"] as unknown[]).filter((c):c is string=>typeof c==="string").slice(0,8):undefined;
    return {...base,status:"failed",message:err,...(candidates?{candidates}:{})};
  }
  const loginExact=row?.["usuario"]===expectedLogin;
  if(root["ok"]===true && row?.["ok"]===true && loginExact && row?.["incerto"]!==true
    && (typeof row["ciclos_feitos"]!=="number"||row["ciclos_feitos"]===1)){
    return {
      ...base,status:"confirmed",message:"Renovação confirmada pelo painel externo.",
      ...(typeof row["vencimento_antes"]==="string"?{previousDue:row["vencimento_antes"]}:{}),
      ...(typeof row["vencimento_novo"]==="string"?{nextDue:row["vencimento_novo"]}:{}),
    };
  }
  if(root["ok"]===false && row?.["incerto"]!==true){
    return {...base,status:"failed",message:typeof root["erro"]==="string"?root["erro"]:typeof row?.["erro"]==="string"?row["erro"]:"Renovação recusada pelo painel."};
  }
  return {...base,status:"uncertain",message:"Resposta não confirma o login exato e o sucesso da renovação."};
}

export function isExternalSyncSafe(response:ExternalOutcome):boolean {
  return response.status==="confirmed";
}

/** Provider dates in the PDF are dd/MM/yyyy HH:mm:ss; no timezone assumption. */
export function panelDateToISO(value:string | undefined):string|null{
  if(!value)return null;
  const br=value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s|$)/);
  const iso=value.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:T|\s|$)/);
  if(!br&&!iso)return null;
  const y=br?br[3]!:iso![1]!,m=br?br[2]!:iso![2]!,d=br?br[1]!:iso![3]!;
  const check=new Date(Date.UTC(Number(y),Number(m)-1,Number(d)));
  if(check.getUTCFullYear()!==Number(y)||check.getUTCMonth()+1!==Number(m)||check.getUTCDate()!==Number(d))return null;
  return y+"-"+m+"-"+d;
}
