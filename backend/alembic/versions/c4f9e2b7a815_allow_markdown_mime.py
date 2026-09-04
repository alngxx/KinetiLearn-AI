"""allow text/markdown in document_versions.mime_type

Revision ID: c4f9e2b7a815
Revises: b8e1c4f7a903
Create Date: 2026-09-04 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'c4f9e2b7a815'
down_revision: Union[str, Sequence[str], None] = 'b8e1c4f7a903'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint(
        'ck_document_versions_mime_type_valid', 'document_versions', type_='check'
    )
    op.create_check_constraint(
        'ck_document_versions_mime_type_valid',
        'document_versions',
        "mime_type IN ("
        "'application/pdf', "
        "'application/vnd.openxmlformats-officedocument.wordprocessingml.document', "
        "'text/markdown'"
        ")",
    )


def downgrade() -> None:
    op.drop_constraint(
        'ck_document_versions_mime_type_valid', 'document_versions', type_='check'
    )
    op.create_check_constraint(
        'ck_document_versions_mime_type_valid',
        'document_versions',
        "mime_type IN ("
        "'application/pdf', "
        "'application/vnd.openxmlformats-officedocument.wordprocessingml.document'"
        ")",
    )
