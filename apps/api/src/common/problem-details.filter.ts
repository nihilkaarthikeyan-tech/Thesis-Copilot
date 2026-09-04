/**
 * Turns every thrown error into an RFC 9457 problem-details response (PRD §0.2, §9).
 *
 * An unexpected error is logged in full but answered with a generic body: the student never sees a
 * stack trace, and no internal detail leaks.
 */

import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ProblemDetails } from './errors.js';

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const reply = context.getResponse<FastifyReply>();
    const request = context.getRequest<FastifyRequest>();
    const requestId = request.id;

    const problem = this.toProblem(exception, request.url, requestId);

    if (problem.status >= 500) {
      this.logger.error(
        { err: exception, requestId, path: request.url },
        'Unhandled error: ' + problem.title,
      );
    }

    reply.status(problem.status).type('application/problem+json').send(problem);
  }

  private toProblem(exception: unknown, path: string, requestId: string): ProblemDetails {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();

      if (typeof body === 'object' && body !== null && 'type' in body) {
        return { ...(body as ProblemDetails), status, instance: path, requestId };
      }

      const message =
        typeof body === 'string'
          ? body
          : ((body as { message?: string | string[] }).message ?? exception.message);

      return {
        type: 'HTTP_ERROR',
        title: HttpStatus[status] ?? 'Error',
        status,
        detail: Array.isArray(message) ? message.join('; ') : message,
        instance: path,
        requestId,
      };
    }

    return {
      type: 'INTERNAL_ERROR',
      title: 'Something went wrong',
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      detail: 'The request could not be completed. Quote the request id if you report this.',
      instance: path,
      requestId,
    };
  }
}
