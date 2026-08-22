import { NextFunction, Request, Response } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { UserRole } from '@prisma/client';
import { prisma } from '../config/prisma';
import { getConfig } from '../config/env';

export interface AuthenticatedUser {
  id: string;
  roles: Array<{ role: UserRole; venueId: string }>;
}

export interface AuthDependencies {
  findUser: (userId: string) => Promise<AuthenticatedUser | null>;
  jwtSecret: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

function getBearerToken(request: Request): string | null {
  const header = request.header('authorization');
  if (!header || !header.startsWith('Bearer ')) {
    return null;
  }

  return header.slice('Bearer '.length).trim() || null;
}

function getUserId(payload: string | JwtPayload): string | null {
  if (typeof payload === 'string' || typeof payload.sub !== 'string') {
    return null;
  }

  return payload.sub;
}

export function createAuthDependencies(): AuthDependencies {
  return {
    jwtSecret: getConfig().jwtSecret,
    findUser: async (userId) => {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          roles: { select: { role: true, venueId: true } },
        },
      });

      return user;
    },
  };
}

export function authenticate(dependencies: AuthDependencies = createAuthDependencies()) {
  return async (request: AuthenticatedRequest, response: Response, next: NextFunction): Promise<void> => {
    const token = getBearerToken(request);
    if (!token) {
      response.status(401).json({ error: 'Authentication required' });
      return;
    }

    try {
      const payload = jwt.verify(token, dependencies.jwtSecret);
      const userId = getUserId(payload);
      if (!userId) {
        response.status(401).json({ error: 'Invalid authentication token' });
        return;
      }

      const user = await dependencies.findUser(userId);
      if (!user) {
        response.status(401).json({ error: 'Invalid authentication token' });
        return;
      }

      request.user = user;
      next();
    } catch {
      response.status(401).json({ error: 'Invalid authentication token' });
    }
  };
}