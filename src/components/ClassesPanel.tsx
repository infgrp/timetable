import { useState } from "react";
import type { AppData } from "../types";
import { uid } from "../store";
import { Button, Card, Empty, Field, TextInput } from "./ui";

type Props = { data: AppData; set: (fn: (d: AppData) => AppData) => void };

export default function ClassesPanel({ data, set }: Props) {
  const [grade, setGrade] = useState(1);
  const [count, setCount] = useState(10);
  const [roomName, setRoomName] = useState("");

  const bulkAdd = () => {
    set((d) => {
      const existing = new Set(d.classes.map((c) => c.name));
      const added = [];
      for (let i = 1; i <= count; i++) {
        const name = `${grade}-${i}`;
        if (existing.has(name)) continue;
        added.push({ id: uid("k"), name });
      }
      return { ...d, classes: [...d.classes, ...added] };
    });
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

  return (
    <div className="flex flex-col gap-5">
      <Card
        title={`학급 (${data.classes.length}개)`}
        desc="시간표가 만들어지는 단위입니다. 학년-반 형식으로 한 번에 만들 수 있습니다."
      >
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div className="w-24">
            <Field label="학년">
              <TextInput
                type="number"
                min={1}
                value={grade}
                onChange={(e) => setGrade(Number(e.target.value))}
              />
            </Field>
          </div>
          <div className="w-24">
            <Field label="반 수">
              <TextInput
                type="number"
                min={1}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
              />
            </Field>
          </div>
          <Button variant="primary" onClick={bulkAdd}>
            {grade}-1 ~ {grade}-{count} 추가
          </Button>
          <Button onClick={() => set((d) => ({ ...d, classes: [...d.classes, { id: uid("k"), name: "" }] }))}>
            + 빈 학급
          </Button>
        </div>

        {data.classes.length === 0 ? (
          <Empty>학급이 없습니다. 위에서 추가하세요.</Empty>
        ) : (
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {data.classes.map((c) => (
              <div key={c.id} className="flex items-center gap-1">
                <TextInput
                  value={c.name}
                  placeholder="1-1"
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
        title={`특별실 (${data.rooms.length}개)`}
        desc="과학실·음악실처럼 동시에 한 수업만 쓸 수 있는 공간입니다. 담당 배정에서 과목마다 지정하면 같은 교시에 겹치지 않게 배치합니다."
      >
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div className="w-56">
            <Field label="특별실 이름">
              <TextInput
                value={roomName}
                placeholder="예) 과학실1"
                onChange={(e) => setRoomName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || !roomName.trim()) return;
                  set((d) => ({ ...d, rooms: [...d.rooms, { id: uid("r"), name: roomName.trim() }] }));
                  setRoomName("");
                }}
              />
            </Field>
          </div>
          <Button
            variant="primary"
            disabled={!roomName.trim()}
            onClick={() => {
              set((d) => ({ ...d, rooms: [...d.rooms, { id: uid("r"), name: roomName.trim() }] }));
              setRoomName("");
            }}
          >
            + 추가
          </Button>
        </div>

        {data.rooms.length === 0 ? (
          <Empty>특별실을 쓰지 않으면 비워 두어도 됩니다.</Empty>
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
