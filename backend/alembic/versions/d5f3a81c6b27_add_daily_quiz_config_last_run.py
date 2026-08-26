"""add daily_quiz_configs last run columns

Revision ID: d5f3a81c6b27
Revises: a4d7e2c9b118
Create Date: 2026-08-24 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd5f3a81c6b27'
down_revision: Union[str, Sequence[str], None] = 'a4d7e2c9b118'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Nobody watches the Beat run that generates daily quizzes, so its outcome only
# existed in the worker log and the Celery result backend. These three columns are
# the only place an admin can see that last night's run failed.
def upgrade() -> None:
    op.add_column(
        'daily_quiz_configs',
        sa.Column('last_run_at', sa.TIMESTAMP(timezone=True), nullable=True),
    )
    op.add_column(
        'daily_quiz_configs',
        sa.Column('last_run_status', sa.String(length=20), nullable=True),
    )
    op.add_column(
        'daily_quiz_configs',
        sa.Column('last_run_error', sa.Text(), nullable=True),
    )
    op.create_check_constraint(
        'ck_daily_quiz_configs_last_run_status_valid',
        'daily_quiz_configs',
        "last_run_status IS NULL "
        "OR last_run_status IN ('success', 'skipped', 'failed')",
    )


def downgrade() -> None:
    op.drop_constraint(
        'ck_daily_quiz_configs_last_run_status_valid',
        'daily_quiz_configs',
        type_='check',
    )
    op.drop_column('daily_quiz_configs', 'last_run_error')
    op.drop_column('daily_quiz_configs', 'last_run_status')
    op.drop_column('daily_quiz_configs', 'last_run_at')
