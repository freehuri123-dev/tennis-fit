"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatReportDate, listServeReports, listServeReportsRemote, type SavedServeReport } from "../../lib/saved-reports";

export default function HistoryPage() {
  const [reports, setReports] = useState<SavedServeReport[]>([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    listServeReportsRemote()
      .then((remoteReports) => {
        setReports(remoteReports);
        setError("");
      })
      .catch((loadError) => {
        if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
          setReports(listServeReports());
          setError("DB 연결 전이라 이 브라우저에 저장된 기록만 표시합니다.");
          return;
        }

        setError(loadError instanceof Error ? loadError.message : "코칭 기록을 불러오지 못했습니다.");
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  async function logout() {
    await fetch("/api/logout", { method: "POST" }).catch(() => null);
    window.location.href = "/login";
  }

  return (
    <main className="app-shell">
      <section className="history-hero">
        <div>
          <p className="eyebrow">ServeFit History</p>
          <h1>코칭 기록</h1>
          <p>날짜별로 저장된 서브 분석 결과를 다시 확인합니다.</p>
        </div>
        <div className="history-actions">
          <Link className="history-new-link" href="/">
            새 분석
          </Link>
          <button className="history-logout-button" onClick={logout} type="button">
            로그아웃
          </button>
        </div>
      </section>

      <section className="history-list" aria-label="코칭 기록 목록">
        {error ? <p className="share-message">{error}</p> : null}
        {reports.length > 0 ? (
          reports.map((report) => {
            const firstAnalysis = report.analyses[0];
            const firstSnapshot = firstAnalysis?.snapshots[0];
            const issueTitle = report.aiReport?.topIssues[0]?.title ?? firstAnalysis?.issue ?? "서브 분석 결과";
            const serveTypeLabel = report.serveTypeLabel ?? "일반 서브 기준";

            return (
              <Link className="history-item" href={`/reports/${report.id}`} key={report.id}>
                <div className="history-thumb">
                  {firstSnapshot ? <img alt="" src={firstSnapshot.image} /> : <span>ServeFit</span>}
                </div>
                <div>
                  <time>{formatReportDate(report.createdAt)}</time>
                  <span className="history-tag">{serveTypeLabel}</span>
                  <strong>{issueTitle}</strong>
                  <p>{report.aiReport?.summary ?? firstAnalysis?.recommendation ?? "저장된 분석 결과입니다."}</p>
                </div>
              </Link>
            );
          })
        ) : (
          <div className="history-empty">
            <strong>아직 저장된 코칭 기록이 없습니다.</strong>
            <p>분석 결과에서 공유하기를 누르면 이곳에 기록이 쌓입니다.</p>
            <Link className="history-new-link" href="/">
              첫 분석 시작
            </Link>
          </div>
        )}
      </section>

      {isLoading ? (
        <div className="analysis-overlay" role="status" aria-live="polite">
          <div className="analysis-loader">
            <span className="loader-ring" aria-hidden="true" />
            <strong>코칭 기록을 불러오는 중입니다</strong>
            <p>저장된 분석 결과 목록을 확인하고 있어요.</p>
          </div>
        </div>
      ) : null}
    </main>
  );
}
