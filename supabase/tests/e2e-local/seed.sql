-- Test people for the LOCAL scratch database. Fictitious.
INSERT INTO auth.users (id, email) VALUES
 ('a0000000-0000-0000-0000-0000000000a1','sa@test.local'),
 ('a0000000-0000-0000-0000-0000000000a2','admin@test.local'),
 ('a0000000-0000-0000-0000-0000000000a3','ops@test.local'),
 ('a0000000-0000-0000-0000-0000000000a4','fin@test.local'),
 ('a0000000-0000-0000-0000-0000000000a5','support@test.local'),
 ('b0000000-0000-0000-0000-0000000000b1','officer@test.local'),
 ('10000000-0000-0000-0000-0000000000c1','both@test.local'),
 ('10000000-0000-0000-0000-0000000000c2','pending.kyc@test.local'),
 ('10000000-0000-0000-0000-0000000000c3','login.only@test.local') ON CONFLICT DO NOTHING;
INSERT INTO profiles (id, email, full_name, role) VALUES
 ('a0000000-0000-0000-0000-0000000000a1','sa@test.local','Test Super Admin','super_admin'),
 ('a0000000-0000-0000-0000-0000000000a2','admin@test.local','Test Administrator','administrator'),
 ('a0000000-0000-0000-0000-0000000000a3','ops@test.local','Test Operations','operations'),
 ('a0000000-0000-0000-0000-0000000000a4','fin@test.local','Test Finance','finance'),
 ('a0000000-0000-0000-0000-0000000000a5','support@test.local','Test Support','customer_support'),
 ('b0000000-0000-0000-0000-0000000000b1','officer@test.local','Test Officer','payment_officer'),
 ('10000000-0000-0000-0000-0000000000c1','both@test.local','','investor'),
 ('10000000-0000-0000-0000-0000000000c2','pending.kyc@test.local','Pending Kyc','investor'),
 ('10000000-0000-0000-0000-0000000000c3','login.only@test.local','Login Only','investor')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, full_name = EXCLUDED.full_name, email = EXCLUDED.email;
INSERT INTO investors (id, profile_id, investor_code, full_name, email, phone, bank_name, account_name, account_number, kyc_status) VALUES
 ('20000000-0000-0000-0000-0000000000c1','10000000-0000-0000-0000-0000000000c1','MGT001','Both Products','both@test.local','08010000001','GTB','Both Products','0123456701','approved'),
 ('20000000-0000-0000-0000-0000000000c2','10000000-0000-0000-0000-0000000000c2','MGT002','Pending Kyc','pending.kyc@test.local','08010000002','Zenith','Pending Kyc','0123456702','pending');
-- "Both Products" holds a MaalGrow investment, as a real investor in both does.
INSERT INTO cycles (id, series_id, cycle_number, cycle_label, start_date, end_date, status)
SELECT '30000000-0000-0000-0000-0000000000c1', id, 1, 'A-E2E-1', '2026-07-01', '2027-01-01', 'active' FROM series WHERE name = 'A';
INSERT INTO investments (investment_code, investor_id, series_id, cycle_id, units, price_per_unit, capital,
                         investment_date, maturity_date, status)
SELECT 'INV-E2E-BOTH', '20000000-0000-0000-0000-0000000000c1', series_id, id, 1, 1000000, 1000000, '2026-07-01', '2027-01-01', 'active'
  FROM cycles WHERE id = '30000000-0000-0000-0000-0000000000c1';
