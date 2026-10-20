import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  eligibleForMigration,
  canonicalPhone,
  campaignWhatsAppLink,
  samePhoneAlreadySent,
  MIGRATION_MESSAGE,
  type CampaignAccess,
  type CampaignTracking,
} from "./whatsapp-campaign.ts";

const base = new Date(2026, 9, 19);
const c = (id: string, due_date: string, whatsapp: string | null): CampaignAccess => ({
  id, due_date, whatsapp, name: id, login: id, server: "Five",
});

describe("migration eligibility", () => {
  test("includes future and due-today accesses", () => {
    assert.equal(eligibleForMigration(c("a", "2026-10-19", null), base), true);
    assert.equal(eligibleForMigration(c("b", "2026-11-19", null), base), true);
  });
  test("includes exactly 10 overdue days, excludes 11", () => {
    assert.equal(eligibleForMigration(c("a", "2026-10-09", null), base), true);
    assert.equal(eligibleForMigration(c("b", "2026-10-08", null), base), false);
  });
});
describe("contact numbers", () => {
  test("normalizes Brazilian local numbers with and without +55", () => {
    assert.equal(canonicalPhone("(21) 99999-9999"), "5521999999999");
    assert.equal(canonicalPhone("+55 (21) 99999-9999"), "5521999999999");
    assert.equal(canonicalPhone("123"), null);
    assert.equal(canonicalPhone(null), null);
  });
  test("opens WhatsApp with the prefilled migration message", () => {
    const link = campaignWhatsAppLink("21999999999");
    assert.ok(link?.startsWith("https://wa.me/5521999999999?text="));
    assert.equal(decodeURIComponent(link!.split("?text=")[1]), MIGRATION_MESSAGE);
  });
  test("never opens link without a valid number", () => {
    assert.equal(campaignWhatsAppLink(""), null);
  });
});
describe("avoid duplicate messages to the same number", () => {
  const clients = [
    c("sala", "2026-11-01", "21999999999"),
    c("quarto", "2026-11-02", "+55 21 99999-9999"),
    c("outro", "2026-11-02", "21988888888"),
  ];
  const tracking: Record<string, CampaignTracking> = {
    sala: { client_id: "sala", phone_reviewed: true, agenda_updated: true,
      sent_at: "2026-10-19T14:00:00Z", replied_at: null, payer_name: null },
  };
  test("flags another login with same confirmed number", () => {
    assert.equal(samePhoneAlreadySent(clients[1], clients, tracking, {}), true);
    assert.equal(samePhoneAlreadySent(clients[2], clients, tracking, {}), false);
  });
  test("does not flag when phone changes or send confirmation disappears", () => {
    assert.equal(samePhoneAlreadySent(clients[1], clients, tracking, { quarto: "21977777777" }), false);
    assert.equal(samePhoneAlreadySent(clients[1], clients, {}, {}), false);
  });
});
