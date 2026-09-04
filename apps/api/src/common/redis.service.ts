import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { Env } from '@tc/config';
import { Redis } from 'ioredis';
import { ENV } from './env.token.js';

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor(@Inject(ENV) env: Env) {
    this.client = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: false });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
