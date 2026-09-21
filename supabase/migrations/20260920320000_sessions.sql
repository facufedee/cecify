-- Sesiones revocables. El token (JWT) lleva la "version de sesion" con la que se emitio; si en la base
-- cambia (cerrar sesion en todos los dispositivos, o un admin le cierra las sesiones a alguien), todos los
-- tokens anteriores dejan de servir. Solo se llaman desde el servidor (service role).

ALTER TABLE users ADD COLUMN session_version INT NOT NULL DEFAULT 0;

-- Version y rol actuales. Sin filas = el usuario ya no existe (su token tampoco sirve).
CREATE FUNCTION get_session_info(p_user UUID)
RETURNS TABLE (out_version INT, out_role TEXT)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT u.session_version, u.role::TEXT FROM users u WHERE u.id = p_user
$$;

-- Cierra todas las sesiones abiertas de la persona (cualquier dispositivo). Devuelve la version nueva.
CREATE FUNCTION revoke_sessions(p_user UUID)
RETURNS TABLE (out_version INT)
LANGUAGE sql
SET search_path = public
AS $$
  UPDATE users SET session_version = session_version + 1 WHERE id = p_user
  RETURNING session_version
$$;

-- Un administrador le cierra las sesiones a un invitado.
-- out_status: ok | forbidden | not_found | no_account (todavia no inicio sesion)
CREATE FUNCTION admin_revoke_sessions(p_actor UUID, p_guest UUID)
RETURNS TABLE (out_status TEXT, out_user UUID)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
  v_user UUID;
BEGIN
  IF NOT is_admin(p_actor) THEN
    RETURN QUERY SELECT 'forbidden'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  SELECT g.email INTO v_email FROM guests g WHERE g.id = p_guest;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  SELECT u.id INTO v_user FROM users u WHERE u.email = v_email;
  IF v_user IS NULL THEN
    RETURN QUERY SELECT 'no_account'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  UPDATE users SET session_version = session_version + 1 WHERE id = v_user;
  PERFORM admin_log(p_actor, 'sessions_revoke', 'guest', p_guest::TEXT, jsonb_build_object('email', v_email));
  RETURN QUERY SELECT 'ok'::TEXT, v_user;
END;
$$;

REVOKE ALL ON FUNCTION get_session_info(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION revoke_sessions(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_revoke_sessions(UUID, UUID) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION get_session_info(UUID) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION revoke_sessions(UUID) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION admin_revoke_sessions(UUID, UUID) FROM anon, authenticated;
    GRANT EXECUTE ON FUNCTION get_session_info(UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION revoke_sessions(UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION admin_revoke_sessions(UUID, UUID) TO service_role;
  END IF;
END $$;
