-- =============================================================================
-- 0015 · Insercion de documentos por miembros
--
-- 0006 dejo `documents` solo con `grant select`: la subida (Tarea 22) inserta
-- la fila con el JWT del miembro, y sin este grant y esta politica ese insert
-- fallaba siempre con RLS, asi que la ruta respondia 404 en todos los casos.
--
-- El `with check` no se limita a "es miembro del proyecto": un miembro que
-- insertara directamente por PostgREST (sin pasar por el API) podria escribir
-- cualquier `storage_path`, incluido el de OTRO tenant. El worker descarga ese
-- objeto con service_role, que bypasea RLS de Storage, asi que el filtro tiene
-- que estar aqui, en el insert, y no solo en la politica de `storage.objects`
-- de 0014. Por eso el check exige TODO lo siguiente a la vez:
--   - ser miembro del proyecto (is_project_member),
--   - que organization_id sea el que de verdad tiene ese proyecto (no el que
--     mande el cliente),
--   - que la fila nazca en el estado que le corresponde a una subida nueva
--     (status = 'pending', source = 'upload'),
--   - que created_by sea quien esta autenticado (no se puede insertar a
--     nombre de otro),
--   - que el bucket sea el unico que existe,
--   - que storage_path empiece por su propio prefijo
--     {organization_id}/{project_id}/{id}/, que es el mismo esquema de rutas
--     que ya usa la politica de storage.objects de 0014.
--
-- NO se concede `update` a `authenticated`: un miembro podria marcar su propio
-- documento como 'ready' sin que el worker lo hubiera procesado. El unico
-- update legitimo desde el API -marcar 'failed' cuando la subida a Storage
-- falla- pasa a un helper con service_role (ver marcarDocumentoFallido en
-- plugins/supabase.ts). El resto de transiciones de estado las hace el
-- ingest-worker, tambien con service_role.
-- =============================================================================

grant insert on public.documents to authenticated;

create policy documents_insert on public.documents
  for insert to authenticated
  with check (
    public.is_project_member(documents.project_id)
    and documents.organization_id = (
      select p.organization_id
      from public.projects p
      where p.id = documents.project_id
    )
    and documents.status = 'pending'
    and documents.source = 'upload'
    and documents.created_by = (select auth.uid())
    and documents.storage_bucket = 'tess-documents'
    and documents.storage_path is not null
    and starts_with(
      documents.storage_path,
      documents.organization_id || '/' || documents.project_id || '/' || documents.id || '/'
    )
  );
