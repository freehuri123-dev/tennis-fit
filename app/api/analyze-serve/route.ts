import { NextResponse } from "next/server";
import { extractJsonText, normalizeAiServeReport } from "../../../lib/ai-serve-report";

export const runtime = "nodejs";
export const maxDuration = 60;

const maxFileSize = 20 * 1024 * 1024;
const defaultModel = "gemini-2.5-flash-lite";

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: ".env.local에 GEMINI_API_KEY를 설정한 뒤 개발 서버를 다시 시작해주세요." },
      { status: 500 },
    );
  }

  const formData = await request.formData();
  const file = formData.get("video");
  const angle = String(formData.get("angle") ?? "back");
  const serveType = String(formData.get("serveType") ?? "unknown");
  const duration = Number(formData.get("duration") ?? 20);
  const poseSummary = parsePoseSummary(formData.get("poseSummary"));

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "분석할 영상 파일이 없습니다." }, { status: 400 });
  }

  if (!file.type.startsWith("video/")) {
    return NextResponse.json({ error: "영상 파일만 업로드할 수 있습니다." }, { status: 400 });
  }

  if (file.size > maxFileSize) {
    return NextResponse.json({ error: "영상은 20MB 이하로 올려주세요." }, { status: 413 });
  }

  const arrayBuffer = await file.arrayBuffer();
  const base64Video = Buffer.from(arrayBuffer).toString("base64");
  const model = process.env.GEMINI_MODEL || defaultModel;
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: buildPrompt({ angle, serveType, duration, poseSummary }),
              },
              {
                inlineData: {
                  mimeType: file.type,
                  data: base64Video,
                },
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.15,
          maxOutputTokens: 900,
        },
      }),
    },
  );

  if (!response.ok) {
    const message = await response.text();
    const geminiError = classifyGeminiError(response.status, message);

    return NextResponse.json(
      { error: geminiError.error, reason: geminiError.reason, detail: message.slice(0, 500) },
      { status: response.status },
    );
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text ?? "").join("") ?? "";

  if (!text) {
    return NextResponse.json({ error: "Gemini 분석 결과가 비어 있습니다." }, { status: 502 });
  }

  try {
    const parsed = JSON.parse(extractJsonText(text));
    const validation = validateAiServeResponse(parsed);

    if (!validation.valid) {
      return NextResponse.json({ error: validation.message, reason: "invalid_serve_video" }, { status: 422 });
    }

    return NextResponse.json(normalizeAiServeReport(parsed, duration));
  } catch {
    return NextResponse.json({ error: "Gemini 분석 결과를 해석하지 못했습니다.", reason: "parse_failed" }, { status: 502 });
  }
}

function classifyGeminiError(httpStatus: number, rawMessage: string) {
  let code = httpStatus;
  let status = "";
  let message = rawMessage;

  try {
    const parsed = JSON.parse(rawMessage) as {
      error?: {
        code?: number;
        status?: string;
        message?: string;
      };
    };
    code = parsed.error?.code ?? code;
    status = parsed.error?.status ?? "";
    message = parsed.error?.message ?? rawMessage;
  } catch {
    // Raw text fallback below.
  }

  const normalized = `${status} ${message}`.toLowerCase();

  if (code === 429 || status === "RESOURCE_EXHAUSTED" || normalized.includes("quota") || normalized.includes("rate limit")) {
    return {
      reason: "quota_exceeded",
      error: "Gemini 사용 한도를 초과했습니다. 잠시 후 다시 시도하거나 다음 사용 가능 시간을 확인해주세요.",
    };
  }

  if (code === 503 || status === "UNAVAILABLE" || normalized.includes("high demand") || normalized.includes("unavailable")) {
    return {
      reason: "temporary_unavailable",
      error: "Gemini 서버가 일시적으로 혼잡합니다. 잠시 후 다시 시도해주세요.",
    };
  }

  if (code === 401 || code === 403 || normalized.includes("api key") || normalized.includes("permission")) {
    return {
      reason: "auth_error",
      error: "Gemini API 키 또는 권한 설정을 확인해주세요.",
    };
  }

  if (code === 400 || normalized.includes("invalid argument") || normalized.includes("unsupported")) {
    return {
      reason: "invalid_video",
      error: "Gemini가 이 영상 형식을 처리하지 못했습니다. 더 짧거나 용량이 작은 영상으로 다시 시도해주세요.",
    };
  }

  if (code >= 500) {
    return {
      reason: "temporary_error",
      error: "Gemini 서버 오류로 분석하지 못했습니다. 잠시 후 다시 시도해주세요.",
    };
  }

  return {
    reason: "analysis_failed",
    error: "Gemini 영상 분석에 실패했습니다. 영상 형식과 길이를 확인한 뒤 다시 시도해주세요.",
  };
}

function validateAiServeResponse(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { valid: false, message: "영상 분석 실패" };
  }

  const record = input as Record<string, unknown>;
  const isValidServeVideo = record.isValidServeVideo !== false;
  const confidence = typeof record.confidence === "number" ? record.confidence : 1;

  if (!isValidServeVideo || confidence < 0.55) {
    const invalidReason = typeof record.invalidReason === "string" ? record.invalidReason.trim() : "";

    return {
      valid: false,
      message:
        invalidReason ||
        "서브 동작이 확인되지 않았습니다. 전신이 보이는 옆 또는 뒤 촬영 서브 영상으로 다시 올려주세요.",
    };
  }

  return { valid: true };
}

function parsePoseSummary(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return null;
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function buildPrompt({
  angle,
  serveType,
  duration,
  poseSummary,
}: {
  angle: string;
  serveType: string;
  duration: number;
  poseSummary: Record<string, unknown> | null;
}) {
  const angleLabel =
    {
      back: "뒤에서 촬영한 영상",
      side: "옆에서 촬영한 영상",
    }[angle] ?? "뒤 또는 옆에서 촬영한 서브 영상";
  const serveTypeLabel =
    {
      unknown: "모름/일반 서브",
      flat: "플랫 서브",
      slice: "슬라이스 서브",
      quick: "퀵 모션 서브",
    }[serveType] ?? "모름/일반 서브";
  const serveTypeGuide =
    {
      flat: "플랫 서브 기준으로 타점 높이, 전방 체중 전달, 라켓 헤드 스피드, 임팩트 방향성을 우선 확인하세요.",
      slice:
        "슬라이스 서브 기준으로 토스 위치, 몸이 너무 빨리 열리는지, 옆 회전을 만들 수 있는 라켓 궤도와 마무리를 우선 확인하세요.",
      quick: "퀵 모션 서브 기준으로 준비 동작의 간결함, 토스와 스윙 연결 타이밍, 리듬이 끊기는 지점을 우선 확인하세요.",
      unknown: "서브 종류를 특정하지 말고 전반적인 토스 안정성, 타점, 균형, 마무리를 기준으로 확인하세요.",
    }[serveType] ?? "서브 종류를 특정하지 말고 전반적인 토스 안정성, 타점, 균형, 마무리를 기준으로 확인하세요.";

  return `
당신은 테니스 동호인의 서브 영상을 분석하는 영상 판독자이자 자세 코치입니다.
영상 길이: 약 ${duration.toFixed(1)}초
사용자가 선택한 촬영 방향: ${angleLabel}
사용자가 선택한 서브 종류: ${serveTypeLabel}
서브 종류별 분석 기준: ${serveTypeGuide}
앱의 1차 포즈 요약: ${poseSummary ? JSON.stringify(poseSummary) : "없음"}

아래 순서대로 판단하세요. 단, 최종 응답은 마지막 JSON 하나만 반환하세요.

[1단계: 영상 유효성 판단]
- 영상이 테니스 서브 자세 분석에 사용할 수 있는지 먼저 판단하세요.
- 전신, 라켓, 발, 토스한 공 중 핵심 요소가 대부분 화면 밖이면 isValidServeVideo를 false로 반환하세요.
- 서브 동작이 아니라 랠리, 이동 장면, 대기 장면, 경기 중 멀리 잡힌 장면이면 isValidServeVideo를 false로 반환하세요.
- 사용자가 선택한 촬영 방향과 실제 영상 방향이 크게 다르면 isValidServeVideo를 false로 반환하거나 confidence를 0.55 이하로 낮추세요.
- 서브는 보이지만 화질, 흔들림, 거리, 가림 때문에 판독 근거가 약하면 isValidServeVideo는 true로 두되 confidence를 낮추세요.
- 앱의 1차 포즈 요약에서 usableFrameCount, analysisReadyFrameCount, serveMotionFrameCount가 낮으면 영상 판독 신뢰도를 낮추세요.
- 앱의 1차 포즈 요약에서 multiPersonFrameCount가 높으면 경기 중 영상일 가능성을 더 엄격하게 판단하세요.
- isValidServeVideo가 false이면 invalidReason에 짧은 사유를 쓰고, topIssues와 keyMoments는 빈 배열로 반환하세요.

[2단계: 자세 분석]
- 분석 가능한 영상일 때만 자세를 분석하세요.
- 문제를 억지로 만들지 마세요. 명확히 보이는 문제만 topIssues에 넣으세요.
- topIssues는 "확실한 문제"만 0~3개 반환하세요. 애매한 개선점은 topIssues에 넣지 말고 correctionSuggestion에 참고 수준으로 쓰세요.
- referenceImprovements는 확실한 문제는 아니지만 참고하면 좋은 개선점만 0~3개 반환하세요.
- 잘하는 선수나 큰 문제가 없는 영상이면 topIssues를 빈 배열로 두고, todayFocus에는 유지 또는 미세 개선 중심으로 작성하세요.
- ${serveTypeGuide}
- ${angleLabel} 기준으로 관찰 가능한 요소만 말하세요. 보이지 않는 각도, 공의 회전량, 실제 속도는 단정하지 마세요.
- analysisStandard에는 이번 분석에 적용한 기준을 한 문장으로 쓰세요. 예: "플랫 서브 기준: 타점 높이와 전방 체중 전달 중심"
- keyMoments는 결과 화면 캡처용입니다. 정확한 한 프레임을 맞히려 하지 말고, 코칭 근거가 보이는 0.8~1.2초 구간을 2~4개 고르세요.
- 각 keyMoment에는 startTime과 endTime을 반드시 초 단위 숫자로 넣으세요.
- keyMoment.time은 해당 구간에서 대표로 보여줄 중심 시간을 넣으세요. 보통 startTime과 endTime의 중간값을 사용하세요.
- 각 keyMoment.time은 반드시 초 단위 숫자로 반환하되, 1초 단위로 반올림하지 말고 최소 소수점 2~3자리 정밀도로 반환하세요.
- 예: 41.237초 장면이면 41 또는 41.0이 아니라 41.237로 반환하세요.
- 토스, 임팩트, 팔로스루처럼 1초 안에서 빠르게 지나가는 동작은 해당 동작이 포함되는 구간을 고르세요.

[3단계: 코칭 문구 생성]
- 결과는 한국어로 작성하세요.
- 말투는 짧고 명확하게 작성하세요. 친절한 응원보다 실전 코칭처럼 바로 말하세요.
- goodPoint는 영상에서 구체적으로 확인되는 유지할 점 1가지만 작성하세요.
- todayFocus는 오늘 가장 먼저 볼 1가지 또는 유지할 1가지만 작성하세요.
- correctionSuggestion은 오늘 바로 연습할 수 있는 내용으로 1~2문장 작성하세요.
- confidence가 0.65 미만이면 summary 또는 correctionSuggestion에 "촬영 조건 때문에 참고용으로만 보세요"라는 취지를 포함하세요.
- 칭찬은 과하게 하지 말고 실제로 보이는 장점만 말하세요.
- 교정 포인트는 돌려 말하지 말고 바로 지적하세요.
- "좋아요", "훌륭합니다", "잘하고 있습니다" 같은 표현을 반복하지 마세요.
- 의료 진단이나 부상 진단 표현은 피하고 참고용 코칭으로 작성하세요.

반드시 아래 JSON 형식만 반환하세요.
{
  "isValidServeVideo": true,
  "confidence": 0.82,
  "invalidReason": "",
  "analysisStandard": "이번 분석 기준 1문장",
  "summary": "영상 전체 요약 1~2문장",
  "goodPoint": "좋았던 점 1문장",
  "todayFocus": "오늘 가장 먼저 신경 쓸 포인트 또는 유지할 포인트",
  "correctionSuggestion": "구체적인 교정 제안 1~2문장",
  "topIssues": [
    {
      "title": "문제 제목",
      "description": "영상에서 보이는 근거와 왜 문제인지 설명"
    }
  ],
  "referenceImprovements": [
    {
      "title": "참고 개선 제목",
      "description": "확실한 문제는 아니지만 참고할 개선 방향"
    }
  ],
  "keyMoments": [
    {
      "startTime": 3.337,
      "endTime": 4.337,
      "time": 3.837,
      "title": "분석 구간 제목",
      "comment": "이 구간에서 보이는 점과 코칭 방향"
    }
  ]
}
`.trim();
}
