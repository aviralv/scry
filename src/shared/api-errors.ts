// Path-scoped API error shape used by all config-mutating routes.
// `path` mirrors zod's issue path so the frontend can map errors to fields.
export interface ApiErrorIssue {
  path: string[];
  message: string;
}

export interface ApiErrorBody {
  error: string;
  message?: string;
  errors?: ApiErrorIssue[];
}

export function zodToApiErrors(issues: { path: (string | number)[]; message: string }[]): ApiErrorIssue[] {
  return issues.map((i) => ({ path: i.path.map(String), message: i.message }));
}
