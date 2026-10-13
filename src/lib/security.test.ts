import { test } from "node:test";
import assert from "node:assert/strict";
import { safeCsvText } from "./csv.ts";
import { isPanelOwner, PANEL_OWNER_ID } from "./panel-access.ts";

test("permite apenas o proprietário", () => {
  assert.equal(isPanelOwner(PANEL_OWNER_ID), true);
  assert.equal(isPanelOwner(undefined), false);
  assert.equal(isPanelOwner("00000000-0000-0000-0000-000000000001"), false);
});
test("neutraliza fórmulas e prefixos ocultos sem apagar o conteúdo", () => {
  for (const value of ['=1+1', '+SUM(A1)', '-1+2', '@SUM(A1)', '  =1+1', '\t=1+1', '\r=1+1', '\n=1+1', '＝1+1', '+5521999999999']) {
    assert.equal(safeCsvText(value), "'" + value);
  }
});
test("preserva textos comuns, acentos, aspas e separadores", () => {
  for (const value of ['', 'Pablo', 'João; Silva', 'Ana "A"', '21999999999']) {
    assert.equal(safeCsvText(value), value);
  }
});
