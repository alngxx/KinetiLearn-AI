import subprocess
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.core.security import verify_password
from app.modules.auth.models import User
from scripts import create_admin as script

PASSWORD = "correct-horse-battery"
BACKEND_DIR = Path(__file__).resolve().parents[2]


def _answers(monkeypatch, email, full_name, passwords):
    inputs = iter([email, full_name])
    secrets = iter(passwords)
    monkeypatch.setattr("builtins.input", lambda prompt: next(inputs))
    monkeypatch.setattr(script.getpass, "getpass", lambda prompt: next(secrets))


async def test_create_admin_stores_hashed_password_and_admin_role(db_session):
    await script.create_admin(db_session, "root@example.com", "Root Admin", PASSWORD)

    row = (await db_session.execute(select(User).where(User.email == "root@example.com"))).scalar_one()
    assert row.role == "admin"
    assert row.password_hash != PASSWORD
    assert verify_password(PASSWORD, row.password_hash)


async def test_create_admin_refuses_existing_email(db_session):
    await script.create_admin(db_session, "root@example.com", "Root Admin", PASSWORD)

    with pytest.raises(HTTPException) as exc:
        await script.create_admin(db_session, "root@example.com", "Someone Else", PASSWORD)
    assert exc.value.status_code == 409


def test_read_details_returns_answers(monkeypatch):
    _answers(monkeypatch, " root@example.com ", "Root Admin", [PASSWORD, PASSWORD])

    assert script.read_details() == ("root@example.com", "Root Admin", PASSWORD)


def test_read_details_rejects_short_password(monkeypatch):
    _answers(monkeypatch, "root@example.com", "Root Admin", ["short-pass1", "short-pass1"])

    with pytest.raises(ValueError, match = "at least 12"):
        script.read_details()


def test_read_details_rejects_mismatched_passwords(monkeypatch):
    _answers(monkeypatch, "root@example.com", "Root Admin", [PASSWORD, PASSWORD + "x"])

    with pytest.raises(ValueError, match = "do not match"):
        script.read_details()


def test_script_loads_every_model_on_its_own():
    # conftest imports app.main, which loads every model module and once hid a
    # missing import in this script. A fresh interpreter sees what the real run sees.
    code = "import scripts.create_admin; from sqlalchemy.orm import configure_mappers; configure_mappers()"
    result = subprocess.run([sys.executable, "-c", code], cwd = BACKEND_DIR, capture_output = True, text = True)
    assert result.returncode == 0, result.stderr
