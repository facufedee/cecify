-- Discover: candidatos y registro de swipes/matches.
-- Solo se ejecutan desde el servidor con el service role (ver REVOKE al final).

-- Perfiles que el usuario todavia no swipeo. Nunca expone contact_methods ni user_id.
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
     AND NOT EXISTS (
       SELECT 1 FROM swipes s
        WHERE s.from_user_id = p_user AND s.to_user_id = p.user_id
     )
   ORDER BY random()
   LIMIT LEAST(GREATEST(p_limit, 1), 20)
$$;

-- Registra un swipe; si es like y el otro ya te dio like, crea match + conversacion.
-- El lock por par evita que dos likes simultaneos se "crucen" sin verse (write skew).
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

-- Supabase da EXECUTE a anon/authenticated por defecto: sin esto, cualquiera con la
-- clave publishable podria falsear swipes o listar perfiles. Guardado para la base local.
REVOKE ALL ON FUNCTION discover_profiles(UUID, INT, UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION record_swipe(UUID, UUID, swipe_action) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION discover_profiles(UUID, INT, UUID[]) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION record_swipe(UUID, UUID, swipe_action) FROM anon, authenticated;
    GRANT EXECUTE ON FUNCTION discover_profiles(UUID, INT, UUID[]) TO service_role;
    GRANT EXECUTE ON FUNCTION record_swipe(UUID, UUID, swipe_action) TO service_role;
  END IF;
END $$;
