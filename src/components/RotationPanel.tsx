import { useState } from "react";
import type { AppData, RotationGroup } from "../types";
import { monthRounds, newGroup, newRound, rotationPlan } from "../rotation";
import { Button, Card, Empty, Field, Select, TextInput } from "./ui";

type Props = { data: AppData; set: (fn: (d: AppData) => AppData) => void };

export default function RotationPanel({ data, set }: Props) {
  const [startMonth, setStartMonth] = useState(3);
  const { groups, rounds } = data.rotation;
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

  const biggest = Math.max(0, ...groups.map((g) => g.teacherIds.length));

  return (
    <div className="flex flex-col gap-5">
      <Card
        title="강사 로테이션"
        desc={
          <>
            시간표(무엇을 언제 어디서)는 그대로 두고 회차마다 담당 강사만 한 칸씩 밉니다. 예를 들어 A·B·C
            순서로 묶어 두면, 1회차에는 A가 B의 시간표를, B가 C의 시간표를, C가 A의 시간표를 맡습니다.
            결과는 <b>[시간표]</b> 탭에서 회차를 골라 보고 그대로 내려받습니다.
          </>
        }
      >
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            onClick={() =>
              setRotation((r) => ({
                ...r,
                groups: [...r.groups, newGroup(`${r.groups.length + 1}조`, [])],
              }))
            }
          >
            + 로테이션 조 추가
          </Button>
          <Button
            disabled={data.teachers.length < 2}
            onClick={() =>
              setRotation((r) => ({
                ...r,
                groups: [...r.groups, newGroup("전체", data.teachers.map((t) => t.id))],
              }))
            }
          >
            강사 전체를 한 조로
          </Button>
        </div>

        {groups.length === 0 ? (
          <div className="mt-4">
            <Empty>아직 로테이션 조가 없습니다. 같이 돌 강사끼리 한 조로 묶으세요.</Empty>
          </div>
        ) : (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {groups.map((g) => {
              const remaining = data.teachers.filter((t) => !g.teacherIds.includes(t.id));
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
                    <p className="py-2 text-sm text-tt-500">강사를 순서대로 넣으세요. 이 순서가 도는 순서입니다.</p>
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
        title={`회차 (${rounds.length}개)`}
        desc="한 회차가 로테이션 한 칸입니다. 0회차는 지금 짜 둔 기준 시간표 그대로입니다."
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-28">
            <Field label="시작 월">
              <TextInput
                type="number"
                min={1}
                max={12}
                value={startMonth}
                onChange={(e) => setStartMonth(Number(e.target.value) || 1)}
              />
            </Field>
          </div>
          <Button
            variant="primary"
            disabled={biggest < 2}
            title={biggest < 2 ? "먼저 2명 이상인 로테이션 조를 만드세요" : undefined}
            onClick={() => setRotation((r) => ({ ...r, rounds: monthRounds(startMonth, biggest) }))}
          >
            {startMonth}월부터 {biggest || "?"}개월치 만들기
          </Button>
          <Button
            onClick={() =>
              setRotation((r) => ({ ...r, rounds: [...r.rounds, newRound(`${r.rounds.length + 1}회차`, r.rounds.length)] }))
            }
          >
            + 회차 하나 추가
          </Button>
          {rounds.length > 0 && (
            <Button variant="danger" onClick={() => setRotation((r) => ({ ...r, rounds: [] }))}>
              회차 모두 지우기
            </Button>
          )}
        </div>

        {rounds.length > 0 && (
          <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {rounds.map((r) => (
              <li key={r.id} className="flex items-center gap-2 rounded-lg border border-tt-200 p-2">
                <TextInput
                  value={r.name}
                  placeholder="회차 이름"
                  onChange={(e) =>
                    setRotation((c) => ({
                      ...c,
                      rounds: c.rounds.map((x) => (x.id === r.id ? { ...x, name: e.target.value } : x)),
                    }))
                  }
                />
                <div className="w-24 shrink-0">
                  <Select
                    value={r.step}
                    onChange={(e) =>
                      setRotation((c) => ({
                        ...c,
                        rounds: c.rounds.map((x) =>
                          x.id === r.id ? { ...x, step: Number(e.target.value) } : x,
                        ),
                      }))
                    }
                  >
                    {Array.from({ length: Math.max(biggest, 1) }, (_, i) => (
                      <option key={i} value={i}>
                        {i}칸 이동
                      </option>
                    ))}
                  </Select>
                </div>
                <Button
                  variant="danger"
                  onClick={() =>
                    setRotation((c) => ({ ...c, rounds: c.rounds.filter((x) => x.id !== r.id) }))
                  }
                >
                  ×
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {groups.some((g) => g.teacherIds.length >= 2) && rounds.length > 0 && (
        <Card title="회차별 담당" desc="칸에 적힌 이름은 '누구의 기준 시간표를 맡는가'입니다.">
          <div className="flex flex-col gap-5">
            {groups
              .filter((g) => g.teacherIds.length >= 2)
              .map((g) => (
                <div key={g.id} className="overflow-x-auto">
                  <p className="mb-1 text-sm font-bold text-tt-700">{g.name || "(이름없는 조)"}</p>
                  <table className="border-collapse text-sm">
                    <thead>
                      <tr>
                        <th className="border border-tt-200 bg-tt-50 px-2 py-1 text-xs text-tt-600">회차</th>
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
                      {rounds.map((r) => {
                        const plan = rotationPlan(g, r.step);
                        return (
                          <tr key={r.id}>
                            <th className="border border-tt-200 bg-tt-50 px-2 py-1 text-left text-xs font-semibold text-tt-700">
                              {r.name}
                            </th>
                            {plan.map((p) => (
                              <td
                                key={p.teacherId}
                                className={`border border-tt-200 px-3 py-1.5 text-center ${
                                  p.sourceId === p.teacherId ? "bg-white text-tt-500" : "bg-tt-50 font-semibold text-tt-800"
                                }`}
                              >
                                {teacherName.get(p.sourceId) ?? "?"} 시간표
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ))}
          </div>
        </Card>
      )}
    </div>
  );
}
