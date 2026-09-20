"""add avatar_url to users

Revision ID: d6a4b93f1c58
Revises: 9c65adfd80ab
Create Date: 2026-09-20 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd6a4b93f1c58'
down_revision: Union[str, Sequence[str], None] = '9c65adfd80ab'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Holds the R2 object key ("avatars/{user_id}/{hex}.png"), not a URL — the
    # bucket is private, so the API signs a short-lived URL on read. Same
    # convention as document_versions.file_url. Nullable: a user without a
    # picture falls back to initials.
    op.add_column('users', sa.Column('avatar_url', sa.String(255), nullable = True))


def downgrade() -> None:
    op.drop_column('users', 'avatar_url')
