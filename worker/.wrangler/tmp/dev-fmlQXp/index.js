var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.ts
import PAGE_HTML from "./36e74bf53c10816d698ca27b7a1af6ea4d8a873a-page.html";
var STATION_ID = "<station-id>";
var STATION_NAME = "<station> Ave";
var STATUS_URL = "https://gbfs.lyftbikes.com/gbfs/en/station_status.json";
var TZ = "America/Los_Angeles";
function extractStation(text, id) {
  const k = text.indexOf(id);
  if (k < 0) return null;
  let depth = 0;
  let start = -1;
  for (let i = k; i >= 0; i--) {
    const c = text[i];
    if (c === "}") depth++;
    else if (c === "{") {
      if (depth === 0) {
        start = i;
        break;
      }
      depth--;
    }
  }
  if (start < 0) return null;
  depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
__name(extractStation, "extractStation");
var DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
function sfLocalParts(tsMs) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(new Date(tsMs));
  const get = /* @__PURE__ */ __name((t) => parts.find((p) => p.type === t)?.value ?? "", "get");
  const hour = parseInt(get("hour"), 10) % 24;
  return { dow: DOW[get("weekday")] ?? 0, minute: hour * 60 + parseInt(get("minute"), 10) };
}
__name(sfLocalParts, "sfLocalParts");
async function samplePoll(env) {
  const res = await fetch(STATUS_URL);
  if (!res.ok) throw new Error(`GBFS fetch failed: ${res.status}`);
  const text = await res.text();
  let st = extractStation(text, STATION_ID);
  if (!st) {
    const data = JSON.parse(text);
    st = data.data?.stations?.find((s) => s.station_id === STATION_ID) ?? null;
  }
  if (!st) throw new Error("station not found in feed");
  const now = Date.now();
  const { dow, minute } = sfLocalParts(now);
  await env.DB.prepare(
    `INSERT OR REPLACE INTO samples (ts, last_reported, dow, minute, bikes_total, ebikes, docks)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    Math.floor(now / 1e3),
    st.last_reported ?? null,
    dow,
    minute,
    st.num_bikes_available ?? 0,
    st.num_ebikes_available ?? 0,
    st.num_docks_available ?? 0
  ).run();
}
__name(samplePoll, "samplePoll");
var JSON_HEADERS = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
  "cache-control": "public, max-age=30"
};
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}
__name(json, "json");
var src_default = {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(samplePoll(env));
  },
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/api/now") {
      const row = await env.DB.prepare(
        "SELECT ts, bikes_total, ebikes, docks FROM samples ORDER BY ts DESC LIMIT 1"
      ).first();
      return json({ station: STATION_NAME, ...row ?? { ts: null } });
    }
    if (url.pathname === "/api/recent") {
      const hours = Math.min(Math.max(Number(url.searchParams.get("hours")) || 48, 1), 24 * 14);
      const since = Math.floor(Date.now() / 1e3) - hours * 3600;
      const { results } = await env.DB.prepare(
        "SELECT ts, bikes_total, ebikes FROM samples WHERE ts >= ? ORDER BY ts"
      ).bind(since).all();
      return json({
        station: STATION_NAME,
        samples: results.map(
          (r) => [r.ts, r.ebikes, r.bikes_total - r.ebikes]
        )
      });
    }
    if (url.pathname === "/api/heatmap") {
      const weeks = Math.min(Math.max(Number(url.searchParams.get("weeks")) || 8, 1), 52);
      const since = Math.floor(Date.now() / 1e3) - weeks * 7 * 86400;
      const { results } = await env.DB.prepare(
        `SELECT dow, minute / 30 AS bucket,
                AVG(ebikes) AS ebikes,
                AVG(bikes_total - ebikes) AS classic,
                COUNT(*) AS n
         FROM samples WHERE ts >= ?
         GROUP BY dow, bucket ORDER BY dow, bucket`
      ).bind(since).all();
      return json({ station: STATION_NAME, weeks, bucketMinutes: 30, cells: results });
    }
    if (url.pathname === "/") {
      return new Response(PAGE_HTML, {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" }
      });
    }
    return json({ error: "not found" }, 404);
  }
};

// ../../../../.npm/_npx/d77349f55c2be1c0/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../../.npm/_npx/d77349f55c2be1c0/node_modules/wrangler/templates/middleware/middleware-scheduled.ts
var scheduled = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  const url = new URL(request.url);
  if (url.pathname === "/__scheduled") {
    const cron = url.searchParams.get("cron") ?? "";
    await middlewareCtx.dispatch("scheduled", { cron });
    return new Response("Ran scheduled event");
  }
  const resp = await middlewareCtx.next(request, env);
  if (request.headers.get("referer")?.endsWith("/__scheduled") && url.pathname === "/favicon.ico" && resp.status === 500) {
    return new Response(null, { status: 404 });
  }
  return resp;
}, "scheduled");
var middleware_scheduled_default = scheduled;

// ../../../../.npm/_npx/d77349f55c2be1c0/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-l5PKcc/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_scheduled_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// ../../../../.npm/_npx/d77349f55c2be1c0/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-l5PKcc/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
