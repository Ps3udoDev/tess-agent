-- =============================================================================
-- 0013 · La recuperación se autoriza dentro de la función
--
-- 0007 dejó match_document_sections como `security invoker`, apoyándose en las
-- políticas de 0006. Esas políticas exigen is_project_member, así que por el
-- camino del visitante —que es la mayoría del tráfico— la función devolvía
-- cero filas SIEMPRE.
--
-- La salida no es dar `select` sobre document_sections al visitante. El JWT
-- que le damos es un JWT de Supabase y lleva la URL del proyecto en su claim
-- `iss`: con `select` sobre la tabla puede saltarse el API e ir directo a
-- PostgREST a descargarse el corpus entero del cliente. Recuperar por
-- similitud y volcar la documentación serían el mismo permiso.
--
-- La salida es que la función sea la única puerta. SECURITY DEFINER, con la
-- autorización comprobada DENTRO y sobre auth.uid(), que viene firmado y no es
-- un parámetro escrito por el desarrollador —que es contra lo que advierte la
-- cabecera de 0006—. Su superficie es un vector y un tope: como mucho 50
-- secciones por encima de un umbral. No enumera.
-- =============================================================================

-- `create or replace` NO cambia la lista de argumentos: crearía una SOBRECARGA
-- y dejaría viva la versión insegura de 0007, invocable por quien conozca su
-- firma. Se borra primero, a propósito.
drop function if exists public.match_document_sections(
  extensions.vector, uuid, integer, double precision
);

create function public.match_document_sections(
  query_embedding      extensions.vector(1536),
  p_project_id         uuid,
  p_model              text,
  match_count          integer default 8,
  similarity_threshold double precision default 0.5
)
returns table (
  section_id     uuid,
  document_id    uuid,
  document_title text,
  project_id     uuid,
  ordinal        integer,
  content        text,
  similarity     double precision,
  metadata       jsonb
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select
    s.id,
    s.document_id,
    d.title,
    -- Se devuelve para que el API pueda volver a comprobarlo antes de mandar
    -- el texto al modelo. Es redundante con el filtro de abajo, y esa es la
    -- idea: si alguien edita esta función y rompe el filtro, el API lo caza.
    -- Mismo criterio que los triggers de 0010 y 0011, que tampoco sustituyen
    -- a RLS.
    s.project_id,
    s.ordinal,
    s.content,
    1 - (e.embedding operator(extensions.<=>) query_embedding) as similarity,
    s.metadata
  from public.document_embeddings e
  join public.document_sections s on s.id = e.section_id
  join public.documents d on d.id = s.document_id
  where (
      -- LA autorización. Si es falsa, cero filas. Con service_role llamando,
      -- auth.uid() es null y las dos ramas fallan: tampoco por ahí se lee.
      public.is_project_member(p_project_id)
      or public.visitor_belongs_to_project(p_project_id)
    )
    and e.project_id = p_project_id
    -- Sin este filtro, el día que convivan vectores de dos modelos sobre la
    -- misma sección —que es lo que `unique (section_id, model)` siempre
    -- previó— la búsqueda los mezclaría y las distancias dejarían de
    -- significar nada, en silencio.
    and e.model = p_model
    -- Un documento a medio procesar ya tiene secciones escritas. No se cita
    -- hasta estar completo.
    and d.status = 'ready'
    and 1 - (e.embedding operator(extensions.<=>) query_embedding) >= similarity_threshold
  order by e.embedding operator(extensions.<=>) query_embedding
  limit least(greatest(match_count, 1), 50);
$fn$;

comment on function public.match_document_sections is
  'Búsqueda por similitud coseno. SECURITY DEFINER: la autorización se comprueba dentro, sobre auth.uid(). El visitante no tiene select sobre las tablas de documentos.';

revoke all on function public.match_document_sections(
  extensions.vector, uuid, text, integer, double precision
) from public, anon;

grant execute on function public.match_document_sections(
  extensions.vector, uuid, text, integer, double precision
) to authenticated;
