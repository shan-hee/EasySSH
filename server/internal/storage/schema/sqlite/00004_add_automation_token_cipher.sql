-- Goose wraps each direction and its version record in a transaction.

-- +goose Up
-- Keeps an encrypted copy of each automation token so the owner can view it
-- again. Existing tokens stay NULL: only their hash exists, so they become
-- viewable after one rotation.
ALTER TABLE automation_tokens ADD COLUMN token_cipher TEXT;

-- +goose Down
-- Drops the encrypted copies. Tokens keep working through token_hash but can no
-- longer be viewed; recovering them requires the pre-upgrade recovery point.
ALTER TABLE automation_tokens DROP COLUMN token_cipher;
