"""AI skill suggestion: POST /documents/{id}/suggest-skills.

Read-only by contract — it asks GPT-4o which of the category's skills the
document teaches and returns ids for the admin to confirm. Nothing reaches
document_skills until the admin saves through the PATCH covered in
test_document_skills.py.

The model is mocked everywhere here; these tests are about what the endpoint
does with its answer, especially what it refuses to believe.
"""
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from openai import OpenAIError
from sqlalchemy import select

from app.modules.config.models import Category, Skill
from app.modules.documents.models import Document, DocumentChunk, DocumentSkill, DocumentVersion

BASE = "/api/v1/documents"


def _completion(names, refusal = None, tokens = (100, 20, 120)):
    prompt_tokens, completion_tokens, total_tokens = tokens
    message = SimpleNamespace(
        refusal = refusal,
        parsed = SimpleNamespace(skill_names = names),
    )
    return SimpleNamespace(
        choices = [SimpleNamespace(message = message)],
        usage = SimpleNamespace(
            prompt_tokens = prompt_tokens,
            completion_tokens = completion_tokens,
            total_tokens = total_tokens,
        ),
    )


def _patch_parse(mock):
    # Patch the lazy client accessor, not the SDK module — same seam the exam
    # generation tests use.
    client = SimpleNamespace(
        chat = SimpleNamespace(completions = SimpleNamespace(parse = mock))
    )
    return patch("app.core.llm._get_client", return_value = client)


async def _seed_category(db, name = None):
    cat = Category(name = name or f"Cat {uuid.uuid4()}")
    db.add(cat)
    await db.flush()
    return cat


async def _seed_skill(db, category, name):
    skill = Skill(
        category_id = category.id, name = name, basic_max = 50, intermediate_max = 80
    )
    db.add(skill)
    await db.flush()
    return skill


async def _seed_document(db, *, category = None, chunks = ("Some training content.",)):
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
    for index, content in enumerate(chunks):
        db.add(DocumentChunk(
            document_id = doc.id,
            version_number = 1,
            chunk_index = index,
            content = content,
        ))
    await db.flush()
    return doc


async def test_suggestion_returns_ids_for_the_documents_own_category(client, db_session):
    cat = await _seed_category(db_session, "Technical")
    wanted = await _seed_skill(db_session, cat, "Python Programming")
    await _seed_skill(db_session, cat, "System Design")
    doc = await _seed_document(db_session, category = cat)
    await db_session.commit()

    parse = AsyncMock(side_effect = [_completion(["Python Programming"])])
    with _patch_parse(parse):
        resp = await client.post(f"{BASE}/{doc.id}/suggest-skills")

    assert resp.status_code == 200
    assert resp.json()["skill_ids"] == [str(wanted.id)]
    assert resp.json()["total_tokens"] == 120


async def test_suggestion_only_offers_skills_from_that_category(client, db_session):
    # A same-named skill in another category must not be reachable.
    cat = await _seed_category(db_session)
    other = await _seed_category(db_session)
    mine = await _seed_skill(db_session, cat, "Shared name")
    await _seed_skill(db_session, other, "Other only")
    doc = await _seed_document(db_session, category = cat)
    await db_session.commit()

    parse = AsyncMock(side_effect = [_completion(["Shared name", "Other only"])])
    with _patch_parse(parse):
        resp = await client.post(f"{BASE}/{doc.id}/suggest-skills")

    assert resp.status_code == 200
    assert resp.json()["skill_ids"] == [str(mine.id)]
    # The prompt only ever named this category's skills.
    sent = parse.await_args.kwargs["messages"][1]["content"]
    assert "Shared name" in sent
    assert "Other only" not in sent


async def test_a_name_outside_the_list_is_dropped(client, db_session):
    cat = await _seed_category(db_session)
    real = await _seed_skill(db_session, cat, "Data Privacy")
    doc = await _seed_document(db_session, category = cat)
    await db_session.commit()

    parse = AsyncMock(side_effect = [
        _completion(["Data Privacy", "Machine Learning", "Kubernetes"])
    ])
    with _patch_parse(parse):
        resp = await client.post(f"{BASE}/{doc.id}/suggest-skills")

    assert resp.status_code == 200
    # Invented names never make it back out.
    assert resp.json()["skill_ids"] == [str(real.id)]


async def test_an_entirely_invented_answer_yields_nothing(client, db_session):
    cat = await _seed_category(db_session)
    await _seed_skill(db_session, cat, "Data Privacy")
    doc = await _seed_document(db_session, category = cat)
    await db_session.commit()

    parse = AsyncMock(side_effect = [_completion(["Rock Climbing"])])
    with _patch_parse(parse):
        resp = await client.post(f"{BASE}/{doc.id}/suggest-skills")

    assert resp.status_code == 200
    assert resp.json()["skill_ids"] == []


async def test_suggestion_writes_nothing(client, db_session):
    cat = await _seed_category(db_session)
    await _seed_skill(db_session, cat, "Data Privacy")
    doc = await _seed_document(db_session, category = cat)
    await db_session.commit()

    parse = AsyncMock(side_effect = [_completion(["Data Privacy"])])
    with _patch_parse(parse):
        resp = await client.post(f"{BASE}/{doc.id}/suggest-skills")

    assert resp.status_code == 200
    assert resp.json()["skill_ids"] != []
    # Suggested, not saved.
    result = await db_session.execute(
        select(DocumentSkill.skill_id).where(DocumentSkill.document_id == doc.id)
    )
    assert result.scalars().all() == []


async def test_document_with_no_category_rejected(client, db_session):
    doc = await _seed_document(db_session, category = None)
    await db_session.commit()

    parse = AsyncMock()
    with _patch_parse(parse):
        resp = await client.post(f"{BASE}/{doc.id}/suggest-skills")

    assert resp.status_code == 422
    assert "category" in resp.json()["detail"].lower()
    # Refused before spending anything on OpenAI.
    parse.assert_not_awaited()


async def test_category_with_no_skills_skips_the_model(client, db_session):
    cat = await _seed_category(db_session)
    doc = await _seed_document(db_session, category = cat)
    await db_session.commit()

    parse = AsyncMock()
    with _patch_parse(parse):
        resp = await client.post(f"{BASE}/{doc.id}/suggest-skills")

    assert resp.status_code == 200
    assert resp.json()["skill_ids"] == []
    parse.assert_not_awaited()


async def test_document_with_no_processed_content_rejected(client, db_session):
    cat = await _seed_category(db_session)
    await _seed_skill(db_session, cat, "Data Privacy")
    doc = await _seed_document(db_session, category = cat, chunks = ())
    await db_session.commit()

    parse = AsyncMock()
    with _patch_parse(parse):
        resp = await client.post(f"{BASE}/{doc.id}/suggest-skills")

    assert resp.status_code == 422
    parse.assert_not_awaited()


async def test_excerpt_is_capped_and_read_from_chunks(client, db_session):
    from app.modules.documents.service import MAX_SUGGEST_CHUNKS

    cat = await _seed_category(db_session)
    await _seed_skill(db_session, cat, "Data Privacy")
    doc = await _seed_document(
        db_session,
        category = cat,
        chunks = tuple(f"chunk-{i}" for i in range(MAX_SUGGEST_CHUNKS + 5)),
    )
    await db_session.commit()

    parse = AsyncMock(side_effect = [_completion([])])
    with _patch_parse(parse):
        resp = await client.post(f"{BASE}/{doc.id}/suggest-skills")

    assert resp.status_code == 200
    sent = parse.await_args.kwargs["messages"][1]["content"]
    assert "chunk-0" in sent
    assert f"chunk-{MAX_SUGGEST_CHUNKS - 1}" in sent
    # Capped, so the tail of a long document is left out rather than blowing up
    # the prompt.
    assert f"chunk-{MAX_SUGGEST_CHUNKS}" not in sent


async def test_openai_failure_becomes_502(client, db_session):
    cat = await _seed_category(db_session)
    await _seed_skill(db_session, cat, "Data Privacy")
    doc = await _seed_document(db_session, category = cat)
    await db_session.commit()

    parse = AsyncMock(side_effect = OpenAIError("rate limited"))
    with _patch_parse(parse):
        resp = await client.post(f"{BASE}/{doc.id}/suggest-skills")

    assert resp.status_code == 502
    assert resp.json() == {"detail": "Could not generate a suggestion"}


async def test_unknown_document_404(client, db_session):
    resp = await client.post(f"{BASE}/{uuid.uuid4()}/suggest-skills")
    assert resp.status_code == 404
