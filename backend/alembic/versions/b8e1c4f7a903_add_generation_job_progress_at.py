"""add exercise_generation_jobs.progress_at

Revision ID: b8e1c4f7a903
Revises: d5f3a81c6b27
Create Date: 2026-08-26 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b8e1c4f7a903'
down_revision: Union[str, Sequence[str], None] = 'd5f3a81c6b27'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# A liveness heartbeat, stamped when the job starts running and again after every
# LLM batch. created_at cannot serve this purpose: it would make the stale-job
# sweep kill a long but healthy 50-question run purely for being slow.
def upgrade() -> None:
    op.add_column(
        'exercise_generation_jobs',
        sa.Column('progress_at', sa.TIMESTAMP(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('exercise_generation_jobs', 'progress_at')
