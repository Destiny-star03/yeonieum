import { test, expect, login } from "../../apps/web/tests/browser-fixtures";
import { mkdir } from "node:fs/promises";

test("워크스페이스 메뉴와 업무 카드가 기존 기능으로 연결되고 작은 화면에서도 동작한다", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1050 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page, "staff-demo");
  const nav = page.getByRole("navigation", { name: "주 메뉴" });
  await expect(
    nav.getByRole("button", { name: "대시보드", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  expect(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--canvas")
        .trim(),
    ),
  ).toBe("#f7f3ee");
  await mkdir("../../local-data/preview", { recursive: true });
  await page.screenshot({
    path: "../../local-data/preview/workspace-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "메뉴 접기", exact: true }).click();
  await expect(page.locator(".workspace-shell")).toHaveClass(/is-collapsed/);
  await nav.getByRole("button", { name: "자료실", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "자료실", exact: true, level: 1 }),
  ).toBeVisible();
  await page.getByRole("button", { name: "메뉴 펼치기", exact: true }).click();
  await page.getByRole("button", { name: "연이음 홈", exact: true }).click();
  for (const [shortcut, heading] of [
    ["자료실로 이동", "자료실"],
    ["예산·정산으로 이동", "예산과 정산"],
    ["인수인계로 이동", "인수인계"],
  ]) {
    await page.getByRole("button", { name: shortcut, exact: true }).click();
    await expect(
      page.getByRole("heading", { name: heading, exact: true, level: 1 }),
    ).toBeVisible();
    await page.getByRole("button", { name: "연이음 홈", exact: true }).click();
  }
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await nav.getByRole("button", { name: "자료실", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "자료실", exact: true, level: 1 }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (width === 390)
      await page.screenshot({
        path: "../../local-data/preview/workspace-library-mobile.png",
        fullPage: true,
      });
    await nav.getByRole("button", { name: "대시보드", exact: true }).click();
    if (width === 390)
      await page.screenshot({
        path: "../../local-data/preview/workspace-mobile.png",
        fullPage: true,
      });
  }
  expect(errors).toEqual([]);
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "연이음에 오신 것을 환영합니다" }),
  ).toBeVisible();
});
