import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator.js';
import { PrismaService } from '../../prisma/prisma.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async check(): Promise<{ ok: true; db: 'up'; time: string }> {
    await this.prisma.$queryRaw`SELECT 1`;
    return {
      ok: true,
      db: 'up',
      time: new Date().toISOString(),
    };
  }
}
