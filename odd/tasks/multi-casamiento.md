# Multi-casamiento

## Objetivo
Lovify deja de ser la app de un solo casamiento: cada pareja crea "Su casamiento", carga los
nombres de los dos, sube su lista de invitados y comparte un código. Los invitados entran con
ese código, se buscan en la lista y se registran con su PIN. Los dueños del casamiento pueden
"Blanquear contraseña" (reiniciar el PIN) de cualquier invitado.

## Problema
El esquema es de un solo casamiento: no existe una entidad casamiento, la configuración vive en
la fila única `event_access`, los nombres "Lucas & Cecilia" están fijos en el código y las
unicidades (`users.email`, `guests.email`, `guests.access_code`) son globales.

## Decisiones
- Cada usuario pertenece a exactamente un casamiento (`users.wedding_id`). Fotos, historias,
  chats, matches, bloqueos y reportes quedan aislados transitivamente por el casamiento de sus
  usuarios: los listados filtran por el casamiento de quien consulta y las acciones entre dos
  personas exigen que compartan casamiento.
- `guests.wedding_id`; unicidades pasan a `(wedding_id, email)` / `(wedding_id, access_code)`.
- Tabla `weddings`: `code` (6 caracteres sin ambiguos, único), `partner_a`, `partner_b`
  (mapean a los lados `bride`/`groom` existentes), ventana de registro (`opens_at`, `closes_at`),
  que reemplaza a `event_access`.
- Los datos actuales se migran a un casamiento "Cecilia & Lucas" con código generado.
- Dueños: quien crea el casamiento recibe una cuenta usuario+contraseña (flujo admin existente)
  con rol `superadmin` de ese casamiento. Los roles existentes quedan acotados a su casamiento.
- El JWT no cambia: el casamiento se deriva del usuario en la base.
- Storage no cambia: las rutas ya son por `userId`, único global.
- "Blanquear contraseña" reutiliza `admin_release_guest` (ya existe como "Reiniciar su PIN").

## Fuera de alcance
- Un mismo usuario en varios casamientos.
- Operador de plataforma que vea todos los casamientos.
- Cambios en `cecify-socket` (repo aparte). Seguimiento: el relay `typing` no valida que
  `toUserId` comparta conversación; con varios casamientos conviene validarlo allá.

## Tareas
- [x] T0 Renombrar la app a Lovify con slogan — inline — commit `2884842`
- [x] T1 SQL: tabla `weddings`, `wedding_id` en users/guests, backfill, unicidades por
      casamiento, ventana de registro por casamiento, `create_wedding` — delegada (writer).
      Compatible hacia atrás: sin código usa el único casamiento existente.
      Checks: tests/db 217/217, npm test 348/348, tsc ok.
      Revisión: riesgo medio, aprobada y confirmada (lineage review-5d421a15900c814d).
- [x] T2 SQL: acotar al casamiento todas las funciones de listado/búsqueda/admin y validar
      mismo casamiento en acciones entre usuarios; tests de aislamiento — delegada (writer).
      40 funciones redefinidas, helper `same_wedding`. RED 17/17 → GREEN.
      Checks: tests/db 234/234, npm test 365/365, tsc ok.
- [ ] T3 API: entrada de invitados con código (buscar/registrar/login), crear casamiento,
      datos del casamiento actual, ajustes de nombres/código para dueños — delegada (writer)
- [ ] T4 UI: paso de código en /login, link `/c/[code]`, página "Crear tu casamiento",
      panel de casamiento (nombres, código, QR), etiqueta "Blanquear contraseña", nombres
      dinámicos en vez de "Lucas & Cecilia" — delegada (writer)
- [ ] T5 Docs (README, docs/COMO-ESTA-PROGRAMADA.md) y seed local — inline

Rutas: T1–T4 tocan 2+ archivos no triviales cada una → writer delegado.

## Criterios de aceptación
- Un invitado del casamiento A nunca ve perfiles, fotos, historias ni invitados de B.
- Una persona de A no puede likear, comentar, swipear ni escribirle a alguien de B.
- La lista de invitados y el blanqueo de PIN del admin solo afectan a su casamiento.
- Los datos existentes quedan en el casamiento migrado y siguen funcionando.
- Una pareja puede crear su casamiento sin consola y recibir su código.

## Checks
`npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build`.

## Entrega
Forecast: más de 2000 líneas (supera ~400). Estrategia: ask-on-risk → cadena `stacked-to-main` (elegida por el usuario).
Un PR por tarea; cada uno se apoya en el anterior.

## Progreso
- T0 hecho.
- T1 hecho. Pendiente para T3: llamadas con código en lib/db/guest-login.ts, scripts/check-supabase.mjs
  (event_access ya no existe), código QR muerto en app/api/admin/event/route.ts.
  Pendiente para T2: get_user_context une por email sin wedding, set_user_role sin acotar,
  admin_stats y admin_recent_actions sin acotar. (resuelto en T2)
- T2 hecho. Pendiente para T3: pasar `p_viewer` a getAuthor (lib/db/profiles.ts:93) y
  getProfileOwner (:102); la fuga principal es app/api/photos/route.ts:28 (autor por query).
