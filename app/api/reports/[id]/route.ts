import { NextResponse } from "next/server";
import { getReportFromStore } from "../../../../lib/server-report-store";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const report = await getReportFromStore(id);

    if (!report) {
      return NextResponse.json({ error: "저장된 분석 결과를 찾을 수 없습니다." }, { status: 404 });
    }

    return NextResponse.json({ report });
  } catch (error) {
    return NextResponse.json(
      {
        error: "분석 결과를 불러오지 못했습니다.",
        detail: error instanceof Error ? error.message : "unknown error",
      },
      { status: 500 },
    );
  }
}
