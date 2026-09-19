-- =============================================================================
-- 0005 · Configuración del asistente, credenciales de conectores y auditoría
-- =============================================================================

create table public.assistant_configs (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  project_id       uuid not null unique references public.projects (id) on delete cascade,
  display_name     text not null default 'Tess',
  locale           text not null default 'es-MX',
  theme            jsonb not null default '{}'::jsonb,
  system_prompt    text,
  model            text,
  temperature      numeric(3, 2) check (temperature is null or temperature between 0 and 2),
  -- Allowlist de herramientas. Vacío = el agente no puede invocar nada.
  enabled_tools    text[] not null default '{}',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create trigger assistant_configs_set_updated_at
  before update on public.assistant_configs
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
create type public.connector_status as enum ('active', 'paused', 'error', 'revoked');

create table public.connector_credentials (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations (id) on delete cascade,
  project_id           uuid not null references public.projects (id) on delete cascade,
  provider             text not null,
  external_account_id  text,
  -- Cifrado en la aplicación con CONNECTOR_ENCRYPTION_KEY antes de insertar.
  -- La base nunca ve el secreto en claro y ninguna política RLS expone esta tabla.
  encrypted_payload    bytea not null,
  nonce                bytea not null,
  status               public.connector_status not null default 'active',
  last_synced_at       timestamptz,
  last_error           text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (project_id, provider, external_account_id)
);

comment on table public.connector_credentials is
  'Solo accesible con service_role desde el backend. Ver 0006_rls.sql: no tiene políticas de lectura.';

create trigger connector_credentials_set_updated_at
  before update on public.connector_credentials
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
create table public.audit_events (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  project_id       uuid references public.projects (id) on delete set null,
  actor_id         uuid references auth.users (id) on delete set null,
  action           text not null,
  resource_type    text,
  resource_id      text,
  ip               inet,
  user_agent       text,
  -- IDs y códigos, nunca el texto de la conversación ni contenido documental.
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);

create index audit_events_organization_id_idx on public.audit_events (organization_id, created_at desc);
create index audit_events_project_id_idx on public.audit_events (project_id, created_at desc);
