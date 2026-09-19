-- =============================================================================
-- 0001 · Extensiones
--
-- Se instalan en el esquema `extensions` (convención de Supabase) en lugar de
-- `public`, para que el linter no marque objetos de extensión como tablas de
-- aplicación. Toda referencia posterior va cualificada: `extensions.vector`.
-- =============================================================================

create schema if not exists extensions;

-- digest(), hmac() y encrypt/decrypt para las credenciales de conectores.
-- Nota: gen_random_uuid() NO viene de aquí. Desde PostgreSQL 13 vive en
-- pg_catalog, por eso en el resto de migraciones se usa sin cualificar.
create extension if not exists pgcrypto with schema extensions;

-- pgvector: almacenamiento y búsqueda de embeddings.
create extension if not exists vector with schema extensions;
