import 'dotenv/config';

process.env.SUPABASE_URL ??= 'http://127.0.0.1:54321';
process.env.SUPABASE_ANON_KEY ??= 'sb_anon_key_test_dummy_min_20_chars';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'sb_service_role_key_test_dummy_min_20_chars';
