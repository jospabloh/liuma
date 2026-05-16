export type Role = 'ADMIN' | 'TEACHER' | 'PARENT';

export type PermissionAction = 'read' | 'write';

const policy = {
  Notice: {
    read: ['ADMIN', 'TEACHER', 'PARENT'],
    write: ['ADMIN', 'TEACHER'],
  },
  PaymentRecord: {
    read: ['ADMIN'],
    write: ['ADMIN'],
  },
} as const;

export function canAccess(role: Role, entity: keyof typeof policy, action: PermissionAction): boolean {
  return policy[entity][action].includes(role);
}
