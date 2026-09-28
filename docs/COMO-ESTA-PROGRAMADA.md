# Cómo está programada Cecify

Guía para entender el código y seguir programándolo sin romper nada. El **qué hace** la app y las decisiones de producto
están en [`PLAN.md`](../PLAN.md); cómo levantarla, en el [`README.md`](../README.md). Acá está el **cómo**.

---

## 1. La idea en una frase

Una app web (PWA) hecha con **Next.js** donde **toda la lógica de datos vive en funciones SQL de Postgres (Supabase)**.
El servidor de Next solo autentica, valida lo que llega y llama a esas funciones. El navegador nunca habla con la base.

```
Celular (React)  ──fetch + JWT──▶  API routes de Next (app/api)  ──callFn──▶  funciones SQL (Supabase / PGlite)
      ▲                                     │
      └──────── avisos en tiempo real ◀── cecify-socket (Railway, opcional; si no está, polling)
```

## 2. Stack

| Pieza | Qué es | Dónde |
|---|---|---|
| Next.js 16 (App Router) + React 19 | Pantallas y API | `app/` |
| TypeScript + Tailwind 3 | Tipos y estilos | todo |
| Supabase (Postgres) | Base de datos y fotos (storage) | `supabase/migrations/` |
| PGlite | Postgres embebido para desarrollar sin Supabase | `lib/db/local.ts` |
| JWT (`jsonwebtoken`) | Sesiones | `lib/auth.ts`, `lib/api-auth.ts` |
| sharp | Procesa las fotos (achica, gira por EXIF, borra el GPS) | `app/api/profiles/photo` |
| web-push | Notificaciones push | `lib/push*.ts` |
| Vitest | Tests | `tests/` |
| Vercel (región `gru1`, São Paulo) | Hosting | `vercel.json` |

## 3. Carpetas

```
app/
  (app)/            pantallas con sesión: discover, matches (+ chat), photos (muro), stories, profile
  admin/            panel de organizadores (resumen, reportes, invitados, registro, contenido, mi cuenta)
  login/            entrada de invitados (nombre + PIN) y login/admin (organizadores)
  onboarding/       armado del perfil la primera vez
  entrar/           dirección vieja del QR: redirige a /login
  api/              route handlers (una carpeta por endpoint)
components/         piezas de UI por dominio (app, wall, stories, discover, admin, safety, a11y...)
lib/
  db/               acceso a datos: UN archivo por dominio, todos pasan por core.ts
  auth.ts           firmar y verificar el JWT
  api-auth.ts       getAuth / requireRole: el "portero" de cada API route
  admin-api.ts      adminOnly y respuestas comunes del panel
  profile-schema.ts reglas del perfil (compartidas entre navegador y servidor)
  ...               un archivo por tema (push, rate-limit, storage, pin, password, captcha...)
supabase/migrations/  el esquema y TODA la lógica SQL, en orden de fecha
scripts/            tareas de consola (crear organizador, chequear Supabase, importar invitados...)
tests/
  db/               tests contra un Postgres real (PGlite) con todas las migraciones
  unit/             tests de funciones de lib/ y "guardianes" del código
```

## 4. Cómo fluye un pedido (ejemplo: mandar un mensaje)

1. **Navegador**: `authFetch('/api/messages/send', ...)` (`lib/client-auth.ts`) agrega `Authorization: Bearer <token>`.
   Si responde 401, borra la sesión y manda a `/login`.
2. **API route** (`app/api/messages/send/route.ts`):
   - `const auth = await getAuth(req)` → verifica la firma del JWT **y** en la base que el usuario exista y que su
     versión de sesión no haya cambiado (sesiones revocables). Sin esto, `unauthorized()`.
   - `rateLimit(...)` → límite por usuario.
   - Valida el body (tipos, largos, UUIDs con `lib/validators.ts`).
   - Llama a `sendMessage(...)` de `@/lib/db`.
3. **Capa de datos** (`lib/db/chat.ts`) → `callFn('send_message', { p_user, ... })`.
4. **SQL** (`send_message` en una migración) → comprueba que el usuario sea parte de la conversación, inserta y
   devuelve filas.
5. Después de responder, `after(...)` avisa por socket (`lib/realtime.ts`) y por push (`lib/push-server.ts`).
   Si fallan, no rompen nada: el cliente hace polling.

**Regla:** la autorización se chequea **dos veces**, en la route y dentro de la función SQL (que recibe el id del que
pide y decide qué puede ver o cambiar).

## 5. Base de datos

### Todo entra por `callFn`

`lib/db/core.ts` es la **única puerta**:

```ts
callFn<T>('nombre_funcion', { p_arg: valor })  // → T[] (siempre filas)
```

- En producción usa `supabase.rpc` con la *service role* (salta RLS; solo existe en el servidor).
- En desarrollo (`LOCAL_DB=1`) ejecuta la misma función en PGlite.
- Un test (`tests/unit/db-guard.test.ts`) impide que otro archivo hable con Supabase directo y que los módulos de
  `lib/db/` crezcan de más.

### Reglas para escribir funciones SQL

- **Siempre `RETURNS TABLE (...)`**, nunca un valor suelto (`RETURNS BOOLEAN`). `supabase.rpc` devuelve un valor suelto
  distinto que una tabla y `callFn` espera filas. Para un sí/no: `RETURNS TABLE (out_ok BOOLEAN)`.
- Parámetros con prefijo `p_`, columnas de salida con `out_`.
- `SET search_path = public` en todas.
- **Una sola versión por nombre.** Si cambian los parámetros o el resultado: `DROP FUNCTION ...` y `CREATE` de nuevo
  (con dos versiones, PostgREST no sabe cuál llamar).
- **Permisos al final de cada migración**: `REVOKE ALL ... FROM PUBLIC`, y en el bloque `DO $$` el `REVOKE` de `anon,
  authenticated` y el `GRANT EXECUTE ... TO service_role`. Copiá el bloque de cualquier migración existente.
- Tablas nuevas: `ENABLE ROW LEVEL SECURITY` **sin policies** (nadie de afuera lee nada).

### Por qué tanto cuidado con los permisos

La clave pública de Supabase viaja en el navegador. Si una función o tabla quedara permitida para `anon`, cualquiera
podría llamarla por REST salteándose el login. `tests/db/grants.test.ts` emula los permisos por defecto de Supabase y
**falla si algo quedó expuesto**. Si ese test falla, falta un `REVOKE`.

### Migraciones

- Archivo nuevo en `supabase/migrations/` con fecha adelante: `AAAAMMDDHHMMSS_que_hace.sql`.
- **Nunca editar una migración ya aplicada** (en Supabase o en tu `.local-db`): no se vuelve a correr. Se arregla con
  una migración nueva.
- En local, la app aplica las migraciones nuevas sola al primer pedido que toca la base. **Ojo:** si el servidor de
  desarrollo está corriendo mientras escribís una migración, la puede aplicar a medio terminar. Frená `npm run dev`
  mientras la escribís, o no toques `LOCAL_DB=1` hasta terminarla.
- En Supabase: `npx supabase db push` (el proyecto ya está vinculado con `supabase link`).
- **Orden al publicar**: primero `db push`, después el merge a `main`. Las migraciones se escriben para que la versión
  anterior del código siga andando mientras tanto.

## 6. Autenticación

| Quién | Cómo entra | Dónde |
|---|---|---|
| Invitado | Busca su nombre en la lista + PIN de 4 números | `/login` → `api/auth/guest/{search,register,login}` |
| Organizador | Usuario + contraseña (+ captcha) | `/login/admin` → `api/auth/admin-login` |

- **Invitados:** la primera vez (solo con el registro abierto, `registration_open()`) se eligen e inventan el PIN
  (`guest_register`). Después, `guest_pin_for_login` + verificación en el servidor + `guest_pin_attempt` (cuenta los
  fallidos: al quinto traba 15 minutos). El PIN se guarda como hash scrypt (`lib/password.ts`).
- **Organizadores:** cuentas en `admin_accounts`, creadas con `npm run create:admin -- usuario`. La contraseña nunca va
  en un archivo.
- **La sesión** es un JWT (HS256, 12 h) con `userId`, `role`, `v` (versión de sesión) y `sa` (inicio). La app lo
  renueva sola (`/api/auth/refresh`) hasta un tope de 72 h. Subir `users.session_version` invalida todos los tokens de
  esa persona (cerrar sesiones, reiniciar PIN, eliminar).
- **Roles:** `guest`, `admin`, `superadmin` (`lib/roles.ts`). El rol se lee **de la base en cada pedido**, no del
  token. Rutas de admin: `adminOnly(req)`; solo superadmin: `requireRole(req, ['superadmin'])`.
- El token vive en `localStorage` (`lib/client-auth.ts`). Por eso importan los headers de seguridad
  (`next.config.mjs`) y no usar `dangerouslySetInnerHTML` con datos de usuarios.

## 7. Pantallas y estado

- Las pantallas son componentes cliente (`'use client'`) que piden datos con `authFetch`.
- `components/app/MeProvider.tsx`: quién soy, mi perfil y mi rol (lo usan la barra y las pantallas).
- `components/app/RealtimeProvider.tsx`: socket + no leídos; si no hay socket, polling.
- `app/(app)/layout.tsx`: el marco con la barra inferior. Mide el alto visible (`useViewportHeight`) para que el
  teclado del celular no tape el chat.
- Las reglas que usan navegador y servidor van en archivos **sin imports de servidor** (`profile-schema.ts`, `pin.ts`,
  `password-rules.ts`, `bio-picks.ts`, `roles.ts`...): así la validación es la misma en los dos lados, y **la que vale
  es la del servidor**.

## 8. Fotos

1. El editor (`components/photo/PhotoEditor.tsx`) encuadra, gira y achica en el navegador.
2. `POST /api/profiles/photo`: `sharp` decodifica (si no es una imagen real, falla), respeta el EXIF, limita a
   50 MP, achica a 1440×1920 y re-codifica a JPEG (se va el GPS).
3. `lib/storage.ts` la guarda en el bucket público `profile-photos` (o en `public/uploads` en local) con nombre
   aleatorio, en una carpeta por usuario.
4. Cuando otra ruta recibe una URL de foto, `isOwnPhotoUrl` comprueba que sea del storage y de ese usuario.

## 9. Tests

```bash
npm test          # todos
npx vitest run tests/db/pin-login.test.ts   # uno
```

- `tests/db/*`: levantan un Postgres en memoria con **todas** las migraciones (`tests/helpers/db.ts`) y prueban las
  funciones SQL de verdad. Cada archivo tiene su base.
- `tests/unit/*`: funciones de `lib/`, y **guardianes**:
  - `grants.test.ts`: nada expuesto a la clave pública.
  - `db-guard.test.ts`: solo `core.ts` y `storage.ts` hablan con Supabase.
  - `a11y-guard.test.ts`: por ejemplo, prohíbe grises de texto que no llegan al contraste mínimo
    (`text-neutral-300/400`).
- El CI (GitHub Actions, `.github/workflows/ci.yml`) corre lint, tipos, tests y build en cada PR y en `main`.

## 10. Receta: agregar una función nueva

Ejemplo: "que los invitados puedan marcar una foto como favorita".

1. **Migración** `supabase/migrations/<fecha>_favoritos.sql`: tabla (con RLS), funciones SQL
   (`RETURNS TABLE`, `SET search_path`, chequeo de permisos adentro) y el bloque de `REVOKE`/`GRANT`.
2. **Test de base** en `tests/db/favoritos.test.ts`: casos felices y los que tienen que fallar (otro usuario,
   bloqueados, ids inventados). Corré también `grants.test.ts`.
3. **Capa de datos** en `lib/db/<dominio>.ts`: una función que llama a `callFn` y traduce `out_*` a camelCase.
   Exportala desde `lib/db/index.ts` si es un módulo nuevo.
4. **API route** en `app/api/.../route.ts`: `getAuth` → `rateLimit` → validar → llamar → responder. Errores con
   mensajes en castellano para mostrar tal cual.
5. **Pantalla**: `authFetch`, estados de carga y error, y probarla en tamaño celular (375 px).
6. `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build`.
7. Rama nueva → PR → CI en verde → `npx supabase db push` → merge. `npm run check:supabase` para confirmar.

## 11. Desarrollo local

- `.env.local` con `LOCAL_DB=1` → base embebida en `.local-db/` con invitados, fotos e historias de prueba
  (`lib/db/local.ts`). Borrar `.local-db/` = empezar de cero.
- Sin `LOCAL_DB` → usa el Supabase de `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`. **Hoy el de pruebas
  y el de producción es el mismo**: lo que cargues desde tu compu aparece en `cecify.vercel.app`.
- La base local es de **un solo proceso**: para correr un script contra `.local-db` (por ejemplo `create:admin`), frená
  `npm run dev`.
- `npm run check:supabase` revisa un proyecto de Supabase: variables, migraciones, bucket, que la clave pública no lea
  ni llame nada y que haya un organizador. Solo lee.

## 12. Convenciones

- Todo en **castellano rioplatense**: textos de la UI ("tocá", "probá") y comentarios.
- Los comentarios explican el **porqué**, no el qué.
- Nombres de archivos y funciones en inglés (como el resto del ecosistema); textos y comentarios en castellano.
- Emails internos con dominios reservados que nunca reciben correo: `g-<id>@lista.invalid` (se registró sin email),
  `<usuario>@admin.invalid` (organizador).
- Ramas por tema (`login-pin`, `chat-teclado`...), PR y merge a `main`; Vercel publica `main` solo.

## 13. Cosas que ya nos mordieron

- **`String.replace` con `$$`:** en JavaScript, `'$$'` en el texto de reemplazo se convierte en `'$'`. Rompe el SQL
  (`AS $$ ... $$`). Para generar SQL con scripts, usá una función de reemplazo o editá a mano.
- **Una función SQL que devuelve un valor suelto** anda en local y se rompe con `supabase.rpc`. Siempre `TABLE`.
- **La URL de Supabase con `/rest/v1/` al final:** la app ya la limpia (`supabaseUrl()` en `lib/supabase.ts`), pero la
  correcta es `https://<ref>.supabase.co`.
- **En `String.replace` de scripts se pierden las `\`** de los regex si el texto pasa por varias capas de comillas.
  Para regex en archivos generados, `new RegExp('...')` o editar a mano.
- **El teclado del celular:** `100dvh` no se achica con el teclado en Android. Por eso `interactive-widget` en
  `app/layout.tsx` y `useViewportHeight` en el marco.
- **En iPhone la app instalada no comparte la sesión con Safari.** Por eso el login con nombre + PIN funciona en
  cualquier lado.

## 14. Qué falta (ver `PLAN.md`, Fase 3)

- Rate limit compartido (hoy es en memoria por instancia de Vercel).
- Limpiar del storage las fotos borradas y las historias vencidas.
- Monitoreo de errores y copias de seguridad de la base.
- Un Supabase aparte para pruebas.
- Para venderla a otros casamientos: sacar "Lucas & Cecilia" de las pantallas a una configuración (nombres, colores,
  logo) y definir si va a ser una instalación por casamiento o una sola app para muchos.
