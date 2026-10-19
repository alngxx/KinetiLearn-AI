import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.core.security import verify_password
from app.modules.auth.models import User
from scripts import create_admin as script

PASSWORD = "correct-horse-battery"


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
