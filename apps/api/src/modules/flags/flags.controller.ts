import { Controller, Get } from '@nestjs/common';
import { FlagsService } from './flags.service.js';

@Controller('flags')
export class FlagsController {
  constructor(private readonly flags: FlagsService) {}

  @Get()
  async list(): Promise<Record<string, boolean>> {
    return this.flags.all();
  }
}
