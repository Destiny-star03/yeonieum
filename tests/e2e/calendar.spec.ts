import { test, expect, login } from "../../apps/web/tests/browser-fixtures";
import { mkdir } from "node:fs/promises";
import type { Locator, Page } from "@playwright/test";

async function pickDate(
  page: Page,
  editor: Locator,
  label: string,
  day: string,
) {
  await editor.getByRole("button", { name: label, exact: true }).click();
  const picker = page.getByRole("dialog", {
    name: `${label} 선택`,
    exact: true,
  });
  const target = day.slice(0, 7);
  for (let i = 0; i < 24; i++) {
    const heading = await picker.locator("header strong").innerText();
    const [year, month] = heading.match(/\d+/g)!;
    const current = `${year}-${month.padStart(2, "0")}`;
    if (current === target) break;
    await picker
      .getByRole("button", {
        name: current < target ? "다음 달" : "이전 달",
        exact: true,
      })
      .click();
  }
  await picker.getByRole("button", { name: day, exact: true }).click();
}

function dayOf(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}
function nextDay(day: string) {
  return new Date(Date.parse(`${day}T12:00:00Z`) + 86400000)
    .toISOString()
    .slice(0, 10);
}

async function openTimeSettings(editor: Locator) {
  const toggle = editor.getByRole("button", {
    name: "종일·시간대·반복 설정",
    exact: true,
  });
  if ((await toggle.getAttribute("aria-expanded")) === "false")
    await toggle.click();
}

function calendarPicker(editor: Locator) {
  return editor.getByRole("button", {
    name: "캘린더 · 공개 범위 및 일정 색상",
    exact: true,
  });
}

function calendarMenu(page: Page) {
  return page.getByRole("dialog", { name: "캘린더 및 일정 색상 선택" });
}

async function selectOnlyCalendar(menu: Locator, name: string) {
  const all = menu.getByRole("button", { name: "전체", exact: true });
  if ((await all.getAttribute("aria-pressed")) === "false") await all.click();
  await all.click();
  const option = menu.getByRole("button", {
    name,
    exact: true,
  });
  await option.click();
  return option;
}

async function selectCalendar(editor: Locator, name: string) {
  await calendarPicker(editor).click();
  const option = await selectOnlyCalendar(calendarMenu(editor.page()), name);
  await option.press("Escape");
}

test("달력 빈 곳을 누르면 편집을 마치고 기본 안내로 돌아가며 저장 중에는 닫지 않는다", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1100 });
  await login(page, "staff-demo");
  const cal = page.locator(".calendar-workspace");
  const today = dayOf(
    (await (await page.request.get("/api/workspace")).json()).server_time,
  );
  const add = cal.getByRole("button", {
    name: `${today} 일정 추가`,
    exact: true,
  });
  const editor = page
    .getByRole("dialog")
    .filter({ has: page.getByLabel("일정 제목") });
  await add.click();
  await add.click();
  await expect(editor).not.toBeVisible();
  await expect(
    cal.getByRole("heading", { name: "유용한 단축키" }),
  ).toBeVisible();
  await add.click();
  await editor.getByLabel("일정 제목").fill("가상 빈 공간 전환");
  page.once("dialog", (d) => d.dismiss());
  await add.click();
  await expect(editor.getByLabel("일정 제목")).toHaveValue("가상 빈 공간 전환");
  page.once("dialog", (d) => d.accept());
  await add.click();
  await expect(editor).not.toBeVisible();
  await add.click();
  await editor.getByLabel("일정 제목").fill("가상 빈 공간 저장");
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/calendar/events", async (route) => {
    if (route.request().method() === "POST") await blocked;
    await route.continue();
  });
  await editor.getByRole("button", { name: "일정 추가", exact: true }).click();
  await expect(editor.getByLabel("일정 제목")).toBeDisabled();
  await add.click();
  await expect(editor).toBeVisible();
  release();
  await expect(editor).not.toBeVisible();
  await page.unroute("**/api/calendar/events");
  const event = cal.locator(".notion-month").getByRole("button", {
    name: `가상 빈 공간 저장 일정 열기 · ${today}`,
    exact: true,
  });
  await event.click();
  await expect(editor.getByLabel("일정 제목")).toHaveValue("가상 빈 공간 저장");
  await cal.getByLabel("캘린더 보기", { exact: true }).selectOption("day");
  await cal
    .getByRole("button", { name: `${today} 11:00 일정 추가`, exact: true })
    .click();
  await expect(editor).not.toBeVisible();
  await expect(
    cal.getByRole("heading", { name: "유용한 단축키" }),
  ).toBeVisible();
});

test("종일·시간대·반복은 요약 줄에서 펼치고 접어도 입력을 보존하며 저장 전에는 요청하지 않는다", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await login(page, "staff-demo");
  await page
    .locator(".calendar-workspace")
    .getByRole("button", { name: "＋ 일정 추가", exact: true })
    .click();
  const editor = page
    .getByRole("dialog")
    .filter({ has: page.getByLabel("일정 제목") });
  const toggle = editor.getByRole("button", {
    name: "종일·시간대·반복 설정",
    exact: true,
  });
  const allDay = editor.getByRole("checkbox", { name: "종일", exact: true });
  const zone = editor.getByLabel("시간대", { exact: true });
  const repeat = editor.getByRole("button", { name: "반복 설정", exact: true });
  let writes = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/calendar/events") && r.method() === "POST")
      writes++;
  });
  await expect(toggle).toHaveText("종일시간대반복");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(allDay).not.toBeVisible();
  await expect(zone).not.toBeVisible();
  await expect(repeat).not.toBeVisible();
  await page.mouse.move(0, 0);
  const background = await toggle.evaluate(
    (el) => getComputedStyle(el).backgroundColor,
  );
  await toggle.hover();
  await expect
    .poll(() => toggle.evaluate((el) => getComputedStyle(el).backgroundColor))
    .not.toBe(background);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await mkdir("../../local-data/preview", { recursive: true });
  await editor.locator("fieldset").first().screenshot({
    path: "../../local-data/preview/calendar-settings-hover.png",
  });
  await toggle.focus();
  await toggle.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(allDay).toBeVisible();
  await expect(zone).toBeVisible();
  await expect(repeat).toHaveText("반복⌄");
  await expect(repeat.locator("svg[aria-hidden=true]")).toBeVisible();
  await editor.locator("fieldset").first().screenshot({
    path: "../../local-data/preview/calendar-settings-expanded.png",
  });
  await zone.selectOption("UTC");
  await repeat.click();
  await page
    .getByRole("menuitemradio", { name: "1일마다", exact: true })
    .click();
  await allDay.check();
  await expect(zone).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 800 });
    await toggle.click();
    await expect(allDay).toBeChecked();
    await expect(repeat).toContainText("1일마다");
    await toggle.click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await toggle.click();
  await allDay.uncheck();
  await expect(zone).toHaveValue("UTC");
  expect(writes).toBe(0);
  await editor.getByLabel("일정 제목").fill("가상 접힌 시간 설정");
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/calendar/events") &&
      r.request().method() === "POST",
  );
  await editor.getByRole("button", { name: "일정 추가", exact: true }).click();
  expect(await (await response).json()).toMatchObject({
    all_day: false,
    time_zone: "UTC",
    recurrence: { frequency: "daily" },
  });
  expect(writes).toBe(1);
  await page
    .locator(".calendar-workspace")
    .getByRole("button", { name: "＋ 일정 추가", exact: true })
    .click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
});

test("요일 반복 메뉴와 사용자 지정에서 간격·여러 요일·종료 횟수를 저장한다", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1100 });
  await login(page, "staff-demo");
  const today = dayOf(
    (await (await page.request.get("/api/workspace")).json()).server_time,
  );
  await page
    .getByRole("button", { name: `${today} 일정 추가`, exact: true })
    .click();
  const editor = page
    .getByRole("dialog")
    .filter({ has: page.getByLabel("일정 제목") });
  await editor.getByLabel("일정 제목").fill("가상 요일 반복");
  await openTimeSettings(editor);
  const trigger = editor.getByRole("button", {
    name: "반복 설정",
    exact: true,
  });
  await trigger.click();
  const weekdays = page.getByRole("menuitemradio", {
    name: "평일마다 월~금",
    exact: true,
  });
  const detail = weekdays.getByText("월~금", { exact: true });
  const durationColor = await editor
    .getByLabel("일정 길이")
    .evaluate((element) => getComputedStyle(element).color);
  await expect(detail).toHaveCSS("color", durationColor);
  expect(
    await detail.evaluate((element) =>
      parseFloat(getComputedStyle(element).fontSize),
    ),
  ).toBeCloseTo(12 + 4 / 3, 3);
  await weekdays.click();
  await expect(trigger).toContainText("월·화·수·목·금");
  await trigger.click();
  await page
    .getByRole("menuitem", { name: "사용자 지정…", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "반복", exact: true });
  await dialog.getByLabel("반복 간격").fill("2");
  for (const name of ["화요일", "목요일", "금요일"])
    await dialog.getByRole("button", { name, exact: true }).click();
  await dialog
    .getByRole("radio", { name: "횟수 후 종료", exact: true })
    .check();
  await dialog.getByLabel("반복 횟수").fill("4");
  await dialog.screenshot({
    path: "../../local-data/preview/calendar-custom-repeat.png",
  });
  await dialog.getByRole("button", { name: "완료", exact: true }).click();
  await expect(editor).toBeVisible();
  await expect(trigger).toContainText("2주마다 월·수 · 4회");
  await trigger.click();
  await page
    .getByRole("menuitem", { name: "사용자 지정…", exact: true })
    .click();
  await dialog.getByLabel("반복 간격").fill("7");
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  await expect(trigger).toContainText("2주마다 월·수 · 4회");
  await editor.getByRole("button", { name: "일정 추가", exact: true }).click();
  await expect(editor).not.toBeVisible();
  const result = await (
    await page.request.get(
      `/api/calendar/search?q=${encodeURIComponent("가상 요일 반복")}`,
    )
  ).json();
  expect(result.events[0].recurrence).toMatchObject({
    frequency: "weekly",
    interval: 2,
    weekdays: [1, 3],
    count: 4,
    until: null,
  });
  await page.reload();
  await page
    .getByRole("button", { name: `${today} 일정 추가`, exact: true })
    .click();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await openTimeSettings(editor);
    await trigger.click();
    await page
      .getByRole("menuitem", { name: "사용자 지정…", exact: true })
      .click();
    const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    await dialog.getByRole("button", { name: "취소", exact: true }).click();
  }
});

test("단체 기본색을 저장하고 개별 일정 색에 우선 적용하지 않는다", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await login(page, "staff-demo");
  const today = dayOf(
    (await (await page.request.get("/api/workspace")).json()).server_time,
  );
  await page
    .getByRole("button", { name: `${today} 일정 추가`, exact: true })
    .click();
  const editor = page
    .getByRole("dialog")
    .filter({ has: page.getByLabel("일정 제목") });
  await editor.getByLabel("일정 제목").fill("가상 색상 선택 확인");
  if (
    await page.evaluate(
      () =>
        CSS.supports("appearance", "base-select") &&
        CSS.supports("selector(::picker(select))"),
    )
  ) {
    const status = editor.getByLabel("상태", { exact: true });
    await status.click();
    const statusBox = (await status.boundingBox())!;
    const optionBox = (await status
      .locator('option[value="free"]')
      .boundingBox())!;
    expect(optionBox.width).toBeGreaterThan(0);
    expect(optionBox.x + optionBox.width).toBeLessThan(statusBox.x);
    await page.keyboard.press("Escape");
  }
  const trigger = calendarPicker(editor);
  await trigger.click();
  const palette = calendarMenu(page);
  await expect(palette.locator('button[aria-pressed="true"]')).toBeFocused();
  const triggerBox = (await trigger.boundingBox())!;
  const paletteBox = (await palette.boundingBox())!;
  expect(paletteBox.x + paletteBox.width).toBeLessThan(triggerBox.x);
  await selectOnlyCalendar(palette, "학과협의회");
  await palette.getByRole("radio", { name: "빨강", exact: true }).click();
  await expect(trigger).toHaveAttribute("title", "빨강");
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(
    palette.getByRole("radio", { name: "빨강", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await page.screenshot({
    path: "../../local-data/preview/calendar-color-palette.png",
  });
  await palette
    .getByRole("radio", { name: "빨강", exact: true })
    .press("ArrowRight");
  await expect(
    palette.getByRole("radio", { name: "주황", exact: true }),
  ).toBeFocused();
  await palette
    .getByRole("radio", { name: "주황", exact: true })
    .press("Escape");
  await expect(palette).not.toBeVisible();
  await expect(editor).toBeVisible();
  await trigger.click();
  await editor.getByLabel("일정 제목").click();
  await expect(palette).not.toBeVisible();
  await editor.getByRole("button", { name: "일정 추가", exact: true }).click();
  await expect(editor).not.toBeVisible();
  await page.reload();
  const event = page.locator(".notion-month").getByRole("button", {
    name: `가상 색상 선택 확인 일정 열기 · ${today}`,
    exact: true,
  });
  await expect(event).toHaveClass(/cal-color-red/);
  const orgColor = page.getByRole("button", {
    name: "학과협의회 기본색 선택",
    exact: true,
  });
  const orgPalette = page.getByRole("dialog", {
    name: "학과협의회 기본색",
    exact: true,
  });
  await orgColor.click();
  await expect(orgPalette).toBeVisible();
  const reset = orgPalette.getByRole("radio", {
    name: "기본색으로 되돌리기",
    exact: true,
  });
  await expect(reset).toBeFocused();
  await orgPalette.getByRole("radio", { name: "파랑", exact: true }).click();
  await expect(orgColor.locator(".cal-scope-swatch")).toHaveCSS(
    "background-color",
    "rgb(82, 127, 206)",
  );
  await expect(event).toHaveClass(/cal-color-red/);
  await event.click();
  await expect(trigger).toHaveAttribute("title", "빨강");
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await trigger.click();
    const box = await palette.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    await palette.getByRole("radio", { name: "초록", exact: true }).click();
  }
  await trigger.click();
  await expect(palette.locator(".cal-color-default > i")).toHaveCSS(
    "background-color",
    "rgb(82, 127, 206)",
  );
  await palette
    .getByRole("radio", { name: "단체 기본색", exact: true })
    .click();
  await editor.getByRole("button", { name: "변경 저장", exact: true }).click();
  await expect(event).toHaveClass(/cal-color-blue/);
  const stored = await page.request.get(
    "/api/calendar/search?q=" + encodeURIComponent("가상 색상 선택 확인"),
  );
  expect((await stored.json()).events[0].color).toBe("default");
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.reload();
  await expect(event).toHaveClass(/cal-color-blue/);
  await orgColor.click();
  await expect(
    orgPalette.getByRole("radio", { name: "파랑", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await reset.click();
  await expect(event).toHaveClass(/cal-color-default/);
});

test("단체를 여러 개 또는 전체 선택해 일정 한 건을 공유한다", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1100 });
  await login(page, "staff-demo");
  const today = dayOf(
    (await (await page.request.get("/api/workspace")).json()).server_time,
  );
  const calendar = page.locator(".calendar-workspace");
  const add = calendar.getByRole("button", {
    name: "＋ 일정 추가",
    exact: true,
  });
  const editor = page
    .getByRole("dialog")
    .filter({ has: page.getByLabel("일정 제목") });
  const menu = calendarMenu(page);
  const groups = menu.getByRole("group", { name: "단체 캘린더" });
  const all = groups.getByRole("button", { name: "전체", exact: true });
  const save = editor.getByRole("button", { name: "일정 추가", exact: true });
  const council = groups.getByRole("button", {
    name: "학과협의회",
    exact: true,
  });
  const student = groups.getByRole("button", { name: "총학생회", exact: true });
  const waitForSave = () =>
    page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/calendar/events") &&
        response.request().method() === "POST",
    );

  await add.click();
  await editor.getByLabel("일정 제목").fill("가상 공동 일정");
  await calendarPicker(editor).click();
  const orgCount = (await groups.getByRole("button").count()) - 1;
  await all.click();
  await expect(groups.locator('button[aria-pressed="true"]')).toHaveCount(
    orgCount + 1,
  );
  await all.click();
  await expect(save).toBeDisabled();
  await council.click();
  await student.click();
  await expect(council).toHaveAttribute("aria-pressed", "true");
  await expect(student).toHaveAttribute("aria-pressed", "true");
  await expect(all).toHaveAttribute("aria-pressed", "false");
  await student.press("Escape");
  const saved = waitForSave();
  await save.click();
  const response = await saved;
  expect(response.ok()).toBeTruthy();
  const joint = await response.json();
  expect(
    joint.calendars.map((target: { org_id: string }) => target.org_id),
  ).toEqual(["council", "student"]);
  const chip = calendar.getByRole("button", {
    name: `가상 공동 일정 일정 열기 · ${today}`,
    exact: true,
  });
  await expect(chip).toHaveCount(1);
  const councilEye = calendar.getByRole("button", {
    name: "학과협의회 일정 표시",
    exact: true,
  });
  const studentEye = calendar.getByRole("button", {
    name: "총학생회 일정 표시",
    exact: true,
  });
  await councilEye.click();
  await expect(chip).toHaveCount(1);
  await studentEye.click();
  await expect(chip).toHaveCount(0);
  await councilEye.click();
  await expect(chip).toHaveCount(1);

  await add.click();
  await editor.getByLabel("일정 제목").fill("가상 전체 단체 일정");
  await calendarPicker(editor).click();
  await all.click();
  await expect(calendarPicker(editor)).toContainText("전체");
  await all.press("Escape");
  const savedAll = waitForSave();
  await save.click();
  const allResponse = await savedAll;
  expect(allResponse.ok()).toBeTruthy();
  expect((await allResponse.json()).calendars).toHaveLength(orgCount);
});

test("시작 시간을 바꾸면 기본 30분 또는 직접 설정한 일정 길이를 유지해 종료 시간과 날짜를 옮긴다", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await login(page, "staff-demo");
  const today = dayOf(
    (await (await page.request.get("/api/workspace")).json()).server_time,
  );
  await page
    .locator(".calendar-workspace")
    .getByRole("button", { name: `${today} 일정 추가`, exact: true })
    .click();
  const editor = page
    .getByRole("dialog")
    .filter({ has: page.getByLabel("일정 제목") });
  const start = editor.getByRole("combobox", {
    name: "시작 시간",
    exact: true,
  });
  const end = editor.getByRole("combobox", { name: "종료 시간", exact: true });
  const length = editor.getByLabel("일정 길이");
  await expect(length).toHaveText("30분");
  await start.fill("19:15");
  await expect(end).toHaveValue("19:45");
  await expect(length).toHaveText("30분");
  await start.fill("00:00");
  await expect(end).toHaveValue("00:30");
  await end.fill("01:15");
  await expect(length).toHaveText("1시간 15분");
  await start.fill("12:00");
  await expect(end).toHaveValue("13:15");
  await expect(length).toHaveText("1시간 15분");
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 800 });
    await start.scrollIntoViewIfNeeded();
    const endBox = await end.boundingBox(),
      lengthBox = await length.boundingBox();
    expect(lengthBox!.x).toBeGreaterThanOrEqual(endBox!.x + endBox!.width);
    expect(lengthBox!.y).toBeGreaterThanOrEqual(endBox!.y);
    expect(lengthBox!.y + lengthBox!.height).toBeLessThanOrEqual(
      endBox!.y + endBox!.height,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await mkdir("../../local-data/preview", { recursive: true });
  await editor
    .locator(".cal-period-times")
    .screenshot({ path: "../../local-data/preview/calendar-duration.png" });
  await start.fill("2");
  await expect(end).toHaveValue("13:15");
  await start.fill("23:30");
  await expect(end).toHaveValue("00:45");
  await expect(length).toHaveText("1시간 15분");
  await expect(
    editor.getByRole("button", { name: "종료일", exact: true }),
  ).toHaveAttribute("title", `종료일 · ${nextDay(today)}`);
  const title = `시간 연동 ${Date.now()}`;
  await editor.getByLabel("일정 제목").fill(title);
  const created = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/calendar/events") &&
      r.request().method() === "POST",
  );
  await editor.getByRole("button", { name: "일정 추가", exact: true }).click();
  const saved = await (await created).json();
  expect(Date.parse(saved.starts_at)).toBe(
    Date.parse(`${today}T23:30:00+09:00`),
  );
  expect(Date.parse(saved.ends_at)).toBe(
    Date.parse(`${nextDay(today)}T00:45:00+09:00`),
  );
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.reload();
  await page
    .locator(".calendar-event")
    .filter({ hasText: title })
    .first()
    .click();
  await expect(length).toHaveText("1시간 15분");
  await openTimeSettings(editor);
  await editor.getByLabel("시간대", { exact: true }).selectOption("UTC");
  await start.click();
  await page
    .getByRole("listbox", { name: "시작 시간 선택" })
    .getByRole("option", { name: "08:00", exact: true })
    .click();
  await expect(end).toHaveValue("09:15");
  await expect(length).toHaveText("1시간 15분");
  await expect(
    editor.getByRole("button", { name: "종료일", exact: true }),
  ).toHaveAttribute("title", `종료일 · ${today}`);
  const updated = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/api/calendar/events/${saved.id}/update`) &&
      r.request().method() === "POST",
  );
  await editor.getByRole("button", { name: "변경 저장", exact: true }).click();
  const result = await (await updated).json();
  expect(Date.parse(result.starts_at)).toBe(Date.parse(`${today}T08:00:00Z`));
  expect(Date.parse(result.ends_at)).toBe(Date.parse(`${today}T09:15:00Z`));
});

test("날짜·시간 선택창과 종일 전환을 데스크톱·모바일에서 사용한다", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await login(page, "staff-demo");
  const today = dayOf(
    (await (await page.request.get("/api/workspace")).json()).server_time,
  );
  const tomorrow = nextDay(today);
  await page
    .locator(".calendar-workspace")
    .getByRole("button", { name: `${today} 일정 추가`, exact: true })
    .click();
  const editor = page
    .getByRole("dialog")
    .filter({ has: page.getByLabel("일정 제목") });
  const start = editor.getByRole("combobox", {
    name: "시작 시간",
    exact: true,
  });
  const end = editor.getByRole("combobox", { name: "종료 시간", exact: true });
  const startBox = await start.boundingBox(),
    endBox = await end.boundingBox();
  expect(startBox!.y).toBe(endBox!.y);
  await start.fill("00:00");
  await end.click();
  const times = page.getByRole("listbox", { name: "종료 시간 선택" });
  await expect(times.getByRole("option")).toHaveCount(96);
  await expect(
    times.getByRole("option", { name: "01:00 1시간", exact: true }),
  ).toBeAttached();
  await times
    .getByRole("option", { name: "18:30 18시간 30분", exact: true })
    .click();
  await expect(end).toHaveValue("18:30");
  await expect(editor.getByLabel("일정 길이")).toHaveText("18시간 30분");
  await end.click();
  await page.screenshot({
    path: "../../local-data/preview/calendar-time-picker.png",
  });
  await end.press("Escape");
  await expect(times).not.toBeVisible();
  await expect(editor).toBeVisible();
  await end.press("ArrowDown");
  await end.press("ArrowDown");
  await end.press("Enter");
  await expect(end).toHaveValue("18:45");
  await openTimeSettings(editor);
  await editor.getByRole("checkbox", { name: "종일", exact: true }).check();
  await expect(start).not.toBeVisible();
  await expect(end).not.toBeVisible();
  await expect(editor.getByLabel("시간대", { exact: true })).toHaveCount(0);
  await pickDate(page, editor, "종료일", tomorrow);
  await editor.getByRole("button", { name: "시작일", exact: true }).click();
  const dates = page.getByRole("dialog", { name: "시작일 선택", exact: true });
  await expect(
    dates.getByRole("button", { name: today, exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(dates.locator("[aria-current='date']")).toHaveCount(1);
  await dates.getByRole("button", { name: "다음 달", exact: true }).click();
  await dates.getByRole("button", { name: "이전 달", exact: true }).click();
  await dates.getByRole("button", { name: today, exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    dates.getByRole("button", { name: tomorrow, exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dates).not.toBeVisible();
  await expect(
    editor.getByRole("button", { name: "시작일", exact: true }),
  ).toBeFocused();
  await page.screenshot({
    path: "../../local-data/preview/calendar-all-day-editor.png",
  });
  await editor.getByRole("checkbox", { name: "종일", exact: true }).uncheck();
  await expect(end).toHaveValue("18:45");
  await expect(editor.getByLabel("일정 길이")).toHaveText("1일 18시간 45분");
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 700 });
    await editor.getByRole("button", { name: "종료일", exact: true }).click();
    const popup = page.getByRole("dialog", {
      name: "종료일 선택",
      exact: true,
    });
    await expect(popup).toBeVisible();
    const box = await popup.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(700);
    await page.screenshot({
      path: `../../local-data/preview/calendar-date-picker-${width}.png`,
    });
    await page.keyboard.press("Escape");
    await end.click();
    const timeBox = await times.boundingBox();
    expect(timeBox!.x + timeBox!.width).toBeLessThanOrEqual(width);
    await editor.getByLabel("일정 제목").click();
    await expect(times).not.toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await editor.getByRole("button", { name: "취소", exact: true }).click();
});

test("대시보드 캘린더에 종일·시간 일정을 저장하고 수정·필터·삭제한다", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1100 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page, "staff-demo");
  const today = dayOf(
    (await (await page.request.get("/api/workspace")).json()).server_time,
  );
  const tomorrow = nextDay(today);
  const calendar = page.locator(".calendar-workspace");
  await expect(
    calendar.getByRole("heading", { name: "우리의 일정" }),
  ).toBeVisible();
  await expect(
    page.locator(".dashboard-summary,.dashboard-charts,.dashboard-tables"),
  ).toHaveCount(0);
  await calendar
    .getByRole("button", { name: `${today} 일정 추가`, exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("일정 제목").fill("가상 운영 회의");
  await selectCalendar(dialog, "학과협의회");
  await openTimeSettings(dialog);
  await dialog.getByRole("checkbox", { name: "종일", exact: true }).check();
  await pickDate(page, dialog, "종료일", tomorrow);
  const location = dialog.getByLabel("장소", { exact: true });
  await expect(location).toBeVisible();
  await location.fill("가상 회의실");
  await dialog.getByRole("button", { name: "일정 추가", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const grid = calendar.locator(".notion-month");
  await expect(
    grid.getByRole("button", {
      name: `가상 운영 회의 일정 열기 · ${today}`,
      exact: true,
    }),
  ).toBeVisible();
  const spanningBar = grid.getByRole("button", {
    name: `가상 운영 회의 일정 열기 · ${today}`,
    exact: true,
  });
  const barBox = await spanningBar.boundingBox();
  const dayBox = await grid.locator(`[data-date="${today}"]`).boundingBox();
  const crossesWeek = new Date(`${today}T12:00Z`).getUTCDay() === 6;
  expect(barBox!.width).toBeGreaterThan(
    dayBox!.width * (crossesWeek ? 0.9 : 1.7),
  );
  if (crossesWeek) {
    await expect(
      grid.getByRole("button", {
        name: `가상 운영 회의 일정 열기 · ${tomorrow}`,
        exact: true,
      }),
    ).toBeVisible();
  }
  await page.reload();
  await expect(
    grid.getByRole("button", {
      name: `가상 운영 회의 일정 열기 · ${today}`,
      exact: true,
    }),
  ).toBeVisible();
  await grid
    .getByRole("button", {
      name: `가상 운영 회의 일정 열기 · ${today}`,
      exact: true,
    })
    .click();
  await expect(location).toHaveValue("가상 회의실");
  await dialog.getByLabel("일정 제목").fill("가상 운영 회의 변경");
  await openTimeSettings(dialog);
  await dialog.getByRole("checkbox", { name: "종일", exact: true }).uncheck();
  await pickDate(page, dialog, "종료일", today);
  await dialog.getByLabel("시작 시간", { exact: true }).fill("13:00");
  await dialog.getByLabel("종료 시간", { exact: true }).fill("14:00");
  await dialog.getByRole("button", { name: "변경 저장", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const event = grid.getByRole("button", {
    name: `가상 운영 회의 변경 일정 열기 · ${today}`,
    exact: true,
  });
  await expect(event).toBeVisible();
  const eye = calendar.getByRole("button", {
    name: "학과협의회 일정 표시",
    exact: true,
  });
  await expect(eye).toHaveAttribute("aria-pressed", "true");
  const openEye = await eye.locator("path").getAttribute("d");
  await eye.click();
  await expect(eye).toHaveAttribute("aria-pressed", "false");
  expect(await eye.locator("path").getAttribute("d")).not.toBe(openEye);
  await expect(event).toHaveCount(0);
  await eye.click();
  await expect(eye).toHaveAttribute("aria-pressed", "true");
  await expect(event).toBeVisible();
  await mkdir("../../local-data/preview", { recursive: true });
  await expect(page.locator(".workspace-skip")).not.toBeFocused();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "../../local-data/preview/calendar-desktop.png",
    fullPage: true,
  });
  await event.click();
  await dialog.getByLabel("일정 더보기").click();
  await dialog.getByRole("button", { name: "일정 삭제", exact: true }).click();
  await expect(
    dialog.getByText("이 일정을 삭제하시겠습니까?", { exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "삭제 취소", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "변경 저장", exact: true }),
  ).toBeEnabled();
  await dialog.getByLabel("일정 더보기").click();
  await dialog.getByRole("button", { name: "일정 삭제", exact: true }).click();
  await dialog.getByRole("button", { name: "삭제하기", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(event).toHaveCount(0);
  await page.reload();
  await expect(event).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("모바일에서 상위 조직 일정은 읽기 전용이며 내 반 일정은 추가하고 주간으로 볼 수 있다", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await login(page, "staff-demo");
  const time = (await (await page.request.get("/api/workspace")).json())
    .server_time;
  const today = dayOf(time),
    tomorrow = nextDay(today);
  const created = await page.request.post("/api/calendar/events", {
    headers: { origin: "http://127.0.0.1:5180" },
    data: {
      unit_id: "software",
      title: "가상 학과 전체 일정",
      starts_at: new Date(`${today}T09:00:00+09:00`).toISOString(),
      ends_at: new Date(`${today}T10:00:00+09:00`).toISOString(),
    },
  });
  expect(created.ok()).toBeTruthy();
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await login(page, "student-rep");
  const calendar = page.locator(".calendar-workspace"),
    grid = calendar.locator(".notion-month");
  await grid
    .getByRole("button", {
      name: `가상 학과 전체 일정 일정 열기 · ${today}`,
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("일정 제목")).toBeDisabled();
  await openTimeSettings(dialog);
  await expect(
    dialog.getByRole("checkbox", { name: "종일", exact: true }),
  ).toBeDisabled();
  await expect(dialog.getByLabel("시간대", { exact: true })).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "반복 설정", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "일정 삭제", exact: true }),
  ).toHaveCount(0);
  await dialog.getByRole("button", { name: "닫기", exact: true }).click();
  await calendar
    .getByRole("button", { name: `${today} 일정 추가`, exact: true })
    .click();
  await dialog.getByLabel("일정 제목").fill("가상 반 야간 준비");
  await calendarPicker(dialog).click();
  const groups = calendarMenu(page).getByRole("group", { name: "단체 캘린더" });
  await expect(groups.getByRole("button")).toHaveCount(2);
  await expect(
    groups.getByRole("button", { name: "학과협의회", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await dialog.getByLabel("시작 시간", { exact: true }).fill("23:30");
  await pickDate(page, dialog, "종료일", tomorrow);
  await dialog.getByLabel("종료 시간", { exact: true }).fill("00:30");
  const createdClass = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/calendar/events") &&
      response.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "일정 추가", exact: true }).click();
  expect(await (await createdClass).json()).toMatchObject({
    unit_id: "software-1-A",
  });
  await expect(dialog).not.toBeVisible();
  await calendar
    .getByLabel("캘린더 보기", { exact: true })
    .selectOption("week");
  await expect(
    calendar.getByLabel("주간 일정", { exact: true }).getByRole("button", {
      name: `가상 반 야간 준비 일정 열기 · ${today}`,
      exact: true,
    }),
  ).toBeAttached();
  if (new Date(`${today}T12:00Z`).getUTCDay() === 6) {
    await calendar
      .getByRole("button", { name: "다음 기간", exact: true })
      .click();
  }
  await expect(
    calendar.getByLabel("주간 일정", { exact: true }).getByRole("button", {
      name: `가상 반 야간 준비 일정 열기 · ${tomorrow}`,
      exact: true,
    }),
  ).toBeAttached();
  await expect(calendar.getByLabel("주간 일정", { exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "../../local-data/preview/calendar-week-mobile.png",
    fullPage: true,
  });
  await calendar
    .getByRole("button", { name: "다음 기간", exact: true })
    .click();
  await calendar.getByRole("button", { name: "오늘", exact: true }).click();
  await calendar
    .getByLabel("캘린더 보기", { exact: true })
    .selectOption("month");
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 1000 });
  await expect(
    calendar.getByRole("button", {
      name: "가상 반 야간 준비 상세 보기",
      exact: true,
    }),
  ).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "../../local-data/preview/calendar-mobile.png",
    fullPage: true,
  });
});

test("일정 항목을 줄에서 바로 입력하고 단체·링크 메뉴를 열어 편집한다", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1800, height: 1100 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page, "staff-demo");
  const time = (await (await page.request.get("/api/workspace")).json())
    .server_time;
  const today = dayOf(time),
    tomorrow = nextDay(today);
  const until = new Date(Date.parse(`${today}T12:00:00Z`) + 21 * 86400000)
    .toISOString()
    .slice(0, 10);
  const cal = page.locator(".calendar-workspace");
  await expect(
    cal.getByRole("button", { name: "학과협의회 일정 표시", exact: true }),
  ).toBeVisible();
  await expect(cal.getByLabel("작은 달력", { exact: true })).toBeVisible();
  await page.keyboard.press("Control+k");
  const commands = page.getByRole("dialog", {
    name: "명령어 메뉴",
    exact: true,
  });
  await expect(commands).toBeVisible();
  await commands.getByLabel("명령어 검색").fill("일 보기");
  await commands.getByRole("button", { name: /일 보기/ }).click();
  await expect(cal.getByLabel("일간 일정", { exact: true })).toBeVisible();
  await page.keyboard.press("m");
  await expect(cal.getByLabel("월간 일정", { exact: true })).toBeVisible();
  await cal
    .locator(`[data-date="${today}"] .calendar-day-top`)
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: /이벤트 만들기/ }).click();
  const editor = page
    .getByRole("dialog")
    .filter({ has: page.getByLabel("일정 제목") });
  await editor.getByLabel("일정 제목").fill("가상 반복 운영회의");
  await expect(
    editor.getByRole("combobox", { name: "시작 시간" }),
  ).toBeVisible();
  await expect(calendarPicker(editor)).toBeVisible();
  await expect(editor.getByLabel("정보 표시 여부")).toBeVisible();
  const description = editor.getByLabel("설명", { exact: true });
  await expect(description).toBeVisible();
  await description.fill("가상 설명");
  await openTimeSettings(editor);
  await calendarPicker(editor).click();
  const calendars = calendarMenu(page).getByRole("group", {
    name: "단체 캘린더",
  });
  await expect(
    calendars.getByRole("button", { name: "학과협의회", exact: true }),
  ).toHaveCount(1);
  await expect(
    calendars.getByText("스마트소프트웨어학과", { exact: false }),
  ).toHaveCount(0);
  await selectOnlyCalendar(calendarMenu(page), "학과협의회");
  await page.keyboard.press("Escape");
  await editor.getByRole("button", { name: "반복 설정", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "사용자 지정…", exact: true })
    .click();
  const repeatDialog = page.getByRole("dialog", { name: "반복", exact: true });
  await repeatDialog
    .getByRole("radio", { name: "날짜에 종료", exact: true })
    .check();
  await pickDate(page, repeatDialog, "반복 종료일", until);
  await repeatDialog.getByRole("button", { name: "완료", exact: true }).click();
  const participants = editor.getByLabel("참여자 검색");
  await participants.fill("부학회장");
  await page
    .getByRole("dialog", { name: "참여자 선택" })
    .getByRole("checkbox", { name: "가상 부학회장", exact: true })
    .check();
  await editor.getByLabel("일정 제목").click();
  await expect(participants).toHaveAttribute("placeholder", "참여자 · 1명");
  const references = editor.getByRole("button", { name: /링크 및 첨부 자료/ });
  const referencesMenu = page.getByRole("dialog", {
    name: "링크 및 첨부 자료",
  });
  await references.click();
  await referencesMenu.getByRole("button", { name: /링크 추가/ }).click();
  await referencesMenu.getByLabel("링크 1 이름").fill("가상 회의 자료");
  await referencesMenu.getByLabel("링크 1 주소").fill("잘못된 주소");
  await references.click();
  await expect(referencesMenu).toBeHidden();
  const submit = editor.getByRole("button", { name: "일정 추가", exact: true });
  await submit.click();
  await expect(referencesMenu.getByLabel("링크 1 주소")).toBeVisible();
  await expect(referencesMenu.getByLabel("링크 1 주소")).toBeFocused();
  await referencesMenu
    .getByLabel("링크 1 주소")
    .fill("https://example.com/meeting");
  await references.click();
  await expect(references).toContainText("1개");
  await editor.getByLabel("상태", { exact: true }).selectOption("free");
  await editor.getByLabel("정보 표시 여부").selectOption("busy");
  await calendarPicker(editor).click();
  await page.getByRole("radio", { name: "스톤", exact: true }).click();
  const reminder = editor.getByRole("button", { name: /^리마인더/ });
  await reminder.click();
  await page
    .getByRole("dialog", { name: "리마인더" })
    .getByRole("button", { name: /리마인더 추가/ })
    .click();
  await reminder.click();
  await expect(reminder).toContainText("1개");
  await submit.click();
  await expect(editor).not.toBeVisible();
  const original = cal
    .getByLabel("월간 일정", { exact: true })
    .getByRole("button", {
      name: `가상 반복 운영회의 일정 열기 · ${today}`,
      exact: true,
    });
  await expect(original).toBeVisible();
  const repeatDay = new Date(Date.parse(`${today}T12:00:00Z`) + 7 * 86400000)
    .toISOString()
    .slice(0, 10);
  await expect(
    cal.getByLabel("월간 일정", { exact: true }).getByRole("button", {
      name: `가상 반복 운영회의 일정 열기 · ${repeatDay}`,
      exact: true,
    }),
  ).toBeVisible();
  await original.click();
  await expect(referencesMenu).toBeHidden();
  await expect(description).toHaveValue("가상 설명");
  await openTimeSettings(editor);
  await expect(
    editor.getByRole("button", { name: "반복 설정", exact: true }),
  ).toContainText("1주마다");
  await references.click();
  await expect(
    referencesMenu.getByRole("link", { name: /가상 회의 자료/ }),
  ).toHaveAttribute("href", "https://example.com/meeting");
  await cal.getByRole("button", { name: "캘린더 확대", exact: true }).click();
  await cal.screenshot({
    path: "../../local-data/preview/calendar-notion-editor.png",
  });
  await editor.getByRole("button", { name: "취소", exact: true }).click();
  await original.click({ button: "right" });
  await page.getByRole("menuitem", { name: /이벤트 복사/ }).click();
  await cal
    .locator(`[data-date="${tomorrow}"] .calendar-day-top`)
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: /이벤트 붙여넣기/ }).click();
  await expect(editor.getByLabel("일정 제목")).toHaveValue(
    "가상 반복 운영회의 사본",
  );
  await editor.getByLabel("일정 제목").fill("가상 복사 일정");
  await openTimeSettings(editor);
  await editor.getByRole("button", { name: "반복 설정", exact: true }).click();
  await page
    .getByRole("menuitemradio", { name: "반복하지 않음", exact: true })
    .click();
  await editor.getByRole("button", { name: "일정 추가", exact: true }).click();
  await expect(editor).not.toBeVisible();
  await cal
    .getByRole("button", { name: "컨텍스트 패널 숨기기", exact: true })
    .click();
  await expect(cal.getByLabel("컨텍스트 패널", { exact: true })).toHaveCount(0);
  await page.keyboard.press(String.fromCharCode(92));
  await expect(cal.getByLabel("컨텍스트 패널", { exact: true })).toBeVisible();
  await page.keyboard.press("/");
  await cal.getByLabel("이벤트 검색어").fill("가상 복사 일정");
  await cal
    .locator(".cal-search-results")
    .getByRole("button", { name: /가상 복사 일정/ })
    .click();
  await expect(editor.getByLabel("일정 제목")).toHaveValue("가상 복사 일정");
  await editor.getByRole("button", { name: "취소", exact: true }).click();
  await cal.getByLabel("캘린더 보기 설정", { exact: true }).click();
  await cal.getByRole("checkbox", { name: "주말 표시", exact: true }).uncheck();
  await expect(cal.locator(".notion-month-weekdays > span")).toHaveCount(5);
  await cal
    .getByRole("checkbox", { name: "주 번호 표시", exact: true })
    .check();
  await expect(
    cal.locator(".notion-month-scroll .cal-week-number"),
  ).toHaveCount(12);
  await cal.getByLabel("일수", { exact: true }).selectOption("3");
  await cal.getByLabel("캘린더 보기 설정", { exact: true }).click();
  await cal.getByRole("button", { name: "오늘", exact: true }).click();
  await cal.getByLabel("캘린더 보기", { exact: true }).selectOption("week");
  const weekdays = Array.from({ length: 3 }, (_, i) =>
    new Date(Date.parse(`${today}T12:00:00Z`) + i * 86400000).getUTCDay(),
  ).filter((day) => day !== 0 && day !== 6).length;
  await expect(cal.locator(".cal-time-head > button")).toHaveCount(weekdays);
  await cal.screenshot({
    path: "../../local-data/preview/calendar-notion-week.png",
  });
  await page.keyboard.press(".");
  const jump = page.getByRole("dialog", {
    name: "원하는 날짜로 이동",
    exact: true,
  });
  await jump.getByLabel("이동할 날짜").fill("2027-01-05");
  await jump.getByRole("button", { name: "이동", exact: true }).click();
  await cal.getByLabel("캘린더 보기", { exact: true }).selectOption("month");
  await expect(cal.locator(".calendar-month-title h3")).toHaveText(
    "2027년 1월",
  );
  await cal.getByRole("button", { name: "오늘", exact: true }).click();
  await cal.getByRole("button", { name: "캘린더 축소", exact: true }).click();
  expect(errors).toEqual([]);
});

test("월간 달력은 휠과 빈 칸 드래그로 주 단위로 이어진다", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await login(page, "staff-demo");
  const calendar = page.locator(".calendar-workspace");
  await calendar
    .getByRole("button", { name: "캘린더 확대", exact: true })
    .click();
  await page.keyboard.press(".");
  const jump = page.getByRole("dialog", {
    name: "원하는 날짜로 이동",
    exact: true,
  });
  await jump.getByLabel("이동할 날짜").fill("2026-12-01");
  await jump.getByRole("button", { name: "이동", exact: true }).click();
  const scroll = calendar.getByRole("region", { name: "월간 일정 스크롤" });
  const heading = calendar.locator(".calendar-month-title h3");
  const firstWeek = () =>
    scroll.evaluate((element) => {
      const top = element.getBoundingClientRect().top;
      const row = Array.from(element.children).find(
        (week) => week.getBoundingClientRect().bottom > top + 1,
      );
      return row?.querySelector("[data-date]")?.getAttribute("data-date");
    });
  const distanceToWeekLine = () =>
    scroll.evaluate((element) => {
      const top = element.getBoundingClientRect().top;
      return Math.min(
        ...Array.from(element.children, (week) =>
          Math.abs(week.getBoundingClientRect().top - top),
        ),
      );
    });
  const rowHeight = await scroll
    .locator(".notion-month-week")
    .first()
    .evaluate((row) => row.getBoundingClientRect().height);
  await expect.poll(firstWeek).toBe("2026-11-29");
  await expect(heading).toHaveText("2026년 12월");

  const rect = (await scroll.boundingBox())!;
  const partialWeek = Math.round(rowHeight * 0.75);
  await page.mouse.move(rect.x + 20, rect.y + rowHeight - 10);
  await page.mouse.wheel(0, partialWeek);
  await expect.poll(firstWeek).toBe("2026-12-06");
  await expect.poll(distanceToWeekLine).toBeLessThanOrEqual(1);
  await expect(heading).toHaveText("2026년 12월");
  await page.mouse.wheel(0, partialWeek);
  await expect.poll(firstWeek).toBe("2026-12-13");
  await expect.poll(distanceToWeekLine).toBeLessThanOrEqual(1);
  await expect(heading).toHaveText("2027년 1월");
  await expect(
    calendar.getByRole("region", { name: "작은 달력", exact: true }),
  ).toContainText("2027년 1월");

  await calendar
    .getByRole("button", { name: "＋ 일정 추가", exact: true })
    .click();
  const title = calendar.getByLabel("일정 제목");
  await title.fill("스크롤 중 보존할 가상 초안");
  let confirmations = 0;
  page.on("dialog", async (dialog) => {
    confirmations += 1;
    await dialog.dismiss();
  });
  const saturday = (await scroll
    .locator('[data-date="2026-12-19"]')
    .boundingBox())!;
  const x = saturday.x + saturday.width / 2;
  const y = saturday.y + saturday.height - 12;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + partialWeek, { steps: 7 });
  await expect.poll(distanceToWeekLine).toBeGreaterThan(8);
  await page.mouse.up();
  await expect.poll(firstWeek).toBe("2026-12-20");
  await expect.poll(distanceToWeekLine).toBeLessThanOrEqual(1);
  await expect(heading).toHaveText("2027년 1월");
  await expect(title).toHaveValue("스크롤 중 보존할 가상 초안");

  const nextSaturday = (await scroll
    .locator('[data-date="2026-12-26"]')
    .boundingBox())!;
  const nextY = nextSaturday.y + nextSaturday.height - 12;
  await page.mouse.move(x, nextY);
  await page.mouse.down();
  await page.mouse.move(x, nextY - partialWeek, { steps: 7 });
  await page.mouse.up();
  await expect.poll(firstWeek).toBe("2026-12-13");
  await expect.poll(distanceToWeekLine).toBeLessThanOrEqual(1);
  await expect(title).toHaveValue("스크롤 중 보존할 가상 초안");
  expect(confirmations).toBe(0);

  await calendar.getByRole("button", { name: "오늘", exact: true }).click();
  const today = dayOf(
    (await (await page.request.get("/api/workspace")).json()).server_time,
  );
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  await expect(heading).toHaveText(`${year}년 ${month}월`);
});

test("반복 회차 이동은 가운데 모달에서 단일·이후 범위를 선택하고 저장한다", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1100 });
  await login(page, "staff-demo");
  const { server_time } = await (
    await page.request.get("/api/workspace")
  ).json();
  const firstDay = `${dayOf(server_time).slice(0, 7)}-10`;
  const occurrenceDay = nextDay(firstDay);
  const thirdDay = nextDay(occurrenceDay);
  const dropDay = nextDay(thirdDay);
  const title = "가상 반복 이동 일정";
  const create = await page.request.post("/api/calendar/events", {
    headers: { origin: new URL(page.url()).origin },
    data: {
      unit_id: "software",
      title,
      starts_at: `${firstDay}T13:30:00+09:00`,
      ends_at: `${firstDay}T14:30:00+09:00`,
      recurrence: { frequency: "daily", interval: 1, count: 4 },
    },
  });
  expect(create.ok()).toBeTruthy();
  const before = await create.json();
  const updatePath = `/api/calendar/events/${before.id}/occurrence`;
  let updates = 0;
  page.on("request", (request) => {
    if (request.url().endsWith(updatePath)) updates += 1;
  });

  await page.reload();
  await page.getByRole("button", { name: "캘린더 확대", exact: true }).click();
  const occurrence = page.getByRole("button", {
    name: `${title} 일정 열기 · ${occurrenceDay}`,
    exact: true,
  });
  const target = page.locator(`.calendar-day[data-date="${dropDay}"]`);
  const pending = (day: string) =>
    page.getByRole("button", {
      name: `${title} 저장 전 변경 확인 · ${day}`,
      exact: true,
    });
  const modal = page.getByRole("dialog", {
    name: `반복 이벤트 “${title}” 이동`,
  });
  const cancel = modal.getByRole("button", {
    name: "변경 사항 취소",
    exact: true,
  });
  const single = modal.getByRole("radio", { name: "이 이벤트", exact: true });
  const following = modal.getByRole("radio", {
    name: "이 이벤트부터 이후 이벤트",
  });
  const dateLabel = (day: string) =>
    new Intl.DateTimeFormat("ko-KR", {
      month: "long",
      day: "numeric",
      weekday: "long",
      timeZone: "Asia/Seoul",
    }).format(new Date(`${day}T12:00:00+09:00`));

  await occurrence.dragTo(target);
  await expect(modal).toBeVisible();
  await expect(modal).toContainText(title);
  await expect(single).toBeChecked();
  await expect(following).not.toBeChecked();
  await expect(modal.locator("dd")).toHaveText([
    `${dateLabel(dropDay)} · 13:30–14:30`,
    `${dateLabel(occurrenceDay)} · 13:30–14:30`,
  ]);
  await expect(single).toBeFocused();
  await expect(cancel).toHaveCSS("color", "rgb(152, 44, 35)");
  const saveSingle = modal.getByRole("button", {
    name: "이벤트 1개 저장하기",
    exact: true,
  });
  expect((await cancel.boundingBox())!.x).toBeLessThan(
    (await saveSingle.boundingBox())!.x,
  );
  expect(updates).toBe(0);
  await page.keyboard.press("Escape");
  await expect(modal).toBeHidden();
  await expect(occurrence).toBeVisible();
  expect(updates).toBe(0);

  await occurrence.dragTo(target);
  await expect(modal).toBeVisible();
  await modal.getByRole("button", { name: "계속 편집" }).click();
  await expect(modal).toBeHidden();
  await pending(dropDay).click();
  await cancel.click();
  await expect(modal).toBeHidden();
  await expect(pending(dropDay)).toHaveCount(0);
  await expect(occurrence).toBeVisible();
  expect(updates).toBe(0);

  await occurrence.dragTo(target);
  await expect(modal).toBeVisible();
  await following.check();
  await modal.getByRole("button", { name: "계속 편집" }).click();
  await expect(modal).toBeHidden();
  await expect(pending(dropDay).locator(".cal-pending-dot")).toBeVisible();
  await expect(pending(dropDay)).toBeFocused();
  await expect(occurrence).toHaveCount(0);
  expect(updates).toBe(0);

  const nextDropDay = nextDay(dropDay);
  await pending(dropDay).dragTo(
    page.locator(`.calendar-day[data-date="${nextDropDay}"]`),
  );
  await expect(pending(nextDropDay).locator(".cal-pending-dot")).toBeVisible();
  await expect(modal).toBeHidden();
  await pending(nextDropDay).dragTo(target);
  await pending(dropDay).click();
  await expect(modal).toBeVisible();
  await expect(following).toBeChecked();
  await expect(modal.locator("dd").first()).toContainText(dateLabel(dropDay));
  expect(updates).toBe(0);
  await single.check();
  await page.setViewportSize({ width: 320, height: 730 });
  const box = (await modal.boundingBox())!;
  expect(Math.abs(box.x + box.width / 2 - 160)).toBeLessThan(2);
  expect(Math.abs(box.y + box.height / 2 - 365)).toBeLessThan(2);
  expect(box.width).toBeLessThan(320);
  const updated = page.waitForResponse((r) => r.url().endsWith(updatePath));
  await saveSingle.click();
  const firstUpdate = await updated;
  expect(firstUpdate.ok()).toBeTruthy();
  expect(firstUpdate.request().postDataJSON()).toMatchObject({
    scope: "single",
  });
  await expect(modal).toBeHidden();
  await expect(page.locator("[data-pending-move]")).toHaveCount(0);
  expect(updates).toBe(1);

  const current = await (
    await page.request.get(`/api/calendar/events/${before.id}`)
  ).json();
  expect(dayOf(current.starts_at)).toBe(firstDay);
  expect(current.revision).toBe(before.revision + 1);
  expect(current.recurrence).toEqual(before.recurrence);
  await page.setViewportSize({ width: 1600, height: 1100 });
  await expect(
    page.getByRole("button", {
      name: `${title} 일정 열기 · ${dropDay}`,
      exact: true,
    }),
  ).toHaveCount(2);
  await expect(occurrence).toHaveCount(0);
  const third = page.getByRole("button", {
    name: `${title} 일정 열기 · ${thirdDay}`,
    exact: true,
  });
  const followingDay = nextDay(nextDay(dropDay));
  await third.dragTo(
    page.locator(`.calendar-day[data-date="${followingDay}"]`),
  );
  await following.check();
  const savedFollowing = page.waitForResponse((r) =>
    r.url().endsWith(updatePath),
  );
  await modal.getByRole("button", { name: "이후 이벤트 저장하기" }).click();
  const secondUpdate = await savedFollowing;
  expect(secondUpdate.ok()).toBeTruthy();
  expect(secondUpdate.request().postDataJSON()).toMatchObject({
    scope: "following",
  });
  await expect(third).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: `${title} 일정 열기 · ${dropDay}`,
      exact: true,
    }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("button", {
      name: `${title} 일정 열기 · ${followingDay}`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: `${title} 일정 열기 · ${nextDay(followingDay)}`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("일정을 이동했습니다.", { exact: true }),
  ).toHaveCount(0);
});

test("시간축 드래그로 일정 이동·종료 변경·범위 선택을 수행하고 리마인더를 확인한다", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1100 });
  await login(page, "staff-demo");
  const time = (await (await page.request.get("/api/workspace")).json())
    .server_time;
  const today = dayOf(time);
  const row = await page.request.post("/api/calendar/events", {
    headers: { origin: "http://127.0.0.1:5180" },
    data: {
      unit_id: "software",
      title: "가상 드래그 회의",
      starts_at: new Date(`${today}T09:00:00+09:00`).toISOString(),
      ends_at: new Date(`${today}T10:00:00+09:00`).toISOString(),
    },
  });
  expect(row.ok()).toBeTruthy();
  const ident = (await row.json()).id;
  await page.reload();
  const cal = page.locator(".calendar-workspace");
  await cal.getByLabel("캘린더 보기", { exact: true }).selectOption("day");
  await cal.getByRole("button", { name: "캘린더 확대", exact: true }).click();
  const track = cal.locator(".cal-time-track");
  const block = track
    .locator(".cal-timed-block")
    .filter({ hasText: "가상 드래그 회의" });
  await expect(block).toBeVisible();
  const move = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/calendar/events/${ident}/update`) &&
      r.request().method() === "POST",
  );
  await block
    .getByRole("button", {
      name: `가상 드래그 회의 일정 열기 · ${today}`,
      exact: true,
    })
    .dragTo(track.locator(".cal-time-slot").nth(27), {
      targetPosition: { x: 20, y: 2 },
    });
  expect((await move).ok()).toBeTruthy();
  let detail = await (
    await page.request.get(`/api/calendar/events/${ident}`)
  ).json();
  expect(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Seoul",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(detail.starts_at)),
  ).toBe("13:30");
  const resize = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/calendar/events/${ident}/update`) &&
      r.request().method() === "POST",
  );
  await block
    .getByRole("button", {
      name: "가상 드래그 회의 종료 시간 변경",
      exact: true,
    })
    .dragTo(track.locator(".cal-time-slot").nth(30), {
      targetPosition: { x: 20, y: 2 },
    });
  expect((await resize).ok()).toBeTruthy();
  detail = await (
    await page.request.get(`/api/calendar/events/${ident}`)
  ).json();
  expect(Date.parse(detail.ends_at) - Date.parse(detail.starts_at)).toBe(
    90 * 60000,
  );
  await expect(cal.locator(".calendar-canvas")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  const from = await track.locator(".cal-time-slot").nth(20).boundingBox();
  const to = await track.locator(".cal-time-slot").nth(21).boundingBox();
  await page.mouse.move(from!.x + 20, from!.y + 5);
  await page.mouse.down();
  await page.mouse.move(to!.x + 20, to!.y + 5, { steps: 5 });
  await page.mouse.up();
  const editor = page
    .getByRole("dialog")
    .filter({ has: page.getByLabel("일정 제목") });
  await expect(editor.getByLabel("시작 시간", { exact: true })).toHaveValue(
    "10:00",
  );
  await expect(editor.getByLabel("종료 시간", { exact: true })).toHaveValue(
    "11:00",
  );
  await editor.getByRole("button", { name: "취소", exact: true }).click();
  const starts = new Date(Date.parse(time) + 20 * 60000).toISOString();
  const ends = new Date(Date.parse(time) + 50 * 60000).toISOString();
  expect(
    (
      await page.request.post("/api/calendar/events", {
        headers: { origin: "http://127.0.0.1:5180" },
        data: {
          unit_id: "software",
          title: "가상 리마인더 확인",
          starts_at: starts,
          ends_at: ends,
          reminder_minutes: [30],
        },
      })
    ).ok(),
  ).toBeTruthy();
  await page.reload();
  await cal.getByRole("button", { name: /리마인더 \d+개/ }).click();
  const notification = cal
    .locator(".cal-reminder-popover > div")
    .filter({ hasText: "가상 리마인더 확인" });
  await expect(notification).toBeVisible();
  await notification.getByRole("button", { name: "확인", exact: true }).click();
  await expect(notification).toHaveCount(0);
});
