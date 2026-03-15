import { Response } from 'express';

const COOKIE_NAME = 'bolo_session';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function setSessionCookie(res: Response, sessionId: string, isProduction: boolean): void {
  res.cookie(COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    domain: isProduction ? '.bolospot.com' : undefined,
    path: '/',
    maxAge: MAX_AGE_MS,
  });
}

export function clearSessionCookie(res: Response, isProduction: boolean): void {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    domain: isProduction ? '.bolospot.com' : undefined,
    path: '/',
  });
}
