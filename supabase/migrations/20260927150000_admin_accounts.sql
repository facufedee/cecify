-- Cuentas de organizador con usuario y contraseña (el superusuario de los novios).
-- Entran por /login/admin; el resto de la gente entra con invitacion o con el QR de la fiesta y es invitado comun.
-- La contraseña NUNCA se guarda: solo su hash (scrypt, calculado en el servidor). Se crean con
-- `npm run create:admin` (no desde la app).
--
-- La cuenta usa un email interno <usuario>@admin.invalid (dominio reservado): no esta en la lista de invitados,
-- asi que nadie puede entrar a ella con un codigo o con el QR.

CREATE TABLE admin_accounts (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL CHECK (username ~ '^[a-z0-9._-]{3,30}$'),
  password_hash TEXT NOT NULL,
  password_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE admin_accounts ENABLE ROW LEVEL SECURITY;

-- Crea la cuenta (superadmin) o, si el usuario ya existe, le pone esta contraseña y le devuelve el rol.
-- Cambiar la contraseña cierra las sesiones abiertas. Solo la usa el script create:admin.
CREATE FUNCTION create_admin_account(p_username TEXT, p_hash TEXT)
RETURNS TABLE (out_user UUID, out_created BOOLEAN)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_username TEXT := LOWER(BTRIM(p_username));
  v_user UUID;
BEGIN
  SELECT a.user_id INTO v_user FROM admin_accounts a WHERE a.username = v_username;
  IF v_user IS NOT NULL THEN
    UPDATE admin_accounts SET password_hash = p_hash, password_changed_at = NOW() WHERE user_id = v_user;
    UPDATE users SET role = 'superadmin', session_version = session_version + 1 WHERE id = v_user;
    RETURN QUERY SELECT v_user, FALSE;
    RETURN;
  END IF;

  INSERT INTO users (email, role) VALUES (v_username || '@admin.invalid', 'superadmin')
  ON CONFLICT (email) DO UPDATE SET role = 'superadmin'
  RETURNING id INTO v_user;
  INSERT INTO admin_accounts (user_id, username, password_hash) VALUES (v_user, v_username, p_hash);
  RETURN QUERY SELECT v_user, TRUE;
END;
$$;

-- Para el login: el hash lo verifica el servidor. Sin filas = no existe ese usuario.
CREATE FUNCTION admin_account_for_login(p_username TEXT)
RETURNS TABLE (out_user UUID, out_hash TEXT, out_role TEXT, out_version INT)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT a.user_id, a.password_hash, u.role::TEXT, u.session_version
    FROM admin_accounts a JOIN users u ON u.id = a.user_id
   WHERE a.username = LOWER(BTRIM(p_username))
$$;

-- Usuario y hash de la cuenta de una persona con sesion (sin filas = entra con codigo, no tiene contraseña)
CREATE FUNCTION admin_account_of(p_user UUID)
RETURNS TABLE (out_username TEXT, out_hash TEXT, out_changed_at TIMESTAMPTZ)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT a.username, a.password_hash, a.password_changed_at FROM admin_accounts a WHERE a.user_id = p_user
$$;

-- Cambia la contraseña (el servidor ya verifico la actual) y cierra las demas sesiones.
-- Devuelve la version de sesion nueva (sin filas = no tiene cuenta con contraseña).
CREATE FUNCTION set_admin_password(p_user UUID, p_hash TEXT)
RETURNS TABLE (out_version INT)
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE admin_accounts SET password_hash = p_hash, password_changed_at = NOW() WHERE user_id = p_user;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  PERFORM admin_log(p_user, 'password_change', 'user', p_user::TEXT);
  RETURN QUERY UPDATE users SET session_version = session_version + 1 WHERE id = p_user RETURNING session_version;
END;
$$;

-- El QR de la fiesta ahora tambien acepta Instagram: el contador suma las dos formas de entrar
CREATE OR REPLACE FUNCTION admin_get_event_access(p_actor UUID)
RETURNS TABLE (out_key TEXT, out_opens TIMESTAMPTZ, out_closes TIMESTAMPTZ, out_joined INT)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT e.join_key, e.opens_at, e.closes_at,
         (SELECT COUNT(*)::INT FROM guests g
           WHERE g.email LIKE '%@whatsapp.invalid' OR g.email LIKE '%@instagram.invalid')
    FROM event_access e
   WHERE e.id AND is_admin(p_actor)
$$;

-- ---- Permisos: solo el servidor (service role) ----
REVOKE ALL ON FUNCTION create_admin_account(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_account_for_login(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_account_of(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION set_admin_password(UUID, TEXT) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE admin_accounts FROM anon, authenticated;
    REVOKE ALL ON FUNCTION create_admin_account(TEXT, TEXT) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION admin_account_for_login(TEXT) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION admin_account_of(UUID) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION set_admin_password(UUID, TEXT) FROM anon, authenticated;
    GRANT EXECUTE ON FUNCTION create_admin_account(TEXT, TEXT) TO service_role;
    GRANT EXECUTE ON FUNCTION admin_account_for_login(TEXT) TO service_role;
    GRANT EXECUTE ON FUNCTION admin_account_of(UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION set_admin_password(UUID, TEXT) TO service_role;
  END IF;
END $$;
