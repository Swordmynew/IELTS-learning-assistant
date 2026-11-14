import { expect, test, type Page } from "@playwright/test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { messages } from "../lib/messages";
import { shellMessages } from "../lib/shell-messages";
import { systemMessages, systemMessageEntries, systemMessageKeys } from "../lib/system-messages";
import { apiErrorMessage, localizeError, localizeSystemText } from "../lib/i18n";
import { planConflict, planRationale, recordContent, sourceSummary, writingAssessmentView } from "../lib/system-content";
import type { StudyPlan, WritingAssessment } from "../lib/api";

const catalogs = { en: { ...messages.en, ...shellMessages.en, ...systemMessages.en }, "zh-CN": { ...messages["zh-CN"], ...shellMessages["zh-CN"], ...systemMessages["zh-CN"] } };

test("all UI catalogs have matching keys, placeholders and translated English values", () => {
  expect(Object.keys(catalogs.en).sort()).toEqual(Object.keys(catalogs["zh-CN"]).sort());
  expect(new Set(systemMessageEntries.map(entry => entry[0])).size).toBe(systemMessageEntries.length);
  for (const [key, value] of Object.entries(catalogs.en)) {
    expect(value.trim(), key).not.toBe("");
    expect((value.match(/\{\w+\}/g) ?? []).sort(), key).toEqual((catalogs["zh-CN"][key].match(/\{\w+\}/g) ?? []).sort());
    if (key !== "shell.languageChinese") expect(value, key).not.toMatch(/[\u4e00-\u9fff]/);
  }
});

test("every literal UI translation key exists; no app-authored visible text bypasses the catalog", () => {
  const defects: string[] = [];
  function inspect(directory: string) {
    for (const name of readdirSync(directory)) {
      const filename = path.join(directory, name);
      if (statSync(filename).isDirectory()) { inspect(filename); continue; }
      if (!/\.tsx?$/.test(name) || name.endsWith("messages.ts")) continue;
      const source = ts.createSourceFile(filename, readFileSync(filename, "utf8"), ts.ScriptTarget.Latest, true);
      function visit(node: ts.Node) {
        if (ts.isJsxText(node) && /[A-Za-z\u4e00-\u9fff]/.test(node.text) && !["IA", "IELTS Coach"].includes(node.text.trim())) defects.push(`${filename}: ${node.text.trim()}`);
        if (ts.isJsxAttribute(node) && ["title", "placeholder", "aria-label", "alt"].includes(node.name.getText(source)) && node.initializer && ts.isStringLiteral(node.initializer) && /[A-Za-z\u4e00-\u9fff]/.test(node.initializer.text)) defects.push(`${filename}: ${node.initializer.text}`);
        if (ts.isCallExpression(node) && ["t", "translate"].includes(node.expression.getText(source)) && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && !catalogs.en[node.arguments[0].text]) defects.push(`${filename}: missing ${node.arguments[0].text}`);
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
  inspect("app"); inspect("lib");
  expect(defects).toEqual([]);
});

test("all literal backend HTTP error messages and fixed demo commentary have display translations", () => {
  const root = path.resolve("../backend/app");
  const known = new Set(systemMessageEntries.flatMap(entry => entry.slice(1)));
  for (const locale of ["en", "zh-CN"] as const) for (const catalog of [messages, shellMessages]) {
    for (const [key, value] of Object.entries(catalog[locale])) if (key.startsWith("error.")) known.add(value);
  }
  const missing: string[] = [];
  function inspect(directory: string) {
    for (const name of readdirSync(directory)) {
      const filename = path.join(directory, name);
      if (statSync(filename).isDirectory()) { if (name !== "__pycache__") inspect(filename); continue; }
      if (!name.endsWith(".py")) continue;
      const source = readFileSync(filename, "utf8");
      for (const match of source.matchAll(/HTTPException\(\s*(?:(?:status_code\s*=\s*)?\d+\s*,\s*(?:detail\s*=\s*)?)"([^"\n]+)"/g)) if (!known.has(match[1])) missing.push(`${filename}: ${match[1]}`);
      if (name === "coach_demo.py") for (const match of source.matchAll(/"([^"\n]*[\u4e00-\u9fff][^"\n]*)"/g)) if (!known.has(match[1])) missing.push(`demo: ${match[1]}`);
    }
  }
  inspect(root);
  expect(missing).toEqual([]);
});

test("API validation and processing failures are localised without echoing inputs or JSON", () => {
  expect(apiErrorMessage({ detail: [{ type: "value_error", msg: "Value error, exam_date must be in the future", input: "private input" }] }, 422)).toBe(systemMessages.en["error.api.examDate"]);
  expect(apiErrorMessage({ detail: [{ type: "string_too_short", input: "private password", ctx: { min_length: 8 } }] }, 422)).toBe(systemMessages.en["error.api.invalidRequest"]);
  expect(apiErrorMessage({ detail: { message: "Invalid model assessment", errors: ["private model data"] } }, 502)).toBe(systemMessages.en["error.api.invalidAssessment"]);
  expect(apiErrorMessage({ detail: "unknown internal error containing credentials" }, 500)).toBe(systemMessages.en["error.api.service"]);
  expect(apiErrorMessage({ detail: "error.unknown_internal_diagnostic" }, 500)).toBe(systemMessages.en["error.api.service"]);
  expect(localizeError("PDF 第 3 页需要 OCR；当前支持文本型 PDF")).toContain("PDF page 3");
  expect(localizeError("error.documentPopup")).toBe(messages.en["error.documentPopup"]);
  expect(localizeError("离线模式已启用")).toBe("离线模式已启用"); // Unknown content is not machine-translated.
});

test("built-in plans and provenance translate while unknown source values and live feedback remain unchanged", () => {
  expect(localizeSystemText("Task 2 限时写作")).toBe("Timed Task 2 essay");
  expect(sourceSummary("作文批改自动积累 · 用法纠正")).toBe("Automatically saved from writing feedback · Usage correction");
  expect(sourceSummary("My original source")).toBe("My original source");
  expect(planConflict("可用时间不足，未能安排必需任务：writing_task_2")).toContain("Writing Task 2");
  expect(planConflict("2026-11-15 scheduled 90 minutes but limit is 30")).toContain("90 scheduled minutes");
  const plan: StudyPlan = { id: "plan", status: "draft", starts_on: "2026-11-15", ends_on: "2026-11-21", tasks: [], conflicts: [], rationale: "已按照你每天可用的时间安排任务，本周优先加强写作、词汇。词汇复习按到期词卡和个人积累安排，当前有 12 个词待复习。" };
  expect(planRationale(plan)).toContain("Writing and Vocabulary");
  expect(planRationale(plan)).toContain("12 words");
  const assessment: WritingAssessment = { id: "assessment", model_used: "live-model", estimated_overall_band: 6, criteria: [], top_priorities: ["逐句检查主谓一致、冠词和标点"], rewrite_example: "My original revision", next_exercise: "用 10 分钟重写得分最低维度对应的一个正文段，并标注主题句与支持句。" };
  expect(writingAssessmentView(assessment)).toBe(assessment);
  const baseline = { ...assessment, model_used: "deterministic-demo-baseline" };
  expect(writingAssessmentView(baseline).top_priorities[0]).not.toMatch(/[\u4e00-\u9fff]/);
  expect(baseline.top_priorities[0]).toBe(assessment.top_priorities[0]);
  expect(recordContent("untouched user note")).toBe("untouched user note");
  expect(recordContent("raw snapshot", [{ label_key: "system.record.feedback", value: "保留模型原文" }])).toBe("AI feedback: 保留模型原文");
});

const today = "2026-11-15";
const original = "保留用户原文";
const profile = { exam_date: "2027-06-01", current_scores: { listening: 6, reading: 6, writing: 5, speaking: 6 }, target_scores: { listening: 7, reading: 7, writing: 7, speaking: 7 }, minutes_by_weekday: { "1": 90, "2": 90, "3": 90, "4": 90, "5": 90, "6": 90, "7": 90 }, preferred_skills: [] };
const plan = { id: "plan", status: "approved", starts_on: today, ends_on: "2026-11-21", rationale: "已按照你每天可用的时间安排任务，本周优先加强写作、词汇。词汇复习按到期词卡和个人积累安排，当前有 12 个词待复习。", conflicts: ["可用时间不足，未能安排必需任务：review"], tasks: [{ id: "task", scheduled_date: today, skill: "writing", task_type: "writing_task_2", title: "Task 2 限时写作", objective: "完成审题、提纲和一篇完整议论文", duration_minutes: 25, completed: false }] };

async function setup(page: Page, locale: "en" | "zh-CN") {
  await page.addInitScript(({ locale }) => {
    localStorage.setItem("ielts-access-token", "synthetic-localization-token");
    localStorage.setItem("ielts-ui-language", locale);
  }, { locale });
  const preferences = { default_start_page: "overview", listening_rate: 1, compact_question_options: false, show_learning_details: false };
  await page.route("**/api/v1/**", async route => {
    const pathname = new URL(route.request().url()).pathname.replace("/api/v1", "");
    let json: unknown = [];
    if (pathname === "/auth/me") json = { id: "synthetic", email: "test@example.com", display_name: "Learner", preferences };
    if (pathname === "/dashboard") json = { learning_today: today, profile, active_plan: plan, draft_plan: null, completed_tasks: 0, total_tasks: 1, latest_assessment: null };
    if (pathname === "/settings") json = preferences;
    if (pathname === "/question-bank/progress") json = { total_questions: 0, attempted_questions: 0, incorrect_questions: 0 };
    if (pathname === "/question-bank/questions") json = { total: 0, items: [] };
    if (pathname === "/vocabulary/deck") json = { items: [], total: 0, offset: 0, counts: { total: 0, starter: 0, personal: 0, due: 0, new: 0, learned: 0, suspended: 0 } };
    if (pathname === "/vocabulary/study") json = { items: [], due_count: 0, new_count: 0 };
    if (pathname === "/knowledge/topics") json = { presets: [], items: [] };
    if (pathname === "/knowledge/items") json = [{ id: "record", category: "writing", module: "writing", title: "grammar_accuracy", title_message_key: "ui.grammaticalRangeAndAccuracy", content: `原句：An original quote\nAI 反馈：${original}\n目标：An original goal`, display_fields: [{ label_key: "system.record.quote", value: "An original quote" }, { label_key: "system.record.feedback", value: original }, { label_key: "system.record.goal", value: "An original goal" }], status: "learned", source_link: "/writing", source_summary: "作文批改自动积累 · 用法纠正", topic_tags: ["grammar.countability"] }];
    if (pathname === "/knowledge/documents") json = [{ id: "document", title: "My original document", filename: "original.pdf", status: "failed", is_private: true, error: "PDF 第 3 页需要 OCR；当前支持文本型 PDF" }];
    if (pathname === "/agent/runs/stream") return route.fulfill({ status: 409, json: { detail: "档案或正式计划已变化，请重新生成草案" } });
    if (pathname === "/coach/demo") json = { prompt: "Original English exam question", knowledge: [{ title: "论据与结论", category: "mistake", content: "示例阅读错题：把支持局部观点的证据误当成全文结论。" }], versions: [{ essay: "Original English sample essay.", issues: [{ title: "连接关系", quote: "Original English quote", text: "前后都是支持免费教育的理由，however 表示的转折关系不成立。", source: "公共依据：任务回应" }], hints: ["这两句话是相互支持，还是相互转折？"] }], answer: "示例词汇记录：曾把 however 理解成因果词；它在这里表示转折。", citations: [] };
    await route.fulfill({ json });
  });
}

async function switchLocale(page: Page, locale: "en" | "zh-CN") {
  await page.evaluate(locale => window.dispatchEvent(new StorageEvent("storage", { key: "ielts-ui-language", newValue: locale })), locale);
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
}

for (const locale of ["en", "zh-CN"] as const) test(`all main routes use ${locale} with no missing keys or runtime errors`, async ({ page }) => {
  await setup(page, locale);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  for (const route of ["/", "/plan", "/profile", "/account", "/settings", "/vocabulary", "/question-bank", "/question-bank/new", "/resources", "/writing", "/login", "/register"]) {
    await page.goto(route);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.locator("main").first()).toBeVisible();
    await expect(page.locator(".page.loading-state")).toHaveCount(0);
    expect(await page.locator("body").innerText()).not.toMatch(/\b(?:ui|shell|system|launchpad|topic|error)\.[A-Za-z]/);
    if (locale === "en") expect((await page.locator("main").first().innerText()).replaceAll(original, "")).not.toMatch(/[\u4e00-\u9fff]/);
  }
  expect(errors).toEqual([]);
});

test("plans, API failures and document-processing errors respond to language switching", async ({ page }) => {
  await setup(page, "en");
  await page.goto("/plan");
  await expect(page.getByRole("heading", { name: "Timed Task 2 essay" })).toBeVisible();
  await page.locator(".plan-rationale summary").click();
  await expect(page.locator(".plan-rationale")).toContainText("Writing and Vocabulary");
  await page.getByRole("button", { name: "Regenerate plan", exact: true }).click();
  await expect(page.locator(".notice.error")).toContainText("Your profile or active plan has changed");
  await switchLocale(page, "zh-CN");
  await expect(page.locator(".notice.error")).toContainText("档案或正式计划已变化");
  await expect(page.getByRole("heading", { name: "Task 2 限时写作" })).toBeVisible();
  await expect(page.locator(".notice.warning")).not.toContainText("review");
  await page.goto("/resources");
  await switchLocale(page, "en");
  await page.getByRole("button", { name: "Documents and notes", exact: true }).click();
  await expect(page.locator(".document-list em")).toContainText("PDF page 3");
  await switchLocale(page, "zh-CN");
  await expect(page.locator(".document-list em")).toContainText("第 3 页");
});

test("knowledge metadata and demo commentary localise without altering learning text", async ({ page }) => {
  await setup(page, "en");
  await page.goto("/resources");
  const card = page.locator(".coach-knowledge-card");
  await expect(card.getByRole("heading")).toHaveText(messages.en["ui.grammaticalRangeAndAccuracy"]);
  await expect(card).toContainText("Learned");
  await expect(card.locator(".memory-tags")).toContainText(messages.en["topic.grammar.countability"]);
  await card.getByText("Original records", { exact: true }).click();
  await expect(card.locator(".coach-knowledge-source")).toContainText("Automatically saved from writing feedback");
  await expect(card.locator(".coach-record-content")).toContainText(`AI feedback: ${original}`);
  await switchLocale(page, "zh-CN");
  await expect(card.locator(".coach-record-content")).toContainText(`AI 反馈：${original}`);
  await expect(card).toContainText("已学习");
  await page.goto("/writing");
  await switchLocale(page, "en");
  await page.getByRole("button", { name: "Offline demo", exact: true }).first().click();
  const demo = page.getByRole("dialog");
  await expect(demo).toContainText("Logical connections");
  await expect(demo).toContainText("Original English sample essay.");
  expect(await demo.innerText()).not.toMatch(/[\u4e00-\u9fff]/);
  await switchLocale(page, "zh-CN");
  await expect(demo).toContainText("连接关系");
  await expect(demo).toContainText("Original English sample essay.");
});

test("native form validation follows the selected interface language", async ({ page }) => {
  await setup(page, "en");
  await page.goto("/login");
  const email = page.locator('input[type="email"]');
  await email.evaluate((element: HTMLInputElement) => element.reportValidity());
  expect(await email.evaluate((element: HTMLInputElement) => element.validationMessage)).toBe(systemMessages.en["error.api.required"]);
  await switchLocale(page, "zh-CN");
  await email.evaluate((element: HTMLInputElement) => element.reportValidity());
  expect(await email.evaluate((element: HTMLInputElement) => element.validationMessage)).toBe(systemMessages["zh-CN"]["error.api.required"]);
  await email.fill("learner@example.com");
  expect(await email.evaluate((element: HTMLInputElement) => element.validationMessage)).toBe("");
});
