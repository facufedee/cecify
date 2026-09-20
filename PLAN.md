# Cecify — plan de mejoras

Estado: se trabaja en local (sin producción por ahora). Todo lo de abajo se puede probar con `LOCAL_DB=1`.

## Ya hecho

Login por email + código · onboarding · Descubrir (swipe + match) · Matches y chat en tiempo real ·
muro de fotos estilo Instagram (likes, comentarios, perfiles) · historias de 24 h · servidor de sockets con JWT.

## Auditoría (hallazgos)

| # | Sev. | Hallazgo | Evidencia |
|---|------|----------|-----------|
| 1 | Alta | El service worker guarda en caché **toda** respuesta GET, incluidas `/api/*` con datos de cada usuario | `public/sw.js` |
| 2 | Alta | La PWA no se puede instalar: el manifest apunta a 3 iconos y `public/icons/` está vacía; tampoco hay favicon | `public/manifest.json` |
| 3 | Alta | No hay moderación ni administración: `ADMIN_PASSWORD` no se usa y el rol `admin` tampoco. Cualquier foto o comentario inapropiado no se puede sacar | `app/admin` vacío |
| 4 | Alta | No se puede editar el perfil después del onboarding (foto, bio, intereses, contacto, ocultarse) | no existe la pantalla |
| 5 | Alta | Sin bloquear, reportar ni deshacer match (app de citas dentro de una boda) | no existe |
| 6 | Media | Cero tests automáticos y sin CI; las pruebas hechas hasta ahora son scripts descartables | no hay `npm test` |
| 7 | Media | Sin `error.tsx` / `not-found.tsx`: un error muestra la pantalla por defecto de Next | `app/` |
| 8 | Media | `UUID_RE` copiado en 13 archivos; `lib/db.ts` (758 líneas) mezcla dos implementaciones por función | `grep` |
| 9 | Media | `lib/supabase.ts` crea un cliente al importar: el build falla sin variables de entorno (rompe CI) y el cliente de navegador no se usa | `lib/supabase.ts` |
| 10 | Media | El JWT dura 12 h y no hay renovación: la sesión se corta en medio de la fiesta | `lib/auth.ts` |
| 11 | Baja | Endpoints de borrado/lectura sin rate limit (`photos/[id]`, `stories/[id]`, `messages/[id]/read`) | `grep rateLimit` |
| 12 | Baja | 16 `<img>` sin `loading="lazy"`; el feed baja todas las fotos de una | `grep` |
| 13 | Baja | Carpetas vacías sobrantes (`app/matches`, `app/photos`, `app/profile`, `app/admin`, `app/api/admin`) | `find -empty` |
| 14 | Baja | README genérico de Next; la guía inicial quedó desactualizada (Next 14, JWT en localStorage) | `README.md` |

**Resueltos en la Fase 0:** #1, #2, #6, #7, #9, #11, #12, #13, #14. **Parcial:** #8 (`UUID_RE` ya es compartido; el refactor de `lib/db.ts` sigue en 2.5).
**Resueltos en la Fase 1:** #4 (editar perfil), #5 (bloquear/reportar/deshacer match). **Pendientes:** #3 (admin/moderación; los reportes ya se guardan, falta el panel para verlos), #10 (renovar sesión).

## Fases

### Fase 0 — Base sólida (sin decisiones, se hace primero)
- [x] 0.1 Iconos PWA, favicon y logo en el login, a partir de la hoja de logos `CL`
- [x] 0.2 Service worker seguro: nunca cachea `/api`; solo la carcasa estática y una pantalla sin conexión
- [x] 0.3 Tests automáticos (`npm test`): las 5 migraciones con PGlite + validadores + rate limit
- [x] 0.4 Limpieza: `UUID_RE` compartido, `supabase.ts` sin efectos al importar, `error.tsx` / `not-found.tsx`, lazy loading, rate limit faltante, carpetas vacías
- [x] 0.5 CI (GitHub Actions: lint, tipos, tests, build) y README real

### Fase 1 — Lo que falta para los invitados
- [x] 1.1 Editar perfil (foto principal y extra, bio, intereses, contacto, ocultar mi perfil)
- [x] 1.2 Bloquear, reportar y deshacer match
- [x] 1.2b Roles y modos: `guest` / `admin` / `superadmin`; cada invitado elige si quiere conocer gente o solo compartir momentos, qué busca (conocer a alguien / pareja de baile) y de parte de quién viene (Cecilia / Lucas / de los dos)
- [ ] 1.3 Entrar con un enlace/QR (`/login?email=…&code=…`) y tarjetas imprimibles con QR
- [ ] 1.4 Panel de administración `/admin`: lista de invitados (alta, CSV, códigos), moderación (borrar fotos, comentarios e historias), reportes, métricas del evento

### Fase 2 — Pulido
- [ ] 2.1 Chat: cargar mensajes anteriores y "visto"
- [ ] 2.2 Notificaciones push (Web Push) para mensajes y matches
- [ ] 2.3 Renovación de sesión (`/api/auth/refresh`) y cierre de sesión en todos los dispositivos
- [ ] 2.4 Muro: aviso de comentarios, recorte de foto al subir, respuestas a historias
- [ ] 2.5 Refactor de `lib/db.ts` en módulos por dominio y una sola forma de llamar a la base
- [ ] 2.6 Accesibilidad (foco, contraste, `prefers-reduced-motion`) y revisión en varios tamaños de pantalla

### Fase 3 — Cuando se decida ir a producción (hoy en pausa)
- [ ] 3.1 Aplicar migraciones, cargar variables, deploy en Vercel y Railway
- [ ] 3.2 Rate limit compartido (Upstash o tabla) en lugar de memoria por instancia
- [ ] 3.3 Limpieza de archivos huérfanos en el storage (fotos borradas, historias vencidas)
- [ ] 3.4 Monitoreo de errores y copia de seguridad de la base

## Decisiones que voy a tomar por defecto (avisá si preferís otra)
- **Admin:** es un usuario con `role = 'admin'` o `'superadmin'` (no una contraseña compartida). Localmente `dev@` es superadmin y `demo2` admin.
- **Roles:** `guest` (invitado), `admin` (modera, carga invitados, ve reportes) y `superadmin` (lo mismo + nombrar/quitar admins; los novios). Siempre tiene que quedar un superadmin. El rol se lee de la base en cada pedido, no del token.
- **Modo "solo compartir momentos":** el perfil no aparece en Descubrir, no puede dar likes ni recibir matches nuevos y no ve las pestañas Descubrir/Matches (si ya tenía matches, la pestaña Matches se queda). Muro e historias funcionan igual. Se puede cambiar cuando quiera desde Editar perfil.
- **Bloqueo:** bloquear oculta a la persona en Descubrir, el muro y el chat, y deshace el match. Es unilateral y silencioso.
- **Reportes:** los ve el admin en el panel; no se avisa al reportado.
