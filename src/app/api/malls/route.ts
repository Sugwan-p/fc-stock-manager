
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { fail } from "@/lib/http";

export async function GET() {
  try {
    // 관리자 로그인 확인
    await requireAdmin();

    // Supabase에 실제 생성한 테이블 조회
    const { data, error } = await db()
      .from("cafe24_malls")
      .select(
        "mall_id,access_expires_at,refresh_expires_at"
      )
      .order("mall_id", { ascending: true });

    if (error) {
      console.error("쇼핑몰 목록 조회 실패:", error);
      throw error;
    }

    return NextResponse.json({
      malls: data ?? [],
    });
  } catch (error) {
    console.error("GET /api/malls 오류:", error);
    return fail(error);
  }
}
