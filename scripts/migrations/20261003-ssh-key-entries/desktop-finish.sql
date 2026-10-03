-- Execute only after every password is encrypted and every key reference exists.
ALTER TABLE desktop_servers DROP COLUMN private_key;
