"""cascade chat_message_citations on document_chunk delete

Revision ID: f7c2c192db6b
Revises: c4f9e2b7a815
Create Date: 2026-09-05 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'f7c2c192db6b'
down_revision: Union[str, Sequence[str], None] = 'c4f9e2b7a815'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint(
        'chat_message_citations_document_chunk_id_fkey',
        'chat_message_citations',
        type_='foreignkey',
    )
    op.create_foreign_key(
        'chat_message_citations_document_chunk_id_fkey',
        'chat_message_citations',
        'document_chunks',
        ['document_chunk_id'],
        ['id'],
        ondelete='CASCADE',
    )


def downgrade() -> None:
    op.drop_constraint(
        'chat_message_citations_document_chunk_id_fkey',
        'chat_message_citations',
        type_='foreignkey',
    )
    op.create_foreign_key(
        'chat_message_citations_document_chunk_id_fkey',
        'chat_message_citations',
        'document_chunks',
        ['document_chunk_id'],
        ['id'],
        ondelete='RESTRICT',
    )
