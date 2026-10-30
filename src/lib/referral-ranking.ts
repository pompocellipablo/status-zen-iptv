import { getStatus, type Client } from "./iptv";
import { referralBalance, type ReferralMovement, type ReferralReward } from "./referrals";

export type RankedReferral = {
  client: Client;
  confirmed: number;
  pending: number;
  total: number;
  activeReferred: number;
  pointsAvailable: number;
  pointsRedeemed: number;
  pointsExpired: number;
  pointsRestored: number;
  pendingRewards: number;
  completedRewards: number;
  referrals: Array<{ client: Client; confirmed: boolean; active: boolean }>;
};

/**
 * Ranking of historical referrers. Never equate the historic number of
 * subscriptions referred with the current available points balance:
 * redemptions and late renewals legitimately reduce the latter.
 *
 * Link-only referrals await first payment. The immutable "indicacao" ledger
 * confirms payment. A confirmed referral cannot also be pending.
 */
export function buildReferralRanking(
  clients: Client[], movements: ReferralMovement[], rewards: ReferralReward[],
): RankedReferral[] {
  const byId = new Map(clients.map(client => [client.id, client]));
  const grouped = new Map<string, { confirmed: Set<string>; linked: Set<string> }>();
  const clientGroup = (id: string) => {
    let group = grouped.get(id);
    if (!group) {
      group = { confirmed: new Set<string>(), linked: new Set<string>() };
      grouped.set(id, group);
    }
    return group;
  };

  for (const client of clients) {
    if (client.referred_by_client_id && client.referred_by_client_id !== client.id) {
      clientGroup(client.referred_by_client_id).linked.add(client.id);
    }
  }
  for (const movement of movements) {
    if (movement.kind === "indicacao" && movement.referred_client_id) {
      clientGroup(movement.client_id).confirmed.add(movement.referred_client_id);
    }
  }

  const ranked: RankedReferral[] = [];
  for (const [id, group] of grouped) {
    const client = byId.get(id);
    if (!client) continue;

    const confirmed = group.confirmed.size;
    const pendingIds = [...group.linked].filter(key => !group.confirmed.has(key));
    const referralIds = new Set([...group.confirmed, ...pendingIds]);
    const referrals = [...referralIds]
      .map(key => {
        const referred = byId.get(key);
        return referred ? {
          client: referred,
          confirmed: group.confirmed.has(key),
          active: getStatus(referred).key !== "vencido",
        } : null;
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((a,b) =>
        Number(b.confirmed) - Number(a.confirmed) ||
        a.client.name.localeCompare(b.client.name,"pt-BR")
      );
    const movementList = movements.filter(item => item.client_id === id);
    const rewardList = rewards.filter(item => item.client_id === id);
    ranked.push({
      client,
      confirmed,
      pending: pendingIds.length,
      total: confirmed + pendingIds.length,
      activeReferred: referrals.filter(r => r.confirmed && r.active).length,
      pointsAvailable: referralBalance(id,movements),
      pointsRedeemed: movementList.filter(m => m.kind==="resgate").reduce((sum,m)=>sum-Math.min(0,m.points),0),
      pointsExpired: movementList.filter(m => m.kind==="expiracao").reduce((sum,m)=>sum-Math.min(0,m.points),0),
      pointsRestored: movementList.filter(m => m.kind==="estorno").reduce((sum,m)=>sum+Math.max(0,m.points),0),
      pendingRewards: rewardList.filter(r => r.status==="pendente").length,
      completedRewards: rewardList.filter(r => r.status==="concluido").length,
      referrals,
    });
  }

  return ranked.sort((a,b)=>
    b.confirmed-a.confirmed ||
    b.total-a.total ||
    b.pointsAvailable-a.pointsAvailable ||
    a.client.name.localeCompare(b.client.name,"pt-BR")
  );
}
