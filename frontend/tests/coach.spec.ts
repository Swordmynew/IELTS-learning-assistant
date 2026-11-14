import { test, expect, type Page } from "@playwright/test";

const prompt = "Should university education be free for everyone? Discuss your opinion.";
const essay = "Education helps students. However, it gives them useful skills.";
const revised = "Targeted grants help low-income students gain useful qualifications.";
const source = { source_id: "rubric", title: "Coherence and Cohesion", excerpt: "衔接表达应符合实际逻辑关系。", source_type: "public" };
const issue = { id: "logic", criterion: "coherence_cohesion", quote: essay, explanation: "两句话之间没有形成转折。", goal: "先识别逻辑关系，再选择连接词。", source_ids: ["rubric"] };
const versions = [0, 1].map(index => ({ id: `v${index + 1}`, created_at: "2026-11-10T12:00:00Z", essay: index ? revised : essay, status: "assessed", feedback: {
  mode: "live", model: "synthetic-browser-fixture", generated_at: "2026-11-10T12:00:00Z", citations: [],
  data: { assessment: { estimated_overall_band: 6, criteria: ["task_achievement", "coherence_cohesion", "lexical_resource", "grammar_accuracy"].map(criterion => ({ criterion, band: 6, explanation: "示例反馈", evidence: [{ quote: index ? revised : essay }], citations: [source] })), disclaimer: "AI 学习估分" }, issues: [issue], improvements: index ? [{ issue_id: "logic", status: "improved", old_quote: essay, new_quote: revised, explanation: "移除了没有成立的转折关系。" }] : [], personal_note: "", personal_source_ids: [] },
} }));
const demo = { mode: "demo", prompt, knowledge: [{ title: "however", category: "vocabulary", content: "示例词汇记录" }], versions: [0, 1].map(index => ({ essay: index ? revised : essay, issues: [{ title: "连接关系", quote: index ? revised : essay, text: "检查真实的逻辑关系。", source: "原创示例" }], hints: ["两句是什么关系？", "先识别逻辑关系。", "For example, targeted grants help students."] })), answer: "示例跨科目回答。", citations: [source] };

async function setup(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("ielts-access-token", "synthetic-browser-token");
    localStorage.setItem("ielts-ui-language", "zh-CN");
  });
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = [];
    if (path.endsWith("/auth/me")) data = { id: "fixture", email: "fixture@example.com", display_name: "界面测试", demo: true, preferences: { default_start_page: "overview" } };
    else if (path.endsWith("/writing/sessions")) data = [{ id: "s1", prompt }];
    else if (path.endsWith("/writing/sessions/s1")) data = { id: "s1", prompt, versions };
    else if (path.includes("/hints/")) data = { mode: "cache", data: { text: "这两句话真的存在转折吗？" } };
    else if (path.endsWith("/knowledge/items")) data = [{ id: "k1", title: "however", content: "原选择：因果；正确含义：转折", note: "", category: "vocabulary", module: "vocabulary", source_summary: "作文批改自动积累 · 用法纠正", status: "review", source_link: "/vocabulary" }, { id: "k2", title: "段落逻辑", content: "段落需要更明确的逻辑。", category: "writing", module: "writing", status: "review", source_link: "/writing?session=s1" }];
    else if (path.endsWith("/question-bank/questions")) data = { total: 1, items: [{ id: "q1", source_name: "阅读练习", module: "reading", task_type: "multiple_choice", prompt: "Which word expresses contrast?", passage: "However expresses contrast.", options: ["however", "therefore"], has_answer: true, tags: [], is_public: false }] };
    else if (path.endsWith("/question-bank/progress")) data = { total_questions: 1, attempted_questions: 0, incorrect_questions: 0, accuracy: 0 };
    else if (path.endsWith("/q1/attempts")) data = { question_id: "q1", is_correct: true, submitted_answer: "however", correct_answer: "however", explanation: "However expresses contrast." };
    else if (path.endsWith("/coach/demo")) data = demo;
    else if (path.endsWith("/questions")) data = { mode: "live", answer: "**先修改连接关系。**\n\n- 对照原句\n- 再选择连接词", citations: [source] };
    else if (path.endsWith("/rag/query")) data = { mode: "cache", generated_at: "2026-11-10T12:00:00Z", answer: "根据学习记录，however 表示转折。", citations: [source], conversation_id: "c1" };
    await route.fulfill({ json: data });
  });
}

test.beforeEach(async ({ page }) => setup(page));

test("writing versions, paired evidence and progressive hints", async ({ page }) => {
  await page.goto("/writing");
  await expect(page.getByRole("heading", { name: prompt })).toBeVisible();
  await expect(page.locator("del")).toBeHidden();
  await page.getByText("修改对照", { exact: false }).click();
  await expect(page.getByText("已改善", { exact: true })).toBeVisible();
  await expect(page.locator("del")).toHaveText(essay);
  await expect(page.locator("ins")).toHaveText(revised);
  await page.getByRole("button", { name: "查看连贯与衔接批注", exact: true }).click();
  await page.getByRole("button", { name: "查看批注 5", exact: true }).click();
  await page.getByRole("button", { name: "思考", exact: true }).click();
  await expect(page.getByText("这两句话真的存在转折吗？", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "V1", exact: true }).click();
  await expect(page.getByText("已改善", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: "../tmp/writing-desktop.png", fullPage: true, animations: "disabled" });
});

test("personal knowledge filters and cited tutor answers", async ({ page }) => {
  await page.goto("/resources");
  await expect(page.getByRole("heading", { name: "however", exact: true })).toBeVisible();
  await expect(page.getByText("待确认", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "确认记录" })).toHaveCount(0);
  const card = page.locator(".coach-knowledge-card").filter({ has: page.getByRole("heading", { name: "however", exact: true }) });
  const origin = card.getByText("来源：作文批改自动积累 · 用法纠正 ↗", { exact: true });
  await expect(origin).toBeHidden();
  await card.getByText("原始记录", { exact: true }).click();
  await expect(origin).toBeVisible();
  await card.getByRole("button", { name: "编辑记录" }).click();
  await expect(page.getByText("确认这条学习说明", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "关闭编辑" }).click();
  await page.getByRole("button", { name: /^单词/ }).click();
  await expect(page.getByRole("heading", { name: "段落逻辑", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "打开个人学习助手" }).click();
  await page.getByLabel("学习问题").fill("however 怎样用于写作？");
  await page.getByRole("button", { name: "发送问题" }).click();
  await expect(page.getByText("历史缓存", { exact: true })).toBeVisible();
  await page.getByText("Coherence and Cohesion", { exact: true }).click();
  await expect(page.getByText(source.excerpt, { exact: true })).toBeVisible();
  await page.screenshot({ path: "../tmp/knowledge-desktop.png", fullPage: true, animations: "disabled" });
});

test("isolated offline example supports revision comparison", async ({ page }) => {
  await page.goto("/writing");
  await page.getByRole("button", { name: "离线示例", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "从阅读词汇到写作修改" })).toBeVisible();
  await page.getByRole("button", { name: "V2 · 修改稿" }).click();
  await expect(page.locator(".coach-paper p")).toHaveText(revised);
  await expect(page.getByText("固定原创示例 · 不计入个人学习记录")).toBeVisible();
});

test("mobile knowledge and writing fit the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/resources", "/writing"]) {
    await page.goto(path);
    const launcher = page.getByRole("button", { name: path === "/writing" ? "打开问问这篇作文" : "打开个人学习助手" });
    await expect(launcher).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.screenshot({ path: `../tmp/${path.slice(1)}-mobile.png`, fullPage: true, animations: "disabled" });
    await launcher.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.locator(".coach-tutor")).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `../tmp/${path.slice(1)}-assistant-mobile.png`, fullPage: true, animations: "disabled" });
  }
});


test("floating tutor follows the selected essay and works across pages", async ({ page }) => {
  await page.goto("/resources");
  const launcher = page.getByRole("button", { name: "打开个人学习助手" });
  await expect(launcher).toHaveAttribute("aria-expanded", "false");
  await launcher.click();
  const dialog = page.getByRole("dialog", { name: "个人学习助手" });
  await expect(dialog).toBeVisible();
  await page.getByLabel("学习问题").fill("however");
  await page.getByRole("button", { name: "发送问题" }).click();
  await expect(dialog.getByText("根据学习记录，however 表示转折。", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(launcher).toBeFocused();
  await launcher.click();
  await expect(dialog.getByText("根据学习记录，however 表示转折。", { exact: true })).toBeVisible();
  await page.locator(".side-nav").getByRole("link", { name: "写作工作台" }).click();
  await expect(page.getByRole("dialog", { name: "问问这篇作文" })).toBeVisible();
  await expect(page.getByRole("heading", { name: prompt })).toBeVisible();
  await page.getByLabel("学习问题").fill("怎么修改？");
  const request = page.waitForRequest(r => r.url().endsWith("/writing/versions/v2/questions"));
  await page.getByRole("button", { name: "发送问题" }).click();
  expect((await request).postDataJSON().query).toBe("怎么修改？");
  await expect(page.locator(".coach-answer-text strong")).toHaveText("先修改连接关系。");
  await expect(page.locator(".coach-answer-text li")).toHaveCount(2);
  await page.getByRole("button", { name: "V1", exact: true }).click();
  await expect(page.getByText("怎么修改？", { exact: true })).toHaveCount(0);
  await page.getByLabel("学习问题").fill("解释这句");
  const firstVersion = page.waitForRequest(r => r.url().endsWith("/writing/versions/v1/questions"));
  await page.getByRole("button", { name: "发送问题" }).click();
  await firstVersion;
  await page.locator(".side-nav").getByRole("link", { name: "个人知识库" }).click();
  await expect(page.getByRole("dialog", { name: "个人学习助手" })).toBeVisible();
  await page.getByRole("button", { name: "关闭学习助手" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("document selection stays aligned and scopes the floating tutor", async ({ page }) => {
  await page.route("**/api/v1/knowledge/documents", route => route.fulfill({ json: [{ id: "doc1", title: "我的长标题写作学习笔记", filename: "writing-notes.md", status: "completed", is_private: true, license_type: "user-private" }] }));
  await page.goto("/resources");
  await page.getByRole("button", { name: "资料与笔记", exact: true }).click();
  await expect(page.getByText("选择文件", { exact: true })).toBeHidden();
  await page.locator(".upload-disclosure > summary").click();
  await expect(page.getByText("选择文件", { exact: true })).toBeVisible();
  await page.getByLabel("选择资料 我的长标题写作学习笔记").check();
  await page.getByRole("button", { name: "打开个人学习助手" }).click();
  await page.getByLabel("学习问题").fill("帮我解释笔记");
  const request = page.waitForRequest(r => r.url().endsWith("/rag/query"));
  await page.getByRole("button", { name: "发送问题" }).click();
  expect((await request).postDataJSON().document_ids).toEqual(["doc1"]);
  await page.getByRole("button", { name: "关闭学习助手" }).click();
  await page.screenshot({ path: "../tmp/documents-desktop.png", fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "../tmp/documents-mobile.png", fullPage: true, animations: "disabled" });
});


test("question sets expand on demand and linked questions open directly", async ({ page }) => {
  await page.goto("/question-bank");
  const set = page.locator(".question-set");
  await expect(set.getByRole("radio", { name: /however/ })).toBeHidden();
  await set.locator("summary").click();
  await set.getByRole("radio", { name: /however/ }).check();
  await set.locator("summary").click();
  await set.locator("summary").click();
  await expect(set.getByRole("radio", { name: /however/ })).toBeChecked();
  await set.getByRole("button", { name: "提交答案" }).click();
  await expect(set.getByText("回答正确", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "../tmp/question-set-mobile.png", fullPage: true, animations: "disabled" });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto("/question-bank?question=q1");
  await expect(set.getByRole("radio", { name: /however/ })).toBeVisible();
});


test("essay annotations align with the text and reveal only the selected explanation", async ({ page }) => {
  await page.goto("/writing");
  await expect(page.getByRole("button", { name: "继续修改", exact: true })).toHaveCount(1);
  await expect(page.locator(".writer-note-empty")).toBeVisible();
  const original = page.locator(".essay-prose");
  await expect(original).toHaveText(revised);
  await expect(original.locator("mark")).not.toHaveCount(0);
  const marker = page.getByRole("button", { name: "批注 1 · 任务回应", exact: true });
  await marker.click();
  await expect(page.getByRole("region", { name: "批注详情" }).getByText("示例反馈", { exact: true })).toBeVisible();
  await expect(original.locator("mark.active")).not.toHaveCount(0);
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect.poll(async () => {
      const mark = await original.locator("mark").first().boundingBox();
      const button = await marker.boundingBox();
      return mark && button ? Math.abs(mark.y - button.y) : 1000;
    }).toBeLessThan(6);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.screenshot({ path: "../tmp/writer-annotations-mobile.png", fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "../tmp/writer-annotations-desktop.png", fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "继续修改", exact: true }).click();
  await expect(page.getByLabel("作文编辑区")).toHaveValue(revised);
  await page.getByLabel("作文编辑区").fill(revised + " My local revision.");
  await page.getByRole("button", { name: "返回批注" }).click();
  await page.getByRole("button", { name: "继续修改", exact: true }).click();
  await expect(page.getByLabel("作文编辑区")).toHaveValue(revised + " My local revision.");
});

test("four criterion colors match highlights, score cards and selected annotations", async ({ page }) => {
  await page.goto("/writing");
  const criteria = ["task_achievement", "coherence_cohesion", "lexical_resource", "grammar_accuracy"];
  const backgrounds: string[] = [];
  await expect(page.locator(".essay-prose mark").first()).toHaveCSS("background-image", /linear-gradient/);
  for (const criterion of criteria) {
    const score = page.locator(`.writer-criterion-scores [data-criterion="${criterion}"]`);
    await score.click();
    const mark = page.locator(`.essay-prose mark.active[data-criterion="${criterion}"]`).first();
    const background = await score.evaluate(element => getComputedStyle(element).backgroundColor);
    backgrounds.push(background);
    await expect(mark).toHaveCSS("background-color", background);
    await expect(mark).toHaveCSS("background-image", "none");
    await expect(page.locator(".essay-note-marker.active")).toHaveAttribute("data-criterion", criterion);
    await expect(page.getByRole("region", { name: "批注详情" })).toHaveAttribute("data-criterion", criterion);
    const contrast = await score.evaluate(element => {
      const luminance = (color: string) => {
        const channels = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number).map(value => { const c = value / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });
        return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
      };
      const style = getComputedStyle(element), foreground = luminance(style.color), background = luminance(style.backgroundColor);
      return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05);
    });
    expect(contrast).toBeGreaterThanOrEqual(4.5);
  }
  expect(new Set(backgrounds).size).toBe(4);
  await page.screenshot({ path: "../tmp/writer-criterion-colors.png", fullPage: true, animations: "disabled" });
});

test("existing quotations locate multiline text and unique prefixes without extra model fields", async ({ page }) => {
  const text = "Public funding helps students.\n\nTargeted grants help low-income families afford higher education.\n\nHowever, governments must also fund hospitals.";
  const quotes = ["Targeted grants help low-income families afford higher education. This extra tail is absent.", "Public funding helps students. Targeted grants help low-income families afford higher education.", "A sentence not present in the essay.", "However"];
  const feedback = structuredClone(versions[0].feedback);
  feedback.data.issues = [];
  feedback.data.assessment.criteria.forEach((criterion, index) => { criterion.evidence = [{ quote: quotes[index] }]; });
  await page.route("**/api/v1/writing/sessions/s1", route => route.fulfill({ json: { id: "s1", prompt, versions: [{ id: "v1", essay: text, feedback, status: "assessed" }] } }));
  await page.goto("/writing");
  await expect(page.locator(".essay-prose")).toHaveText(text);
  await expect(page.getByRole("button", { name: "批注 1 · 任务回应", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "批注 2 · 连贯与衔接", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "批注 3 · 词汇资源", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "查看词汇资源批注" }).click();
  await expect(page.getByRole("region", { name: "批注详情" }).getByText(quotes[2], { exact: true })).toBeVisible();
  await page.getByLabel("选择写作练习").selectOption("");
  await expect(page.getByLabel("Task 2 题目")).toBeVisible();
  await page.getByLabel("Task 2 题目").fill("My new exercise prompt stays separate from saved essays.");
  await page.getByLabel("作文编辑区").fill("An unsubmitted draft should survive switching exercises.");
  await page.getByLabel("选择写作练习").selectOption("s1");
  await expect(page.locator(".essay-prose")).toHaveText(text);
  await page.getByLabel("选择写作练习").selectOption("");
  await expect(page.getByLabel("作文编辑区")).toHaveValue("An unsubmitted draft should survive switching exercises.");
});
