import { type NextRequest, NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http";
import { getLiveSession } from "@/lib/api-auth";
import { db } from "@/lib/db";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const session = await getLiveSession(request);
    requireAuth(session);
    // Live role: sessions are stateless, so re-read the row — a demoted or
    // deactivated user must not keep riding a stale cookie.
    const user = await db.user.findUnique({ where: { id: session.userId } });
    if (!user) return NextResponse.json({ user: null }, { status: 401 });
    // Only safe fields are serialized — passwordHash never leaves the server.
    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        orgId: user.orgId,
        createdAt: user.createdAt,
      },
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}
