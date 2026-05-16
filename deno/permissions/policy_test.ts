import { assertEquals } from 'jsr:@std/assert';
import { canAccess } from './policy.ts';

Deno.test('teacher can read notices so classroom communication stays visible', () => {
  assertEquals(canAccess('TEACHER', 'Notice', 'read'), true);
});

Deno.test('parent cannot write notices to prevent unauthorized broadcast edits', () => {
  assertEquals(canAccess('PARENT', 'Notice', 'write'), false);
});

Deno.test('non-admin cannot read payment records to protect financial privacy', () => {
  assertEquals(canAccess('PARENT', 'PaymentRecord', 'read'), false);
});
