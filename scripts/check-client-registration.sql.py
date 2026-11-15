"""Emit a rollback-only PostgreSQL fixture test; never targets live tables for writes.
Run generated SQL through the read/write SQL tool. All mutable objects are pg_temp.
"""
from pathlib import Path
sql = Path('docs/sql/register-client-with-payment.sql').read_text()
function = sql[sql.index('CREATE FUNCTION'):sql.index('REVOKE ALL ON FUNCTION')]
for name in ['register_client_with_payment','client_initial_registrations','clients','payments','server_credit_movements']:
    function = function.replace('public.'+name, 'pg_temp.'+name)
print('''BEGIN;
CREATE TEMP TABLE clients (LIKE public.clients INCLUDING ALL);
CREATE TEMP TABLE payments (LIKE public.payments INCLUDING ALL);
CREATE TEMP TABLE server_credit_movements (LIKE public.server_credit_movements INCLUDING ALL);
CREATE TEMP TABLE client_initial_registrations(id uuid PRIMARY KEY,actor_id uuid NOT NULL,client_id uuid,request jsonb NOT NULL);
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
''')
print(function)
print('''
DO $test$
DECLARE
 d date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
 request jsonb; cid uuid; rid uuid := gen_random_uuid(); rejected boolean;
BEGIN
 request := jsonb_build_object('name','Fixture','login','fixture','server','Five','months',6,
  'starts_on',d,'paid_on',d,'due_date',(d+interval '1 month')::date,'amount',175,'cost',6.5,
  'payment_confirmed',true,'activation_confirmed',true,'debit_credit',true,
  'whatsapp','','notes','','referred_by_client_id','','referral_first_payment_confirmed',false);
 cid := pg_temp.register_client_with_payment(rid,request);
 IF (SELECT count(*) FROM pg_temp.payments WHERE client_id=cid AND amount=175 AND cost=39)<>1
 OR (SELECT count(*) FROM pg_temp.clients WHERE id=cid AND paid=0 AND prev_paid=0
   AND access_type='pacote_pago' AND financial_due_date=(d+interval '6 months')::date)<>1
 OR (SELECT count(*) FROM pg_temp.server_credit_movements WHERE client_id=cid AND quantity=-1)<>1
 THEN RAISE EXCEPTION 'FAIL semestral'; END IF;
 IF pg_temp.register_client_with_payment(rid,request)<>cid
 OR (SELECT count(*) FROM pg_temp.payments)<>1
 OR (SELECT count(*) FROM pg_temp.server_credit_movements)<>1
 THEN RAISE EXCEPTION 'FAIL idempotence'; END IF;
 rejected:=false;
 BEGIN PERFORM pg_temp.register_client_with_payment(rid,request||'{"amount":180}');
 EXCEPTION WHEN raise_exception THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'FAIL changed retry accepted'; END IF;
 rejected:=false;
 BEGIN PERFORM pg_temp.register_client_with_payment(gen_random_uuid(),request);
 EXCEPTION WHEN raise_exception THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'FAIL duplicate login accepted'; END IF;
 rejected:=false;
 BEGIN PERFORM pg_temp.register_client_with_payment(gen_random_uuid(),request||'{"login":"invalid","payment_confirmed":false}');
 EXCEPTION WHEN raise_exception THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'FAIL unconfirmed payment accepted'; END IF;
 -- Monthly and annual payments; no automatic debit without explicit selection.
 cid:=pg_temp.register_client_with_payment(gen_random_uuid(),request||jsonb_build_object('login','monthly','months',1,'amount',35,'debit_credit',false));
 IF (SELECT paid FROM pg_temp.clients WHERE id=cid)<>35
 OR (SELECT count(*) FROM pg_temp.server_credit_movements)<>1 THEN RAISE EXCEPTION 'FAIL monthly'; END IF;
 cid:=pg_temp.register_client_with_payment(gen_random_uuid(),request||jsonb_build_object('login','annual','months',12,'amount',320,'debit_credit',false));
 IF (SELECT count(*) FROM pg_temp.clients WHERE id=cid AND paid=0 AND financial_due_date=(d+interval '12 months')::date)<>1
 OR (SELECT count(*) FROM pg_temp.payments WHERE client_id=cid AND amount=320 AND cost=78)<>1
 THEN RAISE EXCEPTION 'FAIL annual'; END IF;
 -- Force an insertion failure after the client INSERT: no orphan survives.
 ALTER TABLE pg_temp.payments ADD CONSTRAINT fixture_payment_limit CHECK(amount<999);
 rejected:=false;
 BEGIN PERFORM pg_temp.register_client_with_payment(gen_random_uuid(),request||'{"login":"failure","amount":1000}');
 EXCEPTION WHEN check_violation THEN rejected:=true; END;
 IF NOT rejected OR EXISTS(SELECT 1 FROM pg_temp.clients WHERE login='failure')
 OR (SELECT count(*) FROM pg_temp.client_initial_registrations)<>3
 THEN RAISE EXCEPTION 'FAIL atomic rollback'; END IF;
 PERFORM set_config('request.jwt.claim.sub','',true);
 rejected:=false;
 BEGIN PERFORM pg_temp.register_client_with_payment(gen_random_uuid(),request||'{"login":"anon"}');
 EXCEPTION WHEN raise_exception THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'FAIL unauthenticated call'; END IF;
END;
$test$;
ROLLBACK;
SELECT 'PASS: six/monthly/annual, idempotence, duplicate login, confirmations, atomic rollback and unauthenticated call; fixtures rolled back' AS result;
''')
