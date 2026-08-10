import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { PrismaService } from '../database/prisma.service.js';

@ApiTags('system')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Liveness — the process is up. */
  @Get()
  live(): { status: string } {
    return { status: 'ok' };
  }

  /** Readiness — dependencies are reachable. This is what the load balancer polls. */
  @Get('ready')
  async ready(): Promise<{ status: string; database: string }> {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', database: 'ok' };
  }
}
