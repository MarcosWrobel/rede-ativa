import { NextResponse } from "next/server";
import { generateQrCodeSvg } from "@/lib/qrCode";
import QRCode from "qrcode";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const data = searchParams.get("data");
    const format = searchParams.get("format") || "svg";
    const size = Math.min(Math.max(parseInt(searchParams.get("size") || "200", 10), 64), 1024);

    if (!data) {
      return NextResponse.json(
        { error: "Parâmetro 'data' obrigatório para geração do QR Code." },
        { status: 400 }
      );
    }

    if (format === "png") {
      const buffer = await QRCode.toBuffer(data, {
        type: "png",
        margin: 1,
        width: size,
        errorCorrectionLevel: "M",
      });

      return new Response(new Uint8Array(buffer), {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }

    const svgString = await generateQrCodeSvg(data, {
      margin: 1,
      width: size,
      errorCorrectionLevel: "M",
    });

    return new Response(svgString, {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error: any) {
    console.error("[GET /api/atas/qr] Erro ao gerar QR Code:", error);
    return NextResponse.json(
      { error: "Falha na geração do QR Code" },
      { status: 500 }
    );
  }
}
