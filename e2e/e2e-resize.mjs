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
const isWhite = (a) => a[0] === 255 && a[1] === 255 && a[2] === 255;
const isRedish = (a) => a[0] > 180 && a[1] < 110;

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

/** プレビュー canvas の指定列で「赤→緑」に変わる y 座標を探す */
async function findRowBoundary(page, x, yFrom, yTo) {
  return page.evaluate(([x, y0, y1]) => {
    const c = document.querySelector('[data-testid="layout-preview"]');
    const s = c.width / c.clientWidth;
    const ctx = c.getContext("2d");
    for (let y = y0; y < y1; y++) {
      const d = ctx.getImageData(Math.round(x * s), Math.round(y * s), 1, 1).data;
      if (d[1] > d[0]) return y;
    }
    return -1;
  }, [x, yFrom, yTo]);
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
  const wideImg = path.join(tmpDir, "wide.png");
  fs.writeFileSync(wideImg, makePng(4000, 1000, COLORS.red));
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

    // ---- B. アップロード ----
    console.log("\n[B] アップロードと初期状態");
    const inputs = (i) => page.locator(`[data-testid="uploader-input-${i}"]`);
    for (let i = 0; i < 4; i++) await inputs(i).setInputFiles(files[i]);
    // 画像デコード完了（調整バッジ＝画像ありの証）を待つ
    await page.waitForFunction(() => document.querySelectorAll('[data-testid^="slot-zoom-badge"]').length === 4, undefined, { timeout: 10000 });
    let slots = await readSlots(page);
    check("4スロット表示", slots.length === 4, JSON.stringify(slots.length));
    check(
      "初期状態: 100%・中央寄せ（s0=-720,-638 / s1..3=-1040,-692・出力px基準）",
      slots[0].badge.includes("100%") && slots[0].left === -720 && slots[0].top === -638 &&
        slots.slice(1).every((s) => s.badge.includes("100%") && s.left === -1040 && s.top === -692),
      JSON.stringify(slots)
    );
    check("minZoom 下限は 5%（両ツール共通）",
      slots.every((s) => approx(s.minZoom, 0.05, 0.001)),
      JSON.stringify(slots.map((s) => s.minZoom)));
    check("余白なし", slots.every((s) => s.gap === "0"));

    // ---- C. プレビュー描画ピクセル ----
    console.log("\n[C] プレビューcanvasの色検証（WYSIWYG基盤）");
    check("slot0=赤", eq(await px(page, 480, 162), COLORS.red), JSON.stringify(await px(page, 480, 162)));
    check("slot1=緑", eq(await px(page, 160, 432), COLORS.green));
    check("slot2=青", eq(await px(page, 480, 432), COLORS.blue));
    check("slot3=黄", eq(await px(page, 800, 432), COLORS.yellow));

    // ---- D. ホイールズーム（カーソルアンカー） ----
    console.log("\n[D] ホイールズーム slot1");
    const box1 = await page.locator('[data-slot="1"]').boundingBox();
    await page.mouse.move(box1.x + box1.width / 2, box1.y + box1.height / 2);
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(80);
    slots = await readSlots(page);
    check(
      "ズームアウト → 95%・中央維持（-983,-654）",
      slots[1].badge.includes("95%") && slots[1].left === -983 && slots[1].top === -654,
      JSON.stringify(slots[1])
    );
    await page.mouse.wheel(0, -120);
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(80);
    slots = await readSlots(page);
    check("ズームインは100%でクランプ", slots[1].badge.includes("100%") && slots[1].left === -1040 && slots[1].top === -692, JSON.stringify(slots[1]));

    // ---- E. キーボード操作 slot0 ----
    console.log("\n[E] キーボード操作 slot0");
    const slot0 = page.locator('[data-slot="0"]');
    await slot0.focus();
    for (let i = 0; i < 70; i++) await page.keyboard.press("-");
    slots = await waitSlot(page, 0, (s) => s.badge.includes("5%"));
    check(
      "- 連打で下限(5%)まで縮小できる（中央寄せ 420,122）",
      slots[0].badge.includes("5%") && slots[0].left === 420 && slots[0].top === 122,
      JSON.stringify(slots[0])
    );
    check("意図的な縮小でも余白警告は出ない（元画像自体は十分大きい）", slots[0].gap === "0");
    for (let i = 0; i < 10; i++) await page.keyboard.press("-");
    await page.waitForTimeout(80);
    slots = await readSlots(page);
    check("下限5%でクランプ（それ以上は縮まない）", slots[0].badge.includes("5%") && slots[0].left === 420 && slots[0].top === 122, JSON.stringify(slots[0]));

    // 縮小時のはみ出し移動: 左へ寄せて左端を枠外に出す（トリミング的に不要部分を隠す）
    for (let i = 0; i < 60; i++) await page.keyboard.press("Shift+ArrowLeft");
    slots = await waitSlot(page, 0, (s) => s.left === -60);
    check(
      "縮小状態ではみ出し配置できる（left=-60・左側60pxが枠外）",
      slots[0].left === -60 && slots[0].top === 122,
      JSON.stringify(slots[0])
    );
    const pxImg = await px(page, 30, 160); // 枠内に残った画像部分
    const pxGap = await px(page, 500, 160); // 意図的な余白
    check("はみ出した部分は描画されず、余白は白", isRedish(pxImg) && isWhite(pxGap), `img=${JSON.stringify(pxImg)} gap=${JSON.stringify(pxGap)}`);

    await page.keyboard.press("Control+1");
    await page.waitForTimeout(50);
    slots = await readSlots(page);
    // はみ出しテスト後の focus を保持するため、100% 復帰位置は右端基準（-1440）になる
    check("Ctrl+1 → 100%", slots[0].badge.includes("100%") && slots[0].left === -1440 && slots[0].top === -638, JSON.stringify(slots[0]));

    await page.keyboard.press("Shift+ArrowDown");
    await page.waitForTimeout(50);
    slots = await readSlots(page);
    check("Shift+↓ で10px移動", slots[0].top === -628, JSON.stringify(slots[0]));
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(50);
    slots = await readSlots(page);
    check("↑ で1px移動", slots[0].top === -629, JSON.stringify(slots[0]));
    await page.keyboard.press("Shift+ArrowRight");
    await page.waitForTimeout(50);
    slots = await readSlots(page);
    check("Shift+→ で10px移動", slots[0].top === -629 && slots[0].left === -1430, JSON.stringify(slots[0]));

    await page.keyboard.press("Control+0");
    await page.waitForTimeout(50);
    slots = await readSlots(page);
    check("Ctrl+0 → フィット", slots[0].badge.includes("40%") && slots[0].left === 0 && slots[0].top === -158, JSON.stringify(slots[0]));

    // Tab フォーカス移動
    await page.keyboard.press("Tab");
    let activeIdx = await page.evaluate(() => document.activeElement?.getAttribute("data-slot"));
    check("Tab で次スロットへフォーカス", activeIdx === "1", `active=${activeIdx}`);
    await page.keyboard.press("Shift+Tab");
    activeIdx = await page.evaluate(() => document.activeElement?.getAttribute("data-slot"));
    check("Shift+Tab で戻る", activeIdx === "0", `active=${activeIdx}`);

    // ---- F. マウスドラッグ slot0 ----
    console.log("\n[F] ドラッグ移動 slot0");
    const box0 = await slot0.boundingBox();
    const cx = box0.x + box0.width / 2;
    const cy = box0.y + box0.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 30, cy + 25, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(80);
    slots = await readSlots(page);
    check("ドラッグ反映（+30,+25px・横は余白なし→固定）", slots[0].left === 0 && slots[0].top === -133, JSON.stringify(slots[0]));

    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 2000, cy + 2000, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(80);
    slots = await readSlots(page);
    check("下端までドラッグ → top=0（クランプ）", slots[0].left === 0 && slots[0].top === 0, JSON.stringify(slots[0]));

    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx - 2000, cy - 2000, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(80);
    slots = await readSlots(page);
    check("上端までドラッグ → top=-316（クランプ）", slots[0].left === 0 && slots[0].top === -316, JSON.stringify(slots[0]));

    // ---- G. 行の高さを独立に変更 ----
    console.log("\n[G] 行の高さを独立に変更（行間の線＝1行目 / 下端の線＝2行目）");
    const pvBox = await page.locator('[data-testid="layout-preview"]').boundingBox();
    const numInputsAll = page.locator('input[type="number"]'); // nth0=幅 nth1=1行目 nth2=2行目 nth3=行間
    async function rowHeights() {
      return [await numInputsAll.nth(1).inputValue(), await numInputsAll.nth(2).inputValue()];
    }
    const divider = page.locator('[data-testid="row-divider"]');
    let db = await divider.boundingBox();
    await page.mouse.move(db.x + db.width / 2, db.y + db.height / 2);
    await page.mouse.down();
    await page.mouse.move(db.x + db.width / 2, db.y + db.height / 2 + 54, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(80);
    let boundary = await findRowBoundary(page, 480, 340, 430);
    check("+54px ドラッグ → 境界 y≈378（1行目378px）", approx(boundary, 378, 2), `boundary=${boundary}`);
    check(
      "1行目のみ変化（378/216）",
      JSON.stringify(await rowHeights()) === JSON.stringify(["378", "216"]),
      JSON.stringify(await rowHeights())
    );
    db = await divider.boundingBox();
    const divCenterRel = db.y + db.height / 2 - pvBox.y;
    check("区切り線も移動している", approx(divCenterRel, 378, 2.5), `dividerCenter(rel)=${divCenterRel}`);

    await page.mouse.move(db.x + db.width / 2, db.y + db.height / 2);
    await page.mouse.down();
    await page.mouse.move(db.x + db.width / 2, db.y + db.height / 2 + 102, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(80);
    boundary = await findRowBoundary(page, 480, 380, 520);
    check("+102px ドラッグ → 境界 y≈480（1行目480px）", approx(boundary, 480, 2), `boundary=${boundary}`);
    check(
      "1行目のみ変化し2行目は不変（480/216）",
      JSON.stringify(await rowHeights()) === JSON.stringify(["480", "216"]),
      JSON.stringify(await rowHeights())
    );

    // 2行目: キャンバス下端ハンドルで高さのみ変更
    const row2Handle = page.locator('[data-testid="row2-divider"]');
    const rb = await row2Handle.boundingBox();
    await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
    await page.mouse.down();
    await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2 + 30, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(80);
    check(
      "下端ドラッグ+30 → 2行目のみ変化（480/246）",
      JSON.stringify(await rowHeights()) === JSON.stringify(["480", "246"]),
      JSON.stringify(await rowHeights())
    );
    boundary = await findRowBoundary(page, 480, 380, 520);
    check("1行目側の境界は動かない（y≈480）", approx(boundary, 480, 2), `boundary=${boundary}`);

    // 行高を初期値へ戻す（以降のセクションは既定ジオメトリ前提）
    await numInputsAll.nth(1).fill("324");
    await numInputsAll.nth(2).fill("216");
    await page.waitForTimeout(80);

    // ---- H. ダブルクリックでフィット⇔100% ----
    console.log("\n[H] ダブルクリック切替 slot2");
    await page.locator('[data-slot="2"]').dblclick({ position: { x: 160, y: 30 } });
    await page.waitForTimeout(80);
    slots = await readSlots(page);
    check(
      "フィットへ切替（14%・-2,0）",
      slots[2].badge.includes("14%") && slots[2].left === -2 && slots[2].top === 0,
      JSON.stringify(slots[2])
    );
    await page.locator('[data-slot="2"]').dblclick({ position: { x: 160, y: 30 } });
    await page.waitForTimeout(80);
    slots = await readSlots(page);
    check("100%へ戻る", slots[2].badge.includes("100%") && slots[2].left === -1040 && slots[2].top === -692, JSON.stringify(slots[2]));

    // ---- I. 左右ハンドルでキャンバス幅のみ変更 ----
    console.log("\n[I] 左右ハンドルによるキャンバス幅変更");
    const numInputs = page.locator('input[type="number"]'); // nth0=幅 nth1=1行目 nth2=2行目 nth3=行間
    async function confVals() {
      return [
        await numInputs.nth(0).inputValue(),
        await numInputs.nth(1).inputValue(),
        await numInputs.nth(2).inputValue(),
        await numInputs.nth(3).inputValue(),
      ];
    }
    const previewBox = await page.locator('[data-testid="layout-preview"]').boundingBox();
    const rightEdgeX = previewBox.x + previewBox.width;
    const midY = previewBox.y + previewBox.height / 2;
    // 右端ハンドル: 右へ +96px → 幅 1056（行高・余白は不変）
    await page.mouse.move(rightEdgeX, midY);
    await page.mouse.down();
    await page.mouse.move(rightEdgeX + 96, midY, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(80);
    check(
      "右端ドラッグ+96 → 幅のみ1056（1056/324/216/0）",
      JSON.stringify(await confVals()) === JSON.stringify(["1056", "324", "216", "0"]),
      JSON.stringify(await confVals())
    );
    // 左端ハンドル: 内側へ +48px → 幅 1008（右ドラッグで幅が変わっているため座標を取り直す）
    const previewBoxL = await page.locator('[data-testid="layout-preview"]').boundingBox();
    await page.mouse.move(previewBoxL.x, midY);
    await page.mouse.down();
    await page.mouse.move(previewBoxL.x + 48, midY, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(80);
    check(
      "左端ドラッグ内側+48 → 幅のみ1008（1008/324/216/0）",
      JSON.stringify(await confVals()) === JSON.stringify(["1008", "324", "216", "0"]),
      JSON.stringify(await confVals())
    );
    // 数値入力で元に戻す（Toolbar の数値入力経路も確認）
    await numInputs.nth(0).fill("960");
    await numInputs.nth(1).fill("324");
    await numInputs.nth(2).fill("216");
    await numInputs.nth(3).fill("0");
    await page.waitForTimeout(80);
    check(
      "数値入力で 960/324/216/0 に復帰",
      JSON.stringify(await confVals()) === JSON.stringify(["960", "324", "216", "0"]),
      JSON.stringify(await confVals())
    );

    // ---- J. 数値入力パネル ----
    console.log("\n[J] スロット調整パネル（数値入力）");
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
    check("オフセット入力を反映（0,-100・クランプ内）", slots[1].left === 0 && slots[1].top === -100, JSON.stringify(slots[1]));
    await page.locator('[data-testid="slot-zoom-badge-1"]').click();

    // ---- K. PC/SP 独立性 ----
    console.log("\n[K] PC/SP モード切替");
    check(
      "PC設定 960/324/216/0",
      JSON.stringify(await confVals()) === JSON.stringify(["960", "324", "216", "0"]),
      JSON.stringify(await confVals())
    );
    await page.getByRole("tab", { name: "SP版" }).click();
    await page.waitForTimeout(80);
    check(
      "SP設定 960/324/216/0",
      JSON.stringify(await confVals()) === JSON.stringify(["960", "324", "216", "0"]),
      JSON.stringify(await confVals())
    );
    slots = await readSlots(page);
    check(
      "SP側は初期値のまま（独立）",
      slots[0].badge.includes("100%") && slots[0].left === -720 && slots[0].top === -638,
      JSON.stringify(slots[0])
    );
    await page.getByRole("tab", { name: "PC版" }).click();
    await page.waitForTimeout(80);
    slots = await readSlots(page);
    check(
      "PC側の調整結果は保持される（40%・0,-316）",
      slots[0].badge.includes("40%") && slots[0].left === 0 && slots[0].top === -316,
      JSON.stringify(slots[0])
    );

    // ---- L. エクスポート（サイズ・ピクセル） ----
    console.log("\n[L] エクスポート");
    async function downloadAndSave(trigger, filename) {
      const [dl] = await Promise.all([page.waitForEvent("download"), trigger()]);
      const p = path.join(tmpDir, filename);
      await dl.saveAs(p);
      return p;
    }
    await page.getByRole("button", { name: "エクスポート" }).click();
    await page.locator('img[src^="data:image/png"]').first().waitFor({ state: "visible" });
    check("プレビューが2枚生成される", (await page.locator('img[src^="data:image/png"]').count()) === 2);
    const pcPath = await downloadAndSave(() => page.getByRole("button", { name: "PC版をダウンロード" }).click(), "output_pc.png");
    const spPath = await downloadAndSave(() => page.getByRole("button", { name: "SP版をダウンロード" }).click(), "output_sp.png");

    const pcBuf = fs.readFileSync(pcPath);
    const spBuf = fs.readFileSync(spPath);
    check("PC版 960x540（324+0+216）", JSON.stringify(pngSize(pcBuf)) === '{"width":960,"height":540}', JSON.stringify(pngSize(pcBuf)));
    check("SP版 960x540（324+0+216）", JSON.stringify(pngSize(spBuf)) === '{"width":960,"height":540}', JSON.stringify(pngSize(spBuf)));

    const pcSamples = await samplePngPoints(page, pcBuf, [
      ["s0-mid", 480, 160],
      ["s0-bottom", 480, 320],
      ["s1", 160, 468],
      ["s2", 480, 468],
      ["s3", 800, 468],
    ]);
    check("slot0=赤（調整後も全域）", eq(pcSamples["s0-mid"], COLORS.red) && eq(pcSamples["s0-bottom"], COLORS.red), JSON.stringify(pcSamples));
    check("slot1=緑（80%・0,-100）", eq(pcSamples["s1"], COLORS.green), JSON.stringify(pcSamples["s1"]));
    check("slot2=青", eq(pcSamples["s2"], COLORS.blue));
    check("slot3=黄", eq(pcSamples["s3"], COLORS.yellow));

    const whitesPc = await page.evaluate(async () => {
      const c = window.__sampleCanvas;
      const ctx = c.getContext("2d");
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      const found = [];
      for (let y = 0; y < c.height; y += 24)
        for (let x = 0; x < c.width; x += 24) {
          const o = (y * c.width + x) * 4;
          if (d[o] === 255 && d[o + 1] === 255 && d[o + 2] === 255) found.push([x, y]);
        }
      return found.slice(0, 8);
    });
    check("PC版 全域に白抜けなし", whitesPc.length === 0, JSON.stringify(whitesPc));

    const spSamples = await samplePngPoints(page, spBuf, [
      ["s0", 480, 162],
      ["s1", 160, 432],
      ["s3", 800, 432],
    ]);
    check("SP版 色正し", eq(spSamples["s0"], COLORS.red) && eq(spSamples["s1"], COLORS.green) && eq(spSamples["s3"], COLORS.yellow), JSON.stringify(spSamples));

    await page.keyboard.press("Escape"); // ダイアログを閉じる
    await page.waitForTimeout(120);

    // ---- M. 画像差し替えで transform リセット ＋ 極端な画像 ----
    console.log("\n[M] 差し替えリセット＆極端に細長い画像");
    await inputs(0).setInputFiles(wideImg);
    slots = await waitSlot(page, 0, (s) => s.badge.includes("100%") && s.left === -1520 && s.top === -338);
    check(
      "差し替え時に transform リセット（100%・中央 -1520,-338）",
      slots[0].badge.includes("100%") && slots[0].left === -1520 && slots[0].top === -338,
      JSON.stringify(slots[0])
    );
    await slot0.focus();
    await page.keyboard.press("Control+0");
    await page.waitForTimeout(50);
    slots = await readSlots(page);
    check(
      "ワイド画像のフィット（32%・中央 -168,0・余白なし）",
      slots[0].badge.includes("32%") && slots[0].left === -168 && slots[0].top === 0 && slots[0].gap === "0",
      JSON.stringify(slots[0])
    );
    check("プレビュー下端まで赤（行境界付近）", eq(await px(page, 480, 322), COLORS.red), JSON.stringify(await px(page, 480, 322)));

    const wideDl = await downloadAndSave(async () => {
      await page.getByRole("button", { name: "エクスポート" }).click();
      await page.locator('img[src^="data:image/png"]').first().waitFor({ state: "visible" });
      await page.getByRole("button", { name: "PC版をダウンロード" }).click();
    }, "output_pc_wide.png");
    const wideBuf = fs.readFileSync(wideDl);
    const wideSamples = await samplePngPoints(page, wideBuf, [
      ["mid", 480, 160],
      ["bottom", 480, 320],
      ["left", 5, 160],
      ["right", 955, 160],
    ]);
    check(
      "エクスポートでも1行目が全面赤（白抜けなし）",
      Object.values(wideSamples).every((c) => !isWhite(c)),
      JSON.stringify(wideSamples)
    );
    await page.keyboard.press("Escape");
    await page.waitForTimeout(120);

    // ---- N. 枠より小さい画像 → 余白＋警告 ----
    console.log("\n[N] 小さい画像の余白警告");
    await inputs(3).setInputFiles(smallImg);
    slots = await waitSlot(page, 3, (s) => s.gap === "1");
    check(
      "zoom=1 固定・中央寄せ（10,8）",
      slots[3].badge.includes("100%") && slots[3].left === 10 && slots[3].top === 8,
      JSON.stringify(slots[3])
    );
    check("警告バッジ表示", slots[3].gap === "1" && (await page.locator('[data-testid="slot-gap-warning-3"]').isVisible()));
    const box3 = await page.locator('[data-slot="3"]').boundingBox();
    await page.mouse.move(box3.x + box3.width / 2, box3.y + box3.height / 2);
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(80);
    slots = await readSlots(page);
    check("ホイールで拡大しても100%（上限クランプ）・警告維持", slots[3].badge.includes("100%") && slots[3].gap === "1", JSON.stringify(slots[3]));
    // 余白は白、画像部分は黄として描画される（プレビュー座標: 画像は x[650,950] y[332,532]）
    const gapPx = await px(page, 955, 430); // 余白（画像の右側）
    const imgPx = await px(page, 700, 430); // 画像内部
    check("余白=白・画像=黄で描画", isWhite(gapPx) && eq(imgPx, COLORS.yellow), `gap=${JSON.stringify(gapPx)} img=${JSON.stringify(imgPx)}`);

    // ---- O. 行間の余白 ----
    console.log("\n[O] 行間の余白");
    const gapInput = page.locator('[data-testid="row-gap-input"]');
    await gapInput.fill("40");
    await page.waitForTimeout(80);
    // プレビュー: 行間帯は y∈[324,364]、キャンバス全体は 580 高になる
    const g1 = await px(page, 480, 344);
    const g2 = await px(page, 480, 320);
    const g3 = await px(page, 160, 380);
    check(
      "行間40px → 帯は白・上下は画像",
      isWhite(g1) && eq(g2, COLORS.red) && eq(g3, COLORS.green),
      `band=${JSON.stringify(g1)} above=${JSON.stringify(g2)} below=${JSON.stringify(g3)}`
    );
    const gapBoundary = await findRowBoundary(page, 480, 300, 420);
    check("赤→緑の境界は y≈364", approx(gapBoundary, 364, 2), `boundary=${gapBoundary}`);

    const gapDl = await downloadAndSave(async () => {
      await page.getByRole("button", { name: "エクスポート" }).click();
      await page.locator('img[src^="data:image/png"]').first().waitFor({ state: "visible" });
      await page.getByRole("button", { name: "PC版をダウンロード" }).click();
    }, "output_pc_gap.png");
    const gapBuf = fs.readFileSync(gapDl);
    check(
      "エクスポート 960x580（324+40+216）",
      JSON.stringify(pngSize(gapBuf)) === '{"width":960,"height":580}',
      JSON.stringify(pngSize(gapBuf))
    );
    const gapSamples = await samplePngPoints(page, gapBuf, [
      ["band", 480, 344],
      ["above", 480, 300],
      ["below", 160, 550],
    ]);
    check(
      "出力でも行間は白",
      isWhite(gapSamples["band"]) && !isWhite(gapSamples["above"]) && !isWhite(gapSamples["below"]),
      JSON.stringify(gapSamples)
    );
    await page.keyboard.press("Escape");
    await page.waitForTimeout(120);
    await gapInput.fill("0");
    await page.waitForTimeout(80);

    // ---- P. スロット直接アップロード（クリック／ドロップ）と削除 ----
    console.log("\n[P] スロット直接アップロード（クリック／ドロップ）と削除");
    // slot1 を「削除」→ 空スロットに戻る
    await page.locator('[data-slot="1"]').hover();
    await page.locator('[data-testid="slot-remove-1"]').click();
    slots = await waitSlot(page, 1, (s) => Number.isNaN(s.zoom));
    check(
      "削除ボタンでスロットが空に戻る",
      (await page.locator('[data-testid^="slot-zoom-badge"]').count()) === 3 &&
        (await page.locator('[data-testid="slot-empty-1"]').isVisible()),
      `badges=${await page.locator('[data-testid^="slot-zoom-badge"]').count()}`
    );

    // 空きスロットをクリック → ファイル選択で復元
    const [fc1] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.locator('[data-testid="slot-empty-1"]').click(),
    ]);
    await fc1.setFiles(files[1]);
    slots = await waitSlot(page, 1, (s) => s.badge.includes("100%") && s.left === -1040 && s.top === -692);
    check(
      "空きスロットのクリックで画像を追加（初期値で復元）",
      (await page.locator('[data-testid="slot-empty-1"]').count()) === 0 &&
        slots[1].badge.includes("100%") &&
        slots[1].left === -1040 &&
        slots[1].top === -692,
      JSON.stringify(slots[1])
    );

    // 「変更」ボタンでワイド画像に差し替え → transform リセット
    await page.locator('[data-slot="1"]').hover();
    const [fc2] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.locator('[data-testid="slot-replace-1"]').click(),
    ]);
    await fc2.setFiles(wideImg);
    // slot1 は2行目・幅320のため中央は left = 160-2000 = -1840 / top = 108-500 = -392
    slots = await waitSlot(page, 1, (s) => s.badge.includes("100%") && s.left === -1840 && s.top === -392);
    check(
      "変更ボタンで差し替え＆transform リセット",
      slots[1].badge.includes("100%") && slots[1].left === -1840 && slots[1].top === -392,
      JSON.stringify(slots[1])
    );

    // ドロップでも差し替えできる（画像ありスロットへの上書き）
    await dropOnSlot(page, 1, fs.readFileSync(files[1]));
    slots = await waitSlot(page, 1, (s) => s.badge.includes("100%") && s.left === -1040 && s.top === -692);
    check(
      "ドロップで画像ありスロットへ上書き",
      slots[1].left === -1040 && slots[1].top === -692,
      JSON.stringify(slots[1])
    );

    // 削除 → 空きスロットへのドロップで追加
    await page.locator('[data-slot="2"]').hover();
    await page.locator('[data-testid="slot-remove-2"]').click();
    slots = await waitSlot(page, 2, (s) => Number.isNaN(s.zoom));
    await dropOnSlot(page, 2, fs.readFileSync(files[2]));
    slots = await waitSlot(page, 2, (s) => s.badge.includes("100%"));
    check(
      "空きスロットへのドロップで画像を追加",
      (await page.locator('[data-testid="slot-empty-2"]').count()) === 0 && slots[2].badge.includes("100%"),
      JSON.stringify(slots[2])
    );
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
