import { Module } from '@nestjs/common';
import { FlagsModule } from '../flags/flags.module.js';
import { AdminController } from './admin.controller.js';

@Module({ imports: [FlagsModule], controllers: [AdminController] })
export class AdminModule {}
