"""add class_id to chat_sessions

Revision ID: 9c65adfd80ab
Revises: a3c8f1e5d7b2
Create Date: 2026-09-19 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '9c65adfd80ab'
down_revision: Union[str, Sequence[str], None] = 'a3c8f1e5d7b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('chat_sessions', sa.Column('class_id', sa.UUID(), nullable=True))
    op.create_foreign_key(
        'fk_chat_sessions_class_id',
        'chat_sessions',
        'classes',
        ['class_id'],
        ['id'],
        ondelete='SET NULL',
    )
    op.create_index('ix_chat_sessions_class_id', 'chat_sessions', ['class_id'])


def downgrade() -> None:
    op.drop_index('ix_chat_sessions_class_id', table_name='chat_sessions')
    op.drop_constraint('fk_chat_sessions_class_id', 'chat_sessions', type_='foreignkey')
    op.drop_column('chat_sessions', 'class_id')
