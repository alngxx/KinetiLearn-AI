// Where a signed-in user belongs. Roles come from the JWT role claim, which the
// backend sets from users.role.
export function homePathForRole(role: string): string {
  return role === "admin" ? "/admin" : "/learner"
}
