"""Skill assignment on documents: the document_skills join.

Skills live inside a category (skills.category_id is NOT NULL), so a document
can only carry skills from its own category, and an uncategorized document can
carry none at all. Both the bulk PATCH and the older per-skill attach endpoint
enforce that, so neither is a way around the other.

The AI suggestion endpoint is covered in test_suggest_skills.py.
"""
import uuid

from sqlalchemy import select

from app.modules.config.models import Category, Skill
from app.modules.documents.models import Document, DocumentSkill, DocumentVersion

BASE = "/api/v1/documents"


async def _seed_category(db):
    cat = Category(name = f"Cat {uuid.uuid4()}")
    db.add(cat)
    await db.flush()
    return cat


async def _seed_skill(db, category, name = None):
    skill = Skill(
        category_id = category.id,
        name = name or f"Skill {uuid.uuid4()}",
        basic_max = 50,
        intermediate_max = 80,
    )
    db.add(skill)
    await db.flush()
    return skill


async def _seed_document(db, *, category = None, skills = ()):
    doc = Document(
        title = f"Doc {uuid.uuid4()}",
        category_id = category.id if category else None,
        active_version_number = 1,
    )
    db.add(doc)
    await db.flush()
    db.add(DocumentVersion(
        document_id = doc.id,
        version_number = 1,
        file_url = "documents/x/v1.pdf",
        file_name = "f.pdf",
        file_size_bytes = 10,
        mime_type = "application/pdf",
        processing_status = "ready",
    ))
    for skill in skills:
        db.add(DocumentSkill(document_id = doc.id, skill_id = skill.id))
    await db.flush()
    return doc


async def _linked_skill_ids(db, document_id):
    result = await db.execute(
        select(DocumentSkill.skill_id).where(DocumentSkill.document_id == document_id)
    )
    return set(result.scalars().all())


# --- bulk assignment ------------------------------------------------------

async def test_assign_same_category_skills_persists(client, db_session):
    cat = await _seed_category(db_session)
    first = await _seed_skill(db_session, cat)
    second = await _seed_skill(db_session, cat)
    doc = await _seed_document(db_session, category = cat)
    await db_session.commit()

    resp = await client.patch(
        f"{BASE}/{doc.id}",
        json = {"skill_ids": [str(first.id), str(second.id)]},
    )

    assert resp.status_code == 200
    assert set(resp.json()["skill_ids"]) == {str(first.id), str(second.id)}
    assert await _linked_skill_ids(db_session, doc.id) == {first.id, second.id}


async def test_assign_replaces_the_whole_set(client, db_session):
    cat = await _seed_category(db_session)
    keep = await _seed_skill(db_session, cat)
    drop = await _seed_skill(db_session, cat)
    add = await _seed_skill(db_session, cat)
    doc = await _seed_document(db_session, category = cat, skills = [keep, drop])
    await db_session.commit()

    resp = await client.patch(
        f"{BASE}/{doc.id}",
        json = {"skill_ids": [str(keep.id), str(add.id)]},
    )

    assert resp.status_code == 200
    assert await _linked_skill_ids(db_session, doc.id) == {keep.id, add.id}


async def test_assign_empty_list_clears_every_tag(client, db_session):
    # Unlike class_ids, [] is a real instruction here — a document is allowed to
    # carry no skills.
    cat = await _seed_category(db_session)
    skill = await _seed_skill(db_session, cat)
    doc = await _seed_document(db_session, category = cat, skills = [skill])
    await db_session.commit()

    resp = await client.patch(f"{BASE}/{doc.id}", json = {"skill_ids": []})

    assert resp.status_code == 200
    assert resp.json()["skill_ids"] == []
    assert await _linked_skill_ids(db_session, doc.id) == set()


async def test_patch_without_skill_ids_leaves_them_alone(client, db_session):
    cat = await _seed_category(db_session)
    skill = await _seed_skill(db_session, cat)
    doc = await _seed_document(db_session, category = cat, skills = [skill])
    await db_session.commit()

    resp = await client.patch(f"{BASE}/{doc.id}", json = {"title": "Renamed"})

    assert resp.status_code == 200
    assert resp.json()["title"] == "Renamed"
    assert await _linked_skill_ids(db_session, doc.id) == {skill.id}


# --- the category invariant ----------------------------------------------

async def test_assign_skill_from_another_category_rejected(client, db_session):
    cat = await _seed_category(db_session)
    other = await _seed_category(db_session)
    outsider = await _seed_skill(db_session, other, name = "Outsider skill")
    doc = await _seed_document(db_session, category = cat)
    await db_session.commit()

    resp = await client.patch(
        f"{BASE}/{doc.id}", json = {"skill_ids": [str(outsider.id)]}
    )

    assert resp.status_code == 422
    # Named, so the admin can tell which one was wrong.
    assert "Outsider skill" in resp.json()["detail"]
    assert await _linked_skill_ids(db_session, doc.id) == set()


async def test_assign_with_no_category_rejected(client, db_session):
    cat = await _seed_category(db_session)
    skill = await _seed_skill(db_session, cat)
    doc = await _seed_document(db_session, category = None)
    await db_session.commit()

    resp = await client.patch(f"{BASE}/{doc.id}", json = {"skill_ids": [str(skill.id)]})

    assert resp.status_code == 422
    assert "category" in resp.json()["detail"].lower()
    assert await _linked_skill_ids(db_session, doc.id) == set()


async def test_assign_unknown_skill_rejected(client, db_session):
    cat = await _seed_category(db_session)
    doc = await _seed_document(db_session, category = cat)
    await db_session.commit()
    missing = uuid.uuid4()

    resp = await client.patch(f"{BASE}/{doc.id}", json = {"skill_ids": [str(missing)]})

    assert resp.status_code == 422
    assert str(missing) in resp.json()["detail"]


async def test_attach_endpoint_rejects_a_cross_category_skill(client, db_session):
    # The older per-skill endpoint enforces the same rule, otherwise it would be
    # a way around the bulk one.
    cat = await _seed_category(db_session)
    other = await _seed_category(db_session)
    outsider = await _seed_skill(db_session, other)
    doc = await _seed_document(db_session, category = cat)
    await db_session.commit()

    resp = await client.post(f"{BASE}/{doc.id}/skills/{outsider.id}")

    assert resp.status_code == 422
    assert await _linked_skill_ids(db_session, doc.id) == set()


async def test_detach_is_not_blocked_by_the_category_rule(client, db_session):
    # Removing a tag that should not exist must never be refused.
    cat = await _seed_category(db_session)
    other = await _seed_category(db_session)
    outsider = await _seed_skill(db_session, other)
    doc = await _seed_document(db_session, category = cat, skills = [outsider])
    await db_session.commit()

    resp = await client.delete(f"{BASE}/{doc.id}/skills/{outsider.id}")

    assert resp.status_code == 200
    assert await _linked_skill_ids(db_session, doc.id) == set()


# --- cascade --------------------------------------------------------------

async def test_deleting_a_document_drops_its_skill_rows(client, db_session):
    cat = await _seed_category(db_session)
    skill = await _seed_skill(db_session, cat)
    doc = await _seed_document(db_session, category = cat, skills = [skill])
    await db_session.commit()

    resp = await client.delete(f"{BASE}/{doc.id}")

    assert resp.status_code == 200
    assert await _linked_skill_ids(db_session, doc.id) == set()
    # RESTRICT on the skill side: the skill itself survives.
    assert await db_session.get(Skill, skill.id) is not None
