-- Cecify - schema inicial
-- Todo el acceso a datos pasa por API routes con el service role (bypassea RLS).
-- RLS queda activado SIN policies: la clave publishable (publica) no puede leer ni escribir nada.

CREATE TYPE user_role AS ENUM ('guest', 'admin');
CREATE TYPE swipe_action AS ENUM ('like', 'skip');

-- updated_at automatico
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Users (Core)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  email_verified BOOLEAN DEFAULT false,
  access_code VARCHAR(50) UNIQUE NOT NULL,
  role user_role DEFAULT 'guest',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Profiles (Invitado)
CREATE TABLE profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  age INT,
  bio TEXT,
  main_photo_url VARCHAR(500),
  additional_photos JSONB,
  interests JSONB,
  contact_methods JSONB,
  visibility BOOLEAN DEFAULT true,
  is_online BOOLEAN DEFAULT false,
  last_seen TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Swipes (Liked/Skipped)
CREATE TABLE swipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action swipe_action NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (from_user_id, to_user_id)
);

-- Matches (Mutual)
CREATE TABLE matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user1_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user2_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (user1_id <> user2_id)
);

-- Un match por par de usuarios, sin importar el orden
CREATE UNIQUE INDEX idx_matches_pair
  ON matches (LEAST(user1_id, user2_id), GREATEST(user1_id, user2_id));

-- Conversations (Chat)
-- last_message_id sin FK a proposito (evita FK circular con messages)
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID UNIQUE NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user1_id UUID NOT NULL REFERENCES users(id),
  user2_id UUID NOT NULL REFERENCES users(id),
  last_message_id UUID,
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (user1_id <> user2_id)
);

CREATE UNIQUE INDEX idx_conversations_pair
  ON conversations (LEAST(user1_id, user2_id), GREATEST(user1_id, user2_id));

-- Messages (Chat)
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  from_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  is_read BOOLEAN DEFAULT false,
  read_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Photos (Muro)
CREATE TABLE photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  photo_url VARCHAR(500) NOT NULL,
  caption TEXT,
  likes_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Photo Likes
CREATE TABLE photo_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  photo_id UUID NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (photo_id, user_id)
);

-- Push Subscriptions (Web Push)
CREATE TABLE push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription JSONB NOT NULL,
  user_agent VARCHAR(500),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes (los UNIQUE ya cubren profiles.user_id, swipes(from,to), photo_likes(photo,user))
CREATE INDEX idx_matches_user1 ON matches (user1_id);
CREATE INDEX idx_matches_user2 ON matches (user2_id);
CREATE INDEX idx_swipes_to_user ON swipes (to_user_id);
CREATE INDEX idx_conversations_user1 ON conversations (user1_id);
CREATE INDEX idx_conversations_user2 ON conversations (user2_id);
CREATE INDEX idx_messages_conversation ON messages (conversation_id, created_at DESC);
CREATE INDEX idx_messages_to_user ON messages (to_user_id, is_read);
CREATE INDEX idx_photos_user ON photos (user_id);
CREATE INDEX idx_photo_likes_user ON photo_likes (user_id);
CREATE INDEX idx_push_subscriptions_user ON push_subscriptions (user_id);

-- Triggers updated_at
CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS: activado en todas las tablas, sin policies
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE swipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE photo_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
