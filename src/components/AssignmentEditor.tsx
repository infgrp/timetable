import type { AppData, Assignment } from "../types";
import { fits, knownSubjects, periodsCovered, teacherBusyAt } from "../assignments";
import { dayPeriods } from "../calendar";
import { programRoomMap } from "../store";
import { Button, Field, Select, TextInput } from "./ui";

type Props = {
  data: AppData;
  value: Assignment;
  onChange: (next: Assignment) => void;
  onDelete: () => void;
  onClose: () => void;
};

/** 배치된 칸 하나를 고치는 폼. 고치는 즉시 반영된다(따로 저장 버튼 없음). */
export default function AssignmentEditor({ data, value, onChange, onDelete, onClose }: Props) {
  const periods = dayPeriods(data, value.day);
  const patch = (p: Partial<Assignment>) => onChange({ ...value, ...p });
  /** 프로그램에 묶어 둔 체험존이 있으면 이름을 고칠 때 존도 따라 바꾼다. */
  const patchSubject = (subject: string) => {
    const linked = programRoomMap(data).get(subject.trim().toLowerCase());
    patch(linked ? { subject, roomId: linked } : { subject });
  };
  const canBlock = fits(data, value.day, value.period, 2);
  // 이 자리에 이미 묶여 있는 강사는 고르기 전에 이유를 보여 준다.
  const busy = (id: string) =>
    teacherBusyAt(data, data.timetable, id, value.day, periodsCovered(value), value.id);

  return (
    <div className="rounded-xl border border-tt-400 bg-tt-50 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold text-tt-800">칸 편집</h3>
        <div className="flex gap-2">
          <Button variant="danger" onClick={onDelete}>
            이 칸 삭제
          </Button>
          <Button onClick={onClose}>닫기</Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="체험반">
          <Select value={value.classId} onChange={(e) => patch({ classId: e.target.value })}>
            {data.classes.length === 0 && <option value="">(체험반 없음)</option>}
            {data.classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name || "(이름없음)"}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="프로그램">
          <TextInput
            list="tt-subject-options"
            value={value.subject}
            placeholder="예) Homeroom English"
            onChange={(e) => patchSubject(e.target.value)}
          />
          <datalist id="tt-subject-options">
            {knownSubjects(data).map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </Field>

        <Field label="강사" hint="비워 두면 강사 칸이 빈 채로 나옵니다">
          <Select
            value={value.teacherId ?? ""}
            onChange={(e) => patch({ teacherId: e.target.value || null })}
          >
            <option value="">(미지정)</option>
            {data.teachers.map((t) => {
              const why = busy(t.id);
              return (
                <option key={t.id} value={t.id}>
                  {t.name || "(이름없음)"}
                  {why ? ` — ${why}` : ""}
                </option>
              );
            })}
          </Select>
        </Field>

        <Field label="함께 들어가는 강사" hint="두 명 이상이 같이 맡는 칸이면 고릅니다">
          <div className="flex flex-wrap gap-1 pt-1">
            {data.teachers.filter((t) => t.id !== value.teacherId).length === 0 ? (
              <span className="text-xs text-tt-500">고를 강사가 없습니다</span>
            ) : (
              data.teachers
                .filter((t) => t.id !== value.teacherId)
                .map((t) => {
                  const on = (value.coTeacherIds ?? []).includes(t.id);
                  const why = busy(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      title={why ? `이 시간에 ${why}` : undefined}
                      onClick={() => {
                        const next = on
                          ? (value.coTeacherIds ?? []).filter((x) => x !== t.id)
                          : [...(value.coTeacherIds ?? []), t.id];
                        patch({ coTeacherIds: next.length > 0 ? next : undefined });
                      }}
                      className={`rounded border px-1.5 py-0.5 text-xs font-semibold ${
                        on
                          ? "border-tt-600 bg-tt-600 text-white"
                          : why
                            ? "border-amber-300 bg-amber-50 text-amber-700"
                            : "border-tt-300 bg-white text-tt-600 hover:bg-tt-50"
                      }`}
                    >
                      {t.name || "(이름없음)"}
                      {why ? " ⚠" : ""}
                    </button>
                  );
                })
            )}
          </div>
        </Field>

        <Field label="체험존">
          <Select value={value.roomId ?? ""} onChange={(e) => patch({ roomId: e.target.value || null })}>
            <option value="">(미지정)</option>
            {data.rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name || "(이름없음)"}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="요일">
          <Select value={value.day} onChange={(e) => patch({ day: Number(e.target.value) })}>
            {data.days.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="교시">
          <Select
            value={value.period}
            onChange={(e) => {
              const period = Number(e.target.value);
              const length = value.length === 2 && !fits(data, value.day, period, 2) ? 1 : value.length;
              patch({ period, length });
            }}
          >
            {periods.map((p, i) => (
              <option key={p.id} value={i}>
                {p.label} ({p.start})
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="길이"
          hint={canBlock ? undefined : "이 자리 뒤에는 점심·쉬는시간이 있어 붙일 수 없습니다"}
        >
          <Select
            value={value.length}
            disabled={!canBlock}
            onChange={(e) => patch({ length: Number(e.target.value) === 2 ? 2 : 1 })}
          >
            <option value={1}>1교시</option>
            <option value={2}>연속 2교시</option>
          </Select>
        </Field>

        <Field label="강사 표기" hint="매주 담당이 바뀌는 수업이면 숨깁니다">
          <label className="flex cursor-pointer items-center gap-2 pt-1.5 text-sm text-tt-700">
            <input
              type="checkbox"
              checked={Boolean(value.hideTeacher)}
              onChange={(e) => patch({ hideTeacher: e.target.checked || undefined })}
            />
            체험반 시간표에서 강사 숨기기
          </label>
        </Field>
      </div>

      {(() => {
        const clash = [value.teacherId, ...(value.coTeacherIds ?? [])]
          .filter((id): id is string => Boolean(id))
          .map((id) => ({ name: data.teachers.find((t) => t.id === id)?.name || "?", why: busy(id) }))
          .filter((x) => x.why);
        return clash.length === 0 ? null : (
          <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs font-semibold text-amber-800">
            {clash.map((c) => `${c.name} — 이 시간에 ${c.why}`).join(" · ")}
          </p>
        );
      })()}

      {value.hideTeacher && (
        <p className="mt-3 rounded-lg border border-tt-200 bg-white p-2.5 text-xs text-tt-600">
          체험반·체험존 시간표에는 강사 이름이 나오지 않고, 위에서 고른 강사의 개인 시간표에는 그대로 들어갑니다.
        </p>
      )}
    </div>
  );
}
