import { test, expect } from "@playwright/test";
import type { Profile, StudyTask } from "../lib/api";
import { nextStudySession } from "../lib/study-launchpad";

test.use({ baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000" });
const today = "2026-11-15";
const profile: Profile = { exam_date: "2026-12-15", current_scores: { listening: 6.5, reading: 6, writing: 5, speaking: 6 }, target_scores: { listening: 7, reading: 7, writing: 7, speaking: 7 }, minutes_by_weekday: {}, preferred_skills: [] };
const task = (id: string, skill: StudyTask["skill"], duration: number, overrides: Partial<StudyTask> = {}): StudyTask => ({ id, skill, duration_minutes: duration, scheduled_date: today, task_type: "practice", title: `Practice ${id}`, objective: "Work on one clear idea.", priority: 1, high_load: false, completed: false, ...overrides });
const tasks = [task("writing-long", "writing", 40), task("reading-short", "reading", 20), task("already-done", "writing", 10, { completed: true }), task("future", "writing", 10, { scheduled_date: "2026-11-16" })];

test("recommendations fit time, exclude completed/future tasks, and preserve input", () => {
  const before = structuredClone(tasks);
  expect(nextStudySession(profile, tasks, today, 25, null).task?.id).toBe("reading-short");
  expect(nextStudySession(profile, tasks, today, 45, null).task?.id).toBe("writing-long");
  const quick = nextStudySession(profile, tasks, today, 10, null);
  expect(quick.task).toBeUndefined();
  expect(quick.skill).toBe("writing");
  expect(quick.minutes).toBe(10);
  expect(tasks).toEqual(before);
});

test("manual focus, overdue tasks, zero-time tasks and new learners have safe fallbacks", () => {
  expect(nextStudySession(profile, tasks, today, 45, "speaking").skill).toBe("speaking");
  expect(nextStudySession(profile, [task("late", "listening", 15, { scheduled_date: "2026-11-14" }), ...tasks], today, 45, null).task?.id).toBe("late");
  expect(nextStudySession(profile, [task("zero", "reading", 0)], today, 10, null).task).toBeUndefined();
  expect(nextStudySession(null, [], today, 25, null).skill).toBe("vocabulary");
  expect(nextStudySession(profile, [], today, 25, null).skill).toBe("writing");
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("ielts-access-token", "launchpad-test-token");
    localStorage.setItem("ielts-ui-language", "en");
    localStorage.setItem("ielts-ui-theme", "light");
  });
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = [];
    if (path.endsWith("/auth/me")) data = { id: "launchpad-test", email: "learner@example.com", display_name: "Learner", preferences: { default_start_page: "overview" } };
    if (path.endsWith("/dashboard")) data = { profile, learning_today: today, active_plan: { id: "plan", status: "approved", starts_on: today, ends_on: "2026-11-21", tasks, conflicts: [], rationale: "" }, completed_tasks: 1, total_tasks: 4, latest_assessment: null };
    if (path.endsWith("/question-bank/progress")) data = { total_questions: 10, attempted_questions: 2, incorrect_questions: 1, accuracy: .5 };
    if (path.endsWith("/question-bank/questions")) data = { total: 0, items: [] };
    await route.fulfill({ json: data });
  });
});

test("time and focus controls update destinations; auto restores recommendations", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  const launchpad = page.locator(".study-launchpad");
  await expect(launchpad.getByRole("heading", { name: "Practice reading-short" })).toBeVisible();
  await expect(launchpad.getByRole("link", { name: "Start Reading" })).toHaveAttribute("href", "/question-bank?module=reading");
  await launchpad.getByRole("button", { name: "45 min", exact: true }).click();
  await expect(launchpad.getByRole("heading", { name: "Practice writing-long" })).toBeVisible();
  await expect(launchpad.getByRole("button", { name: "Focus on Writing", exact: true })).toHaveAttribute("aria-pressed", "true");
  await launchpad.getByRole("button", { name: "Focus on Speaking", exact: true }).click();
  await expect(launchpad.getByRole("link", { name: "Start Speaking" })).toHaveAttribute("href", "/question-bank?module=speaking");
  await expect(launchpad.getByText("Suggested practice", { exact: true })).toBeVisible();
  await launchpad.getByRole("button", { name: "Auto focus", exact: true }).click();
  await expect(launchpad.getByRole("heading", { name: "Practice writing-long" })).toBeVisible();
  await launchpad.getByRole("button", { name: "10 min", exact: true }).click();
  await expect(launchpad.getByRole("heading", { name: "Review one paragraph" })).toBeVisible();
  await launchpad.getByRole("button", { name: "Focus on Reading", exact: true }).click();
  await launchpad.getByRole("link", { name: "Start Reading" }).click();
  await expect(page).toHaveURL(new URL("/question-bank?module=reading", process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000").href);
  expect(errors).toEqual([]);
});

test("without a plan, weakest-skill practice replaces the old empty state", async ({ page }) => {
  await page.route("**/api/v1/dashboard", route => route.fulfill({ json: { learning_today: today, profile, active_plan: null, completed_tasks: 0, total_tasks: 0 } }));
  await page.goto("/");
  const launchpad = page.locator(".study-launchpad");
  await expect(launchpad.getByRole("heading", { name: "Develop your next argument" })).toBeVisible();
  await expect(launchpad.getByRole("link", { name: "Start Writing" })).toHaveAttribute("href", "/writing");
  await expect(page.getByText("No upcoming tasks", { exact: true })).toHaveCount(0);
});

test("new learner can start vocabulary or set goals without invented scores", async ({ page }) => {
  await page.route("**/api/v1/dashboard", route => route.fulfill({ json: { learning_today: today, profile: null, active_plan: null, completed_tasks: 0, total_tasks: 0 } }));
  await page.goto("/");
  const launchpad = page.locator(".study-launchpad");
  await expect(launchpad.getByRole("link", { name: "Start Vocabulary" })).toHaveAttribute("href", "/vocabulary");
  await expect(launchpad.getByRole("link", { name: "Set your goals" })).toHaveAttribute("href", "/profile");
  await expect(launchpad.locator(".launchpad-band")).toHaveCount(0);
});

test("completed plans offer optional practice, not completed tasks", async ({ page }) => {
  await page.route("**/api/v1/dashboard", route => route.fulfill({ json: { learning_today: today, profile, active_plan: { tasks: tasks.map(item => ({ ...item, completed: true })) }, completed_tasks: 4, total_tasks: 4 } }));
  await page.goto("/");
  await expect(page.locator(".study-launchpad").getByText("Optional practice", { exact: true })).toBeVisible();
  await expect(page.locator(".study-launchpad").getByText("From your plan", { exact: true })).toHaveCount(0);
});

test("desktop, tablet, mobile, dark and Chinese layouts stay usable", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".launchpad-band")).toHaveCount(4);
  for (const width of [1440, 1024, 820, 768, 600, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator(".launchpad-go > a")).toBeVisible();
    if (width === 1440 || width === 390) await page.screenshot({ path: `../tmp/launchpad-${width}.png`, fullPage: true });
  }
  await page.evaluate(() => {
    localStorage.setItem("ielts-ui-language", "zh-CN");
    localStorage.setItem("ielts-ui-theme", "dark");
    window.dispatchEvent(new StorageEvent("storage", { key: "ielts-ui-language", newValue: "zh-CN" }));
    window.dispatchEvent(new StorageEvent("storage", { key: "ielts-ui-theme", newValue: "dark" }));
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("heading", { name: "你的提分地图" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "../tmp/launchpad-chinese-dark.png", fullPage: true });
});

test("session controls work with keyboard", async ({ page }) => {
  await page.goto("/");
  const time = page.getByRole("button", { name: "10 min", exact: true });
  await time.focus();
  await page.keyboard.press("Enter");
  await expect(time).toHaveAttribute("aria-pressed", "true");
  const focus = page.getByRole("button", { name: "Focus on Listening", exact: true });
  await focus.focus();
  await page.keyboard.press("Space");
  await expect(focus).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".launchpad-go > a")).toHaveAttribute("href", "/question-bank?module=listening");
});
