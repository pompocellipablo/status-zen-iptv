import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildReferralRanking } from "./referral-ranking";
import type { Client } from "./iptv";
import type { ReferralMovement, ReferralReward } from "./referrals";

const client=(id:string,name:string,referred_by_client_id:string|null=null,due_date="2030-01-01")=>({
  id,name,referred_by_client_id,due_date,login:id,server:"Five",
  referral_first_payment_confirmed:false,financial_due_date:null,whatsapp:null,
  paid:35,cost:6,prev_paid:35,prev_cost:6,
}) as Client;
const ledger=(id:string,client_id:string,kind:ReferralMovement["kind"],points:number,referred_client_id:string|null=null)=>({
  id,client_id,kind,points,referred_client_id,note:null,reversed_expiration_id:null,
  created_at:"2026-10-29T12:00:00Z",
}) as ReferralMovement;

describe("historical referral ranking",()=>{
  test("orders by confirmed referrals, with pending links visible but uncredited",()=>{
    const clients=[
      client("a","Ana"),
      client("b","Bruno"),
      client("c","Carlos","a"),
      client("d","Daniela","a"),
      client("e","Eduardo","b"),
      client("f","Fernanda","a"),
      client("g","Gabriel","b"),
    ];
    const movements=[
      ledger("1","a","indicacao",1,"c"),ledger("2","a","indicacao",1,"d"),
      ledger("3","b","indicacao",1,"e"),
    ];
    const result=buildReferralRanking(clients,movements,[]);
    assert.deepEqual(result.map(r=>r.client.name),["Ana","Bruno"]);
    assert.deepEqual([result[0].confirmed,result[0].pending,result[0].total],[2,1,3]);
    assert.deepEqual([result[1].confirmed,result[1].pending],[1,1]);
    assert.ok(result[0].referrals.some(r=>r.client.id==="f"&&!r.confirmed));
  });
  test("used or expired points do not remove past indications from leaderboard",()=>{
    const clients=[client("a","Ana"),client("c","Carlos","a"),client("d","Daniela","a")];
    const movements=[
      ledger("1","a","indicacao",1,"c"), ledger("2","a","indicacao",1,"d"),
      ledger("3","a","resgate",-2),ledger("4","a","estorno",1),
      ledger("5","a","expiracao",-1),
    ];
    const result=buildReferralRanking(clients,movements,[]);
    assert.equal(result[0].confirmed,2);
    assert.equal(result[0].pointsAvailable,0);
    assert.equal(result[0].pointsRedeemed,2);
    assert.equal(result[0].pointsExpired,1);
    assert.equal(result[0].pointsRestored,1);
  });
  test("ignores unrelated accounts and excludes confirmed links from pending",()=>{
    const clients=[client("a","Ana"),client("b","Bruno"),client("c","Cecília","a")];
    const movements=[ledger("1","a","indicacao",1,"c")];
    const result=buildReferralRanking(clients,movements,[]);
    assert.equal(result.length,1);
    assert.equal(result[0].confirmed,1);
    assert.equal(result[0].pending,0);
    assert.equal(result[0].total,1);
  });
  test("keeps unconfirmed referrals of a previously inactive indicator in history",()=>{
    const clients=[client("a","Ana",null,"2020-01-01"),client("b","Bruno","a")];
    const result=buildReferralRanking(clients,[],[]);
    assert.equal(result.length,1);
    assert.equal(result[0].pending,1);
  });
  test("counts pending rewards separately from delivered prizes",()=>{
    const clients=[client("a","Ana"),client("b","Bruno","a")];
    const rewards=[
      {client_id:"a",status:"pendente",id:"1"},
      {client_id:"a",status:"concluido",id:"2"},
    ] as ReferralReward[];
    const result=buildReferralRanking(clients,[],rewards);
    assert.equal(result[0].pendingRewards,1);
    assert.equal(result[0].completedRewards,1);
  });
});