-- =============================================================================
-- 0009 · RLS para visitantes anónimos
--
-- Políticas NUEVAS y paralelas a las de 0006. No se edita ninguna existente:
-- las políticas se combinan con OR, así que añadir nunca quita permisos a un
-- miembro.
--
-- Ninguna política comprueba `is_anonymous`, a propósito: un usuario ya
-- registrado que pregunta en la landing sin ser miembro del proyecto es el
-- mismo caso de uso.
-- =============================================================================

-- SECURITY DEFINER por necesidad: si consultara project_widget_settings con
-- los permisos del visitante, RLS filtraría la fila y devolvería siempre falso.
-- Mismo bucle que 0006 resuelve con is_org_member.
create or replace function public.project_accepts_visitors(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.project_widget_settings w
    where w.project_id = p_project_id
      and w.visitor_access
  );
$fn$;

revoke all on function public.project_accepts_visitors(uuid) from public, anon;
grant execute on function public.project_accepts_visitors(uuid) to authenticated;

-- -----------------------------------------------------------------------------
alter table public.project_widget_settings enable row level security;
alter table public.leads                   enable row level security;

revoke all on public.project_widget_settings from anon;
revoke all on public.leads from anon;

-- project_widget_settings: solo administradores de la organización. El API la
-- lee con service_role al acuñar, que es antes de que exista un JWT.
grant select, insert, update, delete on public.project_widget_settings to authenticated;

-- Autoriza contra la organización REAL del proyecto, no contra la columna que
-- manda el cliente. Un campo de autorización que viene del cliente no es una
-- autorización: es la misma regla que 0008 aplica a leads.
create policy project_widget_settings_admin on public.project_widget_settings
  for all to authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_widget_settings.project_id
        and public.is_org_admin(p.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.projects p
      where p.id = project_widget_settings.project_id
        and public.is_org_admin(p.organization_id)
    )
  );

-- -----------------------------------------------------------------------------
-- projects: el visitante necesita leer su fila para resolver organization_id.
-- No hay secretos en projects: la clave y la allowlist viven en 0008.
create policy projects_select_visitor on public.projects
  for select to authenticated
  using (public.project_accepts_visitors(id));

-- -----------------------------------------------------------------------------
-- conversations: el visitante ve SOLO la suya, nunca las del proyecto.
create policy conversations_select_visitor on public.conversations
  for select to authenticated
  using (
    public.project_accepts_visitors(project_id)
    and user_id = (select auth.uid())
  );

create policy conversations_insert_visitor on public.conversations
  for insert to authenticated
  with check (
    public.project_accepts_visitors(project_id)
    and user_id = (select auth.uid())
  );

-- Necesaria para rellenar `title` con el primer mensaje: conversations_update
-- de 0006 exige is_project_member, que para un visitante es falso.
create policy conversations_update_visitor on public.conversations
  for update to authenticated
  using (
    public.project_accepts_visitors(project_id)
    and user_id = (select auth.uid())
  )
  with check (
    public.project_accepts_visitors(project_id)
    and user_id = (select auth.uid())
  );

-- -----------------------------------------------------------------------------
-- messages: solo los de su propia conversación.
create policy messages_select_visitor on public.messages
  for select to authenticated
  using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and c.user_id = (select auth.uid())
        and public.project_accepts_visitors(c.project_id)
    )
  );

create policy messages_insert_visitor on public.messages
  for insert to authenticated
  with check (
    role = 'user'
    and exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and c.user_id = (select auth.uid())
        and public.project_accepts_visitors(c.project_id)
    )
  );

-- -----------------------------------------------------------------------------
-- leads: se insertan con el JWT del propio visitante. El with check ya impide
-- crear el lead de otro, así que no hay razón para bypasear RLS.
grant select, insert, update on public.leads to authenticated;

create policy leads_insert_own on public.leads
  for insert to authenticated
  with check (
    auth_user_id = (select auth.uid())
    and public.project_accepts_visitors(project_id)
  );

create policy leads_update_own on public.leads
  for update to authenticated
  using (
    auth_user_id = (select auth.uid())
    and public.project_accepts_visitors(project_id)
  )
  with check (
    auth_user_id = (select auth.uid())
    and public.project_accepts_visitors(project_id)
  );

-- Permite al widget saber, al recargar, que esta persona ya dejó sus datos.
create policy leads_select_own on public.leads
  for select to authenticated
  using (auth_user_id = (select auth.uid()));

create policy leads_select_member on public.leads
  for select to authenticated
  using (public.is_project_member(project_id));
