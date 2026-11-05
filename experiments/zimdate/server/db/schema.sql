-- ZimDate schema.
--
-- Design notes (see ../REVERSE_ENGINEERING.md §10):
--   * Integrity is enforced here, not only in application code: CHECK constraints on every enum,
--     canonical ordering on matches so (a,b) and (b,a) cannot both exist, and cascading deletes so
--     account deletion leaves no orphans.
--   * JSON is used only for genuinely list-shaped, never-queried data (accept sets, interests,
--     prompt answers). Anything that is filtered or joined gets its own column or table.
--   * Times are ISO-8601 UTC strings. SQLite has no timezone type and mixing epochs with strings is
--     how ordering bugs are born.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  birth_date    TEXT NOT NULL,
  gender        TEXT NOT NULL CHECK (gender IN ('woman', 'man', 'nonbinary')),
  looking_for   TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(looking_for)),
  intent        TEXT NOT NULL DEFAULT 'long-term'
                CHECK (intent IN ('long-term', 'short-term', 'friends', 'figuring-it-out')),
  headline      TEXT NOT NULL DEFAULT '',
  bio           TEXT NOT NULL DEFAULT '',
  city          TEXT NOT NULL DEFAULT 'Harare',
  suburb        TEXT NOT NULL DEFAULT '',
  lat           REAL,
  lon           REAL,
  height_cm     INTEGER CHECK (height_cm IS NULL OR (height_cm > 100 AND height_cm < 250)),
  education     TEXT NOT NULL DEFAULT '',
  occupation    TEXT NOT NULL DEFAULT '',
  religion      TEXT NOT NULL DEFAULT '',
  languages     TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(languages)),
  drinks        TEXT NOT NULL DEFAULT '',
  smokes        TEXT NOT NULL DEFAULT '',
  cannabis      TEXT NOT NULL DEFAULT '',
  kids          TEXT NOT NULL DEFAULT '',
  pets          TEXT NOT NULL DEFAULT '',
  interests     TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(interests)),
  prompts       TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(prompts)),
  photo_ids     TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(photo_ids)),
  tier          TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'plus', 'gold')),
  tier_until    TEXT,
  coins         INTEGER NOT NULL DEFAULT 0 CHECK (coins >= 0),
  boosts_left   INTEGER NOT NULL DEFAULT 0 CHECK (boosts_left >= 0),
  verified      INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
  is_admin      INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
  banned        INTEGER NOT NULL DEFAULT 0 CHECK (banned IN (0, 1)),
  min_age       INTEGER NOT NULL DEFAULT 18 CHECK (min_age >= 18),
  max_age       INTEGER NOT NULL DEFAULT 99 CHECK (max_age >= min_age),
  max_distance_km INTEGER NOT NULL DEFAULT 60 CHECK (max_distance_km > 0),
  last_active_at TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  seeded        INTEGER NOT NULL DEFAULT 0 CHECK (seeded IN (0, 1))
);

CREATE INDEX IF NOT EXISTS users_tier ON users (tier) WHERE banned = 0;
CREATE INDEX IF NOT EXISTS users_last_active ON users (last_active_at DESC);
CREATE INDEX IF NOT EXISTS users_city ON users (city);

CREATE TABLE IF NOT EXISTS photos (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  position   INTEGER NOT NULL DEFAULT 0,
  mime       TEXT NOT NULL DEFAULT 'image/webp',
  bytes      BLOB NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, position)
);

CREATE INDEX IF NOT EXISTS photos_user ON photos (user_id, position);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS questions (
  id         TEXT PRIMARY KEY,
  category   TEXT NOT NULL,
  text       TEXT NOT NULL,
  options    TEXT NOT NULL CHECK (json_valid(options)),
  weight_hint TEXT NOT NULL DEFAULT '',
  active     INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE TABLE IF NOT EXISTS answers (
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
  answer     TEXT NOT NULL,
  accept     TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(accept)),
  importance TEXT NOT NULL DEFAULT 'little'
             CHECK (importance IN ('irrelevant', 'little', 'somewhat', 'very', 'mandatory')),
  explanation TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, question_id)
);

CREATE INDEX IF NOT EXISTS answers_question ON answers (question_id);

CREATE TABLE IF NOT EXISTS likes (
  from_user  TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  to_user    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  seen       INTEGER NOT NULL DEFAULT 0 CHECK (seen IN (0, 1)),
  PRIMARY KEY (from_user, to_user),
  CHECK (from_user <> to_user)
);

CREATE INDEX IF NOT EXISTS likes_to ON likes (to_user, created_at DESC);

CREATE TABLE IF NOT EXISTS passes (
  from_user  TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  to_user    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (from_user, to_user),
  CHECK (from_user <> to_user)
);

CREATE INDEX IF NOT EXISTS passes_to ON passes (to_user);

CREATE TABLE IF NOT EXISTS matches (
  id            TEXT PRIMARY KEY,
  user_a        TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  user_b        TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at    TEXT NOT NULL,
  last_message_at TEXT,
  a_last_read_at TEXT,
  b_last_read_at TEXT,
  closed_at     TEXT,
  closed_by     TEXT REFERENCES users (id) ON DELETE SET NULL,
  CHECK (user_a < user_b),                 -- canonical order: one row per pair, ever
  UNIQUE (user_a, user_b)
);

CREATE INDEX IF NOT EXISTS matches_a ON matches (user_a, closed_at);
CREATE INDEX IF NOT EXISTS matches_b ON matches (user_b, closed_at);

CREATE TABLE IF NOT EXISTS messages (
  id         TEXT PRIMARY KEY,
  match_id   TEXT NOT NULL REFERENCES matches (id) ON DELETE CASCADE,
  sender_id  TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  body       TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  client_id  TEXT,
  created_at TEXT NOT NULL,
  read_at    TEXT,
  flagged    INTEGER NOT NULL DEFAULT 0 CHECK (flagged IN (0, 1)),
  UNIQUE (match_id, sender_id, client_id)  -- idempotent sends
);

CREATE INDEX IF NOT EXISTS messages_match ON messages (match_id, created_at);

CREATE TABLE IF NOT EXISTS blocks (
  blocker_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

CREATE INDEX IF NOT EXISTS blocks_blocked ON blocks (blocked_id);

CREATE TABLE IF NOT EXISTS reports (
  id          TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  target_id   TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  reason      TEXT NOT NULL CHECK (reason IN (
                'fake_profile', 'harassment', 'spam', 'inappropriate_photos',
                'underage', 'scam', 'offline_behaviour', 'other')),
  details     TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewing', 'actioned', 'dismissed')),
  created_at  TEXT NOT NULL,
  resolved_at TEXT,
  action      TEXT,
  UNIQUE (reporter_id, target_id, reason)   -- re-reporting the same thing is a no-op
);

CREATE INDEX IF NOT EXISTS reports_status ON reports (status, created_at);

CREATE TABLE IF NOT EXISTS moderation_log (
  id          TEXT PRIMARY KEY,
  actor_id    TEXT REFERENCES users (id) ON DELETE SET NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('user', 'photo', 'message', 'report', 'profile')),
  target_id   TEXT NOT NULL,
  action      TEXT NOT NULL CHECK (action IN ('approve', 'flag', 'remove', 'ban', 'unban', 'warn', 'dismiss')),
  notes       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS moderation_log_target ON moderation_log (target_type, target_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('like', 'match', 'message', 'profile_view', 'boost', 'system', 'moderation')),
  payload    TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload)),
  read_at    TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS notifications_user ON notifications (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS boosts (
  user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  activated_at TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  PRIMARY KEY (user_id, activated_at)
);

CREATE INDEX IF NOT EXISTS boosts_active ON boosts (expires_at);

CREATE TABLE IF NOT EXISTS profile_views (
  viewer_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  viewed_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  viewed_at TEXT NOT NULL,
  PRIMARY KEY (viewer_id, viewed_id),
  CHECK (viewer_id <> viewed_id)
);

CREATE INDEX IF NOT EXISTS profile_views_target ON profile_views (viewed_id, viewed_at DESC);

CREATE TABLE IF NOT EXISTS events (
  id         TEXT PRIMARY KEY,
  user_id    TEXT REFERENCES users (id) ON DELETE SET NULL,
  kind       TEXT NOT NULL,
  meta       TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(meta)),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS events_kind ON events (kind, created_at DESC);
