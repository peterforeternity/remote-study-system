// ============================================================
// 领域数据类型定义（与 Supabase PostgreSQL 表结构一一对应）
// 命名对应关系见《技术架构文档》第 8 节数据模型。
// ============================================================

export type UserRole = 'teacher' | 'student' | 'admin'

export type TaskStatus = 'draft' | 'published' | 'closed' | 'archived'

export type SubmissionStatus =
  | 'draft'
  | 'uploading'
  | 'submitted'
  | 'ai_processing'
  | 'grading'
  | 'graded'
  | 'returned'
  | 'resubmitted'

export type GradingStatus = 'draft' | 'finalized' | 'returned'

export type AiJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export type QuestionType =
  | 'single'
  | 'multiple'
  | 'judge'
  | 'blank'
  | 'numeric'
  | 'subjective'
  | 'dictation'

export type ErrorSeverity = 'minor' | 'major' | 'critical'

export type ErrorCategory =
  | 'concept'
  | 'calculation'
  | 'logic'
  | 'expression'
  | 'careless'
  | 'incomplete'
  | 'format'
  | 'misunderstanding'

export interface Organization {
  id: string
  name: string
  created_at: string
}

export interface Profile {
  id: string
  organization_id: string
  name: string
  role: UserRole
  email: string
  created_at: string
}

export interface InviteCode {
  id: string
  code: string
  organization_id: string
  created_by: string
  max_uses: number | null
  used_count: number
  expires_at: string | null
  active: boolean
  created_at: string
}

export interface Class {
  id: string
  organization_id: string
  name: string
  created_by: string
  created_at: string
}

export interface ClassMember {
  id: string
  class_id: string
  profile_id: string
  role_in_class: 'teacher' | 'student'
  created_at: string
}

export interface Task {
  id: string
  organization_id: string
  title: string
  description: string
  subject: string
  status: TaskStatus
  due_date: string | null
  full_score: number
  allow_late: boolean
  allow_multiple: boolean
  creator_id: string
  version: number
  created_at: string
  updated_at: string
}

export interface TaskAssignee {
  id: string
  task_id: string
  class_id: string | null
  student_id: string | null
  created_at: string
}

export interface TaskResource {
  id: string
  task_id: string
  title: string
  url: string
  type: string
  created_at: string
}

export interface TaskQuestion {
  id: string
  task_id: string
  order_no: number
  type: QuestionType
  content: string
  answer_key: string | null
  score: number
  created_at: string
}

export interface Submission {
  id: string
  task_id: string
  student_id: string
  organization_id: string
  status: SubmissionStatus
  current_version_id: string | null
  version: number
  created_at: string
  updated_at: string
}

export interface SubmissionVersion {
  id: string
  submission_id: string
  version_no: number
  text_answer: string | null
  note: string | null
  finalized: boolean
  finalized_at: string | null
  created_by: string
  created_at: string
}

export interface SubmissionFile {
  id: string
  version_id: string
  file_name: string
  object_key: string
  file_size: number
  mime_type: string
  sha256: string
  scan_status: string
  created_at: string
}

export interface GradingSession {
  id: string
  submission_id: string
  organization_id: string
  score: number | null
  comment: string | null
  grader_id: string
  ai_accepted: boolean
  status: GradingStatus
  version: number
  graded_at: string | null
  created_at: string
  updated_at: string
}

export interface GradingItem {
  id: string
  grading_id: string
  question_id: string
  score: number
  comment: string | null
  created_at: string
}

export interface Annotation {
  id: string
  grading_id: string
  text: string
  severity: ErrorSeverity
  error_category: ErrorCategory | null
  created_at: string
}

export interface AiJob {
  id: string
  submission_version_id: string
  organization_id: string
  task_type: 'verification' | 'grading'
  status: AiJobStatus
  model_provider: string | null
  model_name: string | null
  model_version: string | null
  prompt_version: string | null
  skill_version: string | null
  input_hash: string | null
  idempotency_key: string
  retries: number
  error_code: string | null
  error_message: string | null
  created_at: string
  updated_at: string
}

export interface VerificationResultRow {
  id: string
  ai_job_id: string
  question_id: string | null
  type: 'objective' | 'subjective'
  correct: boolean | null
  score: number
  confidence: number
  feedback: string | null
  created_at: string
}

export interface Notification {
  id: string
  recipient_id: string
  organization_id: string
  type: string
  title: string
  payload: Record<string, unknown> | null
  read: boolean
  created_at: string
}

export interface SubjectSkillRow {
  id: string
  organization_id: string
  subject: string
  name: string
  version: string
  enabled: boolean
  created_at: string
}

export interface Recommendation {
  id: string
  student_id: string
  organization_id: string
  title: string
  reason: string
  priority: number
  skill_id: string | null
  completed: boolean
  created_at: string
}

export interface LearningAssessmentRow {
  id: string
  student_id: string
  organization_id: string
  progress_score: number
  competency: Record<string, number>
  weak_areas: string[]
  created_at: string
}

/** 防作弊行为事件类型。 */
export type SubmissionEventType =
  | 'blur'
  | 'visibility_hidden'
  | 'paste_blocked'
  | 'copy_blocked'
  | 'fullscreen_exit'
  | 'auto_submit_timeout'

export interface SubmissionEvent {
  id: string
  submission_id: string
  student_id: string
  organization_id: string
  event_type: SubmissionEventType
  detail: Record<string, unknown> | null
  created_at: string
}
