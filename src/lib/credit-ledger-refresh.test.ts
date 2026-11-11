import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const credits = readFileSync(new URL("../routes/_authenticated/creditos.tsx", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../routes/_authenticated/index.tsx", import.meta.url), "utf8");
const renewals = readFileSync(new URL("../routes/_authenticated/renovacoes.tsx", import.meta.url), "utf8");

describe("Credit stock stays visibly and internally fresh", () => {
  it("rechecks the MaxFlix ledger while open and when the window regains focus", () => {
    assert.match(credits, /refetchInterval: CREDIT_REFRESH_MS/);
    assert.match(credits, /refetchOnWindowFocus: "always"/);
    assert.match(dashboard, /refetchInterval:30_000/);
    assert.match(dashboard, /refetchOnWindowFocus:"always"/);
  });
  it("labels stock as internal, without claiming unsupported provider balance calls", () => {
    assert.match(credits, /Saldo interno da MaxFlix/);
    assert.match(credits, /Não é uma consulta ao estoque real/);
    assert.match(credits, /Conferir com saldo do painel/);
    assert.doesNotMatch(credits, /PAINEL_RECARGA_TOKEN|X-Auth-Token/);
  });
  it("invalidates both credit screens after local renewal and corrections", () => {
    const internalKey = '["server-credit-movements"]';
    const dashboardKey = '["credit-stock-dashboard-movements"]';
    const manual = renewals.slice(renewals.indexOf("const performRenewal ="), renewals.indexOf("const useReferralMonth ="));
    assert.ok(manual.includes(internalKey));
    assert.ok(manual.includes(dashboardKey));
    assert.match(credits, /const refresh = \(\) => void Promise\.all\(\[/);
    assert.ok(credits.includes(internalKey));
    assert.ok(credits.includes(dashboardKey));
  });
});
