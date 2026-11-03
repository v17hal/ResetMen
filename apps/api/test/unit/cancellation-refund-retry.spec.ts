import { describe, expect, it, vi } from 'vitest';

import { PaymentJobs } from '../../src/payments/payment.jobs.js';
import { CANCELLATION_REFUND_REASON, PaymentService } from '../../src/payments/payment.service.js';

/**
 * A refund Razorpay refuses at cancellation is retried, not forgotten.
 *
 * Found with a real test-mode payment on 3/11/2026: the customer paid, cancelled 24 seconds
 * later, and Razorpay answered the refund with "invalid request sent". The same request
 * went through a minute later. Before this, nothing would ever have asked again.
 *
 * The database is a small in-memory stand-in covering exactly the calls these two paths
 * make, so the test runs without Postgres.
 */

interface PaymentRow {
  id: string;
  bookingId: string;
  gateway: 'RAZORPAY';
  status: string;
  amountPaise: number;
  gatewayPaymentId: string | null;
}

interface RefundRow {
  id: string;
  paymentId: string;
  gatewayRefundId: string | null;
  amountPaise: number;
  status: string;
  reason: string | null;
  initiatedBy: string | null;
  createdAt: Date;
}

function world(payment: Partial<PaymentRow> = {}) {
  const payments: PaymentRow[] = [
    {
      id: 'pay-1',
      bookingId: 'booking-1',
      gateway: 'RAZORPAY',
      status: 'CAPTURED',
      amountPaise: 4900,
      gatewayPaymentId: 'pay_TvbBtvdbDkYLAv',
      ...payment,
    },
  ];
  const refunds: RefundRow[] = [];
  let sequence = 0;

  const refundsOf = (paymentId: string) => refunds.filter((r) => r.paymentId === paymentId);

  const prisma = {
    payment: {
      findMany: async ({ where }: { where: { bookingId: string; status: { in: string[] } } }) =>
        payments
          .filter((p) => p.bookingId === where.bookingId && where.status.in.includes(p.status))
          .map((p) => ({ ...p, refunds: refundsOf(p.id) })),
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const found = payments.find((p) => p.id === where.id);
        if (found === undefined) throw new Error('no payment');
        return { ...found, refunds: refundsOf(found.id) };
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<PaymentRow> }) => {
        const found = payments.find((p) => p.id === where.id)!;
        Object.assign(found, data);
        return found;
      },
    },
    refund: {
      create: async ({ data }: { data: Partial<RefundRow> & { paymentId: string; amountPaise: number } }) => {
        sequence += 1;
        const row: RefundRow = {
          id: `refund-${sequence}`,
          gatewayRefundId: null,
          status: 'PENDING',
          reason: null,
          initiatedBy: null,
          createdAt: new Date(),
          ...data,
        };
        refunds.push(row);
        return row;
      },
      findMany: async ({
        where,
      }: {
        where: { status: string; gatewayRefundId: null; reason: string; createdAt: { lt: Date; gt: Date } };
      }) =>
        refunds.filter(
          (r) =>
            r.status === where.status &&
            r.gatewayRefundId === where.gatewayRefundId &&
            r.reason === where.reason &&
            r.createdAt < where.createdAt.lt &&
            r.createdAt > where.createdAt.gt,
        ),
      delete: async ({ where }: { where: { id: string } }) => {
        const index = refunds.findIndex((r) => r.id === where.id);
        return refunds.splice(index, 1)[0];
      },
    },
    $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
  };

  const gateway = {
    simulated: false,
    refund: vi.fn(async (params: { gatewayPaymentId: string; amountPaise: number }) => ({
      id: 'rfnd_retry',
      payment_id: params.gatewayPaymentId,
      amount: params.amountPaise,
      status: 'pending',
    })),
  };

  const service = new PaymentService(prisma as never, gateway as never, {} as never, {} as never, {} as never);
  const jobs = new PaymentJobs(prisma as never, service, gateway as never);

  /** Moves every waiting row back in time, as if the job ran a few minutes later. */
  const later = (minutes: number) => {
    for (const r of refunds) r.createdAt = new Date(r.createdAt.getTime() - minutes * 60_000);
  };

  return { payments, refunds, gateway, service, jobs, later };
}

const refusedByRazorpay = () => Promise.reject(new Error('invalid request sent'));

describe('refunds refused at cancellation', () => {
  it('records what the customer is owed when Razorpay refuses', async () => {
    const w = world();
    w.gateway.refund.mockImplementationOnce(refusedByRazorpay);

    const result = await w.service.refundOnlinePaymentsForCancellation('booking-1');

    expect(result).toEqual({ refundedPaise: 0, failed: true });
    expect(w.refunds).toMatchObject([
      { paymentId: 'pay-1', amountPaise: 4900, status: 'FAILED', reason: CANCELLATION_REFUND_REASON },
    ]);
    expect(w.payments[0]!.status).toBe('CAPTURED');
  });

  it('gives Razorpay a minute before asking again', async () => {
    const w = world();
    w.gateway.refund.mockImplementationOnce(refusedByRazorpay);
    await w.service.refundOnlinePaymentsForCancellation('booking-1');

    await w.jobs.retryCancellationRefunds();

    expect(w.gateway.refund).toHaveBeenCalledTimes(1);
    expect(w.refunds).toHaveLength(1);
  });

  it('refunds on the retry and clears the note of what was owed', async () => {
    const w = world();
    w.gateway.refund.mockImplementationOnce(refusedByRazorpay);
    await w.service.refundOnlinePaymentsForCancellation('booking-1');
    w.later(2);

    await w.jobs.retryCancellationRefunds();

    expect(w.gateway.refund).toHaveBeenLastCalledWith(
      expect.objectContaining({ gatewayPaymentId: 'pay_TvbBtvdbDkYLAv', amountPaise: 4900 }),
    );
    expect(w.refunds).toMatchObject([
      { gatewayRefundId: 'rfnd_retry', amountPaise: 4900, status: 'PENDING', reason: CANCELLATION_REFUND_REASON },
    ]);
    expect(w.payments[0]!.status).toBe('REFUNDED');
  });

  it('keeps the note while Razorpay keeps refusing', async () => {
    const w = world();
    w.gateway.refund.mockImplementation(refusedByRazorpay);
    await w.service.refundOnlinePaymentsForCancellation('booking-1');
    w.later(6);

    await w.jobs.retryCancellationRefunds();

    expect(w.refunds).toMatchObject([{ status: 'FAILED', reason: CANCELLATION_REFUND_REASON }]);
    expect(w.payments[0]!.status).toBe('CAPTURED');
  });

  it('stands down when staff refunded it by hand in the meantime', async () => {
    const w = world();
    w.gateway.refund.mockImplementationOnce(refusedByRazorpay);
    await w.service.refundOnlinePaymentsForCancellation('booking-1');
    // Staff refund the full amount from the admin panel before the job runs.
    await w.service.refund({ paymentId: 'pay-1', reason: 'Refunded at the counter desk', adminId: 'admin-1' });
    w.later(2);
    w.gateway.refund.mockClear();

    await w.jobs.retryCancellationRefunds();

    expect(w.gateway.refund).not.toHaveBeenCalled();
    expect(w.refunds.filter((r) => r.status === 'FAILED')).toHaveLength(0);
    expect(w.payments[0]!.status).toBe('REFUNDED');
  });

  it('leaves it to staff after a day', async () => {
    const w = world();
    w.gateway.refund.mockImplementationOnce(refusedByRazorpay);
    await w.service.refundOnlinePaymentsForCancellation('booking-1');
    w.later(25 * 60);

    await w.jobs.retryCancellationRefunds();

    expect(w.gateway.refund).toHaveBeenCalledTimes(1);
    expect(w.refunds).toMatchObject([{ status: 'FAILED' }]);
  });
});
