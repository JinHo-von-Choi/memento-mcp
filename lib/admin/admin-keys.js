/**
 * Admin API 키 및 그룹 관리 핸들러
 *
 * 작성자: 최진호
 * 작성일: 2026-03-27
 */

import { readJsonBody }                          from "../utils.js";
import { logError }                              from "../logger.js";
import { DEFAULT_PERMISSIONS, DEFAULT_DAILY_LIMIT } from "../config.js";
import {
  listApiKeys,
  createApiKey,
  updateApiKeyStatus,
  updateFragmentLimit,
  updateDailyLimit,
  updatePermissions,
  updateWorkspace,
  deleteApiKey,
  listKeyGroups,
  createKeyGroup,
  deleteKeyGroup,
  addKeyToGroup,
  removeKeyFromGroup,
  getGroupMembers
} from "./ApiKeyStore.js";
import { safeErrorMessage, ADMIN_BASE } from "./admin-auth.js";

/**
 * /keys 및 /groups 관련 핸들러
 * @returns {boolean} 처리 여부 — false면 호출자가 다음 라우트 탐색
 */
export async function handleKeys(req, res, url) {
  /** GET /keys */
  if (req.method === "GET" && url.pathname === `${ADMIN_BASE}/keys`) {
    try {
      const keys = await listApiKeys();
      res.statusCode = 200;
      res.end(JSON.stringify(keys));
    } catch (err) {
      logError("[Admin] listApiKeys error:", err);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: safeErrorMessage(err) }));
    }
    return true;
  }

  /** POST /keys */
  if (req.method === "POST" && url.pathname === `${ADMIN_BASE}/keys`) {
    try {
      const body = await readJsonBody(req);
      if (!body.name || typeof body.name !== "string") {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "name is required" }));
        return true;
      }
      const key = await createApiKey({
        name:        body.name.trim(),
        permissions: Array.isArray(body.permissions) ? body.permissions : DEFAULT_PERMISSIONS,
        daily_limit: Number(body.daily_limit) || DEFAULT_DAILY_LIMIT
      });
      res.statusCode = 201;
      res.end(JSON.stringify(key));
    } catch (err) {
      if (err.statusCode === 413) {
        res.statusCode = 413;
        res.end(JSON.stringify({ error: "Payload too large" }));
        return true;
      }
      logError("[Admin] createApiKey error:", err);
      res.statusCode = err.message.includes("unique") ? 409 : 500;
      res.end(JSON.stringify({ error: safeErrorMessage(err) }));
    }
    return true;
  }

  /** PUT /keys/:id/daily-limit */
  const dailyLimitMatch = url.pathname.match(
    /^\/v1\/internal\/model\/nothing\/keys\/([^/]+)\/daily-limit$/
  );
  if (req.method === "PUT" && dailyLimitMatch) {
    try {
      const body  = await readJsonBody(req);
      const limit = body.daily_limit;
      if (!Number.isInteger(limit) || limit < 1) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "daily_limit must be a positive integer" }));
        return true;
      }
      const result = await updateDailyLimit(dailyLimitMatch[1], limit);
      res.statusCode = 200;
      res.end(JSON.stringify({ success: true, daily_limit: result.daily_limit }));
    } catch (err) {
      if (err.statusCode === 413) {
        res.statusCode = 413;
        res.end(JSON.stringify({ error: "Payload too large" }));
        return true;
      }
      logError("[Admin] updateDailyLimit error:", err);
      res.statusCode = err.message === "Key not found" ? 404 : 400;
      res.end(JSON.stringify({ error: safeErrorMessage(err) }));
    }
    return true;
  }

  /** PUT /keys/:id/permissions */
  const permMatch = url.pathname.match(
    /^\/v1\/internal\/model\/nothing\/keys\/([^/]+)\/permissions$/
  );
  if (req.method === "PUT" && permMatch) {
    try {
      const body   = await readJsonBody(req);
      const result = await updatePermissions(permMatch[1], body.permissions);
      res.statusCode = 200;
      res.end(JSON.stringify({ success: true, permissions: result.permissions }));
    } catch (err) {
      if (err.statusCode === 413) {
        res.statusCode = 413;
        res.end(JSON.stringify({ error: "Payload too large" }));
        return true;
      }
      logError("[Admin] updatePermissions error:", err);
      res.statusCode = err.message === "Key not found" ? 404 : 400;
      res.end(JSON.stringify({ error: safeErrorMessage(err) }));
    }
    return true;
  }

  /** PUT /keys/:id/fragment-limit */
  const fragLimitMatch = url.pathname.match(
    /^\/v1\/internal\/model\/nothing\/keys\/([^/]+)\/fragment-limit$/
  );
  if (req.method === "PUT" && fragLimitMatch) {
    try {
      const body  = await readJsonBody(req);
      const limit = body.fragment_limit;

      if (limit !== null && (!Number.isInteger(limit) || limit < 0)) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "fragment_limit must be null, 0, or a positive integer" }));
        return true;
      }

      const result = await updateFragmentLimit(fragLimitMatch[1], limit);
      res.statusCode = 200;
      res.end(JSON.stringify({ success: true, fragment_limit: result.fragment_limit }));
    } catch (err) {
      if (err.statusCode === 413) {
        res.statusCode = 413;
        res.end(JSON.stringify({ error: "Payload too large" }));
        return true;
      }
      logError("[Admin] updateFragmentLimit error:", err);
      res.statusCode = err.message === "Key not found" ? 404 : 400;
      res.end(JSON.stringify({ error: safeErrorMessage(err) }));
    }
    return true;
  }

  /** PATCH /keys/:id/workspace */
  const workspaceMatch = url.pathname.match(new RegExp(`^${ADMIN_BASE}/keys/([^/]+)/workspace$`));
  if (req.method === "PATCH" && workspaceMatch) {
    try {
      const body      = await readJsonBody(req);
      const workspace = body.workspace !== undefined ? body.workspace : undefined;
      if (workspace !== null && workspace !== undefined && typeof workspace !== "string") {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "workspace must be a string or null" }));
        return true;
      }
      const result = await updateWorkspace(workspaceMatch[1], workspace ?? null);
      res.statusCode = 200;
      res.end(JSON.stringify({ success: true, default_workspace: result.default_workspace }));
    } catch (err) {
      if (err.statusCode === 413) {
        res.statusCode = 413;
        res.end(JSON.stringify({ error: "Payload too large" }));
        return true;
      }
      logError("[Admin] updateWorkspace error:", err);
      res.statusCode = err.message === "Key not found" ? 404 : 500;
      res.end(JSON.stringify({ error: safeErrorMessage(err) }));
    }
    return true;
  }

  /** PUT /keys/:id */
  const putMatch = url.pathname.match(/^\/v1\/internal\/model\/nothing\/keys\/([^/]+)$/);
  if (req.method === "PUT" && putMatch) {
    try {
      const body   = await readJsonBody(req);
      const result = await updateApiKeyStatus(putMatch[1], body.status);
      res.statusCode = 200;
      res.end(JSON.stringify(result));
    } catch (err) {
      if (err.statusCode === 413) {
        res.statusCode = 413;
        res.end(JSON.stringify({ error: "Payload too large" }));
        return true;
      }
      logError("[Admin] updateApiKeyStatus error:", err);
      res.statusCode = err.message === "Key not found" ? 404 : 400;
      res.end(JSON.stringify({ error: safeErrorMessage(err) }));
    }
    return true;
  }

  /** DELETE /keys/:id */
  const delMatch = url.pathname.match(/^\/v1\/internal\/model\/nothing\/keys\/([^/]+)$/);
  if (req.method === "DELETE" && delMatch) {
    try {
      await deleteApiKey(delMatch[1]);
      res.statusCode = 204;
      res.end();
    } catch (err) {
      logError("[Admin] deleteApiKey error:", err);
      res.statusCode = err.message === "Key not found" ? 404 : 500;
      res.end(JSON.stringify({ error: safeErrorMessage(err) }));
    }
    return true;
  }

  /** ─── 그룹 라우트 ─────────────────────────────────────── */

  /** GET /groups */
  if (req.method === "GET" && url.pathname === `${ADMIN_BASE}/groups`) {
    try {
      const groups = await listKeyGroups();
      res.statusCode = 200;
      res.end(JSON.stringify(groups));
    } catch (err) {
      logError("[Admin] listKeyGroups error:", err);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: safeErrorMessage(err) }));
    }
    return true;
  }

  /** POST /groups */
  if (req.method === "POST" && url.pathname === `${ADMIN_BASE}/groups`) {
    try {
      const body = await readJsonBody(req);
      if (!body.name || typeof body.name !== "string") {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "name is required" }));
        return true;
      }
      const group = await createKeyGroup({
        name       : body.name.trim(),
        description: body.description || null
      });
      res.statusCode = 201;
      res.end(JSON.stringify(group));
    } catch (err) {
      logError("[Admin] createKeyGroup error:", err);
      res.statusCode = err.message.includes("unique") ? 409 : 500;
      res.end(JSON.stringify({ error: safeErrorMessage(err) }));
    }
    return true;
  }

  /** /groups/:id/members 라우트 */
  const membersMatch = url.pathname.match(/^\/v1\/internal\/model\/nothing\/groups\/([^/]+)\/members$/);
  if (membersMatch) {
    /** GET /groups/:id/members */
    if (req.method === "GET") {
      try {
        const members = await getGroupMembers(membersMatch[1]);
        res.statusCode = 200;
        res.end(JSON.stringify(members));
      } catch (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: safeErrorMessage(err) }));
      }
      return true;
    }

    /** POST /groups/:id/members */
    if (req.method === "POST") {
      try {
        const body = await readJsonBody(req);
        if (!body.key_id) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "key_id is required" }));
          return true;
        }
        const result = await addKeyToGroup(body.key_id, membersMatch[1]);
        res.statusCode = 200;
        res.end(JSON.stringify(result));
      } catch (err) {
        res.statusCode = err.message.includes("violates") ? 404 : 500;
        res.end(JSON.stringify({ error: safeErrorMessage(err) }));
      }
      return true;
    }
  }

  /** DELETE /groups/:groupId/members/:keyId */
  const removeMemberMatch = url.pathname.match(
    /^\/v1\/internal\/model\/nothing\/groups\/([^/]+)\/members\/([^/]+)$/
  );
  if (req.method === "DELETE" && removeMemberMatch) {
    try {
      const result = await removeKeyFromGroup(removeMemberMatch[2], removeMemberMatch[1]);
      res.statusCode = 200;
      res.end(JSON.stringify(result));
    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: safeErrorMessage(err) }));
    }
    return true;
  }

  /** DELETE /groups/:id */
  const delGroupMatch = url.pathname.match(/^\/v1\/internal\/model\/nothing\/groups\/([^/]+)$/);
  if (req.method === "DELETE" && delGroupMatch) {
    try {
      await deleteKeyGroup(delGroupMatch[1]);
      res.statusCode = 200;
      res.end(JSON.stringify({ deleted: true }));
    } catch (err) {
      logError("[Admin] deleteKeyGroup error:", err);
      res.statusCode = err.message === "Group not found" ? 404 : 500;
      res.end(JSON.stringify({ error: safeErrorMessage(err) }));
    }
    return true;
  }

  return false;
}
