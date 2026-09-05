/**
 * SUPERADMIN guard — PRD §9.4: the admin dashboards are SUPERADMIN-only.
 *
 * Runs after `SessionGuard`, which puts the role on the request. A missing role is treated as the
 * least privilege, never the most.
 */

import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { ForbiddenError } from '../../common/errors.js';

@Injectable()
export class SuperadminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user?: { role?: string } }>();
    if (request.user?.role !== 'SUPERADMIN') {
      throw new ForbiddenError('This page is for administrators.');
    }
    return true;
  }
}
