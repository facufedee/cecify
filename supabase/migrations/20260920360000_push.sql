-- Notificaciones push: una suscripcion por dispositivo. Solo se llaman desde el servidor (service role).
-- La tabla push_subscriptions ya existia (vacia); se le agrega el endpoint como clave unica.

-- El endpoint identifica al dispositivo. Si otra persona inicia sesion en el mismo dispositivo, la suscripcion
-- pasa a ser suya (ON CONFLICT): un dispositivo nunca recibe avisos de dos cuentas.
ALTER TABLE push_subscriptions
  ADD COLUMN endpoint TEXT GENERATED ALWAYS AS (subscription ->> 'endpoint') STORED,
  -- Ojo: un CHECK con NULL no falla, por eso cada dato pide IS NOT NULL de forma explicita
  ADD CONSTRAINT push_subscription_shape CHECK (
    (subscription ->> 'endpoint') IS NOT NULL
    AND (subscription ->> 'endpoint') LIKE 'https://%'
    AND char_length(subscription ->> 'endpoint') <= 2000
    AND (subscription -> 'keys' ->> 'p256dh') IS NOT NULL
    AND (subscription -> 'keys' ->> 'auth') IS NOT NULL
  );
CREATE UNIQUE INDEX idx_push_subscriptions_endpoint ON push_subscriptions (endpoint);

-- Guarda (o actualiza) la suscripcion de un dispositivo. Como maximo 10 dispositivos por persona: al pasarse
-- se descartan los mas viejos. Una suscripcion con forma invalida falla con check_violation.
CREATE FUNCTION save_push_subscription(p_user UUID, p_subscription JSONB, p_user_agent TEXT DEFAULT NULL)
RETURNS TABLE (out_id UUID)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO push_subscriptions (user_id, subscription, user_agent)
  VALUES (p_user, p_subscription, LEFT(p_user_agent, 300))
  ON CONFLICT (endpoint) DO UPDATE
    SET user_id = EXCLUDED.user_id,
        subscription = EXCLUDED.subscription,
        user_agent = EXCLUDED.user_agent
  RETURNING id INTO v_id;

  DELETE FROM push_subscriptions
   WHERE user_id = p_user
     AND id NOT IN (
       SELECT s.id FROM push_subscriptions s WHERE s.user_id = p_user ORDER BY s.created_at DESC, s.id LIMIT 10
     );

  RETURN QUERY SELECT v_id;
END;
$$;

-- Quita la suscripcion de UN dispositivo, solo si es de esa persona
CREATE FUNCTION delete_push_subscription(p_user UUID, p_endpoint TEXT)
RETURNS TABLE (out_ok BOOLEAN)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_rows INT;
BEGIN
  DELETE FROM push_subscriptions WHERE user_id = p_user AND endpoint = p_endpoint;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN QUERY SELECT v_rows > 0;
END;
$$;

-- Quita todos los dispositivos de una persona (al cerrar sesion en todos lados)
CREATE FUNCTION delete_push_subscriptions(p_user UUID)
RETURNS TABLE (out_count INT)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_rows INT;
BEGIN
  DELETE FROM push_subscriptions WHERE user_id = p_user;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN QUERY SELECT v_rows;
END;
$$;

CREATE FUNCTION list_push_subscriptions(p_user UUID)
RETURNS TABLE (out_subscription JSONB)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT s.subscription FROM push_subscriptions s WHERE s.user_id = p_user ORDER BY s.created_at
$$;

-- El servicio de push dijo que el dispositivo ya no existe (404/410): se descarta, sea de quien sea
CREATE FUNCTION drop_push_endpoint(p_endpoint TEXT)
RETURNS TABLE (out_count INT)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_rows INT;
BEGIN
  DELETE FROM push_subscriptions WHERE endpoint = p_endpoint;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN QUERY SELECT v_rows;
END;
$$;

REVOKE ALL ON FUNCTION save_push_subscription(UUID, JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION delete_push_subscription(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION delete_push_subscriptions(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION list_push_subscriptions(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION drop_push_endpoint(TEXT) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION save_push_subscription(UUID, JSONB, TEXT) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION delete_push_subscription(UUID, TEXT) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION delete_push_subscriptions(UUID) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION list_push_subscriptions(UUID) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION drop_push_endpoint(TEXT) FROM anon, authenticated;
    GRANT EXECUTE ON FUNCTION save_push_subscription(UUID, JSONB, TEXT) TO service_role;
    GRANT EXECUTE ON FUNCTION delete_push_subscription(UUID, TEXT) TO service_role;
    GRANT EXECUTE ON FUNCTION delete_push_subscriptions(UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION list_push_subscriptions(UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION drop_push_endpoint(TEXT) TO service_role;
  END IF;
END $$;
