PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users (
 discord_id TEXT PRIMARY KEY, display_name TEXT NOT NULL, avatar_hash TEXT,
 blocked INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT REFERENCES users(discord_id), csrf TEXT NOT NULL,
 context_json TEXT, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS grants (
 token_hash TEXT PRIMARY KEY, kind TEXT NOT NULL, source_id TEXT UNIQUE,
 session_hash TEXT, payload_json TEXT NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER
);
CREATE TABLE IF NOT EXISTS matches (
 id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(discord_id), owner_session_hash TEXT NOT NULL,
 request_id TEXT NOT NULL, mode TEXT NOT NULL, league_id TEXT NOT NULL, guild_id TEXT, channel_id TEXT,
 revision INTEGER NOT NULL, status TEXT NOT NULL, eligible INTEGER NOT NULL,
 payload_json TEXT NOT NULL, lease_id TEXT, lease_expires_at INTEGER, commit_id TEXT,
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, finished_at INTEGER,
 UNIQUE(owner_session_hash,request_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_ranked_match ON matches(user_id)
 WHERE status='active' AND mode='ranked';
CREATE INDEX IF NOT EXISTS matches_owner ON matches(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS matches_guest ON matches(owner_session_hash,created_at DESC);
CREATE INDEX IF NOT EXISTS matches_expiration ON matches(status,expires_at);
CREATE TABLE IF NOT EXISTS results (
 id INTEGER PRIMARY KEY AUTOINCREMENT, match_id TEXT NOT NULL UNIQUE,
 user_id TEXT NOT NULL REFERENCES users(discord_id), league_id TEXT NOT NULL, difficulty TEXT NOT NULL,
 guild_id TEXT, channel_id TEXT, season_id TEXT NOT NULL,
 outcome TEXT NOT NULL CHECK(outcome IN ('win','loss')), reason TEXT NOT NULL,
 created_at INTEGER NOT NULL, finished_at INTEGER NOT NULL, metrics_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS results_world ON results(league_id,season_id,user_id,id);
CREATE INDEX IF NOT EXISTS results_server ON results(guild_id,league_id,season_id,user_id,id);
CREATE INDEX IF NOT EXISTS results_channel ON results(guild_id,channel_id,league_id,season_id,user_id,id);
CREATE TABLE IF NOT EXISTS rate_limits (
 key_hash TEXT NOT NULL, window_start INTEGER NOT NULL, count INTEGER NOT NULL,
 PRIMARY KEY(key_hash,window_start)
);
CREATE TABLE IF NOT EXISTS telemetry (
 id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, event TEXT NOT NULL,
 match_id TEXT, actor_key TEXT, details_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS telemetry_time ON telemetry(at,event);
