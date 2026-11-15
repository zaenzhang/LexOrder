import { NextResponse } from "next/server";
import { PRODUCT_ENGLISH_NAME } from "@/lib/product";

export function GET() {
  return NextResponse.json({
    name: PRODUCT_ENGLISH_NAME,
    status: "ok",
    timestamp: new Date().toISOString()
  });
}
