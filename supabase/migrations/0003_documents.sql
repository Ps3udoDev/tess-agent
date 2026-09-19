-- =============================================================================
-- 0003 · Documentos, secciones y embeddings
--
-- Dimensión del vector: 1536 (text-embedding-3-small). Debe coincidir con
-- EMBEDDING_DIMENSIONS en .env. Cambiarla exige recrear la columna y el índice,
-- así que conviene fijarla antes de la primera ingestión real.
-- =============================================================================

create type public.document_status as enum ('pending', 'processing', 'ready', 'failed');

create table public.documents (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  project_id       uuid not null references public.projects (id) on delete cascade,
  title            text not null check (length(title) between 1 and 500),
  source           text not null default 'upload',
  storage_bucket   text,
  storage_path     text,
  mime_type        text,
  byte_size        bigint check (byte_size is null or byte_size >= 0),
  checksum         text,
  status           public.document_status not null default 'pending',
  failure_reason   text,
  metadata         jsonb not null default '{}'::jsonb,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (project_id, storage_bucket, storage_path)
);

create index documents_project_id_idx on public.documents (project_id);
create index documents_organization_id_idx on public.documents (organization_id);
create index documents_status_idx on public.documents (status) where status <> 'ready';

create trigger documents_set_updated_at
  before update on public.documents
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
create table public.document_sections (
  id               uuid primary key default gen_random_uuid(),
  document_id      uuid not null references public.documents (id) on delete cascade,
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  project_id       uuid not null references public.projects (id) on delete cascade,
  ordinal          integer not null check (ordinal >= 0),
  content          text not null,
  token_count      integer check (token_count is null or token_count >= 0),
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  unique (document_id, ordinal)
);

create index document_sections_project_id_idx on public.document_sections (project_id);
create index document_sections_document_id_idx on public.document_sections (document_id);

-- -----------------------------------------------------------------------------
create table public.document_embeddings (
  id               uuid primary key default gen_random_uuid(),
  section_id       uuid not null references public.document_sections (id) on delete cascade,
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  project_id       uuid not null references public.projects (id) on delete cascade,
  embedding        extensions.vector(1536) not null,
  model            text not null,
  created_at       timestamptz not null default now(),
  unique (section_id, model)
);

create index document_embeddings_project_id_idx on public.document_embeddings (project_id);

-- HNSW con distancia coseno. Límite de pgvector para hnsw: 2000 dimensiones.
-- `m` y `ef_construction` son los valores por defecto; ajustar con datos reales.
create index document_embeddings_embedding_idx
  on public.document_embeddings
  using hnsw (embedding extensions.vector_cosine_ops)
  with (m = 16, ef_construction = 64);
