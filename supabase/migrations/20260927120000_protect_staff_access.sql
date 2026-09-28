-- El codigo de acceso de una cuenta con rol (admin o superadmin) solo lo maneja un superadmin.
-- Antes cualquier admin veia en la lista de invitados el codigo de los superadmin (los novios): con el
-- email y ese codigo podia entrar como ellos y quedarse con todos sus permisos (nombrar admins, leer las
-- conversaciones reportadas). Tambien podia generarles un codigo nuevo o cerrarles las sesiones y dejarlos afuera.
--
-- Ahora, para quien no es superadmin, las cuentas con rol quedan protegidas:
--   - admin_list_guests devuelve su codigo como NULL
--   - admin_update_guest no les cambia el codigo (falla con insufficient_privilege)
--   - admin_upsert_guest (alta o CSV) no les pisa el codigo y lo devuelve como NULL
--   - admin_revoke_sessions responde 'forbidden'
-- Con los invitados comunes todo sigue igual.

-- TRUE si p_actor puede ver o cambiar el acceso (codigo, sesiones) del invitado con ese email
CREATE FUNCTION can_manage_access(p_actor UUID, p_email TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT COALESCE((SELECT u.role::TEXT = 'superadmin' FROM users u WHERE u.id = p_actor), FALSE)
      OR COALESCE((SELECT u.role::TEXT = 'guest' FROM users u WHERE u.email = p_email), TRUE)
$$;

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
  total_count BIGINT
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT g.id, g.name, g.email,
         CASE WHEN can_manage_access(p_actor, g.email) THEN g.access_code END,
         g.side, g.created_at,
         u.id, u.role::TEXT, (p.id IS NOT NULL), COUNT(*) OVER ()
    FROM guests g
    LEFT JOIN users u ON u.email = g.email
    LEFT JOIN profiles p ON p.user_id = u.id
   WHERE is_admin(p_actor)
     AND (
       NULLIF(BTRIM(p_search), '') IS NULL
       OR strpos(LOWER(g.name), LOWER(BTRIM(p_search))) > 0
       OR strpos(g.email, LOWER(BTRIM(p_search))) > 0
     )
   ORDER BY LOWER(g.name), g.email
   LIMIT LEAST(GREATEST(p_limit, 1), 200) OFFSET GREATEST(p_offset, 0)
$$;

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
  v_email TEXT := LOWER(BTRIM(p_email));
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

  SELECT g.id INTO v_id FROM guests g WHERE g.email = v_email FOR UPDATE;

  IF v_id IS NULL THEN
    INSERT INTO guests (name, email, access_code, side)
    VALUES (BTRIM(p_name), v_email, v_code, NULLIF(p_side, ''))
    RETURNING id INTO v_id;
    PERFORM admin_log(p_actor, 'guest_add', 'guest', v_id::TEXT, jsonb_build_object('email', v_email));
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

  SELECT g.email INTO v_email FROM guests g WHERE g.id = p_guest;
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

CREATE OR REPLACE FUNCTION admin_revoke_sessions(p_actor UUID, p_guest UUID)
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

  IF NOT can_manage_access(p_actor, v_email) THEN
    RETURN QUERY SELECT 'forbidden'::TEXT, NULL::UUID;
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

-- ---- Permisos: solo el servidor (service role) ----
-- CREATE OR REPLACE conserva los permisos de las funciones que ya existian; la nueva los necesita explicitos.
REVOKE ALL ON FUNCTION can_manage_access(UUID, TEXT) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION can_manage_access(UUID, TEXT) FROM anon, authenticated;
    GRANT EXECUTE ON FUNCTION can_manage_access(UUID, TEXT) TO service_role;
  END IF;
END $$;
