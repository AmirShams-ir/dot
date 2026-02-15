export default {
  async fetch(request: Request, env: any, ctx: any): Promise<Response> {
    return handle(request, ctx);
  }
};

const CT = "application/dns-message";
const CACHE_TTL = 300;

// Tier-1 upstreams
const UPSTREAMS = [
  "https://cloudflare-dns.com/dns-query",
  "https://dns.google/dns-query",
  "https://dns.quad9.net/dns-query"
];

async function handle(request: Request, ctx: any): Promise<Response> {

  const url = new URL(request.url);

  if (!(url.pathname === "/" || url.pathname === "/dns-query")) {
    return new Response("Not Found", { status: 404 });
  }

  const cache = caches.default;

  // ---------- GET ----------
  if (request.method === "GET") {

    const cacheKey = request;
    const cached = await cache.match(cacheKey);

    if (cached) return cached;

    const response = await raceFetch(
      url.search,
      undefined
    );

    const resp = new Response(response.body, response);

    resp.headers.set("Cache-Control", `public, max-age=${CACHE_TTL}`);
    resp.headers.set("Access-Control-Allow-Origin", "*");

    ctx.waitUntil(cache.put(cacheKey, resp.clone()));

    return resp;
  }

  // ---------- POST ----------
  if (request.method === "POST") {

    const body = await request.arrayBuffer();

    return raceFetch("", body);
  }

  return new Response("Method Not Allowed", { status: 405 });
}

// racing logic
async function raceFetch(search: string, body?: ArrayBuffer): Promise<Response> {

  const controllers = UPSTREAMS.map(() => new AbortController());

  return new Promise((resolve, reject) => {

    let finished = false;

    UPSTREAMS.forEach((upstream, index) => {

      fetch(upstream + search, {
        method: body ? "POST" : "GET",
        headers: {
          "Content-Type": CT,
          "Accept": CT
        },
        body: body,
        signal: controllers[index].signal,
        cf: {
          cacheEverything: true,
          cacheTtl: CACHE_TTL,
        },
        keepalive: true
      })
      .then(response => {

        if (!finished && response.ok) {

          finished = true;

          // cancel other requests
          controllers.forEach((c, i) => {
            if (i !== index) c.abort();
          });

          resolve(response);
        }

      })
      .catch(() => {});

    });

    // safety timeout
    setTimeout(() => {
      if (!finished) reject("All upstreams failed");
    }, 2000);

  });
}
