-- Preferencias de match: quien soy, a quien quiero conocer y en que rango de edad.
-- Descubrir filtra en los DOS sentidos: A ve a B solo si B encaja con lo que busca A y A encaja con lo que busca B.
-- Asi nadie ve perfiles que nunca le podrian dar like de vuelta.
--
-- NULL = sin dato (perfiles anteriores a esta migracion o de quien solo usa el muro): no filtra por ese lado.
-- Alguien sin genero cargado solo le aparece a quien quiere conocer a todos.

ALTER TABLE profiles
  ADD COLUMN gender TEXT CHECK (gender IN ('woman', 'man', 'nonbinary')),
  ADD COLUMN interested_in TEXT CHECK (interested_in IN ('women', 'men', 'everyone')),
  ADD COLUMN pref_age_min INT CHECK (pref_age_min BETWEEN 18 AND 99),
  ADD COLUMN pref_age_max INT CHECK (pref_age_max BETWEEN 18 AND 99),
  ADD CONSTRAINT profiles_pref_age_order CHECK (pref_age_min IS NULL OR pref_age_max IS NULL OR pref_age_min <= pref_age_max);

-- Quien busca p_interest, ¿quiere conocer a alguien de genero p_gender?
CREATE FUNCTION wants_gender(p_interest TEXT, p_gender TEXT)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT p_interest IS NULL
      OR p_interest = 'everyone'
      OR (p_interest = 'women' AND p_gender = 'woman')
      OR (p_interest = 'men' AND p_gender = 'man')
$$;

-- ¿La edad p_age entra en el rango [p_min, p_max]? (sin rango = cualquiera)
CREATE FUNCTION in_age_range(p_min INT, p_max INT, p_age INT)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT (p_min IS NULL OR p_age >= p_min) AND (p_max IS NULL OR p_age <= p_max)
$$;

-- Misma firma y resultado que la anterior (conserva los permisos); suma el filtro mutuo de preferencias
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

-- upsert_profile suma 4 parametros: hay que borrar la version anterior (si no, quedarian dos)
DROP FUNCTION upsert_profile(UUID, TEXT, INT, TEXT, TEXT, JSONB, JSONB, JSONB, BOOLEAN, BOOLEAN, TEXT[], TEXT);

CREATE FUNCTION upsert_profile(
  p_user UUID,
  p_name TEXT,
  p_age INT,
  p_bio TEXT,
  p_main_photo_url TEXT,
  p_additional_photos JSONB,
  p_interests JSONB,
  p_contact_methods JSONB,
  p_visibility BOOLEAN,
  p_wants_match BOOLEAN,
  p_looking_for TEXT[],
  p_side TEXT,
  p_gender TEXT DEFAULT NULL,
  p_interested_in TEXT DEFAULT NULL,
  p_pref_age_min INT DEFAULT NULL,
  p_pref_age_max INT DEFAULT NULL
)
RETURNS TABLE (out_profile JSONB)
LANGUAGE sql
SET search_path = public
AS $$
  INSERT INTO profiles
    (user_id, name, age, bio, main_photo_url, additional_photos, interests, contact_methods,
     visibility, wants_match, looking_for, side, gender, interested_in, pref_age_min, pref_age_max)
  VALUES
    (p_user, p_name, p_age, p_bio, p_main_photo_url, p_additional_photos, p_interests, p_contact_methods,
     p_visibility, p_wants_match, p_looking_for, p_side, p_gender, p_interested_in, p_pref_age_min, p_pref_age_max)
  ON CONFLICT (user_id) DO UPDATE SET
    name = EXCLUDED.name,
    age = EXCLUDED.age,
    bio = EXCLUDED.bio,
    main_photo_url = EXCLUDED.main_photo_url,
    additional_photos = EXCLUDED.additional_photos,
    interests = EXCLUDED.interests,
    contact_methods = EXCLUDED.contact_methods,
    visibility = EXCLUDED.visibility,
    wants_match = EXCLUDED.wants_match,
    looking_for = EXCLUDED.looking_for,
    side = EXCLUDED.side,
    gender = EXCLUDED.gender,
    interested_in = EXCLUDED.interested_in,
    pref_age_min = EXCLUDED.pref_age_min,
    pref_age_max = EXCLUDED.pref_age_max
  RETURNING to_jsonb(profiles)
$$;

-- ---- Permisos: solo el servidor (service role) ----
REVOKE ALL ON FUNCTION wants_gender(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION in_age_range(INT, INT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION upsert_profile(UUID, TEXT, INT, TEXT, TEXT, JSONB, JSONB, JSONB, BOOLEAN, BOOLEAN, TEXT[], TEXT, TEXT, TEXT, INT, INT) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION wants_gender(TEXT, TEXT) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION in_age_range(INT, INT, INT) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION upsert_profile(UUID, TEXT, INT, TEXT, TEXT, JSONB, JSONB, JSONB, BOOLEAN, BOOLEAN, TEXT[], TEXT, TEXT, TEXT, INT, INT) FROM anon, authenticated;
    GRANT EXECUTE ON FUNCTION wants_gender(TEXT, TEXT) TO service_role;
    GRANT EXECUTE ON FUNCTION in_age_range(INT, INT, INT) TO service_role;
    GRANT EXECUTE ON FUNCTION upsert_profile(UUID, TEXT, INT, TEXT, TEXT, JSONB, JSONB, JSONB, BOOLEAN, BOOLEAN, TEXT[], TEXT, TEXT, TEXT, INT, INT) TO service_role;
  END IF;
END $$;
