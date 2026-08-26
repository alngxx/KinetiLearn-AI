"""add exercise_generation_jobs

Revision ID: a4d7e2c9b118
Revises: f2b6c8d1e934
Create Date: 2026-08-24 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'a4d7e2c9b118'
down_revision: Union[str, Sequence[str], None] = 'f2b6c8d1e934'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'exercise_generation_jobs',
        sa.Column(
            'id',
            sa.UUID(),
            server_default=sa.text('gen_random_uuid()'),
            nullable=False,
        ),
        sa.Column('class_id', sa.UUID(), nullable=False),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('prompt', sa.Text(), nullable=False),
        sa.Column('num_questions', sa.SmallInteger(), nullable=False),
        # The requested sources, replayed by the worker. Deliberately not a join
        # table with an FK: a CASCADE would silently shrink this list and the job
        # would generate from fewer documents than the admin asked for. The worker
        # re-reads each id and fails the job loudly instead.
        sa.Column('document_ids', postgresql.JSONB(), nullable=False),
        sa.Column(
            'status',
            sa.String(length=20),
            server_default=sa.text("'queued'"),
            nullable=False,
        ),
        sa.Column(
            'questions_done',
            sa.SmallInteger(),
            server_default=sa.text('0'),
            nullable=False,
        ),
        # NULL until the job succeeds — the exercise is written in one commit at
        # the end, so a job that is not 'succeeded' has produced nothing.
        sa.Column('exercise_id', sa.UUID(), nullable=True),
        sa.Column('error', sa.Text(), nullable=True),
        sa.Column('created_by', sa.UUID(), nullable=True),
        sa.Column(
            'created_at',
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.Column('finished_at', sa.TIMESTAMP(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('queued', 'running', 'succeeded', 'failed')",
            name='ck_exercise_generation_jobs_status_valid',
        ),
        sa.ForeignKeyConstraint(['class_id'], ['classes.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['exercise_id'], ['exercises.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_exercise_generation_jobs_class_id',
        'exercise_generation_jobs',
        ['class_id'],
    )


def downgrade() -> None:
    op.drop_index(
        'ix_exercise_generation_jobs_class_id',
        table_name='exercise_generation_jobs',
    )
    op.drop_table('exercise_generation_jobs')
