import { Module } from '@nestjs/common';
import { RedisService } from '../../common/redis.service.js';
import { HealthController } from './health.controller.js';

@Module({ controllers: [HealthController], providers: [RedisService], exports: [RedisService] })
export class HealthModule {}
