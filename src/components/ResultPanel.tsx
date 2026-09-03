import { useEffect, useMemo, useRef, useState } from "react";
import type { AppData, Lecture, SolveRequest, SolveResult, WorkerOut } from "../types";
import { blockableFlags, buildLectures, periodsOf, validate } from "../store";
import { downloadBlob, downloadText, safeFileName, toCsv } from "../export";
import { buildXlsx } from "../xlsx";
import type { XSheet } from "../xlsx";
import { toSheet } from "../timetableSheet";
import { Button, Card, Empty, Field, TextInput } from "./ui";
import Timetable, { hueOf } from "./Timetable";
import type { Cell, Grid } from "./Timetable";

type Props = { data: AppData };
type Axis = "class" | "teacher" | "room";

const AXIS_LABEL: Record<Axis, string> = { class: "체험반", teacher: "강사", room: "체험존" };
type Target = { id: string; name: string };

/** 받침 유무에 따라 조사를 고른다. 한글이 아니면 둘 다 적는다. */
function josa(word: string, withJong: string, without: string): string {
  const last = word.trim().slice(-1);
  const code = last.charCodeAt(0);
  if (!(code >= 0xac00 && code <= 0xd7a3)) return `${withJong}(${without})`;
  return (code - 0xac00) % 28 !== 0 ? withJong : without;
}

/** 엑셀은 통합문서 안에서 시트 이름이 겹치면 안 된다. */
function dedupe(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((raw) => {
    const n = seen.get(raw) ?? 0;
    seen.set(raw, n + 1);
    return n === 0 ? raw : `${raw} (${n + 1})`;
  });
}

const TIME_LIMITS = [
  { label: "빠르게 (3초)", ms: 3000 },
  { label: "보통 (10초)", ms: 10000 },
  { label: "오래 (30초)", ms: 30000 },
];

export default function ResultPanel({ data }: Props) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [result, setResult] = useState<SolveResult | null>(null);
  const [solved, setSolved] = useState<{ lectures: Lecture[]; data: AppData } | null>(null);
  const [view, setView] = useState<Axis>("class");
  const [kind, setKind] = useState<Axis>("class");
  const [query, setQuery] = useState("");
  const [limitMs, setLimitMs] = useState(10000);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => () => workerRef.current?.terminate(), []);

  const issues = useMemo(() => validate(data), [data]);
  const errors = issues.filter((i) => i.level === "error");
  const warns = issues.filter((i) => i.level === "warn");

  const run = (seed: number) => {
    workerRef.current?.terminate();
    const periods = periodsOf(data.slots);
    const P = periods.length;
    const lectures = buildLectures(data);
    const req: SolveRequest = {
      dayCount: data.days.length,
      periodCount: P,
      blockable: blockableFlags(data.slots),
      lectures,
      teacherIds: data.teachers.map((t) => t.id),
      classIds: data.classes.map((c) => c.id),
      roomIds: data.rooms.map((r) => r.id),
      teacherBlocked: data.teachers.map((t) => {
        const arr = new Array<boolean>(data.days.length * P).fill(false);
        for (const key of t.unavailable) {
          const [d, p] = key.split(":").map(Number);
          if (d < data.days.length && p < P) arr[d * P + p] = true;
        }
        return arr;
      }),
      timeLimitMs: limitMs,
      seed,
    };

    const worker = new Worker(new URL("../solver.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    setRunning(true);
    setProgress("배치 중…");
    setResult(null);
    worker.onmessage = (e: MessageEvent<WorkerOut>) => {
      const msg = e.data;
      if (msg.type === "progress") {
        setProgress(
          `다시 시도 ${msg.restarts}회 · 남은 충돌 ${msg.bestConflicts}건 · ${(msg.elapsedMs / 1000).toFixed(1)}초`,
        );
        return;
      }
      setResult(msg);
      setSolved({ lectures, data });
      setRunning(false);
      setProgress("");
      worker.terminate();
      workerRef.current = null;
    };
    worker.postMessage(req);
  };

  const stop = () => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setRunning(false);
    setProgress("");
  };

  const snap = solved?.data ?? data;
  const lectures = solved?.lectures ?? [];
  const periods = periodsOf(snap.slots);
  const teacherName = new Map(snap.teachers.map((t) => [t.id, t.name || "(이름없음)"]));
  const className = new Map(snap.classes.map((c) => [c.id, c.name || "(이름없음)"]));
  const roomName = new Map(snap.rooms.map((r) => [r.id, r.name]));

  const grids = useMemo(() => {
    const byClass = new Map<string, Grid>();
    const byTeacher = new Map<string, Grid>();
    const byRoom = new Map<string, Grid>();
    if (!result || !solved) return { byClass, byTeacher, byRoom };

    const blank = (): Grid =>
      Array.from({ length: periods.length }, () => new Array(snap.days.length).fill(null));
    for (const c of snap.classes) byClass.set(c.id, blank());
    for (const t of snap.teachers) byTeacher.set(t.id, blank());
    for (const r of snap.rooms) byRoom.set(r.id, blank());

    for (const unit of result.placed) {
      const lec = solved.lectures[unit.lectureIndex];
      if (!lec) continue;
      const room = lec.roomId ? roomName.get(lec.roomId) : undefined;
      const hue = hueOf(lec.subject);

      const cls: Cell = {
        top: lec.subject,
        bottom: [teacherName.get(lec.teacherId), room].filter(Boolean).join(" · "),
        span: unit.length,
        hue,
      };
      const tch: Cell = {
        top: className.get(lec.classId) ?? "",
        bottom: [lec.subject, room].filter(Boolean).join(" · "),
        span: unit.length,
        hue,
      };
      const zone: Cell = {
        top: className.get(lec.classId) ?? "",
        bottom: [lec.subject, teacherName.get(lec.teacherId)].filter(Boolean).join(" · "),
        span: unit.length,
        hue,
      };
      const cg = byClass.get(lec.classId);
      const tg = byTeacher.get(lec.teacherId);
      const rg = lec.roomId ? byRoom.get(lec.roomId) : undefined;
      if (cg) {
        cg[unit.period][unit.day] = cls;
        for (let k = 1; k < unit.length; k++) cg[unit.period + k][unit.day] = "cont";
      }
      if (tg) {
        tg[unit.period][unit.day] = tch;
        for (let k = 1; k < unit.length; k++) tg[unit.period + k][unit.day] = "cont";
      }
      if (rg) {
        rg[unit.period][unit.day] = zone;
        for (let k = 1; k < unit.length; k++) rg[unit.period + k][unit.day] = "cont";
      }
    }
    return { byClass, byTeacher, byRoom };
  }, [result, solved]); // eslint-disable-line react-hooks/exhaustive-deps

  const exportCsv = () => {
    if (!result || !solved) return;
    const rows: string[][] = [["체험반", "요일", "교시", "프로그램", "강사", "체험존", "연속"]];
    const sorted = [...result.placed].sort(
      (a, b) => a.day - b.day || a.period - b.period || a.lectureIndex - b.lectureIndex,
    );
    for (const u of sorted) {
      const lec = solved.lectures[u.lectureIndex];
      for (let k = 0; k < u.length; k++) {
        rows.push([
          className.get(lec.classId) ?? "",
          snap.days[u.day] ?? "",
          periods[u.period + k]?.label ?? "",
          lec.subject,
          teacherName.get(lec.teacherId) ?? "",
          lec.roomId ? (roomName.get(lec.roomId) ?? "") : "",
          u.length === 2 ? "블록" : "",
        ]);
      }
    }
    downloadText("시간표.csv", toCsv(rows), "text/csv;charset=utf-8");
  };

  // ── 엑셀 내려받기 ─────────────────────────────────────
  const targets: Target[] = (
    kind === "class" ? snap.classes : kind === "teacher" ? snap.teachers : snap.rooms
  ).map((x) => ({ id: x.id, name: x.name || "(이름없음)" }));

  const kindLabel = AXIS_LABEL[kind];
  const q = query.trim().toLowerCase();
  const hits = q ? targets.filter((t) => t.name.toLowerCase().includes(q)) : [];
  const exact = q ? targets.find((t) => t.name.toLowerCase() === q) : undefined;
  const match = exact ?? (hits.length === 1 ? hits[0] : null);

  const gridOf = (id: string): Grid =>
    (kind === "class" ? grids.byClass : kind === "teacher" ? grids.byTeacher : grids.byRoom).get(id) ??
    [];

  const head = snap.schoolName ? snap.schoolName + " " : "";
  const titleOf = (name: string) =>
    kind === "teacher" ? `${head}${name} 강사 시간표` : `${head}${name} 시간표`;

  const sheetOf = (t: Target, sheetName: string): XSheet =>
    toSheet({
      sheetName,
      title: titleOf(t.name),
      days: snap.days,
      slots: snap.slots,
      grid: gridOf(t.id),
    });

  const downloadOne = () => {
    if (!match) return;
    const label = kind === "teacher" ? `${match.name} 강사` : match.name;
    downloadBlob(`${safeFileName(label)} 시간표.xlsx`, buildXlsx([sheetOf(match, match.name)]));
  };

  const downloadAll = () => {
    if (targets.length === 0) return;
    const names = dedupe(targets.map((t) => t.name));
    const sheets = targets.map((t, i) => sheetOf(t, names[i]));
    const label = `${kindLabel}별`;
    downloadBlob(`${safeFileName(snap.schoolName || "시간표")} ${label} 시간표.xlsx`, buildXlsx(sheets));
  };

  return (
    <div className="flex flex-col gap-5">
      <Card
        title="시간표 배치"
        desc="모든 계산은 브라우저 안에서 일어납니다. 서버로 보내는 데이터는 없습니다."
      >
        <div className="no-print flex flex-wrap items-center gap-3">
          <select
            value={limitMs}
            onChange={(e) => setLimitMs(Number(e.target.value))}
            disabled={running}
            className="rounded-lg border border-tt-300 bg-white px-2.5 py-1.5 text-sm"
          >
            {TIME_LIMITS.map((t) => (
              <option key={t.ms} value={t.ms}>
                {t.label}
              </option>
            ))}
          </select>
          <Button variant="primary" disabled={running || errors.length > 0} onClick={() => run(Date.now() % 100000)}>
            {running ? "배치 중…" : "시간표 만들기"}
          </Button>
          {result && !running && (
            <Button onClick={() => run(Math.floor(Math.random() * 100000))}>다른 안으로 다시 배치</Button>
          )}
          {running && <Button variant="danger" onClick={stop}>중지</Button>}
          {progress && <span className="text-sm text-tt-600">{progress}</span>}
        </div>

        {errors.length > 0 && (
          <ul className="mt-4 space-y-1 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {errors.map((i, n) => (
              <li key={n}>• {i.text}</li>
            ))}
          </ul>
        )}
        {warns.length > 0 && (
          <ul className="mt-3 space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            {warns.slice(0, 8).map((i, n) => (
              <li key={n}>• {i.text}</li>
            ))}
            {warns.length > 8 && <li className="text-amber-600">…외 {warns.length - 8}건</li>}
          </ul>
        )}
      </Card>

      {result && solved && (
        <>
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p
                className={`text-sm font-semibold ${result.ok ? "text-emerald-700" : "text-amber-700"}`}
              >
                {result.ok ? "✔ " : "⚠ "}
                {result.message}
                <span className="ml-2 font-normal text-tt-500">
                  {(result.elapsedMs / 1000).toFixed(1)}초 · 다시 시도 {result.restarts}회
                </span>
              </p>
              <div className="no-print flex flex-wrap gap-2">
                {(["class", "teacher", "room"] as const).map((a) => (
                  <Button
                    key={a}
                    variant={view === a ? "primary" : "ghost"}
                    disabled={a === "room" && snap.rooms.length === 0}
                    title={
                      a === "room" && snap.rooms.length === 0 ? "지정된 체험존이 없습니다" : undefined
                    }
                    onClick={() => {
                      setView(a);
                      setKind(a);
                      setQuery("");
                    }}
                  >
                    {AXIS_LABEL[a]}별
                  </Button>
                ))}
                <Button onClick={() => window.print()}>인쇄 / PDF</Button>
              </div>
            </div>

            {result.shortfalls.length > 0 && (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
                <p className="mb-2 font-semibold text-amber-800">배치하지 못한 시수</p>
                <ul className="space-y-1 text-amber-800">
                  {result.shortfalls.map((s) => {
                    const lec = lectures[s.lectureIndex];
                    return (
                      <li key={s.lectureIndex}>
                        <b>
                          {className.get(lec.classId)} {lec.subject}
                        </b>{" "}
                        {s.missingHours}시간 —{" "}
                        {s.reasons.map((r) => `${r.label} ${r.count}칸`).join(", ")}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </Card>

          <Card
            title="엑셀로 내려받기"
            desc="체험반·강사·체험존 중 하나를 고르고 이름을 넣으면 그 한 장만 받습니다. 연속 2교시 병합과 점심시간까지 표 모양 그대로 들어갑니다."
          >
            <div className="no-print flex flex-wrap items-end gap-3">
              <Field label="구분">
                <div className="flex gap-1.5 pt-0.5">
                  {(["class", "teacher", "room"] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      disabled={k === "room" && snap.rooms.length === 0}
                      onClick={() => {
                        setKind(k);
                        setQuery("");
                      }}
                      className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition disabled:opacity-40 ${
                        kind === k
                          ? "border-tt-600 bg-tt-600 text-white"
                          : "border-tt-300 bg-white text-tt-600 hover:bg-tt-50"
                      }`}
                    >
                      {AXIS_LABEL[k]}
                    </button>
                  ))}
                </div>
              </Field>

              <div className="w-60">
                <Field
                  label={`${kindLabel} 이름`}
                  hint="일부만 입력해도 됩니다"
                >
                  <TextInput
                    list="tt-download-targets"
                    value={query}
                    placeholder={targets[0] ? `예) ${targets[0].name}` : ""}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && match) downloadOne();
                    }}
                  />
                  <datalist id="tt-download-targets">
                    {targets.map((t) => (
                      <option key={t.id} value={t.name} />
                    ))}
                  </datalist>
                </Field>
              </div>

              <Button variant="primary" disabled={!match} onClick={downloadOne}>
                {match ? `${match.name} 시간표 받기` : "엑셀(.xlsx) 받기"}
              </Button>
              <Button onClick={downloadAll}>
                전체 {kindLabel} 한 파일로
              </Button>
              <Button onClick={exportCsv}>전체 목록 CSV</Button>
            </div>

            {q && !match && (
              <p className="mt-3 text-sm text-amber-700">
                {hits.length === 0
                  ? `'${query.trim()}'${josa(query, "과", "와")} 일치하는 ${kindLabel}${josa(kindLabel, "이", "가")} 없습니다.`
                  : `${hits.length}개가 일치합니다 — ${hits
                      .slice(0, 6)
                      .map((h) => h.name)
                      .join(", ")}${hits.length > 6 ? " …" : ""}. 더 정확히 입력하세요.`}
              </p>
            )}
          </Card>

          <div className="grid gap-5 xl:grid-cols-2">
            {(view === "class" ? snap.classes : view === "teacher" ? snap.teachers : snap.rooms).map(
              (x) => {
                const g =
                  (view === "class"
                    ? grids.byClass
                    : view === "teacher"
                      ? grids.byTeacher
                      : grids.byRoom
                  ).get(x.id) ?? [];
                const used = g.flat().filter((cell) => cell !== null).length;
                const name = x.name || "(이름없음)";
                const capacity = periods.length * snap.days.length;
                return (
                  <Timetable
                    key={x.id}
                    title={
                      view === "teacher"
                        ? `${name} 강사`
                        : `${snap.schoolName ? snap.schoolName + " " : ""}${name}`
                    }
                    subtitle={
                      view === "class"
                        ? `주 ${used}시간 · 빈 칸 ${capacity - used}`
                        : view === "teacher"
                          ? `주 ${used}시간`
                          : `사용 ${used}/${capacity}칸 (${Math.round((used / capacity) * 100)}%)`
                    }
                    days={snap.days}
                    slots={snap.slots}
                    grid={g}
                  />
                );
              },
            )}
          </div>
        </>
      )}

      {!result && !running && <Empty>[시간표 만들기]를 누르면 배치를 시작합니다.</Empty>}
    </div>
  );
}
