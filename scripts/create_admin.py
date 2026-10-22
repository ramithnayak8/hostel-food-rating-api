"""Create an admin account, or promote/reset an existing one. Safe to run repeatedly.

    python -m scripts.create_admin --email warden@hostel.example.com --password '...'

Arguments fall back to the ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME environment variables.
Uses DATABASE_URL like the API itself.
"""

import argparse
import os
import sys

from sqlalchemy import select

from app.auth import hash_password
from app.database import SessionLocal
from app.models import Role, User

MIN_PASSWORD_LENGTH = 8


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--email", default=os.getenv("ADMIN_EMAIL"))
    parser.add_argument("--password", default=os.getenv("ADMIN_PASSWORD"))
    parser.add_argument("--name", default=os.getenv("ADMIN_NAME", "Hostel Warden"))
    parser.add_argument("--room-no", default="Office")
    return parser.parse_args(argv)


def upsert_admin(email: str, password: str, name: str, room_no: str) -> str:
    """Return "created" or "updated"."""
    email = email.strip().lower()
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == email))
        outcome = "updated"
        if user is None:
            user = User(email=email, name=name, room_no=room_no)
            db.add(user)
            outcome = "created"
        user.role = Role.admin
        user.is_active = True
        user.password_hash = hash_password(password)
        db.commit()
    return outcome


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if not args.email or "@" not in args.email:
        print("error: --email (or ADMIN_EMAIL) must be a valid email address", file=sys.stderr)
        return 2
    if not args.password or len(args.password) < MIN_PASSWORD_LENGTH:
        print(
            f"error: --password (or ADMIN_PASSWORD) needs {MIN_PASSWORD_LENGTH}+ characters",
            file=sys.stderr,
        )
        return 2
    outcome = upsert_admin(args.email, args.password, args.name, args.room_no)
    print(f"admin {args.email.strip().lower()} {outcome}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
