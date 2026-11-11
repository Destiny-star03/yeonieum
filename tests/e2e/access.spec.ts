import { test, expect, login } from "../../apps/web/tests/browser-fixtures";
import { mkdir } from "node:fs/promises";

test("의장 겸임 확인, 하위 역할 부여, 새로고침 후 기록 유지", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page, "student-chair");
  await expect(
    page.getByText("학회장들의 투표로 선출 · 자기 학과 학회장과 동일 임기"),
  ).toBeVisible();
  await mkdir("../../local-data/preview", { recursive: true });
  await page.screenshot({
    path: "../../local-data/preview/desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "조직 · 권한", exact: true }).click();
  const form = page
    .locator("form")
    .filter({ has: page.getByRole("button", { name: "역할 부여하기" }) });
  await form.getByLabel("대상 담당자").selectOption("member");
  await form.getByLabel("역할", { exact: true }).selectOption("class_rep");
  await form.getByLabel("담당 범위").selectOption("software-2-A");
  await form.getByRole("button", { name: "역할 부여하기" }).click();
  await expect(page.getByRole("status")).toContainText("역할을 등록했습니다");
  await page.reload();
  await page.getByRole("button", { name: "조직 · 권한", exact: true }).click();
  await expect(
    page.locator(".assignment").filter({ hasText: "가상 신규 담당자" }),
  ).toContainText("2학년 / A반");
  expect(errors).toEqual([]);
});

test("모바일 반대표의 재위임과 연락처 제한, 로그아웃", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "student-rep");
  await page.screenshot({
    path: "../../local-data/preview/mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "조직 · 권한", exact: true }).click();
  await expect(
    page.getByText("현재 역할에는 추가 역할 부여 권한이 없습니다."),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "가상 반대표", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "가상 의장", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "활동 이력", exact: true }),
  ).toBeDisabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "연이음에 오신 것을 환영합니다" }),
  ).toBeVisible();
});

test("선생님의 신규 담당자 등록과 직접 계정 로그인", async ({ page }) => {
  await login(page, "staff-demo");
  await page.getByRole("button", { name: "조직 · 권한", exact: true }).click();
  await page.getByRole("button", { name: "＋ 가상 담당자 등록" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("이름", { exact: true }).fill("가상 첫 학회장 후보");
  await dialog.getByLabel("초대 대상 이메일").fill("browser-new@demo.invalid");
  await dialog.getByLabel("가상 학번").fill("browser-new");
  await dialog.getByLabel("소속", { exact: true }).selectOption("software");
  await dialog
    .getByRole("button", { name: "담당자 등록", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "가상 담당자를 등록했습니다",
  );
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await page.getByRole("button", { name: "등록한 계정 직접 입력" }).click();
  await page.getByLabel("시연 계정").fill("browser-new");
  await page.getByRole("button", { name: "업무 공간으로 들어가기 →" }).click();
  await expect(
    page.getByRole("heading", { name: "함께 이어가는 학생자치" }),
  ).toBeVisible();
  await expect(
    page.getByText("현재 유효한 업무 역할이 없습니다."),
  ).toContainText("현재 유효한 업무 역할이 없습니다.");
});
