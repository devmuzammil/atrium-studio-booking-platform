import { NextFunction, Request, Response, Router } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/prisma';
import { getConfig } from '../config/env';
import { authenticate, AuthDependencies, AuthenticatedRequest, createAuthDependencies } from '../middleware/auth';
import { verifyPassword } from '../services/passwordService';

export function createAuthRoutes(authDependencies: AuthDependencies = createAuthDependencies()): Router {
  const router = Router();

  router.post('/login', async (request: Request, response: Response, next: NextFunction) => {
    try {
      const email = typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : '';
      const password = typeof request.body?.password === 'string' ? request.body.password : '';
      if (!email || !password) {
        response.status(400).json({ error: 'email and password are required' });
        return;
      }

      const user = await prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          email: true,
          passwordHash: true,
          roles: { select: { role: true, venueId: true } },
        },
      });

      if (!user || !verifyPassword(password, user.passwordHash)) {
        response.status(401).json({ error: 'Invalid email or password' });
        return;
      }

      const token = jwt.sign({ sub: user.id }, getConfig().jwtSecret, { expiresIn: '12h' });
      response.status(200).json({
        token,
        user: {
          id: user.id,
          email: user.email,
          roles: user.roles,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/me', authenticate(authDependencies), async (request: Request, response: Response, next: NextFunction) => {
    try {
      const authenticated = request as AuthenticatedRequest;
      const userId = authenticated.user?.id;
      if (!userId) {
        response.status(401).json({ error: 'Authentication required' });
        return;
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          roles: { select: { role: true, venueId: true } },
        },
      });

      if (!user) {
        response.status(401).json({ error: 'Invalid authentication token' });
        return;
      }

      response.status(200).json({ user });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
