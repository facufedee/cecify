-- Login unico y simple: buscar tu nombre en la lista y un PIN de 4 numeros.
--   Primera vez (solo con el registro habilitado por un organizador): te elegis e inventas tu PIN.
--   Despues (siempre, aunque el registro este cerrado): buscas tu nombre y pones tu PIN.
-- Reemplaza al codigo de invitacion, al QR con clave, a "no estoy en la lista" y al codigo para la app instalada.
--
-- El PIN no se guarda: solo su hash (scrypt, lo calcula y verifica el servidor). Para que no se pueda adivinar:
-- 5 intentos fallidos traban ese nombre 15 minutos. Olvido del PIN o cambio de dueño: un organizador "libera" el
-- nombre (borra el PIN y cierra sus sesiones; la cuenta se conserva) y la persona vuelve a registrarse.
--
-- El registro abierto/cerrado usa el horario de event_access (opens_at..closes_at). La clave del QR ya no se usa.

ALTER TABLE guests
  ADD COLUMN pin_hash TEXT,
  ADD COLUMN pin_failed INT NOT NULL DEFAULT 0,
  ADD COLUMN pin_locked_until TIMESTAMPTZ;

-- Quienes entraron antes del PIN (codigo, QR con clave, lista sin PIN) no tienen PIN: quedan como "le reiniciaron el
-- PIN" y la proxima vez que entren inventan uno (siguen siendo la misma cuenta). Al aplicar esto no hay invitados reales.
UPDATE guests SET claimed_at = NULL WHERE claimed_at IS NOT NULL;

-- ¿Estan abiertos los registros nuevos? (horario elegido por un organizador)
CREATE FUNCTION registration_open()
RETURNS BOOLEAN
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT COALESCE((SELECT NOW() >= e.opens_at AND NOW() < e.closes_at FROM event_access e WHERE e.id), FALSE)
$$;

-- Lo mismo como tabla (supabase.rpc y la base local la leen igual), para la pantalla de login
CREATE FUNCTION registration_status()
RETURNS TABLE (out_open BOOLEAN)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT registration_open()
$$;

-- Busca en la lista (2+ letras, hasta 8; nunca la lista entera). out_claimed = ya se registro (entra con su PIN).
-- out_returning = ya tenia cuenta y un organizador le reinicio el PIN: puede inventar otro aunque el registro este
-- cerrado (el cierre es solo para gente nueva). out_registration_open se repite en todas las filas.
CREATE FUNCTION guest_search(p_query TEXT)
RETURNS TABLE (out_id UUID, out_name TEXT, out_side TEXT, out_claimed BOOLEAN, out_returning BOOLEAN, out_registration_open BOOLEAN)
LANGUAGE plpgsql STABLE
SET search_path = public
AS $$
DECLARE
  v_query TEXT := BTRIM(fold_name(p_query));
  v_open BOOLEAN := registration_open();
BEGIN
  IF length(v_query) < 2 THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT g.id, g.name::TEXT, g.side, g.claimed_at IS NOT NULL,
         g.claimed_at IS NULL AND EXISTS (SELECT 1 FROM users u WHERE u.email = g.email), v_open
    FROM guests g
   WHERE strpos(fold_name(g.name), v_query) > 0
     AND (g.email IS NULL OR (g.email NOT LIKE '%@whatsapp.invalid' AND g.email NOT LIKE '%@instagram.invalid'))
   ORDER BY (fold_name(g.name) LIKE v_query || '%') DESC, lower(g.name)
   LIMIT 8;
END;
$$;

-- Primera vez (o despues de que le reiniciaron el PIN): se elige y guarda su PIN. out_status: ok | closed | taken | not_found
-- Con el registro cerrado solo puede quien ya tenia cuenta (le reiniciaron el PIN).
CREATE FUNCTION guest_register(p_guest UUID, p_pin_hash TEXT)
RETURNS TABLE (out_status TEXT, out_id UUID, out_role TEXT, out_version INT)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_guest guests%ROWTYPE;
  v_email TEXT;
BEGIN
  -- Bloquea la fila: si dos celulares eligen el mismo nombre a la vez, gana uno solo
  SELECT * INTO v_guest FROM guests g WHERE g.id = p_guest FOR UPDATE;
  IF NOT FOUND OR v_guest.email LIKE '%@whatsapp.invalid' OR v_guest.email LIKE '%@instagram.invalid' THEN
    RETURN QUERY SELECT 'not_found'::TEXT, NULL::UUID, NULL::TEXT, NULL::INT;
    RETURN;
  END IF;
  IF v_guest.claimed_at IS NOT NULL THEN
    RETURN QUERY SELECT 'taken'::TEXT, NULL::UUID, NULL::TEXT, NULL::INT;
    RETURN;
  END IF;
  IF NOT registration_open() AND NOT EXISTS (SELECT 1 FROM users u WHERE u.email = v_guest.email) THEN
    RETURN QUERY SELECT 'closed'::TEXT, NULL::UUID, NULL::TEXT, NULL::INT;
    RETURN;
  END IF;

  v_email := COALESCE(v_guest.email, 'g-' || v_guest.id::TEXT || '@lista.invalid');
  UPDATE guests
     SET email = v_email, claimed_at = NOW(), pin_hash = p_pin_hash, pin_failed = 0, pin_locked_until = NULL
   WHERE id = v_guest.id;

  RETURN QUERY
  INSERT INTO users AS u (email) VALUES (v_email)
  ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
  RETURNING 'ok'::TEXT, u.id, u.role::TEXT, u.session_version;
END;
$$;

-- Para entrar con el PIN: el hash lo verifica el servidor. Sin filas = no existe o todavia no se registro.
CREATE FUNCTION guest_pin_for_login(p_guest UUID)
RETURNS TABLE (out_hash TEXT, out_locked_until TIMESTAMPTZ)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT g.pin_hash, g.pin_locked_until FROM guests g
   WHERE g.id = p_guest AND g.claimed_at IS NOT NULL AND g.pin_hash IS NOT NULL
$$;

-- Resultado de un intento. Bien: reinicia los fallidos y devuelve la cuenta. Mal: suma uno y, al quinto, traba el
-- nombre 15 minutos. out_status: ok | wrong | locked | not_found. out_left = intentos que quedan (si wrong).
CREATE FUNCTION guest_pin_attempt(p_guest UUID, p_ok BOOLEAN)
RETURNS TABLE (out_status TEXT, out_id UUID, out_role TEXT, out_version INT, out_left INT, out_locked_until TIMESTAMPTZ)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_guest guests%ROWTYPE;
  v_max CONSTANT INT := 5;
BEGIN
  SELECT * INTO v_guest FROM guests g WHERE g.id = p_guest AND g.claimed_at IS NOT NULL AND g.pin_hash IS NOT NULL FOR UPDATE;
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
  INSERT INTO users AS u (email) VALUES (v_guest.email)
  ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
  RETURNING 'ok'::TEXT, u.id, u.role::TEXT, u.session_version, NULL::INT, NULL::TIMESTAMPTZ;
END;
$$;

-- Liberar un nombre ahora tambien borra el PIN (sirve para "me olvide el PIN"): la persona inventa uno nuevo (aunque
-- el registro este cerrado, porque ya tenia cuenta) y sigue siendo la misma cuenta.
CREATE OR REPLACE FUNCTION admin_release_guest(p_actor UUID, p_guest UUID)
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

  UPDATE guests SET claimed_at = NULL, pin_hash = NULL, pin_failed = 0, pin_locked_until = NULL WHERE id = p_guest;
  UPDATE users SET session_version = session_version + 1 WHERE email = v_guest.email RETURNING id INTO v_user;
  PERFORM admin_log(p_actor, 'guest_release', 'guest', p_guest::TEXT, jsonb_build_object('name', v_guest.name));
  RETURN QUERY SELECT 'ok'::TEXT, v_user;
END;
$$;

-- ---- Permisos: solo el servidor (service role) ----
REVOKE ALL ON FUNCTION registration_open() FROM PUBLIC;
REVOKE ALL ON FUNCTION registration_status() FROM PUBLIC;
REVOKE ALL ON FUNCTION guest_search(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION guest_register(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION guest_pin_for_login(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION guest_pin_attempt(UUID, BOOLEAN) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION registration_open() FROM anon, authenticated;
    REVOKE ALL ON FUNCTION registration_status() FROM anon, authenticated;
    REVOKE ALL ON FUNCTION guest_search(TEXT) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION guest_register(UUID, TEXT) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION guest_pin_for_login(UUID) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION guest_pin_attempt(UUID, BOOLEAN) FROM anon, authenticated;
    GRANT EXECUTE ON FUNCTION registration_open() TO service_role;
    GRANT EXECUTE ON FUNCTION registration_status() TO service_role;
    GRANT EXECUTE ON FUNCTION guest_search(TEXT) TO service_role;
    GRANT EXECUTE ON FUNCTION guest_register(UUID, TEXT) TO service_role;
    GRANT EXECUTE ON FUNCTION guest_pin_for_login(UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION guest_pin_attempt(UUID, BOOLEAN) TO service_role;
  END IF;
END $$;
