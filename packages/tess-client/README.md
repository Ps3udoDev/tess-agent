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

## Refresco y continuidad de la identidad

Cuando al `accessToken` le quedan menos de 60 segundos, el cliente lo renueva
contra `POST /v1/visitor-sessions/refresh` antes de la petición. Un 401
inesperado se reintenta **una vez** tras refrescar.

Solo si el refresh token ya no vale se acuña una sesión nueva, y eso cambia el
`auth.uid()`: el visitante pierde su historial y su lead. Por eso reacuñar es
el último recurso y no el comportamiento normal al expirar.

El id de la conversación lo persiste el web component aparte, bajo
`tess:conversation:<projectId>`, que es lo que hace que recargar la página
recupere el hilo.

Para una integración de mayor riesgo, como un panel con datos sensibles, pasa
tu propio `getToken` y gestiona la sesión con cookies seguras del host.
`localStorage` es la elección correcta para una landing pública, no para todo.
