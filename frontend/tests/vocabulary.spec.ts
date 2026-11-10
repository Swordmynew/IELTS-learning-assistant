import { test, expect, type Page } from "@playwright/test";

const quote = "It will benifit families.";
const word = { word: "benefit", meaning: "使受益；益处", phonetic: "ˈbenɪfɪt", part_of_speech: "v.; n.", example: "Targeted grants benefit low-income families.", note: "", personal: true, sources: [{ reason: "spelling", original_form: "benifit", original_quote: quote, explanation: "benifit 应拼写为 benefit。", example: "Targeted grants benefit low-income families.", source_link: "/writing?session=s1&version=v1", source_id: "v1", job_id: "fixture-job" }], status: "learning", due_at: "2026-11-10T00:00:00Z", interval_days: 0, review_count: 0, revision: 1, suspended: false };

async function setup(page: Page) {
  let saved = { ...word };
  let extracted = false;
  await page.addInitScript(() => localStorage.setItem("ielts-access-token", "synthetic-word-browser-token"));
  await page.route("**/api/v1/**", async route => {
    const url = new URL(route.request().url()), path = url.pathname;
    let data: unknown = [];
    if (path.endsWith("/auth/me")) data = { id: "fixture", email: "fixture@example.com", display_name: "词卡界面测试", demo: true, preferences: { default_start_page: "overview" } };
    else if (path.endsWith("/vocabulary/deck")) data = { items: [saved], total: 1, offset: 0, counts: { total: 8520, starter: 8520, personal: 1, due: saved.review_count ? 0 : 1, learned: saved.review_count ? 1 : 0, new: 8519, suspended: 0 } };
    else if (path.endsWith("/vocabulary/study")) data = { items: [saved], due_count: 1, new_count: 8519 };
    else if (path.endsWith("/vocabulary/reviews")) {
      const request = route.request().postDataJSON();
      expect(request.word).toBe("benefit"); expect(request.revision).toBe(1); expect(request.event_id).toBeTruthy();
      saved = { ...saved, review_count: 1, revision: 2, interval_days: 1, status: "review", due_at: "2026-11-11T00:00:00Z" }; data = saved;
    } else if (path.endsWith("/writing/sessions")) data = [{ id: "s1", prompt: "Should governments pay university tuition for all students?" }];
    else if (path.endsWith("/writing/sessions/s1")) data = { id: "s1", prompt: "Should governments pay university tuition for all students?", versions: [{ id: "v1", essay: quote, status: "pending", feedback: null }] };
    else if (path.endsWith("/vocabulary/extractions")) {
      if (route.request().method() === "POST") {
        expect(route.request().postDataJSON().request_type).toBe("requested"); extracted = true;
      }
      const job = { id: "fixture-job", status: "completed", request_type: "requested", words: extracted ? [{ ...word, reason: "spelling", original_quote: quote, explanation: "benifit 应拼写为 benefit。" }] : [] };
      data = route.request().method() === "POST" ? job : [job];
    }
    await route.fulfill({ json: data });
  });
}

test.beforeEach(async ({ page }) => setup(page));

test("word learning starts with a centered action and no visible definitions", async ({ page }) => {
  await page.goto("/vocabulary");
  const library = page.locator(".word-library");
  await expect(library.locator(".word-list")).toBeHidden();
  await expect(page.getByText(word.meaning, { exact: true })).toBeHidden();
  await page.screenshot({ path: "../tmp/vocabulary-landing-desktop.png", fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "../tmp/vocabulary-landing-mobile.png", fullPage: true, animations: "disabled" });
  await library.locator(":scope > summary").click();
  await expect(library.getByText(word.word, { exact: true })).toBeVisible();
  await expect(library.locator(".word-meaning")).toBeHidden();
  await library.locator(".word-list > article > details > summary").click();
  await expect(library.locator(".word-meaning")).toBeVisible();
  await page.getByRole("button", { name: "开始学习", exact: true }).click();
  await expect(library.locator(".word-list")).toBeHidden();
  const study = page.getByRole("region", { name: "单词复习" });
  await expect(study.getByRole("heading", { name: word.word })).toBeVisible();
  await expect(page.getByText(word.meaning, { exact: true })).toBeHidden();
  await study.getByRole("button", { name: "查看释义" }).click();
  await expect(study.locator(".word-meaning")).toHaveText(word.meaning);
});

test("word cards reveal meaning, preserve the learner's sentence and save a review", async ({ page }) => {
  await page.goto("/vocabulary");
  await expect(page.getByRole("heading", { name: "背单词" })).toBeVisible();
  await expect(page.getByText("8,520", { exact: true })).toBeVisible();
  await expect(page.getByText("CEFR", { exact: false })).toHaveCount(0);
  await page.getByRole("button", { name: "开始学习", exact: true }).click();
  const study = page.getByRole("region", { name: "单词复习" });
  await expect(study.getByRole("heading", { name: "benefit" })).toBeVisible();
  await expect(study.locator(".word-meaning")).toHaveCount(0);
  await study.getByRole("button", { name: "查看释义" }).click();
  await expect(study.locator(".word-meaning")).toHaveText("使受益；益处");
  await study.getByText("我的练习 · 1", { exact: true }).click();
  await expect(study.getByText(quote, { exact: true })).toBeVisible();
  await page.screenshot({ path: "../tmp/vocabulary-desktop.png", fullPage: true });
  await study.getByRole("button", { name: /记住了/ }).click();
  await expect(study.getByRole("heading", { name: "这一组记完了" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "1 已学习" })).toBeVisible();
});

test("writing vocabulary uses its own request and links to personal study", async ({ page }) => {
  await page.goto("/writing");
  const panel = page.locator(".writing-word-panel");
  await expect(panel.getByText("本篇暂无待积累词汇")).toBeVisible();
  await panel.getByRole("button", { name: "积累词汇" }).click();
  await panel.getByText("benefit", { exact: true }).click();
  await expect(panel.getByText("benifit 应拼写为 benefit。", { exact: true })).toBeVisible();
  await panel.getByRole("link", { name: "去复习" }).click();
  await expect(page).toHaveURL(/scope=personal/);
  await expect(page.getByRole("region", { name: "词汇学习统计" }).getByRole("button", { name: /我的积累/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".word-library .word-list")).toBeHidden();
  await page.locator(".word-library > summary").click();
  await expect(page.locator(".word-library").getByRole("button", { name: "我的积累", exact: true })).toHaveClass("active");
});

test("word study fits a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/vocabulary");
  await page.getByRole("button", { name: "开始学习", exact: true }).click();
  await page.getByRole("button", { name: "查看释义" }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "../tmp/vocabulary-mobile.png", fullPage: true });
});
