import { describe, expect, it } from "vitest";
import { extractJsonText, normalizeAiServeReport, parseGeminiReportText, parseTimestamp } from "./ai-serve-report";

describe("parseTimestamp", () => {
  it("accepts seconds and mm:ss timestamps", () => {
    expect(parseTimestamp(3.8)).toBe(3.8);
    expect(parseTimestamp("4.2")).toBe(4.2);
    expect(parseTimestamp("00:08.4")).toBe(8.4);
    expect(parseTimestamp("01:02:03")).toBe(3723);
  });
  it("keeps top issues empty when Gemini finds no clear correction point", () => {
    const report = normalizeAiServeReport(
      {
        summary: "리듬과 균형이 안정적입니다.",
        goodPoint: "임팩트 이후 균형 유지가 좋습니다.",
        todayFocus: "큰 교정 포인트보다는 현재 리듬을 유지하세요.",
        correctionSuggestion: "지금처럼 전신 리듬을 유지하며 반복 촬영해 변화만 확인하세요.",
        topIssues: [],
        keyMoments: [{ time: 3.2, title: "임팩트", comment: "타점과 균형이 안정적으로 보입니다." }],
      },
      10,
    );

    expect(report.topIssues).toEqual([]);
    expect(report.todayFocus).toBe("큰 교정 포인트보다는 현재 리듬을 유지하세요.");
  });

  it("keeps millisecond-level key moment timestamps", () => {
    const report = normalizeAiServeReport(
      {
        summary: "서브 장면이 확인됩니다.",
        goodPoint: "리듬이 좋습니다.",
        todayFocus: "타점 확인",
        correctionSuggestion: "같은 리듬으로 반복하세요.",
        topIssues: [],
        keyMoments: [{ time: 41.237, title: "임팩트", comment: "타점이 보이는 프레임입니다." }],
      },
      50,
    );

    expect(report.keyMoments[0].time).toBe(41.237);
  });

  it("normalizes segment-based key moments and coaching confidence fields", () => {
    const report = normalizeAiServeReport(
      {
        confidence: 0.58,
        analysisStandard: "플랫 서브 기준: 타점과 전방 체중 전달 중심",
        summary: "촬영 거리가 있어 참고용으로만 보세요.",
        goodPoint: "준비 리듬은 일정합니다.",
        todayFocus: "토스가 흔들리는 구간만 먼저 보세요.",
        correctionSuggestion: "공을 올린 뒤 몸이 먼저 열리지 않게 3회 반복하세요.",
        topIssues: [{ title: "토스", description: "토스 직후 몸이 먼저 열립니다." }],
        referenceImprovements: [
          { title: "마무리 균형", description: "착지 후 한 박자 더 서서 확인하세요." },
          "라켓 드롭은 참고로만 확인하세요.",
        ],
        keyMoments: [
          {
            startTime: 12.1,
            endTime: 13.1,
            title: "토스-임팩트 구간",
            comment: "토스 이후 상체가 빨리 열리는지 확인하세요.",
          },
        ],
      },
      20,
    );

    expect(report.confidence).toBe(0.58);
    expect(report.analysisStandard).toBe("플랫 서브 기준: 타점과 전방 체중 전달 중심");
    expect(report.referenceImprovements).toEqual([
      { title: "마무리 균형", description: "착지 후 한 박자 더 서서 확인하세요." },
      { title: "라켓 드롭은 참고로만 확인하세요.", description: "참고 개선 포인트입니다." },
    ]);
    expect(report.keyMoments[0]).toMatchObject({
      startTime: 12.1,
      endTime: 13.1,
      time: 12.6,
      title: "토스-임팩트 구간",
    });
  });
});

describe("extractJsonText", () => {
  it("extracts json from markdown fences", () => {
    expect(extractJsonText("```json\n{\"summary\":\"ok\"}\n```")).toBe("{\"summary\":\"ok\"}");
  });

  it("extracts the first object from surrounding text", () => {
    expect(extractJsonText("result: {\"summary\":\"ok\"} done")).toBe("{\"summary\":\"ok\"}");
  });
});

describe("normalizeAiServeReport", () => {
  it("normalizes report text and limits key moments", () => {
    const report = normalizeAiServeReport(
      {
        summary: " 토스가 흔들립니다. ",
        goodPoint: "리듬은 안정적입니다.",
        todayFocus: " 토스 위치 ",
        correctionSuggestion: "토스 위치를 먼저 고정하세요.",
        topIssues: [
          { title: "토스", description: "오른쪽으로 밀립니다." },
          { title: "균형", description: "마무리 때 기울어집니다." },
          { title: "회전", description: "상체가 빨리 열립니다." },
          { title: "추가", description: "제외됩니다." },
        ],
        keyMoments: [
          { time: "00:08.0", title: "마무리", comment: "몸이 기울어집니다." },
          { time: "00:02.0", title: "토스", comment: "팔이 오른쪽으로 빠집니다." },
          { time: "00:30.0", title: "초과", comment: "영상 끝으로 보정됩니다." },
          { time: "00:04.0", title: "상체", comment: "회전이 빠릅니다." },
          { time: "00:06.0", title: "추가", comment: "제외됩니다." },
        ],
      },
      20,
    );

    expect(report.goodPoint).toBe("리듬은 안정적입니다.");
    expect(report.correctionSuggestion).toBe("토스 위치를 먼저 고정하세요.");
    expect(report.topIssues).toEqual([
      { title: "토스", description: "오른쪽으로 밀립니다." },
      { title: "균형", description: "마무리 때 기울어집니다." },
      { title: "회전", description: "상체가 빨리 열립니다." },
    ]);
    expect(report.keyMoments).toHaveLength(4);
    expect(report.keyMoments[0].time).toBe(2);
    expect(report.keyMoments[3].time).toBe(8);
  });

  it("parses a fenced Gemini response", () => {
    const report = parseGeminiReportText(
      "```json\n{\"summary\":\"요약\",\"goodPoint\":\"장점\",\"todayFocus\":\"집중\",\"correctionSuggestion\":\"제안\",\"topIssues\":[{\"title\":\"토스\",\"description\":\"흔들림\"}],\"keyMoments\":[]}\n```",
      20,
    );

    expect(report.summary).toBe("요약");
    expect(report.topIssues[0].description).toBe("흔들림");
  });
});
