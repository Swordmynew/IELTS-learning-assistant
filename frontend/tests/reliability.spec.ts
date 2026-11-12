import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page, request }) => {
  const response = await request.post("/api/v1/auth/register", { data: { email: `reliability-${crypto.randomUUID()}@example.com`, password: "SyntheticPlanning123" } });
  expect(response.status()).toBe(201);
  await page.addInitScript(token => localStorage.setItem("ielts-access-token", token), (await response.json()).access_token);
});

function profile(days: number, minutes: number) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const exam = new Date(`${today}T00:00:00Z`); exam.setUTCDate(exam.getUTCDate() + days);
  return { exam_date: exam.toISOString().slice(0, 10), current_scores: { reading: 5.5, writing: 5.5, listening: 5.5, speaking: 5.5 }, target_scores: { reading: 7, writing: 7, listening: 7, speaking: 7 }, minutes_by_weekday: Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map(day => [day, minutes])), preferred_skills: ["writing"], estimates: [] };
}

function syntheticPdf() {
  const content = ["FIRST SYNTHETIC PAGE: countability example.", "SECOND SYNTHETIC PAGE: collocation example."];
  const streams = content.map(text => `BT /F1 12 Tf 40 700 Td (${text}) Tj ET`);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 7 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>",
    ...streams.map(stream => `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let source = "%PDF-1.4\n"; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(source)); source += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(source);
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach(offset => { source += `${String(offset).padStart(10, "0")} 00000 n \n`; });
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(source);
}

test("real API: streamed plan respects exam boundary and can be approved", async ({ page, request }) => {
  await page.goto("/resources");
  const token = await page.evaluate(() => localStorage.getItem("ielts-access-token"));
  expect((await request.post("/api/v1/diagnostics", { headers: { Authorization: `Bearer ${token}` }, data: profile(1, 120) })).status()).toBe(200);
  await page.goto("/plan");
  const response = page.waitForResponse(value => value.url().endsWith("/agent/runs/stream"));
  await page.getByRole("button", { name: "生成本周计划", exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(page.getByText("草案已生成", { exact: true })).toBeVisible();
  await expect(page.locator(".day-column")).toHaveCount(1);
  await page.getByRole("button", { name: "启用计划", exact: true }).click();
  await expect(page.getByText("计划已启用", { exact: true })).toBeVisible();
  await page.screenshot({ path: "../tmp/iteration-20261112/plan-exam-boundary.png", fullPage: true });
});

test("real API: changing profile invalidates a displayed draft", async ({ page, request }) => {
  await page.goto("/resources");
  const token = await page.evaluate(() => localStorage.getItem("ielts-access-token"));
  const headers = { Authorization: `Bearer ${token}` };
  expect((await request.post("/api/v1/diagnostics", { headers, data: profile(30, 120) })).status()).toBe(200);
  await page.goto("/plan");
  await page.getByRole("button", { name: "生成本周计划", exact: true }).click();
  await expect(page.getByText("草案已生成", { exact: true })).toBeVisible();
  expect((await request.post("/api/v1/diagnostics", { headers, data: profile(30, 60) })).status()).toBe(200);
  await page.getByRole("button", { name: "启用计划", exact: true }).click();
  await expect(page.locator(".notice.error")).toContainText("失效");
  await page.getByRole("button", { name: "重新生成计划", exact: true }).click();
  await expect(page.getByText("草案已生成", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "启用计划", exact: true }).click();
  await expect(page.getByText("计划已启用", { exact: true })).toBeVisible();
});

test("real API: PDF pages can be read and exact text can be collected", async ({ page }) => {
  await page.goto("/resources");
  await page.getByRole("button", { name: "资料与笔记", exact: true }).click();
  await page.locator(".upload-disclosure > summary").click();
  await page.locator('input[type="file"]').setInputFiles({ name: "Synthetic-PDF-source.pdf", mimeType: "application/pdf", buffer: syntheticPdf() });
  await page.getByRole("button", { name: "上传", exact: true }).click();
  const row = page.locator(".document-list > article").filter({ hasText: "Synthetic-PDF-source" });
  await row.getByRole("button", { name: "查看原文", exact: true }).click();
  const reader = page.getByRole("region", { name: "资料原文" });
  await reader.getByRole("combobox", { name: "资料页码" }).selectOption("2");
  await expect(reader.locator(".document-source-chunk")).toContainText("SECOND SYNTHETIC PAGE");
  await expect(reader.locator(".document-source-chunk")).not.toContainText("FIRST SYNTHETIC PAGE");
  await reader.getByRole("button", { name: "收藏为笔记", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "收藏为笔记", exact: true });
  await editor.getByLabel("我的备注", { exact: true }).fill("功能测试：从 PDF 第二页收藏。");
  await editor.getByRole("button", { name: "保存笔记", exact: true }).click();
  await expect(editor).toBeHidden();
  await reader.screenshot({ path: "../tmp/iteration-20261112/pdf-source-page-detail.png" });
  await page.getByRole("heading", { name: "个人知识库", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: "../tmp/iteration-20261112/pdf-source-page.png", fullPage: true });
  await page.goto("/resources");
  await expect(page.getByRole("heading", { name: "Synthetic-PDF-source", exact: true })).toBeVisible();
});
