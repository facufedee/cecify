-- Seguridad: bloquear, reportar y deshacer match. Solo se llaman desde el servidor (service role).

CREATE TABLE blocks (
  blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
CREATE INDEX idx_blocks_blocked ON blocks (blocked_id);

CREATE TYPE report_type AS ENUM ('profile', 'photo', 'comment', 'story', 'chat');
CREATE TYPE report_reason AS ENUM ('inappropriate', 'harassment', 'spam', 'fake', 'other');
CREATE TYPE report_status AS ENUM ('open', 'reviewed', 'dismissed');

-- `context` guarda una copia de lo reportado (mensajes, foto, texto) tomada al reportar:
-- el admin la ve aunque despues se borre el original.
CREATE TABLE reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reported_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type report_type NOT NULL,
  target_id UUID,
  reason report_reason NOT NULL,
  details TEXT CHECK (details IS NULL OR char_length(details) <= 300),
  context JSONB,
  status report_status NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  CHECK (reporter_id <> reported_user_id)
);
CREATE INDEX idx_reports_status ON reports (status, created_at DESC);
CREATE INDEX idx_reports_reported ON reports (reported_user_id);

ALTER TABLE blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

-- Hay bloqueo en cualquiera de los dos sentidos
CREATE OR REPLACE FUNCTION is_blocked(p_a UUID, p_b UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM blocks
     WHERE (blocker_id = p_a AND blocked_id = p_b) OR (blocker_id = p_b AND blocked_id = p_a)
  )
$$;

-- Version en forma de tabla para llamarla desde el servidor (rpc devuelve filas de forma uniforme)
CREATE OR REPLACE FUNCTION blocked_between(p_a UUID, p_b UUID)
RETURNS TABLE (is_blocked BOOLEAN)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT public.is_blocked(p_a, p_b)
$$;

-- Bloquea y deshace el match (si lo habia). Los swipes quedan: no se pueden volver a emparejar.
CREATE OR REPLACE FUNCTION block_user(p_blocker UUID, p_blocked UUID)
RETURNS TABLE (ok BOOLEAN)
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF p_blocker = p_blocked THEN
    RAISE EXCEPTION 'No podes bloquearte a vos mismo';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_blocked) THEN
    RETURN QUERY SELECT FALSE;
    RETURN;
  END IF;

  INSERT INTO blocks (blocker_id, blocked_id) VALUES (p_blocker, p_blocked) ON CONFLICT DO NOTHING;
  DELETE FROM matches
   WHERE LEAST(user1_id, user2_id) = LEAST(p_blocker, p_blocked)
     AND GREATEST(user1_id, user2_id) = GREATEST(p_blocker, p_blocked);
  RETURN QUERY SELECT TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION unblock_user(p_blocker UUID, p_blocked UUID)
RETURNS TABLE (ok BOOLEAN)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_rows INT;
BEGIN
  DELETE FROM blocks WHERE blocker_id = p_blocker AND blocked_id = p_blocked;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN QUERY SELECT v_rows > 0;
END;
$$;

CREATE OR REPLACE FUNCTION list_blocked(p_user UUID)
RETURNS TABLE (blocked_user UUID, blocked_name VARCHAR, blocked_photo VARCHAR, blocked_at TIMESTAMPTZ)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT b.blocked_id, COALESCE(p.name, 'Invitado')::VARCHAR, p.main_photo_url, b.created_at
    FROM blocks b
    LEFT JOIN profiles p ON p.user_id = b.blocked_id
   WHERE b.blocker_id = p_user
   ORDER BY b.created_at DESC
$$;

-- Deshace el match (y con el la conversacion). Los swipes quedan: no vuelven a aparecer en Descubrir.
CREATE OR REPLACE FUNCTION unmatch(p_user UUID, p_conversation UUID)
RETURNS TABLE (ok BOOLEAN)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_rows INT;
BEGIN
  DELETE FROM matches
   WHERE id = (
     SELECT c.match_id FROM conversations c
      WHERE c.id = p_conversation AND p_user IN (c.user1_id, c.user2_id)
   );
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN QUERY SELECT v_rows > 0;
END;
$$;

-- Sin filas = el reportado no existe
CREATE OR REPLACE FUNCTION create_report(
  p_reporter UUID,
  p_reported UUID,
  p_type report_type,
  p_target UUID,
  p_reason report_reason,
  p_details TEXT,
  p_context JSONB
)
RETURNS TABLE (new_report_id UUID)
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF p_reporter = p_reported THEN
    RAISE EXCEPTION 'No podes reportarte a vos mismo';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_reported) THEN
    RETURN;
  END IF;
  RETURN QUERY
    INSERT INTO reports (reporter_id, reported_user_id, type, target_id, reason, details, context)
    VALUES (p_reporter, p_reported, p_type, p_target, p_reason, NULLIF(BTRIM(p_details), ''), p_context)
    RETURNING id;
END;
$$;

-- ---- Filtros de bloqueo en lo que ya existia (mismas firmas, mismos resultados) ----

CREATE OR REPLACE FUNCTION discover_profiles(
  p_user UUID,
  p_limit INT DEFAULT 10,
  p_exclude UUID[] DEFAULT '{}'
)
RETURNS TABLE (
  id UUID,
  name VARCHAR,
  age INT,
  bio TEXT,
  main_photo_url VARCHAR,
  additional_photos JSONB,
  interests JSONB
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT p.id, p.name, p.age, p.bio, p.main_photo_url, p.additional_photos, p.interests
    FROM profiles p
   WHERE p.user_id <> p_user
     AND p.visibility IS NOT FALSE
     AND p.main_photo_url IS NOT NULL
     AND NOT (p.id = ANY (p_exclude))
     AND NOT is_blocked(p_user, p.user_id)
     AND NOT EXISTS (
       SELECT 1 FROM swipes s
        WHERE s.from_user_id = p_user AND s.to_user_id = p.user_id
     )
   ORDER BY random()
   LIMIT LEAST(GREATEST(p_limit, 1), 20)
$$;

CREATE OR REPLACE FUNCTION record_swipe(
  p_from UUID,
  p_to UUID,
  p_action swipe_action
)
RETURNS TABLE (matched BOOLEAN, match_row_id UUID, was_duplicate BOOLEAN)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_low UUID := LEAST(p_from, p_to);
  v_high UUID := GREATEST(p_from, p_to);
  v_match UUID;
  v_rows INT;
BEGIN
  IF p_from = p_to THEN
    RAISE EXCEPTION 'No podes swipearte a vos mismo';
  END IF;

  -- Con bloqueo no se registra nada ni se crea match
  IF is_blocked(p_from, p_to) THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, TRUE;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_low::text || v_high::text, 0));

  INSERT INTO swipes (from_user_id, to_user_id, action)
  VALUES (p_from, p_to, p_action)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, TRUE;
    RETURN;
  END IF;

  IF p_action = 'like' AND EXISTS (
    SELECT 1 FROM swipes
     WHERE from_user_id = p_to AND to_user_id = p_from AND action = 'like'
  ) THEN
    INSERT INTO matches (user1_id, user2_id) VALUES (v_low, v_high)
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_match;

    IF v_match IS NULL THEN
      SELECT m.id INTO v_match FROM matches m
       WHERE LEAST(m.user1_id, m.user2_id) = v_low
         AND GREATEST(m.user1_id, m.user2_id) = v_high;
    ELSE
      INSERT INTO conversations (match_id, user1_id, user2_id)
      VALUES (v_match, v_low, v_high)
      ON CONFLICT DO NOTHING;
    END IF;

    RETURN QUERY SELECT TRUE, v_match, FALSE;
    RETURN;
  END IF;

  RETURN QUERY SELECT FALSE, NULL::UUID, FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION list_photos(
  p_user UUID,
  p_before TIMESTAMPTZ DEFAULT NULL,
  p_author UUID DEFAULT NULL,
  p_limit INT DEFAULT 12,
  p_photo UUID DEFAULT NULL
)
RETURNS TABLE (
  photo_id UUID,
  author_id UUID,
  author_name VARCHAR,
  author_photo VARCHAR,
  photo_url VARCHAR,
  caption TEXT,
  likes_count INT,
  comments_count INT,
  liked_by_me BOOLEAN,
  created_at TIMESTAMPTZ
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT ph.id, ph.user_id, COALESCE(p.name, 'Invitado')::VARCHAR, p.main_photo_url,
         ph.photo_url, ph.caption, COALESCE(ph.likes_count, 0),
         (SELECT COUNT(*)::INT FROM photo_comments c WHERE c.photo_id = ph.id),
         EXISTS (SELECT 1 FROM photo_likes l WHERE l.photo_id = ph.id AND l.user_id = p_user),
         ph.created_at
    FROM photos ph
    LEFT JOIN profiles p ON p.user_id = ph.user_id
   WHERE (p_photo IS NULL OR ph.id = p_photo)
     AND (p_before IS NULL OR ph.created_at < p_before)
     AND (p_author IS NULL OR ph.user_id = p_author)
     AND NOT is_blocked(p_user, ph.user_id)
   ORDER BY ph.created_at DESC
   LIMIT LEAST(GREATEST(p_limit, 1), 60)
$$;

CREATE OR REPLACE FUNCTION list_stories(p_user UUID, p_author UUID)
RETURNS TABLE (
  story_id UUID,
  photo_url VARCHAR,
  caption TEXT,
  created_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  seen_by_me BOOLEAN,
  views_count INT
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT s.id, s.photo_url, s.caption, s.created_at, s.expires_at,
         (s.user_id = p_user OR EXISTS (
           SELECT 1 FROM story_views v WHERE v.story_id = s.id AND v.viewer_id = p_user
         )),
         CASE WHEN s.user_id = p_user
              THEN (SELECT COUNT(*)::INT FROM story_views v WHERE v.story_id = s.id)
              ELSE NULL END
    FROM stories s
   WHERE s.user_id = p_author AND s.expires_at > NOW()
     AND NOT is_blocked(p_user, p_author)
   ORDER BY s.created_at ASC
$$;

CREATE OR REPLACE FUNCTION list_story_rings(p_user UUID)
RETURNS TABLE (
  author_id UUID,
  author_name VARCHAR,
  author_photo VARCHAR,
  stories_count INT,
  latest_at TIMESTAMPTZ,
  has_unseen BOOLEAN
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT t.author_id, t.author_name, t.author_photo, t.stories_count, t.latest_at, t.has_unseen
    FROM (
      SELECT s.user_id AS author_id,
             COALESCE(p.name, 'Invitado')::VARCHAR AS author_name,
             p.main_photo_url AS author_photo,
             COUNT(*)::INT AS stories_count,
             MAX(s.created_at) AS latest_at,
             BOOL_OR(s.user_id <> p_user AND NOT EXISTS (
               SELECT 1 FROM story_views v WHERE v.story_id = s.id AND v.viewer_id = p_user
             )) AS has_unseen
        FROM stories s
        LEFT JOIN profiles p ON p.user_id = s.user_id
       WHERE s.expires_at > NOW()
         AND NOT is_blocked(p_user, s.user_id)
       GROUP BY s.user_id, p.name, p.main_photo_url
    ) t
   ORDER BY (t.author_id = p_user) DESC, t.has_unseen DESC, t.latest_at DESC
$$;

-- list_comments pasa a recibir quien mira, para ocultar los comentarios de bloqueados
DROP FUNCTION list_comments(UUID, INT);
CREATE FUNCTION list_comments(p_viewer UUID, p_photo UUID, p_limit INT DEFAULT 100)
RETURNS TABLE (
  comment_id UUID,
  author_id UUID,
  author_name VARCHAR,
  author_photo VARCHAR,
  body TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT c.id, c.user_id, COALESCE(p.name, 'Invitado')::VARCHAR, p.main_photo_url, c.content, c.created_at
    FROM photo_comments c
    LEFT JOIN profiles p ON p.user_id = c.user_id
   WHERE c.photo_id = p_photo
     AND NOT is_blocked(p_viewer, c.user_id)
   ORDER BY c.created_at ASC
   LIMIT LEAST(GREATEST(p_limit, 1), 200)
$$;

REVOKE ALL ON FUNCTION is_blocked(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION blocked_between(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION block_user(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION unblock_user(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION list_blocked(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION unmatch(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_report(UUID, UUID, report_type, UUID, report_reason, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION list_comments(UUID, UUID, INT) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION is_blocked(UUID, UUID) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION blocked_between(UUID, UUID) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION block_user(UUID, UUID) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION unblock_user(UUID, UUID) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION list_blocked(UUID) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION unmatch(UUID, UUID) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION create_report(UUID, UUID, report_type, UUID, report_reason, TEXT, JSONB) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION list_comments(UUID, UUID, INT) FROM anon, authenticated;
    GRANT EXECUTE ON FUNCTION is_blocked(UUID, UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION blocked_between(UUID, UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION block_user(UUID, UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION unblock_user(UUID, UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION list_blocked(UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION unmatch(UUID, UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION create_report(UUID, UUID, report_type, UUID, report_reason, TEXT, JSONB) TO service_role;
    GRANT EXECUTE ON FUNCTION list_comments(UUID, UUID, INT) TO service_role;
  END IF;
END $$;
