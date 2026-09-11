import { useMemo, useState } from "react";
import type { AppData } from "../types";
import { allowedDaysOf, capacityForDays } from "../store";
import { buildGrids, mergedGrid, sliceGrid, usedCells } from "../assignments";
import { toSheet } from "../timetableSheet";
import { buildXlsx } from "../xlsx";
import { downloadBlob, safeFileName } from "../export";
import { Button, Card, Empty } from "./ui";
import Timetable from "./Timetable";
import type { Grid } from "./Timetable";

type Props = { data: AppData; onBuild: () => void };
type Axis = "class" | "teacher" | "room";

const AXIS_LABEL: Record<Axis, string> = { class: "체험반", teacher: "강사", room: "체험존" };

/**
 * 완성된 시간표만 보는 화면 — 앱을 열면 여기가 먼저 나온다.
 * 고치는 기능은 없다. 고르고, 보고, 인쇄하거나 받는 것까지만 한다.
 */
export default function ViewerPanel({ data, onBuild }: Props) {
  const [axis, setAxis] = useState<Axis>("class");
  // 빈 배열이면 전체 보기. 여러 반을 골라 나란히 놓고 보려는 요청(2026-09-11).
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  const [segId, setSegId] = useState("");

  const grids = useMemo(() => buildGrids(data, data.timetable), [data]);

  const segment = data.segments.find((s) => s.id === segId) ?? null;
  const viewDays = useMemo(() => {
    const all = data.days.map((_, i) => i);
    if (!segment) return all;
    const picked = segment.days.filter((d) => d >= 0 && d < data.days.length);
    return picked;
  }, [segment, data.days]);
  const dayLabels = viewDays.map((i) => data.days[i]);
  const segSuffix = segment ? ` (${segment.name || "구간"})` : "";

  const classesHere = segment
    ? data.classes.filter((c) => {
        const allowed = new Set(allowedDaysOf(data, c));
        return viewDays.some((d) => allowed.has(d));
      })
    : data.classes;

  // 합본은 체험반별 목록 뒤에 붙는다. 구간을 고른 상태에서는 합칠 이유가 없으므로 숨긴다.
  const groups = segment ? [] : (data.classGroups ?? []).filter((g) => g.classIds.length > 0);
  const targets = [
    ...(axis === "class" ? classesHere : axis === "teacher" ? data.teachers : data.rooms).map((x) => ({
      id: x.id,
      name: x.name || "(이름없음)",
    })),
    ...(axis === "class" ? groups.map((g) => ({ id: g.id, name: g.name || "(이름없는 묶음)" })) : []),
  ];

  const groupOf = (id: string) => groups.find((g) => g.id === id) ?? null;
  const mergedOf = (id: string) => {
    const g = groupOf(id);
    return g ? mergedGrid(data, grids, g.classIds, viewDays) : null;
  };

  const gridOf = (id: string): Grid => {
    const merged = mergedOf(id);
    if (merged) return merged.grid;
    const full =
      (axis === "class" ? grids.byClass : axis === "teacher" ? grids.byTeacher : grids.byRoom).get(id) ?? [];
    return segment ? sliceGrid(full, viewDays) : full;
  };

  const head = data.schoolName ? data.schoolName + " " : "";
  const titleFor = (name: string) =>
    `${axis === "teacher" ? `${name} 강사` : `${head}${name}`}${segSuffix}`;

  // 지운 대상이 골라진 채 남지 않게 지금 목록에 있는 것만 센다.
  const picked = pickedIds.filter((id) => targets.some((t) => t.id === id));
  const shown = picked.length > 0 ? targets.filter((t) => picked.includes(t.id)) : targets;
  const toggle = (id: string) =>
    setPickedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const download = () => {
    if (shown.length === 0) return;
    const seen = new Map<string, number>();
    const sheets = shown.map((t) => {
      const n = seen.get(t.name) ?? 0;
      seen.set(t.name, n + 1);
      return toSheet({
        sheetName: n === 0 ? t.name : `${t.name} (${n + 1})`,
        title: `${head}${axis === "teacher" ? `${t.name} 강사` : t.name} 시간표${segSuffix}`,
        days: dayLabels,
        slots: data.slots,
        daySlots: data.daySlots,
        grid: gridOf(t.id),
        bands: mergedOf(t.id)?.bands,
      });
    });
    const label = shown.length === 1 ? shown[0].name : picked.length > 0 ? `${AXIS_LABEL[axis]} ${shown.length}개` : `${AXIS_LABEL[axis]}별`;
    downloadBlob(`${safeFileName(`${data.schoolName || "시간표"} ${label}${segSuffix}`)}.xlsx`, buildXlsx(sheets));
  };

  if (data.timetable.length === 0)
    return (
      <Card title="아직 시간표가 없습니다">
        <p className="mb-4 text-sm text-tt-600">
          [시간표 구성하기]에서 자동으로 짜거나, 이미 쓰고 있는 엑셀을 올리거나, 손으로 채울 수 있습니다.
        </p>
        <Button variant="primary" onClick={onBuild}>
          시간표 구성하러 가기
        </Button>
      </Card>
    );

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <div className="no-print flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-tt-700">구분</span>
            {(["class", "teacher", "room"] as const).map((a) => (
              <Button
                key={a}
                variant={axis === a ? "primary" : "ghost"}
                disabled={a === "room" && data.rooms.length === 0}
                onClick={() => {
                  setAxis(a);
                  setPickedIds([]);
                }}
              >
                {AXIS_LABEL[a]}별
              </Button>
            ))}
            <span className="ml-auto flex gap-2">
              <Button onClick={download}>엑셀로 받기</Button>
              <Button onClick={() => window.print()}>인쇄 / PDF</Button>
            </span>
          </div>

          {data.segments.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-tt-700">구간</span>
              <Button variant={segId === "" ? "primary" : "ghost"} onClick={() => { setSegId(""); setPickedIds([]); }}>
                전체 ({data.days.join("")})
              </Button>
              {data.segments.map((s) => (
                <Button key={s.id} variant={segId === s.id ? "primary" : "ghost"} onClick={() => { setSegId(s.id); setPickedIds([]); }}>
                  {s.name || "(이름없음)"}
                </Button>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs font-semibold text-tt-700">{AXIS_LABEL[axis]}</span>
            {picked.length > 1 && (
              <span className="mr-1 text-xs text-tt-500">{picked.length}개 선택</span>
            )}
            <button
              type="button"
              onClick={() => setPickedIds([])}
              className={`rounded-md border px-2.5 py-1 text-xs font-semibold transition ${
                picked.length === 0
                  ? "border-tt-600 bg-tt-600 text-white"
                  : "border-tt-300 bg-white text-tt-600 hover:bg-tt-50"
              }`}
            >
              전체 보기
            </button>
            {targets.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => toggle(t.id)}
                className={`rounded-md border px-2.5 py-1 text-xs font-semibold transition ${
                  picked.includes(t.id)
                    ? "border-tt-600 bg-tt-600 text-white"
                    : "border-tt-300 bg-white text-tt-600 hover:bg-tt-50"
                }`}
              >
                {t.name}
              </button>
            ))}
          </div>
        </div>

        {data.rotation.turns > 0 && (
          <p className="mt-3 text-xs text-tt-500">
            로테이션 {data.rotation.turns}번 적용된 시간표입니다
            {data.rotation.log[0]?.note ? ` · 마지막: ${data.rotation.log[0].note}` : ""}.
          </p>
        )}
      </Card>

      {viewDays.length === 0 ? (
        <Empty>이 구간의 운영 요일이 없습니다. [시간표 구성하기]에서 요일을 지정하세요.</Empty>
      ) : targets.length === 0 ? (
        <Empty>이 구간에 해당하는 {AXIS_LABEL[axis]}이(가) 없습니다.</Empty>
      ) : (
        <div className={`grid gap-5 ${shown.length === 1 ? "" : "xl:grid-cols-2"}`}>
          {shown.map((t) => {
            const merged = mergedOf(t.id);
            const g = gridOf(t.id);
            const used = usedCells(g);
            // 합본은 여러 반을 이어 붙인 것이라 반 하나의 등원 요일로 칸 수를 재면 안 된다.
            const capacity = capacityForDays(data, viewDays, merged || axis !== "class" ? undefined : t.id);
            return (
              <Timetable
                key={t.id}
                title={titleFor(t.name)}
                subtitle={
                  axis === "room"
                    ? `사용 ${used}/${capacity}칸`
                    : `주 ${used}시간${axis === "class" ? ` · 빈 칸 ${Math.max(0, capacity - used)}` : ""}`
                }
                days={dayLabels}
                slots={data.slots}
                daySlots={data.daySlots}
                grid={g}
                bands={merged?.bands}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
