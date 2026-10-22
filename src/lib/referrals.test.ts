import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  referralBalance, referralsToPrize, pendingFreeMonths, referralMessage, referralWhatsAppUrl,
  type ReferralMovement, type ReferralReward,
} from "./referrals.ts";

const movement = (client_id: string, points: number, kind: ReferralMovement["kind"]): ReferralMovement => ({
  id: `${client_id}-${points}-${kind}`, client_id, referred_client_id: kind === "indicacao" ? "ref" : null,
  kind, points, note: null, created_at: "2026-10-22T12:00:00Z",
});
const reward = (client_id: string, kind: ReferralReward["reward"], status: ReferralReward["status"]): ReferralReward => ({
  id: "r", movement_id: "m", client_id, reward: kind, status,
  created_at: "2026-10-22T12:00:00Z", completed_at: status === "concluido" ? "2026-10-22T14:00:00Z" : null,
});

describe("referral accounting", () => {
  test("counts only this customer's points and subtracts used and expired points", () => {
    assert.equal(referralBalance("a", [
      movement("a", 1, "indicacao"), movement("a", 1, "indicacao"),
      movement("a", -2, "resgate"), movement("b", 1, "indicacao"),
    ]), 0);
    assert.equal(referralBalance("a", [
      movement("a", 1, "indicacao"), movement("a", -1, "expiracao"),
    ]), 0);
  });
  test("calculates the number of remaining paying referrals", () => {
    assert.equal(referralsToPrize(0), 10);
    assert.equal(referralsToPrize(3), 7);
    assert.equal(referralsToPrize(10), 0);
    assert.equal(referralsToPrize(12), 0);
  });
  test("counts only free months that have not yet been applied", () => {
    assert.equal(pendingFreeMonths("a", [
      reward("a", "mes_gratis", "pendente"),
      reward("a", "mes_gratis", "concluido"),
      reward("b", "mes_gratis", "pendente"),
      reward("a", "fire_stick", "pendente"),
    ]), 1);
  });
});

describe("referral WhatsApp incentive", () => {
  test("shows the exact remaining count and asterisks for bold", () => {
    const text = referralMessage({ name: "Ana Paula" }, 4);
    assert.match(text, /\*4 PONTOS\*/);
    assert.match(text, /\*6 indicações\*/);
    assert.match(text, /Fire TV Stick/);
  });
  test("congratulates eligible recipients and shows no negative count", () => {
    const text = referralMessage({ name: "João" }, 10);
    assert.match(text, /PARABÉNS/);
    assert.doesNotMatch(text, /Faltam apenas/);
  });
  test("only opens a WhatsApp link with a valid Brazilian number", () => {
    const text = referralMessage({ name: "Ana" }, 1);
    assert.equal(referralWhatsAppUrl("123", text), null);
    const url = referralWhatsAppUrl("(21) 99999-9999", text);
    assert.ok(url?.startsWith("https://wa.me/5521999999999?text="));
    assert.equal(decodeURIComponent(url!.split("?text=")[1]), text);
  });
});
