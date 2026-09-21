-- Chat: confirmacion de lectura ("Visto"). Solo se llaman desde el servidor (service role).
--
-- Los mensajes se marcan leidos en bloque (todo lo que le llego a quien abre el chat), asi que la lectura
-- es monotona: si el mensaje de las 10:05 esta leido, tambien lo estan los anteriores. Alcanza con saber
-- "hasta cuando leyo": el cliente marca "Visto" en el ultimo mensaje propio anterior a esa marca.

-- Ahora tambien devuelve hasta que mensaje (por fecha) marco como leido; NULL si no habia nada nuevo.
DROP FUNCTION mark_read(UUID, UUID);
CREATE FUNCTION mark_read(p_user UUID, p_conversation UUID)
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
      RETURNING m.created_at
    )
    SELECT COUNT(*)::INT, MAX(upd.created_at) FROM upd;
END;
$$;

-- Hasta cuando leyo la otra persona lo que yo le envie (NULL = nada leido o no participo de la conversacion)
CREATE FUNCTION chat_read_state(p_user UUID, p_conversation UUID)
RETURNS TABLE (out_read_up_to TIMESTAMPTZ)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT MAX(m.created_at)
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
   WHERE m.conversation_id = p_conversation
     AND p_user IN (c.user1_id, c.user2_id)
     AND m.from_user_id = p_user
     AND m.is_read
     AND m.deleted_at IS NULL
$$;

REVOKE ALL ON FUNCTION mark_read(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION chat_read_state(UUID, UUID) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION mark_read(UUID, UUID) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION chat_read_state(UUID, UUID) FROM anon, authenticated;
    GRANT EXECUTE ON FUNCTION mark_read(UUID, UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION chat_read_state(UUID, UUID) TO service_role;
  END IF;
END $$;
