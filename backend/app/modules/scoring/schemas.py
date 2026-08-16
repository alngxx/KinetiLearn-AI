from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class SkillBreakdownItem(BaseModel):
    skill_id: UUID
    skill_name: str
    category_id: UUID
    cumulative_score: int
    current_level: str
    last_updated_at: datetime
