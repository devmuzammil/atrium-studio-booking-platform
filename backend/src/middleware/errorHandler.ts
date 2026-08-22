import { ErrorRequestHandler, NextFunction, Request, Response } from 'express';

export function notFoundHandler(_request: Request, response: Response): void {
  response.status(404).json({ error: 'Route not found' });
}

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  _request: Request,
  response: Response,
  _next: NextFunction,
): void => {
  const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error
    ? Number((error as { statusCode: unknown }).statusCode)
    : 500;

  const safeStatusCode = [400, 401, 403, 404, 409, 500].includes(statusCode)
    ? statusCode
    : 500;

  response.status(safeStatusCode).json({
    error: safeStatusCode === 500 ? 'Internal server error' : (error as Error).message,
  });
};
