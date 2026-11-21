import { test, expect, login } from "../../apps/web/tests/browser-fixtures";
import { mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { Locator, Page } from "@playwright/test";

async function dropFiles(
  page: Page,
  zone: Locator,
  files: { name: string; text: string; size?: number }[],
) {
  const transfer = await page.evaluateHandle((items) => {
    const data = new DataTransfer();
    for (const item of items)
      data.items.add(
        new File(
          [item.size ? new Uint8Array(item.size) : item.text],
          item.name,
          { type: "text/plain" },
        ),
      );
    return data;
  }, files);
  await zone.dispatchEvent("dragenter", { dataTransfer: transfer });
  await zone.dispatchEvent("dragover", { dataTransfer: transfer });
  await zone.dispatchEvent("drop", { dataTransfer: transfer });
  await transfer.dispose();
}

test("간결한 등록창에서 드래그로 제목을 채우고 선택 정보 없이 개인 자료를 저장한다", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1500, height: 1000 });
  const org = await setupLibrary(page);
  await page.getByRole("button", { name: "＋ 자료 등록", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("보관할 담당 범위")).toHaveCount(0);
  await expect(dialog.getByLabel("설명", { exact: true })).not.toBeVisible();
  await expect(dialog.getByLabel("열람 대상")).toHaveValue("private");
  await expect(
    dialog.getByRole("button", { name: "파일 등록", exact: true }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "파일 선택", exact: true }).focus();
  const chooser = page.waitForEvent("filechooser");
  await page.keyboard.press("Enter");
  await (
    await chooser
  ).setFiles({
    name: "처음 선택.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("synthetic first"),
  });
  await expect(dialog.getByLabel("자료 제목")).toHaveValue("처음 선택");
  await dialog.getByRole("button", { name: "선택한 파일 제거" }).click();
  await expect(
    dialog.getByRole("button", { name: "파일 선택", exact: true }),
  ).toBeFocused();
  await expect(
    dialog.getByRole("button", { name: "파일 등록", exact: true }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "위치 변경", exact: true }).click();
  await dialog.getByLabel("보관할 담당 범위").selectOption(org.id);
  await dialog.getByLabel("학년도", { exact: true }).fill("2025");
  await dialog.getByRole("button", { name: "위치 변경", exact: true }).click();
  const zone = dialog.getByRole("group", { name: "파일 업로드 영역" });
  await dropFiles(page, zone, [
    { name: "가상 운영 안내.txt", text: "synthetic dragged file" },
  ]);
  await expect(dialog.getByLabel("자료 제목")).toHaveValue("가상 운영 안내");
  await expect(dialog.locator(".library-selected-file")).toContainText(
    "선택됨",
  );
  await expect(
    dialog.getByRole("button", { name: "파일 등록", exact: true }),
  ).toBeEnabled();
  await dialog.screenshot({
    path: "../../local-data/preview/library-upload-simple.png",
  });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    await dialog.screenshot({
      path: `../../local-data/preview/library-upload-${width}.png`,
    });
  }
  await dialog.getByRole("button", { name: "파일 등록", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const row = (
    await (await page.request.get("/api/documents?q=가상 운영 안내")).json()
  ).items[0];
  expect(row).toMatchObject({
    org_id: org.id,
    academic_year: 2025,
    category: "일반 자료",
    title: "가상 운영 안내",
    audience: "private",
  });
});

test("드래그 입력의 형식·크기·다중 파일 오류와 직접 작성한 제목을 보존한다", async ({
  page,
}) => {
  await setupLibrary(page);
  await page.getByRole("button", { name: "＋ 자료 등록", exact: true }).click();
  const dialog = page.getByRole("dialog"),
    zone = dialog.getByRole("group", { name: "파일 업로드 영역" });
  let preparations = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/api/documents/uploads"))
      preparations++;
  });
  await dropFiles(page, zone, [{ name: "unsafe.exe", text: "synthetic" }]);
  await expect(dialog.getByRole("alert")).toContainText("지원하지 않는");
  await dropFiles(page, zone, [{ name: "empty.txt", text: "" }]);
  await expect(dialog.getByRole("alert")).toContainText("빈 파일");
  await dropFiles(page, zone, [
    { name: "large.txt", text: "", size: 50 * 1024 * 1024 + 1 },
  ]);
  await expect(dialog.getByRole("alert")).toContainText("50 MiB");
  await dropFiles(page, zone, [
    { name: "a.txt", text: "a" },
    { name: "b.txt", text: "b" },
  ]);
  await expect(dialog.getByRole("alert")).toContainText("1개씩");
  await expect(
    dialog.getByRole("button", { name: "파일 등록", exact: true }),
  ).toBeDisabled();
  await dialog.getByLabel("자료 제목").fill("직접 정한 제목");
  await dropFiles(page, zone, [{ name: "changed.txt", text: "replacement" }]);
  await expect(dialog.getByLabel("자료 제목")).toHaveValue("직접 정한 제목");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  expect(preparations).toBe(0);
  await dialog.locator("summary").filter({ hasText: "추가 정보" }).click();
  await dialog.getByLabel("자료 종류", { exact: true }).fill("");
  await dialog.locator("summary").filter({ hasText: "추가 정보" }).click();
  await dialog.getByRole("button", { name: "파일 등록", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(preparations).toBe(1);
});

async function setupLibrary(page: import("@playwright/test").Page) {
  await login(page, "staff-demo");
  const name = `가상 자료실 ${Date.now()}`;
  const response = await page.request.post("/api/organizations", {
    headers: { origin: new URL(page.url()).origin },
    data: { name },
  });
  expect(response.ok()).toBeTruthy();
  const org = await response.json();
  expect(
    (
      await page.request.post("/api/documents/staff-scopes", {
        headers: { origin: new URL(page.url()).origin },
        data: { unit_id: org.id, enabled: true },
      })
    ).ok(),
  ).toBeTruthy();
  await page.getByRole("button", { name: "자료실", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "＋ 자료 등록" }),
  ).toBeEnabled();
  return org;
}

test("연도·단체 카드에서 폴더를 만들고 파일 목록·상세·형식 필터를 사용한다", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1800, height: 1100 });
  const org = await setupLibrary(page);
  const home = page.getByRole("region", { name: "연도별 자료실" });
  await expect(home).toBeVisible();
  await home.getByLabel("열어볼 연도").fill("2025");
  await home.getByRole("button", { name: "열기", exact: true }).click();
  await page
    .getByRole("region", { name: "단체별 자료실" })
    .getByRole("button", { name: new RegExp(org.name) })
    .click();
  await expect(
    page.getByRole("navigation", { name: "자료실 경로" }),
  ).toContainText("2025년");
  await page.getByRole("button", { name: "＋ 새 폴더", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("폴더 이름").fill("행사 기록");
  await expect(dialog.getByLabel("보관 연도")).toHaveValue("2025");
  await dialog
    .getByRole("button", { name: "폴더 만들기", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "자료실 경로" }),
  ).toContainText("행사 기록");
  await page.getByRole("button", { name: "＋ 새 폴더", exact: true }).click();
  await dialog.getByLabel("폴더 이름").fill("준비 자료");
  await expect(dialog.getByLabel("폴더 공개 범위")).toBeDisabled();
  await dialog
    .getByRole("button", { name: "폴더 만들기", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "＋ 자료 등록", exact: true }).click();
  await dialog.getByRole("button", { name: "위치 변경", exact: true }).click();
  await expect(dialog.getByLabel("학년도", { exact: true })).toHaveValue(
    "2025",
  );
  await expect(dialog.getByLabel("열람 대상")).toHaveValue("organization");
  await expect(dialog.getByLabel("열람 대상")).toBeDisabled();
  await dialog.getByLabel("자료 제목").fill("행사 안내문");
  await dialog.getByLabel("업로드 파일").setInputFiles({
    name: "안내문.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("가상 행사 안내"),
  });
  await dialog.getByRole("button", { name: "파일 등록", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("region", { name: "행사 안내문", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".library-file-rows .library-document"),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "카드 보기", exact: true }).click();
  await expect(
    page.locator(".library-card-grid .library-document"),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "목록 보기", exact: true }).click();
  await page
    .getByLabel("파일 형식 필터")
    .getByRole("button", { name: "PDF", exact: true })
    .click();
  await expect(page.locator(".library-document")).toHaveCount(0);
  await page
    .getByLabel("파일 형식 필터")
    .getByRole("button", { name: "TXT·CSV", exact: true })
    .click();
  await expect(page.locator(".library-document")).toHaveCount(1);
  await page.locator(".library-document").click();
  await page.evaluate(() => window.scrollTo(0, 0));
  expect(
    (await page.getByRole("navigation", { name: "자료실 경로" }).boundingBox())!
      .height,
  ).toBeLessThan(50);
  await page.screenshot({
    path: "../../local-data/preview/library-folder-desktop.png",
    fullPage: true,
  });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      (await page
        .getByRole("navigation", { name: "자료실 경로" })
        .boundingBox())!.height,
    ).toBeLessThan(150);
  }
  await page.screenshot({
    path: "../../local-data/preview/library-folder-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1800, height: 1100 });
  await page
    .getByRole("navigation", { name: "자료실 경로" })
    .getByRole("button", { name: "행사 기록", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "준비 자료 폴더 열기" }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "자료실", exact: true }).click();
  await page
    .getByRole("region", { name: "연도별 자료실" })
    .getByRole("button", { name: /2025년/ })
    .click();
  await page
    .getByRole("region", { name: "단체별 자료실" })
    .getByRole("button", { name: new RegExp(org.name) })
    .click();
  await page.getByRole("button", { name: "행사 기록 폴더 열기" }).click();
  await page.getByRole("button", { name: "준비 자료 폴더 열기" }).click();
  await expect(page.locator(".library-document")).toContainText("행사 안내문");
});

test("개인 보관 파일·폴더는 다른 담당자에게 숨기고 명시적으로 공유한 파일만 공개한다", async ({
  page,
}) => {
  await login(page, "student-vice");
  await page.getByRole("button", { name: "자료실", exact: true }).click();
  await page.getByRole("button", { name: "＋ 새 폴더", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("폴더 이름").fill("나의 가상 준비 폴더");
  await dialog.getByLabel("폴더 공개 범위").selectOption("private");
  await dialog
    .getByRole("button", { name: "폴더 만들기", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "＋ 자료 등록", exact: true }).click();
  await dialog.getByLabel("자료 제목").fill("나만 보는 가상 메모");
  await expect(dialog.getByLabel("열람 대상")).toHaveValue("private");
  await dialog.getByLabel("업로드 파일").setInputFiles({
    name: "private.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("synthetic personal note"),
  });
  await dialog.getByRole("button", { name: "파일 등록", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const mine = (
    await (
      await page.request.get("/api/documents?q=나만 보는 가상 메모")
    ).json()
  ).items[0];
  expect(mine.audience).toBe("private");
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await login(page, "student-chair");
  await page.getByRole("button", { name: "자료실", exact: true }).click();
  await expect(
    page
      .locator(".library-document")
      .filter({ hasText: "나만 보는 가상 메모" }),
  ).toHaveCount(0);
  expect(
    (
      await page.request.get(`/api/documents/${mine.id}/versions/1/download`)
    ).status(),
  ).toBe(404);
  const folders = await page.request.get(
    `/api/documents/folders?org_id=council&academic_year=${mine.academic_year}&audience=private`,
  );
  expect(JSON.stringify(await folders.json())).not.toContain(
    "나의 가상 준비 폴더",
  );
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await login(page, "student-vice");
  await page.getByRole("button", { name: "자료실", exact: true }).click();
  await page.getByRole("button", { name: "＋ 자료 등록", exact: true }).click();
  await dialog.getByLabel("자료 제목").fill("공유한 가상 메모");
  await dialog.getByLabel("열람 대상").selectOption("organization");
  await dialog.getByLabel("업로드 파일").setInputFiles({
    name: "shared.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("synthetic shared note"),
  });
  await dialog.getByRole("button", { name: "파일 등록", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await login(page, "student-rep");
  await page.getByRole("button", { name: "자료실", exact: true }).click();
  await expect(
    page.locator(".library-document").filter({ hasText: "공유한 가상 메모" }),
  ).toBeVisible();
  await expect(
    page
      .locator(".library-document")
      .filter({ hasText: "나만 보는 가상 메모" }),
  ).toHaveCount(0);
});

test("자료 등록·다운로드·새 버전·과거 파일 복원·휴지통과 분류 검색", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const org = await setupLibrary(page);
  await page.getByRole("button", { name: "＋ 자료 등록" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "위치 변경", exact: true }).click();
  await dialog.getByLabel("보관할 담당 범위").selectOption(org.id);
  await dialog.getByLabel("자료 제목").fill("자료실 시연 회의록");
  await dialog.getByLabel("학년도", { exact: true }).fill("2026");
  await dialog.locator("summary").filter({ hasText: "추가 정보" }).click();
  await dialog.getByLabel("자료 종류", { exact: true }).fill("회의록");
  await dialog.getByLabel("폴더 분류").fill("정기 회의");
  await dialog.getByLabel("행사명").fill("가상 행사");
  await dialog.getByLabel("업로드 파일").setInputFiles({
    name: "회의록.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("가상 회의록 v1"),
  });
  await dialog.getByRole("button", { name: "파일 등록", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const detail = page.getByRole("region", { name: "자료실 시연 회의록" });
  await expect(detail).toContainText("v1 · 현재");
  const downloadPromise = page.waitForEvent("download");
  await detail.getByRole("button", { name: "v1 다운로드" }).click();
  const downloaded = await downloadPromise;
  expect(downloaded.suggestedFilename()).toBe("회의록.txt");
  expect(await readFile((await downloaded.path())!, "utf8")).toBe(
    "가상 회의록 v1",
  );
  await detail.getByRole("button", { name: "새 버전 등록" }).click();
  await dialog.getByLabel("업로드 파일").setInputFiles({
    name: "회의록-보완.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("가상 회의록 v2"),
  });
  await dialog.getByLabel("버전 설명").fill("회의 내용 보완");
  await dialog.getByRole("button", { name: "파일 등록", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(detail).toContainText("v2 · 현재");
  await detail.getByRole("button", { name: "이 버전 복원" }).click();
  await detail.getByRole("button", { name: "확인하고 실행" }).click();
  await expect(detail).toContainText("v3 · 현재");
  await detail.getByRole("button", { name: "분류·공유 수정" }).click();
  await detail
    .getByLabel("설명", { exact: true })
    .fill("다음 담당자에게 전달할 회의록");
  await detail.getByRole("button", { name: "분류·공유 저장" }).click();
  await expect(detail).toContainText("다음 담당자에게 전달할 회의록");
  await mkdir("../../local-data/preview", { recursive: true });
  await page.screenshot({
    path: "../../local-data/preview/library-desktop.png",
    fullPage: true,
  });
  await detail.getByRole("button", { name: "휴지통으로 이동" }).click();
  await detail.getByRole("button", { name: "확인하고 실행" }).click();
  await expect(
    page.locator(".library-document").filter({ hasText: "자료실 시연 회의록" }),
  ).toHaveCount(0);
  await detail.getByRole("button", { name: "자료 복원", exact: true }).click();
  await detail.getByRole("button", { name: "확인하고 실행" }).click();
  await expect(
    page.locator(".library-document").filter({ hasText: "자료실 시연 회의록" }),
  ).toBeVisible();
  await page.getByLabel("자료 검색", { exact: true }).fill("다음 담당자");
  await page.getByText("상세 검색", { exact: true }).click();
  await page.getByLabel("학년도 필터").fill("2026");
  await page.getByLabel("행사 필터").fill("가상 행사");
  await page.getByRole("button", { name: "검색 적용" }).click();
  await expect(page.locator(".library-document")).toHaveCount(1);
  await page.reload();
  await page.getByRole("button", { name: "자료실", exact: true }).click();
  await expect(
    page.locator(".library-document").filter({ hasText: "자료실 시연 회의록" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("저장 후 화면 갱신 실패는 파일을 중복 등록하지 않고 결과만 다시 확인", async ({
  page,
}) => {
  const org = await setupLibrary(page);
  let preparations = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/documents/uploads"
    )
      preparations++;
  });
  await page.getByRole("button", { name: "＋ 자료 등록" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "위치 변경", exact: true }).click();
  await dialog.getByLabel("보관할 담당 범위").selectOption(org.id);
  await dialog.getByLabel("자료 제목").fill("재조회 가상 자료");
  await dialog.getByLabel("업로드 파일").setInputFiles({
    name: "retry.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("retry synthetic"),
  });
  await page.route("**/api/documents?*", (route) => route.abort(), {
    times: 1,
  });
  await dialog.getByRole("button", { name: "파일 등록", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "파일 저장은 완료됐습니다",
  );
  await dialog.getByRole("button", { name: "저장 결과 다시 확인" }).click();
  await expect(dialog).not.toBeVisible();
  expect(preparations).toBe(1);
  await expect(
    page.locator(".library-document").filter({ hasText: "재조회 가상 자료" }),
  ).toHaveCount(1);
});

test("마지막 페이지의 자료를 휴지통으로 옮기면 유효한 페이지로 이동", async ({
  page,
}) => {
  const org = await setupLibrary(page);
  const content = Buffer.from("pagination synthetic record");
  const headers = { origin: new URL(page.url()).origin };
  for (let i = 0; i < 21; i++) {
    const prepared = await page.request.post("/api/documents/uploads", {
      headers,
      data: {
        metadata: {
          unit_id: org.id,
          title: `페이지 자료 ${i}`,
          academic_year: 2026,
        },
        filename: "page.txt",
        size: content.length,
        checksum: createHash("sha256").update(content).digest("hex"),
      },
    });
    expect(prepared.ok()).toBeTruthy();
    const session = await prepared.json();
    expect(
      (
        await page.request.put(`/api/documents/uploads/${session.id}/content`, {
          headers,
          data: content,
        })
      ).ok(),
    ).toBeTruthy();
  }
  await page.getByText("상세 검색", { exact: true }).click();
  await page.getByLabel("단체 필터").selectOption(org.id);
  await page.getByRole("button", { name: "검색 적용" }).click();
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await expect(page.locator(".library-document")).toHaveCount(1);
  await page.locator(".library-document").click();
  await page.getByRole("button", { name: "휴지통으로 이동" }).click();
  await page.getByRole("button", { name: "확인하고 실행" }).click();
  await expect(page.locator(".library-pagination")).toContainText("1 / 1");
  await expect(page.locator(".library-document")).toHaveCount(20);
});

test("모바일 자료실과 명시적 선생님 자료 권한 해제", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const org = await setupLibrary(page);
  await page.getByRole("button", { name: "＋ 자료 등록" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "위치 변경", exact: true }).click();
  await dialog.getByLabel("보관할 담당 범위").selectOption(org.id);
  await dialog.getByLabel("자료 제목").fill("모바일 가상 자료");
  await dialog.getByLabel("업로드 파일").setInputFiles({
    name: "mobile.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("mobile synthetic record"),
  });
  await dialog.getByRole("button", { name: "파일 등록", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.locator(".library-document").filter({ hasText: "모바일 가상 자료" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "../../local-data/preview/library-mobile.png",
    fullPage: true,
  });
  await page
    .getByText("선생님의 일반 자료 관리 범위 설정", { exact: true })
    .click();
  await page
    .getByRole("button", { name: `${org.name} · 권한 해제`, exact: true })
    .click();
  await expect(
    page.locator(".library-document").filter({ hasText: "모바일 가상 자료" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "모바일 가상 자료", exact: true }),
  ).toHaveCount(0);
});
