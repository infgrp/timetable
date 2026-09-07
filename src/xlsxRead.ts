/**
 * 의존성 없는 최소 xlsx 리더 — `xlsx.ts` 작성기의 짝.
 *
 * xlsx 는 XML 몇 개를 담은 zip 이다. 압축을 푸는 일만 브라우저·Node 에 이미 있는
 * `DecompressionStream("deflate-raw")` 에 맡기면, 라이브러리 없이도 남이 만든 파일을 읽을 수 있다.
 * 시간표를 되살리는 데 필요한 것만 본다 — 셀 문자열과 셀 병합.
 */

export type Merge = { r1: number; c1: number; r2: number; c2: number };

export type ReadSheet = {
  name: string;
  /** rows[r][c] — 빈 칸은 "" */
  rows: string[][];
  merges: Merge[];
};

/** ── zip 풀기 ────────────────────────────────────────── */

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined")
    throw new Error(
      "이 브라우저는 엑셀 압축을 풀지 못합니다. 크롬·엣지·사파리 최신판에서 열거나, 엑셀에서 CSV로 저장해 올리세요.",
    );
  const stream = new Blob([data as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzip(buf: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const bytes = new Uint8Array(buf);
  const view = new DataView(buf);

  // End of Central Directory 를 뒤에서부터 찾는다 (주석 최대 64KB).
  let eocd = -1;
  const from = Math.max(0, bytes.length - 66_000);
  for (let i = bytes.length - 22; i >= from; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("엑셀 파일이 아니거나 손상되었습니다(zip 구조를 찾지 못함).");

  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder("utf-8");
  const out = new Map<string, Uint8Array>();

  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;

    // 로컬 헤더의 extra 길이는 중앙 목록과 다를 수 있으므로 여기서 다시 읽는다.
    const lNameLen = view.getUint16(localOffset + 26, true);
    const lExtraLen = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    const raw = bytes.subarray(start, start + compSize);

    if (method === 0) out.set(name, raw);
    else if (method === 8) out.set(name, await inflateRaw(raw));
    // 그 밖의 압축 방식은 엑셀이 쓰지 않는다 — 조용히 건너뛴다.
  }
  return out;
}

/** ── XML ─────────────────────────────────────────────── */

function unescapeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function attrsOf(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([\w:.-]+)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag))) out[m[1]] = unescapeXml(m[2]);
  return out;
}

/** 태그 안의 <t> 를 전부 이어 붙인다 (서식 조각으로 쪼개져 있어도 한 문자열로) */
function textOf(xml: string): string {
  let text = "";
  const re = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) text += unescapeXml(m[1]);
  return text;
}

function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  const re = /<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(textOf(m[1] ?? ""));
  return out;
}

/** "B12" → { r: 11, c: 1 } (0부터) */
function parseRef(ref: string): { r: number; c: number } | null {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) return null;
  let c = 0;
  for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64);
  return { r: Number(m[2]) - 1, c: c - 1 };
}

function parseSheetXml(xml: string, shared: string[]): { rows: string[][]; merges: Merge[] } {
  const rows: string[][] = [];
  const rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
  let rowSeq = -1;
  let rm: RegExpExecArray | null;

  while ((rm = rowRe.exec(xml))) {
    const rowAttrs = attrsOf(rm[1]);
    const r = rowAttrs.r ? Number(rowAttrs.r) - 1 : rowSeq + 1;
    rowSeq = r;
    const body = rm[2] ?? "";
    const cells: string[] = [];
    let colSeq = -1;

    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(body))) {
      const a = attrsOf(cm[1]);
      const inner = cm[2] ?? "";
      const pos = a.r ? parseRef(a.r) : null;
      const c = pos ? pos.c : colSeq + 1;
      colSeq = c;

      let text = "";
      if (a.t === "inlineStr") {
        text = textOf(inner);
      } else {
        const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner);
        const raw = v ? unescapeXml(v[1]) : "";
        if (a.t === "s") text = shared[Number(raw)] ?? "";
        else if (a.t === "b") text = raw === "1" ? "TRUE" : "FALSE";
        else text = raw;
      }
      while (cells.length < c) cells.push("");
      cells[c] = text;
    }
    while (rows.length < r) rows.push([]);
    rows[r] = cells;
  }

  const merges: Merge[] = [];
  const mergeRe = /<mergeCell\b[^>]*ref="([A-Z]+\d+):([A-Z]+\d+)"/g;
  let gm: RegExpExecArray | null;
  while ((gm = mergeRe.exec(xml))) {
    const a = parseRef(gm[1]);
    const b = parseRef(gm[2]);
    if (a && b) merges.push({ r1: a.r, c1: a.c, r2: b.r, c2: b.c });
  }

  return { rows, merges };
}

/** ── 통합문서 ────────────────────────────────────────── */

export async function readXlsx(buf: ArrayBuffer): Promise<ReadSheet[]> {
  const files = await unzip(buf);
  const decoder = new TextDecoder("utf-8");
  const text = (path: string) => {
    const bytes = files.get(path);
    return bytes ? decoder.decode(bytes) : "";
  };

  const workbook = text("xl/workbook.xml");
  if (!workbook) throw new Error("엑셀 통합문서(xl/workbook.xml)를 찾지 못했습니다.");

  // rId → 시트 경로
  const rels = new Map<string, string>();
  const relRe = /<Relationship\b([^>]*)\/>/g;
  let r: RegExpExecArray | null;
  while ((r = relRe.exec(text("xl/_rels/workbook.xml.rels")))) {
    const a = attrsOf(r[1]);
    if (a.Id && a.Target) rels.set(a.Id, a.Target.replace(/^\/?xl\//, "").replace(/^\.\//, ""));
  }

  const shared = parseSharedStrings(text("xl/sharedStrings.xml"));

  const out: ReadSheet[] = [];
  const sheetRe = /<sheet\b([^>]*)\/>/g;
  let s: RegExpExecArray | null;
  let fallbackIndex = 0;
  while ((s = sheetRe.exec(workbook))) {
    const a = attrsOf(s[1]);
    fallbackIndex += 1;
    const target = (a["r:id"] && rels.get(a["r:id"])) || `worksheets/sheet${fallbackIndex}.xml`;
    const xml = text(`xl/${target}`);
    if (!xml) continue;
    const parsed = parseSheetXml(xml, shared);
    out.push({ name: a.name ?? `시트${fallbackIndex}`, ...parsed });
  }

  if (out.length === 0) throw new Error("읽을 수 있는 시트가 없습니다.");
  return out;
}
