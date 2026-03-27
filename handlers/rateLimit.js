const { rateLimit } = require('express-rate-limit');

function createAuthRateLimit({ windowMs, limit }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many requests. Please try again later.' }
  });
}

const loginRateLimit = createAuthRateLimit({ windowMs: 15 * 60 * 1000, limit: 10 });
const registerRateLimit = createAuthRateLimit({ windowMs: 60 * 60 * 1000, limit: 5 });
const resetRequestRateLimit = createAuthRateLimit({ windowMs: 15 * 60 * 1000, limit: 5 });
const resetConsumeRateLimit = createAuthRateLimit({ windowMs: 15 * 60 * 1000, limit: 10 });
const magicLinkRateLimit = createAuthRateLimit({ windowMs: 15 * 60 * 1000, limit: 5 });
const magicLoginRateLimit = createAuthRateLimit({ windowMs: 15 * 60 * 1000, limit: 10 });
const adminWriteRateLimit = createAuthRateLimit({ windowMs: 15 * 60 * 1000, limit: 30 });
const financialRateLimit = createAuthRateLimit({ windowMs: 15 * 60 * 1000, limit: 20 });

module.exports = {
  createAuthRateLimit,
  loginRateLimit,
  registerRateLimit,
  resetRequestRateLimit,
  resetConsumeRateLimit,
  magicLinkRateLimit,
  magicLoginRateLimit,
  adminWriteRateLimit,
  financialRateLimit
};
