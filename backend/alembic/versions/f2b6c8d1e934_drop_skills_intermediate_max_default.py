"""drop skills.intermediate_max server default

Revision ID: f2b6c8d1e934
Revises: e91c7b4d5a20
Create Date: 2026-08-07 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f2b6c8d1e934'
down_revision: Union[str, Sequence[str], None] = 'e91c7b4d5a20'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # b7e4a2f039c1 needed DEFAULT 500 only to backfill the column it was adding, but
    # left it in place. The model and the schema spec both declare no default, so a
    # migrated database silently accepted an insert that the model-built test
    # database rejects. SkillCreate already requires the field, so nothing relies
    # on the default.
    op.alter_column('skills', 'intermediate_max', server_default=None)


def downgrade() -> None:
    op.alter_column(
        'skills', 'intermediate_max', server_default=sa.text('500')
    )
