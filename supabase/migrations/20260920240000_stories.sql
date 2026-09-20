-- Historias: fotos que duran 24 horas. Solo se llaman desde el servidor (service role).

CREATE TABLE stories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  photo_url VARCHAR(500) NOT NULL,
  caption TEXT CHECK (caption IS NULL OR char_length(caption) <= 150),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours')
);

CREATE TABLE story_views (
  story_id UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  viewer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewed_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (story_id, viewer_id)
);

CREATE INDEX idx_stories_user_created ON stories (user_id, created_at);
CREATE INDEX idx_stories_expires ON stories (expires_at);
CREATE INDEX idx_story_views_viewer ON story_views (viewer_id);

ALTER TABLE stories ENABLE ROW LEVEL SECURITY;
ALTER TABLE story_views ENABLE ROW LEVEL SECURITY;

-- Anillos: un renglon por autor con historias activas. Las propias primero, despues las
-- que el usuario todavia no vio, despues las mas recientes.
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
       GROUP BY s.user_id, p.name, p.main_photo_url
    ) t
   ORDER BY (t.author_id = p_user) DESC, t.has_unseen DESC, t.latest_at DESC
$$;

-- Historias activas de un autor, de la mas vieja a la mas nueva. views_count solo para el autor.
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
   ORDER BY s.created_at ASC
$$;

-- Crea la historia y de paso limpia las vencidas hace mas de 2 dias
CREATE OR REPLACE FUNCTION create_story(p_user UUID, p_url TEXT, p_caption TEXT)
RETURNS TABLE (new_story_id UUID)
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  DELETE FROM stories WHERE expires_at < NOW() - INTERVAL '2 days';
  RETURN QUERY
    INSERT INTO stories (user_id, photo_url, caption)
    VALUES (p_user, p_url, NULLIF(BTRIM(p_caption), ''))
    RETURNING id;
END;
$$;

CREATE OR REPLACE FUNCTION delete_story(p_user UUID, p_story UUID)
RETURNS TABLE (deleted_id UUID, deleted_url VARCHAR)
LANGUAGE sql
SET search_path = public
AS $$
  DELETE FROM stories WHERE id = p_story AND user_id = p_user
  RETURNING id, photo_url
$$;

-- Registra que el usuario vio una historia ajena y vigente (idempotente)
CREATE OR REPLACE FUNCTION mark_story_viewed(p_user UUID, p_story UUID)
RETURNS TABLE (marked BOOLEAN)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_rows INT;
BEGIN
  INSERT INTO story_views (story_id, viewer_id)
  SELECT s.id, p_user FROM stories s
   WHERE s.id = p_story AND s.user_id <> p_user AND s.expires_at > NOW()
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN QUERY SELECT v_rows > 0;
END;
$$;

-- Quien vio la historia: solo se le responde al autor
CREATE OR REPLACE FUNCTION list_story_viewers(p_user UUID, p_story UUID)
RETURNS TABLE (
  viewer_id UUID,
  viewer_name VARCHAR,
  viewer_photo VARCHAR,
  viewed_at TIMESTAMPTZ
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT v.viewer_id, COALESCE(p.name, 'Invitado')::VARCHAR, p.main_photo_url, v.viewed_at
    FROM story_views v
    JOIN stories s ON s.id = v.story_id AND s.user_id = p_user
    LEFT JOIN profiles p ON p.user_id = v.viewer_id
   WHERE v.story_id = p_story
   ORDER BY v.viewed_at DESC
$$;

REVOKE ALL ON FUNCTION list_story_rings(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION list_stories(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_story(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION delete_story(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION mark_story_viewed(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION list_story_viewers(UUID, UUID) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION list_story_rings(UUID) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION list_stories(UUID, UUID) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION create_story(UUID, TEXT, TEXT) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION delete_story(UUID, UUID) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION mark_story_viewed(UUID, UUID) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION list_story_viewers(UUID, UUID) FROM anon, authenticated;
    GRANT EXECUTE ON FUNCTION list_story_rings(UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION list_stories(UUID, UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION create_story(UUID, TEXT, TEXT) TO service_role;
    GRANT EXECUTE ON FUNCTION delete_story(UUID, UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION mark_story_viewed(UUID, UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION list_story_viewers(UUID, UUID) TO service_role;
  END IF;
END $$;
