-- Muro de fotos: feed, me gusta, comentarios. Solo se llaman desde el servidor (service role).

CREATE TABLE photo_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  photo_id UUID NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 300),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_photo_comments_photo ON photo_comments (photo_id, created_at);
CREATE INDEX idx_photos_created ON photos (created_at DESC);
CREATE INDEX idx_photos_user_created ON photos (user_id, created_at DESC);

ALTER TABLE photo_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE photos ADD CONSTRAINT photos_caption_length
  CHECK (caption IS NULL OR char_length(caption) <= 300);
ALTER TABLE photos ADD CONSTRAINT photos_likes_nonnegative CHECK (likes_count >= 0);

-- Feed (mas nuevas primero). p_author filtra por autor; p_photo trae una sola foto.
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
   ORDER BY ph.created_at DESC
   LIMIT LEAST(GREATEST(p_limit, 1), 60)
$$;

CREATE OR REPLACE FUNCTION create_photo(p_user UUID, p_url TEXT, p_caption TEXT)
RETURNS TABLE (new_photo_id UUID)
LANGUAGE sql
SET search_path = public
AS $$
  INSERT INTO photos (user_id, photo_url, caption)
  VALUES (p_user, p_url, NULLIF(BTRIM(p_caption), ''))
  RETURNING id
$$;

-- Solo el autor puede borrar. Devuelve el id borrado (sin filas = no existe o no es tuya).
CREATE OR REPLACE FUNCTION delete_photo(p_user UUID, p_photo UUID)
RETURNS TABLE (deleted_id UUID, deleted_url VARCHAR)
LANGUAGE sql
SET search_path = public
AS $$
  DELETE FROM photos WHERE id = p_photo AND user_id = p_user
  RETURNING id, photo_url
$$;

-- Me gusta / quitar me gusta de forma atomica (bloquea la foto para mantener likes_count exacto)
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
  IF v_owner IS NULL THEN
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

CREATE OR REPLACE FUNCTION list_comments(p_photo UUID, p_limit INT DEFAULT 100)
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
   ORDER BY c.created_at ASC
   LIMIT LEAST(GREATEST(p_limit, 1), 200)
$$;

-- Sin filas = la foto no existe
CREATE OR REPLACE FUNCTION add_comment(p_user UUID, p_photo UUID, p_content TEXT)
RETURNS TABLE (comment_id UUID, created_at TIMESTAMPTZ)
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM photos WHERE id = p_photo) THEN
    RETURN;
  END IF;
  RETURN QUERY
    INSERT INTO photo_comments (photo_id, user_id, content)
    VALUES (p_photo, p_user, BTRIM(p_content))
    RETURNING id, photo_comments.created_at;
END;
$$;

REVOKE ALL ON FUNCTION list_photos(UUID, TIMESTAMPTZ, UUID, INT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_photo(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION delete_photo(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION toggle_photo_like(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION list_comments(UUID, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION add_comment(UUID, UUID, TEXT) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION list_photos(UUID, TIMESTAMPTZ, UUID, INT, UUID) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION create_photo(UUID, TEXT, TEXT) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION delete_photo(UUID, UUID) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION toggle_photo_like(UUID, UUID) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION list_comments(UUID, INT) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION add_comment(UUID, UUID, TEXT) FROM anon, authenticated;
    GRANT EXECUTE ON FUNCTION list_photos(UUID, TIMESTAMPTZ, UUID, INT, UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION create_photo(UUID, TEXT, TEXT) TO service_role;
    GRANT EXECUTE ON FUNCTION delete_photo(UUID, UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION toggle_photo_like(UUID, UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION list_comments(UUID, INT) TO service_role;
    GRANT EXECUTE ON FUNCTION add_comment(UUID, UUID, TEXT) TO service_role;
  END IF;
END $$;
