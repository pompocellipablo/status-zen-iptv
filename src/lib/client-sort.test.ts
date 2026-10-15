import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { sortClients } from "./client-sort.ts";
import { paginateClients } from "./client-pagination.ts";

const clients = [
  { name: "Álvaro", login: "zeta", due_date: "2026-11-30" },
  { name: "Bruno", login: "alpha", due_date: "2026-10-20" },
  { name: "Ana", login: "login10", due_date: "2026-10-18" },
  { name: "ana", login: "login2", due_date: "2026-10-19" },
];

describe("client sorting", () => {
  test("orders displayed client names alphabetically with accents and natural numbers", () => {
    assert.deepEqual(sortClients(clients, "nome-asc").map(c=>c.name), ["Álvaro", "ana", "Ana", "Bruno"]);
    assert.deepEqual(sortClients(clients, "nome-desc").map(c=>c.name), ["Bruno", "ana", "Ana", "Álvaro"]);
  });
  test("orders logins independently of display name", () => {
    assert.deepEqual(sortClients(clients, "login-asc").map(c=>c.login), ["alpha", "login2", "login10", "zeta"]);
    assert.deepEqual(sortClients(clients, "login-desc").map(c=>c.login), ["zeta", "login10", "login2", "alpha"]);
  });
  test("preserves chronological sort used previously, in both directions", () => {
    assert.deepEqual(sortClients(clients, "vencimento-asc").map(c=>c.login), ["login10", "login2", "alpha", "zeta"]);
    assert.deepEqual(sortClients(clients, "vencimento-desc").map(c=>c.login), ["zeta", "alpha", "login2", "login10"]);
  });
  test("sorts the complete filtered list before pagination", () => {
    const sample = Array.from({ length: 52 }, (_,i) => ({
      name: `Cliente ${52-i}`,
      login: `user${52-i}`,
      due_date: "2026-11-01",
    }));
    const ordered = sortClients(sample, "login-asc");
    const page2 = paginateClients(ordered, 2);
    assert.equal(page2.rows.length, 25);
    assert.equal(page2.rows[0]?.login, "user26");
    assert.equal(page2.rows.at(-1)?.login, "user50");
  });
});
