import { put } from "@vercel/blob";
import { neon } from "@neondatabase/serverless";
import type { AiServeReport } from "./ai-serve-report";
import type { SavedServeAnalysis, SavedServeReport } from "./saved-reports";

type ReportRow = {
  id: number;
  created_at: string;
  serve_type: string | null;
  serve_type_label: string | null;
  analyses: SavedServeAnalysis[];
  ai_report: AiServeReport | null;
};

type SaveReportInput = {
  serveType?: string;
  serveTypeLabel?: string;
  analyses: SavedServeAnalysis[];
  aiReport: AiServeReport | null;
};

let schemaReady = false;

function getSql() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured");
  }

  return neon(databaseUrl);
}

async function ensureSchema() {
  if (schemaReady) {
    return;
  }

  const sql = getSql();

  await sql`
    CREATE TABLE IF NOT EXISTS serve_reports (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      serve_type TEXT,
      serve_type_label TEXT,
      analyses JSONB NOT NULL,
      ai_report JSONB
    )
  `;

  schemaReady = true;
}

export async function saveReportToStore(input: SaveReportInput): Promise<SavedServeReport> {
  await ensureSchema();

  const sql = getSql();
  const analyses = await uploadAnalysisImages(input.analyses);
  const rows = (await sql`
    INSERT INTO serve_reports (serve_type, serve_type_label, analyses, ai_report)
    VALUES (
      ${input.serveType ?? null},
      ${input.serveTypeLabel ?? null},
      ${JSON.stringify(analyses)}::jsonb,
      ${input.aiReport ? JSON.stringify(input.aiReport) : null}::jsonb
    )
    RETURNING id, created_at, serve_type, serve_type_label, analyses, ai_report
  `) as ReportRow[];

  return rowToReport(rows[0]);
}

export async function getReportFromStore(id: string): Promise<SavedServeReport | null> {
  await ensureSchema();

  const numericId = Number(id);

  if (!Number.isInteger(numericId) || numericId <= 0) {
    return null;
  }

  const sql = getSql();
  const rows = (await sql`
    SELECT id, created_at, serve_type, serve_type_label, analyses, ai_report
    FROM serve_reports
    WHERE id = ${numericId}
    LIMIT 1
  `) as ReportRow[];

  return rows[0] ? rowToReport(rows[0]) : null;
}

export async function listReportsFromStore(): Promise<SavedServeReport[]> {
  await ensureSchema();

  const sql = getSql();
  const rows = (await sql`
    SELECT id, created_at, serve_type, serve_type_label, analyses, ai_report
    FROM serve_reports
    ORDER BY created_at DESC
    LIMIT 100
  `) as ReportRow[];

  return rows.map(rowToReport);
}

async function uploadAnalysisImages(analyses: SavedServeAnalysis[]) {
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;

  if (!blobToken) {
    throw new Error("BLOB_READ_WRITE_TOKEN is not configured");
  }

  const reportKey = crypto.randomUUID();

  return Promise.all(
    analyses.map(async (analysis, analysisIndex) => ({
      ...analysis,
      snapshots: await Promise.all(
        analysis.snapshots.map(async (snapshot, snapshotIndex) => {
          const image = await uploadDataUrl(snapshot.image, `reports/${reportKey}/a${analysisIndex}-s${snapshotIndex}.jpg`);
          const frames = snapshot.frames?.length
            ? await Promise.all(
                snapshot.frames.map(async (frame, frameIndex) => ({
                  ...frame,
                  image: await uploadDataUrl(
                    frame.image,
                    `reports/${reportKey}/a${analysisIndex}-s${snapshotIndex}-f${frameIndex}.jpg`,
                  ),
                })),
              )
            : snapshot.frames;

          return {
            ...snapshot,
            image,
            frames,
          };
        }),
      ),
    })),
  );
}

async function uploadDataUrl(value: string, pathname: string) {
  if (!value.startsWith("data:")) {
    return value;
  }

  const commaIndex = value.indexOf(",");

  if (commaIndex < 0) {
    return value;
  }

  const header = value.slice(0, commaIndex);
  const base64 = value.slice(commaIndex + 1);
  const contentType = header.match(/^data:([^;]+)/)?.[1] ?? "image/jpeg";
  const buffer = Buffer.from(base64, "base64");
  const blob = await put(pathname, buffer, {
    access: "public",
    contentType,
    allowOverwrite: true,
  });

  return blob.url;
}

function rowToReport(row: ReportRow): SavedServeReport {
  return {
    id: String(row.id),
    createdAt: row.created_at,
    serveType: row.serve_type ?? undefined,
    serveTypeLabel: row.serve_type_label ?? undefined,
    analyses: row.analyses,
    aiReport: row.ai_report,
  };
}
