-- =============================================================================
-- 0006 · Row Level Security
--
-- Principio del plan: "la protección no debe depender solamente de un filtro
-- escrito por el desarrollador en cada consulta". Aquí el filtro por tenant es
-- una propiedad de la base, no del código de la API.
--
-- `service_role` (backend en Cloud Run) bypasea RLS por definición. Por eso los
-- roles `anon` y `authenticated` reciben aquí el mínimo imprescindible.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helpers. SECURITY DEFINER para que consultar la pertenencia no vuelva a
-- disparar RLS sobre las propias tablas de pertenencia (recursión infinita).
-- `set search_path = ''` obliga a cualificar todo y evita secuestro de esquema.
-- -----------------------------------------------------------------------------
create or replace function public.is_org_member(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = p_organization_id
      and m.user_id = (select auth.uid())
  );
$fn$;

create or replace function public.is_org_admin(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = p_organization_id
      and m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin')
  );
$fn$;

create or replace function public.is_project_member(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.project_members pm
    where pm.project_id = p_project_id
      and pm.user_id = (select auth.uid())
  )
  or exists (
    select 1
    from public.projects p
    join public.organization_members m on m.organization_id = p.organization_id
    where p.id = p_project_id
      and m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin')
  );
$fn$;

revoke all on function public.is_org_member(uuid) from public, anon;
revoke all on function public.is_org_admin(uuid) from public, anon;
revoke all on function public.is_project_member(uuid) from public, anon;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.is_org_admin(uuid) to authenticated;
grant execute on function public.is_project_member(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- RLS activo en todas las tablas de aplicación. Sin política => sin acceso.
-- -----------------------------------------------------------------------------
alter table public.organizations          enable row level security;
alter table public.organization_members   enable row level security;
alter table public.projects               enable row level security;
alter table public.project_members        enable row level security;
alter table public.documents              enable row level security;
alter table public.document_sections      enable row level security;
alter table public.document_embeddings    enable row level security;
alter table public.conversations          enable row level security;
alter table public.messages               enable row level security;
alter table public.assistant_configs      enable row level security;
alter table public.connector_credentials  enable row level security;
alter table public.audit_events           enable row level security;

-- `anon` no toca nada. El widget público habla con la API, no con PostgREST.
revoke all on all tables in schema public from anon;

-- -----------------------------------------------------------------------------
-- organizations
-- -----------------------------------------------------------------------------
grant select, update on public.organizations to authenticated;

create policy organizations_select on public.organizations
  for select to authenticated
  using (public.is_org_member(id));

create policy organizations_update on public.organizations
  for update to authenticated
  using (public.is_org_admin(id))
  with check (public.is_org_admin(id));

-- -----------------------------------------------------------------------------
-- organization_members
-- -----------------------------------------------------------------------------
grant select, insert, update, delete on public.organization_members to authenticated;

create policy organization_members_select on public.organization_members
  for select to authenticated
  using (public.is_org_member(organization_id));

create policy organization_members_write on public.organization_members
  for all to authenticated
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

-- -----------------------------------------------------------------------------
-- projects
-- -----------------------------------------------------------------------------
grant select, insert, update, delete on public.projects to authenticated;

create policy projects_select on public.projects
  for select to authenticated
  using (public.is_project_member(id));

create policy projects_write on public.projects
  for all to authenticated
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

-- -----------------------------------------------------------------------------
-- project_members
-- -----------------------------------------------------------------------------
grant select, insert, update, delete on public.project_members to authenticated;

create policy project_members_select on public.project_members
  for select to authenticated
  using (public.is_project_member(project_id));

create policy project_members_write on public.project_members
  for all to authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_members.project_id
        and public.is_org_admin(p.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.projects p
      where p.id = project_members.project_id
        and public.is_org_admin(p.organization_id)
    )
  );

-- -----------------------------------------------------------------------------
-- documents / secciones / embeddings
-- Lectura para miembros del proyecto. La escritura la hace el ingest-worker
-- con service_role: `authenticated` no recibe insert/update/delete.
-- -----------------------------------------------------------------------------
grant select on public.documents           to authenticated;
grant select on public.document_sections   to authenticated;
grant select on public.document_embeddings to authenticated;

create policy documents_select on public.documents
  for select to authenticated
  using (public.is_project_member(project_id));

create policy document_sections_select on public.document_sections
  for select to authenticated
  using (public.is_project_member(project_id));

create policy document_embeddings_select on public.document_embeddings
  for select to authenticated
  using (public.is_project_member(project_id));

-- -----------------------------------------------------------------------------
-- conversations / messages
-- -----------------------------------------------------------------------------
grant select, insert, update on public.conversations to authenticated;
grant select, insert on public.messages to authenticated;

create policy conversations_select on public.conversations
  for select to authenticated
  using (public.is_project_member(project_id));

create policy conversations_insert on public.conversations
  for insert to authenticated
  with check (public.is_project_member(project_id) and user_id = (select auth.uid()));

create policy conversations_update on public.conversations
  for update to authenticated
  using (public.is_project_member(project_id) and user_id = (select auth.uid()))
  with check (public.is_project_member(project_id) and user_id = (select auth.uid()));

create policy messages_select on public.messages
  for select to authenticated
  using (public.is_project_member(project_id));

-- Un usuario solo puede escribir sus propios turnos. Los mensajes del
-- asistente los inserta el backend con service_role.
create policy messages_insert_own on public.messages
  for insert to authenticated
  with check (
    role = 'user'
    and exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and c.user_id = (select auth.uid())
        and public.is_project_member(c.project_id)
    )
  );

-- -----------------------------------------------------------------------------
-- assistant_configs
-- -----------------------------------------------------------------------------
grant select, insert, update on public.assistant_configs to authenticated;

create policy assistant_configs_select on public.assistant_configs
  for select to authenticated
  using (public.is_project_member(project_id));

create policy assistant_configs_write on public.assistant_configs
  for all to authenticated
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

-- -----------------------------------------------------------------------------
-- connector_credentials
-- RLS activo y CERO políticas: inalcanzable para anon y authenticated.
-- Solo el backend, con service_role, puede leerla.
-- -----------------------------------------------------------------------------
revoke all on public.connector_credentials from anon, authenticated;

-- -----------------------------------------------------------------------------
-- audit_events
-- Solo lectura, y solo para administradores de la organización.
-- La escritura es exclusiva del backend.
-- -----------------------------------------------------------------------------
grant select on public.audit_events to authenticated;

create policy audit_events_select on public.audit_events
  for select to authenticated
  using (public.is_org_admin(organization_id));
