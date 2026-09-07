/**
 * docs/manual.tex → public/manual.pdf
 *
 * Vercel 에는 TeX 이 없으므로 여기서 만들어 public/ 에 넣고 그 결과물을 커밋한다.
 * 목차 쪽수를 맞추려면 xelatex 을 두 번 돌려야 한다.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const docs = join(root, "docs");
const out = join(root, "public");

const run = (pass) => {
  process.stdout.write(`xelatex (${pass}/2) … `);
  try {
    execFileSync("xelatex", ["-interaction=nonstopmode", "-halt-on-error", "manual.tex"], {
      cwd: docs,
      stdio: "pipe",
    });
    console.log("ok");
  } catch (e) {
    console.error("실패\n");
    // xelatex 은 오류를 stdout 에 쏟는다. 실제 오류 줄만 추려 보여 준다.
    const log = String(e.stdout ?? "");
    const lines = log.split(/\r?\n/).filter((l) => /^(!|l\.\d)/.test(l));
    console.error(lines.length ? lines.join("\n") : log.slice(-2000));
    console.error("\n전체 기록: docs/manual.log");
    process.exit(1);
  }
};

try {
  execFileSync("xelatex", ["-version"], { stdio: "ignore" });
} catch {
  console.error(
    "xelatex 을 찾지 못했습니다. TeX Live 나 MiKTeX 을 설치하고 PATH 에 넣어 주세요.\n" +
      "설명서를 고치지 않는다면 이 명령은 돌릴 필요가 없습니다 — public/manual.pdf 가 이미 들어 있습니다.",
  );
  process.exit(1);
}

run(1);
run(2);

const pdf = join(docs, "manual.pdf");
if (!existsSync(pdf)) {
  console.error("manual.pdf 가 만들어지지 않았습니다.");
  process.exit(1);
}
mkdirSync(out, { recursive: true });
copyFileSync(pdf, join(out, "manual.pdf"));
console.log("public/manual.pdf 갱신 완료 — 커밋해야 배포에 반영됩니다.");
