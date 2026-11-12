import { test, expect } from "@playwright/test";

// Uses the running offline API and disposable accounts; no real learner data or provider calls.
test.beforeEach(async ({ page, request }) => {
  const response = await request.post("/api/v1/auth/register", { data: { email: `memory-${crypto.randomUUID()}@example.com`, password: "SyntheticMemory123" } });
  expect(response.status()).toBe(201);
  const token = (await response.json()).access_token;
  await page.addInitScript(value => localStorage.setItem("ielts-access-token", value), token);
});

test("real API: note create, edit, retrieval, self-review and delete", async ({ page }) => {
  await page.goto("/resources");
  await page.getByRole("button", { name: "新建笔记", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "新建碎片笔记" });
  await editor.getByLabel("标题", { exact: true }).fill("不可数名词笔记（功能测试）");
  await editor.getByLabel("笔记内容", { exact: true }).fill("Information is uncountable. Avoid many information.");
  await editor.getByLabel("知识点标签", { exact: true }).fill("不可数名词");
  await editor.getByRole("button", { name: "保存笔记", exact: true }).click();
  await expect(editor).toBeHidden();
  const card = page.locator(".coach-knowledge-card").filter({ has: page.getByRole("heading", { name: "不可数名词笔记（功能测试）", exact: true }) });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "编辑记录" }).click();
  const edit = page.getByRole("dialog", { name: "编辑知识条目" });
  await edit.getByLabel("笔记内容", { exact: true }).fill("Use much information or a piece of information.");
  await edit.getByRole("button", { name: "保存笔记", exact: true }).click();
  await expect(edit).toBeHidden();
  await page.getByText("查找相关资料", { exact: true }).click();
  await page.getByLabel("查找笔记与错题").fill("a piece of information");
  await page.getByRole("button", { name: "查找", exact: true }).click();
  await expect(page.locator(".memory-find .coach-sources")).toContainText("不可数名词笔记（功能测试）");
  await page.locator(".memory-find .coach-sources summary").click();
  await expect(page.locator(".memory-find")).toContainText("Use much information or a piece of information.");
  await card.getByRole("button", { name: "记录复习", exact: true }).click();
  const review = page.getByRole("dialog", { name: "记录复习", exact: true });
  await review.getByLabel("这次练习后", { exact: true }).selectOption("improved");
  await review.getByLabel("练习或修改记录", { exact: true }).fill("功能测试：已完成一条自拟例句。");
  await review.getByRole("button", { name: "保存复习记录", exact: true }).click();
  await expect(review).toBeHidden();
  await expect(card).toContainText("自评：已改善");
  await card.getByText("学习记录", { exact: true }).click();
  await expect(card).toContainText("功能测试：已完成一条自拟例句。");
  await page.screenshot({ path: "../tmp/review-20261111/personal-memory-desktop.png", fullPage: true });
  await card.getByRole("button", { name: "删除知识条目" }).click();
  await expect(card).toHaveCount(0);
  await page.getByRole("button", { name: "查找", exact: true }).click();
  await expect(page.getByText("没有找到相关资料", { exact: true })).toBeVisible();
});

test("real API: question and writing excerpts can be collected", async ({ page, request }) => {
  await page.goto("/resources");
  const token = await page.evaluate(() => localStorage.getItem("ielts-access-token"));
  const headers = { Authorization: `Bearer ${token}` };
  const q = await request.post("/api/v1/question-bank/questions", { headers, data: { module: "reading", task_type: "multiple_choice", prompt: "Synthetic excerpt: choose much information.", passage: "Information is uncountable.", correct_answer: "much", source_name: "Personal memory browser fixture" } });
  expect(q.status()).toBe(201);
  const question = await q.json();
  await page.goto(`/question-bank?module=reading&question=${question.id}`);
  await page.getByRole("button", { name: "收藏为笔记", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "收藏为笔记", exact: true });
  await dialog.getByLabel("我的备注", { exact: true }).fill("功能测试：从原题收藏。");
  await dialog.getByRole("button", { name: "保存笔记", exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.goto("/resources");
  await expect(page.getByRole("heading", { name: question.prompt, exact: true })).toBeVisible();
  const session = await request.post("/api/v1/writing/sessions", { headers, data: { prompt: "Should public libraries remain free for all residents?" } });
  expect(session.status()).toBe(201);
  const writing = await session.json();
  const version = await request.post(`/api/v1/writing/sessions/${writing.id}/versions`, { headers, data: { essay: "Public libraries provide useful information. They help students learn independently." } });
  expect(version.status()).toBe(201);
  const draft = await version.json();
  await page.goto(`/writing?session=${writing.id}&version=${draft.id}`);
  await page.getByRole("button", { name: "收藏为笔记", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("原文摘录", { exact: true })).toHaveValue(draft.essay);
  await dialog.getByRole("button", { name: "保存笔记", exact: true }).click();
  await expect(dialog).toBeHidden();
  const saved = await request.get("/api/v1/knowledge/items", { headers });
  expect((await saved.json()).filter((item: { category: string }) => item.category === "note")).toHaveLength(2);
});

test("real API: mobile note form and topic filter fit viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/resources");
  await page.getByRole("button", { name: "新建笔记", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "新建碎片笔记" });
  await editor.getByLabel("标题", { exact: true }).fill("搭配笔记（功能测试）");
  await editor.getByLabel("笔记内容", { exact: true }).fill("Make a decision, not do a decision.");
  await editor.getByLabel("知识点标签", { exact: true }).fill("搭配");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.screenshot({ path: "../tmp/review-20261111/personal-memory-mobile-form.png", fullPage: true });
  await editor.getByRole("button", { name: "保存笔记", exact: true }).click();
  await expect(editor).toBeHidden();
  await page.getByRole("combobox", { name: "按知识点筛选" }).selectOption("lexical.collocation");
  await expect(page.getByRole("heading", { name: "搭配笔记（功能测试）" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.screenshot({ path: "../tmp/review-20261111/personal-memory-mobile.png", fullPage: true });
});
