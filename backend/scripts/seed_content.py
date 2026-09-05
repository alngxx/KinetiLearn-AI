"""Upload the 7 seed documents, tag skills, and generate the 4 Tier 2 exams.

This drives the real HTTP API — nothing internal — so it exercises the actual
upload -> R2 -> Celery -> extract -> chunk -> embed -> Chroma pipeline and the
actual gpt-4o exam generation pipeline. It costs real OpenAI money.

Idempotent by (title, category_id) for documents and by exercise-per-class for
generation: a re-run that finds everything already present adds nothing and
spends nothing.

Run from backend/ with the venv active, against a running docker compose stack:
  python -m scripts.seed_content
"""
import datetime
import os
import sys
import time
from pathlib import Path

import httpx

from scripts.seed_users import ADMIN_PASSWORD

BASE_URL = os.environ.get("KINETILEARN_BASE_URL", "http://localhost:8000")
ADMIN_EMAIL = "admin@kinetilearn.com"

DOCS_DIR = Path(__file__).parent / "seed_docs"

POLL_INTERVAL_SECONDS = 3
POLL_TIMEOUT_SECONDS = 300

# file -> (title, category name, description)
DOCUMENTS = [
    (
        "everyday-workplace-communication.md",
        "Everyday Workplace Communication",
        "Soft Skills",
        "Channel choice, writing clearly, listening, cross-department and remote communication norms.",
    ),
    (
        "working-in-a-team.md",
        "Working in a Team",
        "Soft Skills",
        "Giving and receiving feedback, healthy disagreement, psychological safety, cross-department collaboration.",
    ),
    (
        "personal-data-protection-at-work.md",
        "Personal Data Protection at Work",
        "Compliance",
        "PDPA obligations, consent, breach notification thresholds and deadlines.",
    ),
    (
        "handling-data-day-to-day.md",
        "Handling Data in Day-to-Day Work",
        "Compliance",
        "Data classification, access, sharing, AI tools, device security, incident response.",
    ),
    (
        "workplace-safety-fundamentals.md",
        "Workplace Safety Fundamentals",
        "Compliance",
        "WSH Act duties, emergency procedures, incident reporting, workstation ergonomics.",
    ),
    (
        "claude-and-claude-code-at-kinetilearn.md",
        "Claude and Claude Code at KinetiLearn",
        "Technical",
        "What Claude and Claude Code are, what KinetiLearn actually runs in production, and the project conventions around AI tooling.",
    ),
    (
        "working-effectively-with-claude-code.md",
        "Working Effectively with Claude Code on the KinetiLearn Codebase",
        "Technical",
        "Prompting practice, review discipline, and KinetiLearn-specific gotchas for using Claude Code on this repo.",
    ),
]

# document title -> skill names to tag
DOCUMENT_SKILLS = {
    "Everyday Workplace Communication": ["Communication"],
    "Working in a Team": ["Communication", "Teamwork"],
    "Personal Data Protection at Work": ["Data Privacy"],
    "Handling Data in Day-to-Day Work": ["Data Privacy"],
    "Workplace Safety Fundamentals": ["Workplace Safety"],
    "Claude and Claude Code at KinetiLearn": ["AI-Assisted Development"],
    "Working Effectively with Claude Code on the KinetiLearn Codebase": [
        "AI-Assisted Development"
    ],
}

# class name -> (source document title, admin prompt)
EXAM_PLAN = [
    (
        "Communication & Teamwork Essentials",
        "Working in a Team",
        "Focus on giving and receiving feedback, running effective meetings, and "
        "handling disagreement. Favour situational questions over definitions.",
    ),
    (
        "Data Privacy & Compliance Basics",
        "Personal Data Protection at Work",
        "Cover the consent, purpose limitation, notification and breach "
        "obligations. Include at least three questions on what an employee "
        "must do when they suspect a breach.",
    ),
    (
        "Workplace Safety Fundamentals",
        "Workplace Safety Fundamentals",
        "Cover emergency evacuation, incident reporting, and workstation "
        "ergonomics. Keep questions practical - what the employee should "
        "actually do.",
    ),
    (
        "AI Tooling Enablement",
        "Working Effectively with Claude Code on the KinetiLearn Codebase",
        "Focus on the review discipline, the permission model, and what must "
        "never be pasted into a prompt. Include questions on the "
        "KinetiLearn-specific conventions.",
    ),
]

NUM_QUESTIONS = 10
FINALIZE_DURATION_MINUTES = 30
FINALIZE_PASS_SCORE = 6
FINALIZE_WINDOW_DAYS = 30

DEACTIVATE_DAILY_QUIZ_CONFIGS = ["Daily Quiz 1", "Daily Quiz 2"]


def fail(message: str) -> None:
    print(f"ABORT: {message}")
    sys.exit(1)


def login(client: httpx.Client) -> str:
    response = client.post(
        "/api/v1/auth/login",
        json = {"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
    )
    if response.status_code != 200:
        fail(f"login failed: {response.status_code} {response.text}")
    return response.json()["access_token"]


def get_lookup(client: httpx.Client, path: str, key: str = "name") -> dict:
    response = client.get(path)
    if response.status_code != 200:
        fail(f"GET {path} failed: {response.status_code} {response.text}")
    return {row[key]: row for row in response.json()}


def get_document_detail(client: httpx.Client, document_id: str) -> dict:
    response = client.get(f"/api/v1/documents/{document_id}")
    if response.status_code != 200:
        fail(f"GET document {document_id} failed: {response.status_code} {response.text}")
    return response.json()


def find_version(detail: dict, version_number: int, title: str) -> dict:
    for version in detail["versions"]:
        if version["version_number"] == version_number:
            return version
    fail(f"version {version_number} not found on document '{title}' ({detail['document_id']})")


def latest_version_number(detail: dict) -> int:
    return max(version["version_number"] for version in detail["versions"])


# The detail endpoint nests processing status per version in `versions`, ordered
# by version_number descending — not a flat `active_version_processing_status`
# field, and not necessarily versions[0], since a version only becomes "active"
# once it reaches "ready" (a failed version is never promoted, so
# active_version_number stays null). Track the specific version_number this
# upload or reprocess call returned, not the document's current active version.
def poll_version_ready(
    client: httpx.Client, document_id: str, version_number: int, title: str
) -> None:
    deadline = time.monotonic() + POLL_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        detail = get_document_detail(client, document_id)
        version = find_version(detail, version_number, title)
        status = version["processing_status"]
        if status == "ready":
            return
        if status == "failed":
            fail(
                f"document processing failed for '{title}' v{version_number}: "
                f"{version.get('processing_error')}"
            )
        time.sleep(POLL_INTERVAL_SECONDS)
    fail(f"timed out waiting for '{title}' v{version_number} ({document_id}) to become ready")


def poll_job(client: httpx.Client, job_id: str, class_name: str) -> dict:
    deadline = time.monotonic() + POLL_TIMEOUT_SECONDS
    last = None
    while time.monotonic() < deadline:
        response = client.get(f"/api/v1/exams/jobs/{job_id}")
        if response.status_code != 200:
            fail(f"GET job {job_id} failed: {response.status_code} {response.text}")
        last = response.json()
        status = last["status"]
        if status == "succeeded":
            return last
        if status == "failed":
            fail(f"generation job failed for class '{class_name}': {last.get('error')}")
        time.sleep(POLL_INTERVAL_SECONDS)
    fail(f"timed out waiting for generation job {job_id} ({class_name}): last state {last}")


def main() -> None:
    with httpx.Client(base_url = BASE_URL, timeout = 30.0) as client:
        token = login(client)
        client.headers["Authorization"] = f"Bearer {token}"

        categories = get_lookup(client, "/api/v1/config/categories")
        skills = get_lookup(client, "/api/v1/config/skills")
        classes = get_lookup(client, "/api/v1/classes")

        for filename, title, category_name, _ in DOCUMENTS:
            if category_name not in categories:
                fail(f"category '{category_name}' not found (needed by '{title}')")
        for skill_names in DOCUMENT_SKILLS.values():
            for skill_name in skill_names:
                if skill_name not in skills:
                    fail(f"skill '{skill_name}' not found")
        for class_name, source_title, _ in EXAM_PLAN:
            if class_name not in classes:
                fail(f"class '{class_name}' not found")

        # Step 2: what documents already exist, by (title, category_id).
        existing_response = client.get("/api/v1/documents")
        if existing_response.status_code != 200:
            fail(f"GET /api/v1/documents failed: {existing_response.status_code} {existing_response.text}")
        existing_documents = existing_response.json()
        existing_by_key = {
            (doc["title"], doc["category_id"]): doc for doc in existing_documents
        }

        document_ids_by_title: dict[str, str] = {}
        version_numbers_by_title: dict[str, int] = {}
        uploaded = skipped = reprocessed = 0

        for filename, title, category_name, description in DOCUMENTS:
            category_id = categories[category_name]["id"]
            key = (title, category_id)
            existing = existing_by_key.get(key)
            if existing is not None:
                document_id = existing["document_id"]
                document_ids_by_title[title] = document_id
                skipped += 1

                # Already uploaded on a prior run. If it has an active version,
                # it is already ready — nothing to do. If not, its only/latest
                # version never made it to "ready" (e.g. the worker was running
                # stale code when it was first processed) and needs re-enqueuing;
                # a plain re-upload would create a needless second version.
                detail = get_document_detail(client, document_id)
                if detail["active_version_number"] is not None:
                    version_numbers_by_title[title] = detail["active_version_number"]
                else:
                    version_number = latest_version_number(detail)
                    response = client.post(
                        f"/api/v1/documents/{document_id}/versions/{version_number}/reprocess"
                    )
                    if response.status_code != 200:
                        fail(
                            f"reprocess failed for '{title}' v{version_number}: "
                            f"{response.status_code} {response.text}"
                        )
                    version_numbers_by_title[title] = version_number
                    reprocessed += 1
                continue

            file_path = DOCS_DIR / filename
            if not file_path.exists():
                fail(f"seed doc file missing: {file_path}")

            with open(file_path, "rb") as fh:
                response = client.post(
                    "/api/v1/documents/upload",
                    data = {
                        "title": title,
                        "category_id": category_id,
                        "description": description,
                    },
                    files = {"file": (filename, fh, "text/markdown")},
                )
            if response.status_code != 201:
                fail(f"upload failed for '{title}': {response.status_code} {response.text}")

            body = response.json()
            document_ids_by_title[title] = body["document_id"]
            version_numbers_by_title[title] = body["version_number"]
            uploaded += 1

        # Step 4: every document (new, reprocessed, or already-ready) must reach
        # "ready" on its tracked version before we tag skills or generate from it.
        for filename, title, category_name, description in DOCUMENTS:
            poll_version_ready(
                client,
                document_ids_by_title[title],
                version_numbers_by_title[title],
                title,
            )

        # Step 5: skill tagging. attach_skill is idempotent on the server, so
        # re-tagging an already-tagged document is a harmless no-op.
        tagged = 0
        for title, skill_names in DOCUMENT_SKILLS.items():
            document_id = document_ids_by_title[title]
            for skill_name in skill_names:
                skill_id = skills[skill_name]["id"]
                response = client.post(
                    f"/api/v1/documents/{document_id}/skills/{skill_id}"
                )
                if response.status_code != 200:
                    fail(
                        f"tagging '{title}' with skill '{skill_name}' failed: "
                        f"{response.status_code} {response.text}"
                    )
                tagged += 1

        # Step 6/7: generate exactly 4 exams, one per class, only if that class
        # has no exercise yet — re-running this script must not generate twice.
        exercises_by_class: dict[str, list[dict]] = {}
        for class_name, _, _ in EXAM_PLAN:
            class_id = classes[class_name]["id"]
            response = client.get(f"/api/v1/classes/{class_id}")
            if response.status_code != 200:
                fail(f"GET class {class_id} failed: {response.status_code} {response.text}")
            exercises_by_class[class_name] = response.json()["exercises"]

        generated_exercise_ids: list[str] = []
        generated = skipped_generation = 0

        for class_name, source_title, prompt in EXAM_PLAN:
            if exercises_by_class.get(class_name):
                skipped_generation += 1
                continue

            class_id = classes[class_name]["id"]
            document_id = document_ids_by_title[source_title]

            response = client.post(
                "/api/v1/exams/generate",
                json = {
                    "title": f"{class_name} Exam",
                    "class_id": class_id,
                    "document_ids": [document_id],
                    "num_questions": NUM_QUESTIONS,
                    "prompt": prompt,
                },
            )
            if response.status_code != 202:
                fail(
                    f"generate request failed for class '{class_name}': "
                    f"{response.status_code} {response.text}"
                )
            job = response.json()
            finished = poll_job(client, job["id"], class_name)
            print(
                f"  generation job for '{class_name}': status={finished['status']} "
                f"questions_done={finished['questions_done']}"
            )
            generated_exercise_ids.append(finished["exercise_id"])
            generated += 1

        # Step 8: finalize every exercise generated in this run.
        finalized = 0
        if generated_exercise_ids:
            start = datetime.datetime.now(datetime.timezone.utc)
            end = start + datetime.timedelta(days = FINALIZE_WINDOW_DAYS)
            for exercise_id in generated_exercise_ids:
                response = client.put(
                    f"/api/v1/exams/{exercise_id}/finalize",
                    json = {
                        "start_time": start.isoformat(),
                        "end_time": end.isoformat(),
                        "duration_minutes": FINALIZE_DURATION_MINUTES,
                        "pass_score": FINALIZE_PASS_SCORE,
                    },
                )
                if response.status_code != 200:
                    fail(
                        f"finalize failed for exercise {exercise_id}: "
                        f"{response.status_code} {response.text}"
                    )
                finalized += 1

        # Step 3: deactivate the two pre-existing daily quiz configs.
        configs_response = client.get(
            "/api/v1/daily-quiz-configs", params = {"include_inactive": True}
        )
        if configs_response.status_code != 200:
            fail(f"GET /api/v1/daily-quiz-configs failed: {configs_response.status_code} {configs_response.text}")
        configs_by_name = {c["name"]: c for c in configs_response.json()}

        deactivated = 0
        for name in DEACTIVATE_DAILY_QUIZ_CONFIGS:
            config = configs_by_name.get(name)
            if config is None:
                fail(f"daily quiz config '{name}' not found")
            if not config["is_active"]:
                continue
            response = client.patch(
                f"/api/v1/daily-quiz-configs/{config['id']}/deactivate"
            )
            if response.status_code != 200:
                fail(
                    f"deactivating daily quiz config '{name}' failed: "
                    f"{response.status_code} {response.text}"
                )
            deactivated += 1

    print("Seed content summary:")
    print(f"  Documents: uploaded {uploaded}, skipped {skipped}, reprocessed {reprocessed}")
    print(f"  Skill tags applied: {tagged}")
    print(f"  Exams generated: {generated}, skipped {skipped_generation}")
    print(f"  Exams finalized: {finalized}")
    print(f"  Daily quiz configs deactivated: {deactivated}")


if __name__ == "__main__":
    main()
