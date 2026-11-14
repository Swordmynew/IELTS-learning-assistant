import { expect, test, type Page } from "@playwright/test";
import type { Dashboard, StudyPlan } from "../lib/api";

const today = "2026-11-15";
const profile = { exam_date: "2027-06-01", current_scores: { listening: 6, reading: 6, writing: 5, speaking: 6 }, target_scores: { listening: 7, reading: 7, writing: 7, speaking: 7 }, minutes_by_weekday: { "1": 90 }, preferred_skills: [] };
const draft: StudyPlan = { id: "saved-draft", status: "draft", starts_on: today, ends_on: "2026-11-21", rationale: "Synthetic schedule", conflicts: [], tasks: [{ id: "task", scheduled_date: today, skill: "writing", task_type: "practice", title: "Practise an argument", objective: "Develop a clear example.", duration_minutes: 25, priority: 1, completed: false, high_load: false }] };

async function mockSession(page: Page, theme = "light") {
  await page.addInitScript(({ theme }) => {
    localStorage.setItem("ielts-access-token", "synthetic-regression-token");
    localStorage.setItem("ielts-ui-language", "en");
    localStorage.setItem("ielts-ui-theme", theme);
  }, { theme });
}

test("persisted draft survives navigation/reload and remains separate from the active plan", async ({ page }) => {
  await mockSession(page);
  const dashboard: Dashboard = { profile, active_plan: null, draft_plan: null, completed_tasks: 0, total_tasks: 0, latest_assessment: null, latest_vocabulary_test: null, learning_today: today };
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/auth/me")) return route.fulfill({ json: { id: "test", email: "test@example.com", preferences: {} } });
    if (path.endsWith("/dashboard")) return route.fulfill({ json: dashboard });
    if (path.endsWith("/agent/runs/stream")) {
      dashboard.draft_plan = draft;
      return route.fulfill({ contentType: "text/event-stream", body: `data: ${JSON.stringify({ status: "completed", plan_id: draft.id, plan: draft })}\n\n` });
    }
    if (path.endsWith("/plans/saved-draft/approve")) {
      dashboard.active_plan = { ...draft, status: "approved" };
      dashboard.draft_plan = null;
      dashboard.total_tasks = draft.tasks.length;
      return route.fulfill({ json: dashboard.active_plan });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("/plan");
  await page.getByRole("button", { name: "Create weekly plan", exact: true }).click();
  await expect(page.getByRole("button", { name: "Activate plan", exact: true })).toBeVisible();
  await expect(page.getByText(draft.tasks[0].title, { exact: true })).toBeVisible();
  await page.goto("/settings");
  await page.goto("/plan");
  await page.reload();
  await expect(page.getByRole("button", { name: "Activate plan", exact: true })).toBeVisible();
  await expect(page.locator(".plan-task")).toHaveCount(1);
  await expect(page.locator(".task-actions button")).toHaveCount(0);
  await page.getByRole("button", { name: "Activate plan", exact: true }).click();
  await expect(page.locator(".plan-summary.active")).toBeVisible();
  await page.reload();
  await expect(page.locator(".plan-summary.active")).toBeVisible();
  await expect(page.getByRole("button", { name: "Activate plan", exact: true })).toHaveCount(0);
  await expect(page.locator(".task-actions button")).toHaveCount(1);
});

async function expectReadable(page: Page) {
  const failures = await page.locator(".essay-prose, .essay-prose mark, .essay-note-marker, .writer-criterion-scores button, .writer-note-copy blockquote, .writer-note-navigation button").evaluateAll(elements => {
    const luminance = (color: string) => {
      const rgb = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
      return rgb.reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    };
    return elements.flatMap(el => {
      let parent: Element | null = el;
      while (parent && ["rgba(0, 0, 0, 0)", "transparent"].includes(getComputedStyle(parent).backgroundColor)) parent = parent.parentElement;
      if (!parent) return ["No opaque background"];
      const fg = luminance(getComputedStyle(el).color), bg = luminance(getComputedStyle(parent).backgroundColor);
      const contrast = (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05);
      return contrast < 4.5 ? [`${el.className}: ${contrast.toFixed(2)}`] : [];
    });
  });
  expect(failures).toEqual([]);
}

test("real annotated essay, all criteria and selected notes remain readable in both themes", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await mockSession(page, "dark");
  const quotes = ["Although parks improve cities", "For example, residents can exercise", "There are many informations", "Councils could keep accessible spaces"];
  const essay = `In many cities, local authorities are changing public spaces. ${quotes[0]}.\n\n${quotes[1]}. ${quotes[2]}.\n\n${quotes[3]}. Other unannotated text remains clearly readable.`;
  const criteria = ["task_achievement", "coherence_cohesion", "lexical_resource", "grammar_accuracy"].map((criterion, i) => ({ criterion, band: 6, explanation: "Synthetic feedback", evidence: [{ quote: quotes[i] }], citations: [] }));
  const version = { id: "version", essay, status: "assessed", feedback: { mode: "live", model: "synthetic", generated_at: "2026-11-15T00:00:00Z", data: { assessment: { estimated_overall_band: 6, criteria }, issues: [], improvements: [], personal_note: "" } } };
  await page.route("**/api/v1/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/auth/me")) return route.fulfill({ json: { id: "test", email: "test@example.com", preferences: {} } });
    if (path.endsWith("/writing/sessions")) return route.fulfill({ json: [{ id: "session", prompt: "Discuss urban parks." }] });
    if (path.endsWith("/writing/sessions/session")) return route.fulfill({ json: { id: "session", prompt: "Discuss urban parks.", versions: [version] } });
    return route.fulfill({ json: [] });
  });
  await page.goto("/writing");
  await expect(page.locator(".essay-prose mark")).toHaveCount(4);
  await expect(page.locator(".essay-prose")).toHaveText(essay);
  for (const theme of ["dark", "light"]) {
    await page.evaluate(theme => window.dispatchEvent(new StorageEvent("storage", { key: "ielts-ui-theme", newValue: theme })), theme);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expectReadable(page);
    for (const button of await page.locator(".writer-criterion-scores button").all()) {
      await button.click();
      await expect(page.locator(".essay-prose mark.active")).toHaveCount(1);
      await expectReadable(page);
    }
    await page.screenshot({ path: testInfo.outputPath(`essay-${theme}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("overview keeps direct actions and removes repetitive guidance, with compact mobile metrics", async ({ page }) => {
  await mockSession(page);
  await page.route("**/api/v1/**", route => {
    expect(route.request().method()).toBe("GET");
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/auth/me")) return route.fulfill({ json: { id: "test", email: "test@example.com", preferences: {} } });
    if (path.endsWith("/dashboard")) return route.fulfill({ json: { profile, active_plan: { ...draft, status: "approved" }, draft_plan: null, learning_today: today, completed_tasks: 0, total_tasks: 1 } });
    if (path.endsWith("/question-bank/progress")) return route.fulfill({ json: { incorrect_questions: 3 } });
    return route.fulfill({ json: [] });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Next up", exact: true })).toBeVisible();
  await expect(page.locator(".launchpad-recommendation p, .launchpad-score-caption, .learning-path, .upcoming-task span")).toHaveCount(0);
  await expect(page.getByText(draft.tasks[0].objective, { exact: true })).toHaveCount(0);
  await expect(page.locator(".launchpad-go > a")).toHaveAttribute("href", "/writing");
  await expect(page.locator("a.metric-card")).toHaveAttribute("href", "/question-bank?review=wrong");
  await expect(page.locator("a.metric-card strong")).toHaveText("3");
  await page.setViewportSize({ width: 390, height: 844 });
  const cards = await page.locator(".metric-card").all();
  const first = await cards[0].boundingBox(), second = await cards[1].boundingBox();
  expect(first!.y).toBe(second!.y);
  expect(second!.x).toBeGreaterThan(first!.x);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
