-- =============================================================================
-- 0014 · Almacenamiento de documentos y reclamo de trabajo
--
-- Tres piezas que son la misma frontera: dónde vive el archivo, quién puede
-- verlo, y quién puede reclamar su procesamiento.
-- =============================================================================

-- Bucket PRIVADO. El visitante nunca necesita el archivo original: recibe
-- secciones por match_document_sections y una cita con título y documentId,
-- no una URL firmada.
insert into storage.buckets (id, name, public, file_size_limit)
values ('tess-documents', 'tess-documents', false, 26214400)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Políticas sobre storage.objects.
--
-- La ruta es {organization_id}/{project_id}/{document_id}/{nombre-seguro}.
-- La organización va primera para que la política se resuelva por prefijo con
-- una sola comparación. `storage.foldername(name)` devuelve el array de
-- segmentos: [1] es la organización, [2] el proyecto.
--
-- Solo miembros del proyecto. El visitante NO recibe ninguna política, así que
-- para él la tabla no existe. El worker lee y escribe con service_role, que
-- bypasea RLS y por tanto no necesita política.
-- -----------------------------------------------------------------------------
create policy documents_objects_select_member on storage.objects
  for select to authenticated
  using (
    bucket_id = 'tess-documents'
    and public.is_project_member(((storage.foldername(name))[2])::uuid)
  );

-- -----------------------------------------------------------------------------
-- Reclamo de trabajo.
--
-- `for update skip locked` es lo que permite levantar N instancias del worker
-- en Cloud Run sin coordinarlas: dos nunca reclaman el mismo documento y
-- ninguna espera a la otra. No se expresa por PostgREST, así que es un RPC.
--
-- El índice documents_status_idx de 0003 es parcial `where status <> 'ready'`:
-- esta consulta es exactamente para la que se creó.
-- -----------------------------------------------------------------------------
create or replace function public.claim_next_document()
returns public.documents
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  doc public.documents;
begin
  update public.documents
     set status = 'processing', updated_at = now()
   where id = (
     select d.id
       from public.documents d
      where d.status = 'pending'
      order by d.created_at
        for update skip locked
      limit 1
   )
  returning * into doc;

  return doc;
end;
$fn$;

comment on function public.claim_next_document is
  'Reclama atómicamente el documento pendiente más antiguo. Solo service_role.';

-- Quién puede reclamar trabajo es una decisión, así que la revocación es
-- explícita. service_role bypasea estos grants por diseño.
revoke all on function public.claim_next_document() from public, anon, authenticated;
