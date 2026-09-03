import { useEffect, useMemo, useRef, useState } from "react";
import type { AppData, Lecture, SolveRequest, SolveResult, WorkerOut } from "../types";
import { blockableFlags, buildLectures, periodsOf, validate } from "../store";
import { downloadText, toCsv } from "../export";
import { Button, Card, Empty } from "./ui";
import Timetable, { hueOf } from "./Timetable";
import type { Cell, Grid } from "./Timetable";

type Props = { data: AppData };
type View = "class" | "teacher";

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
  const [view, setView] = useState<View>("class");
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
    if (!result || !solved) return { byClass, byTeacher };

    const blank = (): Grid =>
      Array.from({ length: periods.length }, () => new Array(snap.days.length).fill(null));
    for (const c of snap.classes) byClass.set(c.id, blank());
    for (const t of snap.teachers) byTeacher.set(t.id, blank());

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
      const cg = byClass.get(lec.classId);
      const tg = byTeacher.get(lec.teacherId);
      if (cg) {
        cg[unit.period][unit.day] = cls;
        for (let k = 1; k < unit.length; k++) cg[unit.period + k][unit.day] = "cont";
      }
      if (tg) {
        tg[unit.period][unit.day] = tch;
        for (let k = 1; k < unit.length; k++) tg[unit.period + k][unit.day] = "cont";
      }
    }
    return { byClass, byTeacher };
  }, [result, solved]); // eslint-disable-line react-hooks/exhaustive-deps

  const exportCsv = () => {
    if (!result || !solved) return;
    const rows: string[][] = [["학급", "요일", "교시", "과목", "교사", "특별실", "연속"]];
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
                <Button
                  variant={view === "class" ? "primary" : "ghost"}
                  onClick={() => setView("class")}
                >
                  학급별
                </Button>
                <Button
                  variant={view === "teacher" ? "primary" : "ghost"}
                  onClick={() => setView("teacher")}
                >
                  교사별
                </Button>
                <Button onClick={exportCsv}>CSV 내려받기</Button>
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

          <div className="grid gap-5 xl:grid-cols-2">
            {view === "class"
              ? snap.classes.map((c) => (
                  <Timetable
                    key={c.id}
                    title={`${snap.schoolName ? snap.schoolName + " " : ""}${c.name} 시간표`}
                    days={snap.days}
                    slots={snap.slots}
                    grid={grids.byClass.get(c.id) ?? []}
                  />
                ))
              : snap.teachers.map((t) => {
                  const g = grids.byTeacher.get(t.id) ?? [];
                  const hours = g.flat().filter((x) => x !== null).length;
                  return (
                    <Timetable
                      key={t.id}
                      title={`${t.name || "(이름없음)"} 선생님`}
                      subtitle={`주 ${hours}시간`}
                      days={snap.days}
                      slots={snap.slots}
                      grid={g}
                    />
                  );
                })}
          </div>
        </>
      )}

      {!result && !running && <Empty>[시간표 만들기]를 누르면 배치를 시작합니다.</Empty>}
    </div>
  );
}
