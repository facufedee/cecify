-- Matches y chat. Como discover/swipes: solo se llaman desde el servidor (service role).

ALTER TABLE messages
  ADD CONSTRAINT messages_content_length CHECK (char_length(content) BETWEEN 1 AND 1000);

-- Conversaciones del usuario con el perfil de la otra persona (el contacto se revela
-- recien aca porque ya hay match), ultimo mensaje y no leidos.
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
    LEFT JOIN LATERAL (
      SELECT x.content, x.from_user_id, x.created_at FROM messages x
       WHERE x.conversation_id = c.id AND x.deleted_at IS NULL
       ORDER BY x.created_at DESC LIMIT 1
    ) lm ON TRUE
   WHERE p_user IN (c.user1_id, c.user2_id)
   ORDER BY COALESCE(lm.created_at, m.created_at) DESC
$$;

-- Mensajes de una conversacion (verifica que el usuario participe), del mas viejo al mas nuevo.
-- p_before: pagina hacia atras. p_after: solo los nuevos (polling).
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
       AND m.deleted_at IS NULL
       AND (p_before IS NULL OR m.created_at < p_before)
       AND (p_after IS NULL OR m.created_at > p_after)
     ORDER BY m.created_at DESC
     LIMIT LEAST(GREATEST(p_limit, 1), 100)
  ) t
  ORDER BY t.created_at ASC
$$;

-- Guarda un mensaje si el usuario participa de la conversacion. Sin filas = no participa.
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
   WHERE c.id = p_conversation AND p_from IN (c.user1_id, c.user2_id);

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

-- Marca como leidos los mensajes que le llegaron al usuario en esa conversacion
CREATE OR REPLACE FUNCTION mark_read(p_user UUID, p_conversation UUID)
RETURNS TABLE (marked INT)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_rows INT;
BEGIN
  UPDATE messages
     SET is_read = true, read_at = NOW()
   WHERE conversation_id = p_conversation
     AND to_user_id = p_user
     AND is_read = false;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN QUERY SELECT v_rows;
END;
$$;

REVOKE ALL ON FUNCTION list_conversations(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_messages(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION send_message(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION mark_read(UUID, UUID) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION list_conversations(UUID) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION get_messages(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, INT) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION send_message(UUID, UUID, TEXT) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION mark_read(UUID, UUID) FROM anon, authenticated;
    GRANT EXECUTE ON FUNCTION list_conversations(UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION get_messages(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, INT) TO service_role;
    GRANT EXECUTE ON FUNCTION send_message(UUID, UUID, TEXT) TO service_role;
    GRANT EXECUTE ON FUNCTION mark_read(UUID, UUID) TO service_role;
  END IF;
END $$;
