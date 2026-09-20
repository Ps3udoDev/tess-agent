# Preflight Fase 2

Fecha: 2026-09-19

## Claves de firma JWT

Proyecto hospedado (mpntdrcsdspuyfltvexs): ES256 / P-256, confirmado por JWKS.
La entrada «Legacy HS256» del panel es la clave previamente usada, no la activa.

Supabase local: ES256, mediante `signing_keys_path` en config.toml.
El archivo `supabase/signing_keys.json` está en .gitignore.

Decisión: AUTH_VERIFY = getClaims
Migración necesaria: no

## Variables de entorno

Las seis presentes. SUPABASE_URL apunta al stack local
(http://127.0.0.1:54321), que es lo correcto para desarrollo: las migraciones
de F2 no se aplican al proyecto hospedado hasta el despliegue.

SUPABASE_URL: presente (local)
SUPABASE_ANON_KEY: presente
SUPABASE_SERVICE_ROLE_KEY: presente
MODEL_PROVIDER: presente
MODEL_NAME: presente
AI_GATEWAY_API_KEY: presente
