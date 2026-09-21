-- Acceso a datos 100 % por funciones SQL. Hasta ahora quedaban unas pocas consultas directas (login, perfil,
-- Descubrir, avisos) que el servidor escribia dos veces (una para la base local y otra para Supabase). Con estas
-- funciones toda la app entra por el mismo camino. Solo se llaman desde el servidor (service role).

-- ---- Login y usuarios ----

-- Sin filas = el email o el codigo no corresponden a un invitado
CREATE FUNCTION find_guest(p_email TEXT, p_code TEXT)
RETURNS TABLE (out_id UUID)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT g.id FROM guests g WHERE g.email = p_email AND g.access_code = p_code
$$;

-- Crea la cuenta en el primer login; si ya existe no cambia el rol
CREATE FUNCTION upsert_user(p_email TEXT)
RETURNS TABLE (out_id UUID, out_email TEXT, out_role TEXT, out_version INT)
LANGUAGE sql
SET search_path = public
AS $$
  INSERT INTO users (email) VALUES (p_email)
  ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
  RETURNING id, email::TEXT, role::TEXT, session_version
$$;

-- ---- Perfil ----

-- Perfil propio + datos del invitado (para precargar el onboarding) + rol.
-- Sin filas = la cuenta no existe. out_profile es NULL si todavia no tiene perfil.
CREATE FUNCTION get_user_context(p_user UUID)
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
    LEFT JOIN guests g ON g.email = u.email
   WHERE u.id = p_user
$$;

-- Un perfil por usuario: si ya existe, se actualiza
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
  p_side TEXT
)
RETURNS TABLE (out_profile JSONB)
LANGUAGE sql
SET search_path = public
AS $$
  INSERT INTO profiles
    (user_id, name, age, bio, main_photo_url, additional_photos, interests, contact_methods,
     visibility, wants_match, looking_for, side)
  VALUES
    (p_user, p_name, p_age, p_bio, p_main_photo_url, p_additional_photos, p_interests, p_contact_methods,
     p_visibility, p_wants_match, p_looking_for, p_side)
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
    side = EXCLUDED.side
  RETURNING to_jsonb(profiles)
$$;

-- Datos publicos de una persona (cabecera del muro, avisos). Sin filas = no tiene perfil.
CREATE FUNCTION get_author(p_user UUID)
RETURNS TABLE (out_name TEXT, out_photo TEXT, out_bio TEXT)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT p.name::TEXT, p.main_photo_url::TEXT, p.bio FROM profiles p WHERE p.user_id = p_user
$$;

-- Descubrir no expone ids de usuario: de un id de perfil saca a quien pertenece. Sin filas = no existe.
CREATE FUNCTION get_profile_owner(p_profile UUID)
RETURNS TABLE (out_user UUID, out_name TEXT, out_photo TEXT)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT p.user_id, p.name::TEXT, p.main_photo_url::TEXT FROM profiles p WHERE p.id = p_profile
$$;

-- ---- Matches y chat ----

CREATE FUNCTION conversation_for_match(p_match UUID)
RETURNS TABLE (out_id UUID)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT c.id FROM conversations c WHERE c.match_id = p_match
$$;

-- Mensajes sin leer de toda la persona (la insignia de la pestana Matches)
CREATE FUNCTION unread_total(p_user UUID)
RETURNS TABLE (out_count INT)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT COUNT(*)::INT FROM messages m
   WHERE m.to_user_id = p_user AND m.is_read = FALSE AND m.deleted_at IS NULL
$$;

REVOKE ALL ON FUNCTION find_guest(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION upsert_user(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_user_context(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION upsert_profile(UUID, TEXT, INT, TEXT, TEXT, JSONB, JSONB, JSONB, BOOLEAN, BOOLEAN, TEXT[], TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_author(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_profile_owner(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION conversation_for_match(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION unread_total(UUID) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION find_guest(TEXT, TEXT) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION upsert_user(TEXT) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION get_user_context(UUID) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION upsert_profile(UUID, TEXT, INT, TEXT, TEXT, JSONB, JSONB, JSONB, BOOLEAN, BOOLEAN, TEXT[], TEXT) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION get_author(UUID) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION get_profile_owner(UUID) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION conversation_for_match(UUID) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION unread_total(UUID) FROM anon, authenticated;
    GRANT EXECUTE ON FUNCTION find_guest(TEXT, TEXT) TO service_role;
    GRANT EXECUTE ON FUNCTION upsert_user(TEXT) TO service_role;
    GRANT EXECUTE ON FUNCTION get_user_context(UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION upsert_profile(UUID, TEXT, INT, TEXT, TEXT, JSONB, JSONB, JSONB, BOOLEAN, BOOLEAN, TEXT[], TEXT) TO service_role;
    GRANT EXECUTE ON FUNCTION get_author(UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION get_profile_owner(UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION conversation_for_match(UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION unread_total(UUID) TO service_role;
  END IF;
END $$;
