-- Varios casamientos (Lovify deja de ser la app de un solo casamiento).
--
-- Cada casamiento tiene los nombres de los dos (partner_a = lado 'bride', partner_b = lado 'groom'), un codigo de 6
-- caracteres que comparte con sus invitados y su propio horario de registro (antes, la fila unica event_access).
-- Cada usuario e invitado pertenece a exactamente un casamiento (wedding_id). Los emails y los codigos de invitado
-- pasan a ser unicos dentro de cada casamiento: la misma persona puede estar invitada a dos casamientos.
--
-- Los datos que ya existian pasan a un casamiento "Cecilia & Lucas" con un codigo generado.
-- Los usuarios de las cuentas de organizador (admin_accounts.username) siguen siendo unicos en toda la app:
-- los dueños entran con usuario y contraseña sin poner el codigo del casamiento.
--
-- Esta migracion solo arma la base y los caminos de entrada (alta de casamiento, login de invitados, lista del
-- panel). El aislamiento de Descubrir, chat, muro, historias y moderacion entre casamientos llega en la siguiente.
--
-- Se borran el QR con clave y la entrada por WhatsApp/Instagram (event_join, event_search_guests,
-- event_claim_guest, event_access_problem) y la tabla event_access: la app ya no los usaba y no sabrian a que
-- casamiento entrar.

-- ---- Casamientos ----

CREATE TABLE weddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_a TEXT NOT NULL CHECK (length(BTRIM(partner_a)) BETWEEN 1 AND 60),
  partner_b TEXT NOT NULL CHECK (length(BTRIM(partner_b)) BETWEEN 1 AND 60),
  -- Sin 0/O, 1/I/L: se dicta y se copia sin confundirse
  code TEXT UNIQUE NOT NULL CHECK (code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$'),
  -- Registro de gente nueva (NULL = todavia no se abrio). Misma semantica que tenia event_access.
  opens_at TIMESTAMPTZ,
  closes_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT weddings_window CHECK ((opens_at IS NULL) = (closes_at IS NULL) AND (closes_at IS NULL OR closes_at > opens_at))
);
ALTER TABLE weddings ENABLE ROW LEVEL SECURITY;

-- Codigo al azar (no es secreto: lo comparte la pareja). La unicidad la garantiza el UNIQUE; quien inserta reintenta.
CREATE FUNCTION new_wedding_code()
RETURNS TEXT
LANGUAGE sql VOLATILE
SET search_path = public
AS $$
  SELECT string_agg(substr(a.chars, 1 + floor(random() * length(a.chars))::INT, 1), '')
    FROM (SELECT 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'::TEXT AS chars) a, generate_series(1, 6)
$$;

-- Lo que escribe la gente: sin espacios ni guiones y en mayusculas ("ab3 k7m" = "AB3K7M")
CREATE FUNCTION normalize_wedding_code(p_code TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT UPPER(regexp_replace(COALESCE(p_code, ''), '[[:space:]-]', '', 'g'))
$$;

-- Los datos existentes: un casamiento con el horario que tenia el QR de la fiesta
INSERT INTO weddings (partner_a, partner_b, code, opens_at, closes_at)
SELECT 'Cecilia', 'Lucas', new_wedding_code(), e.opens_at, e.closes_at
  FROM (SELECT 1) AS one
  LEFT JOIN event_access e ON e.id;

-- Mientras haya un solo casamiento, un alta que no dice cual va a ese (las altas viejas y la base local siguen
-- andando). Con dos o mas devuelve NULL y el NOT NULL rechaza el alta: nunca cae en un casamiento ajeno.
CREATE FUNCTION default_wedding_id()
RETURNS UUID
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT CASE WHEN COUNT(*) = 1 THEN (array_agg(w.id))[1] END FROM weddings w
$$;

-- ADD COLUMN con DEFAULT llena las filas existentes con el casamiento migrado
ALTER TABLE users ADD COLUMN wedding_id UUID NOT NULL DEFAULT default_wedding_id() REFERENCES weddings(id);
ALTER TABLE guests ADD COLUMN wedding_id UUID NOT NULL DEFAULT default_wedding_id() REFERENCES weddings(id);
-- Registro del panel: de que casamiento es cada accion (para que cada panel vea solo lo suyo)
ALTER TABLE admin_actions ADD COLUMN wedding_id UUID REFERENCES weddings(id);
UPDATE admin_actions SET wedding_id = default_wedding_id();
CREATE INDEX idx_admin_actions_wedding ON admin_actions (wedding_id, created_at DESC);

-- Unicidades por casamiento (los indices empiezan por wedding_id: sirven tambien para filtrar por casamiento)
ALTER TABLE users DROP CONSTRAINT users_email_key;
ALTER TABLE users ADD CONSTRAINT users_wedding_email_key UNIQUE (wedding_id, email);
ALTER TABLE guests DROP CONSTRAINT guests_email_key;
ALTER TABLE guests ADD CONSTRAINT guests_wedding_email_key UNIQUE (wedding_id, email);
ALTER TABLE guests DROP CONSTRAINT guests_access_code_key;
ALTER TABLE guests ADD CONSTRAINT guests_wedding_access_code_key UNIQUE (wedding_id, access_code);

-- ---- El QR viejo y la entrada por WhatsApp/Instagram: afuera ----
DROP FUNCTION event_join(TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION event_search_guests(TEXT, TEXT);
DROP FUNCTION event_claim_guest(TEXT, UUID);
DROP FUNCTION event_access_problem(TEXT);
DROP TABLE event_access;

-- ---- Ayudas ----

-- Casamiento de una persona (NULL = no existe)
CREATE FUNCTION user_wedding_id(p_user UUID)
RETURNS UUID
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT u.wedding_id FROM users u WHERE u.id = p_user
$$;

-- Casamiento por su codigo (NULL = no existe)
CREATE FUNCTION wedding_id_by_code(p_code TEXT)
RETURNS UUID
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT w.id FROM weddings w WHERE w.code = normalize_wedding_code(p_code)
$$;

-- Casamiento para el login de invitados. Sin codigo (la app de antes, que todavia no lo manda) usa el unico
-- casamiento mientras haya uno solo; con varios, NULL = como un codigo que no existe.
CREATE FUNCTION login_wedding_id(p_code TEXT)
RETURNS UUID
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT CASE WHEN p_code IS NULL THEN default_wedding_id() ELSE wedding_id_by_code(p_code) END
$$;

-- Cada accion del panel queda anotada con el casamiento de quien la hizo
CREATE OR REPLACE FUNCTION admin_log(p_actor UUID, p_action TEXT, p_type TEXT, p_target TEXT, p_details JSONB DEFAULT NULL)
RETURNS VOID
LANGUAGE sql
SET search_path = public
AS $$
  INSERT INTO admin_actions (actor_id, wedding_id, action, target_type, target_id, details)
  VALUES (p_actor, user_wedding_id(p_actor), p_action, p_type, p_target, p_details)
$$;

-- TRUE si p_actor puede ver o cambiar el acceso (codigo, PIN, sesiones) del invitado con ese email, dentro de SU
-- casamiento. Las cuentas con rol (admin o superadmin) solo las maneja un superadmin.
CREATE OR REPLACE FUNCTION can_manage_access(p_actor UUID, p_email TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT COALESCE((SELECT u.role::TEXT = 'superadmin' FROM users u WHERE u.id = p_actor), FALSE)
      OR COALESCE((SELECT u.role::TEXT = 'guest' FROM users u
                    WHERE u.email = p_email AND u.wedding_id = user_wedding_id(p_actor)), TRUE)
$$;

-- ---- Casamiento: alta, datos y nombres ----

-- Una pareja crea su casamiento: codigo nuevo y la cuenta del dueño (superadmin, usuario y contraseña).
-- out_status: ok | invalid_names | invalid_username | username_taken (en esos casos no se crea nada)
CREATE FUNCTION create_wedding(p_partner_a TEXT, p_partner_b TEXT, p_username TEXT, p_password_hash TEXT)
RETURNS TABLE (out_status TEXT, out_wedding UUID, out_code TEXT, out_user UUID)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_a TEXT := BTRIM(p_partner_a);
  v_b TEXT := BTRIM(p_partner_b);
  v_username TEXT := LOWER(BTRIM(p_username));
  v_wedding UUID;
  v_code TEXT;
  v_user UUID;
BEGIN
  IF COALESCE(length(v_a), 0) NOT BETWEEN 1 AND 60 OR COALESCE(length(v_b), 0) NOT BETWEEN 1 AND 60 THEN
    RETURN QUERY SELECT 'invalid_names'::TEXT, NULL::UUID, NULL::TEXT, NULL::UUID;
    RETURN;
  END IF;
  IF v_username IS NULL OR v_username !~ '^[a-z0-9._-]{3,30}$' THEN
    RETURN QUERY SELECT 'invalid_username'::TEXT, NULL::UUID, NULL::TEXT, NULL::UUID;
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM admin_accounts a WHERE a.username = v_username) THEN
    RETURN QUERY SELECT 'username_taken'::TEXT, NULL::UUID, NULL::TEXT, NULL::UUID;
    RETURN;
  END IF;

  -- Codigo repetido (muy raro): se prueba otro
  FOR i IN 1..20 LOOP
    BEGIN
      INSERT INTO weddings (partner_a, partner_b, code) VALUES (v_a, v_b, new_wedding_code())
      RETURNING id, code INTO v_wedding, v_code;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      NULL;
    END;
  END LOOP;
  IF v_wedding IS NULL THEN
    RAISE EXCEPTION 'No se pudo generar un codigo de casamiento';
  END IF;

  BEGIN
    INSERT INTO users (wedding_id, email, role) VALUES (v_wedding, v_username || '@admin.invalid', 'superadmin')
    RETURNING id INTO v_user;
    INSERT INTO admin_accounts (user_id, username, password_hash) VALUES (v_user, v_username, p_password_hash);
  EXCEPTION WHEN unique_violation THEN
    -- Otro alta se quedo con el usuario al mismo tiempo: no queda un casamiento sin dueño
    DELETE FROM weddings WHERE id = v_wedding;
    RETURN QUERY SELECT 'username_taken'::TEXT, NULL::UUID, NULL::TEXT, NULL::UUID;
    RETURN;
  END;

  RETURN QUERY SELECT 'ok'::TEXT, v_wedding, v_code, v_user;
END;
$$;

-- ¿Estan abiertos los registros nuevos de este casamiento?
DROP FUNCTION registration_open();
CREATE FUNCTION registration_open(p_wedding UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT COALESCE((SELECT NOW() >= w.opens_at AND NOW() < w.closes_at FROM weddings w WHERE w.id = p_wedding), FALSE)
$$;

-- Lo mismo como tabla, por codigo, para la pantalla de login (codigo que no existe = cerrado).
-- Los parametros nuevos van al final y con DEFAULT NULL: la app de antes los llama sin codigo y sigue andando.
DROP FUNCTION registration_status();
CREATE FUNCTION registration_status(p_wedding_code TEXT DEFAULT NULL)
RETURNS TABLE (out_open BOOLEAN)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT registration_open(login_wedding_id(p_wedding_code))
$$;

-- Datos publicos del casamiento para la entrada de invitados (sin filas = el codigo no existe)
CREATE FUNCTION wedding_by_code(p_code TEXT)
RETURNS TABLE (out_id UUID, out_partner_a TEXT, out_partner_b TEXT, out_registration_open BOOLEAN)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT w.id, w.partner_a, w.partner_b, registration_open(w.id)
    FROM weddings w
   WHERE w.code = normalize_wedding_code(p_code)
$$;

-- El casamiento de una persona con sesion (sin filas = la cuenta no existe)
CREATE FUNCTION wedding_of_user(p_user_id UUID)
RETURNS TABLE (out_id UUID, out_code TEXT, out_partner_a TEXT, out_partner_b TEXT, out_opens TIMESTAMPTZ, out_closes TIMESTAMPTZ)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT w.id, w.code, w.partner_a, w.partner_b, w.opens_at, w.closes_at
    FROM users u JOIN weddings w ON w.id = u.wedding_id
   WHERE u.id = p_user_id
$$;

-- Cambiar los nombres de la pareja. Solo un superadmin de ese casamiento. out_status: ok | forbidden | invalid
CREATE FUNCTION admin_update_wedding(p_admin UUID, p_partner_a TEXT, p_partner_b TEXT)
RETURNS TABLE (out_status TEXT)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_a TEXT := BTRIM(p_partner_a);
  v_b TEXT := BTRIM(p_partner_b);
  v_wedding UUID;
BEGIN
  SELECT u.wedding_id INTO v_wedding FROM users u WHERE u.id = p_admin AND u.role::TEXT = 'superadmin';
  IF v_wedding IS NULL THEN
    RETURN QUERY SELECT 'forbidden'::TEXT;
    RETURN;
  END IF;
  IF COALESCE(length(v_a), 0) NOT BETWEEN 1 AND 60 OR COALESCE(length(v_b), 0) NOT BETWEEN 1 AND 60 THEN
    RETURN QUERY SELECT 'invalid'::TEXT;
    RETURN;
  END IF;
  UPDATE weddings SET partner_a = v_a, partner_b = v_b WHERE id = v_wedding;
  PERFORM admin_log(p_admin, 'wedding_update', 'wedding', v_wedding::TEXT, jsonb_build_object('partner_a', v_a, 'partner_b', v_b));
  RETURN QUERY SELECT 'ok'::TEXT;
END;
$$;

-- ---- Horario de registro (panel): el del casamiento de quien lo pide ----
-- Misma firma que antes. out_key ahora es el codigo del casamiento (la clave del QR ya no existe) y p_key se ignora.
-- Sin filas = sin permiso o todavia no se abrio nunca el registro.
CREATE OR REPLACE FUNCTION admin_get_event_access(p_actor UUID)
RETURNS TABLE (out_key TEXT, out_opens TIMESTAMPTZ, out_closes TIMESTAMPTZ, out_joined INT)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT w.code, w.opens_at, w.closes_at,
         (SELECT COUNT(*)::INT FROM guests g
           WHERE g.wedding_id = w.id
             AND (g.email LIKE '%@whatsapp.invalid' OR g.email LIKE '%@instagram.invalid' OR g.claimed_at IS NOT NULL))
    FROM weddings w
   WHERE w.id = user_wedding_id(p_actor) AND is_admin(p_actor) AND w.opens_at IS NOT NULL
$$;

CREATE OR REPLACE FUNCTION admin_set_event_access(p_actor UUID, p_key TEXT, p_opens TIMESTAMPTZ, p_closes TIMESTAMPTZ)
RETURNS TABLE (out_ok BOOLEAN)
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin(p_actor) THEN
    RETURN QUERY SELECT FALSE;
    RETURN;
  END IF;
  -- El CHECK weddings_window rechaza un cierre anterior a la apertura
  UPDATE weddings SET opens_at = p_opens, closes_at = p_closes WHERE id = user_wedding_id(p_actor);
  PERFORM admin_log(p_actor, 'event_window', 'event', NULL, jsonb_build_object('opens', p_opens, 'closes', p_closes));
  RETURN QUERY SELECT TRUE;
END;
$$;

-- ---- Login de invitados: con el codigo del casamiento (sin codigo: el unico casamiento, si hay uno solo) ----

-- Busca en la lista de ESE casamiento (2+ letras, hasta 8). Codigo que no existe = sin filas.
DROP FUNCTION guest_search(TEXT);
CREATE FUNCTION guest_search(p_query TEXT, p_wedding_code TEXT DEFAULT NULL)
RETURNS TABLE (out_id UUID, out_name TEXT, out_side TEXT, out_claimed BOOLEAN, out_returning BOOLEAN, out_registration_open BOOLEAN)
LANGUAGE plpgsql STABLE
SET search_path = public
AS $$
DECLARE
  v_wedding UUID := login_wedding_id(p_wedding_code);
  v_query TEXT := BTRIM(fold_name(p_query));
  v_open BOOLEAN;
BEGIN
  IF v_wedding IS NULL OR length(v_query) < 2 THEN
    RETURN;
  END IF;
  v_open := registration_open(v_wedding);
  RETURN QUERY
  SELECT g.id, g.name::TEXT, g.side, g.claimed_at IS NOT NULL,
         g.claimed_at IS NULL AND EXISTS (SELECT 1 FROM users u WHERE u.wedding_id = v_wedding AND u.email = g.email), v_open
    FROM guests g
   WHERE g.wedding_id = v_wedding
     AND strpos(fold_name(g.name), v_query) > 0
     AND (g.email IS NULL OR (g.email NOT LIKE '%@whatsapp.invalid' AND g.email NOT LIKE '%@instagram.invalid'))
   ORDER BY (fold_name(g.name) LIKE v_query || '%') DESC, lower(g.name)
   LIMIT 8;
END;
$$;

-- Primera vez (o despues de que le blanquearon el PIN). out_status: ok | closed | taken | not_found
-- Un invitado de otro casamiento responde not_found.
DROP FUNCTION guest_register(UUID, TEXT);
CREATE FUNCTION guest_register(p_guest UUID, p_pin_hash TEXT, p_wedding_code TEXT DEFAULT NULL)
RETURNS TABLE (out_status TEXT, out_id UUID, out_role TEXT, out_version INT)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_wedding UUID := login_wedding_id(p_wedding_code);
  v_guest guests%ROWTYPE;
  v_email TEXT;
BEGIN
  -- Bloquea la fila: si dos celulares eligen el mismo nombre a la vez, gana uno solo
  SELECT * INTO v_guest FROM guests g WHERE g.id = p_guest AND g.wedding_id = v_wedding FOR UPDATE;
  IF NOT FOUND OR v_guest.email LIKE '%@whatsapp.invalid' OR v_guest.email LIKE '%@instagram.invalid' THEN
    RETURN QUERY SELECT 'not_found'::TEXT, NULL::UUID, NULL::TEXT, NULL::INT;
    RETURN;
  END IF;
  IF v_guest.claimed_at IS NOT NULL THEN
    RETURN QUERY SELECT 'taken'::TEXT, NULL::UUID, NULL::TEXT, NULL::INT;
    RETURN;
  END IF;
  IF NOT registration_open(v_wedding)
     AND NOT EXISTS (SELECT 1 FROM users u WHERE u.wedding_id = v_wedding AND u.email = v_guest.email) THEN
    RETURN QUERY SELECT 'closed'::TEXT, NULL::UUID, NULL::TEXT, NULL::INT;
    RETURN;
  END IF;

  v_email := COALESCE(v_guest.email, 'g-' || v_guest.id::TEXT || '@lista.invalid');
  UPDATE guests
     SET email = v_email, claimed_at = NOW(), pin_hash = p_pin_hash, pin_failed = 0, pin_locked_until = NULL
   WHERE id = v_guest.id;

  RETURN QUERY
  INSERT INTO users AS u (wedding_id, email) VALUES (v_wedding, v_email)
  ON CONFLICT (wedding_id, email) DO UPDATE SET email = EXCLUDED.email
  RETURNING 'ok'::TEXT, u.id, u.role::TEXT, u.session_version;
END;
$$;

-- Para entrar con el PIN (el hash lo verifica el servidor). Sin filas = no es de este casamiento o no se registro.
DROP FUNCTION guest_pin_for_login(UUID);
CREATE FUNCTION guest_pin_for_login(p_guest UUID, p_wedding_code TEXT DEFAULT NULL)
RETURNS TABLE (out_hash TEXT, out_locked_until TIMESTAMPTZ)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT g.pin_hash, g.pin_locked_until FROM guests g
   WHERE g.id = p_guest AND g.wedding_id = login_wedding_id(p_wedding_code)
     AND g.claimed_at IS NOT NULL AND g.pin_hash IS NOT NULL
$$;

-- Resultado de un intento. out_status: ok | wrong | locked | not_found. 5 fallidos traban el nombre 15 minutos.
DROP FUNCTION guest_pin_attempt(UUID, BOOLEAN);
CREATE FUNCTION guest_pin_attempt(p_guest UUID, p_ok BOOLEAN, p_wedding_code TEXT DEFAULT NULL)
RETURNS TABLE (out_status TEXT, out_id UUID, out_role TEXT, out_version INT, out_left INT, out_locked_until TIMESTAMPTZ)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_guest guests%ROWTYPE;
  v_max CONSTANT INT := 5;
BEGIN
  SELECT * INTO v_guest FROM guests g
   WHERE g.id = p_guest AND g.wedding_id = login_wedding_id(p_wedding_code)
     AND g.claimed_at IS NOT NULL AND g.pin_hash IS NOT NULL
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::TEXT, NULL::UUID, NULL::TEXT, NULL::INT, NULL::INT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;
  IF v_guest.pin_locked_until IS NOT NULL AND v_guest.pin_locked_until > NOW() THEN
    RETURN QUERY SELECT 'locked'::TEXT, NULL::UUID, NULL::TEXT, NULL::INT, 0, v_guest.pin_locked_until;
    RETURN;
  END IF;

  IF NOT p_ok THEN
    IF v_guest.pin_failed + 1 >= v_max THEN
      UPDATE guests SET pin_failed = 0, pin_locked_until = NOW() + INTERVAL '15 minutes' WHERE id = p_guest
      RETURNING pin_locked_until INTO v_guest.pin_locked_until;
      RETURN QUERY SELECT 'locked'::TEXT, NULL::UUID, NULL::TEXT, NULL::INT, 0, v_guest.pin_locked_until;
    ELSE
      UPDATE guests SET pin_failed = pin_failed + 1, pin_locked_until = NULL WHERE id = p_guest;
      RETURN QUERY SELECT 'wrong'::TEXT, NULL::UUID, NULL::TEXT, NULL::INT, v_max - (v_guest.pin_failed + 1), NULL::TIMESTAMPTZ;
    END IF;
    RETURN;
  END IF;

  UPDATE guests SET pin_failed = 0, pin_locked_until = NULL WHERE id = p_guest;
  RETURN QUERY
  INSERT INTO users AS u (wedding_id, email) VALUES (v_guest.wedding_id, v_guest.email)
  ON CONFLICT (wedding_id, email) DO UPDATE SET email = EXCLUDED.email
  RETURNING 'ok'::TEXT, u.id, u.role::TEXT, u.session_version, NULL::INT, NULL::TIMESTAMPTZ;
END;
$$;

-- ---- Login con email + codigo de invitacion (camino viejo): dentro de un casamiento ----

DROP FUNCTION find_guest(TEXT, TEXT);
CREATE FUNCTION find_guest(p_email TEXT, p_code TEXT, p_wedding UUID DEFAULT NULL)
RETURNS TABLE (out_id UUID)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT g.id FROM guests g WHERE g.wedding_id = COALESCE(p_wedding, default_wedding_id()) AND g.email = p_email AND g.access_code = p_code
$$;

-- Crea la cuenta en el primer login (si ya existe no cambia el rol) y toma el nombre de la lista.
-- Sin p_wedding usa el unico casamiento; con varios, el NOT NULL de users.wedding_id rechaza el alta.
DROP FUNCTION upsert_user(TEXT);
CREATE FUNCTION upsert_user(p_email TEXT, p_wedding UUID DEFAULT NULL)
RETURNS TABLE (out_id UUID, out_email TEXT, out_role TEXT, out_version INT)
LANGUAGE sql
SET search_path = public
AS $$
  UPDATE guests SET claimed_at = NOW()
   WHERE wedding_id = COALESCE(p_wedding, default_wedding_id()) AND email = p_email AND claimed_at IS NULL;
  INSERT INTO users (wedding_id, email) VALUES (COALESCE(p_wedding, default_wedding_id()), p_email)
  ON CONFLICT (wedding_id, email) DO UPDATE SET email = EXCLUDED.email
  RETURNING id, email::TEXT, role::TEXT, session_version
$$;

-- ---- Cuentas de organizador (script create:admin) ----
-- Crea la cuenta (superadmin) en p_wedding o, si el usuario ya existe, le pone esta contraseña y le devuelve el rol
-- (la cuenta sigue en su casamiento). Sin p_wedding solo funciona mientras haya un unico casamiento.
DROP FUNCTION create_admin_account(TEXT, TEXT);
CREATE FUNCTION create_admin_account(p_username TEXT, p_hash TEXT, p_wedding UUID DEFAULT NULL)
RETURNS TABLE (out_user UUID, out_created BOOLEAN)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_username TEXT := LOWER(BTRIM(p_username));
  v_wedding UUID := COALESCE(p_wedding, default_wedding_id());
  v_user UUID;
BEGIN
  SELECT a.user_id INTO v_user FROM admin_accounts a WHERE a.username = v_username;
  IF v_user IS NOT NULL THEN
    UPDATE admin_accounts SET password_hash = p_hash, password_changed_at = NOW() WHERE user_id = v_user;
    UPDATE users SET role = 'superadmin', session_version = session_version + 1 WHERE id = v_user;
    RETURN QUERY SELECT v_user, FALSE;
    RETURN;
  END IF;
  IF v_wedding IS NULL THEN
    RAISE EXCEPTION 'Hay varios casamientos: indica en cual va la cuenta (p_wedding)';
  END IF;

  INSERT INTO users (wedding_id, email, role) VALUES (v_wedding, v_username || '@admin.invalid', 'superadmin')
  ON CONFLICT (wedding_id, email) DO UPDATE SET role = 'superadmin'
  RETURNING id INTO v_user;
  INSERT INTO admin_accounts (user_id, username, password_hash) VALUES (v_user, v_username, p_hash);
  RETURN QUERY SELECT v_user, TRUE;
END;
$$;

-- ---- Panel: lista de invitados, solo la del casamiento de quien la maneja ----

CREATE OR REPLACE FUNCTION admin_list_guests(
  p_actor UUID,
  p_search TEXT DEFAULT NULL,
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (
  guest_id UUID,
  guest_name VARCHAR,
  guest_email VARCHAR,
  guest_code VARCHAR,
  guest_side TEXT,
  created_at TIMESTAMPTZ,
  user_id UUID,
  user_role TEXT,
  has_profile BOOLEAN,
  guest_claimed BOOLEAN,
  total_count BIGINT
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT g.id, g.name, g.email,
         CASE WHEN can_manage_access(p_actor, g.email) THEN g.access_code END,
         g.side, g.created_at,
         u.id, u.role::TEXT, (p.id IS NOT NULL), (g.claimed_at IS NOT NULL), COUNT(*) OVER ()
    FROM guests g
    LEFT JOIN users u ON u.wedding_id = g.wedding_id AND u.email = g.email
    LEFT JOIN profiles p ON p.user_id = u.id
   WHERE is_admin(p_actor)
     AND g.wedding_id = user_wedding_id(p_actor)
     AND (
       NULLIF(BTRIM(p_search), '') IS NULL
       OR strpos(fold_name(g.name), fold_name(BTRIM(p_search))) > 0
       OR strpos(COALESCE(g.email, ''), LOWER(BTRIM(p_search))) > 0
     )
   ORDER BY LOWER(g.name), g.email
   LIMIT LEAST(GREATEST(p_limit, 1), 200) OFFSET GREATEST(p_offset, 0)
$$;

-- Alta o edicion (con email: por email; sin email: por nombre), siempre en el casamiento de quien la hace
CREATE OR REPLACE FUNCTION admin_upsert_guest(
  p_actor UUID,
  p_name TEXT,
  p_email TEXT,
  p_code TEXT,
  p_side TEXT DEFAULT NULL,
  p_replace_code BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (out_id UUID, out_code VARCHAR, out_created BOOLEAN)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_wedding UUID := user_wedding_id(p_actor);
  v_email TEXT := NULLIF(LOWER(BTRIM(p_email)), '');
  v_code TEXT := UPPER(REPLACE(REPLACE(BTRIM(p_code), ' ', ''), '-', ''));
  v_id UUID;
  v_can BOOLEAN;
BEGIN
  IF NOT is_admin(p_actor) THEN
    RETURN;
  END IF;
  IF p_side IS NOT NULL AND p_side NOT IN ('', 'bride', 'groom', 'both') THEN
    RAISE EXCEPTION 'Lado invalido';
  END IF;

  IF v_email IS NOT NULL THEN
    SELECT g.id INTO v_id FROM guests g WHERE g.wedding_id = v_wedding AND g.email = v_email FOR UPDATE;
  ELSE
    SELECT g.id INTO v_id FROM guests g
     WHERE g.wedding_id = v_wedding AND g.email IS NULL AND fold_name(BTRIM(g.name)) = fold_name(BTRIM(p_name))
     LIMIT 1 FOR UPDATE;
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO guests (wedding_id, name, email, access_code, side)
    VALUES (v_wedding, BTRIM(p_name), v_email, v_code, NULLIF(p_side, ''))
    RETURNING id INTO v_id;
    PERFORM admin_log(p_actor, 'guest_add', 'guest', v_id::TEXT, jsonb_build_object('email', v_email, 'name', BTRIM(p_name)));
    RETURN QUERY SELECT v_id, v_code::VARCHAR, TRUE;
    RETURN;
  END IF;

  v_can := can_manage_access(p_actor, v_email);

  UPDATE guests g
     SET name = BTRIM(p_name),
         side = CASE WHEN p_side IS NULL THEN g.side ELSE NULLIF(p_side, '') END,
         access_code = CASE WHEN p_replace_code AND v_can THEN v_code ELSE g.access_code END
   WHERE g.id = v_id;
  IF p_replace_code AND v_can THEN
    PERFORM admin_log(p_actor, 'guest_new_code', 'guest', v_id::TEXT, jsonb_build_object('email', v_email));
  END IF;
  RETURN QUERY SELECT g.id, CASE WHEN v_can THEN g.access_code END, FALSE FROM guests g WHERE g.id = v_id;
END;
$$;

-- Editar un invitado de su casamiento (de otro: sin filas, como uno que no existe)
CREATE OR REPLACE FUNCTION admin_update_guest(
  p_actor UUID,
  p_guest UUID,
  p_name TEXT DEFAULT NULL,
  p_side TEXT DEFAULT NULL,
  p_code TEXT DEFAULT NULL
)
RETURNS TABLE (out_id UUID, out_code VARCHAR)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_code TEXT := UPPER(REPLACE(REPLACE(BTRIM(p_code), ' ', ''), '-', ''));
  v_email TEXT;
  v_can BOOLEAN;
BEGIN
  IF NOT is_admin(p_actor) THEN
    RETURN;
  END IF;
  IF p_side IS NOT NULL AND p_side NOT IN ('', 'bride', 'groom', 'both') THEN
    RAISE EXCEPTION 'Lado invalido';
  END IF;

  SELECT g.email INTO v_email FROM guests g WHERE g.id = p_guest AND g.wedding_id = user_wedding_id(p_actor);
  IF NOT FOUND THEN
    RETURN;
  END IF;
  v_can := can_manage_access(p_actor, v_email);
  IF NULLIF(v_code, '') IS NOT NULL AND NOT v_can THEN
    RAISE EXCEPTION 'Solo un superadmin puede cambiar el codigo de un administrador'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE guests g
     SET name = COALESCE(NULLIF(BTRIM(p_name), ''), g.name),
         side = CASE WHEN p_side IS NULL THEN g.side ELSE NULLIF(p_side, '') END,
         access_code = COALESCE(NULLIF(v_code, ''), g.access_code)
   WHERE g.id = p_guest;

  IF NULLIF(v_code, '') IS NOT NULL THEN
    PERFORM admin_log(p_actor, 'guest_new_code', 'guest', p_guest::TEXT);
  END IF;
  RETURN QUERY SELECT g.id, CASE WHEN v_can THEN g.access_code END FROM guests g WHERE g.id = p_guest;
END;
$$;

-- Borrar un invitado (y su cuenta) de su casamiento. out_status: ok | forbidden | not_found | has_role
CREATE OR REPLACE FUNCTION admin_delete_guest(p_actor UUID, p_guest UUID)
RETURNS TABLE (out_status TEXT)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_wedding UUID := user_wedding_id(p_actor);
  v_email TEXT;
  v_name TEXT;
  v_user UUID;
  v_role TEXT;
BEGIN
  IF NOT is_admin(p_actor) THEN
    RETURN QUERY SELECT 'forbidden'::TEXT;
    RETURN;
  END IF;

  SELECT g.email, g.name INTO v_email, v_name FROM guests g WHERE g.id = p_guest AND g.wedding_id = v_wedding;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::TEXT;
    RETURN;
  END IF;

  SELECT u.id, u.role::TEXT INTO v_user, v_role FROM users u WHERE u.wedding_id = v_wedding AND u.email = v_email;
  IF v_user IS NOT NULL AND v_role <> 'guest' THEN
    RETURN QUERY SELECT 'has_role'::TEXT;
    RETURN;
  END IF;

  IF v_user IS NOT NULL THEN
    DELETE FROM users WHERE id = v_user;
  END IF;
  DELETE FROM guests WHERE id = p_guest;

  PERFORM admin_log(p_actor, 'guest_delete', 'guest', p_guest::TEXT,
                    jsonb_build_object('email', v_email, 'name', v_name, 'had_account', v_user IS NOT NULL));
  RETURN QUERY SELECT 'ok'::TEXT;
END;
$$;

-- Cerrar las sesiones de un invitado de su casamiento. out_status: ok | forbidden | not_found | no_account
CREATE OR REPLACE FUNCTION admin_revoke_sessions(p_actor UUID, p_guest UUID)
RETURNS TABLE (out_status TEXT, out_user UUID)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_wedding UUID := user_wedding_id(p_actor);
  v_email TEXT;
  v_user UUID;
BEGIN
  IF NOT is_admin(p_actor) THEN
    RETURN QUERY SELECT 'forbidden'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  SELECT g.email INTO v_email FROM guests g WHERE g.id = p_guest AND g.wedding_id = v_wedding;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  IF NOT can_manage_access(p_actor, v_email) THEN
    RETURN QUERY SELECT 'forbidden'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  SELECT u.id INTO v_user FROM users u WHERE u.wedding_id = v_wedding AND u.email = v_email;
  IF v_user IS NULL THEN
    RETURN QUERY SELECT 'no_account'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  UPDATE users SET session_version = session_version + 1 WHERE id = v_user;
  PERFORM admin_log(p_actor, 'sessions_revoke', 'guest', p_guest::TEXT, jsonb_build_object('email', v_email));
  RETURN QUERY SELECT 'ok'::TEXT, v_user;
END;
$$;

-- "Blanquear contraseña": borra el PIN y cierra sus sesiones (la cuenta se conserva) de un invitado de su
-- casamiento. Las cuentas con rol solo las blanquea un superadmin. out_status: ok | forbidden | not_found | not_claimed
CREATE OR REPLACE FUNCTION admin_release_guest(p_actor UUID, p_guest UUID)
RETURNS TABLE (out_status TEXT, out_user UUID)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_wedding UUID := user_wedding_id(p_actor);
  v_guest guests%ROWTYPE;
  v_user UUID;
BEGIN
  IF NOT is_admin(p_actor) THEN
    RETURN QUERY SELECT 'forbidden'::TEXT, NULL::UUID;
    RETURN;
  END IF;
  SELECT * INTO v_guest FROM guests g WHERE g.id = p_guest AND g.wedding_id = v_wedding FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::TEXT, NULL::UUID;
    RETURN;
  END IF;
  IF NOT can_manage_access(p_actor, v_guest.email) THEN
    RETURN QUERY SELECT 'forbidden'::TEXT, NULL::UUID;
    RETURN;
  END IF;
  IF v_guest.claimed_at IS NULL THEN
    RETURN QUERY SELECT 'not_claimed'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  UPDATE guests SET claimed_at = NULL, pin_hash = NULL, pin_failed = 0, pin_locked_until = NULL WHERE id = p_guest;
  UPDATE users SET session_version = session_version + 1
   WHERE wedding_id = v_wedding AND email = v_guest.email
  RETURNING id INTO v_user;
  PERFORM admin_log(p_actor, 'guest_release', 'guest', p_guest::TEXT, jsonb_build_object('name', v_guest.name));
  RETURN QUERY SELECT 'ok'::TEXT, v_user;
END;
$$;

-- ---- Permisos: solo el servidor (service role) ----
-- CREATE OR REPLACE conserva los permisos; las funciones nuevas o recreadas los necesitan explicitos.
REVOKE ALL ON FUNCTION new_wedding_code() FROM PUBLIC;
REVOKE ALL ON FUNCTION normalize_wedding_code(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION default_wedding_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION user_wedding_id(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION wedding_id_by_code(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION login_wedding_id(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_wedding(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION registration_open(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION registration_status(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION wedding_by_code(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION wedding_of_user(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_update_wedding(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION guest_search(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION guest_register(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION guest_pin_for_login(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION guest_pin_attempt(UUID, BOOLEAN, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION find_guest(TEXT, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION upsert_user(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_admin_account(TEXT, TEXT, UUID) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE weddings FROM anon, authenticated;
    REVOKE ALL ON FUNCTION new_wedding_code() FROM anon, authenticated;
    REVOKE ALL ON FUNCTION normalize_wedding_code(TEXT) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION default_wedding_id() FROM anon, authenticated;
    REVOKE ALL ON FUNCTION user_wedding_id(UUID) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION wedding_id_by_code(TEXT) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION login_wedding_id(TEXT) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION create_wedding(TEXT, TEXT, TEXT, TEXT) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION registration_open(UUID) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION registration_status(TEXT) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION wedding_by_code(TEXT) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION wedding_of_user(UUID) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION admin_update_wedding(UUID, TEXT, TEXT) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION guest_search(TEXT, TEXT) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION guest_register(UUID, TEXT, TEXT) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION guest_pin_for_login(UUID, TEXT) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION guest_pin_attempt(UUID, BOOLEAN, TEXT) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION find_guest(TEXT, TEXT, UUID) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION upsert_user(TEXT, UUID) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION create_admin_account(TEXT, TEXT, UUID) FROM anon, authenticated;
    GRANT EXECUTE ON FUNCTION new_wedding_code() TO service_role;
    GRANT EXECUTE ON FUNCTION normalize_wedding_code(TEXT) TO service_role;
    GRANT EXECUTE ON FUNCTION default_wedding_id() TO service_role;
    GRANT EXECUTE ON FUNCTION user_wedding_id(UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION wedding_id_by_code(TEXT) TO service_role;
    GRANT EXECUTE ON FUNCTION login_wedding_id(TEXT) TO service_role;
    GRANT EXECUTE ON FUNCTION create_wedding(TEXT, TEXT, TEXT, TEXT) TO service_role;
    GRANT EXECUTE ON FUNCTION registration_open(UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION registration_status(TEXT) TO service_role;
    GRANT EXECUTE ON FUNCTION wedding_by_code(TEXT) TO service_role;
    GRANT EXECUTE ON FUNCTION wedding_of_user(UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION admin_update_wedding(UUID, TEXT, TEXT) TO service_role;
    GRANT EXECUTE ON FUNCTION guest_search(TEXT, TEXT) TO service_role;
    GRANT EXECUTE ON FUNCTION guest_register(UUID, TEXT, TEXT) TO service_role;
    GRANT EXECUTE ON FUNCTION guest_pin_for_login(UUID, TEXT) TO service_role;
    GRANT EXECUTE ON FUNCTION guest_pin_attempt(UUID, BOOLEAN, TEXT) TO service_role;
    GRANT EXECUTE ON FUNCTION find_guest(TEXT, TEXT, UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION upsert_user(TEXT, UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION create_admin_account(TEXT, TEXT, UUID) TO service_role;
  END IF;
END $$;
