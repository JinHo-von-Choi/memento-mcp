/**
 * RBAC - 도구별 권한 매핑 및 검증
 *
 * 작성자: 최진호
 * 작성일: 2026-03-27
 */

export const TOOL_PERMISSIONS = {
  remember:              "write",
  batch_remember:        "write",
  recall:                "read",
  forget:                "write",
  link:                  "write",
  amend:                 "write",
  reflect:               "write",
  context:               "read",
  tool_feedback:         "write",
  memory_stats:          "read",
  memory_consolidate:    "admin",
  graph_explore:         "read",
  fragment_history:      "read",
  reconstruct_history:   "read",
  search_traces:         "read",
  get_skill_guide:       "read",
  check_update:          "admin",
  apply_update:          "admin",
};

/**
 * 권한 검증
 * @param {string[]|null} permissions - null이면 master key (전체 허용)
 * @param {string} toolName
 * @returns {{ allowed: boolean, required?: string, reason?: string }}
 */
export function checkPermission(permissions, toolName) {
  const required = TOOL_PERMISSIONS[toolName];
  if (!required) return { allowed: true };
  if (!permissions) return { allowed: true };
  if (permissions.includes(required)) return { allowed: true };
  if (permissions.includes("admin")) return { allowed: true };
  return { allowed: false, required };
}
