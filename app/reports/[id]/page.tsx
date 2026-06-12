"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  formatReportDate,
  loadServeReport,
  loadServeReportRemote,
  type SavedServeReport,
  type SavedSnapshotFrame,
} from "../../../lib/saved-reports";

export default function ReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [report, setReport] = useState<SavedServeReport | null>(null);
  const [error, setError] = useState("");
  const [playingSnapshotKey, setPlayingSnapshotKey] = useState<string | null>(null);
  const playbackTimersRef = useRef<number[]>([]);

  useEffect(() => {
    let mounted = true;

    params.then(({ id }) => {
      if (!mounted) {
        return;
      }

      loadServeReportRemote(id)
        .catch((loadError) => {
          if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
            return loadServeReport(id);
          }

          throw loadError;
        })
        .then((saved) => {
          if (!mounted) {
            return;
          }

          if (!saved) {
            setError("저장된 분석 결과를 찾을 수 없습니다.");
            return;
          }

          setReport(saved);
        })
        .catch((loadError) => {
          if (!mounted) {
            return;
          }

          setError(loadError instanceof Error ? loadError.message : "분석 결과를 불러오지 못했습니다.");
        });
    });

    return () => {
      mounted = false;
      clearPlaybackTimers();
    };
  }, [params]);

  function selectSnapshotFrame(snapshotKey: string, frameIndex: number) {
    setReport((currentReport) => {
      if (!currentReport) {
        return currentReport;
      }

      return {
        ...currentReport,
        analyses: currentReport.analyses.map((analysis) => ({
          ...analysis,
          snapshots: analysis.snapshots.map((snapshot) => {
            if (snapshot.key !== snapshotKey) {
              return snapshot;
            }

            const frame = snapshot.frames?.[frameIndex];

            if (!frame) {
              return snapshot;
            }

            return {
              ...snapshot,
              image: frame.image,
              time: frame.time,
              cue: formatTime(frame.time),
              selectedFrameIndex: frameIndex,
            };
          }),
        })),
      };
    });
  }

  function playSnapshotFrames(snapshotKey: string, frames?: SavedSnapshotFrame[]) {
    if (!frames?.length) {
      return;
    }

    clearPlaybackTimers();
    setPlayingSnapshotKey(snapshotKey);

    frames.forEach((_, frameIndex) => {
      const timerId = window.setTimeout(() => {
        selectSnapshotFrame(snapshotKey, frameIndex);

        if (frameIndex === frames.length - 1) {
          setPlayingSnapshotKey(null);
        }
      }, frameIndex * 120);

      playbackTimersRef.current.push(timerId);
    });
  }

  function clearPlaybackTimers() {
    playbackTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    playbackTimersRef.current = [];
  }

  if (error) {
    return (
      <main className="app-shell">
        <section className="failure-section">
          <p className="eyebrow">Report</p>
          <h2>결과를 찾을 수 없습니다</h2>
          <p>{error}</p>
          <Link className="history-new-link" href="/history">
            기록 목록으로
          </Link>
        </section>
      </main>
    );
  }

  if (!report) {
    return (
      <main className="app-shell">
        <section className="result-section">
          <p className="eyebrow">Report</p>
          <h2>분석 결과를 불러오는 중입니다</h2>
        </section>
      </main>
    );
  }

  const analysis = report.analyses[0];
  const serveTypeLabel = report.serveTypeLabel ?? "일반 서브 기준";
  const referenceImprovements = report.aiReport?.referenceImprovements ?? [];
  const primaryIssue = report.aiReport?.topIssues[0] ?? {
    title: report.aiReport?.todayFocus ?? analysis?.issue ?? "서브 분석 결과",
    description: report.aiReport?.summary ?? analysis?.recommendation ?? "저장된 분석 결과입니다.",
  };

  return (
    <main className="app-shell">
      <section className="report-nav">
        <Link href="/history">기록 목록</Link>
        <Link href="/">새 분석</Link>
      </section>

      <section className="result-section">
        <div className="summary-row">
          <div>
            <p className="eyebrow">Saved Report</p>
            <h2>서브 코칭 결과</h2>
            <p className="report-date">{formatReportDate(report.createdAt)}</p>
            <div className="report-meta-row">
              <p className="report-meta-pill">서브 종류: {serveTypeLabel}</p>
              {report.aiReport ? <p className="report-meta-pill">신뢰도: {formatConfidence(report.aiReport.confidence)}</p> : null}
            </div>
          </div>
        </div>

        <div className="coach-dashboard">
          <div className="priority-card">
            <p className="coach-kicker">오늘의 코칭</p>
            <h3>{report.aiReport?.todayFocus ?? primaryIssue.title}</h3>
            <p>{report.aiReport?.summary ?? analysis?.recommendation}</p>
            {report.aiReport?.analysisStandard ? <small>{report.aiReport.analysisStandard}</small> : null}
          </div>
        </div>

        {referenceImprovements.length ? (
          <section className="reference-panel">
            <p className="coach-kicker">참고 개선</p>
            <div className="reference-list">
              {referenceImprovements.map((item, index) => (
                <div key={`${item.title}-${index}`}>
                  <strong>{item.title}</strong>
                  <p>{item.description}</p>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <article className="coach-detail">
          <header className="detail-header">
            <div>
              <p className="eyebrow">Overall Pattern</p>
              <h3>{primaryIssue.title}</h3>
            </div>
            <span>{report.aiReport ? getConfidenceLabel(report.aiReport.confidence) : "분석 결과"}</span>
          </header>

          <div className="coach-notes">
            <div>
              <strong>좋았던 점</strong>
              <p>{analysis?.strength ?? report.aiReport?.goodPoint}</p>
            </div>
            <div>
              <strong>교정 제안</strong>
              <p>{analysis?.recommendation ?? report.aiReport?.correctionSuggestion}</p>
            </div>
          </div>

          <div className="result-section-title">
            <div>
              <p className="eyebrow">Analysis Scenes</p>
              <h3>대표 분석 장면</h3>
            </div>
          </div>

          <div className="snapshot-grid focus-grid">
            {analysis?.snapshots.map((snapshot) => (
              <figure className="snapshot-card" key={snapshot.key}>
                <button
                  aria-label={`${snapshot.name} 연속 프레임 재생`}
                  className="image-wrap image-play-trigger"
                  onClick={() => playSnapshotFrames(snapshot.key, snapshot.frames)}
                  type="button"
                >
                  <img alt={`${snapshot.name} 캡처`} src={snapshot.image} />
                  <div className="overlay-badge">{formatTime(snapshot.time)}</div>
                </button>
                <figcaption>
                  <strong>{snapshot.name}</strong>
                  <span>{snapshot.cue}</span>
                  <p>{snapshot.feedback}</p>
                </figcaption>
                {snapshot.frames?.length ? (
                  <div className={`frame-strip ${playingSnapshotKey === snapshot.key ? "is-playing" : ""}`}>
                    {snapshot.frames.map((frame, frameIndex) => (
                      <button
                        className={`frame-thumb ${snapshot.selectedFrameIndex === frameIndex ? "is-selected" : ""}`}
                        key={`${snapshot.key}-frame-${frame.time}`}
                        onClick={() => selectSnapshotFrame(snapshot.key, frameIndex)}
                        type="button"
                      >
                        <img alt={`${formatTime(frame.time)} 프레임`} src={frame.image} />
                        <span>{formatTime(frame.time)}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </figure>
            ))}
          </div>
        </article>
      </section>
    </main>
  );
}

function formatTime(time: number) {
  return `${time.toFixed(3)}s`;
}

function formatConfidence(confidence: unknown) {
  const normalized = normalizeConfidenceValue(confidence);
  return `${Math.round(normalized * 100)}%`;
}

function getConfidenceLabel(confidence: unknown) {
  const normalized = normalizeConfidenceValue(confidence);

  if (normalized >= 0.78) {
    return "신뢰도 높음";
  }

  if (normalized >= 0.6) {
    return "참고 가능";
  }

  return "참고용 분석";
}

function normalizeConfidenceValue(confidence: unknown) {
  return typeof confidence === "number" && Number.isFinite(confidence) ? Math.max(0, Math.min(confidence, 1)) : 0.7;
}
