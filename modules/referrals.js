const createAuthz = require('../handlers/authz');

const HeliactylModule = {
  "name": "Referrals",
  "version": "1.0.0",
  "api_level": 4,
  "target_platform": "10.0.0",
  "description": "Core module",
  "author": {
    "name": "Matt James",
    "email": "me@ether.pizza",
    "url": "https://ether.pizza"
  },
  "dependencies": [],
  "permissions": [],
  "routes": [],
  "config": {},
  "hooks": [],
  "tags": ['core'],
  "license": "MIT"
};

/* Module */
module.exports.HeliactylModule = HeliactylModule;
module.exports.load = async function (app, db) {
  const authz = createAuthz(db);

  app.get('/generate', async (req, res) => {
    if (!authz.hasUserSession(req)) return res.redirect("/login");
    if (!authz.hasPterodactylSession(req)) return res.redirect("/login");
    const sessionUser = authz.getSessionUser(req);

    if (!req.query.code) {
      return res.json({ error: "No code provided" });
    }

    let referralCode = req.query.code;
    // check if the referral code is less than 16 characters and has no spaces
    if (referralCode.length > 15 || referralCode.includes(" ")) {
      return res.json({ error: "Invalid code" });
    }

    // check if the referral code already exists
    const existing = await db.referral.findUnique({
      where: { code: referralCode }
    });

    if (existing) {
      return res.json({ error: "Code already exists" });
    }

    // Check if user already has a referral code
    const userReferral = await db.referral.findUnique({
      where: { userId: sessionUser.id }
    });

    if (userReferral) {
      return res.json({ error: `You already have a referral code [${userReferral.code}]` });
    }

    // Save the referral code
    await db.referral.create({
        data: {
          code: referralCode,
          userId: sessionUser.id,
          createdAt: new Date()
        }
    });

    res.json({ success: "Referral code created" });
  });

  app.get('/claim', async (req, res) => {
    if (!authz.hasUserSession(req)) return res.redirect("/login");
    if (!authz.hasPterodactylSession(req)) return res.redirect("/login");
    const sessionUser = authz.getSessionUser(req);

    // Get the referral code from the query
    if (!req.query.code) {
      return res.json({ error: "No code provided" });
    }

    const referralCode = req.query.code;

    try {
      const claimResult = await db.$transaction(async (tx) => {
        const referral = await tx.referral.findUnique({
          where: { code: referralCode },
          select: {
            id: true,
            userId: true,
            claimedById: true
          }
        });

        if (!referral) {
          return { error: "Invalid code" };
        }

        if (referral.userId === sessionUser.id) {
          return { error: "Cannot claim your own code" };
        }

        const alreadyClaimed = await tx.referral.findFirst({
          where: { claimedById: sessionUser.id },
          select: { id: true }
        });

        if (alreadyClaimed) {
          return { error: "Already claimed a code" };
        }

        if (referral.claimedById) {
          return { error: "Code already claimed" };
        }

        // Award the referral bonus atomically
        // Award the owner
        await tx.user.update({
          where: { id: referral.userId },
          data: { coins: { increment: 80 } }
        });

        await tx.transaction.create({
          data: {
            userId: referral.userId,
            type: 'earn',
            amount: 80,
            description: `Referral bonus from claimer ${sessionUser.id}`
          }
        });

        // Award the claimer
        await tx.user.update({
          where: { id: sessionUser.id },
          data: { coins: { increment: 250 } }
        });

        await tx.transaction.create({
          data: {
            userId: sessionUser.id,
            type: 'earn',
            amount: 250,
            description: `Claimed referral code: ${referralCode}`
          }
        });

        // Mark code as claimed
        await tx.referral.update({
          where: { id: referral.id },
          data: {
            claimedById: sessionUser.id,
            claimedAt: new Date()
          }
        });

        return { success: true };
      });

      if (claimResult.error) {
        return res.json({ error: claimResult.error });
      }

      res.json({ success: "Referral code claimed" });
    } catch (error) {
      if (error?.code === 'P2002') {
        return res.json({ error: "Already claimed a code" });
      }

      console.error("Referral claim error:", error);
      res.json({ error: "Failed to claim referral code" });
    }
  });
};
