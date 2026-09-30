import { useMemo, useState } from "react";
import type { AppData, CalendarConfig } from "../types";
import { changeDays } from "../calendar";
import { uid } from "../store";
import {
  WEEKDAY_KO, addDays, assignDates, calendarIssues, cyclePlan, dayNumber, defaultCalendar, mondayOf, orderOf, weekdayOf,
} from "../weekly";
import { hueOf } from "./Timetable";
import { Button, Card, Field, Select, TextInput } from "./ui";

type Props = { data: AppData; set: (fn: (d: AppData) => AppData) => void };

/** 묶음(구간)마다 칸 색 — 센터 운영표처럼 보라·노랑을 먼저 쓴다 */
const PALETTE = ["#e9d5ff", "#fef08a", "#bbf7d0", "#bfdbfe", "#fecaca", "#fed7aa"];

/** 요일 이름으로 된 days 인가(월~금) — 그렇다면 아직 일차 틀을 만들지 않은 것 */
const looksLikeWeekdays = (days: string[]) => days.every((d) => /^[월화수목금토일](요일)?$/.test(d.trim()));

/**
 * 날짜별 배정 — 3일/3일 혼합과정처럼 과정 일차가 요일을 넘나들 때.
 *
 * 시간표는 "일차"(5·6학년 1일차 … 3·4학년 3일차)로 한 번만 짜고,
 * 여기서 시작 날짜·쉬는 날만 정하면 날짜마다 몇 일차인지 자동으로 붙는다.
 * 보기 화면은 주별로(10/12~16, 10/19~23 …) 펼쳐 보인다.
 */
export default function CalendarPanel({ data, set }: Props) {
  const config: CalendarConfig = data.calendar ?? defaultCalendar(data);
  const patch = (fn: (c: CalendarConfig) => CalendarConfig) =>
    set((d) => ({ ...d, calendar: fn(d.calendar ?? defaultCalendar(d)) }));

  const [groupA, setGroupA] = useState("5·6학년");
  const [groupB, setGroupB] = useState("3·4학년");
  const [length, setLength] = useState(3);
  const [skipDate, setSkipDate] = useState("");

  const issues = calendarIssues({ ...data, calendar: config });
  const order = orderOf({ ...data, calendar: config });
  const segmentIndexOf = (day: number) => data.segments.findIndex((s) => s.days.includes(day));

  /** 3일/3일 틀 — 일차와 구간을 새로 만든다 */
  const makeFrame = () => {
    const names = [groupA.trim(), groupB.trim()].filter(Boolean);
    if (names.length < 2) return alert("두 묶음의 이름을 넣어 주세요.");
    if (names[0] === names[1]) return alert("두 묶음의 이름이 같습니다.");
    const plan = cyclePlan(names, length);
    const lose = data.timetable.length > 0 || data.fixedActivities.some((f) => f.cells.length) || data.teachers.some((t) => t.unavailable.length);
    if (!confirm(
      `운영 요일을 "${plan.days.join(", ")}" ${plan.days.length}개의 일차로 바꿉니다.\n` +
      `구간도 "${names.join('", "')}" 둘로 새로 만듭니다.` +
      (lose ? "\n\n지금 요일에 놓인 수업·고정 활동·강사 회피 시간은 요일 이름이 사라지므로 함께 지워집니다." : "") +
      "\n\n계속할까요?",
    )) return;
    set((d) => {
      const moved = changeDays(d, plan.days);
      const segments = plan.segments.map((s) => ({ id: uid("s"), name: s.name, days: s.days }));
      return {
        ...moved,
        segments,
        // 예전 구간을 가리키던 반은 구간을 다시 고르게 비워 둔다
        classes: moved.classes.map((c) => (c.segmentId && !segments.some((s) => s.id === c.segmentId) ? { ...c, segmentId: null } : c)),
        daySlots: {},
        calendar: { ...(d.calendar ?? defaultCalendar(moved)), enabled: true, order: plan.days.map((_, i) => i) },
      };
    });
  };

  const setFirst = (first: number) => {
    const base = data.days.map((_, i) => i);
    const at = base.indexOf(first);
    patch((c) => ({ ...c, order: [...base.slice(at), ...base.slice(0, at)] }));
  };

  const addSkip = () => {
    if (!Number.isFinite(dayNumber(skipDate))) return;
    patch((c) => ({ ...c, skip: [...new Set([...c.skip, skipDate])].sort() }));
    setSkipDate("");
  };

  // 미리보기 — 운영표처럼 주마다 한 줄
  const preview = useMemo(() => {
    if (!Number.isFinite(dayNumber(config.start))) return [];
    const first = mondayOf(config.start);
    const lastDay = config.end && Number.isFinite(dayNumber(config.end)) ? config.end : addDays(first, 7 * 10 - 1);
    const weeks = Math.min(40, Math.floor((dayNumber(mondayOf(lastDay)) - dayNumber(first)) / 7) + 1);
    const map = assignDates({ ...data, calendar: config }, first, addDays(first, weeks * 7 - 1));
    const weekdays = config.weekdays.length ? [...config.weekdays].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)) : [1, 2, 3, 4, 5];
    return Array.from({ length: weeks }, (_, w) => {
      const monday = addDays(first, w * 7);
      return {
        monday,
        cells: weekdays.map((wd) => {
          const date = addDays(monday, (wd + 6) % 7);
          return { date, ...(map.get(date) ?? { state: "before" as const, day: null, turn: 0 }) };
        }),
      };
    });
  }, [config, data]);

  const previewDays = preview[0]?.cells.map((c) => WEEKDAY_KO[weekdayOf(dayNumber(c.date))]) ?? [];

  return (
    <div className="flex flex-col gap-5">
      <Card
        title="날짜별 배정 (혼합과정)"
        desc={
          <>
            3일/3일 혼합과정처럼 <b>과정 일차가 요일을 넘나드는</b> 운영에 씁니다. 시간표는 요일 대신 <b>일차</b>(5·6학년 1일차 …
            3·4학년 3일차)로 한 번만 짜 두고, 여기서 시작 날짜와 쉬는 날만 정하면 <b>날짜마다 몇 일차인지 자동으로</b> 붙습니다.
            시간표 보기 화면은 주별(10/12~16, 10/19~23 …)로 펼쳐 보입니다.
          </>
        }
      >
        <label className="flex items-center gap-2 text-sm font-semibold text-tt-800">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => patch((c) => ({ ...c, enabled: e.target.checked }))}
          />
          날짜별 배정 쓰기
          <span className="font-normal text-tt-500">— 끄면 지금처럼 요일 시간표 그대로 봅니다.</span>
        </label>
      </Card>

      <Card
        title="1. 일차 틀"
        desc={
          looksLikeWeekdays(data.days)
            ? "지금은 운영 요일이 월·화·수… 요일 이름입니다. 혼합과정은 일차로 짜야 하므로 먼저 틀을 만드세요."
            : `지금 일차: ${data.days.join(" → ")}`
        }
      >
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_8rem_auto] sm:items-end">
          <Field label="먼저 오는 묶음">
            <TextInput value={groupA} onChange={(e) => setGroupA(e.target.value)} />
          </Field>
          <Field label="다음 묶음">
            <TextInput value={groupB} onChange={(e) => setGroupB(e.target.value)} />
          </Field>
          <Field label="묶음마다 며칠">
            <Select value={length} onChange={(e) => setLength(Number(e.target.value))}>
              {[2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>{n}일</option>
              ))}
            </Select>
          </Field>
          <Button variant={looksLikeWeekdays(data.days) ? "primary" : "ghost"} onClick={makeFrame}>
            {length}일/{length}일 틀 만들기
          </Button>
        </div>
        <p className="mt-3 text-xs text-tt-500">
          틀을 만들면 [운영 시간]의 요일이 일차로 바뀌고, [체험반·구간]에 두 구간이 생깁니다. 체험반마다 구간을 고르고,
          Orientation(1일차)·Closing(마지막 일차) 같은 고정 활동은 일차에 맞춰 다시 넣어 주세요. 그다음 [시간표 짜기]는 예전과 같습니다.
        </p>
      </Card>

      <Card title="2. 날짜" desc="시작 날짜가 도는 차례의 첫 일차가 됩니다. 운영 요일이 아닌 날과 쉬는 날은 건너뛰고 다음 운영일이 이어받습니다.">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="시작 날짜">
            <TextInput type="date" value={config.start} onChange={(e) => patch((c) => ({ ...c, start: e.target.value }))} />
          </Field>
          <Field label="끝 날짜 (비우면 계속)" hint="마지막 방문의 마지막 날">
            <TextInput type="date" value={config.end} onChange={(e) => patch((c) => ({ ...c, end: e.target.value }))} />
          </Field>
          <Field label="시작 날짜에 올 일차">
            <Select value={order[0] ?? 0} onChange={(e) => setFirst(Number(e.target.value))}>
              {data.days.map((d, i) => (
                <option key={i} value={i}>{d}</option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="mt-4">
          <span className="text-xs font-semibold text-tt-700">운영 요일</span>
          <div className="mt-1 flex flex-wrap gap-3">
            {[1, 2, 3, 4, 5, 6, 0].map((wd) => (
              <label key={wd} className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={config.weekdays.includes(wd)}
                  onChange={(e) =>
                    patch((c) => ({ ...c, weekdays: e.target.checked ? [...new Set([...c.weekdays, wd])] : c.weekdays.filter((x) => x !== wd) }))
                  }
                />
                {WEEKDAY_KO[wd]}
              </label>
            ))}
          </div>
        </div>

        <div className="mt-4">
          <span className="text-xs font-semibold text-tt-700">쉬는 날 (공휴일·준비기간)</span>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <div className="w-44"><TextInput type="date" value={skipDate} onChange={(e) => setSkipDate(e.target.value)} /></div>
            <Button onClick={addSkip} disabled={!Number.isFinite(dayNumber(skipDate))}>추가</Button>
            {config.skip.map((d) => (
              <span key={d} className="inline-flex items-center gap-1 rounded-full border border-tt-300 bg-tt-50 px-2.5 py-0.5 text-xs text-tt-700">
                {d.slice(5).replace("-", "/")} ({WEEKDAY_KO[weekdayOf(dayNumber(d))]})
                <button type="button" aria-label={`${d} 빼기`} className="text-tt-500 hover:text-red-600" onClick={() => patch((c) => ({ ...c, skip: c.skip.filter((x) => x !== d) }))}>
                  ✕
                </button>
              </span>
            ))}
          </div>
        </div>

        {issues.length > 0 && (
          <ul className="mt-4 list-disc rounded-lg border border-amber-200 bg-amber-50 py-2 pl-8 pr-3 text-sm text-amber-900">
            {issues.map((s) => <li key={s}>{s}</li>)}
          </ul>
        )}
      </Card>

      <Card title="3. 미리보기" desc="센터 운영표와 같은지 확인하세요. 칸 색은 묶음(구간)마다 다릅니다.">
        {preview.length === 0 ? (
          <p className="text-sm text-tt-500">시작 날짜를 넣으면 주별 배정이 나옵니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] table-fixed border-collapse text-xs">
              <thead>
                <tr>
                  <th className="w-20 border border-tt-200 bg-tt-50 px-1 py-1 text-tt-600">주</th>
                  {previewDays.map((d) => (
                    <th key={d} className="border border-tt-200 bg-tt-100 px-1 py-1 font-bold text-tt-800">{d}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((w) => (
                  <tr key={w.monday}>
                    <th className="border border-tt-200 bg-tt-50 px-1 py-1 font-semibold text-tt-600">
                      {Number(w.monday.slice(5, 7))}월 {Number(w.monday.slice(8))}일
                    </th>
                    {w.cells.map((c) => {
                      const seg = c.day === null ? -1 : segmentIndexOf(c.day);
                      return (
                        <td
                          key={c.date}
                          className="border border-tt-200 px-1 py-1 text-center align-top"
                          style={c.day === null ? undefined : { background: seg >= 0 ? PALETTE[seg % PALETTE.length] : `hsl(${hueOf(data.days[c.day])} 70% 92%)` }}
                        >
                          <div className="text-[11px] text-tt-500">{Number(c.date.slice(5, 7))}/{Number(c.date.slice(8))}</div>
                          <div className={c.day === null ? "text-tt-400" : "font-semibold text-tt-800"}>
                            {c.day === null ? { before: "", after: "", off: "", skip: "쉬는 날" }[c.state as "before"] : data.days[c.day]}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
