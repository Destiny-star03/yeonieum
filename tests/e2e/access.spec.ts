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
  await form.getByLabel("단체", { exact: true }).selectOption("council");
  await form.getByLabel("담당 범위").selectOption("software-2-A");
  await form.getByLabel("역할", { exact: true }).selectOption("class_rep");
  await form.getByLabel("대상 담당자").selectOption("member");
  const year = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Seoul",
    year: "numeric",
  }).format(
    new Date(
      (await (await page.request.get("/api/workspace")).json()).server_time,
    ),
  );
  await expect(form.getByLabel("임기 시작")).toHaveValue(`${year}-01-01`);
  await expect(form.getByLabel("임기 종료 (당일 포함)")).toHaveValue(
    `${year}-12-31`,
  );
  await form.getByRole("button", { name: "역할 부여하기" }).click();
  await expect(page.getByRole("status")).toContainText("역할을 등록했습니다");
  const work = await (await page.request.get("/api/workspace")).json();
  const saved = work.assignments.find(
    (a: { user_id: string; role: string; revoked_at: string | null }) =>
      a.user_id === "member" && a.role === "class_rep" && !a.revoked_at,
  );
  expect(new Date(saved.ends_at).toISOString()).toBe(
    new Date(`${Number(year) + 1}-01-01T00:00:00+09:00`).toISOString(),
  );
  await page.reload();
  await page.getByRole("button", { name: "조직 · 권한", exact: true }).click();
  await page
    .getByRole("button", { name: "학과협의회 역할 보기", exact: true })
    .click();
  await expect(
    page.locator(".assignment").filter({ hasText: "가상 신규 담당자" }),
  ).toContainText("2학년 / A반");
  await expect(
    page.locator(".assignment").filter({ hasText: "가상 신규 담당자" }),
  ).toContainText(new RegExp(`${year}\\.\\s*12\\.\\s*31`));
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
  await page
    .locator(".people-panel")
    .getByRole("button", { name: /더보기 · 나머지 담당자/ })
    .click();
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
  await dialog.getByLabel("가상 학번").fill("20260010");
  await expect(dialog.getByRole("checkbox")).toHaveCount(5);
  await dialog
    .getByRole("checkbox", { name: "학과협의회", exact: true })
    .check();
  await dialog.getByRole("checkbox", { name: "총학생회", exact: true }).check();
  const password = dialog.getByLabel("시연 비밀번호");
  for (const value of ["abc123!", "abcdefgh!", "abcd1234"]) {
    await password.fill(value);
    expect(
      await password.evaluate((e: HTMLInputElement) => e.checkValidity()),
    ).toBe(false);
  }
  await password.fill("abcd123!");
  expect(
    await password.evaluate((e: HTMLInputElement) => e.checkValidity()),
  ).toBe(true);
  await dialog.getByLabel("가상 전화번호").fill("01012345678");
  await expect(dialog.getByLabel("가상 전화번호")).toHaveValue("010-1234-5678");
  await dialog
    .getByRole("button", { name: "담당자 등록", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "가상 담당자를 등록했습니다",
  );
  const registeredRow = page
    .getByRole("row")
    .filter({ hasText: "가상 첫 학회장 후보" });
  await expect(registeredRow).toContainText("학과협의회");
  await expect(registeredRow).toContainText("총학생회");
  await acceptInvite(page, "가상 첫 학회장 후보");
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await page.getByRole("button", { name: "등록한 계정 직접 입력" }).click();
  await page.getByLabel("시연 계정").fill("20260010");
  await page.getByLabel("비밀번호", { exact: true }).fill("abcd123!");
  await page.getByRole("button", { name: "업무 공간으로 들어가기 →" }).click();
  await expect(page.getByRole("heading", { name: "대시보드" })).toBeVisible();
  await expect(
    page.getByText("현재 유효한 업무 역할이 없습니다."),
  ).toContainText("현재 유효한 업무 역할이 없습니다.");
});

test("관리자 단체 추가, 기존 계정 역할 피드백, 확인 문구로 담당자 제거와 단체 삭제", async ({
  page,
}) => {
  await login(page, "staff-demo");
  await page.getByRole("button", { name: "조직 · 권한", exact: true }).click();
  await page.getByLabel("새 단체명").fill("가상 신설단체");
  await page.getByRole("button", { name: "단체 추가", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("단체를 추가했습니다");
  await page.getByRole("button", { name: "＋ 가상 담당자 등록" }).click();
  const registration = page.getByRole("dialog");
  await registration
    .getByLabel("이름", { exact: true })
    .fill("가상 신설 책임자");
  await registration
    .getByLabel("초대 대상 이메일")
    .fill("new-org@demo.invalid");
  await registration.getByLabel("가상 학번").fill("20260011");
  await registration.getByLabel("가상 전화번호").fill("01098765432");
  const orgCheckbox = registration.getByRole("checkbox", {
    name: "가상 신설단체",
    exact: true,
  });
  const orgId = await orgCheckbox.getAttribute("value");
  await orgCheckbox.check();
  await registration
    .getByRole("button", { name: "담당자 등록", exact: true })
    .click();
  const grant = page
    .locator("form")
    .filter({ has: page.getByRole("button", { name: "역할 부여하기" }) });
  await grant.getByRole("button", { name: "역할 부여하기" }).click();
  await expect(grant.getByRole("alert")).toContainText("필수 입력");
  await grant.getByLabel("단체", { exact: true }).selectOption(orgId!);
  await grant.getByLabel("담당 범위").selectOption(orgId!);
  await grant.getByLabel("역할", { exact: true }).selectOption("head");
  await grant
    .getByLabel("대상 담당자")
    .selectOption({ label: "가상 신설 책임자" });
  await grant.getByRole("button", { name: "역할 부여하기" }).click();
  await expect(grant.getByRole("status")).toContainText("역할을 등록했습니다");
  await grant.getByRole("button", { name: "역할 부여하기" }).click();
  await expect(grant.getByRole("alert")).toContainText("중복된 역할");
  await page
    .getByRole("button", { name: "가상 신설 책임자 제거", exact: true })
    .click();
  const removal = page.getByRole("dialog");
  await expect(removal.getByRole("heading")).toHaveText(
    "담당자를 제거하시겠습니까?",
  );
  await removal.getByLabel("확인 문구").fill("제거");
  await expect(
    removal.getByRole("button", { name: "담당자 제거", exact: true }),
  ).toBeDisabled();
  await removal.getByLabel("확인 문구").fill("제거하겠습니다");
  await removal
    .getByRole("button", { name: "담당자 제거", exact: true })
    .click();
  await expect(removal).not.toBeVisible();
  await expect(
    page.getByRole("cell", { name: "가상 신설 책임자", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "가상 신설단체 삭제", exact: true })
    .click();
  const deletion = page.getByRole("dialog");
  await expect(deletion.getByRole("heading")).toHaveText(
    "단체를 삭제하시겠습니까?",
  );
  await deletion.getByLabel("확인 문구").fill("삭제");
  await expect(
    deletion.getByRole("button", { name: "단체 삭제", exact: true }),
  ).toBeDisabled();
  await deletion.getByLabel("확인 문구").fill("삭제하겠습니다");
  await deletion
    .getByRole("button", { name: "단체 삭제", exact: true })
    .click();
  await expect(deletion).not.toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "조직 · 권한", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "가상 신설단체 삭제", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("cell", { name: "가상 신설 책임자", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("새 단체명").fill("가상 신설단체");
  await page.getByRole("button", { name: "단체 추가", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    "삭제했던 단체를 복원했습니다",
  );
  await expect(
    page.getByRole("button", { name: "가상 신설단체 삭제", exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("cell", { name: "가상 신설 책임자", exact: true }),
  ).toHaveCount(0);
});

async function acceptInvite(page: Parameters<typeof login>[0], name: string) {
  const link = await page
    .locator(".outbox-message")
    .filter({ hasText: name })
    .getByRole("link", { name: "초대 확인 열기" })
    .getAttribute("href");
  const recipient = await page.context().newPage();
  try {
    await recipient.goto(link!);
    await recipient.getByRole("button", { name: "초대 인증 완료하기" }).click();
    await expect(
      recipient.getByRole("heading", { name: "초대 인증을 완료했습니다" }),
    ).toBeVisible();
  } finally {
    await recipient.close();
  }
}

test("삭제 계정 재등록은 같은 계정으로 복구하고 새 초대만 허용", async ({
  page,
}) => {
  await login(page, "staff-demo");
  await page.getByRole("button", { name: "조직 · 권한", exact: true }).click();
  async function register() {
    await page.getByRole("button", { name: "＋ 가상 담당자 등록" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("이름", { exact: true }).fill("가상 복구 후보");
    await dialog
      .getByLabel("초대 대상 이메일")
      .fill("restore-browser@demo.invalid");
    await dialog.getByLabel("가상 학번").fill("20260012");
    await dialog.getByLabel("가상 전화번호").fill("01012345678");
    await dialog
      .getByRole("checkbox", { name: "신문방송국", exact: true })
      .check();
    await dialog
      .getByRole("checkbox", { name: "연합동아리", exact: true })
      .check();
    await dialog
      .getByRole("button", { name: "담당자 등록", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
  }
  await register();
  const oldLink = await page
    .locator(".outbox-message")
    .filter({ hasText: "가상 복구 후보" })
    .getByRole("link")
    .getAttribute("href");
  await page
    .getByRole("button", { name: "가상 복구 후보 제거", exact: true })
    .click();
  await page.getByRole("dialog").getByLabel("확인 문구").fill("제거하겠습니다");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "담당자 제거", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await register();
  await expect(page.getByRole("status")).toContainText(
    "삭제했던 담당자 계정을 복구했습니다",
  );
  const row = page.getByRole("row").filter({ hasText: "가상 복구 후보" });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("신문방송국");
  await expect(row).toContainText("연합동아리");
  const old = await page.context().newPage();
  try {
    await old.goto(oldLink!);
    await old.getByRole("button", { name: "초대 인증 완료하기" }).click();
    await expect(old.getByRole("alert")).toContainText(
      "유효하지 않거나 만료된",
    );
  } finally {
    await old.close();
  }
  await acceptInvite(page, "가상 복구 후보");
});

test("선생님의 하위 부서·역할 종류 관리와 범위 우선 역할 부여", async ({
  page,
}) => {
  await login(page, "staff-demo");
  await page.getByRole("button", { name: "조직 · 권한", exact: true }).click();
  const grant = page
    .locator("form")
    .filter({ has: page.getByRole("button", { name: "역할 부여하기" }) });
  await expect(grant.getByLabel("역할", { exact: true })).toBeDisabled();
  await grant.getByLabel("단체", { exact: true }).selectOption("student");
  await grant.getByLabel("담당 범위").selectOption("student-office");
  await expect(
    grant.getByLabel("역할", { exact: true }).locator("option"),
  ).toHaveText(["범위에 맞는 역할 선택", "부장", "차장"]);
  const management = page.locator(".structure-management");
  await management.getByLabel("관리할 단체").selectOption("press");
  await management.getByLabel("상위 조직").selectOption("press");
  await management.getByLabel("하위 조직명").fill("가상 방송기획부");
  await management
    .getByRole("button", { name: "하위 조직 등록", exact: true })
    .click();
  await expect(management.getByRole("status")).toContainText(
    "하위 조직을 등록했습니다",
  );
  await management.getByLabel("역할 이름").fill("촬영 담당");
  await management.getByLabel("역할 적용 범위").selectOption("office");
  await management
    .getByRole("button", { name: "역할 종류 추가", exact: true })
    .click();
  await expect(management.getByRole("status")).toContainText(
    "역할 종류를 추가",
  );
  await grant.getByLabel("단체", { exact: true }).selectOption("press");
  const scope = grant.getByLabel("담당 범위");
  const scopeId = await scope
    .locator("option")
    .filter({ hasText: "가상 방송기획부" })
    .getAttribute("value");
  await scope.selectOption(scopeId!);
  await expect(
    grant.getByLabel("역할", { exact: true }).locator("option"),
  ).toContainText(["범위에 맞는 역할 선택", "부장", "차장", "촬영 담당"]);
  await page.getByRole("button", { name: "＋ 가상 담당자 등록" }).click();
  const registration = page.getByRole("dialog");
  await registration
    .getByLabel("이름", { exact: true })
    .fill("가상 촬영 담당자");
  await registration.getByLabel("초대 대상 이메일").fill("camera@demo.invalid");
  await registration.getByLabel("가상 학번").fill("20260013");
  await registration.getByLabel("가상 전화번호").fill("01012345678");
  await registration
    .getByRole("checkbox", { name: "신문방송국", exact: true })
    .check();
  await registration
    .getByRole("button", { name: "담당자 등록", exact: true })
    .click();
  await expect(registration).not.toBeVisible();
  await acceptInvite(page, "가상 촬영 담당자");
  await grant
    .getByLabel("역할", { exact: true })
    .selectOption({ label: "촬영 담당" });
  await grant
    .getByLabel("대상 담당자")
    .selectOption({ label: "가상 촬영 담당자" });
  await grant.getByRole("button", { name: "역할 부여하기" }).click();
  await expect(grant.getByRole("status")).toContainText("역할을 등록했습니다");
  const assignment = page
    .locator(".assignment")
    .filter({ hasText: "가상 촬영 담당자" });
  await expect(assignment).toContainText("촬영 담당");
  await expect(assignment).toContainText("가상 방송기획부");
  await management
    .getByRole("button", { name: "촬영 담당 역할 종류 삭제", exact: true })
    .click();
  const removal = page.getByRole("dialog");
  await removal.getByLabel("확인 문구").fill("삭제하겠습니다");
  await removal
    .getByRole("button", { name: "역할 종류 삭제", exact: true })
    .click();
  await expect(removal).not.toBeVisible();
  await expect(assignment).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "조직 · 권한", exact: true }).click();
  await expect(
    page.locator(".assignment").filter({ hasText: "가상 촬영 담당자" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "활동 이력", exact: true }).click();
  await expect(
    page.locator(".audit-row").filter({ hasText: "역할 회수" }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "조직 · 권한", exact: true }).click();
  await grant.getByLabel("단체", { exact: true }).selectOption("press");
  await grant.getByLabel("담당 범위").selectOption(scopeId!);
  await expect(
    grant
      .getByLabel("역할", { exact: true })
      .locator("option")
      .filter({ hasText: "촬영 담당" }),
  ).toHaveCount(0);
});

test("학회장의 자기 학과 학년·반 등록과 반대표 계정·역할 지정", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "student-head");
  await page.getByRole("button", { name: "조직 · 권한", exact: true }).click();
  const structure = page.locator(".structure-management");
  await expect(
    structure.getByRole("heading", {
      name: "학과 하위 조직 관리",
      exact: true,
    }),
  ).toBeVisible();
  await expect(structure.getByLabel("역할 이름")).toHaveCount(0);
  await structure.getByLabel("관리할 단체").selectOption("council");
  await expect(
    structure
      .getByLabel("상위 조직")
      .locator("option")
      .filter({ hasText: "스마트소프트웨어" }),
  ).toHaveCount(0);
  await structure.getByLabel("상위 조직").selectOption("mechanical");
  await structure.getByLabel("하위 조직명").fill("3학년");
  await structure
    .getByRole("button", { name: "하위 조직 등록", exact: true })
    .click();
  await expect(structure.getByRole("status")).toContainText(
    "하위 조직을 등록했습니다",
  );
  const yearId = await structure
    .getByLabel("상위 조직")
    .locator("option")
    .filter({ hasText: "3학년" })
    .getAttribute("value");
  await structure.getByLabel("상위 조직").selectOption(yearId!);
  await structure.getByLabel("하위 조직명").fill("B반");
  await structure
    .getByRole("button", { name: "하위 조직 등록", exact: true })
    .click();
  await expect(structure.getByRole("status")).toContainText(
    "하위 조직을 등록했습니다",
  );
  await page.getByRole("button", { name: "＋ 가상 담당자 등록" }).click();
  const registration = page.getByRole("dialog");
  await registration
    .getByLabel("이름", { exact: true })
    .fill("가상 기계3B대표");
  await registration.getByLabel("초대 대상 이메일").fill("rep3b@demo.invalid");
  await registration.getByLabel("가상 학번").fill("20260014");
  await registration.getByLabel("가상 전화번호").fill("01012345678");
  const scope = registration.getByRole("checkbox", {
    name: "학과협의회 / 기계공학과 / 3학년 / B반",
    exact: true,
  });
  const classId = await scope.getAttribute("value");
  await scope.check();
  await registration
    .getByRole("button", { name: "담당자 등록", exact: true })
    .click();
  await expect(registration).not.toBeVisible();
  await acceptInvite(page, "가상 기계3B대표");
  const grant = page.locator(".grant-panel form");
  await grant.getByLabel("단체", { exact: true }).selectOption("council");
  await grant.getByLabel("담당 범위").selectOption(classId!);
  await expect(
    grant
      .getByLabel("역할", { exact: true })
      .locator("option")
      .filter({ hasText: "3학년 B반 반대표" }),
  ).toHaveCount(1);
  await grant.getByLabel("역할", { exact: true }).selectOption("class_rep");
  await grant
    .getByLabel("대상 담당자")
    .selectOption({ label: "가상 기계3B대표" });
  await grant.getByRole("button", { name: "역할 부여하기" }).click();
  await expect(grant.getByRole("status")).toContainText("역할을 등록했습니다");
  await expect(
    page.locator(".assignment").filter({ hasText: "가상 기계3B대표" }),
  ).toContainText("3학년 B반 반대표");
  const department = page.locator('[data-group-key="department:mechanical"]');
  await department.locator("summary").click();
  await expect(department).toContainText("가상 기계3B대표");
  const officers = page.locator('[data-group-key="council-officers"]');
  await expect(officers).toContainText("가상 부학회장");
  await expect(officers).not.toContainText("가상 기계3B대표");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("학회장 카드에서 의장 표시를 지정하고 해제해도 학회장은 유지", async ({
  page,
}) => {
  await login(page, "staff-demo");
  await page.getByRole("button", { name: "조직 · 권한", exact: true }).click();
  await page
    .getByRole("button", { name: "학과협의회 역할 보기", exact: true })
    .click();
  const outgoing = page.locator(".assignment").filter({ hasText: "가상 의장" });
  await expect(outgoing).toHaveCount(1);
  await expect(outgoing.locator(".chair-badge")).toHaveText("의장");
  await outgoing
    .getByRole("button", { name: "가상 의장 의장 해제", exact: true })
    .click();
  const revoke = page.getByRole("dialog");
  await revoke
    .getByLabel("회수 사유")
    .fill("학회장 투표 결과에 따른 의장 교체");
  await revoke.getByRole("button", { name: "역할 회수", exact: true }).click();
  await expect(revoke).not.toBeVisible();
  await expect(outgoing).toContainText("학회장");
  await expect(outgoing.locator(".chair-badge")).toHaveCount(0);
  const incoming = page
    .locator(".assignment")
    .filter({ hasText: "가상 학회장" });
  await incoming
    .getByRole("button", { name: "가상 학회장 의장 지정", exact: true })
    .click();
  const appoint = page.getByRole("dialog");
  await expect(appoint.getByRole("heading")).toHaveText("학회장에게 의장 표시");
  await appoint
    .getByLabel("선출 확인 내용")
    .fill("학회장 투표에 따른 가상 선출 결과 확인");
  await appoint
    .getByRole("button", { name: "의장 지정 완료", exact: true })
    .click();
  await expect(appoint).not.toBeVisible();
  await expect(incoming).toHaveCount(1);
  await expect(incoming.locator(".chair-badge")).toHaveText("의장");
  const work = await (await page.request.get("/api/workspace")).json();
  const chair = work.assignments.find(
    (a: { role: string; effective: boolean }) =>
      a.role === "chair" && a.effective,
  );
  const parent = work.assignments.find(
    (a: { id: string }) => a.id === chair.prerequisite_id,
  );
  expect(chair.user_id).toBe(parent.user_id);
  expect(chair.starts_at).toBe(parent.starts_at);
  expect(chair.ends_at).toBe(parent.ends_at);
});

test("학회장이 하위 조직을 삭제하고 같은 이름으로 하위 구조를 복원", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "student-head");
  await page.getByRole("button", { name: "조직 · 권한", exact: true }).click();
  const panel = page.locator(".structure-management");
  await panel.getByLabel("관리할 단체").selectOption("council");
  await panel.getByLabel("상위 조직").selectOption("mechanical");
  await panel.getByLabel("하위 조직명").fill("4학년");
  await panel
    .getByRole("button", { name: "하위 조직 등록", exact: true })
    .click();
  await expect(panel.getByRole("status")).toContainText(
    "하위 조직을 등록했습니다",
  );
  const yearRow = panel.locator(".unit-list li").filter({ hasText: "4학년" });
  const yearId = await yearRow.getAttribute("data-unit-id");
  await panel.getByLabel("상위 조직").selectOption(yearId!);
  await panel.getByLabel("하위 조직명").fill("C반");
  await panel
    .getByRole("button", { name: "하위 조직 등록", exact: true })
    .click();
  await expect(panel.getByRole("status")).toContainText(
    "하위 조직을 등록했습니다",
  );
  const classId = await panel
    .locator(".unit-list li")
    .filter({ hasText: "C반" })
    .getAttribute("data-unit-id");
  await panel.getByLabel("상위 조직").selectOption("mechanical");
  await yearRow
    .getByRole("button", {
      name: "학과협의회 / 기계공학과 / 4학년 하위 조직 삭제",
      exact: true,
    })
    .click();
  const removal = page.getByRole("dialog");
  await expect(
    removal.getByRole("heading", {
      name: "정말로 삭제하시겠습니까?",
      exact: true,
    }),
  ).toBeVisible();
  await expect(removal.locator(".delete-notice")).toContainText(
    "현재·예약 역할이 모두 회수",
  );
  await expect(removal.locator(".delete-notice")).toContainText(
    "계정과 과거 이력은 보존",
  );
  const consent = removal.getByRole("checkbox", {
    name: "유의사항을 확인했으며, 삭제하겠습니다.",
  });
  await expect(consent).not.toBeChecked();
  await expect(
    removal.getByRole("button", { name: "하위 조직 삭제", exact: true }),
  ).toBeDisabled();
  await consent.check();
  await expect(
    removal.getByRole("button", { name: "하위 조직 삭제", exact: true }),
  ).toBeEnabled();
  await removal.getByRole("button", { name: "취소", exact: true }).click();
  await yearRow
    .getByRole("button", {
      name: "학과협의회 / 기계공학과 / 4학년 하위 조직 삭제",
      exact: true,
    })
    .click();
  await expect(consent).not.toBeChecked();
  await consent.check();
  await removal
    .getByRole("button", { name: "하위 조직 삭제", exact: true })
    .click();
  await expect(removal).not.toBeVisible();
  await expect(yearRow).toHaveCount(0);
  const work = await (await page.request.get("/api/workspace")).json();
  expect(
    work.units.some((u: { id: string }) => u.id === yearId || u.id === classId),
  ).toBe(false);
  await panel.getByLabel("하위 조직명").fill("4학년");
  await panel
    .getByRole("button", { name: "하위 조직 등록", exact: true })
    .click();
  await expect(panel.getByRole("status")).toContainText(
    "삭제했던 하위 조직을 복원했습니다",
  );
  await expect(yearRow).toHaveAttribute("data-unit-id", yearId!);
  await panel.getByLabel("상위 조직").selectOption(yearId!);
  await expect(
    panel.locator(`.unit-list li[data-unit-id="${classId}"]`),
  ).toContainText("C반");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("단체별 역할 선택과 담당자 더보기·이름/단체명 검색", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "staff-demo");
  await page.getByRole("button", { name: "조직 · 권한", exact: true }).click();
  const people = page.locator(".people-panel");
  const roles = page.locator(".assignments-panel");
  const search = people.getByLabel("담당자 검색");
  await expect(
    people.getByRole("cell", { name: "가상 학생회장", exact: true }),
  ).toBeVisible();
  await expect(
    people.getByRole("cell", { name: "가상 부학회장", exact: true }),
  ).toHaveCount(0);
  await people.getByRole("button", { name: /더보기 · 나머지 담당자/ }).click();
  await expect(
    people.getByRole("cell", { name: "가상 부학회장", exact: true }),
  ).toBeVisible();
  await people
    .getByRole("button", { name: "접기 · 자치단체장만 보기" })
    .click();
  await expect(
    people.getByRole("cell", { name: "가상 부학회장", exact: true }),
  ).toHaveCount(0);
  await search.fill("가상 부학회장");
  await expect(people.locator("tbody tr")).toHaveCount(1);
  await expect(
    people.getByRole("cell", { name: "가상 부학회장", exact: true }),
  ).toBeVisible();
  await search.fill(" 학과 협의회 ");
  await expect(
    people.getByRole("cell", { name: "가상 부학회장", exact: true }),
  ).toBeVisible();
  await expect(
    people.getByRole("cell", { name: "가상 첫 학회장 후보", exact: true }),
  ).toBeVisible();
  await expect(
    people.getByRole("cell", { name: "가상 학생회장", exact: true }),
  ).toHaveCount(0);
  await search.fill("총학생회");
  await expect(
    people.getByRole("cell", { name: "가상 첫 학회장 후보", exact: true }),
  ).toBeVisible();
  await expect(
    people.getByRole("cell", { name: "가상 학생회장", exact: true }),
  ).toBeVisible();
  await expect(
    people.getByRole("cell", { name: "가상 부학회장", exact: true }),
  ).toHaveCount(0);
  await search.fill("없는단체검색");
  await expect(people.getByText("검색 결과가 없습니다.")).toBeVisible();
  await search.fill("");
  await expect(
    people.getByRole("cell", { name: "가상 부학회장", exact: true }),
  ).toHaveCount(0);
  await expect(roles.locator(".assignment")).toHaveCount(0);
  await roles
    .getByRole("button", { name: "총학생회 역할 보기", exact: true })
    .click();
  await expect(
    roles.getByRole("button", { name: "총학생회 역할 보기", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    roles.locator(".assignment").filter({ hasText: "가상 학생회장" }),
  ).toBeVisible();
  await expect(
    roles.locator(".assignment").filter({ hasText: "가상 부학회장" }),
  ).toHaveCount(0);
  await roles
    .getByRole("button", { name: "학과협의회 역할 보기", exact: true })
    .click();
  await expect(
    roles.locator(".assignment").filter({ hasText: "가상 부학회장" }),
  ).toBeVisible();
  await expect(
    roles.locator(".assignment").filter({ hasText: "가상 학생회장" }),
  ).toHaveCount(0);
  await roles
    .getByRole("button", { name: "모니터링단 역할 보기", exact: true })
    .click();
  await expect(
    roles.getByText("이 단체에 조회 가능한 역할이 없습니다."),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await login(page, "student-rep");
  await page.getByRole("button", { name: "조직 · 권한", exact: true }).click();
  await search.fill("가상 학회장");
  await expect(people.locator("tbody tr")).toHaveCount(0);
  await expect(people.getByText("검색 결과가 없습니다.")).toBeVisible();
});

test("학회장의 반 등록 안내와 기존 학년 항목의 반 변경·반대표 부여 연결", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "student-head");
  await page.getByRole("button", { name: "조직 · 권한", exact: true }).click();
  const structure = page.locator(".structure-management");
  const grant = page.locator(".grant-panel form");
  await structure.getByLabel("관리할 단체").selectOption("council");
  await structure.getByLabel("상위 조직").selectOption("mechanical");
  await structure.getByLabel("하위 조직명").fill("3SAP");
  await expect(structure.getByRole("alert")).toContainText(
    "지금은 학년 등록입니다",
  );
  await expect(
    structure.getByRole("button", { name: "하위 조직 등록", exact: true }),
  ).toBeDisabled();
  await structure.getByLabel("하위 조직명").fill("5학년");
  await structure
    .getByRole("button", { name: "하위 조직 등록", exact: true })
    .click();
  await expect(structure.getByRole("status")).toContainText("현재 항목은 학년");
  const yearId = await structure
    .getByLabel("상위 조직")
    .locator("option")
    .filter({ hasText: "기계공학과 / 5학년" })
    .getAttribute("value");
  await structure.getByLabel("하위 조직명").fill("6학년");
  await structure
    .getByRole("button", { name: "하위 조직 등록", exact: true })
    .click();
  await expect(structure.getByLabel("하위 조직명")).toHaveValue("");
  const legacy = structure
    .locator(".unit-list li")
    .filter({ hasText: "6학년" });
  const legacyId = await legacy.getAttribute("data-unit-id");
  await legacy.getByRole("button", { name: /반으로 변경/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("소속 학년").selectOption(yearId!);
  await dialog.getByLabel("반 이름").fill("SAP반");
  await dialog
    .getByRole("button", { name: "반으로 변경", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(grant.getByLabel("단체", { exact: true })).toHaveValue(
    "council",
  );
  await expect(grant.getByLabel("담당 범위")).toHaveValue(legacyId!);
  await expect(grant.getByLabel("역할", { exact: true })).toHaveValue(
    "class_rep",
  );
  await expect(
    grant.getByLabel("역할", { exact: true }).locator("option:checked"),
  ).toHaveText("5학년 SAP반 반대표");
  await grant.getByLabel("대상 담당자").selectOption("vice");
  await grant
    .getByRole("button", { name: "역할 부여하기", exact: true })
    .click();
  await expect(grant.getByRole("status")).toContainText("역할을 등록했습니다");
  await expect(
    page.locator(".assignment").filter({ hasText: "5학년 SAP반 반대표" }),
  ).toContainText("가상 부학회장");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
