"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  assessServeVideoCandidate,
  buildPoseSampleTimes,
  isUsablePoseSample,
  serveFocusAreas,
  type PoseLandmarkPoint,
  type PoseSample,
} from "../lib/serve-analysis";
import type { AiServeReport as GeminiServeReport } from "../lib/ai-serve-report";
import {
  loadServeReport,
  loadServeReportRemote,
  saveServeReport,
  saveServeReportRemote,
  type SavedServeReport,
} from "../lib/saved-reports";

type CameraAngle = "back" | "side";
type ServeType = "unknown" | "flat" | "slice" | "quick";

type Phase = {
  key: string;
  name: string;
  cue: string;
  feedback: string;
};

type Snapshot = Phase & {
  image: string;
  time: number;
  frames?: SnapshotFrame[];
  selectedFrameIndex?: number;
};

type SnapshotFrame = {
  image: string;
  time: number;
};

type ServeAnalysis = {
  index: number;
  issue: string;
  strength: string;
  recommendation: string;
  snapshots: Snapshot[];
};

type BrowserPoseLandmarker = {
  detectForVideo: (
    video: HTMLVideoElement,
    timestamp: number,
  ) => {
    landmarks: PoseLandmarkPoint[][];
  };
  close: () => void;
};

const angleOptions: Array<{
  value: CameraAngle;
  label: string;
  title: string;
  helper: string;
}> = [
  {
    value: "back",
    label: "뒤",
    title: "방향성 분석",
    helper: "토스 좌우, 착지 균형, 상체 회전",
  },
  {
    value: "side",
    label: "옆",
    title: "자세 분석",
    helper: "무릎, 타점 높이, 몸 중심 이동",
  },
];

const serveTypeOptions: Array<{
  value: ServeType;
  label: string;
  title: string;
  helper: string;
}> = [
  {
    value: "unknown",
    label: "모름",
    title: "일반 서브 기준",
    helper: "서브 종류를 특정하지 않고 전체 리듬과 자세를 봅니다.",
  },
  {
    value: "flat",
    label: "플랫",
    title: "플랫 서브",
    helper: "타점, 전방 체중 전달, 라켓 헤드 스피드를 중심으로 봅니다.",
  },
  {
    value: "slice",
    label: "슬라이스",
    title: "슬라이스 서브",
    helper: "토스 위치, 몸 열림, 옆 회전이 가능한 라켓 궤도를 중심으로 봅니다.",
  },
  {
    value: "quick",
    label: "퀵",
    title: "퀵 모션 서브",
    helper: "준비 리듬, 토스와 스윙 연결, 동작 간결함을 중심으로 봅니다.",
  },
];

const phaseTemplates: Record<CameraAngle, Phase[]> = {
  back: [
    {
      key: "toss",
      name: "토스",
      cue: "좌우 흔들림",
      feedback: "토스가 좌우로 치우치면 임팩트 방향성이 흔들릴 수 있습니다.",
    },
    {
      key: "trophy",
      name: "트로피",
      cue: "어깨 회전",
      feedback: "어깨 회전이 부족하면 라켓 가속이 짧게 끝날 수 있습니다.",
    },
    {
      key: "follow",
      name: "팔로스루",
      cue: "마무리 균형",
      feedback: "팔로스루 후 몸이 한쪽으로 무너지지 않는지 확인해보세요.",
    },
  ],
  side: [
    {
      key: "toss",
      name: "토스",
      cue: "토스 팔 유지",
      feedback: "토스 팔이 일찍 내려오면 상체 축이 흔들릴 수 있습니다.",
    },
    {
      key: "trophy",
      name: "트로피",
      cue: "무릎 굽힘",
      feedback: "무릎 굽힘을 조금 더 만들면 하체 탄성을 쓰기 좋습니다.",
    },
    {
      key: "impact",
      name: "임팩트",
      cue: "타점 높이",
      feedback: "타점이 낮아 보이면 공을 더 앞, 위에서 잡는 연습이 필요합니다.",
    },
  ],
};

const repeatedIssues: Record<CameraAngle, string[]> = {
  back: ["토스 좌우 편차", "상체 회전 마무리 부족", "착지 후 균형 흔들림"],
  side: ["토스 팔 유지 부족", "트로피 포지션 무릎 굽힘 부족", "임팩트 타점이 낮아지는 경향"],
};

const maxDirectAiUploadBytes = 3_600_000;

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const resultRef = useRef<HTMLElement>(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState("");
  const [angle, setAngle] = useState<CameraAngle>("back");
  const [serveType, setServeType] = useState<ServeType>("unknown");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyses, setAnalyses] = useState<ServeAnalysis[]>([]);
  const [aiReport, setAiReport] = useState<GeminiServeReport | null>(null);
  const [analysisFailed, setAnalysisFailed] = useState(false);
  const [error, setError] = useState("");
  const [shareMessage, setShareMessage] = useState("");
  const [playingSnapshotKey, setPlayingSnapshotKey] = useState<string | null>(null);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isGuideZoomOpen, setIsGuideZoomOpen] = useState(false);
  const [isVideoReady, setIsVideoReady] = useState(false);
  const [precheckRetryAvailable, setPrecheckRetryAvailable] = useState(false);
  const playbackTimersRef = useRef<number[]>([]);

  const phases = useMemo(() => phaseTemplates[angle], [angle]);
  const angleInfo = angleOptions.find((option) => option.value === angle) ?? angleOptions[0];
  const serveTypeInfo = serveTypeOptions.find((option) => option.value === serveType) ?? serveTypeOptions[0];
  const referenceImprovements = aiReport?.referenceImprovements ?? [];
  const primaryIssue = aiReport?.topIssues[0] ?? {
    title: aiReport?.todayFocus ?? "유지할 포인트",
    description: aiReport?.summary ?? "현재 리듬을 유지하며 확인해보세요.",
  };
  const representativeSnapshots = buildRepresentativeSnapshots(analyses);
  const needsMobileVideoActivation = Boolean(videoUrl && !isVideoReady && isMobileLikeBrowser());

  useEffect(() => {
    if (!isAnalyzing && analyses.length > 0) {
      resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [analyses.length, isAnalyzing]);

  useEffect(() => {
    return () => {
      clearPlaybackTimers();
    };
  }, []);

  useEffect(() => {
    if (!isGuideZoomOpen) {
      return;
    }

    const originalOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsGuideZoomOpen(false);
      }
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isGuideZoomOpen]);

  useEffect(() => {
    if (!videoUrl) {
      setIsVideoReady(false);
      return;
    }

    const video = videoRef.current;

    if (!video) {
      return;
    }

    let cancelled = false;
    setIsVideoReady(false);
    video.load();

    ensureMetadata(video)
      .then(() => {
        if (!cancelled) {
          setIsVideoReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setIsVideoReady(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [videoUrl]);

  useEffect(() => {
    const reportId = new URLSearchParams(window.location.search).get("report");

    if (!reportId) {
      return;
    }

    loadServeReportRemote(reportId)
      .catch(() => loadServeReport(reportId))
      .then((saved) => {
        if (!saved) {
          setError("저장된 분석 결과를 찾을 수 없습니다.");
          return;
        }

        setAnalyses(saved.analyses);
        setAiReport(saved.aiReport);
        setShareMessage("저장된 분석 결과를 불러왔습니다.");
      });
  }, []);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setError("");
    setAnalyses([]);
    setAiReport(null);
    setShareMessage("");
    setAnalysisFailed(false);
    setIsVideoReady(false);
    setPrecheckRetryAvailable(false);

    if (!file) {
      setVideoFile(null);
      return;
    }

    if (!file.type.startsWith("video/")) {
      setError("영상 파일을 선택해주세요.");
      setVideoFile(null);
      return;
    }

    if (videoUrl) {
      URL.revokeObjectURL(videoUrl);
    }

    setVideoFile(file);
    setFileName(file.name);
    setVideoUrl(URL.createObjectURL(file));
  }

  async function analyzeVideo(options?: { skipPrecheck?: boolean }) {
    setIsConfirmOpen(false);
    const video = videoRef.current;

    if (!video || !videoUrl || !videoFile) {
      setError("먼저 서브 영상을 올려주세요.");
      setAnalysisFailed(false);
      return;
    }

    setIsAnalyzing(true);
    setError("");
    setShareMessage("");
    setAnalysisFailed(false);
    setPrecheckRetryAvailable(false);

    const restoreConsoleError = installMediaPipeConsoleNoiseFilter();

    try {
      await ensureMetadata(video);
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 20;
      const precheck = options?.skipPrecheck ? createSkippedPrecheck(angle) : await precheckServeVideo(video, duration, angle);

      if (!precheck.valid) {
        setAnalyses([]);
        setAiReport(null);
        setAnalysisFailed(true);
        setError(formatPrecheckError(precheck));
        setPrecheckRetryAvailable(precheck.canRetryWithAi === true);
        return;
      }

      const aiVideoFile = await prepareVideoForAiUpload(videoFile, video, duration);
      const report = await requestAiServeAnalysis(aiVideoFile, angle, serveType, duration, {
        usableFrameCount: precheck.usableFrameCount,
        analysisReadyFrameCount: precheck.analysisReadyFrameCount ?? 0,
        serveMotionFrameCount: precheck.serveMotionFrameCount,
        multiPersonFrameCount: precheck.multiPersonFrameCount ?? 0,
        cameraAngle: precheck.cameraAngle,
      });

      const snapshots: Snapshot[] = [];
      const poseLandmarker = await withTimeout(createPoseLandmarker(), 6000).catch(() => null);
      let refinementTimestampMs = 0;

      try {
        for (let index = 0; index < report.keyMoments.length; index += 1) {
          try {
            const moment = report.keyMoments[index];
            const refinedMoment = poseLandmarker
              ? await withTimeout(
                  refineMomentTime(video, moment, poseLandmarker, () => {
                    refinementTimestampMs += 100;
                    return refinementTimestampMs;
                  }),
                  4500,
                ).catch(() => ({
                  time: moment.time,
                  landmarks: undefined,
                }))
              : { time: moment.time, landmarks: undefined };
            const frames = poseLandmarker
              ? await buildSnapshotFrames(video, refinedMoment.time, duration, poseLandmarker, () => {
                  refinementTimestampMs += 100;
                  return refinementTimestampMs;
                }).catch(() => [])
              : [];
            const selectedFrameIndex = findNearestFrameIndex(frames, refinedMoment.time);
            const selectedFrame = selectedFrameIndex >= 0 ? frames[selectedFrameIndex] : undefined;
            const image = selectedFrame?.image ?? (await captureFrame(video, refinedMoment.time, refinedMoment.landmarks));
            const time = selectedFrame?.time ?? refinedMoment.time;

            snapshots.push({
              key: `ai-moment-${index}`,
              name: moment.title,
              cue: formatMomentCue(moment),
              feedback: moment.comment,
              image,
              time,
              frames,
              selectedFrameIndex: selectedFrameIndex >= 0 ? selectedFrameIndex : undefined,
            });
          } catch {
            // Mobile browsers can fail to seek/draw individual video frames. Keep the AI report visible.
          }
        }
      } finally {
        poseLandmarker?.close();
      }

      setAiReport(report);
      setAnalyses([
        {
          index: 1,
          issue: report.topIssues[0]?.title ?? report.todayFocus,
          strength: report.goodPoint,
          recommendation: report.correctionSuggestion,
          snapshots,
        },
      ]);
    } catch (analysisError) {
      setAnalyses([]);
      setAiReport(null);
      setAnalysisFailed(true);
      setError(analysisError instanceof Error ? analysisError.message : "영상 분석 실패");
    } finally {
      restoreConsoleError();
      setIsAnalyzing(false);
    }
  }

  async function requestAnalysisConfirmation() {
    if (!videoRef.current || !videoUrl || !videoFile) {
      setError("먼저 서브 영상을 올려주세요.");
      setAnalysisFailed(false);
      return;
    }

    if (!isVideoReady && isMobileLikeBrowser()) {
      setError("모바일에서는 영상 미리보기를 한 번 재생한 뒤 분석해주세요.");
      setAnalysisFailed(false);
      return;
    }

    setError("");
    setIsConfirmOpen(true);
  }

  async function shareReport() {
    if (analyses.length === 0) {
      return;
    }

    try {
      const saveOptions = {
        serveType,
        serveTypeLabel: serveTypeInfo.title,
      };
      const analysesForSave = await prepareAnalysesForSave(analyses);
      const saved = await saveServeReportRemote(analysesForSave, aiReport, saveOptions).catch((saveError) => {
        if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
          return saveServeReport(analysesForSave, aiReport, saveOptions);
        }

        throw saveError;
      });
      const url = new URL(`/reports/${saved.id}`, window.location.origin);

      window.history.replaceState(null, "", url.toString());

      if (navigator.clipboard) {
        await navigator.clipboard.writeText(url.toString());
        setShareMessage("분석 결과 링크를 복사했습니다.");
      } else {
        setShareMessage("분석 결과가 저장되었습니다. 주소창의 링크로 다시 열 수 있습니다.");
      }
    } catch (saveError) {
      setShareMessage(
        saveError instanceof Error
          ? `결과 저장에 실패했습니다. ${saveError.message}`
          : "결과 저장에 실패했습니다. DB/Blob 환경변수를 확인해주세요.",
      );
    }
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" }).catch(() => null);
    window.location.href = "/login";
  }

  function selectSnapshotFrame(snapshotKey: string, frameIndex: number) {
    setAnalyses((currentAnalyses) =>
      currentAnalyses.map((analysis) => ({
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
    );
  }

  function playSnapshotFrames(snapshotKey: string, frames?: SnapshotFrame[], startIndex = 0) {
    if (!frames?.length) {
      return;
    }

    clearPlaybackTimers();
    setPlayingSnapshotKey(snapshotKey);
    const playbackFrames = frames.slice(startIndex);

    playbackFrames.forEach((_, playbackIndex) => {
      const frameIndex = startIndex + playbackIndex;
      const timerId = window.setTimeout(() => {
        selectSnapshotFrame(snapshotKey, frameIndex);

        if (frameIndex === frames.length - 1) {
          setPlayingSnapshotKey(null);
        }
      }, playbackIndex * 120);

      playbackTimersRef.current.push(timerId);
    });
  }

  function clearPlaybackTimers() {
    playbackTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    playbackTimersRef.current = [];
  }

  return (
    <main className="app-shell">
      <section className="hero-section">
        <div className="hero-content">
          <p className="eyebrow">ServeFit</p>
          <h1 className="brand-headline">내 서브의 반복 습관을 찾아주는 자세 코치</h1>
          <p className="hero-copy">
            서브 1~5회가 담긴 영상을 올리면 촬영 방향에 맞춰 반복 패턴, 대표 장면,
            우선 교정 포인트를 종합 리포트로 보여줍니다.
          </p>
          <div className="hero-metrics" aria-label="분석 요약">
            <span>원본 저장 없음</span>
            <span>1~5회 자동 추정</span>
            <span>구간별 캡처</span>
          </div>
          <a className="hero-history-link" href="/history">
            코칭 기록 보기
          </a>
          <button className="hero-logout-button" onClick={logout} type="button">
            로그아웃
          </button>
        </div>
      </section>

      <section className="analysis-section">
        <div className="setup-panel">
          <div className="panel-heading">
            <p className="eyebrow">Step 1</p>
            <h2>영상과 촬영 방향</h2>
          </div>

          <div className="shooting-guide-card">
            <div>
              <span className="control-label">좋은 촬영 예시</span>
              <p>전신, 라켓, 발, 토스한 공이 화면 안에 들어오도록 촬영해주세요.</p>
            </div>
            <button
              className="guide-image-button"
              onClick={() => setIsGuideZoomOpen(true)}
              type="button"
            >
              <img alt="전신과 라켓이 보이는 서브 촬영 예시" src="/images/serve-capture-guide.jpg" />
            </button>
            <ul>
              <li>카메라는 흔들리지 않게 고정</li>
              <li>사람이 너무 작게 보이는 경기 영상은 피하기</li>
              <li>토스와 임팩트 순간이 화면 밖으로 나가지 않게 촬영</li>
            </ul>
          </div>

          <label className="upload-box">
            <span className="upload-title">서브 영상 선택</span>
            <span className="upload-subtitle">10~40초, 전신이 보이는 세로 영상 권장</span>
            <input accept="video/*" type="file" onChange={handleFileChange} />
          </label>

          {fileName ? <p className="file-name">{fileName}</p> : null}

          <div className="angle-group">
            <span className="control-label">촬영 방향</span>
            <div className="angle-grid">
              {angleOptions.map((option) => (
                <button
                  className={angle === option.value ? "angle-tab active" : "angle-tab"}
                  key={option.value}
                  type="button"
                  onClick={() => setAngle(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="selected-angle">
            <span>현재 모드</span>
            <strong>{angleInfo.title}</strong>
            <p>{angleInfo.helper} 중심으로 코칭 문구가 달라집니다.</p>
          </div>

          <div className="angle-group">
            <span className="control-label">서브 종류</span>
            <div className="angle-grid serve-type-grid">
              {serveTypeOptions.map((option) => (
                <button
                  className={serveType === option.value ? "angle-tab active" : "angle-tab"}
                  key={option.value}
                  type="button"
                  onClick={() => setServeType(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="selected-angle serve-type-summary">
            <span>분석 기준</span>
            <strong>{serveTypeInfo.title}</strong>
            <p>{serveTypeInfo.helper}</p>
          </div>

          <div className="action-row">
            <button
              className="primary-action"
              disabled={isAnalyzing}
              type="button"
              onClick={requestAnalysisConfirmation}
            >
              {isAnalyzing ? "AI 분석 중" : "코칭 결과 보기"}
            </button>
          </div>

          {needsMobileVideoActivation ? (
            <p className="video-ready-hint">모바일에서는 영상 미리보기를 한 번 재생한 뒤 분석할 수 있습니다.</p>
          ) : null}

          {error ? <p className="error-text">{error}</p> : null}
        </div>

        <div className="preview-panel">
          {videoUrl ? (
            <video
              ref={videoRef}
              controls
              playsInline
              preload="auto"
              src={videoUrl}
              onCanPlay={() => setIsVideoReady(true)}
              onLoadedData={() => setIsVideoReady(true)}
              onLoadedMetadata={() => setIsVideoReady(true)}
              onPlay={() => setIsVideoReady(true)}
              onPlaying={() => setIsVideoReady(true)}
            />
          ) : (
            <div className="empty-preview">
              <span>영상 미리보기</span>
              <p>업로드한 서브 영상이 여기에 표시됩니다.</p>
            </div>
          )}
        </div>
      </section>

      {analysisFailed ? (
        <section className="failure-section">
          <p className="eyebrow">Analysis Failed</p>
          <h2>영상 분석 실패</h2>
          <p>
            {error ||
              "전신이 화면 밖으로 나가거나 영상이 너무 어둡거나 흔들리면 분석이 어려울 수 있습니다. 전신이 보이는 짧은 서브 영상으로 다시 시도해주세요."}
          </p>
          {precheckRetryAvailable ? (
            <div className="precheck-retry-box">
              <strong>브라우저 1차 확인이 불안정합니다.</strong>
              <p>
                모바일 브라우저에서는 영상 프레임/자세 확인이 실패할 수 있습니다. 서브 영상이 맞고 촬영 방향을 확인했다면
                AI 분석으로 진행할 수 있습니다.
              </p>
              <button type="button" onClick={() => analyzeVideo({ skipPrecheck: true })}>
                AI 분석으로 진행
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {analyses.length > 0 ? (
        <section className="result-section" ref={resultRef}>
          <div className="summary-row">
            <div>
            <p className="eyebrow">Coaching Result</p>
            <h2>ServeFit 리포트</h2>
            <div className="report-meta-row">
              <p className="report-meta-pill">서브 종류: {serveTypeInfo.title}</p>
              {aiReport ? <p className="report-meta-pill">신뢰도: {formatConfidence(aiReport.confidence)}</p> : null}
            </div>
          </div>
            <button className="share-action" type="button" onClick={shareReport}>
              공유하기
            </button>
          </div>

          {shareMessage ? <p className="share-message">{shareMessage}</p> : null}

          <div className="coach-dashboard">
            <div className="priority-card">
              <p className="coach-kicker">오늘의 우선 교정</p>
              <h3>{aiReport?.todayFocus ?? primaryIssue.title}</h3>
              <p>
                {aiReport?.summary ??
                  "영상 전체에서 가장 자주 보이는 패턴입니다. 한 번에 모든 자세를 고치기보다 이 포인트 하나를 먼저 안정시키는 흐름으로 연습하는 것이 좋습니다."}
              </p>
              {aiReport?.analysisStandard ? <small>{aiReport.analysisStandard}</small> : null}
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
              <span>{aiReport ? getConfidenceLabel(aiReport.confidence) : "분석 결과"}</span>
            </header>

            <div className="coach-notes">
              <div>
                <strong>좋았던 점</strong>
                <p>{analyses[0].strength}</p>
              </div>
              <div>
                <strong>교정 제안</strong>
                <p>{analyses[0].recommendation}</p>
              </div>
            </div>

            <div className="result-section-title">
              <div>
                <p className="eyebrow">Analysis Scenes</p>
                <h3>대표 분석 장면</h3>
              </div>
              <span>영상에서 확인할 수 있는 핵심 자세 포인트</span>
            </div>

            <div className="snapshot-grid focus-grid">
              {representativeSnapshots.map((snapshot) => (
                <figure className="snapshot-card" key={snapshot.key}>
                  <button
                    aria-label={`${snapshot.name} 연속 프레임 재생`}
                    className="image-wrap image-play-trigger"
                    onClick={() => playSnapshotFrames(snapshot.sourceKey, snapshot.frames)}
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
                    <div
                      className={`frame-strip ${playingSnapshotKey === snapshot.sourceKey ? "is-playing" : ""}`}
                      aria-label={`${snapshot.name} 주변 프레임`}
                    >
                      {snapshot.frames.map((frame, frameIndex) => (
                        <button
                          className={`frame-thumb ${
                            snapshot.selectedFrameIndex === frameIndex ? "is-selected" : ""
                          }`}
                          key={`${snapshot.key}-frame-${frame.time}`}
                          onClick={() => selectSnapshotFrame(snapshot.sourceKey, frameIndex)}
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
      ) : null}

      {isAnalyzing ? (
        <div className="analysis-overlay" role="status" aria-live="polite">
          <div className="analysis-loader">
            <span className="loader-ring" aria-hidden="true" />
            <strong>AI가 서브 영상을 분석 중입니다</strong>
            <p>먼저 서브 동작인지 확인한 뒤, 중요 장면과 코칭 리포트를 만드는 중이에요.</p>
          </div>
        </div>
      ) : null}

      {isConfirmOpen ? (
        <div className="confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
          <div className="confirm-card">
            <p className="eyebrow">Before Analysis</p>
            <h2 id="confirm-title">분석 기준을 확인해주세요</h2>
            <p>
              촬영 방향과 서브 종류가 맞아야 AI가 더 정확하게 코칭합니다. 선택값이 다르면 캡처 장면과 교정 포인트가 어긋날 수 있습니다.
            </p>

            <div className="confirm-summary">
              <div>
                <span>촬영 방향</span>
                <strong>{angleInfo.title}</strong>
              </div>
              <div>
                <span>서브 종류</span>
                <strong>{serveTypeInfo.title}</strong>
              </div>
            </div>

            <div className="confirm-actions">
              <button className="secondary-confirm" type="button" onClick={() => setIsConfirmOpen(false)}>
                다시 선택
              </button>
              <button className="primary-confirm" type="button" onClick={() => analyzeVideo()}>
                이 기준으로 분석
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isGuideZoomOpen ? (
        <div className="guide-zoom-overlay" role="dialog" aria-modal="true" aria-label="촬영 가이드 이미지 확대">
          <button className="guide-zoom-backdrop" onClick={() => setIsGuideZoomOpen(false)} type="button" />
          <div className="guide-zoom-card">
            <button className="guide-zoom-close" onClick={() => setIsGuideZoomOpen(false)} type="button">
              닫기
            </button>
            <div className="guide-zoom-scroll">
              <img alt="전신과 라켓이 보이는 서브 촬영 예시 확대 이미지" src="/images/serve-capture-guide.jpg" />
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

async function requestAiServeAnalysis(
  file: File,
  angle: CameraAngle,
  serveType: ServeType,
  duration: number,
  poseSummary: Record<string, number | string | undefined>,
) {
  const formData = new FormData();
  formData.append("video", file);
  formData.append("angle", angle);
  formData.append("serveType", serveType);
  formData.append("duration", String(duration));
  formData.append("poseSummary", JSON.stringify(poseSummary));

  const response = await fetch("/api/analyze-serve", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    if (response.status === 413) {
      throw new Error("영상 용량이 커서 분석 서버로 보낼 수 없습니다. 20초 이하로 자르거나 화질을 낮춰 다시 올려주세요.");
    }
    throw new Error(data?.error ?? "영상 분석 실패");
  }

  return (await response.json()) as GeminiServeReport;
}

async function prepareVideoForAiUpload(file: File, video: HTMLVideoElement, duration: number) {
  if (file.size <= maxDirectAiUploadBytes) {
    return file;
  }

  if (typeof MediaRecorder === "undefined") {
    throw new Error("영상 용량이 커서 분석 서버로 보낼 수 없습니다. 20초 이하로 잘라 다시 올려주세요.");
  }

  const compressed = await transcodeVideoForAnalysis(video, duration, file.name);

  if (compressed.size > maxDirectAiUploadBytes) {
    throw new Error("영상 용량이 아직 큽니다. 20초 이하로 자르거나 화질을 낮춘 영상으로 다시 올려주세요.");
  }

  return compressed;
}

async function transcodeVideoForAnalysis(video: HTMLVideoElement, duration: number, originalName: string) {
  const mimeType = pickRecordingMimeType();

  if (!mimeType) {
    throw new Error("이 브라우저에서는 큰 영상을 분석용으로 압축할 수 없습니다. 영상을 짧게 잘라 다시 올려주세요.");
  }

  const sourceWidth = video.videoWidth || 720;
  const sourceHeight = video.videoHeight || 1280;
  const maxDimension = 360;
  const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(2, Math.round(sourceWidth * scale));
  const height = Math.max(2, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("분석용 영상을 준비하지 못했습니다.");
  }

  canvas.width = width;
  canvas.height = height;

  const stream = canvas.captureStream(12);
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 520_000,
  });
  const chunks: BlobPart[] = [];
  const originalState = {
    currentTime: video.currentTime,
    muted: video.muted,
    playbackRate: video.playbackRate,
    paused: video.paused,
  };

  return new Promise<File>((resolve, reject) => {
    let animationId = 0;
    let finished = false;
    const maxDuration = Math.min(Math.max(duration, 1), 24);
    const timeoutId = window.setTimeout(() => finish(new Error("분석용 영상 준비 시간이 초과되었습니다.")), (maxDuration + 6) * 1000);

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      window.cancelAnimationFrame(animationId);
      video.removeEventListener("ended", handleEnded);
      stream.getTracks().forEach((track) => track.stop());
      video.muted = originalState.muted;
      video.playbackRate = originalState.playbackRate;

      if (originalState.paused) {
        video.pause();
      }

      video.currentTime = Math.min(originalState.currentTime, Math.max(video.duration - 0.1, 0));
    };

    const finish = (error?: Error) => {
      if (finished) {
        return;
      }

      finished = true;

      if (error) {
        cleanup();
        reject(error);
        return;
      }

      if (recorder.state !== "inactive") {
        recorder.stop();
      }
    };

    const draw = () => {
      context.drawImage(video, 0, 0, width, height);

      if (video.currentTime >= maxDuration || video.ended) {
        finish();
        return;
      }

      animationId = window.requestAnimationFrame(draw);
    };

    const handleEnded = () => finish();

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    };
    recorder.onerror = () => finish(new Error("분석용 영상 압축에 실패했습니다."));
    recorder.onstop = () => {
      cleanup();
      const blob = new Blob(chunks, { type: mimeType });
      const safeName = originalName.replace(/\.[^.]+$/, "") || "serve-video";
      resolve(new File([blob], `${safeName}-analysis.webm`, { type: mimeType }));
    };

    video.addEventListener("ended", handleEnded, { once: true });

    seekVideoFrame(video, 0)
      .then(() => {
        video.muted = true;
        video.playbackRate = 1;
        recorder.start(250);
        draw();
        return video.play();
      })
      .catch((error) => finish(error instanceof Error ? error : new Error("분석용 영상을 재생하지 못했습니다.")));
  });
}

function pickRecordingMimeType() {
  const candidates = ["video/webm;codecs=vp8", "video/webm"];

  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "";
}

async function prepareAnalysesForSave(analyses: ServeAnalysis[]) {
  return Promise.all(
    analyses.map(async (analysis) => ({
      ...analysis,
      snapshots: await Promise.all(
        analysis.snapshots.map(async (snapshot) => ({
          ...snapshot,
          image: await compressDataUrlImage(snapshot.image),
          frames: snapshot.frames?.length
            ? await Promise.all(
                snapshot.frames.map(async (frame) => ({
                  ...frame,
                  image: await compressDataUrlImage(frame.image),
                })),
              )
            : snapshot.frames,
        })),
      ),
    })),
  );
}

async function compressDataUrlImage(value: string, maxDimension = 420, quality = 0.56) {
  if (!value.startsWith("data:image/")) {
    return value;
  }

  const image = await loadImage(value);
  const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
  const width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
  const height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  canvas.width = width;
  canvas.height = height;

  if (!context) {
    return value;
  }

  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality);
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("저장용 캡처 이미지를 압축하지 못했습니다."));
    image.src = src;
  });
}

async function precheckServeVideo(video: HTMLVideoElement, duration: number, angle: CameraAngle) {
  const landmarker = await withTimeout(createPoseLandmarker(3), 6000).catch(() => null);

  if (!landmarker) {
    return {
      valid: false,
      usableFrameCount: 0,
      serveMotionFrameCount: 0,
      analysisReadyFrameCount: 0,
      multiPersonFrameCount: 0,
      message: "브라우저에서 자세 확인을 준비하지 못했습니다. 영상을 한 번 재생한 뒤 다시 시도해주세요.",
      canRetryWithAi: true,
    };
  }

  try {
    const samples: PoseSample[] = [];
    const sampleTimes = buildPoseSampleTimes(duration, 1.2, 16);

    for (const time of sampleTimes) {
      const detectedPoses = await withTimeout(detectPosesAtTime(video, time, landmarker), 1800).catch(() => undefined);
      const landmarks = detectedPoses?.[0];

      if (!landmarks) {
        continue;
      }

      const sample = {
        time,
        landmarks,
        poseCount: detectedPoses?.length ?? 1,
      };

      if (isUsablePoseSample(sample)) {
        samples.push(sample);
      }
    }

    const result = assessServeVideoCandidate(samples, angle);

    return {
      ...result,
      canRetryWithAi:
        !result.valid &&
        samples.length > 0 &&
        (isMobileLikeBrowser() || result.usableFrameCount > 0) &&
        (result.multiPersonFrameCount ?? 0) <= 1,
    };
  } finally {
    landmarker.close();
  }
}

function createSkippedPrecheck(angle: CameraAngle) {
  return {
    valid: true,
    usableFrameCount: 0,
    serveMotionFrameCount: 0,
    analysisReadyFrameCount: 0,
    multiPersonFrameCount: 0,
    cameraAngle: angle,
    message: "브라우저 1차 확인을 건너뛰고 AI 분석으로 진행합니다.",
    canRetryWithAi: false,
  };
}

function formatPrecheckError(precheck: Awaited<ReturnType<typeof precheckServeVideo>>) {
  const baseMessage = precheck.message ?? "서브 영상으로 확인되지 않았습니다.";

  return `${baseMessage} (진단: usable ${precheck.usableFrameCount}, ready ${
    precheck.analysisReadyFrameCount ?? 0
  }, motion ${precheck.serveMotionFrameCount}, multi ${precheck.multiPersonFrameCount ?? 0})`;
}

function isMobileLikeBrowser() {
  if (typeof navigator === "undefined") {
    return false;
  }

  return (
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
    window.matchMedia?.("(pointer: coarse)")?.matches === true
  );
}

function buildRepresentativeSnapshots(analyses: ServeAnalysis[]) {
  const first = analyses[0];

  if (!first) {
    return [];
  }

  return first.snapshots.slice(0, serveFocusAreas.length).map((snapshot) => ({
    ...snapshot,
    sourceKey: snapshot.key,
    key: `representative-${snapshot.key}`,
  }));
}

function ensureMetadata(video: HTMLVideoElement) {
  if (video.readyState >= 1 && Number.isFinite(video.duration) && video.duration > 0) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      window.clearTimeout(timeoutId);
      video.removeEventListener("loadedmetadata", handleReady);
      video.removeEventListener("loadeddata", handleReady);
      video.removeEventListener("canplay", handleReady);
      video.removeEventListener("error", handleError);
    };
    const handleReady = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        cleanup();
        resolve();
      }
    };
    const handleError = () => {
      cleanup();
      reject(new Error("video load failed"));
    };
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error("video metadata timeout"));
    }, 10000);

    video.addEventListener("loadedmetadata", handleReady);
    video.addEventListener("loadeddata", handleReady);
    video.addEventListener("canplay", handleReady);
    video.addEventListener("error", handleError);
    video.load();
    handleReady();
  });
}

async function captureFrame(video: HTMLVideoElement, time: number, landmarks?: PoseLandmarkPoint[]) {
  await seekVideoFrame(video, time);

  const canvas = document.createElement("canvas");
  const sourceWidth = video.videoWidth || 720;
  const sourceHeight = video.videoHeight || 1280;
  const maxDimension = 560;
  const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
  const width = Math.round(sourceWidth * scale);
  const height = Math.round(sourceHeight * scale);
  const context = canvas.getContext("2d");

  canvas.width = width;
  canvas.height = height;

  if (!context) {
    throw new Error("캡처 이미지를 만들 수 없습니다.");
  }

  context.drawImage(video, 0, 0, width, height);
  if (landmarks && landmarks.length > 0) {
    drawPoseOverlay(context, width, height, landmarks);
  }

  return canvas.toDataURL("image/jpeg", 0.64);
}

async function detectPoseAtTime(video: HTMLVideoElement, time: number, landmarker: BrowserPoseLandmarker) {
  const poses = await detectPosesAtTime(video, time, landmarker);
  return poses[0];
}

async function detectPosesAtTime(
  video: HTMLVideoElement,
  time: number,
  landmarker: BrowserPoseLandmarker,
  timestampMs?: number,
) {
  await seekVideoFrame(video, time);
  const result = withMediaPipeConsoleNoiseSilenced(() =>
    landmarker.detectForVideo(video, timestampMs ?? video.currentTime * 1000),
  );
  return result.landmarks;
}

async function refineMomentTime(
  video: HTMLVideoElement,
  moment: { time: number; title: string; comment: string },
  landmarker: BrowserPoseLandmarker,
  nextTimestampMs: () => number,
) {
  const times = buildRefinementTimes(moment.time, video.duration || moment.time);
  let best: { time: number; landmarks?: PoseLandmarkPoint[]; score: number } = {
    time: moment.time,
    score: Number.NEGATIVE_INFINITY,
  };

  for (let index = 0; index < times.length; index += 1) {
    const time = times[index];
    const poses = await detectPosesAtTime(video, time, landmarker, nextTimestampMs()).catch(() => undefined);
    const landmarks = poses?.[0];

    if (!landmarks) {
      continue;
    }

    const score = scoreMomentFrame(moment, { time, landmarks });

    if (score > best.score) {
      best = { time, landmarks, score };
    }
  }

  return {
    time: best.landmarks ? best.time : moment.time,
    landmarks: best.landmarks,
  };
}

function buildRefinementTimes(centerTime: number, duration: number) {
  const windowSeconds = 0.6;
  const stepSeconds = 0.05;
  const start = Math.max(0, centerTime - windowSeconds);
  const end = Math.min(Math.max(duration - 0.05, 0), centerTime + windowSeconds);
  const times: number[] = [];

  for (let time = start; time <= end; time += stepSeconds) {
    times.push(Number(time.toFixed(3)));
  }

  if (!times.includes(centerTime)) {
    times.push(centerTime);
  }

  return times.sort((a, b) => a - b);
}

async function buildSnapshotFrames(
  video: HTMLVideoElement,
  centerTime: number,
  duration: number,
  landmarker: BrowserPoseLandmarker,
  nextTimestampMs: () => number,
) {
  const offsets = [-0.5, -0.333, -0.167, 0, 0.167, 0.333, 0.5];
  const uniqueTimes = Array.from(
    new Set(
      offsets.map((offset) => Number(Math.min(Math.max(centerTime + offset, 0), Math.max(duration - 0.05, 0)).toFixed(3))),
    ),
  ).sort((a, b) => a - b);
  const frames: SnapshotFrame[] = [];

  for (const time of uniqueTimes) {
    const poses = await detectPosesAtTime(video, time, landmarker, nextTimestampMs()).catch(() => undefined);
    const image = await captureFrame(video, time, poses?.[0]);
    frames.push({ image, time });
  }

  return frames;
}

function findNearestFrameIndex(frames: SnapshotFrame[], targetTime: number) {
  if (frames.length === 0) {
    return -1;
  }

  return frames.reduce((bestIndex, frame, index) => {
    const bestDistance = Math.abs(frames[bestIndex].time - targetTime);
    const currentDistance = Math.abs(frame.time - targetTime);
    return currentDistance < bestDistance ? index : bestIndex;
  }, 0);
}

function scoreMomentFrame(moment: { time: number; title: string; comment: string }, sample: PoseSample) {
  const kind = inferMomentKind(`${moment.title} ${moment.comment}`);
  const baseScore = isUsablePoseSample(sample) ? 100 : 0;
  const proximityScore = Math.max(0, 30 - Math.abs(sample.time - moment.time) * 45);
  const wristHeight = getHighestWristScore(sample.landmarks);
  const racketDrop = getRacketDropScore(sample.landmarks);
  const finishBalance = getFinishBalanceScore(sample.landmarks);

  if (kind === "impact") {
    return baseScore + wristHeight * 120 + proximityScore;
  }

  if (kind === "toss") {
    return baseScore + wristHeight * 95 + proximityScore;
  }

  if (kind === "drop") {
    return baseScore + racketDrop * 120 + proximityScore;
  }

  if (kind === "follow") {
    return baseScore + finishBalance * 90 + proximityScore + Math.max(0, sample.time - moment.time) * 12;
  }

  return baseScore + wristHeight * 55 + finishBalance * 25 + proximityScore;
}

function inferMomentKind(text: string) {
  const normalized = text.toLowerCase();

  if (normalized.includes("임팩트") || normalized.includes("타점") || normalized.includes("impact")) {
    return "impact";
  }

  if (normalized.includes("토스") || normalized.includes("toss")) {
    return "toss";
  }

  if (normalized.includes("드롭") || normalized.includes("백스윙") || normalized.includes("drop")) {
    return "drop";
  }

  if (normalized.includes("팔로") || normalized.includes("마무리") || normalized.includes("finish") || normalized.includes("follow")) {
    return "follow";
  }

  return "generic";
}

function getHighestWristScore(landmarks: PoseLandmarkPoint[]) {
  const leftWrist = landmarks[15];
  const rightWrist = landmarks[16];
  const highestWristY = Math.min(leftWrist?.y ?? 1, rightWrist?.y ?? 1);

  return Math.max(0, 1 - highestWristY);
}

function getRacketDropScore(landmarks: PoseLandmarkPoint[]) {
  const leftElbow = landmarks[13];
  const rightElbow = landmarks[14];
  const leftWrist = landmarks[15];
  const rightWrist = landmarks[16];
  const leftDrop = leftWrist && leftElbow ? leftWrist.y - leftElbow.y : 0;
  const rightDrop = rightWrist && rightElbow ? rightWrist.y - rightElbow.y : 0;

  return Math.max(0, leftDrop, rightDrop);
}

function getFinishBalanceScore(landmarks: PoseLandmarkPoint[]) {
  const leftShoulder = landmarks[11];
  const rightShoulder = landmarks[12];
  const leftHip = landmarks[23];
  const rightHip = landmarks[24];

  if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) {
    return 0;
  }

  const shoulderCenterX = (leftShoulder.x + rightShoulder.x) / 2;
  const hipCenterX = (leftHip.x + rightHip.x) / 2;
  const lean = Math.abs(shoulderCenterX - hipCenterX);

  return Math.max(0, 1 - lean * 4);
}

function withMediaPipeConsoleNoiseSilenced<T>(action: () => T) {
  const originalError = console.error;

  console.error = (...args: unknown[]) => {
    if (isKnownMediaPipeConsoleNoise(args)) {
      return;
    }

    originalError(...args);
  };

  try {
    return action();
  } finally {
    console.error = originalError;
  }
}

function installMediaPipeConsoleNoiseFilter() {
  const originalError = console.error;

  console.error = (...args: unknown[]) => {
    if (isKnownMediaPipeConsoleNoise(args)) {
      return;
    }

    originalError(...args);
  };

  return () => {
    console.error = originalError;
  };
}

function isKnownMediaPipeConsoleNoise(args: unknown[]) {
  const message = args.map((arg) => String(arg)).join(" ");

  return (
    message.includes("Aborted()") ||
    message.includes("Packet timestamp mismatch") ||
    message.includes("CalculatorGraph") ||
    message.includes("@mediapipe/tasks-vision") ||
    message.includes("mediapipe")
  );
}

async function createPoseLandmarker(numPoses = 1): Promise<BrowserPoseLandmarker> {
  const { FilesetResolver, PoseLandmarker } = await import("@mediapipe/tasks-vision");
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm",
  );
  const options = {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numPoses,
  } as const;

  return PoseLandmarker.createFromOptions(vision, options).catch(() =>
    PoseLandmarker.createFromOptions(vision, {
      ...options,
      baseOptions: {
        ...options.baseOptions,
        delegate: "CPU",
      },
    }),
  ) as Promise<BrowserPoseLandmarker>;
}

function seekVideoFrame(video: HTMLVideoElement, time: number) {
  const targetTime = Math.min(Math.max(time, 0), Math.max(video.duration - 0.1, 0));

  return new Promise<void>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => finish(), 1200);

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
    };

    const finish = () => {
      cleanup();
      waitForDecodedFrame(video).then(resolve, reject);
    };

    const onSeeked = () => finish();
    const onError = () => {
      cleanup();
      reject(new Error("영상 위치를 이동할 수 없습니다."));
    };

    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onError, { once: true });

    if (Math.abs(video.currentTime - targetTime) < 0.025 && video.readyState >= 2) {
      finish();
      return;
    }

    video.currentTime = targetTime;
  });
}

function waitForDecodedFrame(video: HTMLVideoElement) {
  type VideoFrameElement = HTMLVideoElement & {
    requestVideoFrameCallback?: (callback: () => void) => number;
  };
  const requestFrame = (video as VideoFrameElement).requestVideoFrameCallback;

  if (requestFrame) {
    return new Promise<void>((resolve) => {
      const timeoutId = window.setTimeout(resolve, 250);
      requestFrame.call(video, () => {
        window.clearTimeout(timeoutId);
        resolve();
      });
    });
  }

  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, 80);
  });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => reject(new Error("작업 시간이 초과되었습니다.")), timeoutMs);

    promise.then(
      (value) => {
        window.clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}

function drawPoseOverlay(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  landmarks: PoseLandmarkPoint[],
) {
  const connections = [
    [11, 12],
    [11, 13],
    [13, 15],
    [12, 14],
    [14, 16],
    [11, 23],
    [12, 24],
    [23, 24],
    [23, 25],
    [25, 27],
    [24, 26],
    [26, 28],
  ];

  context.lineWidth = Math.max(width * 0.006, 3);
  context.strokeStyle = "rgba(52, 211, 153, 0.95)";
  context.fillStyle = "rgba(15, 23, 42, 0.88)";

  connections.forEach(([from, to]) => {
    const start = landmarks[from];
    const end = landmarks[to];

    if (!isVisible(start) || !isVisible(end)) {
      return;
    }

    context.beginPath();
    context.moveTo(start.x * width, start.y * height);
    context.lineTo(end.x * width, end.y * height);
    context.stroke();
  });

  landmarks.forEach((landmark, index) => {
    if (!isVisible(landmark) || ![11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28].includes(index)) {
      return;
    }

    context.beginPath();
    context.arc(landmark.x * width, landmark.y * height, Math.max(width * 0.012, 5), 0, Math.PI * 2);
    context.fill();
  });
}

function isVisible(landmark?: PoseLandmarkPoint) {
  return Boolean(landmark && landmark.x >= 0 && landmark.x <= 1 && landmark.y >= 0 && landmark.y <= 1 && (landmark.visibility ?? 1) > 0.35);
}

function formatTime(time: number) {
  return `${time.toFixed(3)}s`;
}

function formatMomentCue(moment: GeminiServeReport["keyMoments"][number]) {
  if (typeof moment.startTime === "number" && typeof moment.endTime === "number") {
    return `${formatTime(moment.startTime)} - ${formatTime(moment.endTime)}`;
  }

  return formatTime(moment.time);
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
