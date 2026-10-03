"""一次性迁移本次已核实的本地开发库；不被应用启动流程调用。

使用方式：python migrate.py --backup-dir <已限制访问权限的空备份目录>
依赖 cryptography；只支持本次 Windows / SQLite 源结构。
SQL DDL 见同目录文件，DML 使用参数绑定，私钥和密码不输出、不写入 SQL 文件。
每个库独立事务；两库均通过数据核对后再提交。备份始终保留。
"""

import argparse
import base64
import ctypes
from contextlib import closing
from ctypes import wintypes as wt
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sqlite3

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec, ed25519, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
TARGET = "EasySSH Desktop:credential-encryption-v1"
PREFIX = "enc:v2:"


class Credential(ctypes.Structure):
    _fields_ = [
        ("Flags", wt.DWORD), ("Type", wt.DWORD), ("TargetName", wt.LPWSTR),
        ("Comment", wt.LPWSTR), ("LastWritten", wt.FILETIME),
        ("CredentialBlobSize", wt.DWORD), ("CredentialBlob", ctypes.POINTER(ctypes.c_ubyte)),
        ("Persist", wt.DWORD), ("AttributeCount", wt.DWORD),
        ("Attributes", ctypes.c_void_p), ("TargetAlias", wt.LPWSTR), ("UserName", wt.LPWSTR),
    ]


def desktop_root_key():
    # Same target name and ASCII blob encoding as zalando/go-keyring on Windows.
    api = ctypes.WinDLL("Advapi32.dll", use_last_error=True)
    api.CredReadW.argtypes = [wt.LPCWSTR, wt.DWORD, wt.DWORD, ctypes.POINTER(ctypes.POINTER(Credential))]
    api.CredReadW.restype = wt.BOOL
    api.CredWriteW.argtypes = [ctypes.POINTER(Credential), wt.DWORD]
    api.CredWriteW.restype = wt.BOOL
    api.CredFree.argtypes = [ctypes.c_void_p]
    api.CredFree.restype = None

    def read():
        pointer = ctypes.POINTER(Credential)()
        if not api.CredReadW(TARGET, 1, 0, ctypes.byref(pointer)):
            error = ctypes.get_last_error()
            if error == 1168:
                return None
            raise ctypes.WinError(error)
        try:
            item = pointer.contents
            return ctypes.string_at(item.CredentialBlob, item.CredentialBlobSize)
        finally:
            api.CredFree(pointer)

    encoded = read()
    if encoded is None:
        encoded = base64.b64encode(os.urandom(32))
        blob = (ctypes.c_ubyte * len(encoded)).from_buffer_copy(encoded)
        item = Credential()
        item.Type, item.Persist = 1, 2
        item.TargetName, item.UserName = TARGET, "credential-encryption-v1"
        item.CredentialBlobSize, item.CredentialBlob = len(encoded), blob
        if not api.CredWriteW(ctypes.byref(item), 0):
            raise ctypes.WinError(ctypes.get_last_error())
        if read() != encoded:
            raise RuntimeError("Windows credential write/read verification failed")
    key = base64.b64decode(encoded, validate=True)
    if len(key) != 32:
        raise RuntimeError("Invalid desktop root key; existing credential was not overwritten")
    return key


def server_root_key():
    configured = os.environ.get("ENCRYPTION_KEY", "").strip()
    if not configured:
        for line in (ROOT / ".env").read_text(encoding="utf-8-sig").splitlines():
            name, separator, value = line.partition("=")
            if separator and name.strip() == "ENCRYPTION_KEY":
                configured = value.strip().strip("\"'")
                break
    if not configured:
        configured = (ROOT / "server/data/easyssh-root.key").read_text().strip()
    key = base64.b64decode(configured, validate=True)
    if len(key) != 32:
        raise RuntimeError("Invalid server encryption key")
    return key


def encrypt(aes, value, aad):
    if not value:
        return ""
    nonce = os.urandom(12)
    return PREFIX + base64.b64encode(nonce + aes.encrypt(nonce, value.encode(), aad.encode())).decode()


def decrypt(aes, value, aad):
    if not value:
        return ""
    if not value.startswith(PREFIX):
        raise RuntimeError("Unexpected server ciphertext format")
    data = base64.b64decode(value[len(PREFIX):], validate=True)
    return aes.decrypt(data[:12], data[12:], aad.encode()).decode()


def inspect_key(material):
    raw = material.strip().encode()
    loader = serialization.load_ssh_private_key if b"BEGIN OPENSSH PRIVATE KEY" in raw else serialization.load_pem_private_key
    # Preflight established that these particular databases contain unprotected keys.
    # An unexpected protected/invalid key aborts the entire transaction; never discard it.
    key = loader(raw, password=None)
    if isinstance(key, ed25519.Ed25519PrivateKey):
        algorithm, size = "ed25519", 0
    elif isinstance(key, rsa.RSAPrivateKey):
        algorithm, size = "rsa", key.key_size
    elif isinstance(key, ec.EllipticCurvePrivateKey):
        algorithm, size = "ecdsa", key.key_size
    else:
        raise RuntimeError("Unsupported private key algorithm")
    public = key.public_key().public_bytes(serialization.Encoding.OpenSSH, serialization.PublicFormat.OpenSSH)
    digest = hashlib.sha256(base64.b64decode(public.split()[1])).digest()
    fingerprint = "SHA256:" + base64.b64encode(digest).decode().rstrip("=")
    return public.decode() + "\n", fingerprint, algorithm, size


def execute_sql_file(db, name):
    statement = ""
    for line in (HERE / name).read_text(encoding="utf-8").splitlines(True):
        statement += line
        if sqlite3.complete_statement(statement):
            db.execute(statement)
            statement = ""
    if statement.strip():
        raise RuntimeError("Incomplete migration SQL statement")


def snapshots(db):
    result = {}
    for (table,) in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchall():
        result[table] = [dict(row) for row in db.execute('SELECT * FROM "' + table + '" ORDER BY rowid')]
    return result


def assert_equal(actual, expected, message):
    if actual != expected:
        raise RuntimeError(message)


def migrate(db, kind, aes, before):
    desktop = kind == "desktop"
    table, keys = ("desktop_servers", "desktop_ssh_keys") if desktop else ("servers", "ssh_keys")
    old_rows = before[table]
    if desktop:
        if "desktop_ssh_keys" in before:
            raise RuntimeError("Unexpected desktop source schema; migration is not repeatable")
        execute_sql_file(db, "desktop-prepare.sql")
    else:
        assert_equal(before["ssh_keys"], [], "Source ssh_keys must be empty for this one-time migration")
        if any(row.get("ssh_key_id") is not None for row in old_rows):
            raise RuntimeError("Unexpected existing key reference")

    expected = {}
    imported, passwords = 0, 0
    now = datetime.now(timezone.utc).isoformat()
    for row in old_rows:
        row_id, owner = row["id"], row["user_id"]
        password_aad = f"easyssh:{table}:{row_id}:password" if desktop else f"easyssh:servers:{owner}:{row_id}:password"
        password = (row["password"] or "") if desktop else decrypt(aes, row["password"], password_aad)
        material = row["private_key"] or ""
        if not desktop:
            material = decrypt(aes, material, f"easyssh:servers:{owner}:{row_id}:private_key")
        key_id, fingerprint = None, None
        if material:
            public, fingerprint, algorithm, size = inspect_key(material)
            key_aad = f"easyssh:desktop_ssh_keys:{fingerprint}:private_key" if desktop else f"easyssh:ssh_keys:{owner}:{fingerprint}:private_key"
            encrypted = encrypt(aes, material, key_aad)
            values = [row["name"] or row["host"], public, fingerprint, algorithm, size, False, encrypted, row["created_at"] or now, now]
            if desktop:
                db.execute("INSERT INTO desktop_ssh_keys(name,public_key,fingerprint,algorithm,key_size,passphrase_required,private_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(fingerprint) DO NOTHING", values)
                key_id = db.execute("SELECT id FROM desktop_ssh_keys WHERE fingerprint=?", (fingerprint,)).fetchone()[0]
            else:
                db.execute("INSERT INTO ssh_keys(name,public_key,fingerprint,algorithm,key_size,passphrase_required,private_key,created_at,updated_at,user_id) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,fingerprint) DO NOTHING", values + [owner])
                key_id = db.execute("SELECT id FROM ssh_keys WHERE user_id=? AND fingerprint=?", (owner, fingerprint)).fetchone()[0]
            imported += 1
        if desktop:
            db.execute("UPDATE desktop_servers SET password=?,ssh_key_id=? WHERE id=?", (encrypt(aes, password, password_aad), key_id, row_id))
        else:
            db.execute("UPDATE servers SET ssh_key_id=? WHERE id=?", (key_id, row_id))
        passwords += bool(password)
        expected[row_id] = (password, material, fingerprint)

    execute_sql_file(db, "desktop-finish.sql" if desktop else "server-finish.sql")
    after = snapshots(db)
    assert_equal(len(after[table]), len(old_rows), "Connection row count changed")
    for other, rows in before.items():
        if other not in (table, keys):
            assert_equal(after[other], rows, "Unrelated table changed: " + other)
    for old, row in zip(old_rows, after[table]):
        for field, value in old.items():
            if field not in ("private_key", "ssh_key_id") and not (desktop and field == "password"):
                assert_equal(row[field], value, "Connection metadata changed: " + field)
        password, material, fingerprint = expected[row["id"]]
        aad = f"easyssh:{table}:{row['id']}:password" if desktop else f"easyssh:servers:{row['user_id']}:{row['id']}:password"
        assert_equal(decrypt(aes, row["password"], aad), password, "Password round-trip failed")
        if material:
            saved = dict(db.execute('SELECT * FROM "' + keys + '" WHERE id=?', (row["ssh_key_id"],)).fetchone())
            aad = f"easyssh:desktop_ssh_keys:{fingerprint}:private_key" if desktop else f"easyssh:ssh_keys:{row['user_id']}:{fingerprint}:private_key"
            restored = decrypt(aes, saved["private_key"], aad)
            assert_equal(inspect_key(restored)[1], fingerprint, "Restored private key does not match reference")
            assert_equal(saved["fingerprint"], fingerprint, "Fingerprint mismatch")
        else:
            assert_equal(row["ssh_key_id"], None, "Unexpected key reference")
    assert_equal(db.execute("PRAGMA foreign_key_check").fetchall(), [], "Foreign key check failed")
    assert_equal(db.execute("PRAGMA integrity_check").fetchone()[0], "ok", "SQLite integrity check failed")
    return {"connections": len(old_rows), "passwords_verified": passwords, "key_connections": imported, "unique_keys": len(after[keys]), "unrelated_tables_verified": len(before) - (1 if desktop else 2)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backup-dir", required=True, type=Path)
    args = parser.parse_args()
    folder = args.backup_dir.resolve()
    if not folder.is_dir() or any(folder.iterdir()):
        raise RuntimeError("Backup directory must exist, be access-restricted and empty")
    paths = {"server": ROOT / "server/data/easyssh.db", "desktop": ROOT / "desktop/EasySSHDesktop/bin/data/easyssh-desktop.sqlite"}
    connections, before, report = {}, {}, {"databases": {}, "committed": []}
    try:
        for kind, path in paths.items():
            db = sqlite3.connect(path.as_uri() + "?mode=rw", uri=True, timeout=10, isolation_level=None)
            db.row_factory = sqlite3.Row
            connections[kind] = db
            db.execute("PRAGMA foreign_keys=ON")
            db.execute("PRAGMA secure_delete=ON")
            db.execute("BEGIN IMMEDIATE")
            before[kind] = snapshots(db)
            with closing(sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)) as source:
                backup_path = folder / (kind + "-before.sqlite")
                with closing(sqlite3.connect(backup_path)) as destination:
                    source.backup(destination)
                    assert_equal(destination.execute("PRAGMA integrity_check").fetchone()[0], "ok", "Backup integrity check failed")
            report["databases"][kind] = {"path": str(path), "backup": str(backup_path)}

        server_aes = AESGCM(server_root_key())
        # Confirm source shape and every key before creating an OS credential.
        for kind, tables in before.items():
            table = "servers" if kind == "server" else "desktop_servers"
            for row in tables[table]:
                material = row["private_key"] or ""
                if kind == "server":
                    material = decrypt(server_aes, material, f"easyssh:servers:{row['user_id']}:{row['id']}:private_key")
                if material:
                    inspect_key(material)
        desktop_aes = AESGCM(desktop_root_key())
        for kind, aes in (("server", server_aes), ("desktop", desktop_aes)):
            report["databases"][kind].update(migrate(connections[kind], kind, aes, before[kind]))
        # Both databases validated before committing either one. The journal
        # reports each commit separately: WAL cannot promise cross-file atomicity.
        for kind, db in connections.items():
            db.execute("COMMIT")
            report["committed"].append(kind)
            (folder / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        for db in connections.values():
            result = db.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
            if result[0] != 0:
                raise RuntimeError("Migration committed, but checkpoint is busy")
            db.execute("VACUUM")
            result = db.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
            if result[0] != 0:
                raise RuntimeError("Migration committed, but final checkpoint is busy")
            assert_equal(db.execute("PRAGMA integrity_check").fetchone()[0], "ok", "Post-commit integrity check failed")
        report["completed"] = True
    finally:
        for db in connections.values():
            if db.in_transaction:
                db.rollback()
            db.close()
        (folder / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
