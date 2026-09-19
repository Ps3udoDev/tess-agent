-- =============================================================================
-- 0004 · Conversaciones y mensajes
-- =============================================================================

create type public.message_role as enum ('user', 'assistant', 'system', 'tool');

create table public.conversations (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  project_id       uuid not null references public.projects (id) on delete cascade,
  user_id          uuid references auth.users (id) on delete set null,
  title            text,
  locale           text not null default 'es-MX',
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index conversations_project_id_idx on public.conversations (project_id, created_at desc);
create index conversations_user_id_idx on public.conversations (user_id);

create trigger conversations_set_updated_at
  before update on public.conversations
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
create table public.messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  project_id       uuid not null references public.projects (id) on delete cascade,
  role             public.message_role not null,
  content          text not null,
  token_count      integer check (token_count is null or token_count >= 0),
  latency_ms       integer check (latency_ms is null or latency_ms >= 0),
  -- Citas devueltas al usuario: [{ documentId, sectionId, title }]
  sources          jsonb not null default '[]'::jsonb,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);

create index messages_conversation_id_idx on public.messages (conversation_id, created_at);
create index messages_project_id_idx on public.messages (project_id);
