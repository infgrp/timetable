import { useState } from "react";
import type { AppData, DaySlot } from "../types";
import { ALL_DAYS, DEFAULT_GEN, generateSlots, periodsOf, uid } from "../store";
import type { SlotGenOptions } from "../store";
import { Button, Card, Field, Select, TextInput } from "./ui";
import FixedActivitiesCard from "./FixedActivitiesCard";
import { changeDays, changeSlots, slotsFor } from "../calendar";

type Props = { data: AppData; set: (fn: (d: AppData) => AppData) => void };

export default function SlotsPanel({ data, set }: Props) {
  const [gen, setGen] = useState<SlotGenOptions>(DEFAULT_GEN);
  const [selectedDay, setSelectedDay] = useState("");
  const dayName = data.days.includes(selectedDay) ? selectedDay : "";
  const slots = dayName ? slotsFor(data, data.days.indexOf(dayName)) : data.slots;
  const updateSlots = (fn: (slots: DaySlot[]) => DaySlot[], byIndex = false) =>
    set((d) => changeSlots(d, dayName, fn(dayName ? slotsFor(d, d.days.indexOf(dayName)) : d.slots), byIndex));

  const toggleDay = (day: string) => {
    const removedCount = data.timetable.filter((a) => data.days[a.day] === day).length;
    if (data.days.includes(day) && removedCount && !confirm(`${day}요일을 해제하면 그날의 수업 ${removedCount}개가 삭제됩니다. 다른 요일의 배정은 유지됩니다. 계속할까요?`)) return;
    set((d) => {
      const has = d.days.includes(day);
      const days = has ? d.days.filter((x) => x !== day) : [...d.days, day];
      days.sort((a, b) => ALL_DAYS.indexOf(a) - ALL_DAYS.indexOf(b));
      return changeDays(d, days);
    });
  };

  const patchSlot = (id: string, patch: Partial<DaySlot>) =>
    updateSlots((current) => current.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const removeSlot = (id: string) =>
    updateSlots((current) => current.filter((s) => s.id !== id));

  const moveSlot = (id: string, dir: -1 | 1) =>
    updateSlots((current) => {
      const i = current.findIndex((s) => s.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= current.length) return current;
      const slots = [...current];
      [slots[i], slots[j]] = [slots[j], slots[i]];
      return slots;
    });

  const addSlot = (kind: DaySlot["kind"]) =>
    updateSlots((current) => {
      const last = current[current.length - 1];
      return [
          ...current,
          {
            id: uid("slot"),
            kind,
            label: kind === "period" ? `${periodsOf(current).length + 1}교시` : "쉬는시간",
            start: last?.end ?? "09:00",
            end: last?.end ?? "09:00",
          },
        ];
    });

  const regenerate = () => {
    if (slots.length > 0 && !confirm(`${dayName || "공통"} 교시 구성을 새로 만듭니다. 교시 번호는 유지되며, 줄어든 교시의 배정은 삭제됩니다. 계속할까요?`)) return;
    updateSlots(() => generateSlots(gen), true);
  };

  const periodCount = periodsOf(slots).length;

  return (
    <div className="flex flex-col gap-5">
      <Card title="기본 정보">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="센터명 (인쇄물 머리글)">
            <TextInput
              value={data.schoolName}
              placeholder="예) ○○영어체험센터"
              onChange={(e) => set((d) => ({ ...d, schoolName: e.target.value }))}
            />
          </Field>
          <Field label="센터 영어 이름 (영어 화면·영어 엑셀 머리글)" hint="비우면 영어 화면에서는 센터 이름 없이 Timetable 로만 표시합니다.">
            <TextInput
              value={data.schoolNameEn ?? ""}
              placeholder="예) Namwon English Experience Center"
              onChange={(e) => set((d) => ({ ...d, schoolNameEn: e.target.value }))}
            />
          </Field>
          <Field label="운영 요일">
            <div className="flex flex-wrap gap-1.5 pt-1">
              {ALL_DAYS.map((day) => {
                const on = data.days.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleDay(day)}
                    className={`h-9 w-9 rounded-lg border text-sm font-bold transition ${
                      on
                        ? "border-tt-600 bg-tt-600 text-white"
                        : "border-tt-300 bg-white text-tt-500 hover:bg-tt-50"
                    }`}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          </Field>
        </div>
      </Card>

      <Card title="시간 구성을 적용할 요일" desc="공통 구성을 사용하거나 요일별로 시작 시각, 교시 길이, 점심 위치를 따로 정할 수 있습니다.">
        <div className="flex flex-wrap items-center gap-2">
          <Select aria-label="시간 구성 요일" value={dayName} onChange={(e) => setSelectedDay(e.target.value)}>
            <option value="">공통 (별도 설정이 없는 요일)</option>
            {data.days.map((d) => <option key={d} value={d}>{d}요일{data.daySlots?.[d] ? " · 별도 구성" : " · 공통 사용"}</option>)}
          </Select>
          {dayName && data.daySlots?.[dayName] && <Button onClick={() => set((d) => {
            const next = changeSlots(d, dayName, d.slots, true);
            const daySlots = { ...next.daySlots };
            delete daySlots[dayName];
            return { ...next, daySlots };
          })}>이 요일을 공통 구성으로 되돌리기</Button>}
        </div>
      </Card>

      <Card
        title={`교시 자동 생성 · ${dayName || "공통"}`}
        desc="1교시 시작 시각과 길이를 넣으면 점심시간까지 포함해 하루 구성을 만들어 줍니다. 체험센터는 보통 40분 6교시로 운영합니다."
      >
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Field label="1교시 시작">
            <TextInput
              value={gen.firstStart}
              placeholder="09:00"
              onChange={(e) => setGen({ ...gen, firstStart: e.target.value })}
            />
          </Field>
          <Field label="프로그램 (분)">
            <TextInput
              type="number"
              min={1}
              value={gen.periodMinutes}
              onChange={(e) => setGen({ ...gen, periodMinutes: Number(e.target.value) })}
            />
          </Field>
          <Field label="쉬는시간 (분)">
            <TextInput
              type="number"
              min={0}
              value={gen.breakMinutes}
              onChange={(e) => setGen({ ...gen, breakMinutes: Number(e.target.value) })}
            />
          </Field>
          <Field label="교시 수">
            <TextInput
              type="number"
              min={1}
              max={20}
              value={gen.periodCount}
              onChange={(e) => setGen({ ...gen, periodCount: Number(e.target.value) })}
            />
          </Field>
          <Field label="점심 (몇 교시 뒤)" hint="0이면 넣지 않음">
            <TextInput
              type="number"
              min={0}
              value={gen.lunchAfter}
              onChange={(e) => setGen({ ...gen, lunchAfter: Number(e.target.value) })}
            />
          </Field>
          <Field label="점심 (분)">
            <TextInput
              type="number"
              min={0}
              value={gen.lunchMinutes}
              onChange={(e) => setGen({ ...gen, lunchMinutes: Number(e.target.value) })}
            />
          </Field>
        </div>
        <div className="mt-4">
          <Button variant="primary" onClick={regenerate}>
            교시 구성 만들기
          </Button>
        </div>
      </Card>

      <Card
        title={`하루 시간 구성 (프로그램 ${periodCount}교시)`}
        desc="점심·쉬는시간 칸을 사이에 두면 연속 2교시 블록이 그 지점을 넘지 못합니다."
        right={
          <div className="flex gap-2">
            <Button onClick={() => addSlot("period")}>+ 교시</Button>
            <Button onClick={() => addSlot("break")}>+ 쉬는시간</Button>
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-tt-200 text-left text-xs font-semibold text-tt-600">
                <th className="w-24 py-2">종류</th>
                <th className="py-2">이름</th>
                <th className="w-28 py-2">시작</th>
                <th className="w-28 py-2">종료</th>
                <th className="w-32 py-2" />
              </tr>
            </thead>
            <tbody>
              {slots.map((s) => (
                <tr key={s.id} className="border-b border-tt-100 last:border-0">
                  <td className="py-1.5 pr-2">
                    <Select
                      value={s.kind}
                      onChange={(e) => patchSlot(s.id, { kind: e.target.value as DaySlot["kind"] })}
                    >
                      <option value="period">프로그램</option>
                      <option value="break">쉬는시간</option>
                    </Select>
                  </td>
                  <td className="py-1.5 pr-2">
                    <TextInput value={s.label} onChange={(e) => patchSlot(s.id, { label: e.target.value })} />
                  </td>
                  <td className="py-1.5 pr-2">
                    <TextInput
                      type="time"
                      value={s.start}
                      onChange={(e) => patchSlot(s.id, { start: e.target.value })}
                    />
                  </td>
                  <td className="py-1.5 pr-2">
                    <TextInput
                      type="time"
                      value={s.end}
                      onChange={(e) => patchSlot(s.id, { end: e.target.value })}
                    />
                  </td>
                  <td className="py-1.5">
                    <div className="flex gap-1">
                      <Button onClick={() => moveSlot(s.id, -1)} title="위로">
                        ↑
                      </Button>
                      <Button onClick={() => moveSlot(s.id, 1)} title="아래로">
                        ↓
                      </Button>
                      <Button variant="danger" onClick={() => removeSlot(s.id)} title="삭제">
                        ×
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <FixedActivitiesCard data={data} set={set} />
    </div>
  );
}
