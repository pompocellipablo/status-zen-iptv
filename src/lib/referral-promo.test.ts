import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildReferralRecipients, REFERRAL_PROMO_MESSAGE, type ReferralPromoClient } from "./referral-promo.ts";

const make = (id: string, phone: string | null, due_date = "2026-12-01", access_type = "padrao"): ReferralPromoClient => ({
  id, name: id, login: id, server: "Club", whatsapp: phone, due_date, access_type,
});
const base = new Date(2026, 10, 16);

describe("Indique e Ganhe campaign audience", () => {
  test("sends once to the same normalized WhatsApp even when there are several IPTV logins", () => {
    const rows = buildReferralRecipients([
      make("sala", "(21) 99999-9999"),
      make("quarto", "+55 21 99999-9999"),
      make("outro", "21988888888"),
    ], base);
    assert.equal(rows.length, 2);
    assert.equal(rows.find(row => row.accounts.length === 2)?.phone, "5521999999999");
  });
  test("keeps missing and invalid numbers as separate unsendable contacts for correction", () => {
    const rows = buildReferralRecipients([make("a", null), make("b", "123")], base);
    assert.equal(rows.length, 2);
    assert.ok(rows.every(row => row.phone === null));
  });
  test("only includes currently active paying clients, not expired or personal accesses", () => {
    const rows = buildReferralRecipients([
      make("active", "21988888888", "2026-11-16"),
      make("expired", "21977777777", "2026-11-15"),
      make("personal", "21966666666", "2026-12-01", "meu_acesso"),
      make("package", "21955555555", "2026-12-01", "pacote_pago"),
    ], base);
    assert.deepEqual(rows.map(row => row.accounts[0]?.id), ["active", "package"]);
  });
  test("message keeps referral rewards and expiry terms", () => {
    assert.match(REFERRAL_PROMO_MESSAGE, /2 PONTOS/);
    assert.match(REFERRAL_PROMO_MESSAGE, /10 PONTOS/);
    assert.match(REFERRAL_PROMO_MESSAGE, /PROJETOR HY320/);
    assert.match(REFERRAL_PROMO_MESSAGE, /mais de 1 dia/);
  });
});
