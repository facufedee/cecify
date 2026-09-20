-- Roles y modos de participacion. Solo se llaman desde el servidor (service role).
--
-- Rol (permisos):     users.role = guest | admin | superadmin
-- Modo (uso):         profiles.wants_match = true  -> Descubrir, matches y chat (ademas del muro)
--                     profiles.wants_match = false -> solo muro e historias
-- Que busca:          profiles.looking_for  (meet = conocer a alguien, dance = pareja de baile)
-- De parte de quien:  profiles.side / guests.side  (bride = Cecilia, groom = Lucas, both = de los dos)

-- El valor nuevo del enum no se usa dentro de esta migracion (solo se compara role::text)
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'superadmin';

ALTER TABLE guests
  ADD COLUMN side TEXT CHECK (side IN ('bride', 'groom', 'both'));

ALTER TABLE profiles
  ADD COLUMN wants_match BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN looking_for TEXT[] NOT NULL DEFAULT '{}' CHECK (looking_for <@ ARRAY['meet', 'dance']),
  ADD COLUMN side TEXT CHECK (side IN ('bride', 'groom', 'both'));

-- Los perfiles que ya existian venian a conocer gente
UPDATE profiles SET looking_for = ARRAY['meet'] WHERE wants_match;

-- ---- Descubrir: solo entre quienes quieren hacer match ----

DROP FUNCTION discover_profiles(UUID, INT, UUID[]);
CREATE FUNCTION discover_profiles(
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
   WHERE p.user_id <> p_user
     AND p.wants_match
     AND p.visibility IS NOT FALSE
     AND p.main_photo_url IS NOT NULL
     AND EXISTS (SELECT 1 FROM profiles me WHERE me.user_id = p_user AND me.wants_match)
     AND NOT (p.id = ANY (p_exclude))
     AND NOT is_blocked(p_user, p.user_id)
     AND NOT EXISTS (
       SELECT 1 FROM swipes s
        WHERE s.from_user_id = p_user AND s.to_user_id = p.user_id
     )
   ORDER BY random()
   LIMIT LEAST(GREATEST(p_limit, 1), 20)
$$;

-- Igual que antes, mas: si alguno de los dos no participa del match no se registra nada
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

  IF is_blocked(p_from, p_to) THEN
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

-- ---- Cambiar el rol de alguien: solo un superadmin ----
-- status: ok | invalid | forbidden | not_found | last_superadmin
CREATE FUNCTION set_user_role(p_actor UUID, p_target UUID, p_role TEXT)
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

  -- Serializa los cambios de rol para no dejar el sistema sin superadmin por dos cambios a la vez
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
  RETURN QUERY SELECT 'ok'::TEXT, p_role;
END;
$$;

REVOKE ALL ON FUNCTION discover_profiles(UUID, INT, UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION set_user_role(UUID, UUID, TEXT) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION discover_profiles(UUID, INT, UUID[]) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION set_user_role(UUID, UUID, TEXT) FROM anon, authenticated;
    GRANT EXECUTE ON FUNCTION discover_profiles(UUID, INT, UUID[]) TO service_role;
    GRANT EXECUTE ON FUNCTION set_user_role(UUID, UUID, TEXT) TO service_role;
  END IF;
END $$;
