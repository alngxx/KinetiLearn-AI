"""Create the first admin on a fresh database.

Asks for email, full name and password. getpass reads the password, so it never
shows on screen or lands in shell history, and the script takes no password
argument. An email that already exists is refused.

Run inside the api container:  python -m scripts.create_admin
"""
import asyncio
import getpass
import sys

from fastapi import HTTPException
from pydantic import ValidationError

from app.core.database import SessionLocal
from app.modules.auth.schemas import UserCreate
from app.modules.auth.service import UserService

MIN_PASSWORD_LENGTH = 12


def read_details() -> tuple[str, str, str]:
    email = input("Admin email: ").strip()
    full_name = input("Full name: ").strip()
    password = getpass.getpass(f"Password (at least {MIN_PASSWORD_LENGTH} characters): ")
    if len(password) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"Password must be at least {MIN_PASSWORD_LENGTH} characters.")
    if getpass.getpass("Repeat password: ") != password:
        raise ValueError("Passwords do not match.")
    return email, full_name, password


async def create_admin(db, email: str, full_name: str, password: str):
    data = UserCreate(email = email, full_name = full_name, password = password, role = "admin")
    return await UserService(db).create(data)


async def main():
    try:
        email, full_name, password = read_details()
    except ValueError as e:
        sys.exit(str(e))

    async with SessionLocal() as db:
        try:
            user = await create_admin(db, email, full_name, password)
        except HTTPException as e:
            sys.exit(f"Not created: {e.detail}.")
        except ValidationError as e:
            # Field names only: the error text would echo the input values.
            fields = ", ".join(str(err["loc"][0]) for err in e.errors())
            sys.exit(f"Not created: invalid {fields}.")

    print(f"Created admin {user.email}")


if __name__ == "__main__":
    asyncio.run(main())
