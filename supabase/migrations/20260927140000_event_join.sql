-- QR de la fiesta: un mismo QR (en la entrada y en las mesas) para que cualquier invitado entre sin estar
-- cargado antes. La persona pone su nombre y su WhatsApp; el WhatsApp identifica la cuenta (si cambia de
-- celular, vuelve a escanear y la recupera).
--
-- El QR lleva una clave (join_key) que solo sirve dentro del horario que elige un admin (opens_at..closes_at)
-- y que se puede cambiar si el QR se filtra (los carteles viejos dejan de funcionar).
--
-- Quien entra asi queda en `guests` con un email interno derivado del WhatsApp (<digitos>@whatsapp.invalid,
-- dominio reservado que nunca recibe correo). Asi el resto de la app (cuentas, panel, moderacion) no cambia.

-- Una sola fila (id siempre TRUE)
CREATE TABLE event_access (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  join_key TEXT NOT NULL CHECK (length(join_key) >= 16),
  opens_at TIMESTAMPTZ NOT NULL,
  closes_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT event_access_window CHECK (closes_at > opens_at)
);
ALTER TABLE event_access ENABLE ROW LEVEL SECURITY;

-- Entrada con el QR de la fiesta. out_status: ok | invalid (clave que no es o QR sin activar) | closed (fuera de horario)
-- Si la cuenta ya existia (otro celular) se cierran sus otras sesiones: queda abierta solo la de este dispositivo.
-- p_code: codigo de acceso para la fila de guests (lo genera el servidor; si se repite falla con unique_violation).
CREATE FUNCTION event_join(p_key TEXT, p_name TEXT, p_email TEXT, p_code TEXT)
RETURNS TABLE (out_status TEXT, out_id UUID, out_role TEXT, out_version INT, out_existing BOOLEAN)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_access event_access%ROWTYPE;
  v_email TEXT := LOWER(BTRIM(p_email));
  v_existing BOOLEAN;
BEGIN
  SELECT * INTO v_access FROM event_access WHERE id;
  IF NOT FOUND OR p_key IS NULL OR v_access.join_key <> p_key THEN
    RETURN QUERY SELECT 'invalid'::TEXT, NULL::UUID, NULL::TEXT, NULL::INT, NULL::BOOLEAN;
    RETURN;
  END IF;
  IF NOW() < v_access.opens_at OR NOW() >= v_access.closes_at THEN
    RETURN QUERY SELECT 'closed'::TEXT, NULL::UUID, NULL::TEXT, NULL::INT, NULL::BOOLEAN;
    RETURN;
  END IF;

  -- Si ya estaba (entro antes con este WhatsApp) se conserva su nombre: nadie puede renombrar a otro
  INSERT INTO guests (name, email, access_code)
  VALUES (LEFT(BTRIM(p_name), 100), v_email, UPPER(p_code))
  ON CONFLICT (email) DO NOTHING;

  v_existing := EXISTS (SELECT 1 FROM users u WHERE u.email = v_email);

  RETURN QUERY
  INSERT INTO users AS u (email) VALUES (v_email)
  ON CONFLICT (email) DO UPDATE SET session_version = u.session_version + 1
  RETURNING 'ok'::TEXT, u.id, u.role::TEXT, u.session_version, v_existing;
END;
$$;

-- ---- Panel ----

-- Configuracion actual (sin filas = todavia no se activo) y cuantos entraron con el QR
CREATE FUNCTION admin_get_event_access(p_actor UUID)
RETURNS TABLE (out_key TEXT, out_opens TIMESTAMPTZ, out_closes TIMESTAMPTZ, out_joined INT)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT e.join_key, e.opens_at, e.closes_at,
         (SELECT COUNT(*)::INT FROM guests g WHERE g.email LIKE '%@whatsapp.invalid')
    FROM event_access e
   WHERE e.id AND is_admin(p_actor)
$$;

-- Activa o cambia el horario. p_key NULL = conservar la clave actual (si no hay, falla: la genera el servidor).
-- out_ok FALSE = sin permiso. (Devuelve una tabla como el resto: supabase.rpc y la base local la leen igual.)
CREATE FUNCTION admin_set_event_access(p_actor UUID, p_key TEXT, p_opens TIMESTAMPTZ, p_closes TIMESTAMPTZ)
RETURNS TABLE (out_ok BOOLEAN)
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin(p_actor) THEN
    RETURN QUERY SELECT FALSE;
    RETURN;
  END IF;

  -- (UPDATE y despues INSERT: con ON CONFLICT, una clave NULL chocaria con el NOT NULL antes de resolver el conflicto)
  UPDATE event_access
     SET join_key = COALESCE(p_key, join_key), opens_at = p_opens, closes_at = p_closes, updated_at = NOW()
   WHERE id;
  IF NOT FOUND THEN
    INSERT INTO event_access (id, join_key, opens_at, closes_at) VALUES (TRUE, p_key, p_opens, p_closes);
  END IF;

  PERFORM admin_log(p_actor, CASE WHEN p_key IS NULL THEN 'event_window' ELSE 'event_new_qr' END, 'event', NULL,
                    jsonb_build_object('opens', p_opens, 'closes', p_closes));
  RETURN QUERY SELECT TRUE;
END;
$$;

-- ---- Permisos: solo el servidor (service role) ----
REVOKE ALL ON FUNCTION event_join(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_get_event_access(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_set_event_access(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE event_access FROM anon, authenticated;
    REVOKE ALL ON FUNCTION event_join(TEXT, TEXT, TEXT, TEXT) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION admin_get_event_access(UUID) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION admin_set_event_access(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM anon, authenticated;
    GRANT EXECUTE ON FUNCTION event_join(TEXT, TEXT, TEXT, TEXT) TO service_role;
    GRANT EXECUTE ON FUNCTION admin_get_event_access(UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION admin_set_event_access(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;
  END IF;
END $$;
