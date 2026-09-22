-- =============================================================================
-- 0012 · La sesión de visitante pertenece a un proyecto
--
-- 0009 dejó que cualquier JWT anónimo valiera en cualquier proyecto con
-- `visitor_access`. La validación de `Origin` y el rate limit guardan el
-- MINTEO, no el uso posterior: con la lista de project_id en la mano, un JWT
-- acuñado desde el widget de un tenant servía para abrir conversaciones y
-- enviar mensajes en el proyecto de otro. Consecuencias: consumo del
-- presupuesto de modelo de la víctima y conversaciones ajenas apareciendo a
-- sus miembros.
--
-- La salida es atar la sesión al proyecto en una tabla que escribe el API al
-- acuñar, y exigirla en las políticas. Mismo patrón que is_org_member y
-- project_accepts_visitors: una función security definer que las políticas
-- llaman.
--
-- Esta migración NO edita 0009. Usa `alter policy`, igual que 0009 no editó
-- las políticas de 0006.
-- =============================================================================

create table public.visitor_sessions (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  project_id       uuid not null references public.projects (id) on delete cascade,
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  created_at       timestamptz not null default now(),
  last_seen_at     timestamptz not null default now()
);

-- `primary key (user_id)` y no una clave compuesta: un usuario anónimo
-- pertenece a un proyecto y solo a uno. El mismo navegador en la landing de
-- otro cliente acuña otra sesión con otro auth.uid(). Esa es la propiedad que
-- queremos, no un efecto secundario.

create index visitor_sessions_project_id_idx on public.visitor_sessions (project_id);

alter table public.visitor_sessions enable row level security;

-- Nadie la lee por PostgREST. La escribe service_role al acuñar y la consultan
-- funciones security definer. Sin grants y sin políticas: RLS activo sin
-- política alguna deniega a todo el mundo, que es exactamente lo que queremos.
revoke all on public.visitor_sessions from anon, authenticated;

-- -----------------------------------------------------------------------------
-- SECURITY DEFINER por la misma necesidad que project_accepts_visitors: si
-- consultara visitor_sessions con los permisos del visitante, RLS filtraría la
-- fila y devolvería siempre falso.
create or replace function public.visitor_belongs_to_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.visitor_sessions s
    where s.user_id = (select auth.uid())
      and s.project_id = p_project_id
  );
$fn$;

comment on function public.visitor_belongs_to_project is
  'Cierto si la sesión que llama fue acuñada para ese proyecto. SECURITY DEFINER: visitor_sessions no es legible por el visitante.';

revoke all on function public.visitor_belongs_to_project(uuid) from public, anon;
grant execute on function public.visitor_belongs_to_project(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Las políticas de 0009 se estrechan. Cada una gana un `and`; ninguna se
-- relaja. El modelo de identidad de tres roles que congela F2 no cambia: lo
-- que deja de ser cierto es que cualquier visitante valga en cualquier
-- proyecto.
-- -----------------------------------------------------------------------------

alter policy projects_select_visitor on public.projects
  using (
    public.project_accepts_visitors(id)
    and public.visitor_belongs_to_project(id)
  );

alter policy conversations_select_visitor on public.conversations
  using (
    public.project_accepts_visitors(project_id)
    and public.visitor_belongs_to_project(project_id)
    and user_id = (select auth.uid())
  );

alter policy conversations_insert_visitor on public.conversations
  with check (
    public.project_accepts_visitors(project_id)
    and public.visitor_belongs_to_project(project_id)
    and user_id = (select auth.uid())
  );

alter policy conversations_update_visitor on public.conversations
  using (
    public.project_accepts_visitors(project_id)
    and public.visitor_belongs_to_project(project_id)
    and user_id = (select auth.uid())
  )
  with check (
    public.project_accepts_visitors(project_id)
    and public.visitor_belongs_to_project(project_id)
    and user_id = (select auth.uid())
  );

alter policy messages_select_visitor on public.messages
  using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and c.user_id = (select auth.uid())
        and public.project_accepts_visitors(c.project_id)
        and public.visitor_belongs_to_project(c.project_id)
    )
  );

alter policy messages_insert_visitor on public.messages
  with check (
    role = 'user'
    and exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and c.user_id = (select auth.uid())
        and public.project_accepts_visitors(c.project_id)
        and public.visitor_belongs_to_project(c.project_id)
    )
  );

alter policy leads_insert_own on public.leads
  with check (
    auth_user_id = (select auth.uid())
    and public.project_accepts_visitors(project_id)
    and public.visitor_belongs_to_project(project_id)
  );

alter policy leads_update_own on public.leads
  using (
    auth_user_id = (select auth.uid())
    and public.project_accepts_visitors(project_id)
    and public.visitor_belongs_to_project(project_id)
  )
  with check (
    auth_user_id = (select auth.uid())
    and public.project_accepts_visitors(project_id)
    and public.visitor_belongs_to_project(project_id)
  );
