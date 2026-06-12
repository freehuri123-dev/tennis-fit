import { NextResponse } from "next/server";
import { listReportsFromStore, saveReportToStore } from "../../../lib/server-report-store";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  try {
    const reports = await listReportsFromStore();
    return NextResponse.json({ reports });
  } catch (error) {
    return NextResponse.json(
      {
        error: "코칭 기록을 불러오지 못했습니다.",
        detail: error instanceof Error ? error.message : "unknown error",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const saved = await saveReportToStore({
      analyses: Array.isArray(body.analyses) ? body.analyses : [],
      aiReport: body.aiReport ?? null,
      serveType: typeof body.serveType === "string" ? body.serveType : undefined,
      serveTypeLabel: typeof body.serveTypeLabel === "string" ? body.serveTypeLabel : undefined,
    });

    return NextResponse.json({ report: saved });
  } catch (error) {
    return NextResponse.json(
      {
        error: "분석 결과 저장에 실패했습니다.",
        detail: error instanceof Error ? error.message : "unknown error",
      },
      { status: 500 },
    );
  }
}
