// Shared document type registry — single source of truth for all 14 types
// Must match the keys returned by the backend classifier

export interface DocTypeConfig {
  label: string;
  icon: string;
  color: string;
  shortLabel: string;
}

export const DOC_TYPES: Record<string, DocTypeConfig> = {
  confirmation_of_appointment: {
    label: "Confirmation of Appointment",
    shortLabel: "Confirmation",
    icon: "✅",
    color: "#10b981",
  },
  assumption_of_duty: {
    label: "Assumption of Duty",
    shortLabel: "Assumption",
    icon: "📋",
    color: "#3b82f6",
  },
  promotion_exercise: {
    label: "Promotion Exercise",
    shortLabel: "Promotion",
    icon: "🎉",
    color: "#f59e0b",
  },
  posting: {
    label: "Posting",
    shortLabel: "Posting",
    icon: "📍",
    color: "#8b5cf6",
  },
  SDC: {
    label: "Senior Staff Disciplinary Committee",
    shortLabel: "SDC",
    icon: "⚖️",
    color: "#ef4444",
  },
  co_name: {
    label: "Change of Name",
    shortLabel: "Name Change",
    icon: "✏️",
    color: "#06b6d4",
  },
  co_next_of_kin: {
    label: "Change of Next-of-Kin",
    shortLabel: "Next-of-Kin",
    icon: "👤",
    color: "#14b8a6",
  },
  redeployment: {
    label: "Redeployment",
    shortLabel: "Redeployment",
    icon: "🔄",
    color: "#f97316",
  },
  maternity_leave: {
    label: "Maternity Leave",
    shortLabel: "Maternity",
    icon: "🤱",
    color: "#ec4899",
  },
  deferment: {
    label: "Deferment of Leave",
    shortLabel: "Deferment",
    icon: "⏸️",
    color: "#a855f7",
  },
  extension_of_probationary: {
    label: "Extension of Probationary Appointment",
    shortLabel: "Ext. Probation",
    icon: "⏳",
    color: "#eab308",
  },
  leave_approval: {
    label: "Leave Approval",
    shortLabel: "Leave Appr.",
    icon: "✈️",
    color: "#22c55e",
  },
  ac_of_leave: {
    label: "Accumulated Leave",
    shortLabel: "Accum. Leave",
    icon: "📊",
    color: "#0ea5e9",
  },
  appraisal: {
    label: "Appraisal / Certificate Acknowledgement",
    shortLabel: "Appraisal",
    icon: "🎓",
    color: "#d946ef",
  },
  unknown: {
    label: "Unknown Document",
    shortLabel: "Unknown",
    icon: "📄",
    color: "#6b7280",
  },
};

// Helper functions
export function getDocType(type: string): DocTypeConfig {
  return DOC_TYPES[type] || DOC_TYPES.unknown;
}

export function getDocIcon(type: string): string {
  return getDocType(type).icon;
}

export function getDocColor(type: string): string {
  return getDocType(type).color;
}

export function getDocLabel(type: string): string {
  return getDocType(type).label;
}

export function getDocShortLabel(type: string): string {
  return getDocType(type).shortLabel;
}

// All known type keys (excluding "unknown")
export const ALL_DOC_TYPE_KEYS = Object.keys(DOC_TYPES).filter(k => k !== "unknown");
