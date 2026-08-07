"""add document_id to chat_sessions

Revision ID: c3f81a5d2e07
Revises: b7e4a2f039c1
Create Date: 2026-08-06 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c3f81a5d2e07'
down_revision: Union[str, Sequence[str], None] = 'b7e4a2f039c1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('chat_sessions', sa.Column('document_id', sa.UUID(), nullable=True))
    op.create_foreign_key(
        'fk_chat_sessions_document_id',
        'chat_sessions',
        'documents',
        ['document_id'],
        ['id'],
        ondelete='SET NULL',
    )
    op.create_index('ix_chat_sessions_document_id', 'chat_sessions', ['document_id'])


def downgrade() -> None:
    op.drop_index('ix_chat_sessions_document_id', table_name='chat_sessions')
    op.drop_constraint('fk_chat_sessions_document_id', 'chat_sessions', type_='foreignkey')
    op.drop_column('chat_sessions', 'document_id')
