-- Panel de administracion: metricas, invitados, reportes y moderacion. Solo se llaman desde el
-- servidor (service role). Cada funcion vuelve a comprobar que quien pide sea admin o superadmin
-- (is_admin): sin permiso no devuelven filas ni cambian nada.

-- Borrar un usuario con chats fallaba: conversations apuntaba a users sin ON DELETE CASCADE
-- (el match si se borraba en cascada, pero la restriccion se comprobaba antes). Ahora se borra todo junto.
ALTER TABLE conversations
  DROP CONSTRAINT conversations_user1_id_fkey,
  DROP CONSTRAINT conversations_user2_id_fkey,
  ADD CONSTRAINT conversations_user1_id_fkey FOREIGN KEY (user1_id) REFERENCES users(id) ON DELETE CASCADE,
  ADD CONSTRAINT conversations_user2_id_fkey FOREIGN KEY (user2_id) REFERENCES users(id) ON DELETE CASCADE;

CREATE FUNCTION is_admin(p_user UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT COALESCE((SELECT u.role::TEXT IN ('admin', 'superadmin') FROM users u WHERE u.id = p_user), FALSE)
$$;

-- Registro de lo que hacen los administradores (quien borro que, cuando)
CREATE TABLE admin_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_admin_actions_created ON admin_actions (created_at DESC);
ALTER TABLE admin_actions ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION admin_log(p_actor UUID, p_action TEXT, p_type TEXT, p_target TEXT, p_details JSONB DEFAULT NULL)
RETURNS VOID
LANGUAGE sql
SET search_path = public
AS $$
  INSERT INTO admin_actions (actor_id, action, target_type, target_id, details)
  VALUES (p_actor, p_action, p_type, p_target, p_details)
$$;

-- El cambio de rol tambien queda registrado (mismo comportamiento que antes)
CREATE OR REPLACE FUNCTION set_user_role(p_actor UUID, p_target UUID, p_role TEXT)
RETURNS TABLE (status TEXT, new_role TEXT)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_actor TEXT;
  v_current TEXT;
BEGIN
  IF p_role IS NULL OR p_role NOT IN ('guest', 'admin', 'superadmin') THEN
    RETURN QUERY SELECT 'invalid'::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('set_user_role', 0));

  SELECT u.role::TEXT INTO v_actor FROM users u WHERE u.id = p_actor;
  IF v_actor IS DISTINCT FROM 'superadmin' THEN
    RETURN QUERY SELECT 'forbidden'::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  SELECT u.role::TEXT INTO v_current FROM users u WHERE u.id = p_target;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  IF v_current = 'superadmin' AND p_role <> 'superadmin'
     AND (SELECT COUNT(*) FROM users u WHERE u.role::TEXT = 'superadmin') <= 1 THEN
    RETURN QUERY SELECT 'last_superadmin'::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  UPDATE users SET role = p_role::user_role WHERE id = p_target;
  PERFORM admin_log(p_actor, 'set_role', 'user', p_target::TEXT,
                    jsonb_build_object('from', v_current, 'to', p_role));
  RETURN QUERY SELECT 'ok'::TEXT, p_role;
END;
$$;

-- ---- Metricas ----

CREATE FUNCTION admin_stats(p_actor UUID)
RETURNS TABLE (
  guests_total INT,
  guests_joined INT,
  profiles_total INT,
  wants_match INT,
  only_wall INT,
  side_bride INT,
  side_groom INT,
  side_both INT,
  side_unset INT,
  matches_total INT,
  messages_total INT,
  photos_total INT,
  comments_total INT,
  stories_active INT,
  reports_open INT,
  blocks_total INT
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT (SELECT COUNT(*)::INT FROM guests),
         (SELECT COUNT(*)::INT FROM guests g WHERE EXISTS (SELECT 1 FROM users u WHERE u.email = g.email)),
         (SELECT COUNT(*)::INT FROM profiles),
         (SELECT COUNT(*)::INT FROM profiles WHERE wants_match),
         (SELECT COUNT(*)::INT FROM profiles WHERE NOT wants_match),
         (SELECT COUNT(*)::INT FROM profiles WHERE side = 'bride'),
         (SELECT COUNT(*)::INT FROM profiles WHERE side = 'groom'),
         (SELECT COUNT(*)::INT FROM profiles WHERE side = 'both'),
         (SELECT COUNT(*)::INT FROM profiles WHERE side IS NULL),
         (SELECT COUNT(*)::INT FROM matches),
         (SELECT COUNT(*)::INT FROM messages WHERE deleted_at IS NULL),
         (SELECT COUNT(*)::INT FROM photos),
         (SELECT COUNT(*)::INT FROM photo_comments),
         (SELECT COUNT(*)::INT FROM stories WHERE expires_at > NOW()),
         (SELECT COUNT(*)::INT FROM reports WHERE status = 'open'),
         (SELECT COUNT(*)::INT FROM blocks)
   WHERE is_admin(p_actor)
$$;

-- ---- Invitados ----

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
  total_count BIGINT
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT g.id, g.name, g.email, g.access_code, g.side, g.created_at,
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

-- Alta o edicion por email. p_side: NULL = no cambiar, '' = quitar, o bride | groom | both.
-- El codigo solo se pisa con p_replace_code (un invitado que ya tiene su codigo no lo pierde).
CREATE FUNCTION admin_upsert_guest(
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

  UPDATE guests g
     SET name = BTRIM(p_name),
         side = CASE WHEN p_side IS NULL THEN g.side ELSE NULLIF(p_side, '') END,
         access_code = CASE WHEN p_replace_code THEN v_code ELSE g.access_code END
   WHERE g.id = v_id;
  IF p_replace_code THEN
    PERFORM admin_log(p_actor, 'guest_new_code', 'guest', v_id::TEXT, jsonb_build_object('email', v_email));
  END IF;
  RETURN QUERY SELECT g.id, g.access_code, FALSE FROM guests g WHERE g.id = v_id;
END;
$$;

-- Edita un invitado por id. NULL = no cambiar (p_side '' = quitar el lado). Sin filas = no existe o sin permiso.
-- Un codigo repetido falla con unique_violation: el servidor lo reintenta con otro.
CREATE FUNCTION admin_update_guest(
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
BEGIN
  IF NOT is_admin(p_actor) THEN
    RETURN;
  END IF;
  IF p_side IS NOT NULL AND p_side NOT IN ('', 'bride', 'groom', 'both') THEN
    RAISE EXCEPTION 'Lado invalido';
  END IF;

  UPDATE guests g
     SET name = COALESCE(NULLIF(BTRIM(p_name), ''), g.name),
         side = CASE WHEN p_side IS NULL THEN g.side ELSE NULLIF(p_side, '') END,
         access_code = COALESCE(NULLIF(v_code, ''), g.access_code)
   WHERE g.id = p_guest;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF NULLIF(v_code, '') IS NOT NULL THEN
    PERFORM admin_log(p_actor, 'guest_new_code', 'guest', p_guest::TEXT);
  END IF;
  RETURN QUERY SELECT g.id, g.access_code FROM guests g WHERE g.id = p_guest;
END;
$$;

-- Quita al invitado de la lista (ya no puede entrar) y borra su cuenta con todo lo suyo:
-- perfil, fotos, comentarios, historias, matches y chats. No se puede si tiene rol de admin.
-- out_status: ok | forbidden | not_found | has_role
CREATE FUNCTION admin_delete_guest(p_actor UUID, p_guest UUID)
RETURNS TABLE (out_status TEXT)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
  v_name TEXT;
  v_user UUID;
  v_role TEXT;
BEGIN
  IF NOT is_admin(p_actor) THEN
    RETURN QUERY SELECT 'forbidden'::TEXT;
    RETURN;
  END IF;

  SELECT g.email, g.name INTO v_email, v_name FROM guests g WHERE g.id = p_guest;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::TEXT;
    RETURN;
  END IF;

  SELECT u.id, u.role::TEXT INTO v_user, v_role FROM users u WHERE u.email = v_email;
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

-- ---- Reportes ----

-- p_status: open | reviewed | dismissed, o NULL para todos
CREATE FUNCTION admin_list_reports(
  p_actor UUID,
  p_status TEXT DEFAULT NULL,
  p_limit INT DEFAULT 30,
  p_before TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  report_id UUID,
  report_type TEXT,
  reason TEXT,
  details TEXT,
  status TEXT,
  created_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  target_id UUID,
  context JSONB,
  reporter_id UUID,
  reporter_name VARCHAR,
  reported_id UUID,
  reported_name VARCHAR,
  reported_photo VARCHAR,
  reported_role TEXT,
  reports_against INT,
  open_against INT
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT r.id, r.type::TEXT, r.reason::TEXT, r.details, r.status::TEXT, r.created_at, r.reviewed_at,
         r.target_id, r.context,
         r.reporter_id, COALESCE(rp.name, ru.email)::VARCHAR,
         r.reported_user_id, COALESCE(dp.name, du.email)::VARCHAR, dp.main_photo_url, du.role::TEXT,
         (SELECT COUNT(*)::INT FROM reports x WHERE x.reported_user_id = r.reported_user_id),
         (SELECT COUNT(*)::INT FROM reports x WHERE x.reported_user_id = r.reported_user_id AND x.status = 'open')
    FROM reports r
    JOIN users ru ON ru.id = r.reporter_id
    LEFT JOIN profiles rp ON rp.user_id = r.reporter_id
    JOIN users du ON du.id = r.reported_user_id
    LEFT JOIN profiles dp ON dp.user_id = r.reported_user_id
   WHERE is_admin(p_actor)
     AND (p_status IS NULL OR r.status::TEXT = p_status)
     AND (p_before IS NULL OR r.created_at < p_before)
   ORDER BY r.created_at DESC
   LIMIT LEAST(GREATEST(p_limit, 1), 100)
$$;

CREATE FUNCTION admin_set_report_status(p_actor UUID, p_report UUID, p_status TEXT)
RETURNS TABLE (out_ok BOOLEAN)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_rows INT;
BEGIN
  IF NOT is_admin(p_actor) OR p_status IS NULL OR p_status NOT IN ('open', 'reviewed', 'dismissed') THEN
    RETURN QUERY SELECT FALSE;
    RETURN;
  END IF;

  UPDATE reports
     SET status = p_status::report_status,
         reviewed_at = CASE WHEN p_status = 'open' THEN NULL ELSE NOW() END
   WHERE id = p_report;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows > 0 THEN
    PERFORM admin_log(p_actor, 'report_' || p_status, 'report', p_report::TEXT);
  END IF;
  RETURN QUERY SELECT v_rows > 0;
END;
$$;

-- ---- Moderacion de contenido (ve todo, sin filtros de bloqueo) ----

CREATE FUNCTION admin_list_photos(p_actor UUID, p_before TIMESTAMPTZ DEFAULT NULL, p_limit INT DEFAULT 24)
RETURNS TABLE (
  photo_id UUID,
  author_id UUID,
  author_name VARCHAR,
  photo_url VARCHAR,
  caption TEXT,
  likes_count INT,
  comments_count INT,
  created_at TIMESTAMPTZ
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT ph.id, ph.user_id, COALESCE(p.name, 'Invitado')::VARCHAR, ph.photo_url, ph.caption,
         COALESCE(ph.likes_count, 0),
         (SELECT COUNT(*)::INT FROM photo_comments c WHERE c.photo_id = ph.id),
         ph.created_at
    FROM photos ph
    LEFT JOIN profiles p ON p.user_id = ph.user_id
   WHERE is_admin(p_actor)
     AND (p_before IS NULL OR ph.created_at < p_before)
   ORDER BY ph.created_at DESC
   LIMIT LEAST(GREATEST(p_limit, 1), 60)
$$;

CREATE FUNCTION admin_list_comments(p_actor UUID, p_photo UUID)
RETURNS TABLE (
  comment_id UUID,
  author_id UUID,
  author_name VARCHAR,
  body TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT c.id, c.user_id, COALESCE(p.name, 'Invitado')::VARCHAR, c.content, c.created_at
    FROM photo_comments c
    LEFT JOIN profiles p ON p.user_id = c.user_id
   WHERE is_admin(p_actor) AND c.photo_id = p_photo
   ORDER BY c.created_at ASC
$$;

-- Devuelve la url para poder limpiar el archivo; sin filas = no existia (o no hay permiso)
CREATE FUNCTION admin_delete_photo(p_actor UUID, p_photo UUID)
RETURNS TABLE (out_url VARCHAR)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_url VARCHAR;
  v_owner UUID;
  v_caption TEXT;
BEGIN
  IF NOT is_admin(p_actor) THEN
    RETURN;
  END IF;
  DELETE FROM photos WHERE id = p_photo RETURNING photo_url, user_id, caption INTO v_url, v_owner, v_caption;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  PERFORM admin_log(p_actor, 'photo_delete', 'photo', p_photo::TEXT,
                    jsonb_build_object('author', v_owner, 'caption', v_caption));
  RETURN QUERY SELECT v_url;
END;
$$;

CREATE FUNCTION admin_delete_comment(p_actor UUID, p_comment UUID)
RETURNS TABLE (out_id UUID)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_owner UUID;
  v_body TEXT;
BEGIN
  IF NOT is_admin(p_actor) THEN
    RETURN;
  END IF;
  DELETE FROM photo_comments WHERE id = p_comment RETURNING user_id, content INTO v_owner, v_body;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  PERFORM admin_log(p_actor, 'comment_delete', 'comment', p_comment::TEXT,
                    jsonb_build_object('author', v_owner, 'body', v_body));
  RETURN QUERY SELECT p_comment;
END;
$$;

CREATE FUNCTION admin_list_stories(p_actor UUID)
RETURNS TABLE (
  story_id UUID,
  author_id UUID,
  author_name VARCHAR,
  photo_url VARCHAR,
  caption TEXT,
  created_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  views_count INT
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT s.id, s.user_id, COALESCE(p.name, 'Invitado')::VARCHAR, s.photo_url, s.caption,
         s.created_at, s.expires_at,
         (SELECT COUNT(*)::INT FROM story_views v WHERE v.story_id = s.id)
    FROM stories s
    LEFT JOIN profiles p ON p.user_id = s.user_id
   WHERE is_admin(p_actor) AND s.expires_at > NOW()
   ORDER BY s.created_at DESC
$$;

CREATE FUNCTION admin_delete_story(p_actor UUID, p_story UUID)
RETURNS TABLE (out_url VARCHAR)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_url VARCHAR;
  v_owner UUID;
  v_caption TEXT;
BEGIN
  IF NOT is_admin(p_actor) THEN
    RETURN;
  END IF;
  DELETE FROM stories WHERE id = p_story RETURNING photo_url, user_id, caption INTO v_url, v_owner, v_caption;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  PERFORM admin_log(p_actor, 'story_delete', 'story', p_story::TEXT,
                    jsonb_build_object('author', v_owner, 'caption', v_caption));
  RETURN QUERY SELECT v_url;
END;
$$;

-- ---- Registro de acciones ----

CREATE FUNCTION admin_recent_actions(p_actor UUID, p_limit INT DEFAULT 30)
RETURNS TABLE (
  action_id UUID,
  actor_name VARCHAR,
  action TEXT,
  target_type TEXT,
  target_id TEXT,
  details JSONB,
  created_at TIMESTAMPTZ
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT a.id, COALESCE(p.name, u.email, 'Cuenta eliminada')::VARCHAR, a.action, a.target_type, a.target_id,
         a.details, a.created_at
    FROM admin_actions a
    LEFT JOIN users u ON u.id = a.actor_id
    LEFT JOIN profiles p ON p.user_id = a.actor_id
   WHERE is_admin(p_actor)
   ORDER BY a.created_at DESC
   LIMIT LEAST(GREATEST(p_limit, 1), 100)
$$;

-- ---- Permisos: solo el servidor (service role) ----

REVOKE ALL ON FUNCTION is_admin(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_log(UUID, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_stats(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_list_guests(UUID, TEXT, INT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_upsert_guest(UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_update_guest(UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_delete_guest(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_list_reports(UUID, TEXT, INT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_set_report_status(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_list_photos(UUID, TIMESTAMPTZ, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_list_comments(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_delete_photo(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_delete_comment(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_list_stories(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_delete_story(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_recent_actions(UUID, INT) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION is_admin(UUID) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION admin_log(UUID, TEXT, TEXT, TEXT, JSONB) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION admin_stats(UUID) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION admin_list_guests(UUID, TEXT, INT, INT) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION admin_upsert_guest(UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION admin_update_guest(UUID, UUID, TEXT, TEXT, TEXT) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION admin_delete_guest(UUID, UUID) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION admin_list_reports(UUID, TEXT, INT, TIMESTAMPTZ) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION admin_set_report_status(UUID, UUID, TEXT) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION admin_list_photos(UUID, TIMESTAMPTZ, INT) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION admin_list_comments(UUID, UUID) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION admin_delete_photo(UUID, UUID) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION admin_delete_comment(UUID, UUID) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION admin_list_stories(UUID) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION admin_delete_story(UUID, UUID) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION admin_recent_actions(UUID, INT) FROM anon, authenticated;
    GRANT EXECUTE ON FUNCTION is_admin(UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION admin_log(UUID, TEXT, TEXT, TEXT, JSONB) TO service_role;
    GRANT EXECUTE ON FUNCTION admin_stats(UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION admin_list_guests(UUID, TEXT, INT, INT) TO service_role;
    GRANT EXECUTE ON FUNCTION admin_upsert_guest(UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN) TO service_role;
    GRANT EXECUTE ON FUNCTION admin_update_guest(UUID, UUID, TEXT, TEXT, TEXT) TO service_role;
    GRANT EXECUTE ON FUNCTION admin_delete_guest(UUID, UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION admin_list_reports(UUID, TEXT, INT, TIMESTAMPTZ) TO service_role;
    GRANT EXECUTE ON FUNCTION admin_set_report_status(UUID, UUID, TEXT) TO service_role;
    GRANT EXECUTE ON FUNCTION admin_list_photos(UUID, TIMESTAMPTZ, INT) TO service_role;
    GRANT EXECUTE ON FUNCTION admin_list_comments(UUID, UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION admin_delete_photo(UUID, UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION admin_delete_comment(UUID, UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION admin_list_stories(UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION admin_delete_story(UUID, UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION admin_recent_actions(UUID, INT) TO service_role;
  END IF;
END $$;
