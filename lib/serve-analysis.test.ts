import { describe, expect, it } from "vitest";
import {
  analyzePoseSampleMetrics,
  assessServeVideoCandidate,
  buildCoachingSummary,
  buildPoseSampleTimes,
  estimateServeCount,
  explainPhaseSelection,
  findNearestPoseSample,
  isUsablePoseSample,
  looksLikeServeMotion,
  pickRepresentativeSnapshots,
  preferServeMotionSamples,
  selectAnalysisSamples,
  selectPhaseSamples,
} from "./serve-analysis";

describe("estimateServeCount", () => {
  it("estimates one to five serves from short video duration", () => {
    expect(estimateServeCount(8)).toBe(1);
    expect(estimateServeCount(17)).toBe(2);
    expect(estimateServeCount(24)).toBe(3);
    expect(estimateServeCount(35)).toBe(4);
    expect(estimateServeCount(55)).toBe(5);
  });
});

describe("buildPoseSampleTimes", () => {
  it("samples roughly three frames per second across the video", () => {
    const times = buildPoseSampleTimes(20);

    expect(times).toHaveLength(60);
    expect(times[0]).toBeCloseTo(0.33, 1);
    expect(times[times.length - 1]).toBeLessThan(20);
  });

  it("caps very long videos to keep browser analysis bounded", () => {
    const times = buildPoseSampleTimes(90);

    expect(times).toHaveLength(120);
  });
});

describe("pickRepresentativeSnapshots", () => {
  it("keeps the coaching result under five snapshots", () => {
    const snapshots = Array.from({ length: 12 }, (_, index) => ({
      key: `snapshot-${index}`,
      name: `Snapshot ${index}`,
      cue: "cue",
      feedback: "feedback",
      image: `image-${index}`,
      time: index,
    }));

    const picked = pickRepresentativeSnapshots(snapshots);

    expect(picked).toHaveLength(4);
    expect(picked.map((snapshot) => snapshot.key)).toEqual([
      "snapshot-0",
      "snapshot-4",
      "snapshot-8",
      "snapshot-11",
    ]);
  });
});

describe("findNearestPoseSample", () => {
  it("returns the pose sample closest to the target time", () => {
    const sample = findNearestPoseSample(
      [
        { time: 1, landmarks: [{ x: 0.1, y: 0.2 }] },
        { time: 4, landmarks: [{ x: 0.3, y: 0.4 }] },
        { time: 8, landmarks: [{ x: 0.5, y: 0.6 }] },
      ],
      5,
    );

    expect(sample?.time).toBe(4);
  });

  it("returns undefined when there are no pose samples", () => {
    expect(findNearestPoseSample([], 3)).toBeUndefined();
  });
});

describe("isUsablePoseSample", () => {
  it("rejects pose samples that are too small to analyze", () => {
    expect(
      isUsablePoseSample({
        time: 1,
        landmarks: [
          { x: 0.5, y: 0.5, visibility: 0.9 },
          { x: 0.51, y: 0.51, visibility: 0.9 },
        ],
      }),
    ).toBe(false);
  });

  it("accepts pose samples with enough visible body height", () => {
    expect(
      isUsablePoseSample({
        time: 1,
        landmarks: [
          { x: 0.4, y: 0.2, visibility: 0.9 },
          { x: 0.5, y: 0.35, visibility: 0.9 },
          { x: 0.45, y: 0.72, visibility: 0.9 },
        ],
      }),
    ).toBe(true);
  });
});

describe("looksLikeServeMotion", () => {
  it("rejects walking-like samples where both wrists are low", () => {
    const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
    landmarks[11] = { x: 0.44, y: 0.32, visibility: 0.9 };
    landmarks[12] = { x: 0.56, y: 0.32, visibility: 0.9 };
    landmarks[15] = { x: 0.43, y: 0.7, visibility: 0.9 };
    landmarks[16] = { x: 0.57, y: 0.7, visibility: 0.9 };

    expect(looksLikeServeMotion({ time: 1, landmarks })).toBe(false);
  });

  it("accepts serve-like samples when a wrist is above the shoulders", () => {
    const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
    landmarks[11] = { x: 0.44, y: 0.42, visibility: 0.9 };
    landmarks[12] = { x: 0.56, y: 0.42, visibility: 0.9 };
    landmarks[15] = { x: 0.43, y: 0.28, visibility: 0.9 };
    landmarks[16] = { x: 0.57, y: 0.6, visibility: 0.9 };

    expect(looksLikeServeMotion({ time: 1, landmarks })).toBe(true);
  });
});

describe("preferServeMotionSamples", () => {
  it("uses serve-like samples when enough are available", () => {
    const walking = makePoseSample(1, 0.7);
    const serveOne = makePoseSample(2, 0.25);
    const serveTwo = makePoseSample(3, 0.24);
    const serveThree = makePoseSample(4, 0.23);

    expect(preferServeMotionSamples([walking, serveOne, serveTwo, serveThree])).toEqual([
      serveOne,
      serveTwo,
      serveThree,
    ]);
  });

  it("falls back to usable pose samples when serve-like samples are sparse", () => {
    const walking = makePoseSample(1, 0.7);
    const serveOne = makePoseSample(2, 0.25);

    expect(preferServeMotionSamples([walking, serveOne])).toEqual([walking, serveOne]);
  });
});

describe("assessServeVideoCandidate", () => {
  it("accepts videos with enough visible pose even when sampled arm lift is missed", () => {
    const assessment = assessServeVideoCandidate([
      makePoseSample(1, 0.7),
      makePoseSample(2, 0.7),
    ]);

    expect(assessment.valid).toBe(true);
    expect(assessment.serveMotionFrameCount).toBe(0);
  });

  it("rejects videos where a usable person pose is barely detected", () => {
    const assessment = assessServeVideoCandidate([makePoseSample(1, 0.7)]);

    expect(assessment.valid).toBe(false);
  });

  it("accepts videos with visible full-body serve-like samples", () => {
    const assessment = assessServeVideoCandidate([
      makePoseSample(1, 0.7),
      makePoseSample(2, 0.25),
    ]);

    expect(assessment.valid).toBe(true);
    expect(assessment.usableFrameCount).toBe(2);
    expect(assessment.serveMotionFrameCount).toBe(1);
  });

  it("accepts matching back-view serve candidates", () => {
    const assessment = assessServeVideoCandidate(
      [
        makePoseSample(1, 0.7),
        makePoseSample(2, 0.25),
        makePoseSample(3, 0.24),
        makePoseSample(4, 0.7),
      ],
      "back",
    );

    expect(assessment.valid).toBe(true);
    expect(assessment.cameraAngle).toBe("back");
  });

  it("accepts matching side-view serve candidates", () => {
    const assessment = assessServeVideoCandidate(
      [
        makePoseSample(1, 0.7, "side"),
        makePoseSample(2, 0.25, "side"),
        makePoseSample(3, 0.24, "side"),
        makePoseSample(4, 0.7, "side"),
      ],
      "side",
    );

    expect(assessment.valid).toBe(true);
    expect(assessment.cameraAngle).toBe("side");
  });

  it("does not reject angle mismatch when serve motion is visible", () => {
    const assessment = assessServeVideoCandidate(
      [
        makePoseSample(1, 0.7, "diagonal"),
        makePoseSample(2, 0.25, "diagonal"),
      ],
      "side",
    );

    expect(assessment.valid).toBe(true);
  });

  it("rejects game-like samples when multiple people are repeatedly detected", () => {
    const assessment = assessServeVideoCandidate([
      makePoseSample(1, 0.7, "back", 2),
      makePoseSample(2, 0.68, "back", 2),
      makePoseSample(3, 0.7, "back", 1),
    ]);

    expect(assessment.valid).toBe(false);
    expect(assessment.multiPersonFrameCount).toBe(2);
  });

  it("allows re-filmed serve samples when the player is visible and serve motion is detected", () => {
    const assessment = assessServeVideoCandidate([
      makePoseSample(1, 0.7, "side", 2),
      makePoseSample(2, 0.25, "side", 2),
      makePoseSample(3, 0.68, "side", 1),
    ]);

    expect(assessment.valid).toBe(true);
    expect(assessment.serveMotionFrameCount).toBe(1);
  });

  it("rejects videos where the detected player is too small for posture analysis", () => {
    const assessment = assessServeVideoCandidate([
      makeSmallPoseSample(1, 0.61),
      makeSmallPoseSample(2, 0.58),
      makeSmallPoseSample(3, 0.61),
    ]);

    expect(assessment.valid).toBe(false);
    expect(assessment.usableFrameCount).toBe(3);
    expect(assessment.analysisReadyFrameCount).toBe(0);
  });
});

describe("selectPhaseSamples", () => {
  it("selects five ordered phase samples from serve pose cues", () => {
    const samples = [
      makeServePhaseSample(0.5, { leftWristY: 0.7, rightWristY: 0.72, rightElbowY: 0.6 }),
      makeServePhaseSample(1, { leftWristY: 0.22, rightWristY: 0.68, rightElbowY: 0.5 }),
      makeServePhaseSample(1.5, { leftWristY: 0.5, rightWristY: 0.58, rightElbowY: 0.46 }),
      makeServePhaseSample(2, { leftWristY: 0.34, rightWristY: 0.38, rightElbowY: 0.36, shoulderTilt: 0.12 }),
      makeServePhaseSample(3, { leftWristY: 0.45, rightWristY: 0.62, rightElbowY: 0.36 }),
      makeServePhaseSample(4, { leftWristY: 0.5, rightWristY: 0.12, rightElbowY: 0.32 }),
      makeServePhaseSample(4.5, { leftWristY: 0.5, rightWristY: 0.44, rightElbowY: 0.4 }),
      makeServePhaseSample(5, { leftWristY: 0.58, rightWristY: 0.7, rightElbowY: 0.58 }),
    ];

    const selected = selectPhaseSamples(samples);

    expect(selected.map((item) => item.phase.key)).toEqual([
      "toss",
      "trophy",
      "racketDrop",
      "impact",
      "followThrough",
    ]);
    expect(selected.map((item) => item.sample.time)).toEqual([1, 2, 3, 4, 5]);
  });

  it("reuses available samples when the sequence has fewer than five samples", () => {
    const samples = [makePoseSample(2, 0.25), makePoseSample(8, 0.25)];

    const selected = selectPhaseSamples(samples);

    expect(selected).toHaveLength(5);
    expect(selected[0].sample.time).toBe(2);
    expect(selected[4].sample.time).toBe(8);
  });
});

describe("selectAnalysisSamples", () => {
  it("selects analysis focus samples instead of fixed serve phases", () => {
    const samples = [
      makeServePhaseSample(1, { leftWristY: 0.7, rightWristY: 0.7, rightElbowY: 0.5 }),
      makeServePhaseSample(2, { leftWristY: 0.24, rightWristY: 0.68, rightElbowY: 0.5 }),
      makeServePhaseSample(3, { leftWristY: 0.48, rightWristY: 0.58, rightElbowY: 0.36, shoulderTilt: 0.14 }),
      makeServePhaseSample(4, { leftWristY: 0.5, rightWristY: 0.18, rightElbowY: 0.32 }),
      makeServePhaseSample(5, { leftWristY: 0.6, rightWristY: 0.66, rightElbowY: 0.54 }),
    ];

    const selected = selectAnalysisSamples(samples);

    expect(selected).toHaveLength(4);
    expect(selected.map((item) => item.focus.key)).toEqual([
      "tossStability",
      "bodyBalance",
      "upperRotation",
      "finishBalance",
    ]);
  });

  it("keeps sparse analysis samples distinct when possible", () => {
    const selected = selectAnalysisSamples([makePoseSample(2, 0.25), makePoseSample(8, 0.7)]);

    expect(selected).toHaveLength(4);
    expect(new Set(selected.map((item) => item.sample.time)).size).toBe(2);
  });
});

describe("phase selection debug", () => {
  it("explains why a phase sample was selected with readable metrics", () => {
    const sample = makeServePhaseSample(3, {
      leftWristY: 0.48,
      rightWristY: 0.64,
      rightElbowY: 0.36,
      shoulderTilt: 0.11,
    });

    const debug = explainPhaseSelection("racketDrop", sample);

    expect(debug.reason).toContain("라켓 드롭");
    expect(debug.metrics.racketDropPercent).toBe(28);
    expect(debug.metrics.shoulderTiltPercent).toBe(11);
    expect(debug.metrics.serveMotion).toBe(false);
  });

  it("converts wrist lift into a simple percentage metric", () => {
    const metrics = analyzePoseSampleMetrics(makePoseSample(2, 0.25));

    expect(metrics.wristLiftPercent).toBe(75);
    expect(metrics.serveMotion).toBe(true);
  });
});

function makeServePhaseSample(
  time: number,
  options: {
    leftWristY: number;
    rightWristY: number;
    rightElbowY: number;
    shoulderTilt?: number;
  },
) {
  const leftShoulderY = 0.42;
  const rightShoulderY = leftShoulderY + (options.shoulderTilt ?? 0);
  const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
  landmarks[11] = { x: 0.44, y: leftShoulderY, visibility: 0.9 };
  landmarks[12] = { x: 0.56, y: rightShoulderY, visibility: 0.9 };
  landmarks[13] = { x: 0.43, y: 0.5, visibility: 0.9 };
  landmarks[14] = { x: 0.57, y: options.rightElbowY, visibility: 0.9 };
  landmarks[15] = { x: 0.43, y: options.leftWristY, visibility: 0.9 };
  landmarks[16] = { x: 0.57, y: options.rightWristY, visibility: 0.9 };
  landmarks[23] = { x: 0.45, y: 0.62, visibility: 0.9 };
  landmarks[24] = { x: 0.55, y: 0.62, visibility: 0.9 };
  landmarks[27] = { x: 0.45, y: 0.86, visibility: 0.9 };
  landmarks[28] = { x: 0.55, y: 0.86, visibility: 0.9 };

  return { time, landmarks };
}

function makePoseSample(time: number, wristY: number, angle: "back" | "side" | "diagonal" = "back", poseCount = 1) {
  const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
  const shoulderXs = {
    back: [0.44, 0.56],
    side: [0.49, 0.53],
    diagonal: [0.46, 0.54],
  }[angle];
  const hipXs = {
    back: [0.45, 0.55],
    side: [0.49, 0.53],
    diagonal: [0.46, 0.54],
  }[angle];
  landmarks[11] = { x: shoulderXs[0], y: 0.42, visibility: 0.9 };
  landmarks[12] = { x: shoulderXs[1], y: 0.42, visibility: 0.9 };
  landmarks[15] = { x: 0.43, y: wristY, visibility: 0.9 };
  landmarks[16] = { x: 0.57, y: 0.7, visibility: 0.9 };
  landmarks[23] = { x: hipXs[0], y: 0.62, visibility: 0.9 };
  landmarks[24] = { x: hipXs[1], y: 0.62, visibility: 0.9 };
  landmarks[27] = { x: 0.45, y: 0.86, visibility: 0.9 };
  landmarks[28] = { x: 0.55, y: 0.86, visibility: 0.9 };

  return { time, landmarks, poseCount };
}

function makeSmallPoseSample(time: number, wristY: number) {
  const sample = makePoseSample(time, wristY);
  sample.landmarks[11] = { x: 0.48, y: 0.42, visibility: 0.9 };
  sample.landmarks[12] = { x: 0.54, y: 0.42, visibility: 0.9 };
  sample.landmarks[15] = { x: 0.47, y: wristY, visibility: 0.9 };
  sample.landmarks[16] = { x: 0.55, y: 0.58, visibility: 0.9 };
  sample.landmarks[23] = { x: 0.49, y: 0.52, visibility: 0.9 };
  sample.landmarks[24] = { x: 0.53, y: 0.52, visibility: 0.9 };
  sample.landmarks[27] = { x: 0.49, y: 0.63, visibility: 0.9 };
  sample.landmarks[28] = { x: 0.53, y: 0.63, visibility: 0.9 };

  return sample;
}

describe("buildCoachingSummary", () => {
  it("returns a failed result when no pose frames were detected", () => {
    const summary = buildCoachingSummary({
      angle: "back",
      duration: 20,
      poseFrameCount: 0,
      snapshots: [],
    });

    expect(summary.status).toBe("failed");
    expect(summary.message).toBe("영상 분석 실패");
  });

  it("builds a successful summary with limited representative snapshots", () => {
    const summary = buildCoachingSummary({
      angle: "side",
      duration: 28,
      poseFrameCount: 16,
      snapshots: Array.from({ length: 9 }, (_, index) => ({
        key: `snapshot-${index}`,
        name: `Snapshot ${index}`,
        cue: "cue",
        feedback: "feedback",
        image: `image-${index}`,
        time: index,
      })),
    });

    expect(summary.status).toBe("success");
    expect(summary.estimatedServeCount).toBe(3);
    expect(summary.representativeSnapshots).toHaveLength(4);
    expect(summary.topIssues[0].issue).toBe("토스 팔 유지 부족");
  });
});
