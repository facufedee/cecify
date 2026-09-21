-- Avisos del muro (comentarios) y respuestas a historias. Solo se llaman desde el servidor (service role).

-- ---- Bloqueos: no se puede comentar ni dar me gusta a alguien con quien hay un bloqueo ----
-- Antes add_comment y toggle_photo_like no lo comprobaban: alguien bloqueado que conociera el id de una foto
-- podia seguir comentandola (y, con avisos push, molestando).

-- Ahora devuelve tambien el dueno de la foto (para avisarle). Sin filas = la foto no existe o hay un bloqueo.
DROP FUNCTION add_comment(UUID, UUID, TEXT);
CREATE FUNCTION add_comment(p_user UUID, p_photo UUID, p_content TEXT)
RETURNS TABLE (comment_id UUID, created_at TIMESTAMPTZ, photo_owner UUID)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_owner UUID;
BEGIN
  SELECT ph.user_id INTO v_owner FROM photos ph WHERE ph.id = p_photo;
  IF v_owner IS NULL OR is_blocked(p_user, v_owner) THEN
    RETURN;
  END IF;
  RETURN QUERY
    INSERT INTO photo_comments (photo_id, user_id, content)
    VALUES (p_photo, p_user, BTRIM(p_content))
    RETURNING id, photo_comments.created_at, v_owner;
END;
$$;

CREATE OR REPLACE FUNCTION toggle_photo_like(p_user UUID, p_photo UUID)
RETURNS TABLE (liked BOOLEAN, total INT, photo_owner UUID)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_owner UUID;
  v_total INT;
  v_removed INT;
BEGIN
  SELECT user_id INTO v_owner FROM photos WHERE id = p_photo FOR UPDATE;
  IF v_owner IS NULL OR is_blocked(p_user, v_owner) THEN
    RETURN;
  END IF;

  DELETE FROM photo_likes WHERE photo_id = p_photo AND user_id = p_user;
  GET DIAGNOSTICS v_removed = ROW_COUNT;

  IF v_removed > 0 THEN
    UPDATE photos SET likes_count = GREATEST(COALESCE(likes_count, 0) - 1, 0)
     WHERE id = p_photo RETURNING likes_count INTO v_total;
    RETURN QUERY SELECT FALSE, v_total, v_owner;
  ELSE
    INSERT INTO photo_likes (photo_id, user_id) VALUES (p_photo, p_user);
    UPDATE photos SET likes_count = COALESCE(likes_count, 0) + 1
     WHERE id = p_photo RETURNING likes_count INTO v_total;
    RETURN QUERY SELECT TRUE, v_total, v_owner;
  END IF;
END;
$$;

-- ---- Respuestas a historias ----
-- Son privadas: solo las ve quien publico la historia (como los mensajes directos de Instagram).

CREATE TABLE story_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  from_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 150),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_story_replies_story ON story_replies (story_id, created_at);
CREATE INDEX idx_story_replies_from ON story_replies (from_user_id);
ALTER TABLE story_replies ENABLE ROW LEVEL SECURITY;

-- Sin filas = la historia no existe o ya vencio, es propia, o hay un bloqueo
CREATE FUNCTION add_story_reply(p_user UUID, p_story UUID, p_content TEXT)
RETURNS TABLE (out_id UUID, out_owner UUID)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_owner UUID;
BEGIN
  SELECT s.user_id INTO v_owner FROM stories s WHERE s.id = p_story AND s.expires_at > NOW();
  IF v_owner IS NULL OR v_owner = p_user OR is_blocked(p_user, v_owner) THEN
    RETURN;
  END IF;
  RETURN QUERY
    INSERT INTO story_replies (story_id, from_user_id, content)
    VALUES (p_story, p_user, BTRIM(p_content))
    RETURNING id, v_owner;
END;
$$;

-- Solo las ve el autor de la historia (a otra persona no le devuelve nada), sin las de quienes bloqueo
CREATE FUNCTION list_story_replies(p_user UUID, p_story UUID)
RETURNS TABLE (
  reply_id UUID,
  from_id UUID,
  from_name VARCHAR,
  from_photo VARCHAR,
  content TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT r.id, r.from_user_id, COALESCE(p.name, 'Invitado')::VARCHAR, p.main_photo_url, r.content, r.created_at
    FROM story_replies r
    JOIN stories s ON s.id = r.story_id
    LEFT JOIN profiles p ON p.user_id = r.from_user_id
   WHERE r.story_id = p_story
     AND s.user_id = p_user
     AND NOT is_blocked(p_user, r.from_user_id)
   ORDER BY r.created_at ASC
$$;

REVOKE ALL ON FUNCTION add_comment(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION add_story_reply(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION list_story_replies(UUID, UUID) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION add_comment(UUID, UUID, TEXT) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION add_story_reply(UUID, UUID, TEXT) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION list_story_replies(UUID, UUID) FROM anon, authenticated;
    GRANT EXECUTE ON FUNCTION add_comment(UUID, UUID, TEXT) TO service_role;
    GRANT EXECUTE ON FUNCTION add_story_reply(UUID, UUID, TEXT) TO service_role;
    GRANT EXECUTE ON FUNCTION list_story_replies(UUID, UUID) TO service_role;
  END IF;
END $$;
