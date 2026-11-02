import { test } from "node:test";
import assert from "node:assert/strict";
import {auditServerAccounts, parsePanelExport, normalizeAccountLogin} from "./server-panel-audit";
import type {Client} from "./iptv";
const client=(login:string,due_date:string,server="Five"):Client=>({
  id:login,name:login,login,server,due_date,financial_due_date:null,paid:35,cost:6.5,prev_paid:35,prev_cost:6.5,whatsapp:null,
});
test("recognizes common panel CSV headers, statuses and dates",()=>{
  const result=parsePanelExport("usuário;Situação;Vencimento\nTeste1;Ativo;02/11/2026\nTESTE2;Inativo;2026-11-03");
  assert.equal(result.accounts.length,2);
  assert.deepEqual(result.accounts[0],{login:"Teste1",status:"active",expires:"2026-11-02"});
  assert.deepEqual(result.accounts[1],{login:"TESTE2",status:"inactive",expires:"2026-11-03"});
});
test("accepts login-only TXT safely without inventing status",()=>{
  const parsed=parsePanelExport("LOGIN_A\nlogin_b\n");
  assert.equal(parsed.hadRecognizedHeader,false);
  assert.equal(parsed.accounts.length,2);
  assert.equal(parsed.accounts[0]?.status,"unknown");
  assert.equal(parsed.hasStatus,false);
});
test("uses case-insensitive normalized logins",()=>{
  assert.equal(normalizeAccountLogin("  Nº01 " ),normalizeAccountLogin("nº01"));
});
test("reports missing panel users and expired-status mismatches without modifying clients",()=>{
  const app=[client("ONE","2099-01-01"),client("TWO","2020-01-01")];
  const exportRows=parsePanelExport("login,status\none,inativo\nother,ativo").accounts;
  const result=auditServerAccounts(app,exportRows);
  assert.equal(result.statusDifferences.length,1);
  assert.equal(result.panelOnly.length,1);
  assert.equal(result.maxflixOnly.length,1);
  assert.equal(result.duplicatePanel.length,0);
});
test("flags duplicate panel logins rather than guessing the match",()=>{
  const app=[client("one","2099-01-01")];
  const panel=parsePanelExport("login\none\nONE").accounts;
  const result=auditServerAccounts(app,panel);
  assert.deepEqual(result.duplicatePanel,["one"]);
  assert.equal(result.statusDifferences.length,0);
});
test("does not flag active/inactive differences if panel has no status",()=>{
  const app=[client("ONE","2099-01-01")];
  const result=auditServerAccounts(app,parsePanelExport("ONE").accounts);
  assert.equal(result.matching,1);
  assert.equal(result.statusDifferences.length,0);
});
