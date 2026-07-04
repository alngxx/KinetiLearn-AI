"""simplify skills level thresholds

Revision ID: b7e4a2f039c1
Revises: 011c661e4753
Create Date: 2026-06-28 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b7e4a2f039c1'
down_revision: Union[str, Sequence[str], None] = '011c661e4753'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint('ck_skills_intermediate_min_follows_basic_max', 'skills', type_='check')
    op.drop_constraint('ck_skills_advanced_min_follows_intermediate_max', 'skills', type_='check')
    op.drop_column('skills', 'basic_min')
    op.drop_column('skills', 'intermediate_min')
    op.drop_column('skills', 'intermediate_max')
    op.drop_column('skills', 'advanced_min')
    op.drop_column('skills', 'advanced_max')
    op.add_column('skills', sa.Column('intermediate_max', sa.Integer(), nullable=False, server_default=sa.text('500')))
    op.create_check_constraint('ck_skills_level_thresholds', 'skills', 'intermediate_max > basic_max')


def downgrade() -> None:
    op.drop_constraint('ck_skills_level_thresholds', 'skills', type_='check')
    op.drop_column('skills', 'intermediate_max')
    op.add_column('skills', sa.Column('basic_min', sa.Integer(), nullable=False, server_default=sa.text('0')))
    op.add_column('skills', sa.Column('intermediate_min', sa.Integer(), nullable=False, server_default=sa.text('0')))
    op.add_column('skills', sa.Column('intermediate_max', sa.Integer(), nullable=False, server_default=sa.text('0')))
    op.add_column('skills', sa.Column('advanced_min', sa.Integer(), nullable=False, server_default=sa.text('0')))
    op.add_column('skills', sa.Column('advanced_max', sa.Integer(), nullable=False, server_default=sa.text('0')))
    op.create_check_constraint(
        'ck_skills_intermediate_min_follows_basic_max', 'skills', 'intermediate_min = basic_max + 1'
    )
    op.create_check_constraint(
        'ck_skills_advanced_min_follows_intermediate_max', 'skills', 'advanced_min = intermediate_max + 1'
    )
