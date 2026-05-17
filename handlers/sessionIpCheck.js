"use strict";

const { getClientIp } = require('./antiVpnAllowlist');

const ALLOWED_PATHS = new Set([
  '/',
  '/website',
  '/banned',
  '/favicon.ico',
]);

function isAllowedRequest(req) {
  const path = req.path || '/';

  if (ALLOWED_PATHS.has(path)) return true;
  if (path.startsWith('/assets/')) return true;
  if (path.startsWith('/auth/')) return true;

  return false;
}

function createSessionIpCheck() {
  return function sessionIpCheck(req, res, next) {
    if (!req.session?.userinfo) {
      return next();
    }

    if (isAllowedRequest(req)) {
      return next();
    }

    // Force re-login for sessions created before IP binding feature
    if (!req.session?.sessionIp) {
      return req.session.destroy((err) => {
        if (err) return next();
        const isApiRequest = req.path.startsWith('/api/');
        if (isApiRequest) {
          return res.status(401).json({
            code: 'SESSION_IP_REQUIRED',
            error: 'Session expired. Please login again.',
            redirectTo: '/auth'
          });
        }
        return res.redirect('/auth?error=session_expired');
      });
    }

    const currentIp = getClientIp(req);
    if (!currentIp) {
      return next();
    }

    if (req.session.sessionIp !== currentIp) {
      return req.session.destroy((err) => {
        if (err) {
          return next();
        }

        const isApiRequest = req.path.startsWith('/api/');
        if (isApiRequest) {
          return res.status(401).json({
            code: 'SESSION_IP_CHANGED',
            error: 'Your IP address has changed. Please login again.',
            redirectTo: '/auth'
          });
        }

        return res.redirect('/auth?error=ip_changed');
      });
    }

    next();
  };
}

module.exports = createSessionIpCheck;
