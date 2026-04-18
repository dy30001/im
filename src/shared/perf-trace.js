const PERF_TRACE_KEY = Symbol.for("codex.im.perfTrace");

function shouldLogPerf(runtime) {
  return Boolean(runtime?.config?.performanceLogs || runtime?.config?.verboseCodexLogs);
}

function attachPerfTrace(target, trace) {
  if (!isObjectLike(target) || !isObjectLike(trace)) {
    return trace || null;
  }
  Object.defineProperty(target, PERF_TRACE_KEY, {
    value: trace,
    configurable: true,
    writable: true,
    enumerable: false,
  });
  return trace;
}

function getPerfTrace(target) {
  if (!isObjectLike(target)) {
    return null;
  }
  const trace = target[PERF_TRACE_KEY];
  return isObjectLike(trace) ? trace : null;
}

function ensurePerfTrace(target, seed = {}) {
  if (!isObjectLike(target)) {
    return null;
  }
  const existing = getPerfTrace(target);
  if (existing) {
    return setPerfTraceFields(existing, seed);
  }
  const trace = setPerfTraceFields({
    startedAt: Date.now(),
    stageDurationsMs: {},
    flags: {},
  }, seed);
  return attachPerfTrace(target, trace);
}

function setPerfTraceFields(targetOrTrace, fields = {}) {
  const trace = resolveTrace(targetOrTrace);
  if (!trace || !isObjectLike(fields)) {
    return trace;
  }

  for (const [key, value] of Object.entries(fields)) {
    if (!key || value === undefined || value === null) {
      continue;
    }
    if (typeof value === "string") {
      const normalized = value.trim();
      if (normalized) {
        trace[key] = normalized;
      }
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      trace[key] = Math.max(0, Math.round(value));
      continue;
    }
    if (typeof value === "boolean") {
      trace[key] = value;
    }
  }

  return trace;
}

function markPerfStage(targetOrTrace, stageName, startedAt, extra = {}) {
  const trace = resolveTrace(targetOrTrace);
  const normalizedStageName = String(stageName || "").trim();
  if (!trace || !normalizedStageName) {
    return trace;
  }
  if (!isObjectLike(trace.stageDurationsMs)) {
    trace.stageDurationsMs = {};
  }
  trace.stageDurationsMs[normalizedStageName] = calculatePerfDurationMs(startedAt);
  return setPerfTraceFields(trace, extra);
}

function markPerfTimestamp(targetOrTrace, fieldName, timestamp = Date.now()) {
  const trace = resolveTrace(targetOrTrace);
  const normalizedFieldName = String(fieldName || "").trim();
  if (!trace || !normalizedFieldName) {
    return trace;
  }
  const normalizedTimestamp = Number(timestamp);
  if (!Number.isFinite(normalizedTimestamp)) {
    return trace;
  }
  trace[normalizedFieldName] = Math.max(0, Math.round(normalizedTimestamp));
  return trace;
}

function getPerfFlag(targetOrTrace, flagName) {
  const trace = resolveTrace(targetOrTrace);
  const normalizedFlagName = String(flagName || "").trim();
  if (!trace || !normalizedFlagName || !isObjectLike(trace.flags)) {
    return false;
  }
  return Boolean(trace.flags[normalizedFlagName]);
}

function setPerfFlag(targetOrTrace, flagName, value = true) {
  const trace = resolveTrace(targetOrTrace);
  const normalizedFlagName = String(flagName || "").trim();
  if (!trace || !normalizedFlagName) {
    return trace;
  }
  if (!isObjectLike(trace.flags)) {
    trace.flags = {};
  }
  trace.flags[normalizedFlagName] = Boolean(value);
  return trace;
}

function calculatePerfDurationMs(startedAt, endedAt = Date.now()) {
  const start = Number(startedAt);
  const end = Number(endedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return 0;
  }
  return Math.max(0, Math.round(end - start));
}

function logPerf(runtime, label, fields = {}) {
  const normalizedLabel = String(label || "").trim();
  if (!shouldLogPerf(runtime) || !normalizedLabel) {
    return false;
  }

  const parts = [];
  for (const [key, value] of Object.entries(fields || {})) {
    const normalizedKey = String(key || "").trim();
    const normalizedValue = formatPerfFieldValue(value);
    if (!normalizedKey || normalizedValue === "") {
      continue;
    }
    parts.push(`${normalizedKey}=${normalizedValue}`);
  }

  console.log(`[codex-im][perf] ${normalizedLabel}${parts.length ? ` ${parts.join(" ")}` : ""}`);
  return true;
}

function formatPerfFieldValue(value) {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(Math.max(0, Math.round(value))) : "";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  const text = String(value || "").trim();
  return text ? text.replace(/\s+/g, " ") : "";
}

function resolveTrace(targetOrTrace) {
  if (!isObjectLike(targetOrTrace)) {
    return null;
  }
  const attachedTrace = getPerfTrace(targetOrTrace);
  if (attachedTrace) {
    return attachedTrace;
  }
  if (Object.prototype.hasOwnProperty.call(targetOrTrace, "startedAt")) {
    return targetOrTrace;
  }
  return null;
}

function isObjectLike(value) {
  return value !== null && (typeof value === "object" || typeof value === "function");
}

module.exports = {
  attachPerfTrace,
  calculatePerfDurationMs,
  ensurePerfTrace,
  getPerfFlag,
  getPerfTrace,
  logPerf,
  markPerfStage,
  markPerfTimestamp,
  setPerfFlag,
  setPerfTraceFields,
  shouldLogPerf,
};
