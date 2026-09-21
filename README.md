# Cecify

App web (PWA) para la boda de Lucas y Cecilia: los invitados entran con un código, arman su perfil,
se conocen con un swipe estilo cita, chatean cuando hay match y comparten fotos e historias.

**Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Tailwind 3 · Supabase (Postgres) ·
Socket.io (repo aparte: `../cecify-socket`) · Vitest.

## Empezar (modo local, sin Supabase)

```bash
npm install
npm run dev          # http://localhost:3000
```

Con `LOCAL_DB=1` en `.env.local` la app usa un Postgres embebido (PGlite) que aplica las mismas
migraciones de `supabase/migrations/` y guarda los datos en `.local-db/` (se puede borrar para empezar de cero).

Cuentas de prueba (se crean solas):

| Email | Código | Notas |
|-------|--------|-------|
| `dev@cecify.local` | `DEV1-2345` | tu cuenta de prueba |
| `demo1@demo.cecify.local` … `demo6@…` | `DEMO0001` … `DEMO0006` | Lucía, Mateo, Camila, Joaquín, Valentina, Tomás |

`dev@` es superadmin, Mateo (`demo2`) es admin y Valentina (`demo5`) solo usa el muro (no aparece en Descubrir), para ver
cada caso. El panel de administración está en <http://localhost:3000/admin> (también hay un botón en tu perfil).

En desarrollo los invitados demo con número impar que participan del match (Lucía y Camila) te dan like de vuelta, así se
ve la pantalla de match, y todos responden solos a los mensajes. Hay fotos e historias de ejemplo.

Para tiempo real (mensajes al instante, "escribiendo…", avisos) hay que levantar también el servidor de sockets:

```bash
cd ../cecify-socket && npm run dev     # puerto 3001
```

Sin él todo funciona igual, con actualización por polling (unos segundos de demora).

## Scripts

| Comando | Qué hace |
|---------|----------|
| `npm run dev` | servidor de desarrollo |
| `npm run build` / `npm start` | build y servidor de producción |
| `npm run lint` | ESLint |
| `npx tsc --noEmit` | chequeo de tipos |
| `npm test` | tests (migraciones con PGlite, validadores, utilidades) |
| `npm run import:guests -- invitados.csv` | carga la lista de invitados en Supabase y genera los códigos (columnas: `name,email[,code][,side]`; `side` = novia / novio / ambos) |
| `npm run set:role -- email guest\|admin\|superadmin` | cambia el rol de alguien en Supabase (para nombrar al primer superadmin) |
| `node scripts/generate-icons.mjs` | regenera los iconos de la PWA a partir de la hoja de logos |

## Variables de entorno

Ver `.env.example`. Las importantes:

| Variable | Para qué |
|----------|----------|
| `LOCAL_DB=1` | usa la base local en vez de Supabase (solo desarrollo; se ignora en producción) |
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase (solo servidor) |
| `JWT_SECRET` | firma de sesiones; **tiene que ser el mismo** en la app y en `cecify-socket` |
| `NEXT_PUBLIC_SOCKET_URL` | URL del servidor de sockets |
| `SOCKET_SECRET` | clave compartida app ↔ servidor de sockets (también en `cecify-socket`) |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | notificaciones push (`npx web-push generate-vapid-keys`; el subject es un `mailto:` o `https://` real). Sin ellas quedan apagadas |

## Cómo está armado

```
app/
  (app)/          pantallas con sesión: discover, matches (+chat), photos (muro), stories, profile
  api/            API routes (auth, profiles, swipes, matches, messages, photos, stories)
  login, onboarding
components/       wall/ (muro), stories/, discover/, onboarding/, app/ (navegación, tiempo real)
lib/              db/ (acceso a datos por dominio: users, profiles, discover, chat, wall, stories, safety, push, admin; core.ts es la única puerta; local.ts es la base local), auth, rate-limit, storage, realtime
supabase/migrations/   el esquema y la lógica en SQL (fuente de verdad)
tests/            tests de base de datos (PGlite) y unitarios
scripts/          importar invitados, generar iconos
```

Decisiones de diseño que conviene conocer:

- **Todo el acceso a datos pasa por el servidor** con la service role. Las tablas tienen RLS activado *sin policies*: la clave
  pública de Supabase no puede leer ni escribir nada.
- **La lógica sensible vive en funciones SQL** (`record_swipe`, `send_message`, `toggle_photo_like`, …): atómicas, probadas con
  PGlite y con el acceso público revocado. Un test falla si alguien agrega una función sin ese `REVOKE`.
- **Roles y modos:** el *rol* (`guest`, `admin`, `superadmin`) da permisos y se lee de la base en cada pedido
  (`requireRole` en `lib/api-auth.ts`), no del token. El *modo* lo elige cada invitado: quien elige solo muro e historias
  (`wants_match = false`) queda fuera de Descubrir y de los matches; lo aplica SQL (`discover_profiles`, `record_swipe`), no
  solo la pantalla. Solo un superadmin cambia roles (`set_user_role`) y siempre queda al menos uno.
- **Notificaciones push:** `lib/push.ts` (lógica, con dependencias inyectadas y probada) y `lib/push-server.ts` (web-push + base).
  El service worker (`public/sw.js`) muestra el aviso salvo que la app esté a la vista y solo abre rutas internas. En desarrollo se
  registra únicamente si activás las notificaciones (y no cachea nada en localhost).
- **Chat:** se paginan los mensajes hacia atrás (`?before=`) y el "Visto" sale de `chat_read_state` (hasta cuándo leyó la otra
  persona lo que enviaste). Avisa en vivo con el evento `messages:read`, que tiene que estar en la lista permitida de `cecify-socket`.
- **Sesiones revocables:** el JWT lleva una versión de sesión (`users.session_version`) y `getAuth` la compara con la base en
  cada pedido (caché de 10 s). Se renueva solo con `/api/auth/refresh` y se cierra en todos los dispositivos con
  `/api/auth/logout-all` o desde el panel. Toda ruta nueva tiene que usar `await getAuth(req)`.
- **Invitaciones:** cada invitado puede entrar con un enlace o un QR (`/login#e=email&c=codigo`). El panel imprime las
  tarjetas (8 por hoja A4, con el QR) desde *Invitaciones*, y en *Invitados* se copia el enlace o se abre un correo listo
  para enviar. Antes de imprimir hay que poner en esa pantalla la dirección **pública** de la app.
- **Panel de administración** (`/admin`): Resumen, Reportes, Invitados, Invitaciones y Contenido. Las rutas `/api/admin/*` empiezan con
  `adminOnly` (`lib/admin-api.ts`) y cada función SQL `admin_*` vuelve a comprobar el rol, así que un token viejo o una ruta
  olvidada no alcanzan. Lo que hace cada administrador queda en `admin_actions`.
- **Los contactos solo se revelan tras un match** y nunca salen de la API de Descubrir.
- **Tiempo real:** los mensajes se guardan por la API; el servidor de sockets solo entrega avisos y verifica el JWT. Si está
  caído, la app sigue funcionando por polling.
- **Las fotos se reprocesan en el servidor** (se elimina el EXIF/GPS) y una URL de foto solo se acepta si la subió el propio usuario.

## Accesibilidad

`tests/unit/a11y-guard.test.ts` protege lo básico (contraste de la paleta calculado, diálogos con `useDialog`, zoom no bloqueado,
foco visible, movimiento reducido). Para una auditoría completa en el navegador: `npm i --no-save axe-core`, copiar
`node_modules/axe-core/axe.min.js` a `public/` **temporalmente**, cargarlo en la página y ejecutar `axe.run(document)` en cada
pantalla (también con un diálogo abierto y con la letra al 200 %). No lo dejes en `public/`.

## Migraciones

Están en `supabase/migrations/` y se aplican en orden. En local se aplican solas. Con Supabase: `npx supabase db push`
(necesita conexión al puerto 5432; en redes que lo bloquean se pueden pegar en el SQL Editor, en orden).

## Plan

Ver [`PLAN.md`](PLAN.md): auditoría, fases y lo que sigue.
