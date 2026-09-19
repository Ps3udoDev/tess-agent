-- =============================================================================
-- 0007 · Recuperación semántica
--
-- `security invoker` es deliberado: la función se ejecuta con los permisos de
-- quien la llama, así que las políticas de 0006_rls.sql siguen aplicando dentro
-- del cuerpo. El filtro por `p_project_id` es una optimización, no la barrera
-- de seguridad.
-- =============================================================================

create or replace function public.match_document_sections(
  query_embedding      extensions.vector(1536),
  p_project_id         uuid,
  match_count          integer default 8,
  similarity_threshold double precision default 0.5
)
returns table (
  section_id  uuid,
  document_id uuid,
  ordinal     integer,
  content     text,
  similarity  double precision,
  metadata    jsonb
)
language sql
stable
security invoker
set search_path = ''
as $fn$
  select
    s.id,
    s.document_id,
    s.ordinal,
    s.content,
    1 - (e.embedding operator(extensions.<=>) query_embedding) as similarity,
    s.metadata
  from public.document_embeddings e
  join public.document_sections s on s.id = e.section_id
  where e.project_id = p_project_id
    and 1 - (e.embedding operator(extensions.<=>) query_embedding) >= similarity_threshold
  order by e.embedding operator(extensions.<=>) query_embedding
  limit least(greatest(match_count, 1), 50);
$fn$;

comment on function public.match_document_sections is
  'Búsqueda por similitud coseno sobre document_embeddings. SECURITY INVOKER: RLS aplica dentro de la función.';

revoke all on function public.match_document_sections(extensions.vector, uuid, integer, double precision)
  from public, anon;
grant execute on function public.match_document_sections(extensions.vector, uuid, integer, double precision)
  to authenticated;
