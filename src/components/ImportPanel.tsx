import { useRef, useState } from "react";
import type { AppData } from "../types";
import { applyImport, buildTemplate, importSheets, readSpreadsheet, toTemplateRows } from "../importTimetable";
import type { ImportPreview } from "../importTimetable";
import { downloadBlob, downloadText, safeFileName, toCsv } from "../export";
import { Button, Card, Field } from "./ui";

type Props = { data: AppData; set: (fn: (d: AppData) => AppData) => void };

export default function ImportPanel({ data, set }: Props) {
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const pick = async (file: File) => {
    setBusy(true);
    setError("");
    setPreview(null);
    try {
      const sheets = await readSpreadsheet(file);
      setPreview(importSheets(data, sheets));
      setFileName(file.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const apply = (mode: "replace" | "merge") => {
    if (!preview) return;
    set((d) => applyImport(d, preview, mode));
    setPreview(null);
    setFileName("");
  };

  const total = preview?.assignments.length ?? 0;
  const added = preview
    ? [
        preview.newClasses.length ? `체험반 ${preview.newClasses.length}개` : "",
        preview.newTeachers.length ? `강사 ${preview.newTeachers.length}명` : "",
        preview.newRooms.length ? `체험존 ${preview.newRooms.length}개` : "",
      ].filter(Boolean)
    : [];

  return (
    <Card
      title="엑셀로 이미 짜인 시간표 올리기"
      desc="이미 쓰고 있는 시간표를 그대로 올려 앱에서 보고 고칠 수 있습니다. 양식(목록형)과 이 앱이 내보낸 체험반별 시트 모양을 모두 읽습니다."
    >
      <div className="no-print flex flex-wrap items-end gap-3">
        <Field label="파일" hint=".xlsx 또는 .csv">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            className="text-sm"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void pick(f);
              e.target.value = "";
            }}
          />
        </Field>
        <Button
          onClick={() =>
            downloadBlob(`시간표 업로드 양식.xlsx`, buildTemplate(data))
          }
        >
          양식 받기
        </Button>
        <Button
          disabled={data.timetable.length === 0}
          title={data.timetable.length === 0 ? "아직 구성된 시간표가 없습니다" : undefined}
          onClick={() =>
            downloadText(
              `${safeFileName(data.schoolName || "시간표")} 목록.csv`,
              toCsv(toTemplateRows(data, data.timetable)),
              "text/csv;charset=utf-8",
            )
          }
        >
          지금 시간표를 양식으로 내보내기
        </Button>
        {busy && <span className="text-sm text-tt-600">읽는 중…</span>}
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          불러오기 실패: {error}
        </p>
      )}

      {preview && (
        <div className="mt-4 rounded-lg border border-tt-200 bg-tt-50 p-3">
          <p className="text-sm font-semibold text-tt-800">
            {fileName} — 읽은 칸 {total}개
            {added.length > 0 && <span className="font-normal text-tt-600"> · 새로 만들 항목: {added.join(", ")}</span>}
          </p>

          <ul className="mt-2 space-y-0.5 text-xs text-tt-600">
            {preview.sources.map((s) => (
              <li key={s.sheet}>
                시트 <b>{s.sheet}</b> — {s.format}
                {s.format !== "건너뜀" && ` ${s.count}칸`}
              </li>
            ))}
          </ul>

          {preview.warnings.length > 0 && (
            <ul className="mt-3 space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-sm text-amber-800">
              {preview.warnings.map((w, i) => (
                <li key={i}>• {w}</li>
              ))}
            </ul>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="primary" disabled={total === 0} onClick={() => apply("replace")}>
              지금 시간표를 이걸로 바꾸기
            </Button>
            <Button
              disabled={total === 0 || data.timetable.length === 0}
              onClick={() => apply("merge")}
              title="같은 반의 같은 자리는 올린 쪽으로 덮어씁니다"
            >
              기존 시간표에 합치기
            </Button>
            <Button onClick={() => setPreview(null)}>취소</Button>
          </div>
        </div>
      )}
    </Card>
  );
}
