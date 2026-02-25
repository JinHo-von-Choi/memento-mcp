/**
 * 도구 레지스트리 (Memory Only)
 *
 * memento-mcp: 기억 도구 11개만 등록
 */

import {
  tool_remember,
  tool_recall,
  tool_forget,
  tool_link,
  tool_amend,
  tool_reflect,
  tool_context,
  tool_toolFeedback,
  tool_memoryStats,
  tool_memoryConsolidate,
  tool_graphExplore
} from "./tools/index.js";

export const TOOL_REGISTRY = new Map([
  ["remember",          { handler: tool_remember,         log: (args) => `Memory remember: topic=${args.topic}, type=${args.type}` }],
  ["recall",            { handler: tool_recall,           log: (args) => `Memory recall: keywords=${args.keywords?.join(",") || ""}, topic=${args.topic || ""}` }],
  ["forget",            { handler: tool_forget,           log: (args) => `Memory forget: id=${args.id || ""}, topic=${args.topic || ""}` }],
  ["link",              { handler: tool_link,             log: (args) => `Memory link: ${args.fromId} → ${args.toId}` }],
  ["amend",             { handler: tool_amend,            log: (args) => `Memory amend: id=${args.id}` }],
  ["reflect",           { handler: tool_reflect,          log: (args) => `Memory reflect: session=${args.sessionId || "unknown"}` }],
  ["context",           { handler: tool_context,          log: (_args, result) => `Memory context: ${result.count || 0} fragments loaded` }],
  ["tool_feedback",     { handler: tool_toolFeedback,     log: (args) => `Tool feedback: ${args.tool_name} relevant=${args.relevant} sufficient=${args.sufficient}` }],
  ["memory_stats",      { handler: tool_memoryStats,      log: () => "Memory stats retrieved" }],
  ["memory_consolidate",{ handler: tool_memoryConsolidate,log: () => "Memory consolidation executed" }],
  ["graph_explore",     { handler: tool_graphExplore,     log: (args) => `RCA graph explore: startId=${args.startId}` }]
]);
