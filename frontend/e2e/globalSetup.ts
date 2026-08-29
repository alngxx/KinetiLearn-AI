import { API_URL } from "../playwright.config"

// Playwright can start the dev server but not the stack behind it. Fail here with
// the command to run rather than letting every spec fail on a network error.
export default async function globalSetup() {
  let response: Response
  try {
    response = await fetch(`${API_URL}/health`)
  } catch {
    throw new Error(
      `The API is not reachable at ${API_URL}. Start the stack first: docker compose up`,
    )
  }
  if (!response.ok) {
    throw new Error(`The API answered ${response.status} at ${API_URL}/health. Is it healthy?`)
  }
}
