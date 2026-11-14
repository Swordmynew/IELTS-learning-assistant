# API 接口清单

此表从当前 FastAPI OpenAPI 定义生成，不启动生命周期、不连接数据库或调用模型。完整请求/响应字段、枚举、校验与鉴权请在本地访问 http://127.0.0.1:8000/docs 或 /openapi.json。

所有业务接口使用当前用户身份；不要从客户端伪造 user_id。具体公开登录端点及安全声明以运行时 OpenAPI 为准。模型失败会显式降级；排程生成支持 Idempotency-Key。

| 方法 | 路径 | 功能 | 请求体 Schema |
| --- | --- | --- | --- |
| POST | `/api/v1/auth/register` | Register | RegisterRequest |
| POST | `/api/v1/auth/login` | Login | AuthCredentials |
| POST | `/api/v1/auth/demo` | Demo Session | — |
| GET | `/api/v1/auth/me` | Account | — |
| PATCH | `/api/v1/auth/me` | Update Account | UserAccountUpdate |
| POST | `/api/v1/auth/change-password` | Change Password | PasswordChange |
| GET | `/api/v1/settings` | Get Preferences | — |
| PUT | `/api/v1/settings` | Update Preferences | UserPreferences |
| POST | `/api/v1/diagnostics` | Record Diagnostic | DiagnosticRequest |
| POST | `/api/v1/plans/generate` | Generate Plan | — |
| POST | `/api/v1/plans/{plan_id}/approve` | Set Plan Approval | PlanApproval |
| GET | `/api/v1/plans/today` | Today Tasks | — |
| POST | `/api/v1/tasks/{task_id}/complete` | Mark Task Complete | — |
| POST | `/api/v1/tasks/{task_id}/restore` | Restore Plan Task | — |
| POST | `/api/v1/writing/assessments` | Assess Writing | WritingSubmission |
| POST | `/api/v1/vocabulary/tests` | Create Vocabulary Test | — |
| GET | `/api/v1/vocabulary/tests/{test_id}` | Read Vocabulary Test | — |
| POST | `/api/v1/vocabulary/tests/{test_id}/responses` | Submit Vocabulary Response | VocabularyTestAnswer |
| GET | `/api/v1/dashboard` | Dashboard | — |
| GET | `/api/v1/knowledge/documents` | List Documents | — |
| POST | `/api/v1/knowledge/documents` | Upload Document | Body_upload_document_api_v1_knowledge_documents_post |
| GET | `/api/v1/knowledge/documents/{document_id}` | Document Status | — |
| GET | `/api/v1/knowledge/documents/{document_id}/status` | Document Status Alias | — |
| POST | `/api/v1/rag/query` | Rag Query | RagQuery |
| GET | `/api/v1/question-bank/questions` | List Practice Questions | — |
| POST | `/api/v1/question-bank/questions` | Create Practice Question | QuestionImportItem |
| POST | `/api/v1/question-bank/questions/{question_id}/attempts` | Submit Practice Attempt | QuestionAttemptCreate |
| GET | `/api/v1/question-bank/progress` | Question Bank Progress | — |
| POST | `/api/v1/question-bank/import` | Import Practice Questions | Body_import_practice_questions_api_v1_question_bank_import_post |
| POST | `/api/v1/agent/runs/stream` | Stream Agent Run | — |
| GET | `/api/v1/agent/runs/{run_id}` | Agent Run Status | — |
| GET | `/api/v1/health` | Health | — |
| GET | `/api/v1/coach/demo` | Demo | — |
| GET | `/api/v1/writing/assessments/{assessment_id}` | Historical Assessment | — |
| GET | `/api/v1/vocabulary/tests/{test_id}/review` | Vocabulary Review | — |
| POST | `/api/v1/knowledge/backfill` | Backfill Knowledge | — |
| GET | `/api/v1/knowledge/items` | List Knowledge | — |
| POST | `/api/v1/knowledge/items` | Create Fragment | KnowledgeCreate |
| PATCH | `/api/v1/knowledge/items/{item_id}` | Update Knowledge | KnowledgeEdit |
| DELETE | `/api/v1/knowledge/items/{item_id}` | Delete Knowledge | — |
| POST | `/api/v1/knowledge/items/{item_id}/merge` | Merge Knowledge | KnowledgeMerge |
| GET | `/api/v1/knowledge/conversations` | Conversations | — |
| GET | `/api/v1/writing/sessions` | List Sessions | — |
| POST | `/api/v1/writing/sessions` | Create Session | SessionCreate |
| GET | `/api/v1/writing/sessions/{session_id}` | Get Writing Session | — |
| POST | `/api/v1/writing/sessions/{session_id}/versions` | Create Version | VersionCreate |
| POST | `/api/v1/writing/versions/{version_id}/assess` | Assess Version | — |
| POST | `/api/v1/writing/versions/{version_id}/issues/{issue_id}/hints/{level}` | Hint | — |
| POST | `/api/v1/writing/versions/{version_id}/questions` | Ask Writing | CoachQuestion |
| GET | `/api/v1/knowledge/documents/{document_id}/chunks` | Document Chunks | — |
| GET | `/api/v1/knowledge/documents/{document_id}/file` | Document File | — |
| GET | `/api/v1/knowledge/topics` | Topics | — |
| GET | `/api/v1/knowledge/items/{item_id}/events` | Events | — |
| POST | `/api/v1/knowledge/items/{item_id}/reviews` | Review | KnowledgeReview |
| POST | `/api/v1/knowledge/bookmarks` | Bookmark | KnowledgeBookmark |
| POST | `/api/v1/rag/preview` | Preview | RagQuery |
| GET | `/api/v1/vocabulary/deck` | Get Deck | — |
| GET | `/api/v1/vocabulary/study` | Get Study Queue | — |
| POST | `/api/v1/vocabulary/reviews` | Record Review | WordReview |
| PATCH | `/api/v1/vocabulary/words` | Update Word | WordEdit |
| POST | `/api/v1/vocabulary/extractions` | Request Extraction | ExtractionRequest |
| GET | `/api/v1/vocabulary/extractions` | List Extractions | — |

接口总数：62。

## 阅读顺序

1. auth 与 settings：会话及偏好。
2. diagnostics、plans、tasks、agent/runs：画像、排程、审批和执行轨迹。
3. vocabulary 与 question-bank：词卡、复习、题目和客观作答。
4. coach：多稿写作、个人记忆、对话与缓存。
5. knowledge、rag：文档上传、分块、原文件与检索。

`GET /api/v1/agent/runs/{run_id}` 用于读取持久化运行状态；流式接口只报告实际执行进度。资料 chunks/file 接口检查访问权限，私人文件响应禁止公共缓存。
