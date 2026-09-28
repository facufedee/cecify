-- Volver a ver los perfiles que se pasaron en Descubrir.
-- Pasar ("skip") quedaba guardado para siempre y, con los invitados de una sola fiesta, Descubrir se vaciaba rapido.
-- Cuando se termina el mazo, la persona puede pedir que vuelvan los que paso (tambien sirve despues de cambiar sus
-- preferencias). Los "me gusta", los matches y los bloqueos no se tocan; deshacer un match sigue siendo para siempre.

-- Cuantos de los que paso p_user siguen en Descubrir (participan del match, visibles y sin bloqueo).
-- No mira las preferencias: puede contar a alguien que despues no aparece porque ya no encaja.
CREATE FUNCTION skipped_count(p_user UUID)
RETURNS TABLE (out_count INT)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT COUNT(*)::INT
    FROM swipes s
    JOIN profiles p ON p.user_id = s.to_user_id
   WHERE s.from_user_id = p_user
     AND s.action = 'skip'
     AND p.wants_match
     AND p.visibility IS NOT FALSE
     AND NOT is_blocked(p_user, s.to_user_id)
$$;

-- Borra los "paso" de p_user: esos perfiles vuelven a Descubrir. Devuelve cuantos borro.
CREATE FUNCTION reset_skips(p_user UUID)
RETURNS TABLE (out_count INT)
LANGUAGE sql
SET search_path = public
AS $$
  WITH gone AS (
    DELETE FROM swipes s WHERE s.from_user_id = p_user AND s.action = 'skip' RETURNING 1
  )
  SELECT COUNT(*)::INT FROM gone
$$;

-- ---- Permisos: solo el servidor (service role) ----
REVOKE ALL ON FUNCTION skipped_count(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION reset_skips(UUID) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION skipped_count(UUID) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION reset_skips(UUID) FROM anon, authenticated;
    GRANT EXECUTE ON FUNCTION skipped_count(UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION reset_skips(UUID) TO service_role;
  END IF;
END $$;
