"""add class_documents

Revision ID: a3c8f1e5d7b2
Revises: f7c2c192db6b
Create Date: 2026-09-19

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'a3c8f1e5d7b2'
down_revision: Union[str, Sequence[str], None] = 'f7c2c192db6b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Both sides CASCADE: deleting a class drops the links and leaves the
    # documents alone, and deleting a document drops its links and leaves the
    # classes alone. Neither side owns the other.
    op.create_table(
        'class_documents',
        sa.Column('class_id', sa.UUID(), nullable=False),
        sa.Column('document_id', sa.UUID(), nullable=False),
        sa.Column(
            'created_at',
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(['class_id'], ['classes.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['document_id'], ['documents.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('class_id', 'document_id'),
    )
    op.create_index('ix_class_documents_document_id', 'class_documents', ['document_id'])


def downgrade() -> None:
    op.drop_index('ix_class_documents_document_id', table_name='class_documents')
    op.drop_table('class_documents')
