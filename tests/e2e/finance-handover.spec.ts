import { test, expect, login } from "../../apps/web/tests/browser-fixtures";

const origin = "http://127.0.0.1:5180";
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
  await cards.first().dragTo(cards.last());
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
    .getByRole("button", { name: "＋ 지출·증빙 등록", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("업로드 파일").setInputFiles({
    name: "가상 지출.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "용도,금액\n가상 물품,12000\n가상 인쇄,3000\n합계,15000\n",
    ),
  });
  await dialog
    .getByRole("button", { name: "엑셀·CSV 내역 읽기", exact: true })
    .click();
  await expect(
    dialog.getByRole("region", { name: "읽어온 지출 미리보기" }),
  ).toContainText("합계 15,000원");
  expect(
    (await (await page.request.get("/api/budgets/council/2025")).json()).totals
      .actual,
  ).toBe(0);
  await dialog
    .getByRole("button", { name: "확인한 합계를 지출 1건에 입력", exact: true })
    .click();
  await expect(dialog.getByLabel("금액 (원)")).toHaveValue("15000");
  await dialog.getByLabel("집행일").fill("2025-05-20");
  await dialog.getByLabel("용도").fill("가상 행사 지출 묶음");
  await dialog.screenshot({
    path: "../../local-data/preview/finance-import-preview.png",
  });
  await dialog.getByRole("button", { name: "지출 기록", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const result = await (
    await page.request.get("/api/budgets/council/2025")
  ).json();
  expect(result.totals.actual).toBe(15000);
  expect(result.totals.remaining).toBe(985000);
  expect(result.expenses[0].evidence_count).toBe(1);
  await expect(page.locator(".finance-balance-change")).toContainText(
    "1,000,000원 − 15,000원 = 잔액 985,000원",
  );
  await page
    .getByRole("button", { name: "증빙 목록 보기", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "가상 지출.csv 내려받기", exact: true }),
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
});

test("지출 저장 뒤 증빙 전송 실패를 재시도해도 예산이 이중 차감되지 않는다", async ({
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
    .getByRole("button", { name: "＋ 지출·증빙 등록", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("업로드 파일").setInputFiles({
    name: "receipt.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\nsynthetic receipt"),
  });
  await dialog.getByLabel("집행일").fill("2024-06-01");
  await dialog.getByLabel("용도").fill("가상 영수증 재시도");
  await dialog.getByLabel("금액 (원)").fill("20000");
  await page.route(
    "**/api/budgets/expenses/*/evidence?*",
    (route) => route.abort(),
    { times: 1 },
  );
  await dialog.getByRole("button", { name: "지출 기록", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("지출은 이미 기록되어");
  await expect(dialog.getByLabel("금액 (원)")).toBeDisabled();
  await dialog
    .getByRole("button", { name: "증빙·결과 확인 재시도", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  const data = await (
    await page.request.get("/api/budgets/council/2024")
  ).json();
  expect(data.totals.actual).toBe(20000);
  expect(
    data.expenses.filter(
      (e: { purpose: string }) => e.purpose === "가상 영수증 재시도",
    ),
  ).toHaveLength(1);
  expect(
    data.expenses.find(
      (e: { purpose: string }) => e.purpose === "가상 영수증 재시도",
    ).evidence_count,
  ).toBe(1);
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
  const event = page
    .locator("form")
    .filter({ has: page.getByRole("button", { name: "행사 등록" }) });
  await event.getByLabel("행사명").fill("가상 축제");
  await event.getByLabel("배정액").fill("300000");
  await event.getByRole("button", { name: "행사 등록" }).click();
  await expect(
    page.locator(".finance-list strong").filter({ hasText: "가상 축제" }),
  ).toBeVisible();
  await page.getByText("증빙 없이 지출 먼저 기록", { exact: true }).click();
  const record = page
    .locator("form")
    .filter({ has: page.getByRole("button", { name: "지출 기록" }) });
  await record.getByLabel("집행일").fill(`${new Date().getFullYear()}-05-20`);
  await record.getByLabel("실제 집행자").selectOption(vice.id);
  await record
    .locator('select[name="event_id"]')
    .selectOption({ label: "가상 축제" });
  await record.getByLabel("금액 (원)").fill("100000");
  await record.getByLabel("용도").fill("가상 행사 준비");
  await record.getByRole("button", { name: "지출 기록" }).click();
  await expect(
    page.getByText("실제 지출을 기록했습니다. 증빙을 첨부해 주세요."),
  ).toBeVisible();
  await page.getByRole("button", { name: /가상 행사 준비.*100,000원/ }).click();
  await page.getByLabel("증빙 추가 (50 MiB 이내)").setInputFiles({
    name: "receipt.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("synthetic receipt"),
  });
  await expect(page.getByText("증빙을 안전하게 등록했습니다.")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept("가상 확인"));
  await page.getByRole("button", { name: "개별 확인" }).click();
  await expect(
    page.getByText("처리 결과와 사유를 기록했습니다."),
  ).toBeVisible();
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
