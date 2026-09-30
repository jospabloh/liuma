import React from 'react';
import { chargeBalance, chargePaid, formatMoney, isChargeOpen } from '@/lib/payments/money';

/**
 * One charge's money, line by line: original amount and discount (when there
 * was one), total, what has been paid and what is still owed. Shown to the
 * director (PagosAdmin) and to the family (Pagos) from the same fields, so
 * both read the same numbers. amount_paid is written by the server after
 * every payment (guardedEntityWrite → settleCharge), never by a client.
 */
export default function ChargeAmounts({ charge, className = '' }) {
  if (!charge) return null;
  const original = Number(charge.original_amount);
  const discount = Number(charge.discount_amount);
  const paid = chargePaid(charge);
  const hasDiscount = Number.isFinite(discount) && discount > 0;
  const open = isChargeOpen(charge);
  return (
    <dl className={`grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-muted-foreground ${className}`}>
      {hasDiscount && Number.isFinite(original) && (
        <>
          <dt>Monto original</dt>
          <dd className="text-right tabular-nums">{formatMoney(original)}</dd>
          <dt>Descuento</dt>
          <dd className="text-right tabular-nums">−{formatMoney(discount)}</dd>
        </>
      )}
      <dt>Total</dt>
      <dd className="text-right tabular-nums">{formatMoney(charge.amount)}</dd>
      {paid > 0 && (
        <>
          <dt>Pagado</dt>
          <dd className="text-right tabular-nums">{formatMoney(paid)}</dd>
        </>
      )}
      {open && (
        <>
          <dt className="font-medium text-foreground">Saldo pendiente</dt>
          <dd className="text-right font-medium text-foreground tabular-nums">{formatMoney(chargeBalance(charge))}</dd>
        </>
      )}
    </dl>
  );
}
