-- =============================================================================
-- 0002 · Multi-tenancy
--
-- `organizations.id` es el `tenant_id` del documento de arquitectura. Todas las
-- tablas de datos lo denormalizan para que RLS pueda filtrar sin joins.
-- =============================================================================

-- Marca de tiempo automática, reutilizada por el resto de migraciones.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'),
  name        text not null check (length(name) between 1 and 200),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.organizations is 'Tenant raíz. organizations.id es el tenant_id del sistema.';

create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
create type public.member_role as enum ('owner', 'admin', 'member', 'viewer');

create table public.organization_members (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  role             public.member_role not null default 'member',
  created_at       timestamptz not null default now(),
  unique (organization_id, user_id)
);

comment on table public.organization_members is
  'No aparece en el modelo mínimo del plan, pero RLS sobre organizations necesita una tabla de pertenencia para resolver quién ve qué.';

create index organization_members_user_id_idx on public.organization_members (user_id);

-- -----------------------------------------------------------------------------
create table public.projects (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  slug             text not null check (slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'),
  name             text not null check (length(name) between 1 and 200),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, slug)
);

create index projects_organization_id_idx on public.projects (organization_id);

create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
create table public.project_members (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        public.member_role not null default 'member',
  created_at  timestamptz not null default now(),
  unique (project_id, user_id)
);

create index project_members_user_id_idx on public.project_members (user_id);
