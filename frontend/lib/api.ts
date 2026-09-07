export type Skill = "listening" | "reading" | "writing" | "speaking";
export type PlanSkill = Skill | "vocabulary";

export interface Profile {
  exam_date: string;
  current_scores: Record<Skill, number>;
  target_scores: Record<Skill, number>;
  minutes_by_weekday: Record<string, number>;
  preferred_skills: Skill[];
}

export interface StudyTask {
  id: string;
  scheduled_date: string;
  skill: PlanSkill;
  task_type: string;
  title: string;
  objective: string;
  duration_minutes: number;
  priority: number;
  high_load: boolean;
  completed: boolean;
}

export interface StudyPlan {
  id: string;
  status: "draft" | "approved" | "superseded";
  starts_on: string;
  ends_on: string;
  rationale: string;
  tasks: StudyTask[];
  conflicts: string[];
}

export interface CriterionAssessment {
  criterion: string;
  band: number;
  confidence: number;
  explanation: string;
  evidence: { quote: string; start: number; end: number }[];
  citations: { title: string; url?: string; page?: number; excerpt: string }[];
}

export interface WritingAssessment {
  id: string;
  estimated_overall_band: number;
  criteria: CriterionAssessment[];
  top_priorities: string[];
  rewrite_example: string;
  next_exercise: string;
  disclaimer: string;
  model_used: string;
}

export interface VocabularyEstimate {
  theta: number;
  standard_error: number;
  level: string;
  cefr_reference: "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
  estimated_word_families: string;
  meaning_accuracy: number;
  none_of_above_accuracy: number;
  study_focus: string;
  calibration_status: string;
  disclaimer: string;
}

export interface VocabularyTest {
  id: string;
  status: "in_progress" | "completed";
  current_item: { id: string; surface: string; options: string[]; sequence: number } | null;
  answered: number;
  max_items: number;
  theta: number;
  standard_error: number;
  result: VocabularyEstimate | null;
  created_at: string;
}

export interface Dashboard {
  profile: Profile | null;
  active_plan: StudyPlan | null;
  completed_tasks: number;
  total_tasks: number;
  latest_assessment: WritingAssessment | null;
  latest_vocabulary_test: VocabularyTest | null;
}

export interface KnowledgeDocument {
  id: string;
  title: string;
  filename: string;
  source_url?: string;
  license_type: string;
  status: "queued" | "completed" | "failed";
  error?: string;
  is_private: boolean;
  created_at: string;
}

export interface PracticeQuestion {
  id: string;
  module: Skill;
  task_type: string;
  question_type: string;
  prompt: string;
  passage?: string;
  options: string[];
  correct_answer?: string;
  explanation?: string;
  tags: string[];
  source_name: string;
  is_public: boolean;
  created_at: string;
}

export type PracticeQuestionPreview = Omit<PracticeQuestion, "correct_answer" | "explanation"> & {
  has_answer: boolean;
  last_attempt_correct: boolean | null;
};

export interface PracticeQuestionPage {
  items: PracticeQuestionPreview[];
  total: number;
  page: number;
  page_size: number;
}

export type PracticeQuestionInput = Omit<
  PracticeQuestion,
  "id" | "is_public" | "created_at"
>;

export interface QuestionAttemptResult {
  question_id: string;
  submitted_answer: string;
  is_correct: boolean;
  correct_answer: string;
  explanation?: string;
  attempt_number: number;
  profile_updated: boolean;
}

export interface QuestionBankProgress {
  total_questions: number;
  attempted_questions: number;
  correct_questions: number;
  incorrect_questions: number;
  accuracy: number;
  by_module: Record<Skill, { attempted: number; correct: number }>;
}

export interface UserPreferences {
  default_start_page: "overview" | "plan" | "question-bank";
  listening_rate: number;
  compact_question_options: boolean;
  show_learning_details: boolean;
}

export interface UserAccount {
  id: string;
  email: string;
  display_name: string | null;
  demo: boolean;
  created_at: string;
  preferences: UserPreferences;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  user_id: string;
  demo: boolean;
}

const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? "/api/v1";

async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const isFormData = typeof FormData !== "undefined" && init.body instanceof FormData;
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(!isFormData ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(typeof payload.detail === "string" ? payload.detail : JSON.stringify(payload.detail));
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  login: (email: string, password: string) =>
    request<TokenResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  register: (displayName: string, email: string, password: string) =>
    request<TokenResponse>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ display_name: displayName, email, password }),
    }),
  demo: () => request<TokenResponse>("/auth/demo", { method: "POST" }),
  me: (token: string) => request<UserAccount>("/auth/me", {}, token),
  updateAccount: (token: string, displayName: string) =>
    request<UserAccount>("/auth/me", {
      method: "PATCH",
      body: JSON.stringify({ display_name: displayName }),
    }, token),
  changePassword: (token: string, currentPassword: string, newPassword: string) =>
    request<void>("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    }, token),
  getSettings: (token: string) => request<UserPreferences>("/settings", {}, token),
  updateSettings: (token: string, payload: UserPreferences) =>
    request<UserPreferences>("/settings", {
      method: "PUT",
      body: JSON.stringify(payload),
    }, token),
  dashboard: (token: string) => request<Dashboard>("/dashboard", {}, token),
  saveDiagnostic: (token: string, payload: Profile) =>
    request<Profile>("/diagnostics", {
      method: "POST",
      body: JSON.stringify({ ...payload, estimates: [] }),
    }, token),
  generatePlan: (token: string) =>
    request<StudyPlan>("/plans/generate", { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() } }, token),
  approvePlan: (token: string, planId: string) =>
    request<StudyPlan>(`/plans/${planId}/approve`, { method: "POST", body: JSON.stringify({ approved: true }) }, token),
  completeTask: (token: string, taskId: string) =>
    request<StudyTask>(`/tasks/${taskId}/complete`, { method: "POST" }, token),
  restoreTask: (token: string, taskId: string) =>
    request<StudyTask>(`/tasks/${taskId}/restore`, { method: "POST" }, token),
  assessWriting: (token: string, payload: { task_type: string; prompt: string; essay: string }) =>
    request<WritingAssessment>("/writing/assessments", { method: "POST", body: JSON.stringify(payload) }, token),
  startVocabularyTest: (token: string) =>
    request<VocabularyTest>("/vocabulary/tests", { method: "POST" }, token),
  answerVocabularyItem: (
    token: string,
    testId: string,
    payload: { item_id: string; selected_option: number }
  ) => request<VocabularyTest>(`/vocabulary/tests/${testId}/responses`, {
    method: "POST",
    body: JSON.stringify(payload),
  }, token),
  listDocuments: (token: string) =>
    request<KnowledgeDocument[]>("/knowledge/documents", {}, token),
  uploadDocument: (token: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ id: string; status: string }>("/knowledge/documents", {
      method: "POST",
      body: form,
    }, token);
  },
  listQuestions: (token: string, module?: Skill, search?: string, incorrectOnly = false, taskType?: string) => {
    const params = new URLSearchParams();
    if (module) params.set("module", module);
    if (search) params.set("search", search);
    if (incorrectOnly) params.set("incorrect_only", "true");
    if (taskType) params.set("task_type", taskType);
    const suffix = params.size ? `?${params}` : "";
    return request<PracticeQuestionPage>(`/question-bank/questions${suffix}`, {}, token);
  },
  importQuestions: (token: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ imported: number; ids: string[] }>("/question-bank/import", {
      method: "POST",
      body: form,
    }, token);
  },
  createQuestion: (token: string, payload: PracticeQuestionInput) =>
    request<PracticeQuestion>("/question-bank/questions", {
      method: "POST",
      body: JSON.stringify(payload),
    }, token),
  submitQuestionAttempt: (token: string, questionId: string, answer: string) =>
    request<QuestionAttemptResult>(`/question-bank/questions/${questionId}/attempts`, {
      method: "POST",
      body: JSON.stringify({ answer }),
    }, token),
  questionBankProgress: (token: string) =>
    request<QuestionBankProgress>("/question-bank/progress", {}, token),
};
