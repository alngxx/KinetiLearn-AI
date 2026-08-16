"""add exercise_documents and chat exercise scope

Revision ID: e91c7b4d5a20
Revises: c3f81a5d2e07
Create Date: 2026-08-07 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e91c7b4d5a20'
down_revision: Union[str, Sequence[str], None] = 'c3f81a5d2e07'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'exercise_documents',
        sa.Column('exercise_id', sa.UUID(), nullable=False),
        sa.Column('document_id', sa.UUID(), nullable=False),
        sa.Column('version_number', sa.Integer(), nullable=False),
        sa.Column(
            'created_at',
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(['exercise_id'], ['exercises.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(
            ['document_id', 'version_number'],
            ['document_versions.document_id', 'document_versions.version_number'],
            name='fk_exercise_documents_document_version',
            ondelete='CASCADE',
        ),
        sa.PrimaryKeyConstraint('exercise_id', 'document_id'),
    )
    op.create_index(
        'ix_exercise_documents_exercise_id', 'exercise_documents', ['exercise_id']
    )

    # Exercises generated before this table existed still carry per-question
    # provenance when they had a single source, so those are recoverable. Ones
    # generated from several documents stored nothing and cannot be backfilled.
    op.execute("""
        INSERT INTO exercise_documents (exercise_id, document_id, version_number)
        SELECT DISTINCT exercise_id, source_document_id, source_version_number
        FROM questions
        WHERE source_document_id IS NOT NULL
          AND source_version_number IS NOT NULL
    """)

    op.add_column('chat_sessions', sa.Column('exercise_id', sa.UUID(), nullable=True))
    op.create_foreign_key(
        'fk_chat_sessions_exercise_id',
        'chat_sessions',
        'exercises',
        ['exercise_id'],
        ['id'],
        ondelete='SET NULL',
    )
    op.create_index('ix_chat_sessions_exercise_id', 'chat_sessions', ['exercise_id'])


def downgrade() -> None:
    op.drop_index('ix_chat_sessions_exercise_id', table_name='chat_sessions')
    op.drop_constraint('fk_chat_sessions_exercise_id', 'chat_sessions', type_='foreignkey')
    op.drop_column('chat_sessions', 'exercise_id')

    op.drop_index('ix_exercise_documents_exercise_id', table_name='exercise_documents')
    op.drop_table('exercise_documents')
