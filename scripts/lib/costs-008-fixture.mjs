// Synthetic integration fixture, ONLY included in the allowlisted 008 rollback
// transaction. No real aircraft/user data is modified and no fixture can commit.
export const COSTS_008_FIXTURE_STATEMENTS = [
`DO $fixture$ BEGIN
 INSERT INTO app.users(user_id,email,status,preferred_locale,updated_at) VALUES
 ('c0080000-0000-4000-8000-000000000001','costs-rollback@example.invalid','ACTIVE','es',now());
 INSERT INTO app.aircraft(aircraft_id,manufacturer,model,status,created_by_user_id,updated_at) VALUES
 ('c0080000-0000-4000-8000-000000000002','ROLLBACK TEST','SYNTHETIC','ACTIVE','c0080000-0000-4000-8000-000000000001',now());
 INSERT INTO app.parties(party_id,party_type,organization_name,status,updated_at) VALUES
 ('c0080000-0000-4000-8000-000000000003','ORGANIZATION','SYNTHETIC RESPONSIBLE','ACTIVE',now()),
 ('c0080000-0000-4000-8000-000000000004','ORGANIZATION','SYNTHETIC PAYER','ACTIVE',now());
 INSERT INTO app.cost_financial_scopes(financial_scope_id,aircraft_id,label,approval_reference,created_by_user_id) VALUES
 ('c0080000-0000-4000-8000-000000000005','c0080000-0000-4000-8000-000000000002','ROLLBACK ONLY','ISOLATED_ROLLBACK_TEST_ONLY','c0080000-0000-4000-8000-000000000001');
 INSERT INTO app.cost_concepts(cost_concept_id,aircraft_id,financial_scope_id,name,cost_class,default_allocation_method) VALUES
 ('c0080000-0000-4000-8000-000000000006','c0080000-0000-4000-8000-000000000002','c0080000-0000-4000-8000-000000000005','TEST','VARIABLE','DIRECT');
 INSERT INTO app.expenses(expense_id,aircraft_id,cost_concept_id,expense_date,amount,currency_code,allocation_method,details_version) VALUES
 ('c0080000-0000-4000-8000-000000000007','c0080000-0000-4000-8000-000000000002','c0080000-0000-4000-8000-000000000006','2026-10-01',100,'USD','DIRECT',1);
 INSERT INTO app.cost_expense_corrections(cost_expense_correction_id,expense_id,base_details_version,request_id,actor_user_id,reason) VALUES
 ('c0080000-0000-4000-8000-000000000008','c0080000-0000-4000-8000-000000000007',0,'c0080000-0000-4000-8000-000000000008','c0080000-0000-4000-8000-000000000001','SYNTHETIC INITIAL');
END; $fixture$;`,
`DO $runtime_test$ BEGIN
 INSERT INTO app.expense_payments(expense_payment_id,expense_id,payer_party_id,amount,created_correction_id) VALUES
 ('c0080000-0000-4000-8000-000000000009','c0080000-0000-4000-8000-000000000007','c0080000-0000-4000-8000-000000000003',100,'c0080000-0000-4000-8000-000000000008');
 INSERT INTO app.expense_allocations(expense_allocation_id,expense_id,party_id,allocation_percent,allocated_amount,source_method,created_correction_id) VALUES
 ('c0080000-0000-4000-8000-000000000010','c0080000-0000-4000-8000-000000000007','c0080000-0000-4000-8000-000000000003',100,100,'DIRECT','c0080000-0000-4000-8000-000000000008');
 BEGIN
  UPDATE app.expense_payments SET amount=1 WHERE expense_payment_id='c0080000-0000-4000-8000-000000000009';
  RAISE EXCEPTION 'AMOUNT_UPDATE_WAS_ALLOWED';
 EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL; END;
 IF has_table_privilege('app_horas_runtime','app.cost_financial_authorities','INSERT') THEN
 RAISE EXCEPTION 'SELF_AUTHORITY_WAS_ALLOWED'; END IF;
 BEGIN
  INSERT INTO app.expense_allocations(expense_id,party_id,allocation_percent,allocated_amount,source_method,created_correction_id) VALUES
  ('c0080000-0000-4000-8000-000000000007','c0080000-0000-4000-8000-000000000003',100,100,'DIRECT','c0080000-0000-4000-8000-000000000008');
  RAISE EXCEPTION 'DUPLICATE_ACTIVE_ALLOCATION_WAS_ALLOWED';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 INSERT INTO app.cost_expense_corrections(cost_expense_correction_id,expense_id,base_details_version,request_id,actor_user_id,reason) VALUES
 ('c0080000-0000-4000-8000-000000000011','c0080000-0000-4000-8000-000000000007',1,'c0080000-0000-4000-8000-000000000011','c0080000-0000-4000-8000-000000000001','SYNTHETIC CORRECTION');
 UPDATE app.expenses SET details_version=2 WHERE expense_id='c0080000-0000-4000-8000-000000000007';
 UPDATE app.expense_payments SET retired_correction_id='c0080000-0000-4000-8000-000000000011',retired_at=now(),retired_by_user_id='c0080000-0000-4000-8000-000000000001'
 WHERE expense_id='c0080000-0000-4000-8000-000000000007';
 INSERT INTO app.expense_payments(expense_id,payer_party_id,amount,created_correction_id) VALUES
 ('c0080000-0000-4000-8000-000000000007','c0080000-0000-4000-8000-000000000004',100,'c0080000-0000-4000-8000-000000000011');
 UPDATE app.expense_allocations SET retired_correction_id='c0080000-0000-4000-8000-000000000011',retired_at=now(),retired_by_user_id='c0080000-0000-4000-8000-000000000001'
 WHERE expense_id='c0080000-0000-4000-8000-000000000007';
 INSERT INTO app.expense_allocations(expense_id,party_id,allocation_percent,allocated_amount,source_method,created_correction_id) VALUES
 ('c0080000-0000-4000-8000-000000000007','c0080000-0000-4000-8000-000000000003',100,100,'DIRECT','c0080000-0000-4000-8000-000000000011');
 IF (SELECT sum(amount) FROM app.expense_payments WHERE expense_id='c0080000-0000-4000-8000-000000000007' AND retired_at IS NULL)<>100
 OR (SELECT count(*) FROM app.expense_payments WHERE expense_id='c0080000-0000-4000-8000-000000000007' AND retired_at IS NOT NULL)<>1 THEN RAISE EXCEPTION 'RETIREMENT_FAILED'; END IF;
 INSERT INTO app.cost_settlements(cost_settlement_id,aircraft_id,period_start_date,period_end_date,currency_code,settled_at,settled_by_user_id) VALUES
 ('c0080000-0000-4000-8000-000000000012','c0080000-0000-4000-8000-000000000002','2026-10-01','2026-10-31','USD',now(),'c0080000-0000-4000-8000-000000000001');
 INSERT INTO app.cost_settlement_expense_lines(cost_settlement_id,expense_id,cost_concept_id,expense_date,amount,currency_code,allocation_method) VALUES
 ('c0080000-0000-4000-8000-000000000012','c0080000-0000-4000-8000-000000000007','c0080000-0000-4000-8000-000000000006','2026-10-01',100,'USD','DIRECT');
 BEGIN
  UPDATE app.expense_payments SET retired_correction_id='c0080000-0000-4000-8000-000000000011',retired_at=now(),retired_by_user_id='c0080000-0000-4000-8000-000000000001'
   WHERE expense_id='c0080000-0000-4000-8000-000000000007' AND retired_at IS NULL;
  RAISE EXCEPTION 'FROZEN_PAYMENT_UPDATE_WAS_ALLOWED';
 EXCEPTION WHEN check_violation THEN NULL; END;
 IF has_table_privilege('app_horas_runtime','app.cost_settlements','UPDATE,DELETE')
 OR has_table_privilege('app_runtime','app.cost_settlements','UPDATE,DELETE') THEN RAISE EXCEPTION 'SNAPSHOT_MUTATION_WAS_ALLOWED'; END IF;
 INSERT INTO audit.audit_events(audit_event_id,request_id,actor_type,actor_user_id,operation_source,aircraft_id,entity_type,entity_id,action_code,entity_key,metadata,payload_version)
 VALUES ('c0080000-0000-4000-8000-000000000013','c0080000-0000-4000-8000-000000000013','USER','c0080000-0000-4000-8000-000000000001','MANUAL','c0080000-0000-4000-8000-000000000002','COST','c0080000-0000-4000-8000-000000000007','COST_ROLLBACK_TEST','{}','{}',1);
 IF has_table_privilege('app_horas_runtime','audit.audit_events','UPDATE,DELETE') THEN RAISE EXCEPTION 'AUDIT_UPDATE_WAS_ALLOWED'; END IF;
END; $runtime_test$;`,
];
