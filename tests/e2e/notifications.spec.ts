import { createHash } from "node:crypto";
import { expect, login, test } from "../../apps/web/tests/browser-fixtures";

test("상단 알림에서 소속 단체 자료와 일정 리마인더를 열고 읽음 처리한다", async ({
  page,
  browser,
}) => {
  const origin = `http://127.0.0.1:${process.env.YEONIEUM_E2E_WEB_PORT || "5180"}`;
  const owner = await browser.newContext();
  try {
    const api = owner.request;
    const headers = { origin };
    expect(
      (
        await api.post(`${origin}/api/auth/login`, {
          headers,
          data: {
            identifier: "student-chair",
            password: "Yeonieum-demo-2026!",
          },
        })
      ).ok(),
    ).toBeTruthy();
    await login(page, "student-vice");
    const recipient = await (await page.request.get("/api/me")).json();
    const bytes = Buffer.from("알림에서 연 가상 회의록 원문", "utf8");
    const prepared = await api.post(`${origin}/api/documents/uploads`, {
      headers,
      data: {
        filename: "notice.txt",
        size: bytes.length,
        checksum: createHash("sha256").update(bytes).digest("hex"),
        metadata: {
          unit_id: "software",
          academic_year: new Date().getFullYear(),
          audience: "organization",
          title: "알림 테스트 회의록",
        },
      },
    });
    expect(prepared.ok()).toBeTruthy();
    const upload = await prepared.json();
    expect(
      (
        await api.put(`${origin}/api/documents/uploads/${upload.id}/content`, {
          headers,
          data: bytes,
        })
      ).ok(),
    ).toBeTruthy();
    expect(
      (
        await api.post(`${origin}/api/calendar/events`, {
          headers,
          data: {
            title: "알림 테스트 일정",
            unit_id: "software",
            participant_ids: [recipient.id],
            reminder_minutes: [15],
            starts_at: new Date(Date.now() + 2 * 60_000).toISOString(),
            ends_at: new Date(Date.now() + 60 * 60_000).toISOString(),
          },
        })
      ).ok(),
    ).toBeTruthy();
  } finally {
    await owner.close();
  }
  const bell = page.getByRole("button", { name: /^알림(?:,|$)/ });
  await bell.click();
  const inbox = page.getByRole("region", { name: "알림함" });
  await expect(
    inbox.getByRole("button", { name: /새 자료.*알림 테스트 회의록/ }),
  ).toBeVisible();
  await expect(
    inbox.getByRole("button", { name: /공유 일정.*알림 테스트 일정/ }),
  ).toBeVisible();
  await expect(
    inbox.getByRole("button", { name: /일정 리마인더.*알림 테스트 일정/ }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 830 });
  const bounds = await inbox.boundingBox();
  expect(
    bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390,
  ).toBeTruthy();
  await inbox
    .getByRole("button", { name: /일정 리마인더.*알림 테스트 일정/ })
    .click();
  await expect(
    page.getByRole("textbox", { name: "일정 제목", exact: true }),
  ).toHaveValue("알림 테스트 일정");
  await expect(
    (
      await (await page.request.get("/api/calendar/reminders")).json()
    ).reminders.filter(
      (item: { event: { title: string } }) =>
        item.event.title === "알림 테스트 일정",
    ),
  ).toHaveLength(0);
  await page.getByRole("button", { name: "컨텍스트 패널 닫기" }).click();
  await bell.click();
  await inbox
    .getByRole("button", { name: /새 자료.*알림 테스트 회의록/ })
    .click();
  const preview = page.getByRole("dialog", { name: /알림 테스트 회의록/ });
  await expect(preview.getByText("알림에서 연 가상 회의록 원문")).toBeVisible();
  await preview.getByRole("button", { name: "미리보기 닫기" }).click();
  await page.reload();
  await bell.click();
  await expect(
    inbox.getByRole("button", { name: "알림 테스트 회의록 읽음으로 표시" }),
  ).toHaveCount(0);
  await expect(
    inbox.getByRole("button", { name: /새 자료.*알림 테스트 회의록/ }),
  ).toBeVisible();
});
