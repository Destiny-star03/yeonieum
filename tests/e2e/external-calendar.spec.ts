import { test, expect, login } from "../../apps/web/tests/browser-fixtures";

function fixture(day: string, title = "가상 공식 학사 일정") {
  const begin = new Date(`${day}T00:00:00+09:00`),
    end = new Date(begin.getTime() + 86400000);
  return {
    events: [
      {
        id: "external:school:fixture",
        instance_key: "external:school:fixture",
        external_source: "school",
        title,
        starts_at: begin.toISOString(),
        ends_at: end.toISOString(),
        all_day: true,
        org_id: "external:school",
        org_name: "학교 학사일정",
        unit_id: "",
        unit_name: "학교 학사일정",
        creator_name: "학교 학사일정",
        can_edit: false,
        time_zone: "Asia/Seoul",
        recurrence: null,
        color: "blue",
        availability: "busy",
        source_url: "https://eng.yc.ac.kr/www/scheduleList.do",
      },
    ],
    can_refresh: true,
    sources: [
      {
        id: "school",
        name: "학교 학사일정",
        source_url: "https://eng.yc.ac.kr/www/scheduleList.do",
        enabled: true,
        configured: true,
        buckets: [
          {
            bucket: day.slice(0, 4),
            last_success: new Date().toISOString(),
            last_error: "",
            item_count: 1,
          },
        ],
      },
      {
        id: "holidays",
        name: "대한민국 공휴일",
        source_url: "https://www.data.go.kr/data/15012690/openapi.do",
        enabled: true,
        configured: false,
        buckets: [
          {
            bucket: day.slice(0, 7),
            last_success: null,
            last_error: "",
            item_count: 0,
          },
        ],
      },
    ],
  };
}

test("공식 학사일정을 별도 색과 읽기 전용 원본 링크로 표시하고 공휴일 인증키 대기를 알린다", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1100 });
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  await page.route("**/api/calendar/external?**", (route) =>
    route.fulfill({ json: fixture(day) }),
  );
  await login(page, "staff-demo");
  const grid = page.locator(".notion-month");
  const event = grid.getByRole("button", {
    name: `가상 공식 학사 일정 일정 열기 · ${day}`,
    exact: true,
  });
  await expect(event).toBeVisible();
  await expect(event).toHaveAttribute("draggable", "false");
  await expect(
    page.getByText("공휴일 API 인증키 설정 필요", { exact: true }),
  ).toBeVisible();
  await event.click();
  const detail = page.getByRole("region", {
    name: "공식 일정 상세",
    exact: true,
  });
  await expect(
    detail.getByRole("heading", { name: "가상 공식 학사 일정" }),
  ).toBeVisible();
  await expect(
    detail.getByRole("link", { name: "공식 원본 확인 ↗" }),
  ).toHaveAttribute("href", "https://eng.yc.ac.kr/www/scheduleList.do");
  await expect(detail.getByRole("button", { name: "일정 삭제" })).toHaveCount(
    0,
  );
  await expect(page.getByLabel("일정 제목")).toHaveCount(0);
  await page
    .getByRole("checkbox", { name: "학교 학사일정", exact: true })
    .uncheck();
  await expect(event).toHaveCount(0);
  await page
    .getByRole("checkbox", { name: "학교 학사일정", exact: true })
    .check();
  await expect(event).toBeVisible();
  await expect(
    page
      .getByRole("checkbox", { name: "학교 학사일정", exact: true })
      .locator(".."),
  ).toHaveCSS("display", "flex");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "../../local-data/preview/calendar-external-sources.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 1000 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("공식 원본 변경을 새로 반영하고 갱신 실패에도 마지막 화면 일정을 유지한다", async ({
  page,
}) => {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  await page.route("**/api/calendar/external?**", (route) =>
    route.fulfill({ json: fixture(day) }),
  );
  let fail = false;
  await page.route("**/api/calendar/external/refresh?**", (route) =>
    fail
      ? route.abort()
      : route.fulfill({ json: fixture(day, "가상 변경 학사 일정") }),
  );
  await login(page, "staff-demo");
  const refresh = page.getByRole("button", {
    name: "공식 일정 새로 확인",
    exact: true,
  });
  await refresh.click();
  await expect(
    page.locator(".notion-month").getByRole("button", {
      name: `가상 변경 학사 일정 일정 열기 · ${day}`,
      exact: true,
    }),
  ).toBeVisible();
  fail = true;
  await refresh.click();
  await expect(
    page.getByText(
      "공식 일정 갱신을 요청하지 못했습니다. 마지막 화면 자료를 유지합니다.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.locator(".notion-month").getByRole("button", {
      name: `가상 변경 학사 일정 일정 열기 · ${day}`,
      exact: true,
    }),
  ).toBeVisible();
});
