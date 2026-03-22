const express = require('express');
const Stripe = require('stripe');
const loadConfig = require('../handlers/config');
const settings = loadConfig('./config.toml');
const log = require('../handlers/log');
const { validate, schemas } = require('../handlers/validate');

const HeliactylModule = {
  "name": "Billing",
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

// Helper to get fresh Stripe instance if key changes
let currentStripeKey = settings?.api?.client?.stripe?.secret_key;
let stripeInstance = new Stripe(currentStripeKey || 'sk_test_mock_key');

function getStripe() {
  const latestKey = settings?.api?.client?.stripe?.secret_key;
  if (latestKey !== currentStripeKey) {
    currentStripeKey = latestKey;
    stripeInstance = new Stripe(latestKey || 'sk_test_mock_key');
  }
  return stripeInstance;
}

const COIN_PURCHASE_OPTIONS = [
  { amount: 1000, price_usd: 1.79 },
  { amount: 2500, price_usd: 3.99 },
  { amount: 5000, price_usd: 5.99 },
  { amount: 10000, price_usd: 9.99 },
  { amount: 25000, price_usd: 19.99 }
];

const BUNDLES = {
  starter: {
    name: "Explorer",
    price_usd: 7.99,
    resources: {
      ram: 16384, // 16 GB
      disk: 102400, // 100 GB
      cpu: 300, // 300%
      servers: 2,
      coins: 1000
    }
  },
  network: {
    name: "Network",
    price_usd: 37.99,
    resources: {
      ram: 65536, // 64 GB
      disk: 409600, // 400 GB
      cpu: 1200, // 1200%
      servers: 8,
      coins: 3500
    }
  },
  enterprise: {
    name: "Unlimited",
    price_usd: 99.99,
    resources: {
      ram: 163840, // 160 GB
      disk: 1024000, // 1000 GB
      cpu: 2400, // 2400%
      servers: 20,
      coins: 10000
    }
  }
};

class BillingManager {
  constructor(db) {
    this.db = db;
  }

  async isSessionProcessed(sessionId) {
    return await this.db.transaction.findUnique({
      where: { externalId: sessionId }
    });
  }

  async getCreditBalance(userId) {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: { creditUsd: true }
    });
    return user?.creditUsd ?? 0;
  }

  async addCreditBalance(userId, amount) {
    const user = await this.db.user.update({
      where: { id: userId },
      data: { creditUsd: { increment: parseFloat(amount) } }
    });
    return user.creditUsd;
  }

  async getCoinBalance(userId) {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: { coins: true }
    });
    return user?.coins ?? 0;
  }

  async addCoins(userId, amount) {
    const user = await this.db.user.update({
      where: { id: userId },
      data: { coins: { increment: parseInt(amount) } }
    });
    return user.coins;
  }

  async removeCoins(userId, amount) {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: { coins: true }
    });
    if (!user || user.coins < amount) throw new Error('Insufficient funds');

    const updatedUser = await this.db.user.update({
      where: { id: userId },
      data: { coins: { decrement: parseInt(amount) } }
    });
    return updatedUser.coins;
  }

  async getTransactionHistory(userId) {
    return await this.db.transaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    });
  }

  async logTransaction(userId, type, details, amount, externalId = null) {
    // Schema uses Int for amount. Convert USD to cents if applicable, else use as is.
    const amountVal = (type === 'credit_purchase' || type === 'credit_spend')
      ? Math.round(amount * 100)
      : Math.round(amount);

    return await this.db.transaction.create({
      data: {
        userId,
        type,
        amount: amountVal,
        description: details.description || details.name || type,
        details: JSON.stringify(details),
        externalId: externalId
      }
    });
  }

  async addResources(userId, resources) {
    const user = await this.db.user.update({
      where: { id: userId },
      data: {
        extraRam: { increment: resources.ram || 0 },
        extraDisk: { increment: resources.disk || 0 },
        extraCpu: { increment: resources.cpu || 0 },
        extraServers: { increment: resources.servers || 0 }
      }
    });

    return {
      ram: user.extraRam,
      disk: user.extraDisk,
      cpu: user.extraCpu,
      servers: user.extraServers
    };
  }

  async applyBundle(userId, bundleId) {
    const bundle = BUNDLES[bundleId];
    if (!bundle) throw new Error('Invalid bundle ID');

    // Use a transaction for the entire bundle application
    await this.db.$transaction(async (tx) => {
      // Add resources
      await tx.user.update({
        where: { id: userId },
        data: {
          extraRam: { increment: bundle.resources.ram || 0 },
          extraDisk: { increment: bundle.resources.disk || 0 },
          extraCpu: { increment: bundle.resources.cpu || 0 },
          extraServers: { increment: bundle.resources.servers || 0 },
          coins: { increment: bundle.resources.coins || 0 }
        }
      });

      // Log the bundle purchase
      await tx.transaction.create({
        data: {
          userId,
          type: 'purchase',
          amount: Math.round(bundle.price_usd * 100), // Storing USD cents
          description: `Bundle Purchase: ${bundle.name}`,
          details: JSON.stringify({
            bundle: bundleId,
            name: bundle.name,
            resources: bundle.resources
          })
        }
      });
    });

    return true;
  }

  async createCheckoutSession(userId, amount_usd, userEmail) {
    const session = await getStripe().checkout.sessions.create({
      customer_email: userEmail,
      payment_method_types: ['card', 'link', 'paypal'],
      invoice_creation: {
        enabled: true,
      },
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Credit Balance',
              description: `Add $${amount_usd} credit to your account`,
            },
            unit_amount: Math.round(amount_usd * 100),
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${settings.website.domain}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${settings.website.domain}/billing`,
      metadata: {
        userId: userId,
        type: 'credit_purchase',
        amount_usd: amount_usd
      },
    });

    return session;
  }
}

module.exports.HeliactylModule = HeliactylModule;
module.exports.load = async function (app, db) {
  const router = express.Router();
  const billingManager = new BillingManager(db);

  // Middleware to check authentication
  router.use((req, res, next) => {
    if (!req.session.userinfo) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  });

  // Get user's balances and purchase options
  router.get('/billing/info', async (req, res) => {
    try {
      const userId = req.session.userinfo.id;
      const creditBalance = await billingManager.getCreditBalance(userId);
      const coinBalance = await billingManager.getCoinBalance(userId);

      res.json({
        balances: {
          credit_usd: creditBalance,
          coins: coinBalance
        },
        coin_packages: COIN_PURCHASE_OPTIONS,
        bundles: BUNDLES
      });
    } catch (error) {
      console.error('Error fetching billing info:', error);
      res.status(500).json({ error: 'Failed to fetch billing information' });
    }
  });

  // Create checkout session for adding credit
  router.post('/billing/checkout', validate(schemas.billingCheckout), async (req, res) => {
    try {
      const { amount_usd } = req.body;

      const session = await billingManager.createCheckoutSession(
        req.session.userinfo.id,
        amount_usd,
        req.session.userinfo.email
      );

      res.json({
        sessionId: session.id,
        url: session.url
      });
    } catch (error) {
      console.error('Error creating checkout session:', error);
      res.status(500).json({ error: 'Failed to create checkout session' });
    }
  });

  router.get('/billing/verify-checkout', async (req, res) => {
    try {
      const { session_id } = req.query;

      // Check if session was already processed (via externalId on Transaction)
      const isProcessed = await billingManager.isSessionProcessed(session_id);
      if (isProcessed) {
        return res.status(400).json({ error: 'This payment has already been processed' });
      }

      const session = await getStripe().checkout.sessions.retrieve(session_id);

      // Verify payment status and user
      if (session.payment_status !== 'paid') {
        return res.status(400).json({ error: 'Payment not completed' });
      }

      if (session.metadata.userId !== req.session.userinfo.id) {
        return res.status(403).json({ error: 'Unauthorized payment session' });
      }

      const amountUsd = parseFloat(session.metadata.amount_usd);

      // Fetch Invoice or Receipt URL
      let invoiceUrl = null;
      let invoicePdf = null;

      try {
        if (session.invoice) {
          const invoice = await getStripe().invoices.retrieve(session.invoice);
          invoiceUrl = invoice.hosted_invoice_url;
          invoicePdf = invoice.invoice_pdf;
        } else if (session.payment_intent) {
          const paymentIntent = await getStripe().paymentIntents.retrieve(session.payment_intent);
          if (paymentIntent.latest_charge) {
            const charge = await getStripe().charges.retrieve(paymentIntent.latest_charge);
            invoiceUrl = charge.receipt_url;
          }
        }
      } catch (err) {
        console.error('Failed to retrieve invoice details:', err);
      }

      // Add credit and log transaction atomically
      await db.$transaction(async (tx) => {
        // Double check within transaction
        const alreadyProcessed = await tx.transaction.findUnique({
          where: { externalId: session_id }
        });
        if (alreadyProcessed) throw new Error('ALREADY_PROCESSED');

        await tx.user.update({
          where: { id: req.session.userinfo.id },
          data: { creditUsd: { increment: amountUsd } }
        });

        await tx.transaction.create({
          data: {
            userId: req.session.userinfo.id,
            type: 'purchase',
            amount: Math.round(amountUsd * 100),
            description: 'Credit Purchase via Stripe',
            details: JSON.stringify({
              checkout_session: session_id,
              amount_usd: amountUsd,
              invoice_url: invoiceUrl,
              invoice_pdf: invoicePdf
            }),
            externalId: session_id
          }
        });
      });

      // Log the successful payment
      log('payment_success',
        `User ${req.session.userinfo.id} added $${amountUsd} credit balance via Stripe Checkout`
      );

      res.json({
        success: true,
        transaction: {
          id: session_id,
          amount_usd: amountUsd,
          date: new Date().toISOString(),
          status: 'completed',
          method: 'Stripe'
        }
      });
    } catch (error) {
      if (error.message === 'ALREADY_PROCESSED') {
        return res.status(400).json({ error: 'This payment has already been processed' });
      }
      console.error('Error verifying checkout:', error);
      res.status(500).json({ error: 'Failed to verify checkout' });
    }
  });

  // Purchase coins with credit balance
  router.post('/billing/purchase-coins', validate(schemas.purchaseCoins), async (req, res) => {
    try {
      const { package_id } = req.body;
      const userId = req.session.userinfo.id;

      const pkg = COIN_PURCHASE_OPTIONS.find(p => p.amount === package_id);
      if (!pkg) {
        return res.status(400).json({ error: 'Invalid package selected' });
      }

      const creditBalance = await billingManager.getCreditBalance(userId);
      if (creditBalance < pkg.price_usd) {
        return res.status(402).json({ error: 'Insufficient credit balance' });
      }

      let transaction;
      await db.$transaction(async (tx) => {
        // Deduct credit
        await tx.user.update({
          where: { id: userId },
          data: {
            creditUsd: { decrement: pkg.price_usd },
            coins: { increment: pkg.amount }
          }
        });

        // Log the credit spending
        await tx.transaction.create({
          data: {
            userId,
            type: 'spend',
            amount: Math.round(pkg.price_usd * 100),
            description: `Bought ${pkg.amount} Coins`,
            details: JSON.stringify({ description: `Bought ${pkg.amount} Coins` })
          }
        });

        // Log the coin purchase
        transaction = await tx.transaction.create({
          data: {
            userId,
            type: 'purchase',
            amount: pkg.amount,
            description: `Coin Purchase: ${pkg.amount} Coins`,
            details: JSON.stringify({
              package_amount: pkg.amount,
              price_usd: pkg.price_usd
            })
          }
        });
      });

      res.json({
        success: true,
        transaction,
        new_credit_balance: await billingManager.getCreditBalance(userId),
        new_coin_balance: await billingManager.getCoinBalance(userId)
      });
    } catch (error) {
      console.error('Error purchasing coins:', error);
      res.status(500).json({ error: 'Failed to purchase coins' });
    }
  });

  // Transfer coins to another user
  router.post('/billing/transfer-coins', validate(schemas.coinTransfer), async (req, res) => {
    try {
      if (settings.api?.client?.coins?.transfer?.enabled === false) {
        return res.status(403).json({ error: 'Coin transfers are currently disabled' });
      }
      const { recipientEmail, amount } = req.body;
      const userId = req.session.userinfo.id;

      const senderCoins = await billingManager.getCoinBalance(userId);
      if (senderCoins < amount) {
        return res.status(402).json({ error: 'Insufficient coin balance' });
      }

      // Find recipient by email or ID?
      // Original code said: const recipientId = recipientEmail; // Using ID as the identifier
      // I'll try to find user by email if it looks like one, or by ID.
      let recipient;
      if (recipientEmail.includes('@')) {
        recipient = await db.user.findUnique({ where: { email: recipientEmail } });
      } else {
        recipient = await db.user.findUnique({ where: { id: recipientEmail } });
      }

      if (!recipient) {
        return res.status(404).json({ error: 'Recipient not found' });
      }

      const recipientId = recipient.id;

      await db.$transaction(async (tx) => {
        // Verify sender has enough again inside tx
        const sender = await tx.user.findUnique({ where: { id: userId }, select: { coins: true } });
        if (!sender || sender.coins < amount) throw new Error('INSUFFICIENT_FUNDS');

        await tx.user.update({ where: { id: userId }, data: { coins: { decrement: amount } } });
        await tx.user.update({ where: { id: recipientId }, data: { coins: { increment: amount } } });

        await tx.transaction.create({
          data: {
            userId: userId,
            type: 'transfer_out',
            amount: -amount,
            description: `Transfer to ${recipientId}`
          }
        });
        await tx.transaction.create({
          data: {
            userId: recipientId,
            type: 'transfer_in',
            amount,
            description: `Transfer from ${userId}`
          }
        });
      });

      res.json({
        success: true,
        new_balance: await billingManager.getCoinBalance(userId)
      });

    } catch (error) {
      if (error.message === 'INSUFFICIENT_FUNDS') {
        return res.status(402).json({ error: 'Insufficient coin balance' });
      }
      console.error('Error transferring coins:', error);
      res.status(500).json({ error: error.message || 'Failed to transfer coins' });
    }
  });

  // Purchase bundle with credit balance
  router.post('/billing/purchase-bundle', validate(schemas.bundlePurchase), async (req, res) => {
    try {
      const { bundle_id } = req.body;
      const userId = req.session.userinfo.id;

      const bundle = BUNDLES[bundle_id];
      if (!bundle) return res.status(400).json({ error: 'Invalid bundle' });

      const creditBalance = await billingManager.getCreditBalance(userId);
      if (creditBalance < bundle.price_usd) {
        return res.status(402).json({ error: 'Insufficient credit balance' });
      }

      // Deduct credit and apply bundle
      await billingManager.addCreditBalance(userId, -bundle.price_usd);
      await billingManager.applyBundle(userId, bundle_id);

      const user = await db.user.findUnique({
        where: { id: userId },
        select: { extraRam: true, extraDisk: true, extraCpu: true, extraServers: true }
      });

      res.json({
        success: true,
        new_credit_balance: await billingManager.getCreditBalance(userId),
        new_resources: {
          ram: user.extraRam,
          disk: user.extraDisk,
          cpu: user.extraCpu,
          servers: user.extraServers
        },
        new_coin_balance: await billingManager.getCoinBalance(userId)
      });
    } catch (error) {
      console.error('Error purchasing bundle:', error);
      res.status(500).json({ error: 'Failed to purchase bundle' });
    }
  });

  // Get transaction history
  router.get('/billing/transactions', async (req, res) => {
    try {
      const userId = req.session.userinfo.id;
      const transactions = await billingManager.getTransactionHistory(userId);

      res.json({
        transactions: transactions.map(t => ({
          ...t,
          timestamp: t.createdAt.toISOString(),
          details: JSON.parse(t.details || '{}')
        }))
      });
    } catch (error) {
      console.error('Error fetching transactions:', error);
      res.status(500).json({ error: 'Failed to fetch transaction history' });
    }
  });

  // Get invoices (filtered transactions with invoice URLs)
  router.get('/billing/invoices', async (req, res) => {
    try {
      const userId = req.session.userinfo.id;
      const transactions = await billingManager.getTransactionHistory(userId);

      const invoices = transactions
        .map(t => ({ ...t, details: JSON.parse(t.details || '{}') }))
        .filter(t => t.type === 'purchase' && t.details && (t.details.invoice_url || t.details.invoice_pdf))
        .map(t => ({
          id: t.id,
          date: t.createdAt.toISOString(),
          amount: t.amount / 100, // Cents to USD
          url: t.details?.invoice_url,
          pdf: t.details?.invoice_pdf
        }));

      res.json({ invoices });
    } catch (error) {
      console.error('Error fetching invoices:', error);
      res.status(500).json({ error: 'Failed to fetch invoices' });
    }
  });

  // Mount the router
  app.use('/api/v5', router);
};
