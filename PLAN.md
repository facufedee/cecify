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

**Resueltos en la Fase 0:** #1, #2, #6, #7, #9, #11, #12, #13, #14. #8 (`UUID_RE` compartido en la Fase 0; `lib/db.ts` partido en módulos y con una sola vía de acceso en 2.5).
**Resueltos en la Fase 1:** #3 (panel de administración y moderación), #4 (editar perfil), #5 (bloquear/reportar/deshacer match). **Resuelto en la Fase 2:** #10 (renovar sesión).

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
- [x] 1.3 Entrar con un enlace/QR (`/login#e=…&c=…`, en el fragmento y no en `?`) y tarjetas de invitación imprimibles con QR (sección Invitaciones del panel)
- [x] 1.4 Panel de administración `/admin`: métricas del evento, reportes (con copia de lo reportado), lista de invitados (alta, CSV, códigos, roles, eliminar), moderación (borrar fotos, comentarios e historias) y registro de acciones

### Fase 2 — Pulido
- [x] 2.1 Chat: cargar mensajes anteriores y "visto"
- [x] 2.2 Notificaciones push (Web Push) para mensajes y matches
- [x] 2.3 Renovación de sesión (`/api/auth/refresh`), cierre de sesión en todos los dispositivos y sesiones revocables por un admin
- [x] 2.4 Muro: aviso de comentarios, editor de foto al subir (encuadre, zoom, giro) y fotos que se ven como vienen, respuestas a historias
- [x] 2.5 Refactor de `lib/db.ts` en módulos por dominio (`lib/db/`) y una sola forma de llamar a la base (funciones SQL vía `callFn`)
- [x] 2.6 Accesibilidad (foco, contraste, `prefers-reduced-motion`) y revisión en varios tamaños de pantalla

### Fase 3 — Cuando se decida ir a producción (hoy en pausa)
- [ ] 3.1 Aplicar migraciones, cargar variables, deploy en Vercel y Railway
- [ ] 3.2 Rate limit compartido (Upstash o tabla) en lugar de memoria por instancia
- [ ] 3.3 Limpieza de archivos huérfanos en el storage (fotos borradas, historias vencidas)
- [ ] 3.4 Monitoreo de errores y copia de seguridad de la base

## Decisiones que voy a tomar por defecto (avisá si preferís otra)
- **Admin:** es un usuario con `role = 'admin'` o `'superadmin'`. Los organizadores entran con **usuario y contraseña** en `/login/admin` (cuentas creadas con `npm run create:admin`; la contraseña se guarda solo como hash scrypt, se cambia desde *Mi cuenta* y cambiarla cierra las otras sesiones; el login pide captcha y admite 5 intentos por usuario cada 15 min). Todos los demás entran como invitados comunes; ninguna cuenta de prueba local tiene rol.
- **Roles:** `guest` (invitado), `admin` (modera, carga invitados, ve reportes) y `superadmin` (lo mismo + nombrar/quitar admins; los novios). Siempre tiene que quedar un superadmin. El rol se lee de la base en cada pedido, no del token.
- **Enlace de invitación:** email y código van en el fragmento (`#`), que el navegador no manda al servidor; así no quedan en logs ni en el "referrer". La pantalla de login lo lee, lo borra de la barra y entra sola; si el código no sirve, muestra el formulario con los datos cargados. Quien tenga el enlace tiene acceso, igual que con el código. El QR se genera en el navegador (nada sale a servicios externos).
- **Panel:** admin y superadmin ven todo lo mismo, salvo dos cosas que son solo del superadmin: cambiar roles y leer la copia de una conversación reportada (es lo más privado que se guarda). Un admin no se puede eliminar como invitado: primero se le quita el rol.
- **Eliminar un invitado** borra su cuenta y todo lo suyo (perfil, fotos, comentarios, historias, matches y chats) y su token deja de servir en todo al instante. Los archivos de las fotos quedan huérfanos en el storage hasta la 3.3.
- **Sesiones:** el token dura 12 h y la app lo renueva sola mientras se usa (cuando faltan menos de 8 h), hasta un tope de 72 h desde que la persona entró de verdad. Lleva una *versión de sesión*: cerrar sesión en todos los dispositivos (o que un admin cierre las de alguien) la sube en la base y todos los tokens anteriores dejan de servir. Cada pedido comprueba en la base que el usuario exista y que la versión coincida (con una caché de 10 s por instancia; al revocar se olvida enseguida en la instancia que atiende el pedido, en otras puede tardar hasta 10 s). Los tokens emitidos antes de este cambio siguen valiendo. **Limitación:** el servidor de sockets solo verifica la firma del token, así que alguien con la sesión revocada puede seguir recibiendo avisos en tiempo real de sus propios chats hasta que el token venza (12 h); no puede leer ni escribir nada por la API.
- **Accesibilidad:** se auditó con axe-core (WCAG 2.2 AA) todas las pantallas, con diálogos abiertos, en 320/375/414/768 px, con texto al 200 % y con el modo oscuro del sistema: hoy dan 0 violaciones. La app es de un solo tema (claro) y lo declara (`color-scheme: light`). Los diálogos comparten `useDialog` (foco, Tab atrapado, Escape solo cierra el de arriba, el foco vuelve a quien lo abrió). Los íconos chicos amplían su área táctil con `.tap` sin mover el diseño. Con "reducir movimiento" se apagan las animaciones (salvo los indicadores de carga). **Límites:** no se probó con un lector de pantalla real (VoiceOver/TalkBack); las historias avanzan solas (se pausan al mantener apretado) y no hay un botón de pausa por teclado; el arrastre de las tarjetas de Descubrir tiene los botones equivalentes (Paso / Me gusta).
- **Notificaciones push:** avisan de mensajes nuevos y matches nuevos (no de me gusta en fotos, para no molestar). Cada dispositivo se suscribe por su cuenta desde Editar perfil o desde el aviso en Matches; el permiso lo da la persona. El aviso muestra el nombre y el comienzo del mensaje (también en la pantalla bloqueada). No se muestra si la app está abierta y a la vista, y una conversación reemplaza su aviso anterior en vez de apilarse. Al cerrar sesión (o en todos los dispositivos) el dispositivo se da de baja, y un dispositivo pasa a ser de la última cuenta que se suscribió. **En iPhone/iPad solo funcionan con la app instalada en la pantalla de inicio (iOS 16.4+).** Las claves `VAPID_*` y `VAPID_SUBJECT` van en las variables de entorno del servidor; sin ellas las notificaciones quedan apagadas y la app sigue igual.
- **Chat:** se abren los últimos 50 mensajes; al subir (o con el botón "Ver mensajes anteriores") se cargan de a 50 sin perder el lugar de lectura. El "Visto" aparece bajo el último mensaje propio que la otra persona leyó, sin hora, y no se puede desactivar. Llega al instante por el socket (evento `messages:read`; **hay que desplegar `cecify-socket` con ese evento en su lista permitida**) y, si el socket no está, por polling.
- **Fotos e historias:** se suben como vienen (formato original), sin recortar ni agrandar: el servidor solo respeta la orientación del EXIF, las achica si pasan de 1440×1920 y quita los metadatos (ubicación incluida); nunca las estira. Antes de subir, un editor deja encuadrar, hacer zoom y girar, y ofrece formatos (original, 9:16 y cuadrada en historias; original, cuadrada y 4:5 en publicaciones; 4:5 en el perfil). Las historias se muestran completas sobre un fondo desenfocado de la misma foto, y las publicaciones sin recorte. Si la foto es chica para el uso, el editor avisa. **Límite:** una foto de baja resolución no se puede mejorar; se ve nítida hasta donde da su tamaño.
- **Avisos del muro:** un comentario nuevo le llega a la persona dueña de la foto (aviso en la app y notificación push; no si se comenta la propia). Se puede **responder a una historia** con un texto de hasta 150 caracteres o una reacción rápida; la respuesta es **privada**: solo la ve quien publicó la historia (en la hoja "Vistas", con la lista de quienes la vieron), y le llega un aviso y una notificación. La historia se pausa mientras se escribe. No se puede responder a la propia historia ni a una vencida, y **con un bloqueo, en cualquier sentido, ya no se puede comentar, dar me gusta ni responder** (antes comentar y dar me gusta no lo comprobaban). Al borrar la historia o la cuenta se borran las respuestas. **Hay que desplegar `cecify-socket` con `photo:commented` y `story:replied` en su lista permitida.**
- **Acceso a datos:** toda la lógica y todas las consultas viven en funciones SQL (`supabase/migrations`) y el servidor solo las llama, siempre por `callFn` (`lib/db/core.ts`): por `supabase.rpc` en producción y por Postgres embebido en local. Ya no hay consultas escritas dos veces (una por entorno). Lo que es solo de desarrollo (invitados demo que dan like o contestan, reiniciar el perfil) está aparte en `lib/db/dev.ts`. `lib/db/` tiene un módulo por dominio (users, profiles, discover, chat, wall, stories, safety, push; el panel en `admin.ts`) y `@/lib/db` sigue exportándolo todo. Un test (`tests/unit/db-guard.test.ts`) impide que otro archivo hable con Supabase o que un módulo crezca sin control. Los valores JSONB se pasan como objetos, no como texto ya serializado (antes reportes y suscripciones push iban como texto: con Supabase se habrían guardado como un string en vez de un objeto). **Sin probar contra Supabase real**, como el resto de la base.
- **Modo "solo compartir momentos":** el perfil no aparece en Descubrir, no puede dar likes ni recibir matches nuevos y no ve las pestañas Descubrir/Matches (si ya tenía matches, la pestaña Matches se queda). Muro e historias funcionan igual. Se puede cambiar cuando quiera desde Editar perfil.
- **Bloqueo:** bloquear oculta a la persona en Descubrir, el muro y el chat, y deshace el match. Es unilateral y silencioso.
- **Reportes:** los ve el admin en el panel; no se avisa al reportado.
- **QR de la fiesta (entrar sin invitación):** además de la invitación personal, hay un QR único para la entrada y las mesas (panel → *QR de la fiesta*). Quien lo escanea pone nombre y WhatsApp y entra; el WhatsApp identifica la cuenta (el mismo número escrito de otra forma da la misma cuenta, y en otro celular la recupera y cierra la sesión del anterior; el nombre no se puede cambiar volviendo a escanear). Queda en la lista de invitados con un email interno `<número>@whatsapp.invalid` (el panel muestra el WhatsApp) y se lo modera como a cualquiera. El QR solo funciona en el horario que elige un admin (máximo una semana) y se puede cambiar si se filtra (los carteles viejos dejan de servir). **Límite:** quien tenga una foto del QR y el WhatsApp de otro invitado puede entrar como esa persona (la otra queda deslogueada y puede avisar); eliminar a alguien no le impide volver a entrar con el QR mientras esté abierto.
- **Captcha y dato de entrada del QR:** la entrada con el QR pide el captcha "no soy un robot" de Cloudflare Turnstile (con las claves `TURNSTILE_*`) y se identifica con WhatsApp **o** Instagram (`<usuario>@instagram.invalid`). **Límite:** el Instagram es público, así que alguien con una foto del QR y el Instagram de otro invitado podría entrar como esa persona (la otra queda deslogueada). El captcha frena robots, no a una persona.
- **Elegirse de la lista (forma principal de entrar):** el organizador carga la lista del casamiento en *Invitados* (alcanza con pegar un nombre por renglón; el email es opcional). El QR de la fiesta abre un buscador: con 2+ letras aparecen los que coinciden (sin acentos ni mayúsculas, hasta 8; nunca la lista entera) y la persona se elige. **Cada nombre se elige una sola vez** (también cuenta como elegido quien entró con su código): si ya entró alguien aparece "Ya entró" y no se puede tomar. Cambio de celular: "código para la app" desde el celular viejo, o un organizador toca *Liberar su nombre* (cierra sus sesiones y la cuenta se conserva). "No estoy en la lista" queda para los casos raros (nombre + WhatsApp o Instagram). **Límite:** quien tenga una foto del QR puede elegir el nombre de alguien que todavía no entró; la persona real lo ve como "Ya entró" y un organizador lo resuelve liberando el nombre (y eliminando al que se lo tomó).
