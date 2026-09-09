import { useEffect, useMemo, useRef, useState } from "react";
import type { AppData, Assignment, Lecture, SolveResult, WorkerOut } from "../types";
import { allowedDaysOf, buildSolveRequest, capacityForDays, validate } from "../store";
import { mergeSolved, scopeData } from "../calendar";
import { downloadBlob, downloadText, safeFileName, toCsv } from "../export";
import { buildXlsx } from "../xlsx";
import type { XSheet } from "../xlsx";
import { toSheet } from "../timetableSheet";
import { toTemplateRows } from "../importTimetable";
import {
  blockedBy,
  buildGrids,
  conflictLabel,
  conflictsOf,
  dayAllowedFor,
  fits,
  fromSolveResult,
  newAssignment,
  periodsCovered,
  removeAssignment,
  setPosition,
  sliceGrid,
  sortAssignments,
  swapPositions,
  upsert,
  usedCells,
} from "../assignments";
import ImportPanel from "./ImportPanel";
import AssignmentEditor from "./AssignmentEditor";
import { Button, Card, Empty, Field, TextInput } from "./ui";
import Timetable from "./Timetable";
import type { EditHooks, Grid } from "./Timetable";

type Props = { data: AppData; set: (fn: (d: AppData) => AppData) => void };
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

const ownerOf = (a: Assignment, axis: Axis): string | null =>
  axis === "class" ? a.classId : axis === "teacher" ? a.teacherId : a.roomId;

export default function ResultPanel({ data, set }: Props) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [solveInfo, setSolveInfo] = useState<{ result: SolveResult; lectures: Lecture[] } | null>(null);
  const [view, setView] = useState<Axis>("class");
  const [kind, setKind] = useState<Axis>("class");
  const [query, setQuery] = useState("");
  const [limitMs, setLimitMs] = useState(10000);
  const [editing, setEditing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [segId, setSegId] = useState("");
  const [solveSegmentId, setSolveSegmentId] = useState("");
  const workerRef = useRef<Worker | null>(null);
  const latestData = useRef(data);
  latestData.current = data;

  useEffect(() => () => workerRef.current?.terminate(), []);

  const solveData = useMemo(() => scopeData(data, solveSegmentId), [data, solveSegmentId]);
  const issues = useMemo(() => validate(solveData), [solveData]);
  const errors = issues.filter((i) => i.level === "error");
  const warns = issues.filter((i) => i.level === "warn");

  const className = new Map(data.classes.map((c) => [c.id, c.name || "(이름없음)"]));

  /** ── 운영 구간 필터 ─────────────────────────────── */
  const segment = data.segments.find((s) => s.id === segId) ?? null;
  const viewDays = useMemo(() => {
    const all = data.days.map((_, i) => i);
    if (!segment) return all;
    const picked = segment.days.filter((d) => d >= 0 && d < data.days.length);
    return picked;
  }, [segment, data.days]);
  const dayLabels = viewDays.map((i) => data.days[i]);
  const segSuffix = segment ? ` (${segment.name || "구간"})` : "";

  const conflicts = useMemo(() => conflictsOf(data, data.timetable), [data]);
  const badIds = useMemo(() => new Set(conflicts.flatMap((c) => c.ids)), [conflicts]);
  const grids = useMemo(() => buildGrids(data, data.timetable, badIds), [data, badIds]);

  const selected = editing ? (data.timetable.find((a) => a.id === selectedId) ?? null) : null;

  /** ── 자동 배치 ──────────────────────────────────── */
  const run = (seed: number) => {
    const ids = new Set(solveData.classes.map((c) => c.id));
    const label = data.segments.find((s) => s.id === solveSegmentId)?.name || "전체";
    if (data.timetable.some((a) => ids.has(a.classId)) && !confirm(`${label} 시간표를 새로 배치합니다. 선택한 구간 밖의 시간표는 유지됩니다. 계속할까요?`))
      return;
    workerRef.current?.terminate();
    const req = buildSolveRequest(solveData, { timeLimitMs: limitMs, seed, reserved: data.timetable.filter((a) => !ids.has(a.classId)) });
    const lectures = req.lectures;

    const worker = new Worker(new URL("../solver.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    setRunning(true);
    setProgress("배치 중…");
    setSolveInfo(null);
    setSelectedId(null);
    worker.onerror = () => {
      setRunning(false);
      setProgress("배치 중 오류가 발생했습니다. 기존 시간표는 유지됩니다.");
      worker.terminate();
      workerRef.current = null;
    };
    worker.onmessage = (e: MessageEvent<WorkerOut>) => {
      const msg = e.data;
      if (msg.type === "progress") {
        setProgress(
          `다시 시도 ${msg.restarts}회 · 남은 충돌 ${msg.bestConflicts}건 · ${(msg.elapsedMs / 1000).toFixed(1)}초`,
        );
        return;
      }
      if (latestData.current !== data) {
        alert("배치 중 입력이나 시간표가 변경되어 결과를 적용하지 않았습니다. 다시 실행하세요.");
      } else {
        setSolveInfo({ result: msg, lectures });
        const merged = mergeSolved(data, req.classIds, fromSolveResult(msg, lectures));
        const errors = conflictsOf(merged, merged.timetable);
        if (errors.length) alert(`보존한 시간표와 충돌해 적용하지 않았습니다.\n${errors.map((c) => c.text).join("\n")}`);
        else if (msg.ok || !data.timetable.some((a) => ids.has(a.classId)) || confirm("일부 수업이 미배치되었습니다. 기존 구간 시간표를 이 부분 결과로 바꿀까요?")) set(() => merged);
      }
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

  /** ── 편집 동작 ──────────────────────────────────── */
  const putTimetable = (fn: (list: Assignment[]) => Assignment[]) =>
    set((d) => ({ ...d, timetable: fn(d.timetable) }));

  const addAt = (ownerId: string, axis: Axis, day: number, period: number) => {
    const classId = axis === "class" ? ownerId : (data.classes.find((c) => dayAllowedFor(data, c.id, day))?.id ?? "");
    if (!classId) {
      alert("먼저 [체험반·체험존] 탭에서 체험반을 만드세요.");
      return;
    }
    const fixedName = blockedBy(data, day, period, 1);
    if (fixedName) {
      alert(`${fixedName} 시간이라 수업을 넣을 수 없습니다. [운영 시간] 탭에서 고정 활동을 고치세요.`);
      return;
    }
    if (!dayAllowedFor(data, classId, day)) {
      alert(`${className.get(classId) ?? "이 반"}은(는) ${data.days[day]}요일에 오지 않습니다.`);
      return;
    }
    const a = newAssignment({
      classId,
      teacherId: axis === "teacher" ? ownerId : null,
      roomId: axis === "room" ? ownerId : null,
      subject: "",
      day,
      period,
      length: 1,
    });
    putTimetable((list) => sortAssignments([...list, a]));
    setSelectedId(a.id);
  };

  const moveInto = (ownerId: string, axis: Axis, id: string, day: number, period: number) => {
    const moving = data.timetable.find((a) => a.id === id);
    if (!moving) return;
    const target = data.timetable.find(
      (a) => a.id !== id && ownerOf(a, axis) === ownerId && a.day === day && periodsCovered(a).includes(period),
    );

    if (target) {
      if (blockedBy(data, target.day, target.period, moving.length) || blockedBy(data, moving.day, moving.period, target.length) ||
          !dayAllowedFor(data, moving.classId, target.day) || !dayAllowedFor(data, target.classId, moving.day)) {
        alert("고정 활동 또는 운영 구간을 벗어나 두 수업을 맞바꿀 수 없습니다.");
        return;
      }
      if (
        !fits(data, target.day, target.period, moving.length) ||
        !fits(data, moving.day, moving.period, target.length)
      ) {
        alert("연속 2교시 자리가 맞지 않아 두 칸을 맞바꿀 수 없습니다.");
        return;
      }
      putTimetable((list) => swapPositions(list, id, target.id));
      setSelectedId(id);
      return;
    }
    if (!fits(data, day, period, moving.length)) {
      alert("연속 2교시로 붙일 수 없는 자리입니다(뒤에 점심·쉬는시간이 있거나 마지막 교시입니다).");
      return;
    }
    const fixedName = blockedBy(data, day, period, moving.length);
    if (fixedName) {
      alert(`${fixedName} 시간이라 수업을 넣을 수 없습니다.`);
      return;
    }
    if (!dayAllowedFor(data, moving.classId, day)) {
      alert(`${className.get(moving.classId) ?? "이 반"}은(는) ${data.days[day]}요일에 오지 않습니다.`);
      return;
    }
    putTimetable((list) => setPosition(list, id, day, period));
    setSelectedId(id);
  };

  /** 격자는 고른 구간의 요일만 보여 주므로, 넘어온 열 번호를 원래 요일로 되돌린다. */
  const hooksFor = (ownerId: string, axis: Axis): EditHooks | undefined =>
    editing
      ? {
          selectedId,
          onPick: setSelectedId,
          onAddAt: (di, period) => addAt(ownerId, axis, viewDays[di] ?? di, period),
          onMove: (id, di, period) => moveInto(ownerId, axis, id, viewDays[di] ?? di, period),
        }
      : undefined;

  /** ── 내려받기 ───────────────────────────────────── */
  const exportCsv = () =>
    downloadText(
      `${safeFileName(data.schoolName || "시간표")} 목록${segSuffix}.csv`,
      toCsv(toTemplateRows(data, visibleAssignments())),
      "text/csv;charset=utf-8",
    );

  /** 구간을 골랐으면 그 요일에 걸린 칸만 */
  function visibleAssignments(): Assignment[] {
    if (!segment) return data.timetable;
    const set0 = new Set(viewDays);
    return data.timetable.filter((a) => set0.has(a.day));
  }

  const classesInSegment = segment
    ? data.classes.filter((c) => {
        const allowed = new Set(allowedDaysOf(data, c));
        return viewDays.some((d) => allowed.has(d));
      })
    : data.classes;

  const targets: Target[] = (
    kind === "class" ? classesInSegment : kind === "teacher" ? data.teachers : data.rooms
  ).map((x) => ({ id: x.id, name: x.name || "(이름없음)" }));

  const kindLabel = AXIS_LABEL[kind];
  const q = query.trim().toLowerCase();
  const hits = q ? targets.filter((t) => t.name.toLowerCase().includes(q)) : [];
  const exact = q ? targets.find((t) => t.name.toLowerCase() === q) : undefined;
  const match = exact ?? (hits.length === 1 ? hits[0] : null);

  const gridOf = (id: string, axis: Axis): Grid => {
    const full =
      (axis === "class" ? grids.byClass : axis === "teacher" ? grids.byTeacher : grids.byRoom).get(id) ?? [];
    return segment ? sliceGrid(full, viewDays) : full;
  };

  const head = data.schoolName ? data.schoolName + " " : "";
  const titleOf = (name: string) =>
    `${head}${kind === "teacher" ? `${name} 강사` : name} 시간표${segSuffix}`;

  const sheetOf = (t: Target, sheetName: string): XSheet =>
    toSheet({
      sheetName,
      title: titleOf(t.name),
      days: dayLabels,
      slots: data.slots,
      daySlots: data.daySlots,
      grid: gridOf(t.id, kind),
    });

  const downloadOne = () => {
    if (!match) return;
    const label = kind === "teacher" ? `${match.name} 강사` : match.name;
    downloadBlob(`${safeFileName(label)} 시간표${segSuffix}.xlsx`, buildXlsx([sheetOf(match, match.name)]));
  };

  const downloadAll = () => {
    if (targets.length === 0) return;
    const names = dedupe(targets.map((t) => t.name));
    downloadBlob(
      `${safeFileName(data.schoolName || "시간표")} ${kindLabel}별 시간표${segSuffix}.xlsx`,
      buildXlsx(targets.map((t, i) => sheetOf(t, names[i]))),
    );
  };

  const hasTimetable = data.timetable.length > 0;
  const viewTargets = view === "class" ? classesInSegment : view === "teacher" ? data.teachers : data.rooms;

  return (
    <div className="flex flex-col gap-5">
      <Card
        title="시간표 배치"
        desc="모든 계산은 브라우저 안에서 일어납니다. 서버로 보내는 데이터는 없습니다."
      >
        <div className="no-print flex flex-wrap items-center gap-3">
          <select aria-label="자동 생성할 구간" value={solveSegmentId} disabled={running}
            onChange={(e) => setSolveSegmentId(e.target.value)} className="rounded-lg border border-tt-300 bg-white px-2.5 py-1.5 text-sm">
            <option value="">전체 구간</option>
            {data.segments.map((s) => <option key={s.id} value={s.id}>{s.name || "이름 없는 구간"}만 생성</option>)}
          </select>
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
            {running ? "배치 중…" : "자동으로 시간표 만들기"}
          </Button>
          {hasTimetable && !running && (
            <Button onClick={() => run(Math.floor(Math.random() * 100000))}>다른 안으로 다시 배치</Button>
          )}
          {!hasTimetable && !running && (
            <Button
              variant={editing ? "primary" : "ghost"}
              onClick={() => {
                setEditing((v) => !v);
                setView("class");
              }}
            >
              {editing ? "직접 입력 끝내기" : "빈 시간표에 직접 입력"}
            </Button>
          )}
          {running && (
            <Button variant="danger" onClick={stop}>
              중지
            </Button>
          )}
          {progress && <span className="text-sm text-tt-600">{progress}</span>}
        </div>

        {data.segments.length > 0 && (
          <p className="mt-3 text-sm text-tt-600">
            구간을 선택하면 그 구간의 반만 새로 배치하고 나머지 시간표는 유지합니다.
            보존한 시간표의 강사·체험존 사용 시간도 피하며, 결과는 자동으로 통합됩니다.
          </p>
        )}

        {errors.length > 0 && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <p className="mb-1 font-semibold">
              자동 배치를 하려면 먼저 고쳐야 합니다 (엑셀 올리기·직접 입력에는 상관없습니다)
            </p>
            <ul className="space-y-1">
              {errors.map((i, n) => (
                <li key={n}>• {i.text}</li>
              ))}
            </ul>
          </div>
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

      <ImportPanel data={data} set={set} />

      {hasTimetable && (
        <>
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                {solveInfo && (
                  <p
                    className={`text-sm font-semibold ${solveInfo.result.ok ? "text-emerald-700" : "text-amber-700"}`}
                  >
                    {solveInfo.result.ok ? "✔ " : "⚠ "}
                    {solveInfo.result.message}
                    <span className="ml-2 font-normal text-tt-500">
                      {(solveInfo.result.elapsedMs / 1000).toFixed(1)}초 · 다시 시도 {solveInfo.result.restarts}회
                    </span>
                  </p>
                )}
                <p className="text-sm text-tt-600">배치된 칸 {data.timetable.length}개</p>
              </div>

              <div className="no-print flex flex-wrap gap-2">
                {(["class", "teacher", "room"] as const).map((a) => (
                  <Button
                    key={a}
                    variant={view === a ? "primary" : "ghost"}
                    disabled={a === "room" && data.rooms.length === 0}
                    title={a === "room" && data.rooms.length === 0 ? "지정된 체험존이 없습니다" : undefined}
                    onClick={() => {
                      setView(a);
                      setKind(a);
                      setQuery("");
                    }}
                  >
                    {AXIS_LABEL[a]}별
                  </Button>
                ))}
                <Button variant={editing ? "primary" : "ghost"} onClick={() => setEditing((v) => !v)}>
                  {editing ? "편집 끝내기" : "시간표 수정"}
                </Button>
                <Button onClick={() => window.print()}>인쇄 / PDF</Button>
              </div>
            </div>

            {data.segments.length > 0 && (
              <div className="no-print mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-tt-200 bg-tt-50 p-3">
                <span className="text-xs font-semibold text-tt-700">보이는 구간</span>
                <Button variant={segId === "" ? "primary" : "ghost"} onClick={() => setSegId("")}>
                  전체 ({data.days.join("")})
                </Button>
                {data.segments.map((s) => (
                  <Button
                    key={s.id}
                    variant={segId === s.id ? "primary" : "ghost"}
                    onClick={() => setSegId(s.id)}
                  >
                    {s.name || "(이름없음)"}
                  </Button>
                ))}
              </div>
            )}

            {editing && (
              <p className="mt-3 rounded-lg border border-tt-300 bg-tt-50 p-3 text-sm text-tt-700">
                칸을 눌러 내용을 고치고, 끌어다 놓아 자리를 옮깁니다. 이미 찬 자리에 놓으면 두 칸이 맞바뀝니다.
                빈 칸의 <b>+</b> 를 누르면 새 칸이 생깁니다. 노란 칸(고정 활동)은 옮길 수 없습니다.
              </p>
            )}

            {conflicts.length > 0 && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm">
                <p className="mb-2 font-semibold text-red-700">
                  겹치는 곳 {conflicts.length}건 — 표에서 빨갛게 표시됩니다
                  <span className="font-normal"> · 항목을 누르면 그 칸을 바로 고칠 수 있습니다</span>
                </p>
                <ul className="space-y-1 text-red-700">
                  {conflicts.slice(0, 10).map((c, i) => (
                    <li key={i}>
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(true);
                          setSelectedId(c.ids[c.ids.length - 1]);
                        }}
                        className="text-left underline-offset-2 hover:underline"
                      >
                        <b>[{conflictLabel(c.kind)}]</b> {c.text}
                      </button>
                    </li>
                  ))}
                  {conflicts.length > 10 && <li className="text-red-500">…외 {conflicts.length - 10}건</li>}
                </ul>
              </div>
            )}

            {solveInfo && solveInfo.result.shortfalls.length > 0 && (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
                <p className="mb-2 font-semibold text-amber-800">자동 배치가 넣지 못한 시수</p>
                <ul className="space-y-1 text-amber-800">
                  {solveInfo.result.shortfalls.map((s) => {
                    const lec = solveInfo.lectures[s.lectureIndex];
                    if (!lec) return null;
                    return (
                      <li key={s.lectureIndex}>
                        <b>
                          {className.get(lec.classId)} {lec.subject}
                        </b>{" "}
                        {s.missingHours}시간 — {s.reasons.map((r) => `${r.label} ${r.count}칸`).join(", ")}
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-2 text-amber-700">
                  [시간표 수정]을 켜고 빈 칸의 <b>+</b> 로 직접 넣을 수 있습니다.
                </p>
              </div>
            )}
          </Card>

          {selected && (
            <AssignmentEditor
              data={data}
              value={selected}
              onChange={(next) => {
                if (blockedBy(data, next.day, next.period, next.length) || !dayAllowedFor(data, next.classId, next.day)) {
                  alert("고정 활동 또는 운영 구간 밖에는 수업을 넣을 수 없습니다.");
                  return;
                }
                putTimetable((list) => sortAssignments(upsert(list, next)));
              }}
              onDelete={() => {
                putTimetable((list) => removeAssignment(list, selected.id));
                setSelectedId(null);
              }}
              onClose={() => setSelectedId(null)}
            />
          )}

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
                      disabled={k === "room" && data.rooms.length === 0}
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
                <Field label={`${kindLabel} 이름`} hint="일부만 입력해도 됩니다">
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
              <Button onClick={downloadAll}>전체 {kindLabel} 한 파일로</Button>
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
        </>
      )}

      {(hasTimetable || editing) && (
        <div className="grid gap-5 xl:grid-cols-2">
          {viewTargets.map((x) => {
            const g = gridOf(x.id, view);
            const used = usedCells(g);
            const name = x.name || "(이름없음)";
            const capacity = capacityForDays(data, viewDays, view === "class" ? x.id : undefined);
            return (
              <Timetable
                key={x.id}
                title={`${view === "teacher" ? `${name} 강사` : `${head}${name}`}${segSuffix}`}
                subtitle={
                  view === "class"
                    ? `주 ${used}시간 · 빈 칸 ${Math.max(0, capacity - used)}`
                    : view === "teacher"
                      ? `주 ${used}시간`
                      : `사용 ${used}/${capacity}칸 (${capacity ? Math.round((used / capacity) * 100) : 0}%)`
                }
                days={dayLabels}
                slots={data.slots}
                daySlots={data.daySlots}
                grid={g}
                edit={hooksFor(x.id, view)}
              />
            );
          })}
        </div>
      )}

      {!hasTimetable && !editing && !running && (
        <Empty>
          [자동으로 시간표 만들기]로 새로 짜거나, 위에서 이미 쓰고 있는 엑셀을 올리거나, [빈 시간표에 직접
          입력]으로 손수 채울 수 있습니다.
        </Empty>
      )}
    </div>
  );
}
