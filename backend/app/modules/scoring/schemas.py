from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class SkillBreakdownItem(BaseModel):
    skill_id: UUID
    skill_name: str
    category_id: UUID
    category_name: str
    cumulative_score: int
    current_level: str
    # The band edges the level came from, so a chart can shade them without a
    # second call to the admin-only /config/skills.
    basic_max: int
    intermediate_max: int
    # NULL for a skill the learner has never been scored on.
    last_updated_at: datetime | None
