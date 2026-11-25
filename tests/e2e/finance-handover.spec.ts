import type { Page, Request } from "@playwright/test";
import { test, expect, login } from "../../apps/web/tests/browser-fixtures";

const origin = `http://127.0.0.1:${process.env.YEONIEUM_E2E_WEB_PORT || "5180"}`;
const expenseSubmitPath = "/api/budgets/expenses/submit";

function isReceiptSubmission(request: Request) {
  return (
    request.method() === "POST" &&
    new URL(request.url()).pathname === expenseSubmitPath
  );
}

type ReceiptSubmission = {
  expense: { request_id: string };
  filename: string;
  bytes: number[];
};

async function captureReceiptSubmissions(page: Page) {
  const submissions: ReceiptSubmission[] = [];
  await page.exposeFunction(
    "captureReceiptSubmission",
    (data: ReceiptSubmission) => {
      submissions.push(data);
    },
  );
  // Chromium omits File parts from Playwright's captured multipart request body.
  await page.evaluate((path) => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      if (
        typeof input === "string" &&
        new URL(input, window.location.href).pathname === path &&
        init?.method === "POST" &&
        init.body instanceof FormData
      ) {
        const expense = init.body.get("expense");
        const receipt = init.body.get("receipt");
        if (typeof expense === "string" && receipt instanceof File) {
          const browser = window as Window & {
            captureReceiptSubmission: (
              data: ReceiptSubmission,
            ) => Promise<void>;
          };
          await browser.captureReceiptSubmission({
            expense: JSON.parse(expense),
            filename: receipt.name,
            bytes: Array.from(new Uint8Array(await receipt.arrayBuffer())),
          });
        }
      }
      return originalFetch(input, init);
    };
  }, expenseSubmitPath);
  return submissions;
}

test("단체 카드를 드래그·방향키로 옮기고 표시 순서만 계정별 브라우저에 보존한다", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await login(page, "staff-demo");
  const user = await (await page.request.get("/api/me")).json();
  await page.getByRole("button", { name: "예산 · 정산", exact: true }).click();
  const cards = page.locator("[data-budget-org]");
  const available = (
    await (await page.request.get("/api/budgets/options")).json()
  ).organizations;
  await expect(cards).toHaveCount(available.length);
  expect(available.length).toBeGreaterThan(1);
  const ids = await cards.evaluateAll((els) =>
    els.map((el) => (el as HTMLElement).dataset.budgetOrg!),
  );
  const selected = await page
    .getByRole("combobox", { name: "단체", exact: true })
    .inputValue();
  await cards.first().dragTo(cards.last(), { steps: 12 });
  const moved = [...ids.slice(1), ids[0]];
  await expect
    .poll(() =>
      cards.evaluateAll((els) =>
        els.map((el) => (el as HTMLElement).dataset.budgetOrg),
      ),
    )
    .toEqual(moved);
  await expect(
    page.getByRole("combobox", { name: "단체", exact: true }),
  ).toHaveValue(selected);
  const options = page
    .getByRole("combobox", { name: "단체", exact: true })
    .locator("option");
  expect(
    await options.evaluateAll((els) =>
      els.map((el) => (el as HTMLOptionElement).value).filter(Boolean),
    ),
  ).toEqual(moved);
  await page.reload();
  await page.getByRole("button", { name: "예산 · 정산", exact: true }).click();
  await expect
    .poll(() =>
      cards.evaluateAll((els) =>
        els.map((el) => (el as HTMLElement).dataset.budgetOrg),
      ),
    )
    .toEqual(moved);
  const handle = page
    .locator(`[data-budget-org="${moved.at(-1)}"]`)
    .getByRole("button", { name: /순서 변경$/ });
  await handle.focus();
  await handle.press("ArrowLeft");
  await expect(handle).toBeFocused();
  const keyboard = [...moved];
  [keyboard[keyboard.length - 2], keyboard[keyboard.length - 1]] = [
    keyboard[keyboard.length - 1],
    keyboard[keyboard.length - 2],
  ];
  await expect
    .poll(() =>
      cards.evaluateAll((els) =>
        els.map((el) => (el as HTMLElement).dataset.budgetOrg),
      ),
    )
    .toEqual(keyboard);
  await page.setViewportSize({ width: 390, height: 1000 });
  await cards.first().scrollIntoViewIfNeeded();
  await cards.nth(1).scrollIntoViewIfNeeded();
  const a = await cards
    .nth(1)
    .getByRole("button", { name: /순서 변경$/ })
    .boundingBox();
  const b = await cards.first().boundingBox();
  await page.mouse.move(a!.x + a!.width / 2, a!.y + a!.height / 2);
  await page.mouse.down();
  await page.mouse.move(b!.x + b!.width / 2, b!.y + b!.height / 2, {
    steps: 12,
  });
  await page.mouse.up();
  await expect(cards.first()).toHaveAttribute("data-budget-org", keyboard[1]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "../../local-data/preview/budget-order-mobile.png",
    fullPage: true,
  });
  await page.evaluate(
    (key) => localStorage.setItem(key, "malformed"),
    `yeonieum-budget-order:${user.id}`,
  );
  await page.reload();
  await page.getByRole("button", { name: "예산 · 정산", exact: true }).click();
  await expect
    .poll(() =>
      cards.evaluateAll((els) =>
        els.map((el) => (el as HTMLElement).dataset.budgetOrg),
      ),
    )
    .toEqual(ids);
});

async function currentChief(page: import("@playwright/test").Page) {
  const work = await (await page.request.get("/api/workspace")).json();
  const chief = work.assignments.find(
    (a: { role: string; effective: boolean; unit_id: string }) =>
      a.effective && a.role === "chair" && a.unit_id === "council",
  );
  expect(chief).toBeTruthy();
  return work.users.find((p: { id: string }) => p.id === chief.user_id)
    .identifier as string;
}
async function switchAccount(
  page: import("@playwright/test").Page,
  identifier: string,
) {
  const response = await page.request.post("/api/auth/login", {
    headers: { origin },
    data: { identifier, password: "Yeonieum-demo-2026!" },
  });
  expect(response.ok()).toBeTruthy();
  await page.reload();
}

test("선생님이 단체별 연간 예산을 설정하고 책임자가 엑셀 내역·증빙을 확인해 차감한다", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1100 });
  await login(page, "staff-demo");
  await page.getByRole("button", { name: "예산 · 정산", exact: true }).click();
  await page
    .getByRole("combobox", { name: "단체", exact: true })
    .selectOption("council");
  await page.getByLabel("연도", { exact: true }).fill("2025");
  const annual = page
    .locator("form")
    .filter({ has: page.getByRole("button", { name: "저장", exact: true }) });
  await annual.getByLabel("연간 예산 (원)").fill("1000000");
  await expect(annual.getByRole("checkbox")).toBeChecked();
  await annual.getByRole("button", { name: "저장", exact: true }).click();
  await expect(
    page.getByText("연간 예산을 저장했습니다.", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".finance-grants input:visible")).toHaveCount(0);
  await switchAccount(page, await currentChief(page));
  await page.getByRole("button", { name: "예산 · 정산", exact: true }).click();
  await page.getByLabel("연도", { exact: true }).fill("2025");
  await page
    .getByRole("button", { name: "＋ 지출결의서 작성", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: /영수증 첨부/ }),
  ).toBeVisible();
  await dialog.getByLabel("업로드 파일").setInputFiles({
    name: "가상 지출.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "용도,금액\n가상 물품,12000\n가상 인쇄,3000\n합계,15000\n",
    ),
  });
  await expect(
    dialog.getByRole("region", { name: "읽어온 지출 미리보기" }),
  ).toContainText("합계 15,000원");
  expect(
    (await (await page.request.get("/api/budgets/council/2025")).json()).totals
      .actual,
  ).toBe(0);
  await expect(dialog.getByLabel("금액 (원)")).toHaveValue("15000");
  await dialog
    .getByRole("button", { name: "선택한 파일 제거", exact: true })
    .click();
  await expect(dialog.getByLabel("금액 (원)")).toHaveValue("");
  await dialog.getByLabel("금액 (원)").fill("14000");
  const filename = "가상 지출.csv";
  const csv = Buffer.from("용도,금액\n가상 물품,13000\n가상 인쇄,3000\n");
  await dialog.getByLabel("업로드 파일").setInputFiles({
    name: filename,
    mimeType: "text/csv",
    buffer: csv,
  });
  await expect(
    dialog.getByRole("region", { name: "읽어온 지출 미리보기" }),
  ).toContainText("합계 16,000원");
  await expect(dialog.getByLabel("금액 (원)")).toHaveValue("14000");
  await expect(dialog.locator(".finance-expected-balance")).toContainText(
    "986,000원",
  );
  await dialog.getByLabel("집행일").fill("2025-05-20");
  await dialog.getByLabel("결의서 제목").fill("가상 행사 지출 묶음");
  await dialog.getByLabel("지출 목적").fill("행사 물품과 안내문 인쇄");
  await dialog.getByLabel("거래처 / 지급처").fill("가상 문구점");
  await dialog.getByLabel("결제 수단").selectOption("card");
  await page.setViewportSize({ width: 390, height: 740 });
  await dialog.evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(
    dialog.getByRole("button", { name: "결의서 제출", exact: true }),
  ).toBeInViewport();
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1600, height: 1100 });
  await dialog.screenshot({
    path: "../../local-data/preview/finance-import-preview.png",
  });
  const submissions = await captureReceiptSubmissions(page);
  const [request] = await Promise.all([
    page.waitForRequest(isReceiptSubmission),
    dialog.getByRole("button", { name: "결의서 제출", exact: true }).click(),
  ]);
  expect(request.headers()["content-type"]).toMatch(
    /^multipart\/form-data;\s*boundary=/i,
  );
  expect(submissions).toHaveLength(1);
  const [submitted] = submissions;
  expect(submitted.expense).toMatchObject({
    request_id: expect.any(String),
    amount: 14000,
    org_id: "council",
    year: 2025,
  });
  expect(submitted.filename).toBe(filename);
  expect(Buffer.from(submitted.bytes)).toEqual(csv);
  await expect(dialog).not.toBeVisible();
  const result = await (
    await page.request.get("/api/budgets/council/2025")
  ).json();
  expect(result.totals.actual).toBe(14000);
  expect(result.totals.remaining).toBe(986000);
  expect(result.expenses).toHaveLength(1);
  expect(result.expenses[0].evidence_count).toBe(1);
  await expect(page.locator(".finance-balance-change")).toContainText(
    "1,000,000원 − 14,000원 = 잔액 986,000원",
  );
  await expect(page.getByTestId("finance-current-balance")).toHaveText(
    "986,000원",
  );
  await expect(
    page.getByRole("img", { name: /연간 예산 1,000,000원.*잔액 986,000원/ }),
  ).toBeVisible();
  await expect(
    page.getByLabel("2025-05-20 잔액 986,000원", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /가상 행사 지출 묶음.*증빙 1개/ }),
  ).toBeVisible();
  const detail = page.locator(".finance-detail");
  await expect(detail.getByText("첨부 증빙", { exact: true })).toBeVisible();
  await expect(detail.getByText(filename, { exact: true })).toBeVisible();
  await expect(
    detail.getByRole("button", { name: /다운로드|내려받기/ }),
  ).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "../../local-data/preview/finance-overview-desktop.png",
    fullPage: true,
  });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.screenshot({
    path: "../../local-data/preview/finance-overview-mobile.png",
    fullPage: true,
  });
  await switchAccount(page, "staff-demo");
  await page.getByRole("button", { name: "예산 · 정산", exact: true }).click();
  await page
    .getByRole("combobox", { name: "단체", exact: true })
    .selectOption("council");
  await page.getByLabel("연도", { exact: true }).fill("2025");
  await page.getByText("연간 예산 수정", { exact: true }).click();
  await annual.getByLabel("연간 예산 (원)").fill("10000");
  await annual.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByTestId("finance-current-balance")).toHaveText(
    "-4,000원",
  );
  await expect(
    page.getByText("예산 초과 4,000원", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByLabel("2025-05-20 잔액 -4,000원", { exact: true })
      .locator(".finance-trend-negative"),
  ).toBeVisible();
});

test("첨부 실패 뒤 같은 요청으로 재시도하면 한 번 차감되고 새로고침 뒤에도 증빙이 보인다", async ({
  page,
}) => {
  await login(page, "staff-demo");
  expect(
    (
      await page.request.post("/api/budgets/annual", {
        headers: { origin },
        data: {
          org_id: "council",
          year: 2024,
          amount: 1000000,
          authorize_heads: true,
        },
      })
    ).ok(),
  ).toBeTruthy();
  await switchAccount(page, await currentChief(page));
  await page.getByRole("button", { name: "예산 · 정산", exact: true }).click();
  await page.getByLabel("연도", { exact: true }).fill("2024");
  await page
    .getByRole("button", { name: "＋ 지출결의서 작성", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  const filename = "가상 영수증.png";
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 2;
    canvas.height = 3;
    canvas.getContext("2d")!.fillRect(0, 0, 2, 3);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  const receipt = Buffer.from(png, "base64");
  await dialog.getByLabel("업로드 파일").setInputFiles({
    name: filename,
    mimeType: "image/png",
    buffer: receipt,
  });
  await expect(dialog.getByLabel("금액 (원)")).toHaveValue("");
  await dialog.getByLabel("집행일").fill("2024-06-01");
  await dialog.getByLabel("결의서 제목").fill("가상 영수증 재시도");
  await dialog.getByLabel("지출 목적").fill("가상 결의서 제출 재시도 확인");
  await dialog.getByLabel("금액 (원)").fill("20000");
  const budgetPath = "/api/budgets/council/2024";
  const initial = await (await page.request.get(budgetPath)).json();
  expect(initial.expenses).toHaveLength(0);
  expect(initial.totals.actual).toBe(0);
  const submissions = await captureReceiptSubmissions(page);

  await page.route(
    `**${expenseSubmitPath}`,
    async (route) => {
      const pending = await (await page.request.get(budgetPath)).json();
      expect(pending.expenses).toEqual(initial.expenses);
      expect(pending.totals).toEqual(initial.totals);
      await route.fulfill({
        status: 503,
        json: { detail: "가상 증빙 전송 실패" },
      });
    },
    { times: 1 },
  );
  const save = dialog.getByRole("button", { name: "결의서 제출", exact: true });
  const [firstRequest] = await Promise.all([
    page.waitForRequest(isReceiptSubmission),
    save.click(),
  ]);
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByLabel("금액 (원)")).toHaveValue("20000");
  await expect(dialog.getByText(filename, { exact: true })).toBeVisible();
  const afterFailure = await (await page.request.get(budgetPath)).json();
  expect(afterFailure.expenses).toEqual(initial.expenses);
  expect(afterFailure.totals).toEqual(initial.totals);

  const [retryRequest] = await Promise.all([
    page.waitForRequest(isReceiptSubmission),
    dialog.getByRole("button", { name: /결의서 제출.*재시도/ }).click(),
  ]);
  for (const request of [firstRequest, retryRequest]) {
    expect(request.headers()["content-type"]).toMatch(
      /^multipart\/form-data;\s*boundary=/i,
    );
  }
  expect(submissions).toHaveLength(2);
  const [first, retry] = submissions;
  expect(first.expense.request_id).toEqual(expect.any(String));
  expect(retry).toEqual(first);
  expect(retry.filename).toBe(filename);
  expect(Buffer.from(retry.bytes)).toEqual(receipt);
  await expect(dialog).not.toBeVisible();
  const data = await (await page.request.get(budgetPath)).json();
  expect(data.totals.actual).toBe(20000);
  expect(data.totals.remaining).toBe(980000);
  expect(data.expenses).toHaveLength(1);
  const [expense] = data.expenses;
  expect(expense).toMatchObject({
    purpose: "가상 결의서 제출 재시도 확인",
    resolution: { title: "가상 영수증 재시도" },
    evidence_count: 1,
  });
  const files = await page.request.get(
    `/api/budgets/expenses/${expense.id}/evidence`,
  );
  expect(files.ok()).toBeTruthy();
  const evidence = await files.json();
  expect(evidence).toHaveLength(1);
  expect(evidence[0].filename).toBe(filename);

  const detail = page.locator(".finance-detail");
  await expect(detail.getByText(filename, { exact: true })).toBeVisible();
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get("budgetOrg") === "council" &&
      url.searchParams.get("budgetYear") === "2024" &&
      url.searchParams.get("expense") === expense.id,
  );
  await page.reload();
  await expect(
    page.getByRole("combobox", { name: "단체", exact: true }),
  ).toHaveValue("council");
  await expect(page.getByLabel("연도", { exact: true })).toHaveValue("2024");
  await expect(detail.getByText("첨부 증빙", { exact: true })).toBeVisible();
  await expect(detail.getByText(filename, { exact: true })).toBeVisible();

  const evidencePath = `/api/budgets/evidence/${evidence[0].id}`;
  const [preview] = await Promise.all([
    page.waitForResponse(
      (r) => new URL(r.url()).pathname === `${evidencePath}/preview`,
    ),
    detail.getByRole("button", { name: /미리보기/ }).click(),
  ]);
  expect(preview.ok()).toBeTruthy();
  expect(await preview.body()).toEqual(receipt);
  const image = page.getByRole("img", { name: /가상 영수증\.png.*미리보기/ });
  await expect(image).toHaveJSProperty("naturalWidth", 2);
  await expect(image).toHaveJSProperty("naturalHeight", 3);
  const [downloadResponse, downloaded] = await Promise.all([
    page.waitForResponse(
      (r) => new URL(r.url()).pathname === `${evidencePath}/download`,
    ),
    page.waitForEvent("download"),
    detail.getByRole("button", { name: /다운로드|내려받기/ }).click(),
  ]);
  expect(downloadResponse.ok()).toBeTruthy();
  expect(await downloadResponse.body()).toEqual(receipt);
  expect(downloaded.suggestedFilename()).toBe(filename);
});

test("예산 편성·지출·증빙·검토와 인수자 확인을 화면에서 이어간다", async ({
  page,
}) => {
  await login(page, "student-chair");
  const chair = await (await page.request.get("/api/me")).json();
  await switchAccount(page, "student-vice");
  const vice = await (await page.request.get("/api/me")).json();
  await switchAccount(page, "staff-demo");
  for (const capability of ["view", "plan", "record", "review", "evidence"]) {
    expect(
      (
        await page.request.post("/api/budgets/grants", {
          headers: { origin },
          data: {
            user_id: chair.id,
            org_id: "council",
            capability,
            enabled: true,
          },
        })
      ).ok(),
    ).toBeTruthy();
  }
  await switchAccount(page, "student-chair");
  await page.getByRole("button", { name: "예산 · 정산" }).click();
  const annual = page
    .locator("form")
    .filter({ has: page.getByRole("button", { name: "저장", exact: true }) });
  await annual.getByLabel("연간 예산 (원)").fill("1000000");
  await annual.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByText("연간 예산을 저장했습니다.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "행사 배정" })).toHaveCount(0);
  await page
    .getByRole("button", { name: "＋ 지출결의서 작성", exact: true })
    .click();
  const record = page.getByRole("dialog");
  await expect(record.getByLabel("예산 항목")).toHaveCount(0);
  await record.getByLabel("집행일").fill(`${new Date().getFullYear()}-05-20`);
  await record.getByLabel("실제 집행자").selectOption(vice.id);
  await record.getByLabel("금액 (원)").fill("100000");
  await record.getByLabel("결의서 제목").fill("가상 행사 준비");
  await record.getByLabel("지출 목적").fill("행사 준비에 필요한 물품 구입");
  const [jsonSubmission] = await Promise.all([
    page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/budgets/expenses",
    ),
    record.getByRole("button", { name: "결의서 제출" }).click(),
  ]);
  expect(jsonSubmission.headers()["content-type"]).toContain(
    "application/json",
  );
  expect(jsonSubmission.postDataJSON().amount).toBe(100000);
  await expect(
    page.getByText(/결의서를 제출했습니다.*증빙은 상세에서 추가/),
  ).toBeVisible();
  const unattached = page.getByRole("button", {
    name: /가상 행사 준비.*100,000원.*첨부 없음/,
  });
  await expect(unattached).toBeVisible();
  const detail = page.locator(".finance-detail");
  await expect(detail.getByText("첨부 증빙", { exact: true })).toBeVisible();
  await expect(detail.getByText("첨부 없음", { exact: true })).toBeVisible();
  const [oldUpload] = await Promise.all([
    page.waitForRequest(
      (request) =>
        request.method() === "PUT" &&
        /^\/api\/budgets\/expenses\/[^/]+\/evidence$/.test(
          new URL(request.url()).pathname,
        ),
    ),
    detail.getByLabel("증빙 추가 (50 MiB 이내)").setInputFiles({
      name: "receipt.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("synthetic receipt"),
    }),
  ]);
  expect(new URL(oldUpload.url()).searchParams.get("filename")).toBe(
    "receipt.txt",
  );
  await expect(page.getByText("증빙을 안전하게 등록했습니다.")).toBeVisible();
  await expect(detail.getByText("receipt.txt", { exact: true })).toBeVisible();
  const filters = page.getByRole("group", { name: "결의서 상태" });
  await filters.getByRole("button", { name: "검토 대기 1" }).click();
  await detail.getByRole("button", { name: "반려", exact: true }).click();
  await detail.getByLabel("반려 사유").fill("거래처를 적어 주세요.");
  await detail.getByRole("button", { name: "반려 확정", exact: true }).click();
  await filters.getByRole("button", { name: "반려 1" }).click();
  await expect(detail.locator(".finance-return-note")).toContainText(
    "거래처를 적어 주세요.",
  );
  await page.reload();
  await expect(detail.locator(".finance-return-note")).toContainText(
    "거래처를 적어 주세요.",
  );
  await detail
    .getByRole("button", { name: "보완 후 재제출", exact: true })
    .click();
  await detail.getByLabel("거래처 / 지급처").fill("가상 문구점");
  await detail.getByLabel("보완한 내용").fill("거래처를 추가했습니다.");
  await detail.getByRole("button", { name: "재제출", exact: true }).click();
  await expect(
    detail.getByText("거래처를 추가했습니다.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("finance-current-balance")).toHaveText(
    "900,000원",
  );
  await detail.getByRole("button", { name: "승인", exact: true }).click();
  await detail.getByRole("button", { name: "승인 확정", exact: true }).click();
  await filters.getByRole("button", { name: "승인 1" }).click();
  await expect(
    detail.getByText("지출결의 내용을 확인했습니다.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("searchbox", { name: "결의서 검색" })
    .fill("가상 문구점");
  await expect(
    page.getByRole("button", { name: /가상 행사 준비.*승인.*증빙 1개/ }),
  ).toBeVisible();
  await page
    .getByRole("searchbox", { name: "결의서 검색" })
    .fill("없는 결의서");
  await expect(page.getByText("조건에 맞는 결의서가 없습니다.")).toBeVisible();
  await page.getByRole("button", { name: "인수인계", exact: true }).click();
  const create = page
    .locator("form")
    .filter({ has: page.getByRole("button", { name: "묶음 만들기" }) });
  await create.getByLabel("인계자").selectOption(chair.id);
  await create.getByLabel("인수자").selectOption(vice.id);
  await create.getByLabel("제목").fill("가상 업무 승계");
  await create.getByRole("button", { name: "묶음 만들기" }).click();
  const item = page
    .locator("form")
    .filter({ has: page.getByRole("button", { name: "항목 추가" }) });
  await item.getByLabel("항목 설명").fill("가상 행사 자료 확인");
  await item.getByRole("button", { name: "항목 추가" }).click();
  await switchAccount(page, "student-vice");
  await page.getByRole("button", { name: "인수인계", exact: true }).click();
  await page.getByRole("button", { name: /가상 업무 승계/ }).click();
  await page.getByRole("button", { name: "확인했습니다" }).click();
  await page.getByRole("button", { name: "인수인계 완료" }).click();
  await expect(page.getByText("인수인계를 완료했습니다.")).toBeVisible();
});
