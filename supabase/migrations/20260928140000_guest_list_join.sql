-- Entrar eligiendose de la lista de invitados.
-- El organizador carga la lista del casamiento (alcanza con el nombre; el email ya no es obligatorio). El invitado
-- escanea el QR de la fiesta, busca su nombre (2+ letras, nunca se muestra la lista entera) y se elige.
--
-- Cada nombre se elige UNA vez (guests.claimed_at): si ya entro alguien con ese nombre queda bloqueado, asi nadie se
-- queda con la cuenta de otro. Tambien cuenta como elegido quien entro con su codigo de invitacion. Si la persona
-- cambia de celular, usa "codigo para la app" o un organizador le libera el nombre desde el panel (cierra sus
-- sesiones y conserva la cuenta: al volver a elegirse sigue siendo la misma).
--
-- Un invitado sin email recibe uno interno al elegirse (g-<id>@lista.invalid, dominio reservado) para su cuenta.

ALTER TABLE guests ALTER COLUMN email DROP NOT NULL;
ALTER TABLE guests ADD COLUMN claimed_at TIMESTAMPTZ;

-- Quien ya entro (con codigo, QR o lo que sea) tiene su nombre tomado
UPDATE guests g SET claimed_at = COALESCE(u.created_at, NOW()) FROM users u WHERE u.email = g.email;

-- Nombre sin mayusculas ni acentos, para buscar ("jose" encuentra "José")
CREATE FUNCTION fold_name(p_text TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT translate(lower(COALESCE(p_text, '')), 'áàäâãéèëêíìïîóòöôõúùüûñç', 'aaaaaeeeeiiiiooooouuuunc')
$$;

CREATE INDEX idx_guests_folded_name ON guests (fold_name(name));

-- El QR de la fiesta (clave y horario). NULL = sirve; si no, el motivo: invalid | closed
CREATE FUNCTION event_access_problem(p_key TEXT)
RETURNS TEXT
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN e.id IS NULL OR p_key IS NULL OR e.join_key <> p_key THEN 'invalid'
    WHEN NOW() < e.opens_at OR NOW() >= e.closes_at THEN 'closed'
  END
    FROM (SELECT 1) AS one
    LEFT JOIN event_access e ON e.id
$$;

-- Busca en la lista (sin los que entraron solos con WhatsApp o Instagram). Minimo 2 letras, hasta 8 resultados.
-- Con el QR invalido o fuera de horario devuelve una sola fila con out_status y nada mas.
CREATE FUNCTION event_search_guests(p_key TEXT, p_query TEXT)
RETURNS TABLE (out_status TEXT, out_id UUID, out_name TEXT, out_side TEXT, out_taken BOOLEAN)
LANGUAGE plpgsql STABLE
SET search_path = public
AS $$
DECLARE
  v_problem TEXT := event_access_problem(p_key);
  v_query TEXT := BTRIM(fold_name(p_query));
BEGIN
  IF v_problem IS NOT NULL THEN
    RETURN QUERY SELECT v_problem, NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::BOOLEAN;
    RETURN;
  END IF;
  IF length(v_query) < 2 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT 'ok'::TEXT, g.id, g.name::TEXT, g.side, g.claimed_at IS NOT NULL
    FROM guests g
   WHERE strpos(fold_name(g.name), v_query) > 0
     AND (g.email IS NULL OR (g.email NOT LIKE '%@whatsapp.invalid' AND g.email NOT LIKE '%@instagram.invalid'))
   -- Primero los que empiezan con lo buscado ("ana" antes que "mariana")
   ORDER BY (fold_name(g.name) LIKE v_query || '%') DESC, lower(g.name)
   LIMIT 8;
END;
$$;

-- Se elige de la lista. out_status: ok | invalid | closed | not_found | taken
CREATE FUNCTION event_claim_guest(p_key TEXT, p_guest UUID)
RETURNS TABLE (out_status TEXT, out_id UUID, out_role TEXT, out_version INT)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_problem TEXT := event_access_problem(p_key);
  v_guest guests%ROWTYPE;
  v_email TEXT;
BEGIN
  IF v_problem IS NOT NULL THEN
    RETURN QUERY SELECT v_problem, NULL::UUID, NULL::TEXT, NULL::INT;
    RETURN;
  END IF;

  -- Bloquea la fila: si dos celulares eligen el mismo nombre a la vez, gana uno solo
  SELECT * INTO v_guest FROM guests g WHERE g.id = p_guest FOR UPDATE;
  IF NOT FOUND
     OR v_guest.email LIKE '%@whatsapp.invalid' OR v_guest.email LIKE '%@instagram.invalid' THEN
    RETURN QUERY SELECT 'not_found'::TEXT, NULL::UUID, NULL::TEXT, NULL::INT;
    RETURN;
  END IF;
  IF v_guest.claimed_at IS NOT NULL THEN
    RETURN QUERY SELECT 'taken'::TEXT, NULL::UUID, NULL::TEXT, NULL::INT;
    RETURN;
  END IF;

  v_email := COALESCE(v_guest.email, 'g-' || v_guest.id::TEXT || '@lista.invalid');
  UPDATE guests SET email = v_email, claimed_at = NOW() WHERE id = v_guest.id;

  -- Si ya tenia cuenta (un organizador le libero el nombre), es la misma; sus otras sesiones ya se cerraron al liberarlo
  RETURN QUERY
  INSERT INTO users AS u (email) VALUES (v_email)
  ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
  RETURNING 'ok'::TEXT, u.id, u.role::TEXT, u.session_version;
END;
$$;

-- Entrar con el codigo de invitacion tambien toma el nombre (asi nadie lo elige despues desde la lista)
CREATE OR REPLACE FUNCTION upsert_user(p_email TEXT)
RETURNS TABLE (out_id UUID, out_email TEXT, out_role TEXT, out_version INT)
LANGUAGE sql
SET search_path = public
AS $$
  UPDATE guests SET claimed_at = NOW() WHERE email = p_email AND claimed_at IS NULL;
  INSERT INTO users (email) VALUES (p_email)
  ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
  RETURNING id, email::TEXT, role::TEXT, session_version
$$;

-- ---- Panel ----

-- Libera el nombre para que se pueda volver a elegir (p. ej. cambio de celular). Cierra sus sesiones y conserva la
-- cuenta. out_status: ok | forbidden | not_found | not_claimed
CREATE FUNCTION admin_release_guest(p_actor UUID, p_guest UUID)
RETURNS TABLE (out_status TEXT, out_user UUID)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_guest guests%ROWTYPE;
  v_user UUID;
BEGIN
  IF NOT is_admin(p_actor) THEN
    RETURN QUERY SELECT 'forbidden'::TEXT, NULL::UUID;
    RETURN;
  END IF;
  SELECT * INTO v_guest FROM guests g WHERE g.id = p_guest FOR UPDATE;
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

  UPDATE guests SET claimed_at = NULL WHERE id = p_guest;
  UPDATE users SET session_version = session_version + 1 WHERE email = v_guest.email RETURNING id INTO v_user;
  PERFORM admin_log(p_actor, 'guest_release', 'guest', p_guest::TEXT, jsonb_build_object('name', v_guest.name));
  RETURN QUERY SELECT 'ok'::TEXT, v_user;
END;
$$;

-- La lista del panel suma si el nombre ya se eligio (cambia el resultado: hay que recrearla)
DROP FUNCTION admin_list_guests(UUID, TEXT, INT, INT);
CREATE FUNCTION admin_list_guests(
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
    LEFT JOIN users u ON u.email = g.email
    LEFT JOIN profiles p ON p.user_id = u.id
   WHERE is_admin(p_actor)
     AND (
       NULLIF(BTRIM(p_search), '') IS NULL
       OR strpos(fold_name(g.name), fold_name(BTRIM(p_search))) > 0
       OR strpos(COALESCE(g.email, ''), LOWER(BTRIM(p_search))) > 0
     )
   ORDER BY LOWER(g.name), g.email
   LIMIT LEAST(GREATEST(p_limit, 1), 200) OFFSET GREATEST(p_offset, 0)
$$;

-- Alta o edicion. Con email: por email (como antes). Sin email (lista de casamiento): por nombre entre los que no
-- tienen email, asi volver a importar la misma lista no duplica a nadie. p_side: NULL = no cambiar, '' = quitar.
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
    SELECT g.id INTO v_id FROM guests g WHERE g.email = v_email FOR UPDATE;
  ELSE
    SELECT g.id INTO v_id FROM guests g
     WHERE g.email IS NULL AND fold_name(BTRIM(g.name)) = fold_name(BTRIM(p_name))
     LIMIT 1 FOR UPDATE;
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO guests (name, email, access_code, side)
    VALUES (BTRIM(p_name), v_email, v_code, NULLIF(p_side, ''))
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

-- El contador del QR de la fiesta suma a los que se eligieron de la lista
CREATE OR REPLACE FUNCTION admin_get_event_access(p_actor UUID)
RETURNS TABLE (out_key TEXT, out_opens TIMESTAMPTZ, out_closes TIMESTAMPTZ, out_joined INT)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT e.join_key, e.opens_at, e.closes_at,
         (SELECT COUNT(*)::INT FROM guests g
           WHERE g.email LIKE '%@whatsapp.invalid' OR g.email LIKE '%@instagram.invalid' OR g.claimed_at IS NOT NULL)
    FROM event_access e
   WHERE e.id AND is_admin(p_actor)
$$;

-- ---- Permisos: solo el servidor (service role) ----
REVOKE ALL ON FUNCTION fold_name(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION event_access_problem(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION event_search_guests(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION event_claim_guest(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_release_guest(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_list_guests(UUID, TEXT, INT, INT) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION fold_name(TEXT) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION event_access_problem(TEXT) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION event_search_guests(TEXT, TEXT) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION event_claim_guest(TEXT, UUID) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION admin_release_guest(UUID, UUID) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION admin_list_guests(UUID, TEXT, INT, INT) FROM anon, authenticated;
    GRANT EXECUTE ON FUNCTION fold_name(TEXT) TO service_role;
    GRANT EXECUTE ON FUNCTION event_access_problem(TEXT) TO service_role;
    GRANT EXECUTE ON FUNCTION event_search_guests(TEXT, TEXT) TO service_role;
    GRANT EXECUTE ON FUNCTION event_claim_guest(TEXT, UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION admin_release_guest(UUID, UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION admin_list_guests(UUID, TEXT, INT, INT) TO service_role;
  END IF;
END $$;
