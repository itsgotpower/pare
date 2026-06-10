ALTER TABLE app_user ADD COLUMN password_changed_at TEXT;
UPDATE app_user SET password_changed_at = created_at WHERE password_changed_at IS NULL;
