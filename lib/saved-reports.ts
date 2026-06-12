import type { AiServeReport } from "./ai-serve-report";

export type SavedSnapshotFrame = {
  image: string;
  time: number;
};

export type SavedSnapshot = {
  key: string;
  name: string;
  cue: string;
  feedback: string;
  image: string;
  time: number;
  frames?: SavedSnapshotFrame[];
  selectedFrameIndex?: number;
};

export type SavedServeAnalysis = {
  index: number;
  issue: string;
  strength: string;
  recommendation: string;
  snapshots: SavedSnapshot[];
};

export type SavedServeReport = {
  id: string;
  createdAt: string;
  serveType?: string;
  serveTypeLabel?: string;
  analyses: SavedServeAnalysis[];
  aiReport: AiServeReport | null;
};

export const savedReportPrefix = "servefit-report:";
const savedReportSequenceKey = "servefit-report-seq";

export function saveServeReport(
  analyses: SavedServeAnalysis[],
  aiReport: AiServeReport | null,
  options?: { serveType?: string; serveTypeLabel?: string },
): SavedServeReport {
  const id = getNextReportId();
  const saved: SavedServeReport = {
    id,
    createdAt: new Date().toISOString(),
    serveType: options?.serveType,
    serveTypeLabel: options?.serveTypeLabel,
    analyses,
    aiReport,
  };

  window.localStorage.setItem(`${savedReportPrefix}${id}`, JSON.stringify(saved));
  return saved;
}

export async function saveServeReportRemote(
  analyses: SavedServeAnalysis[],
  aiReport: AiServeReport | null,
  options?: { serveType?: string; serveTypeLabel?: string },
): Promise<SavedServeReport> {
  const response = await fetch("/api/reports", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      analyses,
      aiReport,
      serveType: options?.serveType,
      serveTypeLabel: options?.serveTypeLabel,
    }),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.error ?? "분석 결과 저장에 실패했습니다.");
  }

  return data.report as SavedServeReport;
}

function getNextReportId() {
  const current = Number(window.localStorage.getItem(savedReportSequenceKey) || "1000");
  const next = Number.isFinite(current) ? current + 1 : 1001;
  window.localStorage.setItem(savedReportSequenceKey, String(next));
  return String(next);
}

export function loadServeReport(id: string): SavedServeReport | null {
  try {
    const raw = window.localStorage.getItem(`${savedReportPrefix}${id}`);
    return raw ? (JSON.parse(raw) as SavedServeReport) : null;
  } catch {
    return null;
  }
}

export async function loadServeReportRemote(id: string): Promise<SavedServeReport | null> {
  const response = await fetch(`/api/reports/${encodeURIComponent(id)}`, {
    cache: "no-store",
  });

  if (response.status === 404) {
    return null;
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.error ?? "분석 결과를 불러오지 못했습니다.");
  }

  return data.report as SavedServeReport;
}

export function listServeReports() {
  const reports: SavedServeReport[] = [];

  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);

    if (!key?.startsWith(savedReportPrefix)) {
      continue;
    }

    try {
      const raw = window.localStorage.getItem(key);

      if (raw) {
        reports.push(JSON.parse(raw) as SavedServeReport);
      }
    } catch {
      // Ignore malformed local records so one bad item does not break history.
    }
  }

  return reports.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export async function listServeReportsRemote(): Promise<SavedServeReport[]> {
  const response = await fetch("/api/reports", {
    cache: "no-store",
  });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.error ?? "코칭 기록을 불러오지 못했습니다.");
  }

  return Array.isArray(data.reports) ? (data.reports as SavedServeReport[]) : [];
}

export function formatReportDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "날짜 없음";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
