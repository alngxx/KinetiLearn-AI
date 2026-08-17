# KinetiLearn frontend

React + TypeScript + Vite + Tailwind v4 + shadcn/ui.

## Setup

```
npm install
cp .env.example .env.development   # already committed; copy only if you need to change the API URL
npm run dev
```

`VITE_API_BASE_URL` must be set or the app throws at boot (`src/lib/apiClient.ts`).

## Commands

| command | what it does |
|---|---|
| `npm run dev` | dev server on http://localhost:5173 |
| `npm run build` | typecheck (`tsc -b`) then production build |
| `npm test` | Vitest unit tests |
| `npm run gen:api` | regenerate `src/types/api.ts` from the live backend |

### Regenerating API types

`src/types/api.ts` is generated, committed, and never edited by hand. The backend
must be running, since it reads the live schema:

```
cd backend && uvicorn app.main:app --reload   # in another terminal
npm run gen:api
```

Re-run it whenever a backend router or schema changes.

## Structure

```
src/lib/        apiClient, errors, sseClient, tokenStorage, queryClient
src/modules/    one folder per feature, mirroring backend/app/modules/
src/layouts/    AdminLayout, LearnerLayout
src/components/ shadcn/ui primitives
```

`src/lib/` never imports from `src/modules/`. Only `apiClient.ts` reads
`import.meta.env`. Each feature module owns its own `api.ts`.

## Notes

- Auth is a bearer token in localStorage. There is no refresh endpoint, so an
  expired token means signing in again — an accepted MVP limitation.
- The client-side expiry check in `AuthContext` is a UX shortcut, never a
  security boundary. The backend validates every request.
- Chat streaming uses `fetch` + `ReadableStream` (`src/lib/sseClient.ts`), not
  `EventSource`, which is GET-only and cannot send an Authorization header.
