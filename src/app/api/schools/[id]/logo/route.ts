import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  enforceRateLimit,
  getPublicIpRateLimitKey,
  RATE_LIMIT_POLICIES,
} from "@/lib/rateLimit";

const CACHE_HEADERS = {
  "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
  "X-Content-Type-Options": "nosniff",
};

const DATA_IMAGE_REGEX = /^data:(image\/(?:svg\+xml|png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=\s]+)$/i;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rlKey = getPublicIpRateLimitKey("pub-logo", req);
    const rlCheck = await enforceRateLimit(rlKey, RATE_LIMIT_POLICIES.PUBLIC_LOGO);
    if (!rlCheck.ok) {
      return rlCheck.response;
    }

    const { id } = await params;

    const school = await prisma.school.findUnique({
      where: { id },
      select: {
        id: true,
        active: true,
        logoUrl: true,
      },
    });

    const fallbackUrl = new URL("/logo.svg", req.url);

    if (!school || school.active === false || !school.logoUrl) {
      return NextResponse.redirect(fallbackUrl, {
        status: 307,
        headers: CACHE_HEADERS,
      });
    }

    const raw = school.logoUrl.trim();

    if (raw.startsWith("/") || /^https?:\/\//i.test(raw)) {
      const targetUrl = raw.startsWith("/") ? new URL(raw, req.url) : raw;
      return NextResponse.redirect(targetUrl, {
        status: 307,
        headers: CACHE_HEADERS,
      });
    }

    const match = raw.match(DATA_IMAGE_REGEX);
    if (!match) {
      return NextResponse.redirect(fallbackUrl, {
        status: 307,
        headers: CACHE_HEADERS,
      });
    }

    let mimeType = match[1].toLowerCase();
    if (mimeType === "image/jpg") mimeType = "image/jpeg";

    const cleanBase64 = match[2].replace(/\s+/g, "");
    const buffer = Buffer.from(cleanBase64, "base64");

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        ...CACHE_HEADERS,
        "Content-Type": mimeType,
        ...(mimeType === "image/svg+xml"
          ? { "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" }
          : {}),
      },
    });
  } catch (err) {
    console.error("[GET /api/schools/[id]/logo] Erro ao servir brasão:", err);
    return NextResponse.redirect(new URL("/logo.svg", req.url), { status: 307 });
  }
}
