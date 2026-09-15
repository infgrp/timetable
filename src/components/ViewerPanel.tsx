import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { AppData } from "../types";
import { allowedDaysOf, capacityForDays } from "../store";
import { buildGrids, mergedGrid, sliceGrid, usedCells } from "../assignments";
import { toSheet } from "../timetableSheet";
import { buildXlsx } from "../xlsx";
import { downloadBlob, safeFileName } from "../export";
import { localizeData, useI18n } from "../i18n";
import { Button, Card, Empty } from "./ui";
import Timetable from "./Timetable";
import type { Grid } from "./Timetable";

type Props = { data: AppData; onBuild: () => void };
type Axis = "class" | "teacher" | "room";

const AXIS_LABEL: Record<Axis, string> = { class: "체험반", teacher: "강사", room: "체험존" };
const AXIS_BY: Record<Axis, string> = { class: "체험반별", teacher: "강사별", room: "체험존별" };

/**
 * 조건 한 줄 — 휴대폰에서는 이름표를 위에 두고 버튼을 시간표 폭만큼 고르게 편다(2026-09-15 요청).
 * 넓은 화면에서는 예전처럼 한 줄에 흘린다.
 */
function Row({ label, children, cols = 3 }: { label: ReactNode; children: ReactNode; cols?: 2 | 3 | 4 }) {
  const grid = { 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-4" }[cols];
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
      <span className="text-xs font-semibold text-tt-700">{label}</span>
      <div className={`grid w-full ${grid} gap-1.5 sm:flex sm:w-auto sm:flex-wrap sm:gap-2`}>{children}</div>
    </div>
  );
}

/**
 * 완성된 시간표만 보는 화면 — 앱을 열면 여기가 먼저 나온다.
 * 고치는 기능은 없다. 고르고, 보고, 인쇄하거나 받는 것까지만 한다.
 * 영어 화면에서는 요일·교시·점심·구간 이름을 영어로 바꾼 사본을 그린다(엑셀도 같다).
 */
export default function ViewerPanel({ data: raw, onBuild }: Props) {
  const { lang, t } = useI18n();
  const data = useMemo(() => localizeData(raw, lang), [raw, lang]);
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
  const segSuffix = segment ? ` (${segment.name || t("(이름없음)")})` : "";

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
      name: x.name || t("(이름없음)"),
    })),
    ...(axis === "class" ? groups.map((g) => ({ id: g.id, name: g.name || t("(이름없는 묶음)") })) : []),
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
  const nameFor = (name: string) => (axis === "teacher" ? t("{name} 강사", { name }) : name);
  const titleFor = (name: string) => `${axis === "teacher" ? nameFor(name) : `${head}${name}`}${segSuffix}`;

  // 지운 대상이 골라진 채 남지 않게 지금 목록에 있는 것만 센다.
  const picked = pickedIds.filter((id) => targets.some((x) => x.id === id));
  const shown = picked.length > 0 ? targets.filter((x) => picked.includes(x.id)) : targets;
  const toggle = (id: string) =>
    setPickedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const download = () => {
    if (shown.length === 0) return;
    const seen = new Map<string, number>();
    const sheets = shown.map((x) => {
      const n = seen.get(x.name) ?? 0;
      seen.set(x.name, n + 1);
      return toSheet({
        sheetName: n === 0 ? x.name : `${x.name} (${n + 1})`,
        title: `${head}${nameFor(x.name)} ${t("시간표{suffix}", { suffix: segSuffix })}`,
        days: dayLabels,
        slots: data.slots,
        daySlots: data.daySlots,
        grid: gridOf(x.id),
        bands: mergedOf(x.id)?.bands,
        lang,
      });
    });
    const label =
      shown.length === 1
        ? shown[0].name
        : picked.length > 0
          ? t("{axis} {n}개", { axis: t(AXIS_LABEL[axis]).toLowerCase(), n: shown.length })
          : t(AXIS_BY[axis]);
    const file = `${data.schoolName || t("시간표")} ${label}${segSuffix}`;
    downloadBlob(`${safeFileName(file)}.xlsx`, buildXlsx(sheets));
  };

  if (data.timetable.length === 0)
    return (
      <Card title={t("아직 시간표가 없습니다")}>
        <p className="mb-4 text-sm text-tt-600">
          {t("[시간표 구성하기]에서 자동으로 짜거나, 이미 쓰고 있는 엑셀을 올리거나, 손으로 채울 수 있습니다.")}
        </p>
        <Button variant="primary" onClick={onBuild}>
          {t("시간표 구성하러 가기")}
        </Button>
      </Card>
    );

  const chip = (on: boolean) =>
    `min-w-0 truncate rounded-md border px-2 py-1.5 text-xs font-semibold transition sm:px-2.5 sm:py-1 ${
      on ? "border-tt-600 bg-tt-600 text-white" : "border-tt-300 bg-white text-tt-600 hover:bg-tt-50"
    }`;

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <div className="no-print flex flex-col gap-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <Row label={t("구분")}>
              {(["class", "teacher", "room"] as const).map((a) => (
                <Button
                  key={a}
                  wide
                  variant={axis === a ? "primary" : "ghost"}
                  disabled={a === "room" && data.rooms.length === 0}
                  onClick={() => {
                    setAxis(a);
                    setPickedIds([]);
                  }}
                >
                  {t(AXIS_BY[a])}
                </Button>
              ))}
            </Row>
            <div className="grid grid-cols-2 gap-1.5 sm:ml-auto sm:flex sm:gap-2">
              <Button wide onClick={download}>
                {t("엑셀로 받기")}
              </Button>
              <Button wide onClick={() => window.print()}>
                {t("인쇄 / PDF")}
              </Button>
            </div>
          </div>

          {data.segments.length > 0 && (
            <Row label={t("구간")} cols={data.segments.length + 1 >= 4 ? 4 : data.segments.length + 1 === 2 ? 2 : 3}>
              <Button wide variant={segId === "" ? "primary" : "ghost"} onClick={() => { setSegId(""); setPickedIds([]); }}>
                <span className="sm:hidden">{t("전체")}</span>
                <span className="hidden sm:inline">{t("전체 ({days})", { days: data.days.join(lang === "en" ? "·" : "") })}</span>
              </Button>
              {data.segments.map((s) => (
                <Button key={s.id} wide variant={segId === s.id ? "primary" : "ghost"} onClick={() => { setSegId(s.id); setPickedIds([]); }}>
                  {s.name || t("(이름없음)")}
                </Button>
              ))}
            </Row>
          )}

          <Row
            cols={3}
            label={
              <>
                {t(AXIS_LABEL[axis])}
                {picked.length > 1 && <span className="ml-2 font-normal text-tt-500">{t("{n}개 선택", { n: picked.length })}</span>}
              </>
            }
          >
            <button type="button" onClick={() => setPickedIds([])} className={`col-span-full sm:col-span-1 ${chip(picked.length === 0)}`}>
              {t("전체 보기")}
            </button>
            {targets.map((x) => (
              <button key={x.id} type="button" title={x.name} onClick={() => toggle(x.id)} className={chip(picked.includes(x.id))}>
                {x.name}
              </button>
            ))}
          </Row>
        </div>

        {data.rotation.turns > 0 && (
          <p className="mt-3 text-xs text-tt-500">
            {t("로테이션 {n}번 적용된 시간표입니다", { n: data.rotation.turns })}
            {data.rotation.log[0]?.note ? t(" · 마지막: {note}", { note: data.rotation.log[0].note }) : ""}.
          </p>
        )}
      </Card>

      {viewDays.length === 0 ? (
        <Empty>{t("이 구간의 운영 요일이 없습니다. [시간표 구성하기]에서 요일을 지정하세요.")}</Empty>
      ) : targets.length === 0 ? (
        <Empty>{t("이 구간에 해당하는 {axis}이(가) 없습니다.", { axis: lang === "en" ? t(AXIS_LABEL[axis]).toLowerCase() : AXIS_LABEL[axis] })}</Empty>
      ) : (
        <div className={`grid grid-cols-1 gap-5 ${shown.length === 1 ? "" : "xl:grid-cols-2"}`}>
          {shown.map((x) => {
            const merged = mergedOf(x.id);
            const g = gridOf(x.id);
            const used = usedCells(g);
            // 합본은 여러 반을 이어 붙인 것이라 반 하나의 등원 요일로 칸 수를 재면 안 된다.
            const capacity = capacityForDays(data, viewDays, merged || axis !== "class" ? undefined : x.id);
            return (
              <Timetable
                key={x.id}
                title={titleFor(x.name)}
                subtitle={
                  axis === "room"
                    ? t("사용 {used}/{capacity}칸", { used, capacity })
                    : `${t("주 {used}시간", { used })}${axis === "class" ? t(" · 빈 칸 {n}", { n: Math.max(0, capacity - used) }) : ""}`
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
