import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';

export interface RequestContextRequest extends Request {
  requestId?: string;
}

export function requestContext(request: Request, response: Response, next: NextFunction): void {
  const contextRequest = request as RequestContextRequest;
  const requestId = request.header('x-request-id') || randomUUID();
  contextRequest.requestId = requestId;
  response.setHeader('x-request-id', requestId);
  const startedAt = Date.now();
  response.on('finish', () => {
    console.log(JSON.stringify({ requestId, method: request.method, path: request.path, status: response.statusCode, durationMs: Date.now() - startedAt }));
  });
  next();
}