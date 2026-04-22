CREATE INDEX IF NOT EXISTS idx_schema_migrations_applied_at
  ON schema_migrations(applied_at);
