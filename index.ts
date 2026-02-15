export default {
  async fetch(request: Request, env: any, ctx: any): Promise<Response> {
    return handle(request, ctx);
  }
};

const UPSTREAM = "https://security.cloudflare-dns.com/dns-query";
const CT = "application/dns-message";
const CACHE_TTL = 300;

async function handle(request: Request, ctx: any): Promise<Response> {

  const url = new URL(request.url);

  if (!(url.pathname === "/" || url.pathname === "/dns-query")) {
    return new Response("Not Found", { status: 404 });
  }

  const clientIP =
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("x-forwarded-for");

  // GET (cacheable)
  if (request.method === "GET") {

    const cache = caches.default;
    const cacheKey = request;

    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    const upstreamResp = await fetch(UPSTREAM + url.search, {
      headers: { Accept: CT },
      cf: {
        cacheEverything: true,
        cacheTtl: CACHE_TTL,
      },
      keepalive: true,
    });

    const resp = new Response(upstreamResp.body, upstreamResp);

    resp.headers.set("Cache-Control", `public, max-age=${CACHE_TTL}`);
    resp.headers.set("Access-Control-Allow-Origin", "*");

    ctx.waitUntil(cache.put(cacheKey, resp.clone()));

    return resp;
  }

  // POST (used by kdig)
  if (request.method === "POST") {

    const body = await request.arrayBuffer();

    const headers: Record<string, string> = {
      "Content-Type": CT,
      "Accept": CT,
    };

    if (clientIP) {
      headers["CF-Connecting-IP"] = clientIP;
      headers["X-Forwarded-For"] = clientIP;
    }

    return fetch(UPSTREAM, {
      method: "POST",
      headers,
      body,
      cf: {
        cacheEverything: true,
        cacheTtl: CACHE_TTL,
      },
      keepalive: true,
    });
  }

  return new Response("Method Not Allowed", { status: 405 });
}
