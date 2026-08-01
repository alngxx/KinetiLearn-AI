import itertools
import uuid
from datetime import datetime, timedelta, timezone

from app.core.dependencies import require_admin
from app.main import app
from app.modules.auth.models import User
from app.modules.classes.models import Class, ClassMember
from app.modules.config.models import Department, EmployeeLevel, SeniorityLevel
from app.modules.exams.models import Exercise

BASE = "/api/v1/classes"

# seniority_levels.rank and employee_levels.rank are NOT NULL and unique.
_ranks = itertools.count(1)


def _use_stub_admin():
    # The shared fixture stubs require_admin as a dict, but create reads
    # current_user.id — override with a minimal user (created_by is nullable).
    app.dependency_overrides[require_admin] = lambda: type("U", (), {"id": None})()


async def _seed_class(db, *, name = None, is_active = True):
    c = Class(name = name or f"Class {uuid.uuid4()}", is_active = is_active)
    db.add(c)
    await db.flush()
    return c


async def _seed_user(
    db,
    *,
    role = "learner",
    is_active = True,
    department_id = None,
    employee_level_id = None,
    seniority_id = None,
):
    u = User(
        email = f"{uuid.uuid4()}@example.com",
        password_hash = "x",
        full_name = "Test Learner",
        role = role,
        is_active = is_active,
        department_id = department_id,
        employee_level_id = employee_level_id,
        seniority_id = seniority_id,
    )
    db.add(u)
    await db.flush()
    return u


async def _seed_department(db):
    d = Department(name = f"Dept {uuid.uuid4()}")
    db.add(d)
    await db.flush()
    return d


async def _seed_employee_level(db):
    e = EmployeeLevel(name = f"Lvl {uuid.uuid4()}"[:50], rank = next(_ranks))
    db.add(e)
    await db.flush()
    return e


async def _seed_seniority(db):
    s = SeniorityLevel(name = f"Sen {uuid.uuid4()}"[:50], rank = next(_ranks))
    db.add(s)
    await db.flush()
    return s


async def _seed_exercise(db, class_id, *, title = "Ex", days = 1):
    start = datetime.now(timezone.utc)
    e = Exercise(
        class_id = class_id,
        title = title,
        start_time = start,
        end_time = start + timedelta(days = days),
        duration_minutes = 60,
        pass_score = 1,
        total_points = 2,
    )
    db.add(e)
    await db.flush()
    return e


async def test_create_class_success(client):
    _use_stub_admin()
    resp = await client.post(BASE, json = {"name": "Onboarding"})
    assert resp.status_code == 201
    body = resp.json()
    assert body["name"] == "Onboarding"
    assert body["is_active"] is True


async def test_create_class_end_date_before_start_date(client):
    _use_stub_admin()
    resp = await client.post(
        BASE,
        json = {"name": "Bad", "start_date": "2026-08-10", "end_date": "2026-08-01"},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "end_date must be on or after start_date."


async def test_list_classes_excludes_inactive_by_default(client, db_session):
    active = await _seed_class(db_session)
    inactive = await _seed_class(db_session, is_active = False)

    resp = await client.get(BASE)
    assert resp.status_code == 200
    ids = [c["id"] for c in resp.json()]
    assert str(active.id) in ids
    assert str(inactive.id) not in ids


async def test_list_classes_include_inactive(client, db_session):
    inactive = await _seed_class(db_session, is_active = False)

    resp = await client.get(BASE, params = {"include_inactive": True})
    assert resp.status_code == 200
    assert str(inactive.id) in [c["id"] for c in resp.json()]


async def test_get_class_detail_includes_members_and_exercises(client, db_session):
    cls = await _seed_class(db_session)
    learner = await _seed_user(db_session)
    db_session.add(ClassMember(class_id = cls.id, user_id = learner.id))
    await _seed_exercise(db_session, cls.id, title = "Quiz 1")
    await db_session.flush()

    resp = await client.get(f"{BASE}/{cls.id}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["member_count"] == 1
    assert len(body["exercises"]) == 1
    assert body["exercises"][0]["title"] == "Quiz 1"
    # end_time is the exercise deadline surfaced on the class.
    assert body["exercises"][0]["end_time"] is not None


async def test_get_class_not_found(client):
    resp = await client.get(f"{BASE}/{uuid.uuid4()}")
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Class not found."


async def test_update_class(client, db_session):
    cls = await _seed_class(db_session)
    resp = await client.put(f"{BASE}/{cls.id}", json = {"name": "Renamed"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "Renamed"


async def test_update_class_rejects_bad_date_range(client, db_session):
    cls = await _seed_class(db_session)
    await client.put(f"{BASE}/{cls.id}", json = {"start_date": "2026-08-10"})
    resp = await client.put(f"{BASE}/{cls.id}", json = {"end_date": "2026-08-01"})
    assert resp.status_code == 400


async def test_update_class_not_found(client):
    resp = await client.put(f"{BASE}/{uuid.uuid4()}", json = {"name": "X"})
    assert resp.status_code == 404


async def test_deactivate_and_activate_class(client, db_session):
    cls = await _seed_class(db_session)

    resp = await client.patch(f"{BASE}/{cls.id}/deactivate")
    assert resp.status_code == 200
    assert resp.json()["is_active"] is False

    resp = await client.patch(f"{BASE}/{cls.id}/activate")
    assert resp.status_code == 200
    assert resp.json()["is_active"] is True


async def test_deactivate_class_keeps_members_and_exercises(client, db_session):
    cls = await _seed_class(db_session)
    learner = await _seed_user(db_session)
    db_session.add(ClassMember(class_id = cls.id, user_id = learner.id))
    await _seed_exercise(db_session, cls.id)
    await db_session.flush()

    await client.patch(f"{BASE}/{cls.id}/deactivate")

    resp = await client.get(f"{BASE}/{cls.id}")
    assert resp.json()["member_count"] == 1
    assert len(resp.json()["exercises"]) == 1


async def test_bulk_add_requires_at_least_one_filter(client, db_session):
    cls = await _seed_class(db_session)
    resp = await client.post(f"{BASE}/{cls.id}/members/bulk", json = {})
    assert resp.status_code == 400
    assert resp.json()["detail"] == "At least one filter is required."


async def test_bulk_add_by_department(client, db_session):
    cls = await _seed_class(db_session)
    dept = await _seed_department(db_session)
    await _seed_user(db_session, department_id = dept.id)
    await _seed_user(db_session, department_id = dept.id)
    await _seed_user(db_session)  # different department, must not match

    resp = await client.post(
        f"{BASE}/{cls.id}/members/bulk", json = {"department_id": str(dept.id)}
    )
    assert resp.status_code == 200
    assert resp.json() == {"total_matched": 2, "added": 2, "skipped": 0}


async def test_bulk_add_filters_are_anded(client, db_session):
    cls = await _seed_class(db_session)
    dept = await _seed_department(db_session)
    level = await _seed_employee_level(db_session)
    # Matches both filters.
    await _seed_user(db_session, department_id = dept.id, employee_level_id = level.id)
    # Matches only one filter each — AND logic must exclude them.
    await _seed_user(db_session, department_id = dept.id)
    await _seed_user(db_session, employee_level_id = level.id)

    resp = await client.post(
        f"{BASE}/{cls.id}/members/bulk",
        json = {"department_id": str(dept.id), "employee_level_id": str(level.id)},
    )
    assert resp.status_code == 200
    assert resp.json()["added"] == 1


async def test_bulk_add_by_seniority(client, db_session):
    cls = await _seed_class(db_session)
    seniority = await _seed_seniority(db_session)
    await _seed_user(db_session, seniority_id = seniority.id)

    resp = await client.post(
        f"{BASE}/{cls.id}/members/bulk", json = {"seniority_id": str(seniority.id)}
    )
    assert resp.status_code == 200
    assert resp.json()["added"] == 1


async def test_bulk_add_is_idempotent(client, db_session):
    cls = await _seed_class(db_session)
    dept = await _seed_department(db_session)
    await _seed_user(db_session, department_id = dept.id)
    body = {"department_id": str(dept.id)}

    first = await client.post(f"{BASE}/{cls.id}/members/bulk", json = body)
    assert first.json() == {"total_matched": 1, "added": 1, "skipped": 0}

    second = await client.post(f"{BASE}/{cls.id}/members/bulk", json = body)
    assert second.status_code == 200
    assert second.json() == {"total_matched": 1, "added": 0, "skipped": 1}


async def test_bulk_add_skips_admins_and_inactive_users(client, db_session):
    cls = await _seed_class(db_session)
    dept = await _seed_department(db_session)
    await _seed_user(db_session, department_id = dept.id)
    await _seed_user(db_session, department_id = dept.id, role = "admin")
    await _seed_user(db_session, department_id = dept.id, is_active = False)

    resp = await client.post(
        f"{BASE}/{cls.id}/members/bulk", json = {"department_id": str(dept.id)}
    )
    assert resp.json() == {"total_matched": 1, "added": 1, "skipped": 0}


async def test_learner_can_belong_to_multiple_classes(client, db_session):
    dept = await _seed_department(db_session)
    await _seed_user(db_session, department_id = dept.id)
    class_a = await _seed_class(db_session)
    class_b = await _seed_class(db_session)
    body = {"department_id": str(dept.id)}

    assert (await client.post(f"{BASE}/{class_a.id}/members/bulk", json = body)).json()["added"] == 1
    assert (await client.post(f"{BASE}/{class_b.id}/members/bulk", json = body)).json()["added"] == 1

    assert (await client.get(f"{BASE}/{class_a.id}")).json()["member_count"] == 1
    assert (await client.get(f"{BASE}/{class_b.id}")).json()["member_count"] == 1


async def test_bulk_add_class_not_found(client):
    resp = await client.post(
        f"{BASE}/{uuid.uuid4()}/members/bulk",
        json = {"department_id": str(uuid.uuid4())},
    )
    assert resp.status_code == 404
