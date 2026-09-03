import { useState } from "react";
import type { AppData } from "../types";
import { uid } from "../store";
import { Button, Card, Empty, Field, Select, TextInput } from "./ui";

type Props = { data: AppData; set: (fn: (d: AppData) => AppData) => void };

const ZONE_PRESET = [
  "공항·출입국존",
  "레스토랑존",
  "마트·쇼핑존",
  "병원·클리닉존",
  "미디어 스튜디오",
  "컬처룸",
  "호텔·트래블존",
  "도서관·리딩룸",
];

export default function ClassesPanel({ data, set }: Props) {
  const [scheme, setScheme] = useState<"alpha" | "num" | "grade">("alpha");
  const [prefix, setPrefix] = useState("1");
  const [count, setCount] = useState(6);
  const [roomName, setRoomName] = useState("");

  const previewNames = () => {
    const out: string[] = [];
    for (let i = 0; i < count; i++) {
      if (scheme === "alpha") out.push(`${String.fromCharCode(65 + (i % 26))}반`);
      else if (scheme === "num") out.push(`${i + 1}반`);
      else out.push(`${prefix}-${i + 1}`);
    }
    return out;
  };

  const bulkAddClasses = () =>
    set((d) => {
      const existing = new Set(d.classes.map((c) => c.name));
      const added = previewNames()
        .filter((name) => !existing.has(name))
        .map((name) => ({ id: uid("k"), name }));
      return { ...d, classes: [...d.classes, ...added] };
    });

  const addRoom = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    set((d) =>
      d.rooms.some((r) => r.name === trimmed)
        ? d
        : { ...d, rooms: [...d.rooms, { id: uid("r"), name: trimmed }] },
    );
  };

  const removeClass = (id: string) =>
    set((d) => ({
      ...d,
      classes: d.classes.filter((c) => c.id !== id),
      courses: d.courses.map((c) => ({ ...c, classIds: c.classIds.filter((x) => x !== id) })),
    }));

  const removeRoom = (id: string) =>
    set((d) => ({
      ...d,
      rooms: d.rooms.filter((r) => r.id !== id),
      courses: d.courses.map((c) => (c.roomId === id ? { ...c, roomId: null } : c)),
    }));

  const preview = previewNames();
  const unusedPresets = ZONE_PRESET.filter((n) => !data.rooms.some((r) => r.name === n));

  return (
    <div className="flex flex-col gap-5">
      <Card
        title={`체험반 (${data.classes.length}개)`}
        desc="시간표가 만들어지는 단위입니다. 캠프반이든 방문 학급이든, 한 팀이 곧 한 줄의 시간표가 됩니다."
      >
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div className="w-36">
            <Field label="이름 형식">
              <Select value={scheme} onChange={(e) => setScheme(e.target.value as typeof scheme)}>
                <option value="alpha">A반, B반 …</option>
                <option value="num">1반, 2반 …</option>
                <option value="grade">3-1, 3-2 … (방문 학급)</option>
              </Select>
            </Field>
          </div>
          {scheme === "grade" && (
            <div className="w-24">
              <Field label="학년">
                <TextInput value={prefix} onChange={(e) => setPrefix(e.target.value)} />
              </Field>
            </div>
          )}
          <div className="w-24">
            <Field label="반 수">
              <TextInput
                type="number"
                min={1}
                max={40}
                value={count}
                onChange={(e) => setCount(Math.max(1, Math.min(40, Number(e.target.value))))}
              />
            </Field>
          </div>
          <Button variant="primary" onClick={bulkAddClasses}>
            {preview[0]} ~ {preview[preview.length - 1]} 추가
          </Button>
          <Button onClick={() => set((d) => ({ ...d, classes: [...d.classes, { id: uid("k"), name: "" }] }))}>
            + 빈 반
          </Button>
        </div>

        {data.classes.length === 0 ? (
          <Empty>체험반이 없습니다. 위에서 추가하세요.</Empty>
        ) : (
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {data.classes.map((c) => (
              <div key={c.id} className="flex items-center gap-1">
                <TextInput
                  value={c.name}
                  placeholder="A반"
                  onChange={(e) =>
                    set((d) => ({
                      ...d,
                      classes: d.classes.map((x) => (x.id === c.id ? { ...x, name: e.target.value } : x)),
                    }))
                  }
                />
                <Button variant="danger" onClick={() => removeClass(c.id)} title="삭제">
                  ×
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card
        title={`체험존 (${data.rooms.length}개)`}
        desc="같은 교시에 한 팀만 들어갈 수 있는 공간입니다. 체험센터에서는 보통 여기가 병목이 되므로, 프로그램마다 존을 지정해 두면 겹치지 않게 배치합니다."
      >
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <div className="w-56">
            <Field label="체험존 이름">
              <TextInput
                value={roomName}
                placeholder="예) 공항·출입국존"
                onChange={(e) => setRoomName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  addRoom(roomName);
                  setRoomName("");
                }}
              />
            </Field>
          </div>
          <Button
            variant="primary"
            disabled={!roomName.trim()}
            onClick={() => {
              addRoom(roomName);
              setRoomName("");
            }}
          >
            + 추가
          </Button>
        </div>

        {unusedPresets.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold text-tt-600">자주 쓰는 존:</span>
            {unusedPresets.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => addRoom(n)}
                className="rounded-md border border-dashed border-tt-300 px-2 py-1 text-xs font-semibold text-tt-600 hover:border-tt-500 hover:bg-tt-50"
              >
                + {n}
              </button>
            ))}
          </div>
        )}

        {data.rooms.length === 0 ? (
          <Empty>존을 쓰지 않는 프로그램만 있다면 비워 두어도 됩니다.</Empty>
        ) : (
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {data.rooms.map((r) => (
              <div key={r.id} className="flex items-center gap-1">
                <TextInput
                  value={r.name}
                  onChange={(e) =>
                    set((d) => ({
                      ...d,
                      rooms: d.rooms.map((x) => (x.id === r.id ? { ...x, name: e.target.value } : x)),
                    }))
                  }
                />
                <Button variant="danger" onClick={() => removeRoom(r.id)} title="삭제">
                  ×
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
