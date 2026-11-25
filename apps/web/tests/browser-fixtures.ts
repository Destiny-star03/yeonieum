import { expect, type Page } from "@playwright/test";
export { test, expect } from "@playwright/test";
export async function login(page: Page, identifier: string) {
  await page.goto("/");
  await page.getByLabel("시연 계정").selectOption(identifier);
  await page.getByRole("button", { name: "업무 공간으로 들어가기 →" }).click();
  await expect(page.getByRole("heading", { name: "대시보드" })).toBeVisible();
}
