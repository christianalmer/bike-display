-- One row per cron poll (1/min). dow/minute are America/Los_Angeles local,
-- computed at insert time so DST never skews the trend buckets.
CREATE TABLE IF NOT EXISTS samples (
  ts            INTEGER PRIMARY KEY,  -- unix seconds (insert time)
  last_reported INTEGER,              -- station's own last_reported, if present
  dow           INTEGER NOT NULL,     -- 0=Sunday .. 6=Saturday, SF local
  minute        INTEGER NOT NULL,     -- 0..1439 minute of day, SF local
  bikes_total   INTEGER NOT NULL,     -- num_bikes_available (includes e-bikes)
  ebikes        INTEGER NOT NULL,     -- num_ebikes_available
  docks         INTEGER NOT NULL      -- num_docks_available
);

CREATE INDEX IF NOT EXISTS idx_samples_dow_minute ON samples (dow, minute);
