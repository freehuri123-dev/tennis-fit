export type AiServeMoment = {
  time: number;
  startTime?: number;
  endTime?: number;
  title: string;
  comment: string;
};

export type AiServeIssue = {
  title: string;
  description: string;
};

export type AiServeReport = {
  confidence: number;
  analysisStandard: string;
  summary: string;
  goodPoint: string;
  todayFocus: string;
  correctionSuggestion: string;
  topIssues: AiServeIssue[];
  referenceImprovements: AiServeIssue[];
  keyMoments: AiServeMoment[];
};

const defaultReport: AiServeReport = {
  confidence: 0,
  analysisStandard: "촬영 조건을 먼저 확인해야 합니다.",
  summary: "영상에서 분석할 수 있는 대표 자세 포인트를 찾지 못했습니다.",
  goodPoint: "전신이 잘 보이는 영상을 다시 촬영하면 더 정확하게 확인할 수 있습니다.",
  todayFocus: "전신이 잘 보이는 짧은 서브 영상을 다시 촬영해 주세요.",
  correctionSuggestion: "카메라를 고정하고 서브 전후 동작이 모두 보이도록 다시 촬영해 주세요.",
  topIssues: [{ title: "영상 분석 실패", description: "분석 가능한 자세 포인트를 찾지 못했습니다." }],
  referenceImprovements: [],
  keyMoments: [],
};

export function parseTimestamp(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(value, 0);
  }

  if (typeof value !== "string") {
    return 0;
  }

  const trimmed = value.trim();

  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }

  const parts = trimmed.split(":").map(Number);

  if (parts.length === 2 && parts.every(Number.isFinite)) {
    return parts[0] * 60 + parts[1];
  }

  if (parts.length === 3 && parts.every(Number.isFinite)) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  return 0;
}

export function extractJsonText(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);

  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");

  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }

  return text;
}

export function normalizeAiServeReport(input: unknown, duration: number): AiServeReport {
  if (!isRecord(input)) {
    return defaultReport;
  }

  const rawMoments = Array.isArray(input.keyMoments) ? input.keyMoments : [];
  const keyMoments = rawMoments
    .filter(isRecord)
    .map((moment, index) => normalizeMoment(moment, index, duration))
    .filter((moment) => moment.comment.length > 0)
    .sort((a, b) => a.time - b.time)
    .slice(0, 4);

  const topIssues = normalizeIssues(input.topIssues);
  const referenceImprovements = normalizeIssues(input.referenceImprovements, "참고 개선 포인트입니다.");

  return {
    confidence: normalizeConfidence(input.confidence),
    analysisStandard: cleanText(input.analysisStandard, defaultReport.analysisStandard),
    summary: cleanText(input.summary, defaultReport.summary),
    goodPoint: cleanText(input.goodPoint, defaultReport.goodPoint),
    todayFocus: cleanText(input.todayFocus, defaultReport.todayFocus),
    correctionSuggestion: cleanText(input.correctionSuggestion, defaultReport.correctionSuggestion),
    topIssues,
    referenceImprovements,
    keyMoments,
  };
}

export function parseGeminiReportText(text: string, duration: number) {
  return normalizeAiServeReport(JSON.parse(extractJsonText(text)), duration);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function cleanText(value: unknown, fallback: string) {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed || fallback;
}

function normalizeMoment(moment: Record<string, unknown>, index: number, duration: number): AiServeMoment {
  const maxTime = Math.max(duration - 0.1, 0);
  const parsedStart = parseTimestamp(moment.startTime);
  const parsedEnd = parseTimestamp(moment.endTime);
  const hasSegment = parsedEnd > parsedStart;
  const startTime = hasSegment ? clamp(parsedStart, 0, maxTime) : undefined;
  const endTime = hasSegment ? clamp(parsedEnd, 0, maxTime) : undefined;
  const fallbackTime = hasSegment && startTime !== undefined && endTime !== undefined ? (startTime + endTime) / 2 : 0;
  const time = clamp(parseTimestamp(moment.time) || fallbackTime, 0, maxTime);

  return {
    time,
    ...(startTime !== undefined ? { startTime } : {}),
    ...(endTime !== undefined ? { endTime } : {}),
    title: cleanText(moment.title, `분석 장면 ${index + 1}`),
    comment: cleanText(moment.comment, "이 장면에서 자세 변화를 확인해 보세요."),
  };
}

function normalizeConfidence(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return clamp(value, 0, 1);
  }

  if (typeof value === "string" && value.trim()) {
    return clamp(Number(value), 0, 1);
  }

  return 0.7;
}

function normalizeIssues(value: unknown, stringDescription = "영상에서 반복적으로 확인된 문제입니다."): AiServeIssue[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((issue) => {
      if (typeof issue === "string") {
        const title = cleanText(issue, "");
        return title ? { title, description: stringDescription } : undefined;
      }

      if (!isRecord(issue)) {
        return undefined;
      }

      const title = cleanText(issue.title, "");
      const description = cleanText(issue.description, "");

      return title && description ? { title, description } : undefined;
    })
    .filter((issue): issue is AiServeIssue => Boolean(issue))
    .slice(0, 3);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
