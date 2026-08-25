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
const brightness = (a) => (a[0] + a[1] + a[2]) / 3;

async function readGradient(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-slot="gradient"]');
    if (!el) return null;
    return {
      zoom: el.dataset.zoom === "" ? NaN : parseFloat(el.dataset.zoom),
      minZoom: el.dataset.minZoom === "" ? NaN : parseFloat(el.dataset.minZoom),
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
    check("/ でレイアウトページが表示される", await page.locator('[data-testid="nav-layout"]').isVisible());
    // 初回アクセス時のショートカットオーバーレイを閉じる
    const overlay = page.locator('[data-testid="shortcuts-overlay"]');
    if (await overlay.isVisible().catch(() => false)) {
      await page.locator('[data-testid="shortcuts-close"]').click();
    }
    await page.locator('[data-testid="nav-gradient"]').click();
    await page.waitForURL((u) => u.hash === "#/gradient");
    check("/gradient へ遷移する", page.url().includes("#/gradient"));
    check(
      "キャンバス設定の既定値は 960x345",
      JSON.stringify(await cfgVals(page)) === JSON.stringify(["960", "345"]),
      JSON.stringify(await cfgVals(page))
    );

    // ---- B. アップロード（空きスロット直接クリック → 変更ボタンで差し替え） ----
    console.log("\n[B] スロット直接アップロード・差し替え");
    await uploadViaFilechooser(
      page,
      () => page.locator('[data-testid="gradient-empty"]').click(),
      smallImg
    );
    let g = await waitGradient(page, (s) => s.badge.includes("100%") && s.left === 330 && s.top === 73);
    check(
      "小さい画像を直接アップロード（100%・中央寄せ 330,73）",
      g.badge.includes("100%") && g.left === 330 && g.top === 73,
      JSON.stringify(g)
    );
    check("余白警告バッジ表示", g.gap === "1" && (await page.locator('[data-testid="gradient-gap-warning"]').isVisible()));

    // 変更ボタンで差し替え
    await page.locator('[data-testid="gradient-slot"]').hover();
    const [fc] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.locator('[data-testid="gradient-replace"]').click(),
    ]);
    await fc.setFiles(redImg);
    g = await waitGradient(page, (s) => s.left === -720 && s.top === -627);
    check(
      "変更ボタンで差し替え＆transform リセット（100%・-720,-627）",
      g.badge.includes("100%") && g.left === -720 && g.top === -627 && g.gap === "0",
      JSON.stringify(g)
    );
    check("余白警告は消える", !(await page.locator('[data-testid="gradient-gap-warning"]').isVisible().catch(() => false)));

    // ---- C. 移動・ズーム ----
    console.log("\n[C] 移動・ズーム");
    await page.locator('[data-slot="gradient"]').focus();
    await page.keyboard.press("Control+0");
    g = await waitGradient(page, (s) => s.badge.includes("40%"));
    check("Ctrl+0 フィット（40%・0,-147）", g.badge.includes("40%") && g.left === 0 && g.top === -147, JSON.stringify(g));

    const box = await page.locator('[data-slot="gradient"]').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    // フィット状態（zoom=下限）からのズームイン。カーソルアンカー（中央）で -24,-163 へ
    await page.mouse.wheel(0, -120);
    g = await waitGradient(page, (s) => s.badge.includes("42%"));
    check("ホイールズームイン → 42%（-24,-163）", g.badge.includes("42%") && g.left === -24 && g.top === -163, JSON.stringify(g));

    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2 + 10, { steps: 4 });
    await page.mouse.up();
    g = await waitGradient(page, (s) => s.left === -4 && s.top === -153);
    check("ドラッグ移動（+20,+10 → -4,-153）", g.left === -4 && g.top === -153, JSON.stringify(g));
    await page.keyboard.press("Shift+ArrowDown");
    g = await waitGradient(page, (s) => s.top === -143);
    check("Shift+↓ ナッジ（top=-143）", g.top === -143, JSON.stringify(g));

    // フィット以下への縮小（余白可・両ツール共通ルール）
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 120);
    g = await waitGradient(page, (s) => s.badge.includes("40%") && s.left === 0 && s.top === -128);
    check("フィットからズームアウト → 40%（横は余白なし限界・top=-128）", g.left === 0 && g.top === -128, JSON.stringify(g));
    await page.mouse.wheel(0, 120);
    g = await waitGradient(page, (s) => s.badge.includes("38%") && s.gap === "0");
    check("cover以下へも縮小可（38%・23,-114）＆意図的縮小で警告なし", g.left === 23 && g.top === -114 && g.gap === "0", JSON.stringify(g));

    // 縮小時のはみ出し移動: 左へ寄せて左端を枠外に出す
    for (let i = 0; i < 60; i++) await page.keyboard.press("Shift+ArrowLeft");
    g = await waitGradient(page, (s) => s.left === -457);
    check("縮小状態ではみ出し配置できる（left=-457・右側457pxが枠外）", g.left === -457 && g.badge.includes("38%"), JSON.stringify(g));
    const ovImg = await pxG(page, 300, 270); // 枠内に残った画像部分
    const ovGap = await pxG(page, 700, 270); // 意図的な余白（白背景 × 右白フェード ≈ 白）
    check(
      "はみ出した部分は画像色として描画されない",
      isRedish(ovImg) && !isRedish(ovGap),
      `img=${JSON.stringify(ovImg)} gap=${JSON.stringify(ovGap)}`
    );

    await page.locator('[data-slot="gradient"]').focus();
    await page.keyboard.press("Control+0");
    g = await waitGradient(page, (s) => s.badge.includes("40%") && s.left === 0 && s.top === -147);
    check("Ctrl+0 でフィットに戻る", g.badge.includes("40%") && g.left === 0 && g.top === -147, JSON.stringify(g));

    // ---- D. グラデーション描画 ----
    console.log("\n[D] グラデーション描画（プレビューピクセル検証）");
    // 既定スタイル: 右フェード（右端 白100% → 中央 透明）
    const dRight = await waitPx(page, 952, 270, (c) => c[1] > 150 && c[2] > 150);
    const dCenter = await waitPx(page, 480, 270, (c) => isRedish(c));
    const dLeft = await pxG(page, 5, 270);
    check("既定（右白フェード）: 右端は白っぽい", dRight[1] > 150 && dRight[2] > 150, JSON.stringify(dRight));
    check(
      "既定（右白フェード）: 中央・左端は素の赤",
      isRedish(dCenter) && isRedish(dLeft),
      `center=${JSON.stringify(dCenter)} left=${JSON.stringify(dLeft)}`
    );

    // プリセット: 左黒フェード
    await page.locator('[data-testid="gradient-preset-fade-left-black"]').click();
    const lMid = await waitPx(page, 5, 270, (c) => c[0] < 130);
    const rMid = await pxG(page, 955, 270);
    const lCenter = await pxG(page, 480, 270);
    check(
      "左黒フェード: 左端は暗い／中央・右端は素の赤",
      lMid[0] < 130 && isRedish(lCenter) && isRedish(rMid),
      `left=${JSON.stringify(lMid)} center=${JSON.stringify(lCenter)} right=${JSON.stringify(rMid)}`
    );

    // 開始位置を変更（左フェードの開始を 20% へ）→ フェード開始点が内側に移動
    await page.locator('[data-testid="gradient-start-pos-input"]').fill("20");
    const pStart = await waitPx(page, 100, 270, (c) => c[0] < 130);
    const pOutside = await pxG(page, 700, 270);
    check(
      "開始位置20% → x=100が最も暗くx=700は素の赤",
      pStart[0] < 130 && isRedish(pOutside),
      `start=${JSON.stringify(pStart)} outside=${JSON.stringify(pOutside)}`
    );

    // 色と透明度を変更（白 / 開始不透明度を最大へ）
    await page.locator('[data-testid="gradient-color-hex"]').fill("#ffffff");
    await page.locator('[data-testid="gradient-color-hex"]').press("Enter");
    const alphaThumb = page.locator('[data-testid="gradient-start-alpha"] [role="slider"]');
    await alphaThumb.focus();
    await page.keyboard.press("End");
    const wStart = await waitPx(page, 100, 270, (c) => c[1] > 150 && c[2] > 150);
    check("色=白・開始不透明度100% → フェード部は白っぽい", wStart[1] > 150 && wStart[2] > 150, JSON.stringify(wStart));

    // サイド切替（右フェード）→ 位置・色・不透明度は共有され、ストップの割り当てだけが反転する
    // （left: 開始=左端20% → 右フェードでは開始=右端20%（x=768）に割り当てられる）
    await page.locator('[data-testid="gradient-side-right"]').click();
    const rWhite = await waitPx(page, 768, 270, (c) => c[1] > 150 && c[2] > 150);
    const rLeftEdge = await pxG(page, 300, 270);
    check(
      "右フェードへ切替 → 白フェードが左右反転して配置される",
      rWhite[1] > 150 && isRedish(rLeftEdge),
      `x768=${JSON.stringify(rWhite)} left=${JSON.stringify(rLeftEdge)}`
    );

    // プリセット: 右白フェード（0%→60%）
    await page.locator('[data-testid="gradient-preset-fade-right-white"]').click();
    const pwRight = await waitPx(page, 950, 270, (c) => c[1] > 150);
    const pwCenter = await pxG(page, 400, 270);
    check(
      "右白フェードプリセット: 右端は白っぽく中央より左は素の赤",
      pwRight[1] > 150 && isRedish(pwCenter),
      `right=${JSON.stringify(pwRight)} center=${JSON.stringify(pwCenter)}`
    );

    // 向き「左右」→ 両端から内側へフェード
    await page.locator('[data-testid="gradient-side-both"]').click();
    const bLeft = await waitPx(page, 170, 270, (c) => c[1] > 150 && c[2] > 150);
    const bRight = await waitPx(page, 790, 270, (c) => c[1] > 150 && c[2] > 150);
    const bCenter = await pxG(page, 480, 270);
    check(
      "左右フェード: 両端が白っぽく中央はそれより暗い",
      bLeft[1] > 150 && bRight[1] > 150 && brightness(bCenter) < Math.min(brightness(bLeft), brightness(bRight)) - 40,
      `left=${JSON.stringify(bLeft)} right=${JSON.stringify(bRight)} center=${JSON.stringify(bCenter)}`
    );

    // ---- E. PC/SP 独立性 ----
    console.log("\n[E] PC/SP 独立性");
    await page.getByRole("tab", { name: "SP版" }).click();
    const spRight = await waitPx(page, 952, 270, (c) => c[1] > 150 && c[2] > 150);
    const spCenter = await pxG(page, 480, 270);
    check(
      "SP側は既定スタイル（右白フェード）から始まる",
      spRight[1] > 150 && spRight[2] > 150 && isRedish(spCenter),
      `right=${JSON.stringify(spRight)} center=${JSON.stringify(spCenter)}`
    );
    await page.locator('[data-testid="gradient-preset-fade-left-black"]').click();
    const spLeftDark = await waitPx(page, 8, 270, (c) => c[0] < 130);
    check("SP側で左黒フェード適用", spLeftDark[0] < 130, JSON.stringify(spLeftDark));

    await page.getByRole("tab", { name: "PC版" }).click();
    // PC側は直前の右白フェードを保持している
    const pcBackRight = await waitPx(page, 950, 270, (c) => c[1] > 150);
    check("PC側の設定は保持される（右白フェードのまま）", pcBackRight[1] > 150, JSON.stringify(pcBackRight));

    // ---- F. サイズハンドル ----
    console.log("\n[F] サイズハンドル");
    const pvBox = await page.locator('[data-testid="gradient-preview"]').boundingBox();
    const rightX = pvBox.x + pvBox.width;
    const midY = pvBox.y + pvBox.height / 2;
    await page.mouse.move(rightX, midY);
    await page.mouse.down();
    await page.mouse.move(rightX + 64, midY, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(80);
    check("右端ドラッグ+64 → 幅1024", (await cfgVals(page))[0] === "1024", JSON.stringify(await cfgVals(page)));

    const hHandle = await page.locator('[data-testid="gradient-height-handle"]').boundingBox();
    await page.mouse.move(hHandle.x + hHandle.width / 2, hHandle.y + hHandle.height / 2);
    await page.mouse.down();
    await page.mouse.move(hHandle.x + hHandle.width / 2, hHandle.y + hHandle.height / 2 + 40, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(80);
    check("下端ドラッグ+40 → 高さ385", JSON.stringify(await cfgVals(page)) === JSON.stringify(["1024", "385"]), JSON.stringify(await cfgVals(page)));

    // ---- G. エクスポート ----
    console.log("\n[G] エクスポート");
    // 状態を固定: 右ネイビーへ戻し、フィット
    await page.locator('[data-testid="gradient-preset-fade-right-navy"]').click();
    await page.locator('[data-slot="gradient"]').focus();
    await page.keyboard.press("Control+0");
    await page.waitForTimeout(80);

    async function downloadAndSave(trigger, filename) {
      const [dl] = await Promise.all([page.waitForEvent("download"), trigger()]);
      const p = path.join(tmpDir, filename);
      await dl.saveAs(p);
      return p;
    }
    await downloadAndSave(async () => {
      await page.getByRole("button", { name: "エクスポート" }).click();
      await page.locator('img[src^="data:image/png"]').first().waitFor({ state: "visible" });
      await page.getByRole("button", { name: "PC版をダウンロード" }).click();
    }, "gradient_pc.png");

    const buf = fs.readFileSync(path.join(tmpDir, "gradient_pc.png"));
    check(
      "出力サイズ 1024x385",
      JSON.stringify(pngSize(buf)) === '{"width":1024,"height":385}',
      JSON.stringify(pngSize(buf))
    );
    const samples = await samplePngPoints(page, buf, [
      ["right-dark", 1020, 190],
      ["center-red", 100, 190],
    ]);
    check(
      "出力でもグラデが反映される（右端ネイビー・左側赤）",
      samples["right-dark"][0] < 130 && isRedish(samples["center-red"]),
      JSON.stringify(samples)
    );
    await page.keyboard.press("Escape");
    await page.waitForTimeout(120);

    // ---- H. レイアウトページへの復帰 ----
    console.log("\n[H] レイアウトページへの復帰");
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

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
