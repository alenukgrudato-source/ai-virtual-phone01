import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHARACTER_ID = "aiwen_test";

function authorized(request: NextRequest): boolean {
  const secret = process.env.AIWEN_SHARED_SECRET;
  const supplied = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "");

  if (!secret || !supplied) return false;

  const digest = (value: string) =>
    createHmac("sha256", "aiwen-auth")
      .update(value)
      .digest();

  return timingSafeEqual(digest(secret), digest(supplied));
}

async function supabaseRequest(
  method: "GET" | "POST",
  body?: object
) {
  const url = process.env.AIWEN_SUPABASE_URL;
  const key = process.env.AIWEN_SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Missing Supabase configuration");
  }

  const endpoint = new URL(
    "/rest/v1/ai_shared_memories",
    url
  );

  if (method === "GET") {
    endpoint.searchParams.set(
      "character_id",
      `eq.${CHARACTER_ID}`
    );
    endpoint.searchParams.set(
      "select",
      "id,content,memory_type,source,created_at"
    );
    endpoint.searchParams.set(
      "order",
      "created_at.desc"
    );
    endpoint.searchParams.set("limit", "10");
  }

  const response = await fetch(endpoint.toString(), {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(method === "POST"
        ? { Prefer: "return=representation" }
        : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Database error: ${response.status}`);
  }

  return response.json();
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const memories = await supabaseRequest("GET");
    return NextResponse.json({ memories });
  } catch {
    return NextResponse.json(
      { error: "Memory read failed" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  let data: unknown;

  try {
    data = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON" },
      { status: 400 }
    );
  }

  if (
    !data ||
    typeof data !== "object" ||
    !("content" in data) ||
    typeof data.content !== "string" ||
    !data.content.trim() ||
    data.content.length > 2000
  ) {
    return NextResponse.json(
      { error: "Content must be 1-2000 characters" },
      { status: 400 }
    );
  }

  const memoryType =
    "memory_type" in data ? data.memory_type : "event";

  if (
    typeof memoryType !== "string" ||
    !["event", "fact", "preference"].includes(memoryType)
  ) {
    return NextResponse.json(
      { error: "Invalid memory type" },
      { status: 400 }
    );
  }

  try {
    const memories = await supabaseRequest("POST", {
      character_id: CHARACTER_ID,
      source: "float",
      memory_type: memoryType,
      content: data.content.trim(),
    });

    return NextResponse.json({
      success: true,
      memories,
    });
  } catch {
    return NextResponse.json(
      { error: "Memory write failed" },
      { status: 500 }
    );
  }
}
