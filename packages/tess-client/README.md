# @teams4soft/tess-client

Cliente HTTP y SSE del backend de Tess.

## Seguridad de la sesión

La sesión del visitante —incluido su refresh token— se guarda en
`localStorage` bajo `tess:session:<projectId>`. Es lo mismo que hace
`supabase-js` por defecto y permite que alguien que vuelve mañana conserve su
historial, pero **es vulnerable a XSS**. Si integras este paquete:

- No lo cargues en páginas que ejecutan scripts de terceros no confiables.
- Define una Content Security Policy en la landing.
- No guardes ningún otro secreto bajo el prefijo `tess:`.
- Llama a `clearSession()` para cerrar sesión y descartar los tokens.

Si `localStorage` está bloqueado —navegación privada, permisos del navegador—
el cliente sigue funcionando con la sesión en memoria durante la visita.

Para una integración de mayor riesgo, como un panel con datos sensibles, pasa
tu propio `getToken` y gestiona la sesión con cookies seguras del host.
`localStorage` es la elección correcta para una landing pública, no para todo.
