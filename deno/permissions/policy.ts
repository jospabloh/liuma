export type Role = "ADMIN" | "TEACHER" | "PARENT";

export type PermissionAction = "read" | "write";

type EntityPolicy = {
  read: readonly Role[];
  write: readonly Role[];
};

const policy: Record<string, EntityPolicy> = {
  Notice: {
    read: ["ADMIN", "TEACHER", "PARENT"],
    write: ["ADMIN", "TEACHER"],
  },
  PaymentRecord: {
    read: ["ADMIN"],
    write: ["ADMIN"],
  },
};

export function canAccess(
  role: Role,
  entity: keyof typeof policy,
  action: PermissionAction,
): boolean {
  return policy[entity][action].includes(role);
}
