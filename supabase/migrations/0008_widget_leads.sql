-- =============================================================================
-- 0008 · Ajustes del widget y captura de leads
--
-- `project_widget_settings` vive aparte de `projects` para poder dar al
-- visitante lectura sobre `projects` (ver 0009) sin exponerle de paso la clave
-- pública ni la allowlist de orígenes.
-- =============================================================================

create table public.project_widget_settings (
  project_id                  uuid primary key references public.projects (id) on delete cascade,
  organization_id             uuid not null references public.organizations (id) on delete cascade,
  public_key                  text not null unique check (public_key ~ '^pk_[a-zA-Z0-9_]{16,}$'),
  allowed_origins             text[] not null default '{}',
  visitor_access              boolean not null default false,
  collect_leads_from_members  boolean not null default false,
  greeting                    text check (greeting is null or length(greeting) <= 500),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

comment on table public.project_widget_settings is
  'Configuración pública del widget. public_key NO es un secreto: identifica el proyecto. Lo que protege el endpoint es la validación de Origin, el rate limit y RLS sobre el JWT.';

create trigger project_widget_settings_set_updated_at
  before update on public.project_widget_settings
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
create table public.leads (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  project_id       uuid not null references public.projects (id) on delete cascade,
  auth_user_id     uuid not null references auth.users (id) on delete cascade,
  email            text check (email is null or email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  full_name        text check (full_name is null or length(full_name) between 1 and 200),
  source           text not null default 'widget',
  -- Valor legal: registra que la persona aceptó ser contactada. Columna propia
  -- y no metadata porque se consulta, se audita y puede haber que borrarla.
  consent_at       timestamptz,
  -- Atribución: landing_url, referrer, utm_source, utm_medium, utm_campaign.
  metadata         jsonb not null default '{}'::jsonb,
  first_seen_at    timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (project_id, auth_user_id),
  constraint leads_needs_contact check (email is not null or full_name is not null)
);

create index leads_project_id_idx on public.leads (project_id, created_at desc);
create index leads_auth_user_id_idx on public.leads (auth_user_id);

create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();

-- `organization_id` no se acepta del cliente: se deriva del proyecto. Un campo
-- de autorización que viene del cliente no es una autorización.
create or replace function public.leads_set_organization()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  select p.organization_id into new.organization_id
  from public.projects p
  where p.id = new.project_id;

  if new.organization_id is null then
    raise exception 'proyecto % inexistente', new.project_id;
  end if;

  return new;
end;
$$;

create trigger leads_set_organization_trigger
  before insert or update of project_id on public.leads
  for each row execute function public.leads_set_organization();
