import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { creditBalance, creditCorrection, type CreditMovement } from "./server-credits.ts";

const entry = (kind: string, quantity: number, created_at: string): CreditMovement =>
  ({ id: `${kind}-${created_at}`, server: "Five", kind, quantity, created_at });
const initial = entry("initial", 14, "2026-10-13T16:00:00Z");

describe("saldo inicial dos servidores", () => {
  test("14 créditos permanecem 14 após 70 renovações anteriores", () => {
    const history = Array.from({ length: 70 }, () => entry("renewal", -1, "2026-10-12T16:00:00Z"));
    assert.equal(creditBalance([initial, ...history]), 14);
  });
  test("distingue renovações antes e depois do cadastro no mesmo dia", () => {
    assert.equal(creditBalance([
      entry("renewal", -1, "2026-10-13T16:01:00Z"), initial,
      entry("renewal", -1, "2026-10-13T15:59:00Z"),
    ]), 13);
  });
  test("preserva compras, ajustes e renovações posteriores em qualquer ordem", () => {
    assert.equal(creditBalance([
      entry("purchase", 100, "2026-10-12T10:00:00Z"),
      entry("adjustment", 5, "2026-10-12T11:00:00Z"), initial,
      entry("purchase", 10, "2026-10-14T10:00:00Z"),
      entry("adjustment", -2, "2026-10-14T11:00:00Z"),
      entry("renewal", -1, "2026-10-14T12:00:00Z"),
    ]), 21);
  });
  test("saldo inicial zero admite saldo negativo real após renovação", () => {
    assert.equal(creditBalance([{ ...initial, quantity: 0 }, entry("renewal", -1, "2026-10-14T12:00:00Z")]), -1);
  });
  test("sem saldo inicial, o estoque ainda não foi configurado", () => {
    assert.equal(creditBalance([]), 0);
    assert.equal(creditBalance([entry("renewal", -1, "2026-10-12T16:00:00Z")]), 0);
  });
});

describe("correção pelo saldo real do servidor", () => {
  for (const [current, target] of [[28, 14], [14, 20], [14, 0], [14, 14], [-56, 14]]) {
    test(`saldo ${current} corrigido para ${target}`, () => {
      const history = [initial, entry("adjustment", current! - 14, "2026-10-14T10:00:00Z")];
      const delta = creditCorrection(history, target!);
      assert.equal(creditBalance([...history, entry("adjustment", delta, "2026-10-14T11:00:00Z")]), target);
    });
  }
  test("recalcula a diferença com uma renovação recente", () => {
    const history = [initial, entry("renewal", -1, "2026-10-14T10:00:00Z")];
    assert.equal(creditCorrection(history, 14), 1);
  });
  test("não duplica saldo nem aceita valores inválidos", () => {
    assert.equal(creditCorrection([initial], 14), 0);
    for (const target of [-1, 1.5, NaN, Infinity, 1000001]) {
      assert.throws(() => creditCorrection([initial], target));
    }
    assert.throws(() => creditCorrection([], 14));
  });
});
