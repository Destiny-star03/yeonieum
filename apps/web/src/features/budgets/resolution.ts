export type Resolution = {
  title: string;
  payee: string;
  payment_method: string;
};

export const paymentMethods = {
  card: "카드",
  transfer: "계좌 이체",
  cash: "현금",
  other: "기타",
};

export const reviewStatuses = {
  pending: "검토 대기",
  approved: "승인",
  rejected: "반려",
};

export type ReviewStatus = keyof typeof reviewStatuses;
export type ResolutionHistory = {
  id: string;
  at: string;
  actor_name: string;
  action: string;
  decision: ReviewStatus | null;
  reason: string | null;
};

export function historyLabel(item: ResolutionHistory) {
  switch (item.action) {
    case "finance.expense-created":
      return "제출";
    case "finance.expense-reviewed":
      return item.decision === "approved" ? "승인" : "반려";
    case "finance.expense-resubmitted":
      return "보완 후 재제출";
    default:
      return "정정";
  }
}

export const resolutionTimestamp = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Seoul",
});
