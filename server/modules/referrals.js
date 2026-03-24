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

    // Retrieve the referral code
    const referral = await db.referral.findUnique({
      where: { code: referralCode }
    });

    if (!referral) {
      return res.json({ error: "Invalid code" });
    }

    // Check if user has already claimed a code
    const alreadyClaimed = await db.referral.findFirst({
      where: { claimedById: sessionUser.id }
    });

    if (alreadyClaimed) {
      return res.json({ error: "Already claimed a code" });
    }

    // Check if the referral code was created by the user
    if (referral.userId === sessionUser.id) {
      return res.json({ error: "Cannot claim your own code" });
    }

    // Check if code was already claimed (unique constraint in schema but good to check)
    if (referral.claimedById) {
      return res.json({ error: "Code already claimed" });
    }

    try {
      // Award the referral bonus atomically
      await db.$transaction(async (tx) => {
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
      });

      res.json({ success: "Referral code claimed" });
    } catch (error) {
      console.error("Referral claim error:", error);
      res.json({ error: "Failed to claim referral code" });
    }
  });
};
