-- Pasar la sesion del navegador a la app instalada.
-- En iPhone la app agregada a la pantalla de inicio tiene su propio almacenamiento (no ve la sesion de Safari), y
-- quien entro con el QR de la fiesta no tiene un codigo para volver a entrar. Desde el navegador (con sesion) se pide un
-- codigo de un solo uso; en la app instalada se escribe y queda adentro con la misma cuenta.
--
-- Del codigo se guarda solo su hash (sha256, lo calcula el servidor). Dura unos minutos, sirve una vez, hay uno solo
-- activo por persona y deja de servir si la persona cierra sus sesiones (cambia su version de sesion).

CREATE TABLE session_transfers (
  code_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_version INT NOT NULL,
  session_start BIGINT NOT NULL, -- inicio de la sesion original (segundos): la app instalada no la estira mas alla del tope
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_session_transfers_user ON session_transfers (user_id);
ALTER TABLE session_transfers ENABLE ROW LEVEL SECURITY;

-- Nuevo codigo para p_user (reemplaza al que tuviera pendiente). Sin filas = el usuario no existe.
CREATE FUNCTION create_session_transfer(p_user UUID, p_hash TEXT, p_session_start BIGINT, p_ttl_seconds INT)
RETURNS TABLE (out_expires TIMESTAMPTZ)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_version INT;
BEGIN
  SELECT u.session_version INTO v_version FROM users u WHERE u.id = p_user;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Uno activo por persona; de paso se limpian los viejos de todos
  DELETE FROM session_transfers WHERE user_id = p_user OR expires_at < NOW() - INTERVAL '1 day';

  RETURN QUERY
  INSERT INTO session_transfers (code_hash, user_id, session_version, session_start, expires_at)
  VALUES (p_hash, p_user, v_version, p_session_start, NOW() + make_interval(secs => LEAST(GREATEST(p_ttl_seconds, 60), 3600)))
  RETURNING expires_at;
END;
$$;

-- Canjea el codigo (una sola vez). Sin filas = no existe, ya se uso, vencio o la persona cerro sus sesiones.
CREATE FUNCTION redeem_session_transfer(p_hash TEXT)
RETURNS TABLE (out_user UUID, out_role TEXT, out_version INT, out_session_start BIGINT)
LANGUAGE sql
SET search_path = public
AS $$
  WITH used AS (
    UPDATE session_transfers t
       SET used_at = NOW()
      FROM users u
     WHERE t.code_hash = p_hash
       AND t.used_at IS NULL
       AND t.expires_at > NOW()
       AND u.id = t.user_id
       AND u.session_version = t.session_version
    RETURNING t.user_id, u.role::TEXT AS role, u.session_version, t.session_start
  )
  SELECT user_id, role, session_version, session_start FROM used
$$;

-- ---- Permisos: solo el servidor (service role) ----
REVOKE ALL ON FUNCTION create_session_transfer(UUID, TEXT, BIGINT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION redeem_session_transfer(TEXT) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE session_transfers FROM anon, authenticated;
    REVOKE ALL ON FUNCTION create_session_transfer(UUID, TEXT, BIGINT, INT) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION redeem_session_transfer(TEXT) FROM anon, authenticated;
    GRANT EXECUTE ON FUNCTION create_session_transfer(UUID, TEXT, BIGINT, INT) TO service_role;
    GRANT EXECUTE ON FUNCTION redeem_session_transfer(TEXT) TO service_role;
  END IF;
END $$;
