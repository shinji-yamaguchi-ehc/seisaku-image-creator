// e2e テストを並列実行するランナー
// 各テストは Vite dev サーバーをポート0（ランダム空きポート）で起動し、
// 一時ファイルのファイル名も重複しないため同時実行可能。
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));

const jobs = [
  { name: "resize", file: "e2e-resize.mjs" },
  { name: "gradient", file: "e2e-gradient.mjs" },
];

function pipe(stream, name) {
  let buf = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buf += chunk;
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() ?? "";
    for (const line of lines) console.log(`[${name}] ${line}`);
  });
  return new Promise((resolve) =>
    stream.on("end", () => {
      if (buf) console.log(`[${name}] ${buf}`);
      resolve();
    })
  );
}

const results = await Promise.all(
  jobs.map(
    ({ name, file }) =>
      new Promise((resolve) => {
        const child = spawn(process.execPath, [path.join(dir, file)], {
          stdio: ["ignore", "pipe", "pipe"],
        });
        const outDone = pipe(child.stdout, name);
        const errDone = pipe(child.stderr, name);
        child.on("close", async (code) => {
          await outDone;
          await errDone;
          resolve({ name, code });
        });
      })
  )
);

console.log("\n===== 並列実行サマリ =====");
for (const { name, code } of results) {
  console.log(`${name}: ${code === 0 ? "PASS" : `FAIL (exit=${code})`}`);
}
process.exit(results.some((r) => r.code !== 0) ? 1 : 0);
