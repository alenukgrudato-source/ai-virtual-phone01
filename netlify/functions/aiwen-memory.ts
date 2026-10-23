type NetlifyUser = { id?: string } | undefined;

type NetlifyContext = { user?: NetlifyUser };

type SharedEventMemory = { content: string; created_at?: string };

const CHARACTER_ID = "aiwen_test";
const MEMORY_TYPE = "event";
const MAX_MEMORIES = 10;
const MAX_TEXT_CHARACTERS = 6000;

function response(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      Pragma: "no-cache",
      Vary: "Cookie",
    },
  });
}

function isAuthorizedNetlifyUser(
  user: NetlifyUser,
  allowedUserId: string | undefined,
): boolean {
  const userId = user?.id;
  return Boolean(userId && allowedUserId && userId === allowedUserId);
}

function limitMemories(input: unknown): SharedEventMemory[] {
  if (!Array.isArray(input)) return [];
  let remaining = MAX_TEXT_CHARACTERS;
  const result: SharedEventMemory[] = [];

  for (const item of input.slice(0, MAX_MEMORIES)) {
    if (!item || typeof item !== "object" || typeof item.content !== "string") continue;
    if (item.character_id !== CHARACTER_ID || item.memory_type !== MEMORY_TYPE) continue;
    if (remaining <= 0) break;
    const content = item.content.slice(0, remaining);
    remaining -= content.length;
    if (!content.trim()) continue;
    result.push({
      content,
      ...(typeof item.created_at === "string" ? { created_at: item.created_at } : {}),
    });
  }

  return result;
}

async function readSharedEventMemories(
  env: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch,
): Promise<SharedEventMemory[]> {
  const supabaseUrl = env.AIWEN_SUPABASE_URL;
  const serviceRoleKey = env.AIWEN_SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) throw new Error("Shared memory storage is not configured");

  const endpoint = new URL("/rest/v1/ai_shared_memories", supabaseUrl);
  endpoint.searchParams.set("character_id", `eq.${CHARACTER_ID}`);
  endpoint.searchParams.set("memory_type", `eq.${MEMORY_TYPE}`);
  endpoint.searchParams.set("select", "character_id,memory_type,content,created_at");
  endpoint.searchParams.set("order", "created_at.desc");
  endpoint.searchParams.set("limit", String(MAX_MEMORIES));

  const result = await fetcher(endpoint, {
    method: "GET",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!result.ok) throw new Error(`Shared memory storage returned ${result.status}`);
  return limitMemories(await result.json());
}

export async function handler(
  request: Request,
  context: NetlifyContext = {},
  dependencies: {
    env?: NodeJS.ProcessEnv;
    fetcher?: typeof fetch;
  } = {},
): Promise<Response> {
  if (request.method !== "GET") return response({ error: "Method not allowed" }, 405);

  const env = dependencies.env ?? process.env;
  if (!isAuthorizedNetlifyUser(context?.user, env.AIWEN_ALLOWED_NETLIFY_USER_ID)) {
    return response({ error: "Forbidden" }, 403);
  }

  try {
    const memories = await readSharedEventMemories(env, dependencies.fetcher);
    return response({ memories }, 200);
  } catch {
    // Do not log memory bodies, credentials, request headers, or upstream error payloads.
    return response({ error: "Shared memory unavailable" }, 503);
  }
}

export default handler;
