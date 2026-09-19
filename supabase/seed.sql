-- =============================================================================
-- Seed de desarrollo local.
--
-- Solo lo ejecuta `supabase db reset` contra la base LOCAL. Nunca viaja a la
-- base remota con `supabase db push`.
--
-- No crea usuarios: `auth.users` se puebla desde Supabase Auth. Para probar
-- RLS, crea un usuario en Studio y añade su uuid a organization_members.
-- =============================================================================

insert into public.organizations (id, slug, name)
values ('00000000-0000-4000-8000-000000000001', 'teams4soft', 'Teams4Soft')
on conflict (id) do nothing;

insert into public.projects (id, organization_id, slug, name)
values (
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000001',
  'sitio-publico',
  'Sitio público'
)
on conflict (id) do nothing;

insert into public.assistant_configs (organization_id, project_id, display_name, locale, enabled_tools)
values (
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  'Tess',
  'es-MX',
  '{}'
)
on conflict (project_id) do nothing;

-- Para darte acceso en local, sustituye <TU_USER_UUID> y descomenta:
--
-- insert into public.organization_members (organization_id, user_id, role)
-- values ('00000000-0000-4000-8000-000000000001', '<TU_USER_UUID>', 'owner');
--
-- insert into public.project_members (project_id, user_id, role)
-- values ('00000000-0000-4000-8000-000000000002', '<TU_USER_UUID>', 'owner');
