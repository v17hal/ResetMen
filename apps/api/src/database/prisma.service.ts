import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

/** Postgres raises this when an exclusion constraint rejects a row. */
export const PG_EXCLUSION_VIOLATION = '23P01';

/**
 * True when the error is the station-overlap exclusion constraint firing — i.e. somebody
 * else took the slot in the last few hundred milliseconds.
 *
 * This is the one error the booking flow is *designed* around rather than merely handling:
 * the constraint is what makes the no-double-booking promise real, so hitting it is normal
 * operation under contention, not a fault.
 */
export function isSlotConflict(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // Prisma surfaces exclusion violations as P2010 (raw query failed) with the driver code
    // in meta, or as P2002-adjacent depending on the path. Check the underlying SQLSTATE.
    const meta = error.meta as { code?: string } | undefined;
    if (meta?.code === PG_EXCLUSION_VIOLATION) return true;
    if (error.code === 'P2002') return true;
  }

  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes(PG_EXCLUSION_VIOLATION) ||
    message.includes('bookings_no_station_overlap')
  );
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Connected to PostgreSQL');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Serialises concurrent booking attempts for one store on one day.
   *
   * This is a *performance* measure, not a correctness one — correctness lives in the
   * exclusion constraint. Without it, every request for a popular slot would race, fail and
   * retry; with it, they queue in an orderly way and only the genuinely doomed ones fail.
   */
  async lockStoreDay(
    tx: Prisma.TransactionClient,
    storeId: string,
    localDate: string,
  ): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`slot:${storeId}:${localDate}`}))`;
  }

  /**
   * Releases holds whose TTL has elapsed.
   *
   * Called inside the booking transaction as well as by the scheduled job: the exclusion
   * constraint counts HELD rows, so an unswept expired hold would block a slot that is in
   * fact free.
   */
  async expireStaleHolds(
    tx: Prisma.TransactionClient,
    storeId: string,
  ): Promise<number> {
    return tx.booking.updateMany({
      where: { storeId, status: 'HELD', holdExpiresAt: { lt: new Date() } },
      data: { status: 'EXPIRED' },
    }).then((r) => r.count);
  }
}
