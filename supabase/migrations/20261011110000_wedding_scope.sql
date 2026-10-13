-- Aislamiento entre casamientos: cada persona solo ve y toca lo de su casamiento.
--
-- Fotos, historias, chats, matches, bloqueos y reportes no tienen wedding_id: quedan aislados por el casamiento de
-- sus usuarios (users.wedding_id). Aca se redefinen las funciones que ya existian, con las mismas firmas y los
-- mismos resultados:
--   * los listados filtran por el casamiento de quien consulta,
--   * las acciones entre dos personas responden como "no existe" si no comparten casamiento,
--   * el panel (admin/superadmin) solo ve, modera y cambia roles dentro de su casamiento.
-- Las funciones nuevas o recreadas (same_wedding, get_author, get_profile_owner) necesitan sus permisos explicitos;
-- CREATE OR REPLACE conserva los de las demas.
--
-- Los joins con users van por su clave primaria, y el UNIQUE (wedding_id, email) ya sirve para filtrar usuarios por
-- casamiento: no hace falta ningun indice nuevo.

-- ---- Ayuda ----

-- TRUE si las dos personas existen y son del mismo casamiento
CREATE FUNCTION same_wedding(p_a UUID, p_b UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT COALESCE((SELECT a.wedding_id = b.wedding_id FROM users a, users b WHERE a.id = p_a AND b.id = p_b), FALSE)
$$;

-- ---- Descubrir ----

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
  interests JSONB,
  side TEXT,
  looking_for TEXT[]
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT p.id, p.name, p.age, p.bio, p.main_photo_url, p.additional_photos, p.interests,
         p.side, p.looking_for
    FROM profiles p
    JOIN profiles me ON me.user_id = p_user AND me.wants_match
    JOIN users mu ON mu.id = p_user
    JOIN users pu ON pu.id = p.user_id AND pu.wedding_id = mu.wedding_id
   WHERE p.user_id <> p_user
     AND p.wants_match
     AND p.visibility IS NOT FALSE
     AND p.main_photo_url IS NOT NULL
     AND NOT (p.id = ANY (p_exclude))
     AND NOT is_blocked(p_user, p.user_id)
     AND NOT EXISTS (
       SELECT 1 FROM swipes s
        WHERE s.from_user_id = p_user AND s.to_user_id = p.user_id
     )
     -- Lo que busco yo y lo que busca la otra persona
     AND wants_gender(me.interested_in, p.gender)
     AND wants_gender(p.interested_in, me.gender)
     AND in_age_range(me.pref_age_min, me.pref_age_max, p.age)
     AND in_age_range(p.pref_age_min, p.pref_age_max, me.age)
   ORDER BY random()
   LIMIT LEAST(GREATEST(p_limit, 1), 20)
$$;

-- Con alguien de otro casamiento no se registra nada (misma respuesta que con un bloqueo)
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

  IF NOT same_wedding(p_from, p_to) OR is_blocked(p_from, p_to) THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, TRUE;
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM profiles WHERE user_id = p_from AND wants_match)
     OR NOT EXISTS (SELECT 1 FROM profiles WHERE user_id = p_to AND wants_match) THEN
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

CREATE OR REPLACE FUNCTION skipped_count(p_user UUID)
RETURNS TABLE (out_count INT)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT COUNT(*)::INT
    FROM swipes s
    JOIN profiles p ON p.user_id = s.to_user_id
    JOIN users mu ON mu.id = p_user
    JOIN users tu ON tu.id = s.to_user_id AND tu.wedding_id = mu.wedding_id
   WHERE s.from_user_id = p_user
     AND s.action = 'skip'
     AND p.wants_match
     AND p.visibility IS NOT FALSE
     AND NOT is_blocked(p_user, s.to_user_id)
$$;

-- ---- Perfil y datos de otra persona ----

-- Los datos de la lista de invitados salen de SU casamiento (el mismo email puede estar en dos listas)
CREATE OR REPLACE FUNCTION get_user_context(p_user UUID)
RETURNS TABLE (
  out_email TEXT,
  out_role TEXT,
  out_guest_name TEXT,
  out_guest_side TEXT,
  out_matches_count INT,
  out_profile JSONB
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT u.email::TEXT,
         u.role::TEXT,
         g.name::TEXT,
         g.side,
         (SELECT COUNT(*)::INT FROM matches m WHERE m.user1_id = u.id OR m.user2_id = u.id),
         (SELECT to_jsonb(p) FROM profiles p WHERE p.user_id = u.id)
    FROM users u
    LEFT JOIN guests g ON g.wedding_id = u.wedding_id AND g.email = u.email
   WHERE u.id = p_user
$$;

-- Suman quien mira (p_viewer, al final y opcional): con p_viewer, alguien de otro casamiento responde como si no
-- existiera. Sin p_viewer se comportan como antes (el servidor todavia no lo manda).
DROP FUNCTION get_author(UUID);
CREATE FUNCTION get_author(p_user UUID, p_viewer UUID DEFAULT NULL)
RETURNS TABLE (out_name TEXT, out_photo TEXT, out_bio TEXT)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT p.name::TEXT, p.main_photo_url::TEXT, p.bio FROM profiles p
   WHERE p.user_id = p_user
     AND (p_viewer IS NULL OR same_wedding(p_viewer, p_user))
$$;

DROP FUNCTION get_profile_owner(UUID);
CREATE FUNCTION get_profile_owner(p_profile UUID, p_viewer UUID DEFAULT NULL)
RETURNS TABLE (out_user UUID, out_name TEXT, out_photo TEXT)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT p.user_id, p.name::TEXT, p.main_photo_url::TEXT FROM profiles p
   WHERE p.id = p_profile
     AND (p_viewer IS NULL OR same_wedding(p_viewer, p.user_id))
$$;

-- ---- Chat ----
-- Las conversaciones solo nacen de un match (record_swipe, ya acotado). Igual se comprueba que las dos personas
-- compartan casamiento: una conversacion entre casamientos no se ve ni se puede usar.

CREATE OR REPLACE FUNCTION list_conversations(p_user UUID)
RETURNS TABLE (
  conversation_id UUID,
  match_id UUID,
  matched_at TIMESTAMPTZ,
  other_user_id UUID,
  other_profile_id UUID,
  other_name VARCHAR,
  other_age INT,
  other_photo VARCHAR,
  other_contact JSONB,
  last_content TEXT,
  last_from UUID,
  last_at TIMESTAMPTZ,
  unread_count INT
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT c.id, c.match_id, m.created_at,
         p.user_id, p.id, p.name, p.age, p.main_photo_url, p.contact_methods,
         lm.content, lm.from_user_id, lm.created_at,
         (SELECT COUNT(*)::INT FROM messages x
           WHERE x.conversation_id = c.id AND x.to_user_id = p_user
             AND x.is_read = false AND x.deleted_at IS NULL)
    FROM conversations c
    JOIN matches m ON m.id = c.match_id
    JOIN profiles p ON p.user_id = CASE WHEN c.user1_id = p_user THEN c.user2_id ELSE c.user1_id END
    JOIN users mu ON mu.id = p_user
    JOIN users ou ON ou.id = p.user_id AND ou.wedding_id = mu.wedding_id
    LEFT JOIN LATERAL (
      SELECT x.content, x.from_user_id, x.created_at FROM messages x
       WHERE x.conversation_id = c.id AND x.deleted_at IS NULL
       ORDER BY x.created_at DESC LIMIT 1
    ) lm ON TRUE
   WHERE p_user IN (c.user1_id, c.user2_id)
   ORDER BY COALESCE(lm.created_at, m.created_at) DESC
$$;

CREATE OR REPLACE FUNCTION get_messages(
  p_user UUID,
  p_conversation UUID,
  p_before TIMESTAMPTZ DEFAULT NULL,
  p_after TIMESTAMPTZ DEFAULT NULL,
  p_limit INT DEFAULT 50
)
RETURNS TABLE (
  msg_id UUID,
  msg_from UUID,
  msg_content TEXT,
  msg_is_read BOOLEAN,
  msg_created_at TIMESTAMPTZ
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT t.id, t.from_user_id, t.content, t.is_read, t.created_at FROM (
    SELECT m.id, m.from_user_id, m.content, m.is_read, m.created_at
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
     WHERE m.conversation_id = p_conversation
       AND p_user IN (c.user1_id, c.user2_id)
       AND same_wedding(c.user1_id, c.user2_id)
       AND m.deleted_at IS NULL
       AND (p_before IS NULL OR m.created_at < p_before)
       AND (p_after IS NULL OR m.created_at > p_after)
     ORDER BY m.created_at DESC
     LIMIT LEAST(GREATEST(p_limit, 1), 100)
  ) t
  ORDER BY t.created_at ASC
$$;

-- Sin filas = no participa de la conversacion (o la otra persona es de otro casamiento)
CREATE OR REPLACE FUNCTION send_message(p_from UUID, p_conversation UUID, p_content TEXT)
RETURNS TABLE (
  msg_id UUID,
  msg_conversation_id UUID,
  msg_from UUID,
  msg_to UUID,
  msg_content TEXT,
  msg_created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_to UUID;
  v_id UUID;
BEGIN
  SELECT CASE WHEN c.user1_id = p_from THEN c.user2_id ELSE c.user1_id END
    INTO v_to
    FROM conversations c
   WHERE c.id = p_conversation AND p_from IN (c.user1_id, c.user2_id)
     AND same_wedding(c.user1_id, c.user2_id);

  IF v_to IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO messages (conversation_id, from_user_id, to_user_id, content)
  VALUES (p_conversation, p_from, v_to, p_content)
  RETURNING messages.id INTO v_id;

  UPDATE conversations
     SET last_message_id = v_id, last_message_at = NOW()
   WHERE conversations.id = p_conversation;

  RETURN QUERY
    SELECT m.id, m.conversation_id, m.from_user_id, m.to_user_id, m.content, m.created_at
      FROM messages m WHERE m.id = v_id;
END;
$$;

CREATE OR REPLACE FUNCTION mark_read(p_user UUID, p_conversation UUID)
RETURNS TABLE (marked INT, read_up_to TIMESTAMPTZ)
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
    WITH upd AS (
      UPDATE messages m
         SET is_read = true, read_at = NOW()
       WHERE m.conversation_id = p_conversation
         AND m.to_user_id = p_user
         AND m.is_read = false
         AND m.deleted_at IS NULL
         AND EXISTS (
           SELECT 1 FROM conversations c
            WHERE c.id = p_conversation AND p_user IN (c.user1_id, c.user2_id)
              AND same_wedding(c.user1_id, c.user2_id)
         )
      RETURNING m.created_at
    )
    SELECT COUNT(*)::INT, MAX(upd.created_at) FROM upd;
END;
$$;

CREATE OR REPLACE FUNCTION chat_read_state(p_user UUID, p_conversation UUID)
RETURNS TABLE (out_read_up_to TIMESTAMPTZ)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT MAX(m.created_at)
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
   WHERE m.conversation_id = p_conversation
     AND p_user IN (c.user1_id, c.user2_id)
     AND same_wedding(c.user1_id, c.user2_id)
     AND m.from_user_id = p_user
     AND m.is_read
     AND m.deleted_at IS NULL
$$;

CREATE OR REPLACE FUNCTION unread_total(p_user UUID)
RETURNS TABLE (out_count INT)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT COUNT(*)::INT FROM messages m
    JOIN users mu ON mu.id = p_user
    JOIN users fu ON fu.id = m.from_user_id AND fu.wedding_id = mu.wedding_id
   WHERE m.to_user_id = p_user AND m.is_read = FALSE AND m.deleted_at IS NULL
$$;

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
        AND same_wedding(c.user1_id, c.user2_id)
   );
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN QUERY SELECT v_rows > 0;
END;
$$;

-- ---- Muro ----

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
    JOIN users mu ON mu.id = p_user
    JOIN users au ON au.id = ph.user_id AND au.wedding_id = mu.wedding_id
    LEFT JOIN profiles p ON p.user_id = ph.user_id
   WHERE (p_photo IS NULL OR ph.id = p_photo)
     AND (p_before IS NULL OR ph.created_at < p_before)
     AND (p_author IS NULL OR ph.user_id = p_author)
     AND NOT is_blocked(p_user, ph.user_id)
   ORDER BY ph.created_at DESC
   LIMIT LEAST(GREATEST(p_limit, 1), 60)
$$;

-- Solo si la foto y quien comento son del casamiento de quien mira
CREATE OR REPLACE FUNCTION list_comments(p_viewer UUID, p_photo UUID, p_limit INT DEFAULT 100)
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
    JOIN photos ph ON ph.id = c.photo_id
    JOIN users mu ON mu.id = p_viewer
    JOIN users ou ON ou.id = ph.user_id AND ou.wedding_id = mu.wedding_id
    JOIN users cu ON cu.id = c.user_id AND cu.wedding_id = mu.wedding_id
    LEFT JOIN profiles p ON p.user_id = c.user_id
   WHERE c.photo_id = p_photo
     AND NOT is_blocked(p_viewer, c.user_id)
   ORDER BY c.created_at ASC
   LIMIT LEAST(GREATEST(p_limit, 1), 200)
$$;

-- Sin filas = la foto no existe, hay un bloqueo o es de otro casamiento
CREATE OR REPLACE FUNCTION add_comment(p_user UUID, p_photo UUID, p_content TEXT)
RETURNS TABLE (comment_id UUID, created_at TIMESTAMPTZ, photo_owner UUID)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_owner UUID;
BEGIN
  SELECT ph.user_id INTO v_owner FROM photos ph WHERE ph.id = p_photo;
  IF v_owner IS NULL OR NOT same_wedding(p_user, v_owner) OR is_blocked(p_user, v_owner) THEN
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
  IF v_owner IS NULL OR NOT same_wedding(p_user, v_owner) OR is_blocked(p_user, v_owner) THEN
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

-- delete_photo y delete_story no cambian: solo borra el autor.

-- ---- Historias ----

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
        JOIN users mu ON mu.id = p_user
        JOIN users au ON au.id = s.user_id AND au.wedding_id = mu.wedding_id
        LEFT JOIN profiles p ON p.user_id = s.user_id
       WHERE s.expires_at > NOW()
         AND NOT is_blocked(p_user, s.user_id)
       GROUP BY s.user_id, p.name, p.main_photo_url
    ) t
   ORDER BY (t.author_id = p_user) DESC, t.has_unseen DESC, t.latest_at DESC
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
     AND same_wedding(p_user, p_author)
     AND NOT is_blocked(p_user, p_author)
   ORDER BY s.created_at ASC
$$;

-- Una historia de otro casamiento no cuenta como vista
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
     AND same_wedding(p_user, s.user_id)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN QUERY SELECT v_rows > 0;
END;
$$;

-- Quien vio la historia (solo al autor), sin gente de otro casamiento
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
    JOIN users mu ON mu.id = p_user
    JOIN users vu ON vu.id = v.viewer_id AND vu.wedding_id = mu.wedding_id
    LEFT JOIN profiles p ON p.user_id = v.viewer_id
   WHERE v.story_id = p_story
   ORDER BY v.viewed_at DESC
$$;

-- Sin filas = la historia no existe o ya vencio, es propia, hay un bloqueo o es de otro casamiento
CREATE OR REPLACE FUNCTION add_story_reply(p_user UUID, p_story UUID, p_content TEXT)
RETURNS TABLE (out_id UUID, out_owner UUID)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_owner UUID;
BEGIN
  SELECT s.user_id INTO v_owner FROM stories s WHERE s.id = p_story AND s.expires_at > NOW();
  IF v_owner IS NULL OR v_owner = p_user OR NOT same_wedding(p_user, v_owner) OR is_blocked(p_user, v_owner) THEN
    RETURN;
  END IF;
  RETURN QUERY
    INSERT INTO story_replies (story_id, from_user_id, content)
    VALUES (p_story, p_user, BTRIM(p_content))
    RETURNING id, v_owner;
END;
$$;

CREATE OR REPLACE FUNCTION list_story_replies(p_user UUID, p_story UUID)
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
    JOIN users mu ON mu.id = p_user
    JOIN users fu ON fu.id = r.from_user_id AND fu.wedding_id = mu.wedding_id
    LEFT JOIN profiles p ON p.user_id = r.from_user_id
   WHERE r.story_id = p_story
     AND s.user_id = p_user
     AND NOT is_blocked(p_user, r.from_user_id)
   ORDER BY r.created_at ASC
$$;

-- ---- Bloqueos y reportes ----

-- ok = FALSE si la persona no existe o es de otro casamiento
CREATE OR REPLACE FUNCTION block_user(p_blocker UUID, p_blocked UUID)
RETURNS TABLE (ok BOOLEAN)
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF p_blocker = p_blocked THEN
    RAISE EXCEPTION 'No podes bloquearte a vos mismo';
  END IF;
  IF NOT same_wedding(p_blocker, p_blocked) THEN
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
  DELETE FROM blocks
   WHERE blocker_id = p_blocker AND blocked_id = p_blocked
     AND same_wedding(p_blocker, p_blocked);
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
    JOIN users mu ON mu.id = p_user
    JOIN users bu ON bu.id = b.blocked_id AND bu.wedding_id = mu.wedding_id
    LEFT JOIN profiles p ON p.user_id = b.blocked_id
   WHERE b.blocker_id = p_user
   ORDER BY b.created_at DESC
$$;

-- Sin filas = el reportado no existe o es de otro casamiento
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
  IF NOT same_wedding(p_reporter, p_reported) THEN
    RETURN;
  END IF;
  RETURN QUERY
    INSERT INTO reports (reporter_id, reported_user_id, type, target_id, reason, details, context)
    VALUES (p_reporter, p_reported, p_type, p_target, p_reason, NULLIF(BTRIM(p_details), ''), p_context)
    RETURNING id;
END;
$$;

-- ---- Panel: solo su casamiento ----

-- Solo dentro de su casamiento (alguien de otro responde not_found) y cada casamiento conserva al menos un superadmin
CREATE OR REPLACE FUNCTION set_user_role(p_actor UUID, p_target UUID, p_role TEXT)
RETURNS TABLE (status TEXT, new_role TEXT)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_actor TEXT;
  v_wedding UUID;
  v_current TEXT;
BEGIN
  IF p_role IS NULL OR p_role NOT IN ('guest', 'admin', 'superadmin') THEN
    RETURN QUERY SELECT 'invalid'::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('set_user_role', 0));

  SELECT u.role::TEXT, u.wedding_id INTO v_actor, v_wedding FROM users u WHERE u.id = p_actor;
  IF v_actor IS DISTINCT FROM 'superadmin' THEN
    RETURN QUERY SELECT 'forbidden'::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  SELECT u.role::TEXT INTO v_current FROM users u WHERE u.id = p_target AND u.wedding_id = v_wedding;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  IF v_current = 'superadmin' AND p_role <> 'superadmin'
     AND (SELECT COUNT(*) FROM users u WHERE u.wedding_id = v_wedding AND u.role::TEXT = 'superadmin') <= 1 THEN
    RETURN QUERY SELECT 'last_superadmin'::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  UPDATE users SET role = p_role::user_role WHERE id = p_target;
  PERFORM admin_log(p_actor, 'set_role', 'user', p_target::TEXT,
                    jsonb_build_object('from', v_current, 'to', p_role));
  RETURN QUERY SELECT 'ok'::TEXT, p_role;
END;
$$;

-- Metricas de su casamiento. Matches y mensajes cuentan solo los que son entre dos personas del casamiento.
CREATE OR REPLACE FUNCTION admin_stats(p_actor UUID)
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
  WITH me AS (SELECT user_wedding_id(p_actor) AS wedding WHERE is_admin(p_actor)),
       mine AS (SELECT u.id FROM users u JOIN me ON u.wedding_id = me.wedding),
       pr AS (SELECT p.wants_match, p.side FROM profiles p WHERE p.user_id IN (SELECT id FROM mine))
  SELECT (SELECT COUNT(*)::INT FROM guests g WHERE g.wedding_id = me.wedding),
         (SELECT COUNT(*)::INT FROM guests g
           WHERE g.wedding_id = me.wedding
             AND EXISTS (SELECT 1 FROM users u WHERE u.wedding_id = g.wedding_id AND u.email = g.email)),
         (SELECT COUNT(*)::INT FROM pr),
         (SELECT COUNT(*)::INT FROM pr WHERE pr.wants_match),
         (SELECT COUNT(*)::INT FROM pr WHERE NOT pr.wants_match),
         (SELECT COUNT(*)::INT FROM pr WHERE pr.side = 'bride'),
         (SELECT COUNT(*)::INT FROM pr WHERE pr.side = 'groom'),
         (SELECT COUNT(*)::INT FROM pr WHERE pr.side = 'both'),
         (SELECT COUNT(*)::INT FROM pr WHERE pr.side IS NULL),
         (SELECT COUNT(*)::INT FROM matches m
           WHERE m.user1_id IN (SELECT id FROM mine) AND m.user2_id IN (SELECT id FROM mine)),
         (SELECT COUNT(*)::INT FROM messages x
           WHERE x.deleted_at IS NULL
             AND x.from_user_id IN (SELECT id FROM mine) AND x.to_user_id IN (SELECT id FROM mine)),
         (SELECT COUNT(*)::INT FROM photos ph WHERE ph.user_id IN (SELECT id FROM mine)),
         (SELECT COUNT(*)::INT FROM photo_comments c WHERE c.user_id IN (SELECT id FROM mine)),
         (SELECT COUNT(*)::INT FROM stories s WHERE s.expires_at > NOW() AND s.user_id IN (SELECT id FROM mine)),
         (SELECT COUNT(*)::INT FROM reports r WHERE r.status = 'open' AND r.reported_user_id IN (SELECT id FROM mine)),
         (SELECT COUNT(*)::INT FROM blocks b WHERE b.blocker_id IN (SELECT id FROM mine))
    FROM me
$$;

-- Reportes contra gente de su casamiento
CREATE OR REPLACE FUNCTION admin_list_reports(
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
    JOIN users au ON au.id = p_actor AND au.wedding_id = du.wedding_id
   WHERE is_admin(p_actor)
     AND (p_status IS NULL OR r.status::TEXT = p_status)
     AND (p_before IS NULL OR r.created_at < p_before)
   ORDER BY r.created_at DESC
   LIMIT LEAST(GREATEST(p_limit, 1), 100)
$$;

-- Un reporte de otro casamiento responde como uno que no existe (out_ok FALSE)
CREATE OR REPLACE FUNCTION admin_set_report_status(p_actor UUID, p_report UUID, p_status TEXT)
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

  UPDATE reports r
     SET status = p_status::report_status,
         reviewed_at = CASE WHEN p_status = 'open' THEN NULL ELSE NOW() END
   WHERE r.id = p_report AND same_wedding(p_actor, r.reported_user_id);
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows > 0 THEN
    PERFORM admin_log(p_actor, 'report_' || p_status, 'report', p_report::TEXT);
  END IF;
  RETURN QUERY SELECT v_rows > 0;
END;
$$;

CREATE OR REPLACE FUNCTION admin_list_photos(p_actor UUID, p_before TIMESTAMPTZ DEFAULT NULL, p_limit INT DEFAULT 24)
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
    JOIN users au ON au.id = p_actor
    JOIN users ou ON ou.id = ph.user_id AND ou.wedding_id = au.wedding_id
    LEFT JOIN profiles p ON p.user_id = ph.user_id
   WHERE is_admin(p_actor)
     AND (p_before IS NULL OR ph.created_at < p_before)
   ORDER BY ph.created_at DESC
   LIMIT LEAST(GREATEST(p_limit, 1), 60)
$$;

CREATE OR REPLACE FUNCTION admin_list_comments(p_actor UUID, p_photo UUID)
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
    JOIN photos ph ON ph.id = c.photo_id
    LEFT JOIN profiles p ON p.user_id = c.user_id
   WHERE is_admin(p_actor) AND c.photo_id = p_photo
     AND same_wedding(p_actor, ph.user_id)
   ORDER BY c.created_at ASC
$$;

CREATE OR REPLACE FUNCTION admin_list_stories(p_actor UUID)
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
    JOIN users au ON au.id = p_actor
    JOIN users ou ON ou.id = s.user_id AND ou.wedding_id = au.wedding_id
    LEFT JOIN profiles p ON p.user_id = s.user_id
   WHERE is_admin(p_actor) AND s.expires_at > NOW()
   ORDER BY s.created_at DESC
$$;

-- Borrados del panel: contenido de otro casamiento responde como si no existiera (sin filas)
CREATE OR REPLACE FUNCTION admin_delete_photo(p_actor UUID, p_photo UUID)
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
  DELETE FROM photos ph WHERE ph.id = p_photo AND same_wedding(p_actor, ph.user_id)
  RETURNING ph.photo_url, ph.user_id, ph.caption INTO v_url, v_owner, v_caption;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  PERFORM admin_log(p_actor, 'photo_delete', 'photo', p_photo::TEXT,
                    jsonb_build_object('author', v_owner, 'caption', v_caption));
  RETURN QUERY SELECT v_url;
END;
$$;

CREATE OR REPLACE FUNCTION admin_delete_comment(p_actor UUID, p_comment UUID)
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
  DELETE FROM photo_comments c WHERE c.id = p_comment AND same_wedding(p_actor, c.user_id)
  RETURNING c.user_id, c.content INTO v_owner, v_body;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  PERFORM admin_log(p_actor, 'comment_delete', 'comment', p_comment::TEXT,
                    jsonb_build_object('author', v_owner, 'body', v_body));
  RETURN QUERY SELECT p_comment;
END;
$$;

CREATE OR REPLACE FUNCTION admin_delete_story(p_actor UUID, p_story UUID)
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
  DELETE FROM stories s WHERE s.id = p_story AND same_wedding(p_actor, s.user_id)
  RETURNING s.photo_url, s.user_id, s.caption INTO v_url, v_owner, v_caption;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  PERFORM admin_log(p_actor, 'story_delete', 'story', p_story::TEXT,
                    jsonb_build_object('author', v_owner, 'caption', v_caption));
  RETURN QUERY SELECT v_url;
END;
$$;

-- Registro de acciones: solo las de su casamiento (admin_log anota el casamiento de quien la hizo)
CREATE OR REPLACE FUNCTION admin_recent_actions(p_actor UUID, p_limit INT DEFAULT 30)
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
     AND a.wedding_id = user_wedding_id(p_actor)
   ORDER BY a.created_at DESC
   LIMIT LEAST(GREATEST(p_limit, 1), 100)
$$;

-- ---- Permisos: solo el servidor (service role) ----
REVOKE ALL ON FUNCTION same_wedding(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_author(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_profile_owner(UUID, UUID) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION same_wedding(UUID, UUID) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION get_author(UUID, UUID) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION get_profile_owner(UUID, UUID) FROM anon, authenticated;
    GRANT EXECUTE ON FUNCTION same_wedding(UUID, UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION get_author(UUID, UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION get_profile_owner(UUID, UUID) TO service_role;
  END IF;
END $$;
