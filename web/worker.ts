interface Binding {
  fetch(request: Request): Promise<Response>;
}

interface Env {
  LOGIN?: Binding;
  ASSETS?: Binding;
}

const LOGIN_URL = "https://login.mirairesearch.com/";
const SESSION_URL = "https://login.mirairesearch.com/api/session";

function noStore(headers?: HeadersInit): Headers {
  const result = new Headers(headers);
  result.set("Cache-Control", "private, no-store");
  return result;
}

function loginRequired(request: Request): Response {
  const mode = request.headers.get("Sec-Fetch-Mode");
  const acceptsHtml = request.headers.get("Accept")?.includes("text/html") ?? false;
  const isNavigation = request.method === "GET" && (mode === "navigate" || (mode === null && acceptsHtml));

  if (!isNavigation) {
    return new Response("Unauthorized", { status: 401, headers: noStore() });
  }

  const loginUrl = new URL(LOGIN_URL);
  loginUrl.searchParams.set("returnTo", request.url);
  return new Response(null, {
    status: 302,
    headers: noStore({ Location: loginUrl.toString() }),
  });
}

async function hasSession(request: Request, env: Env): Promise<"yes" | "no" | "error"> {
  if (!env.LOGIN || typeof env.LOGIN.fetch !== "function") return "error";

  const cookie = request.headers.get("Cookie");
  if (!cookie) return "no";

  try {
    const response = await env.LOGIN.fetch(new Request(SESSION_URL, {
      method: "GET",
      headers: { Cookie: cookie },
      redirect: "manual",
    }));
    if (response.status === 401) return "no";
    if (response.status !== 200) return "error";

    const body: unknown = await response.json();
    if (
      typeof body === "object" && body !== null && "user" in body &&
      typeof body.user === "object" && body.user !== null &&
      "id" in body.user && typeof body.user.id === "string" && body.user.id.length > 0 &&
      "login" in body.user && typeof body.user.login === "string" && body.user.login.length > 0
    ) {
      return "yes";
    }
    return "error";
  } catch {
    return "error";
  }
}

function isDeepRoute(pathname: string): boolean {
  return /^\/library\/?$/.test(pathname) ||
    /^\/resource\/(?:scenario|trajectory|host|file)\/[^/]+(?:\/[^/]+)?\/?$/.test(pathname);
}

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.protocol !== "https:") {
    url.protocol = "https:";
    return new Response(null, {
      status: 308,
      headers: noStore({ Location: url.toString() }),
    });
  }

  const session = await hasSession(request, env);
  if (session === "no") return loginRequired(request);
  if (session === "error") {
    return new Response("Authentication unavailable", { status: 503, headers: noStore() });
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: noStore({ Allow: "GET, HEAD" }) });
  }

  try {
    if (!env.ASSETS || typeof env.ASSETS.fetch !== "function") throw new Error("Assets binding unavailable");
    const asset = await env.ASSETS.fetch(request);
    let response = asset;
    if (asset.status === 404 && isDeepRoute(url.pathname)) {
      const fallbackUrl = new URL("/", url);
      response = await env.ASSETS.fetch(new Request(fallbackUrl.toString(), request));
    }

    const headers = noStore(response.headers);
    headers.set("X-Content-Type-Options", "nosniff");
    const body = request.method === "HEAD" || response.status === 204 || response.status === 205 || response.status === 304
      ? null : response.body;
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch {
    return new Response("Site unavailable", { status: 503, headers: noStore() });
  }
}

export default { fetch: handleRequest };
