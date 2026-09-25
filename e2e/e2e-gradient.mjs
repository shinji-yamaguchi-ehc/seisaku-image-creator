import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import { makePng, pngSize } from "./helpers/png.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmpDir = path.join(process.env.TEMP || "/tmp", "opencode", "seisaku-e2e");
fs.mkdirSync(tmpDir, { recursive: true });

const COLORS = {
  red: [220, 38, 38],
  yellow: [234, 179, 8],
  navy: [30, 58, 138],
};

let passed = 0;
let failed = 0;

function check(name, cond, detail = "") {
  if (cond) {
    passed++;
    console.log(`  PASS ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ` -> ${detail}` : ""}`);
  }
}

const isRedish = (a) => a[0] > 180 && a[1] < 110;
const isWhitesh = (a) => a[0] > 200 && a[1] > 200 && a[2] > 200;

async function readGradient(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-slot="gradient"]');
    if (!el) return null;
    return {
      zoom: el.dataset.zoom === "" ? NaN : parseFloat(el.dataset.zoom),
      left: el.dataset.left === "" ? NaN : parseInt(el.dataset.left, 10),
      top: el.dataset.top === "" ? NaN : parseInt(el.dataset.top, 10),
      gap: el.dataset.gap,
      badge: document.querySelector('[data-testid="gradient-zoom-badge"]')?.textContent?.trim() ?? "",
    };
  });
}

/** グラデーションスロットの状態が条件を満たすまで待つ（デコード・再描画の競合対策） */
async function waitGradient(page, pred, timeout = 10000) {
  const start = Date.now();
  for (;;) {
    const s = await readGradient(page);
    if (s && pred(s)) return s;
    if (Date.now() - start > timeout) throw new Error(`gradient の条件待ちがタイムアウト: ${JSON.stringify(s)}`);
    await page.waitForTimeout(50);
  }
}

/** プレビューのピクセルが条件を満たすまで待つ */
async function waitPx(page, x, y, pred, timeout = 5000) {
  const start = Date.now();
  for (;;) {
    const c = await pxG(page, x, y);
    if (pred(c)) return c;
    if (Date.now() - start > timeout) throw new Error(`ピクセル条件待ちタイムアウト (${x},${y}): ${JSON.stringify(c)}`);
    await page.waitForTimeout(50);
  }
}

async function pxG(page, x, y) {
  return page.evaluate(([x, y]) => {
    const c = document.querySelector('[data-testid="gradient-preview"]');
    const s = c.width / c.clientWidth; // dpr 対応
    const d = c.getContext("2d").getImageData(Math.round(x * s), Math.round(y * s), 1, 1).data;
    return [d[0], d[1], d[2]];
  }, [x, y]);
}

async function cfgVals(page) {
  return [
    await page.locator('[data-testid="gradient-cfg-width"]').inputValue(),
    await page.locator('[data-testid="gradient-cfg-height"]').inputValue(),
  ];
}

async function uploadViaFilechooser(page, trigger, file) {
  const [fc] = await Promise.all([page.waitForEvent("filechooser"), trigger()]);
  await fc.setFiles(file);
}

async function samplePngPoints(page, buf, points) {
  await page.evaluate(async (b) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext("2d").drawImage(img, 0, 0);
    window.__sampleCanvas = c;
  }, buf.toString("base64"));
  const out = {};
  for (const [name, x, y] of points) {
    out[name] = await page.evaluate(
      ([px, py]) => {
        const d = window.__sampleCanvas.getContext("2d").getImageData(px, py, 1, 1).data;
        return [d[0], d[1], d[2]];
      },
      [x, y]
    );
  }
  return out;
}

async function main() {
  const redImg = path.join(tmpDir, "grad_red.png");
  fs.writeFileSync(redImg, makePng(2400, 1600, COLORS.red));
  const smallImg = path.join(tmpDir, "grad_small.png");
  fs.writeFileSync(smallImg, makePng(300, 200, COLORS.yellow));

  const server = await createServer({
    root,
    configFile: path.join(root, "vite.config.ts"),
    server: { port: 0, strictPort: true },
    logLevel: "error",
  });
  await server.listen();
  const baseUrl = server.resolvedUrls.local[0];
  console.log(`vite: ${baseUrl}`);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 1800 } });

  try {
    // ---- A. ナビ ----
    console.log("\n[A] ナビゲーション");
    await page.goto(baseUrl);
    const overlay = page.locator('[data-testid="shortcuts-overlay"]');
    if (await overlay.isVisible().catch(() => false)) {
      await page.locator('[data-testid="shortcuts-close"]').click();
    }
    await page.locator('[data-testid="nav-gradient"]').click();
    await page.waitForURL((u) => u.hash === "#/gradient");
    check("/gradient へ遷移する", page.url().includes("#/gradient"));
    check(
      "キャンバス設定の既定値は 960×345",
      JSON.stringify(await cfgVals(page)) === JSON.stringify(["960", "345"]),
      JSON.stringify(await cfgVals(page))
    );

    // ---- B. グラデ方向の固定とデフォルト位置 ----
    console.log("\n[B] 方向固定＆デフォルト位置（PC=右45/70、SP=左右20/30）");
    check("向き固定の説明が表示される（PC）", await page.locator('[data-testid="gradient-direction-fixed"]').isVisible());
    check(
      "PC デフォルト: 開始45%／終了70%",
      (await page.locator('[data-testid="gradient-start-pos-input"]').inputValue()) === "45" &&
        (await page.locator('[data-testid="gradient-end-pos-input"]').inputValue()) === "70"
    );
    await page.getByRole("tab", { name: "SP版" }).click();
    await page.waitForTimeout(80);
    check(
      "SP キャンバスも 960×345",
      JSON.stringify(await cfgVals(page)) === JSON.stringify(["960", "345"]),
      JSON.stringify(await cfgVals(page))
    );
    check(
      "SP デフォルト: 開始20%／終了30%",
      (await page.locator('[data-testid="gradient-start-pos-input"]').inputValue()) === "20" &&
        (await page.locator('[data-testid="gradient-end-pos-input"]').inputValue()) === "30"
    );
    await page.getByRole("tab", { name: "PC版" }).click();
    await page.waitForTimeout(80);

    // ---- C. アップロード（小さい画像 → 赤に差し替え） ----
    console.log("\n[C] アップロード・差し替え");
    await uploadViaFilechooser(
      page,
      () => page.locator('[data-testid="gradient-empty"]').click(),
      smallImg
    );
    let g = await waitGradient(page, (s) => s.badge.includes("100%") && s.left === 330 && s.top === 73);
    check("小さい画像を直接アップロード（100%・330,73）", g.badge.includes("100%") && g.left === 330 && g.top === 73, JSON.stringify(g));
    check("余白警告バッジ表示", g.gap === "1" && (await page.locator('[data-testid="gradient-gap-warning"]').isVisible()));

    await page.locator('[data-testid="gradient-slot"]').hover();
    const [fc] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.locator('[data-testid="gradient-replace"]').click(),
    ]);
    await fc.setFiles(redImg);
    g = await waitGradient(page, (s) => s.left === -720 && s.top === -627);
    check("差し替えで transform リセット（100%・-720,-627）", g.badge.includes("100%") && g.gap === "0", JSON.stringify(g));
    check("余白警告は消える", !(await page.locator('[data-testid="gradient-gap-warning"]').isVisible().catch(() => false)));

    // ---- D. 移動・ズーム ----
    console.log("\n[D] 移動・ズーム");
    await page.locator('[data-slot="gradient"]').focus();
    await page.keyboard.press("Control+0");
    g = await waitGradient(page, (s) => s.badge.includes("40%"));
    check("Ctrl+0 フィット（40%・0,-147）", g.left === 0 && g.top === -147, JSON.stringify(g));

    const box = await page.locator('[data-slot="gradient"]').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -120);
    g = await waitGradient(page, (s) => s.badge.includes("42%"));
    check("ホイールズームイン → 42%（-24,-163）", g.left === -24 && g.top === -163, JSON.stringify(g));

    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2 + 10, { steps: 4 });
    await page.mouse.up();
    g = await waitGradient(page, (s) => s.left === -4 && s.top === -153);
    check("ドラッグ移動（+20,+10 → -4,-153）", g.left === -4 && g.top === -153, JSON.stringify(g));
    await page.keyboard.press("Shift+ArrowDown");
    g = await waitGradient(page, (s) => s.top === -143);
    check("Shift+↓ ナッジ（top=-143）", g.top === -143, JSON.stringify(g));

    await page.locator('[data-slot="gradient"]').focus();
    await page.keyboard.press("Control+0");
    g = await waitGradient(page, (s) => s.badge.includes("40%") && s.left === 0 && s.top === -147);
    check("Ctrl+0 でフィットに戻る", g.badge.includes("40%") && g.left === 0 && g.top === -147, JSON.stringify(g));

    // ---- E. PC 既定（右フェード 45→70%）の描画 ----
    console.log("\n[E] PC 右フェード描画（既定: 開始45%／終了70%）");
    const Y = 170;
    await waitPx(page, 940, Y, (c) => isWhitesh(c)); // 右端は白フェード帯
    check("右端は白っぽい（フェード適用）", isWhitesh(await pxG(page, 940, Y)));
    const leftEdge = await pxG(page, 60, Y);
    check("左端は素の赤（70% より内側は無色）", isRedish(leftEdge), JSON.stringify(leftEdge));
    // 右から左へ走査し、白フェードが「ほぼ白」でなくなり始める位置が
    // 開始位置 45%（x≈528）付近であること（色は徐々に赤へ減衰する）
    const fadeStart = await page.evaluate((y) => {
      const c = document.querySelector('[data-testid="gradient-preview"]');
      const s = c.width / c.clientWidth;
      const ctx = c.getContext("2d");
      for (let x = 940; x > 300; x--) {
        const d = ctx.getImageData(Math.round(x * s), Math.round(y * s), 1, 1).data;
        if (d[0] < 254) return x;
      }
      return -1;
    }, Y);
    check("フェード開始位置が約45%（x≈528 から減衰）", fadeStart > 470 && fadeStart < 570, `fadeStart=${fadeStart}`);

    // ---- F. SP 既定（左右フェード 20→30%）の描画 ----
    console.log("\n[F] SP 左右フェード描画（既定: 開始20%／終了30%）");
    await page.getByRole("tab", { name: "SP版" }).click();
    await page.waitForTimeout(80);
    await waitPx(page, 20, Y, (c) => isWhitesh(c));
    check("SP 左端は白っぽい（左右フェードの左側）", isWhitesh(await pxG(page, 20, Y)));
    await waitPx(page, 940, Y, (c) => isWhitesh(c));
    check("SP 右端は白っぽい（左右フェードの右側）", isWhitesh(await pxG(page, 940, Y)));
    const spCenter = await pxG(page, 480, Y);
    const spMidLeft = await pxG(page, 380, Y);
    check("SP 中央は素の赤", isRedish(spCenter), JSON.stringify(spCenter));
    check("SP フェード内側端（20〜30%境界付近）は赤系", isRedish(spMidLeft), JSON.stringify(spMidLeft));

    // ---- G. 色変更とエクスポート（PC: 右ネイビー） ----
    console.log("\n[G] 色変更＆エクスポート（PC 右フェード）");
    await page.getByRole("tab", { name: "PC版" }).click();
    await page.waitForTimeout(80);
    await page.locator('[data-testid="gradient-color-hex"]').fill("#1e3a8a");
    await page.locator('[data-testid="gradient-color-hex"]').press("Enter");
    const navyRight = await waitPx(page, 940, Y, (c) => c[2] > 100);
    check("色変更が反映（右端はネイビー帯）", navyRight[0] < 150 && navyRight[2] > 100, JSON.stringify(navyRight));

    const alphaThumb = page.locator('[data-testid="gradient-start-alpha"] [role="slider"]');
    await alphaThumb.focus();
    await page.keyboard.press("End");
    await waitPx(page, 940, Y, (c) => c[2] > 120);

    async function downloadAndSave(trigger, filename) {
      const [dl] = await Promise.all([page.waitForEvent("download"), trigger()]);
      const p = path.join(tmpDir, filename);
      await dl.saveAs(p);
      return p;
    }
    await page.getByRole("button", { name: "エクスポート" }).click();
    await page.locator('img[src^="data:image/png"]').first().waitFor({ state: "visible" });
    // 書き出し形式（既定 JPG）→ PNG に切り替えてピクセル検証
    check("書き出し形式の既定は JPG", (await page.locator('[data-testid="format-jpg"]').getAttribute("aria-pressed")) === "true");
    const [jpgDl] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "PC版をダウンロード" }).click(),
    ]);
    check("JPG 選択時は gradient_pc.jpg で保存", jpgDl.suggestedFilename() === "gradient_pc.jpg", jpgDl.suggestedFilename());
    await page.locator('[data-testid="format-png"]').click();
    await downloadAndSave(
      () => page.getByRole("button", { name: "PC版をダウンロード" }).click(),
      "gradient_pc.png"
    );

    const buf = fs.readFileSync(path.join(tmpDir, "gradient_pc.png"));
    check("出力サイズ 960×345", JSON.stringify(pngSize(buf)) === '{"width":960,"height":345}', JSON.stringify(pngSize(buf)));
    const samples = await samplePngPoints(page, buf, [
      ["right-dark", 940, 170],
      ["left-red", 60, 170],
    ]);
    check("出力でも右ネイビー・左は赤", samples["right-dark"][2] > 120 && isRedish(samples["left-red"]), JSON.stringify(samples));
    await page.keyboard.press("Escape");
    // ダイアログが完全に離脱するまで待つ（閉じアニメーション中はオーバーレイがポインタを奪う）
    await page.locator('[role="dialog"]').waitFor({ state: "detached", timeout: 5000 });

    // ---- H. サイズハンドル・数値変更 ----
    console.log("\n[H] サイズ変更");
    const wHandle = await page.locator('[data-testid="gradient-edge-handle-e"]').boundingBox();
    const wStartX = wHandle.x + wHandle.width / 2 - 2;
    const wMidY = wHandle.y + wHandle.height / 2;
    await page.mouse.move(wStartX, wMidY);
    await page.mouse.down();
    await page.mouse.move(wStartX + 64, wMidY, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(80);
    check("右端ドラッグ+64 → 幅1024", (await cfgVals(page))[0] === "1024", JSON.stringify(await cfgVals(page)));

    const hHandle = await page.locator('[data-testid="gradient-height-handle"]').boundingBox();
    const hStartY = hHandle.y + hHandle.height / 2 - 2;
    const hMidX = hHandle.x + hHandle.width / 2;
    await page.mouse.move(hMidX, hStartY);
    await page.mouse.down();
    await page.mouse.move(hMidX, hStartY + 40, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(80);
    check("下端ドラッグ+40 → 高さ385", JSON.stringify(await cfgVals(page)) === JSON.stringify(["1024", "385"]), JSON.stringify(await cfgVals(page)));

    await page.locator('[data-testid="gradient-cfg-width"]').fill("960");
    await page.locator('[data-testid="gradient-cfg-height"]').fill("345");
    await page.waitForTimeout(60);
    check("数値入力で 960×345 に復帰", JSON.stringify(await cfgVals(page)) === JSON.stringify(["960", "345"]), JSON.stringify(await cfgVals(page)));

    // ---- I. レイアウトページへの復帰 ----
    console.log("\n[I] レイアウトページへの復帰");
    await page.locator('[data-testid="nav-layout"]').click();
    await page.waitForURL((u) => u.hash === "" || u.hash === "#/");
    await page.locator('[data-testid="layout-preview"]').waitFor({ state: "visible" });
    check("ナビでレイアウトページに戻る", await page.locator('[data-testid="layout-preview"]').isVisible());
  } finally {
    await browser.close();
    await server.close();
  }

  console.log(`\n===== 結果: ${passed} passed, ${failed} failed =====`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
