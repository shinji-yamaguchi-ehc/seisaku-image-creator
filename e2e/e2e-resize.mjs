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
  green: [22, 163, 74],
  blue: [37, 99, 235],
  yellow: [234, 179, 8],
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

function approx(a, b, tol = 2) {
  return Math.abs(a - b) <= tol;
}

const eq = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

async function readSlots(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("[data-slot]")].map((el) => ({
      i: Number(el.getAttribute("data-slot")),
      zoom: el.dataset.zoom === "" ? NaN : parseFloat(el.dataset.zoom),
      minZoom: el.dataset.minZoom === "" ? NaN : parseFloat(el.dataset.minZoom),
      left: el.dataset.left === "" ? NaN : parseInt(el.dataset.left, 10),
      top: el.dataset.top === "" ? NaN : parseInt(el.dataset.top, 10),
      gap: el.dataset.gap,
      badge: el.querySelector("[data-testid^='slot-zoom-badge']")?.textContent?.trim() ?? "",
    }))
  );
}

/** スロットの状態が条件を満たすまで待つ（アップロード反映などの競合対策） */
async function waitSlot(page, index, pred, timeout = 10000) {
  const start = Date.now();
  let latest;
  for (;;) {
    const slots = await readSlots(page);
    latest = slots;
    if (slots[index] && pred(slots[index])) return slots;
    if (Date.now() - start > timeout)
      throw new Error(`slot${index} の条件待ちがタイムアウト -> ${JSON.stringify(latest)}`);
    await page.waitForTimeout(50);
  }
}

async function px(page, x, y) {
  return page.evaluate(([x, y]) => {
    const c = document.querySelector('[data-testid="layout-preview"]');
    const s = c.width / c.clientWidth; // dpr 対応
    const d = c.getContext("2d").getImageData(Math.round(x * s), Math.round(y * s), 1, 1).data;
    return [d[0], d[1], d[2]];
  }, [x, y]);
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

/** DataTransfer によるスロットへのファイルドロップを再現する */
async function dropOnSlot(page, index, pngBuf) {
  await page.evaluate(
    ([idx, b64]) => {
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const dt = new DataTransfer();
      dt.items.add(new File([arr], "drop.png", { type: "image/png" }));
      const slot = document.querySelector(`[data-slot="${idx}"]`);
      slot.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
      slot.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
    },
    [index, pngBuf.toString("base64")]
  );
}

async function main() {
  // fixture images
  const files = [COLORS.red, COLORS.green, COLORS.blue, COLORS.yellow].map((c, i) => {
    const p = path.join(tmpDir, `img${i + 1}.png`);
    fs.writeFileSync(p, makePng(2400, 1600, c));
    return p;
  });
  const smallImg = path.join(tmpDir, "small.png");
  fs.writeFileSync(smallImg, makePng(300, 200, COLORS.yellow));

  // vite dev server
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
    // ---- A. 初回オーバーレイ ----
    console.log("\n[A] 初回ショートカットオーバーレイ");
    await page.goto(baseUrl);
    const overlay = page.locator('[data-testid="shortcuts-overlay"]');
    await overlay.waitFor({ state: "visible", timeout: 5000 });
    check("初回アクセスでオーバーレイ表示", await overlay.isVisible());
    await page.locator('[data-testid="shortcuts-close"]').click();
    check("閉じると消える", (await overlay.count()) === 0 || !(await overlay.isVisible()));
    await page.reload();
    await page.locator('[data-testid="layout-preview"]').waitFor();
    check("2回目以降は表示されない（localStorage）", (await page.locator('[data-testid="shortcuts-overlay"]').count()) === 0);

    // ---- B. デザインパターン切替 ----
    console.log("\n[B] デザインパターン選択（既定 D-1）");
    const widthInput = page.locator('[data-testid="canvas-width-input"]');
    const heightInput = page.locator('[data-testid="canvas-height-input"]');
    const emptyCount = () => page.locator('[data-testid^="slot-empty-"]').count();

    check("既定パターンは D-1 が選択", await page.locator('[data-testid="pattern-D-1"]').getAttribute("aria-pressed") === "true");
    check("既定キャンバス PC 960×600", (await widthInput.inputValue()) === "960" && (await heightInput.inputValue()) === "600");
    check("D-1 は4スロット", (await emptyCount()) === 4);

    await page.locator('[data-testid="pattern-C-2"]').click();
    await page.waitForTimeout(60);
    check("C-2 は3スロット（縦3分割）", (await emptyCount()) === 3);
    check("C-2 キャンバス PC 960×600", (await widthInput.inputValue()) === "960" && (await heightInput.inputValue()) === "600");

    await page.locator('[data-testid="pattern-A-1"]').click();
    await page.waitForTimeout(60);
    check("A-1 は1スロット（全面1枚）", (await emptyCount()) === 1);

    await page.locator('[data-testid="pattern-B-1"]').click();
    await page.waitForTimeout(60);
    check("B-1 は2スロット（縦2分割）", (await emptyCount()) === 2);

    await page.locator('[data-testid="pattern-B-2"]').click();
    await page.waitForTimeout(60);
    check("B-2 は2スロット（大＋小）", (await emptyCount()) === 2);

    // C-1: 右が大メイン＋左に上下2枚、境界は曲線
    await page.locator('[data-testid="pattern-C-1"]').click();
    await page.waitForTimeout(60);
    check("C-1 は3スロット（大＋縦2分割・曲線）", (await emptyCount()) === 3);
    check("C-1 キャンバス PC 960×600", (await widthInput.inputValue()) === "960" && (await heightInput.inputValue()) === "600");
    await page.getByRole("tab", { name: "SP版" }).click();
    await page.waitForTimeout(80);
    check("C-1 の SP は3スロット・640×380", (await emptyCount()) === 3 && (await widthInput.inputValue()) === "640" && (await heightInput.inputValue()) === "380");
    await page.getByRole("tab", { name: "PC版" }).click();
    await page.waitForTimeout(60);

    // B-2 選択 → SP は B-1 で出力
    await page.locator('[data-testid="pattern-B-2"]').click();
    await page.waitForTimeout(60);
    await page.getByRole("tab", { name: "SP版" }).click();
    await page.waitForTimeout(80);
    check("B-2 の SP は B-1 準拠（フォールバック注記）", await page.locator('[data-testid="sp-fallback-note"]').isVisible());
    await page.getByRole("tab", { name: "PC版" }).click();
    await page.waitForTimeout(60);

    // D-2 選択 → PC は D-2（4枠）、SP は D-1 で出力
    await page.locator('[data-testid="pattern-D-2"]').click();
    await page.waitForTimeout(60);
    check("D-2 は4スロット（PC）", (await emptyCount()) === 4);
    await page.getByRole("tab", { name: "SP版" }).click();
    await page.waitForTimeout(80);
    check("SP タブで D-2→D-1 のフォールバック注記が表示", await page.locator('[data-testid="sp-fallback-note"]').isVisible());
    check("D-2 の SP キャンバスは D-1 準拠 640×540", (await widthInput.inputValue()) === "640" && (await heightInput.inputValue()) === "540");
    check("D-2 の SP は4スロット（D-1 構成）", (await emptyCount()) === 4);

    // D-1 へ戻して以降の検証に使う
    await page.getByRole("tab", { name: "PC版" }).click();
    await page.waitForTimeout(60);
    await page.locator('[data-testid="pattern-D-1"]').click();
    await page.waitForTimeout(60);
    check("D-1 へ復帰（4スロット）", (await emptyCount()) === 4);

    // ---- C. アップロードと初期状態（PC D-1） ----
    console.log("\n[C] アップロードと初期状態（PC D-1: 上960×400＋下 320×200×3）");
    for (let i = 0; i < 4; i++) {
      const [fc] = await Promise.all([
        page.waitForEvent("filechooser"),
        page.locator(`[data-testid="slot-empty-${i}"]`).click(),
      ]);
      await fc.setFiles(files[i]);
    }
    await page.waitForFunction(() => document.querySelectorAll('[data-testid^="slot-zoom-badge"]').length === 4, undefined, { timeout: 10000 });
    let slots = await readSlots(page);
    check("4スロット表示", slots.length === 4, JSON.stringify(slots.length));
    check(
      "slot0（上段）100%・中央寄せ -720,-600",
      slots[0].badge.includes("100%") && slots[0].left === -720 && slots[0].top === -600,
      JSON.stringify(slots[0])
    );
    check(
      "slot1〜3（下段）100%・中央寄せ -1040,-700",
      slots.slice(1).every((s) => s.badge.includes("100%") && s.left === -1040 && s.top === -700),
      JSON.stringify(slots.slice(1))
    );
    check("minZoom 下限は 5%", slots.every((s) => approx(s.minZoom, 0.05, 0.001)));
    check("余白なし", slots.every((s) => s.gap === "0"));

    // ---- D. プレビュー描画ピクセル（PC D-1） ----
    console.log("\n[D] プレビューcanvasの色検証");
    check("slot0=赤", eq(await px(page, 480, 120), COLORS.red));
    check("slot1=緑", eq(await px(page, 160, 500), COLORS.green));
    check("slot2=青", eq(await px(page, 480, 500), COLORS.blue));
    check("slot3=黄", eq(await px(page, 800, 500), COLORS.yellow));

    // ---- E. キーボード・調整パネル ----
    console.log("\n[E] キーボード・数値入力パネル");
    const slot0 = page.locator('[data-slot="0"]');
    await slot0.focus();
    await page.keyboard.press("Control+0");
    slots = await waitSlot(page, 0, (s) => s.badge.includes("40%"));
    check("Ctrl+0 → フィット 40%・上段（0,-120）", slots[0].left === 0 && slots[0].top === -120, JSON.stringify(slots[0]));
    await page.keyboard.press("Control+1");
    slots = await waitSlot(page, 0, (s) => s.badge.includes("100%") && s.left === -720);
    check("Ctrl+1 → 100% に復帰", slots[0].top === -600, JSON.stringify(slots[0]));
    await page.keyboard.press("ArrowUp");
    slots = await waitSlot(page, 0, (s) => s.top === -601);
    check("↑ で1px 上移動", slots[0].left === -720, JSON.stringify(slots[0]));

    // slot1 の調整パネル（数値入力）
    await page.locator('[data-testid="slot-zoom-badge-1"]').click();
    const panel = page.locator('[data-testid="slot-panel-1"]');
    await panel.waitFor({ state: "visible" });
    check("パネルが開く", await panel.isVisible());
    await page.locator('[data-testid="slot-input-zoom-1"]').fill("80");
    await page.waitForTimeout(50);
    slots = await readSlots(page);
    check("ズーム80% を入力反映", slots[1].badge.includes("80%"), JSON.stringify(slots[1]));
    await page.locator('[data-testid="slot-input-left-1"]').fill("0");
    await page.locator('[data-testid="slot-input-top-1"]').fill("-100");
    await page.waitForTimeout(50);
    slots = await readSlots(page);
    check("オフセット入力を反映（0,-100）", slots[1].left === 0 && slots[1].top === -100, JSON.stringify(slots[1]));
    // 既定へ戻す（以降のエクスポート検証用）
    await page.locator('[data-testid="slot-input-zoom-1"]').fill("100");
    await page.locator('[data-testid="slot-input-left-1"]').fill("-1040");
    await page.locator('[data-testid="slot-input-top-1"]').fill("-700");
    await page.waitForTimeout(50);
    slots = await waitSlot(page, 1, (s) => s.badge.includes("100%") && s.left === -1040 && s.top === -700);
    check("slot1 を既定へ復帰", slots[1].badge.includes("100%"));
    await page.locator('[data-testid="slot-zoom-badge-1"]').click();

    // ---- F. PC/SP 独立性とエクスポート（D-1） ----
    console.log("\n[F] PC/SP 独立性＆エクスポート");
    // PC で slot0 をフィットに変更
    await slot0.focus();
    await page.keyboard.press("Control+0");
    await waitSlot(page, 0, (s) => s.badge.includes("40%"));

    await page.getByRole("tab", { name: "SP版" }).click();
    await page.waitForTimeout(80);
    slots = await readSlots(page);
    check("SP 側は初期値のまま（独立）", slots[0].badge.includes("100%") && slots[0].left === -880 && slots[0].top === -610, JSON.stringify(slots[0]));
    await page.getByRole("tab", { name: "PC版" }).click();
    await page.waitForTimeout(80);
    slots = await readSlots(page);
    check("PC 側の調整結果は保持される（40%）", slots[0].badge.includes("40%") && slots[0].top === -120, JSON.stringify(slots[0]));

    async function downloadAndSave(trigger, filename) {
      const [dl] = await Promise.all([page.waitForEvent("download"), trigger()]);
      const p = path.join(tmpDir, filename);
      await dl.saveAs(p);
      return p;
    }
    await page.getByRole("button", { name: "エクスポート" }).click();
    await page.locator('img[src^="data:image/png"]').first().waitFor({ state: "visible" });
    check("プレビューが2枚生成される", (await page.locator('img[src^="data:image/png"]').count()) === 2);

    // 書き出し形式（既定 JPG）→ PNG に切り替えてピクセル検証
    check("書き出し形式の既定は JPG", (await page.locator('[data-testid="format-jpg"]').getAttribute("aria-pressed")) === "true");
    const [jpgDl] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "PC版をダウンロード" }).click(),
    ]);
    check("JPG 選択時は output_pc.jpg で保存", jpgDl.suggestedFilename() === "output_pc.jpg", jpgDl.suggestedFilename());
    await page.locator('[data-testid="format-png"]').click();

    const pcPath = await downloadAndSave(() => page.getByRole("button", { name: "PC版をダウンロード" }).click(), "output_pc.png");
    const spPath = await downloadAndSave(() => page.getByRole("button", { name: "SP版をダウンロード" }).click(), "output_sp.png");

    const pcBuf = fs.readFileSync(pcPath);
    const spBuf = fs.readFileSync(spPath);
    check("PC版 960×600", JSON.stringify(pngSize(pcBuf)) === '{"width":960,"height":600}', JSON.stringify(pngSize(pcBuf)));
    check("SP版 640×540", JSON.stringify(pngSize(spBuf)) === '{"width":640,"height":540}', JSON.stringify(pngSize(spBuf)));

    const pcSamples = await samplePngPoints(page, pcBuf, [
      ["s0", 480, 150],
      ["s1", 160, 500],
      ["s2", 480, 500],
      ["s3", 800, 500],
    ]);
    check("PC版 slot0=赤（フィットでも全域）", eq(pcSamples["s0"], COLORS.red), JSON.stringify(pcSamples));
    check("PC版 slot1=緑", eq(pcSamples["s1"], COLORS.green));
    check("PC版 slot2=青", eq(pcSamples["s2"], COLORS.blue));
    check("PC版 slot3=黄", eq(pcSamples["s3"], COLORS.yellow));

    const spSamples = await samplePngPoints(page, spBuf, [
      ["s0", 320, 150],
      ["s1", 100, 460],
      ["s2", 320, 460],
      ["s3", 533, 460],
    ]);
    check("SP版 slot0=赤", eq(spSamples["s0"], COLORS.red), JSON.stringify(spSamples));
    check("SP版 slot1=緑", eq(spSamples["s1"], COLORS.green));
    check("SP版 slot2=青", eq(spSamples["s2"], COLORS.blue));
    check("SP版 slot3=黄", eq(spSamples["s3"], COLORS.yellow));
    await page.keyboard.press("Escape"); // ダイアログを閉じる
    // ダイアログが完全に離脱するまで待つ
    await page.locator('[role="dialog"]').waitFor({ state: "detached", timeout: 5000 });

    // ---- G. スロット操作（削除・再追加・小さい画像の警告） ----
    console.log("\n[G] スロット直接操作（削除／再追加／小さい画像の警告）");
    await page.getByRole("tab", { name: "PC版" }).click();
    await page.waitForTimeout(60);
    // PC slot0 を 100% に戻しておく
    await slot0.focus();
    await page.keyboard.press("Control+1");
    await waitSlot(page, 0, (s) => s.badge.includes("100%"));

    await page.locator('[data-slot="1"]').hover();
    await page.locator('[data-testid="slot-remove-1"]').click();
    slots = await waitSlot(page, 1, (s) => Number.isNaN(s.zoom));
    check("削除ボタンでスロット1が空に戻る", (await page.locator('[data-testid^="slot-zoom-badge"]').count()) === 3 && (await page.locator('[data-testid="slot-empty-1"]').isVisible()));

    const [fc1] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.locator('[data-testid="slot-empty-1"]').click(),
    ]);
    await fc1.setFiles(files[1]);
    slots = await waitSlot(page, 1, (s) => s.badge.includes("100%") && s.left === -1040);
    check("空きスロットのクリックで再追加", (await page.locator('[data-testid="slot-empty-1"]').count()) === 0 && slots[1].badge.includes("100%"), JSON.stringify(slots[1]));

    // slot3 を小さい画像に差し替え → 余白警告
    await page.locator('[data-slot="3"]').hover();
    const [fcN] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.locator('[data-testid="slot-replace-3"]').click(),
    ]);
    await fcN.setFiles(smallImg);
    slots = await waitSlot(page, 3, (s) => s.gap === "1");
    check("小さい画像で余白警告（zoom=1 固定・10,0）", slots[3].badge.includes("100%") && slots[3].left === 10 && slots[3].top === 0 && (await page.locator('[data-testid="slot-gap-warning-3"]').isVisible()), JSON.stringify(slots[3]));
    // ドロップで元の黄画像に戻す
    await dropOnSlot(page, 3, fs.readFileSync(files[3]));
    slots = await waitSlot(page, 3, (s) => s.gap === "0" && s.badge.includes("100%"));
    check("ドロップで画像ありスロットへ上書き（警告消滅）", slots[3].left === -1040 && slots[3].top === -700, JSON.stringify(slots[3]));

    // ---- H. キャンバスサイズの数値変更（比率追従） ----
    console.log("\n[H] キャンバス幅・高さの数値変更");
    await widthInput.fill("1000");
    await page.waitForTimeout(60);
    check("幅 1000 へ変更", (await widthInput.inputValue()) === "1000");
    const box0 = await page.locator('[data-slot="0"]').boundingBox();
    check("上段スロット幅が約1000px に追従", box0 && approx(box0.width, 1000, 2), JSON.stringify(box0));
    await widthInput.fill("960");
    await page.waitForTimeout(60);
    await heightInput.fill("700");
    await page.waitForTimeout(60);
    check("高さ 700 へ変更", (await heightInput.inputValue()) === "700");
    const box0b = await page.locator('[data-slot="0"]').boundingBox();
    check("上段スロット高さが約467px に追従", box0b && approx(box0b.height, 467, 3), JSON.stringify(box0b));
    await heightInput.fill("600");
    await page.waitForTimeout(60);
    check("600 に復帰", (await heightInput.inputValue()) === "600");

    // ---- I. C-1 の円弧境界（プレビュー＆最終出力へ反映） ----
    console.log("\n[I] C-1 円弧境界の検証（プレビュー／エクスポート）");
    await page.locator('[data-testid="pattern-C-1"]').click();
    await page.waitForTimeout(80);
    // slot0=赤(左上) / slot1=緑(右大) / slot2=青(左下)
    // 直線境界なら x=320。曲線は中央で左（x≈253）へ膨らむ。
    check("プレビュー: 上端は境界付近で赤→緑（直線側 x≈320）", eq(await px(page, 270, 60), COLORS.red) && eq(await px(page, 320, 60), COLORS.green));
    check("プレビュー: 中央で大画像が左へ膨らむ（x=290 が緑）", eq(await px(page, 290, 290), COLORS.green), JSON.stringify(await px(page, 290, 290)));
    check("プレビュー: 中央のサブ画像側は赤（x=230）", eq(await px(page, 230, 290), COLORS.red));

    const c1Path = await downloadAndSave(async () => {
      await page.getByRole("button", { name: "エクスポート" }).click();
      await page.locator('img[src^="data:image/png"]').first().waitFor({ state: "visible" });
      await page.getByRole("button", { name: "PC版をダウンロード" }).click();
    }, "output_pc_c1.png");
    const c1Buf = fs.readFileSync(c1Path);
    check("C-1 PC版 960×600", JSON.stringify(pngSize(c1Buf)) === '{"width":960,"height":600}', JSON.stringify(pngSize(c1Buf)));
    const c1 = await samplePngPoints(page, c1Buf, [
      ["top-left", 270, 60],
      ["top-right", 320, 60],
      ["upper-left", 225, 160],
      ["upper-right", 300, 160],
      ["mid-left", 230, 290],
      ["mid-right", 290, 290],
      ["low-left", 230, 310],
      ["low-right", 290, 310],
      ["bottom-left", 270, 540],
      ["bottom-right", 320, 540],
    ]);
    check(
      "出力: 上端は赤→緑（境界 x≈320）",
      eq(c1["top-left"], COLORS.red) && eq(c1["top-right"], COLORS.green),
      JSON.stringify(c1)
    );
    check(
      "出力: 中央で大画像が左へ膨らむ（x=290 が緑・x=230 が赤）",
      eq(c1["mid-right"], COLORS.green) && eq(c1["mid-left"], COLORS.red),
      JSON.stringify(c1)
    );
    check(
      "出力: 上下のサブ画像（赤/青）と大画像（緑）が曲線で分割",
      eq(c1["upper-left"], COLORS.red) &&
        eq(c1["upper-right"], COLORS.green) &&
        eq(c1["low-left"], COLORS.blue) &&
        eq(c1["low-right"], COLORS.green) &&
        eq(c1["bottom-left"], COLORS.blue) &&
        eq(c1["bottom-right"], COLORS.green),
      JSON.stringify(c1)
    );
    await page.keyboard.press("Escape");
    await page.locator('[role="dialog"]').waitFor({ state: "detached", timeout: 5000 });
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
