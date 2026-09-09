import { useState } from "react";
import type { AppData, RotationGroup } from "../types";
import {
  canRotate,
  cycleLength,
  formatTurnDate,
  newGroup,
  applyRotation,
  previewRotation,
  previewUndo,
  undoRotation,
  rotationPlan,
} from "../rotation";
import { buildGrids } from "../assignments";
import { toSheet } from "../timetableSheet";
import { buildXlsx } from "../xlsx";
import type { XSheet } from "../xlsx";
import { downloadBlob, safeFileName } from "../export";
import { Button, Card, Empty, Field, Select, TextInput } from "./ui";

type Props = { data: AppData; set: (fn: (d: AppData) => AppData) => void };

export default function RotationPanel({ data, set }: Props) {
  const [note, setNote] = useState("");
  const { groups, turns, log } = data.rotation;
  const teacherName = new Map(data.teachers.map((t) => [t.id, t.name || "(이름없음)"]));

  const setRotation = (fn: (r: AppData["rotation"]) => AppData["rotation"]) =>
    set((d) => ({ ...d, rotation: fn(d.rotation) }));

  const patchGroup = (id: string, fn: (g: RotationGroup) => RotationGroup) =>
    setRotation((r) => ({ ...r, groups: r.groups.map((g) => (g.id === id ? fn(g) : g)) }));

  const move = (g: RotationGroup, index: number, delta: number): RotationGroup => {
    const next = [...g.teacherIds];
    const to = index + delta;
    if (to < 0 || to >= next.length) return g;
    [next[index], next[to]] = [next[to], next[index]];
    return { ...g, teacherIds: next };
  };

  const cycle = cycleLength(groups);
  const ready = canRotate(data.rotation);
  const hasTimetable = data.timetable.length > 0;
  const preview = previewRotation(data);
  const undoPreview = previewUndo(data);
  const unusedTeachers = data.teachers.filter((t) => !groups.some((g) => g.teacherIds.includes(t.id)));

  /** 실제로 한 칸 돌린다 — 시간표의 강사가 그 자리에서 바뀌고 기록이 남는다. */
  const rotateNow = () => {
    if (!ready || !hasTimetable || preview.errors.length) return;
    const label = note.trim() || "직접 돌림";
    if (!confirm(`지금 시간표의 담당 강사를 한 칸 밉니다.\n(${label})\n계속할까요?`)) return;
    try { const next = applyRotation(data, label); set(() => next); }
    catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    setNote("");
  };

  const undoLast = () => {
    if (turns <= 0 || undoPreview.errors.length) return;
    if (!confirm("마지막으로 돌린 것을 되돌립니다. 계속할까요?")) return;
    try { const next = undoRotation(data); set(() => next); }
    catch (e) { alert(e instanceof Error ? e.message : String(e)); }
  };

  /** 앞으로 N번치를 미리 뽑아 나눠 줄 때 */
  const downloadUpcoming = () => {
    const n = Math.max(1, cycle || 1);
    if (data.teachers.length === 0) return;
    const head = data.schoolName ? data.schoolName + " " : "";
    const sheets: XSheet[] = [];
    for (let step = 0; step < n; step++) {
      const future = previewRotation(data, step);
      if (future.errors.length) { alert(`${step}번 뒤 시간표에 충돌이 있습니다.\n${future.errors.join("\n")}`); return; }
      const grids = buildGrids(data, future.timetable);
      for (const t of data.teachers) {
        const label = step === 0 ? "현재" : `${step}번 뒤`;
        sheets.push(
          toSheet({
            sheetName: `${label} ${t.name || "강사"}`.slice(0, 31),
            title: `${head}${t.name || "(이름없음)"} 강사 시간표 (${label})`,
            days: data.days,
            slots: data.slots,
            daySlots: data.daySlots,
            grid: grids.byTeacher.get(t.id) ?? [],
          }),
        );
      }
    }
    downloadBlob(
      `${safeFileName(data.schoolName || "시간표")} 로테이션 ${n}회치 강사 시간표.xlsx`,
      buildXlsx(sheets),
    );
  };

  return (
    <div className="flex flex-col gap-5">
      <Card
        title="로테이션 규칙"
        desc={
          <>
            시간표(무엇을 언제 어디서)는 그대로 두고 담당 강사만 한 칸씩 미는 방식입니다. 같이 도는 강사를{" "}
            <b>순서대로</b> 묶어 두면, 한 번 돌릴 때마다 각자 <b>바로 다음 사람</b>의 시간표를 맡습니다.
          </>
        }
      >
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            onClick={() =>
              setRotation((r) => ({ ...r, groups: [...r.groups, newGroup(`${r.groups.length + 1}조`, [])] }))
            }
          >
            + 로테이션 조 추가
          </Button>
          <Button
            disabled={unusedTeachers.length < 2}
            onClick={() =>
              setRotation((r) => ({
                ...r,
                groups: [...r.groups, newGroup("미배정 강사", unusedTeachers.map((t) => t.id))],
              }))
            }
          >
            미배정 강사를 한 조로
          </Button>
        </div>

        {groups.length === 0 ? (
          <div className="mt-4">
            <Empty>아직 로테이션 조가 없습니다. 같이 돌 강사끼리 한 조로 묶으세요.</Empty>
          </div>
        ) : (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {groups.map((g) => {
              const remaining = unusedTeachers;
              return (
                <div key={g.id} className="rounded-lg border border-tt-200 p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <TextInput
                      value={g.name}
                      placeholder="조 이름"
                      onChange={(e) => patchGroup(g.id, (x) => ({ ...x, name: e.target.value }))}
                    />
                    <Button
                      variant="danger"
                      title="조 삭제"
                      onClick={() =>
                        setRotation((r) => ({ ...r, groups: r.groups.filter((x) => x.id !== g.id) }))
                      }
                    >
                      ×
                    </Button>
                  </div>

                  {g.teacherIds.length === 0 ? (
                    <p className="py-2 text-sm text-tt-500">
                      강사를 순서대로 넣으세요. 이 순서가 도는 순서입니다.
                    </p>
                  ) : (
                    <ol className="mb-2">
                      {g.teacherIds.map((id, i) => (
                        <li key={id} className="flex items-center gap-1 border-b border-tt-100 py-1 last:border-0">
                          <span className="w-6 shrink-0 text-center text-xs font-bold text-tt-500">{i + 1}</span>
                          <span className="flex-1 text-sm font-semibold text-tt-800">
                            {teacherName.get(id) ?? "(삭제된 강사)"}
                          </span>
                          <Button disabled={i === 0} onClick={() => patchGroup(g.id, (x) => move(x, i, -1))}>
                            ↑
                          </Button>
                          <Button
                            disabled={i === g.teacherIds.length - 1}
                            onClick={() => patchGroup(g.id, (x) => move(x, i, 1))}
                          >
                            ↓
                          </Button>
                          <Button
                            variant="danger"
                            onClick={() =>
                              patchGroup(g.id, (x) => ({
                                ...x,
                                teacherIds: x.teacherIds.filter((t) => t !== id),
                              }))
                            }
                          >
                            ×
                          </Button>
                        </li>
                      ))}
                    </ol>
                  )}

                  <Select
                    value=""
                    disabled={remaining.length === 0}
                    onChange={(e) => {
                      const id = e.target.value;
                      if (id) patchGroup(g.id, (x) => ({ ...x, teacherIds: [...x.teacherIds, id] }));
                    }}
                  >
                    <option value="">
                      {remaining.length === 0 ? "더 넣을 강사가 없습니다" : "+ 강사 넣기"}
                    </option>
                    {remaining.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name || "(이름없음)"}
                      </option>
                    ))}
                  </Select>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card
        title="돌리기"
        desc="원하실 때 누르세요. 누른 그 순간 시간표의 담당 강사가 바뀌고 기록이 남습니다. 시간표의 자리와 프로그램은 건드리지 않습니다."
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-60">
            <Field label="메모" hint="예) 10월부터 · 2학기 2차">
              <TextInput
                value={note}
                placeholder="언제부터인지 적어 두면 좋습니다"
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && ready && hasTimetable) rotateNow();
                }}
              />
            </Field>
          </div>
          <Button
            variant="primary"
            disabled={!ready || !hasTimetable || preview.errors.length > 0}
            title={
              !ready
                ? "2명 이상인 로테이션 조가 필요합니다"
                : !hasTimetable
                  ? "먼저 시간표를 만드세요"
                  : undefined
            }
            onClick={rotateNow}
          >
            다음으로 돌리기
          </Button>
          <Button variant="danger" disabled={turns <= 0 || undoPreview.errors.length > 0} onClick={undoLast}>
            한 칸 되돌리기
          </Button>
          <Button
            disabled={!ready || !hasTimetable || data.teachers.length === 0}
            title="지금부터 한 바퀴치를 강사별 시트로"
            onClick={downloadUpcoming}
          >
            앞으로 {cycle || "?"}번치 미리 받기
          </Button>
        </div>

        {preview.errors.length > 0 && (
          <div role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            <p className="font-bold">로테이션을 적용할 수 없습니다</p>
            <ul>{preview.errors.map((error, i) => <li key={i}>{error}</li>)}</ul>
          </div>
        )}
        {turns > 0 && undoPreview.errors.length > 0 && (
          <p className="mt-3 text-sm text-amber-800">되돌리기: {undoPreview.errors.join(" ")}</p>
        )}

        <p className="mt-3 text-sm text-tt-600">
          지금까지 <b className="text-tt-800">{turns}번</b> 돌렸습니다.
          {cycle > 0 && (
            <>
              {" "}
              한 바퀴는 {cycle}번이고, 지금은 <b className="text-tt-800">{(turns % cycle) + 1}번째 자리</b>입니다.
            </>
          )}
        </p>

        {!hasTimetable && (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            아직 시간표가 없습니다. [시간표] 탭에서 먼저 만드세요. 규칙은 미리 정해 두셔도 됩니다.
          </p>
        )}
      </Card>

      {ready && (
        <Card title="돌리면 이렇게 됩니다" desc="한 번 돌린 뒤 각 강사가 맡게 될 시간표입니다.">
          <div className="flex flex-col gap-5">
            {groups
              .filter((g) => g.teacherIds.filter(Boolean).length >= 2)
              .map((g) => (
                <div key={g.id} className="overflow-x-auto">
                  <p className="mb-1 text-sm font-bold text-tt-700">{g.name || "(이름없는 조)"}</p>
                  <table className="border-collapse text-sm">
                    <thead>
                      <tr>
                        <th className="border border-tt-200 bg-tt-50 px-2 py-1 text-xs text-tt-600">강사</th>
                        {g.teacherIds.map((id) => (
                          <th
                            key={id}
                            className="min-w-28 border border-tt-200 bg-tt-100 px-3 py-1.5 font-bold text-tt-800"
                          >
                            {teacherName.get(id) ?? "(삭제된 강사)"}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <th className="border border-tt-200 bg-tt-50 px-2 py-1 text-left text-xs font-semibold text-tt-700">
                          돌린 뒤 맡을 시간표
                        </th>
                        {rotationPlan(g, 1).map((p) => (
                          <td
                            key={p.teacherId}
                            className="border border-tt-200 bg-tt-50 px-3 py-1.5 text-center font-semibold text-tt-800"
                          >
                            지금 {teacherName.get(p.sourceId) ?? "?"}의 자리
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              ))}
          </div>
        </Card>
      )}

      {log.length > 0 && (
        <Card title={`돌린 기록 (${log.length}건)`} desc="가장 최근이 위입니다.">
          <ul className="flex flex-col gap-1 text-sm">
            {log.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-baseline gap-2 border-b border-tt-100 py-1 last:border-0">
                <span className="w-36 shrink-0 font-mono text-xs text-tt-500">{formatTurnDate(entry.at)}</span>
                <span className="font-semibold text-tt-800">{entry.turns}번째</span>
                <span className="text-tt-600">{entry.note}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
