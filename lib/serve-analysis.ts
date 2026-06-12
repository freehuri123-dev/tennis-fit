export type CameraAngle = "back" | "side";

export type ServeSnapshot = {
  key: string;
  name: string;
  cue: string;
  feedback: string;
  image: string;
  time: number;
  debug?: PhaseSelectionDebug;
};

export type PoseLandmarkPoint = {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
};

export type PoseSample = {
  time: number;
  landmarks: PoseLandmarkPoint[];
  poseCount?: number;
};

export type ServePhaseKey = "toss" | "trophy" | "racketDrop" | "impact" | "followThrough";
export type ServeFocusKey = "tossStability" | "bodyBalance" | "upperRotation" | "finishBalance";

export type ServePhase = {
  key: ServePhaseKey;
  name: string;
  cue: string;
  feedback: string;
};

export type ServeFocus = {
  key: ServeFocusKey;
  name: string;
  cue: string;
  feedback: string;
};

export type PoseMetrics = {
  highestWristY: number;
  wristLiftPercent: number;
  racketDropPercent: number;
  shoulderTiltPercent: number;
  serveMotion: boolean;
};

export type PhaseSelectionDebug = {
  reason: string;
  metrics: PoseMetrics;
};

export type CoachingSummary =
  | {
      status: "failed";
      message: "영상 분석 실패";
    }
  | {
      status: "success";
      estimatedServeCount: number;
      representativeSnapshots: ServeSnapshot[];
      topIssues: Array<{ issue: string; count: number }>;
    };

export type ServeCandidateAssessment = {
  valid: boolean;
  usableFrameCount: number;
  serveMotionFrameCount: number;
  analysisReadyFrameCount?: number;
  multiPersonFrameCount?: number;
  cameraAngle?: CameraAngle;
  message?: string;
};

const repeatedIssues: Record<CameraAngle, string[]> = {
  back: ["토스 좌우 편차", "상체 회전 마무리 부족", "착지 후 균형 흔들림"],
  side: ["토스 팔 유지 부족", "트로피 포지션 무릎 굽힘 부족", "임팩트 타점이 낮아지는 경향"],
};

export const servePhases: ServePhase[] = [
  {
    key: "toss",
    name: "토스",
    cue: "토스 팔과 공 위치",
    feedback: "토스 팔이 빨리 내려오거나 좌우로 흔들리는지 확인합니다.",
  },
  {
    key: "trophy",
    name: "트로피",
    cue: "무릎과 어깨 기울기",
    feedback: "무릎 굽힘, 어깨 기울기, 상체 축이 만들어지는지 확인합니다.",
  },
  {
    key: "racketDrop",
    name: "라켓 드롭",
    cue: "라켓 팔 준비 동작",
    feedback: "라켓이 충분히 떨어지고 팔꿈치가 무너지지 않는지 확인합니다.",
  },
  {
    key: "impact",
    name: "임팩트",
    cue: "타점과 머리 위치",
    feedback: "타점이 너무 낮거나 머리 위치가 크게 움직이는지 확인합니다.",
  },
  {
    key: "followThrough",
    name: "팔로스루",
    cue: "회전 마무리와 균형",
    feedback: "임팩트 후 상체 회전과 착지 균형이 이어지는지 확인합니다.",
  },
];

export const serveFocusAreas: ServeFocus[] = [
  {
    key: "tossStability",
    name: "토스 안정성",
    cue: "공을 올리는 팔과 몸의 흔들림",
    feedback: "토스가 몸 중심에서 크게 벗어나면 임팩트 위치와 스윙 방향이 같이 흔들릴 수 있습니다.",
  },
  {
    key: "bodyBalance",
    name: "몸 중심",
    cue: "상체와 골반의 중심 이동",
    feedback: "준비부터 스윙까지 몸 중심이 한쪽으로 무너지지 않는지 확인합니다.",
  },
  {
    key: "upperRotation",
    name: "상체 회전",
    cue: "어깨 기울기와 회전 준비",
    feedback: "상체 회전이 너무 빠르거나 늦으면 라켓이 올라오는 타이밍이 어긋날 수 있습니다.",
  },
  {
    key: "finishBalance",
    name: "마무리 균형",
    cue: "임팩트 이후 착지와 팔로스루",
    feedback: "스윙 이후 몸이 앞으로 자연스럽게 이동하고 균형이 유지되는지 확인합니다.",
  },
];

export function estimateServeCount(duration: number) {
  if (duration < 12) {
    return 1;
  }

  if (duration < 20) {
    return 2;
  }

  if (duration < 30) {
    return 3;
  }

  if (duration < 42) {
    return 4;
  }

  return 5;
}

export function buildPoseSampleTimes(duration: number, framesPerSecond = 3, maxSamples = 120) {
  const sampleCount = Math.min(Math.max(Math.floor(duration * framesPerSecond), 1), maxSamples);
  const interval = duration / sampleCount;

  return Array.from({ length: sampleCount }, (_, index) => Math.min((index + 1) * interval, duration - 0.05));
}

export function pickRepresentativeSnapshots(snapshots: ServeSnapshot[]) {
  if (snapshots.length <= 4) {
    return snapshots;
  }

  const indexes = [0, Math.floor(snapshots.length / 3), Math.floor((snapshots.length * 2) / 3), snapshots.length - 1];
  return indexes.map((index) => snapshots[index]);
}

export function findNearestPoseSample(samples: PoseSample[], targetTime: number) {
  if (samples.length === 0) {
    return undefined;
  }

  return samples.reduce((nearest, sample) => {
    const currentDistance = Math.abs(sample.time - targetTime);
    const nearestDistance = Math.abs(nearest.time - targetTime);
    return currentDistance < nearestDistance ? sample : nearest;
  });
}

export function isUsablePoseSample(sample: PoseSample) {
  const bounds = getVisiblePoseBounds(sample);

  if (!bounds) {
    return false;
  }

  return bounds.height >= 0.18 && bounds.width >= 0.04;
}

export function isAnalysisReadyPoseSample(sample: PoseSample) {
  const bounds = getVisiblePoseBounds(sample);

  if (!bounds) {
    return false;
  }

  const hasCoreBody =
    isVisible(sample.landmarks[11]) &&
    isVisible(sample.landmarks[12]) &&
    isVisible(sample.landmarks[23]) &&
    isVisible(sample.landmarks[24]);
  const hasLowerBody = isVisible(sample.landmarks[27]) || isVisible(sample.landmarks[28]);

  return hasCoreBody && hasLowerBody && bounds.height >= 0.22 && bounds.width >= 0.045;
}

function getVisiblePoseBounds(sample: PoseSample) {
  const visible = sample.landmarks.filter(
    (landmark) =>
      landmark.x >= 0 &&
      landmark.x <= 1 &&
      landmark.y >= 0 &&
      landmark.y <= 1 &&
      isVisible(landmark),
  );

  if (visible.length < 3) {
    return undefined;
  }

  const xs = visible.map((landmark) => landmark.x);
  const ys = visible.map((landmark) => landmark.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);

  return { width, height };
}

function isVisible(landmark?: PoseLandmarkPoint) {
  return Boolean(landmark && (landmark.visibility ?? 1) > 0.35);
}

export function looksLikeServeMotion(sample: PoseSample) {
  const leftShoulder = sample.landmarks[11];
  const rightShoulder = sample.landmarks[12];
  const leftWrist = sample.landmarks[15];
  const rightWrist = sample.landmarks[16];

  if (!leftShoulder || !rightShoulder || !leftWrist || !rightWrist) {
    return false;
  }

  const shoulderY = Math.min(leftShoulder.y, rightShoulder.y);
  return leftWrist.y < shoulderY || rightWrist.y < shoulderY;
}

export function preferServeMotionSamples(samples: PoseSample[]) {
  const serveLikeSamples = samples.filter(looksLikeServeMotion);
  return serveLikeSamples.length >= 3 ? serveLikeSamples : samples;
}

export function assessServeVideoCandidate(samples: PoseSample[], expectedAngle?: CameraAngle): ServeCandidateAssessment {
  const usableSamples = samples.filter(isUsablePoseSample);
  const analysisReadySamples = usableSamples.filter(isAnalysisReadyPoseSample);
  const serveMotionSamples = usableSamples.filter(looksLikeServeMotion);
  const multiPersonSamples = usableSamples.filter((sample) => (sample.poseCount ?? 1) > 1);
  const cameraAngle = inferCameraAngle(usableSamples);
  const hasEnoughAnalysisEvidence = analysisReadySamples.length >= 2;
  const hasServeMotionFallback = analysisReadySamples.length >= 1 && serveMotionSamples.length >= 1 && usableSamples.length >= 3;
  const looksLikeGameClipWithoutServeMotion = multiPersonSamples.length >= 2 && serveMotionSamples.length === 0;
  const valid = !looksLikeGameClipWithoutServeMotion && (hasEnoughAnalysisEvidence || hasServeMotionFallback);

  return {
    valid,
    usableFrameCount: usableSamples.length,
    serveMotionFrameCount: serveMotionSamples.length,
    analysisReadyFrameCount: analysisReadySamples.length,
    multiPersonFrameCount: multiPersonSamples.length,
    cameraAngle,
    message: valid ? undefined : "서브 동작이 확인되지 않았습니다. 전신이 보이는 옆 또는 뒤 촬영 서브 영상으로 다시 올려주세요.",
  };
}

export function inferCameraAngle(samples: PoseSample[]): CameraAngle | undefined {
  const angles = samples.map(inferCameraAngleFromSample).filter((angle): angle is CameraAngle => Boolean(angle));
  const backCount = angles.filter((angle) => angle === "back").length;
  const sideCount = angles.filter((angle) => angle === "side").length;

  if (backCount >= 2 && backCount >= sideCount) {
    return "back";
  }

  if (sideCount >= 2 && sideCount > backCount) {
    return "side";
  }

  return undefined;
}

function inferCameraAngleFromSample(sample: PoseSample): CameraAngle | undefined {
  const leftShoulder = sample.landmarks[11];
  const rightShoulder = sample.landmarks[12];
  const leftHip = sample.landmarks[23];
  const rightHip = sample.landmarks[24];

  if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) {
    return undefined;
  }

  const shoulderWidth = Math.abs(leftShoulder.x - rightShoulder.x);
  const hipWidth = Math.abs(leftHip.x - rightHip.x);
  const bodyWidth = (shoulderWidth + hipWidth) / 2;

  if (bodyWidth >= 0.095) {
    return "back";
  }

  if (bodyWidth <= 0.055) {
    return "side";
  }

  return undefined;
}

export function selectPhaseSamples(samples: PoseSample[]) {
  if (samples.length === 0) {
    return [];
  }

  const sorted = [...samples].sort((a, b) => a.time - b.time);
  const serveLikeSamples = sorted.filter(looksLikeServeMotion);
  const toss = serveLikeSamples[0] ?? sorted[0];
  const afterToss = sorted.filter((sample) => sample.time > toss.time);
  const impact = maxBy(afterToss.length > 0 ? afterToss : sorted, wristHeightScore) ?? sorted[sorted.length - 1];
  const beforeImpact = sorted.filter((sample) => sample.time > toss.time && sample.time < impact.time);
  const racketDrop = maxBy(beforeImpact, racketDropScore) ?? pickByRatio(sorted, 0.5);
  const beforeDrop = sorted.filter((sample) => sample.time >= toss.time && sample.time < racketDrop.time);
  const trophy = maxBy(beforeDrop, shoulderTiltScore) ?? pickByRatio(sorted, 0.25);
  const afterImpact = sorted.filter((sample) => sample.time > impact.time);
  const followThrough = afterImpact[afterImpact.length - 1] ?? sorted[sorted.length - 1];
  const phaseSamples = [toss, trophy, racketDrop, impact, followThrough];

  return servePhases.map((phase, index) => {
    const sample = phaseSamples[index] ?? pickByRatio(sorted, index / (servePhases.length - 1));

    return {
      phase,
      sample,
      debug: explainPhaseSelection(phase.key, sample),
    };
  });
}

export function selectAnalysisSamples(samples: PoseSample[]) {
  if (samples.length === 0) {
    return [];
  }

  const sorted = [...samples].sort((a, b) => a.time - b.time);
  const serveLikeSamples = sorted.filter(looksLikeServeMotion);
  const firstServeLike = serveLikeSamples[0] ?? pickByRatio(sorted, 0.2);
  const highestWrist = maxBy(sorted.filter((sample) => sample.time >= firstServeLike.time), wristHeightScore) ?? firstServeLike;
  const afterHighestWrist = sorted.filter((sample) => sample.time > highestWrist.time);
  const preferredSamples = [
    firstServeLike,
    maxBy(sorted, bodyLeanScore) ?? pickByRatio(sorted, 0.38),
    maxBy(sorted, shoulderTiltScore) ?? pickByRatio(sorted, 0.62),
    afterHighestWrist[afterHighestWrist.length - 1] ?? sorted[sorted.length - 1],
  ];
  const usedTimes = new Set<number>();

  return serveFocusAreas.map((focus, index) => {
    return {
      focus,
      sample: pickDistinctSample(preferredSamples[index], sorted, usedTimes, index / (serveFocusAreas.length - 1)),
    };
  });
}

export function explainPhaseSelection(phaseKey: ServePhaseKey, sample: PoseSample): PhaseSelectionDebug {
  const metrics = analyzePoseSampleMetrics(sample);
  const reasonByPhase: Record<ServePhaseKey, string> = {
    toss: "손목이 어깨보다 위로 올라가기 시작한 첫 구간을 토스 후보로 봅니다.",
    trophy: "토스 이후 어깨 기울기와 상체 회전이 가장 크게 보이는 구간을 트로피 후보로 봅니다.",
    racketDrop: "임팩트 전 손목이 팔꿈치보다 내려간 정도가 큰 구간을 라켓 드롭 후보로 봅니다.",
    impact: "토스 이후 손목이 가장 높게 올라간 구간을 임팩트 후보로 봅니다.",
    followThrough: "임팩트 이후 마지막으로 감지된 자세를 팔로스루 후보로 봅니다.",
  };

  return {
    reason: reasonByPhase[phaseKey],
    metrics,
  };
}

export function analyzePoseSampleMetrics(sample: PoseSample): PoseMetrics {
  const highestWristY = Math.min(sample.landmarks[15]?.y ?? 1, sample.landmarks[16]?.y ?? 1);

  return {
    highestWristY,
    wristLiftPercent: clampPercent((1 - highestWristY) * 100),
    racketDropPercent: clampPercent(racketDropScore(sample) * 100),
    shoulderTiltPercent: clampPercent(shoulderTiltScore(sample) * 100),
    serveMotion: looksLikeServeMotion(sample),
  };
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function pickByRatio(samples: PoseSample[], ratio: number) {
  const index = Math.floor(ratio * (samples.length - 1));
  return samples[index];
}

function pickDistinctSample(preferred: PoseSample, samples: PoseSample[], usedTimes: Set<number>, fallbackRatio: number) {
  const preferredKey = Math.round(preferred.time * 100);

  if (!usedTimes.has(preferredKey)) {
    usedTimes.add(preferredKey);
    return preferred;
  }

  const fallback = samples.find((sample) => !usedTimes.has(Math.round(sample.time * 100))) ?? pickByRatio(samples, fallbackRatio);
  usedTimes.add(Math.round(fallback.time * 100));
  return fallback;
}

function maxBy(samples: PoseSample[], score: (sample: PoseSample) => number) {
  if (samples.length === 0) {
    return undefined;
  }

  return samples.reduce((best, sample) => (score(sample) > score(best) ? sample : best));
}

function wristHeightScore(sample: PoseSample) {
  const leftWrist = sample.landmarks[15];
  const rightWrist = sample.landmarks[16];
  return -Math.min(leftWrist?.y ?? 1, rightWrist?.y ?? 1);
}

function racketDropScore(sample: PoseSample) {
  const leftElbow = sample.landmarks[13];
  const rightElbow = sample.landmarks[14];
  const leftWrist = sample.landmarks[15];
  const rightWrist = sample.landmarks[16];
  const leftDrop = leftWrist && leftElbow ? leftWrist.y - leftElbow.y : 0;
  const rightDrop = rightWrist && rightElbow ? rightWrist.y - rightElbow.y : 0;
  return Math.max(leftDrop, rightDrop);
}

function shoulderTiltScore(sample: PoseSample) {
  const leftShoulder = sample.landmarks[11];
  const rightShoulder = sample.landmarks[12];
  return leftShoulder && rightShoulder ? Math.abs(leftShoulder.y - rightShoulder.y) : 0;
}

function bodyLeanScore(sample: PoseSample) {
  const leftShoulder = sample.landmarks[11];
  const rightShoulder = sample.landmarks[12];
  const leftHip = sample.landmarks[23];
  const rightHip = sample.landmarks[24];

  if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) {
    return 0;
  }

  const shoulderCenterX = (leftShoulder.x + rightShoulder.x) / 2;
  const hipCenterX = (leftHip.x + rightHip.x) / 2;
  return Math.abs(shoulderCenterX - hipCenterX);
}

export function buildCoachingSummary({
  angle,
  duration,
  poseFrameCount,
  snapshots,
}: {
  angle: CameraAngle;
  duration: number;
  poseFrameCount: number;
  snapshots: ServeSnapshot[];
}): CoachingSummary {
  if (poseFrameCount < 1) {
    return {
      status: "failed",
      message: "영상 분석 실패",
    };
  }

  const estimatedServeCount = estimateServeCount(duration);

  return {
    status: "success",
    estimatedServeCount,
    representativeSnapshots: pickRepresentativeSnapshots(snapshots),
    topIssues: repeatedIssues[angle].map((issue, index) => ({
      issue,
      count: Math.max(estimatedServeCount - index, 1),
    })),
  };
}
