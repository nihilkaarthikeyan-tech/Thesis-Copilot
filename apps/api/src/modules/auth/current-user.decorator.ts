import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

export type SessionUser = {
  id: string;
  email: string;
  role: string;
  plan: string;
};

/** Reads the user that `SessionGuard` attached. Only valid on a route behind that guard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): SessionUser => {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    return (request as unknown as { user: SessionUser }).user;
  },
);
