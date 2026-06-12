import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import ffmpegPath from "ffmpeg-static";
import ffprobe from "ffprobe-static";

const sampleDir = "sample";
const outputDir = "sample-inspection";

if (!existsSync(outputDir)) {
  mkdirSync(outputDir, { recursive: true });
}

const videos = readdirSync(sampleDir)
  .filter((name) => [".mp4", ".mov", ".m4v", ".webm"].includes(extname(name).toLowerCase()))
  .map((name) => join(sampleDir, name));

const rows = [];

for (const video of videos) {
  const metadata = JSON.parse(
    execFileSync(
      ffprobe.path,
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height,r_frame_rate,duration",
        "-of",
        "json",
        video,
      ],
      { encoding: "utf8" },
    ),
  );

  const stream = metadata.streams?.[0] ?? {};
  const duration = Number(stream.duration || 0);
  const stem = basename(video, extname(video));
  const frameDir = join(outputDir, stem);

  if (!existsSync(frameDir)) {
    mkdirSync(frameDir, { recursive: true });
  }

  const timestamps = [
    Math.max(duration * 0.22, 0.1),
    Math.max(duration * 0.5, 0.1),
    Math.max(duration * 0.78, 0.1),
  ];

  timestamps.forEach((time, index) => {
    execFileSync(ffmpegPath, [
      "-y",
      "-ss",
      String(time),
      "-i",
      video,
      "-frames:v",
      "1",
      "-q:v",
      "2",
      join(frameDir, `frame-${index + 1}.jpg`),
    ]);
  });

  rows.push({
    file: basename(video),
    duration: Number(duration.toFixed(2)),
    width: stream.width,
    height: stream.height,
    fps: stream.r_frame_rate,
    frames: timestamps.map((time, index) => ({
      time: Number(time.toFixed(2)),
      path: join(frameDir, `frame-${index + 1}.jpg`),
    })),
  });
}

writeFileSync(join(outputDir, "summary.json"), JSON.stringify(rows, null, 2), "utf8");
console.log(JSON.stringify(rows, null, 2));
