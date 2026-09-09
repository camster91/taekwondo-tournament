import crypto from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { Router } from 'express';
import type { Request, Response } from 'express-serve-static-core';
import Stripe from 'stripe';
import {
  checkoutPlanFromInput,
  mapStripeSubscription,
  stripeRuntimeConfigFromEnv,
} from '../services/stripe-billing.js';
import { authenticate, type AuthenticatedRequest } from '../middleware/auth.js';
import { publicAppUrlFromEnv } from '../services/production-config.js';

const router = Router();

const SUBSCRIPTION_EVENTS = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
]);

const CHECKOUT_EVENTS = new Set([
  'checkout.session.completed',
]);

export async function stripeWebhookHandler(req: Request, res: Response): Promise<Response> {
  let config: ReturnType<typeof stripeRuntimeConfigFromEnv>;
  try {
    config = stripeRuntimeConfigFromEnv(process.env);
  } catch {
    return res.status(503).json({ error: 'Billing is not configured.' });
  }

  const signature = req.headers['stripe-signature'];
  if (!signature || Array.isArray(signature) || !Buffer.isBuffer(req.body)) {
    return res.status(400).json({ error: 'A valid Stripe signature and raw payload are required.' });
  }

  const stripe = new Stripe(config.secretKey);
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, config.webhookSecret);
  } catch {
    return res.status(400).json({ error: 'Invalid Stripe webhook signature.' });
  }

  const prisma: PrismaClient = req.app.locals.prisma;
  const payloadHash = crypto.createHash('sha256').update(req.body).digest('hex');

  // P2-2: Handle checkout.session.completed for entry-fee payments
  if (CHECKOUT_EVENTS.has(event.type)) {
    const session = event.data.object as {
      id: string;
      metadata?: { registrationId?: string; type?: string };
      payment_status?: string;
      amount_total?: number;
    };

    if (session.metadata?.type === 'entry_fee' && session.metadata.registrationId) {
      const registrationId = session.metadata.registrationId;

      // Fast path for normal Stripe retries
      const existingEvent = await prisma.billingWebhookEvent.findUnique({
        where: { providerEventId: event.id },
        select: { id: true },
      });
      if (existingEvent) return res.json({ processed: false, duplicate: true });

      try {
        await prisma.$transaction(async (tx) => {
          await tx.billingWebhookEvent.create({
            data: { providerEventId: event.id, type: event.type, payloadHash },
          });

          const registration = await tx.registration.findUnique({
            where: { id: registrationId },
            select: { id: true, paymentStatus: true, paymentIntentId: true },
          });

          if (!registration) {
            throw new Error(`Webhook references unknown registration: ${registrationId}`);
          }

          // Update payment status to 'paid' only if it was pending
          if (
            registration.paymentStatus === 'pending' &&
            session.payment_status === 'paid'
          ) {
            await tx.registration.update({
              where: { id: registrationId },
              data: {
                paymentStatus: 'paid',
                paymentReceivedAt: new Date(),
                paymentAmountCents: session.amount_total ?? null,
              },
            });
          }
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          return res.json({ processed: false, duplicate: true });
        }
        throw error;
      }

      return res.json({ processed: true, type: 'entry_fee' });
    }

    // Not an entry-fee checkout; ignore
    return res.json({ processed: false, ignored: true });
  }

  if (!SUBSCRIPTION_EVENTS.has(event.type)) {
    return res.json({ processed: false, ignored: true });
  }

  // Fast path for normal Stripe retries. The unique constraint below remains
  // the authority for concurrent deliveries of the same event.
  const existingSubEvent = await prisma.billingWebhookEvent.findUnique({
    where: { providerEventId: event.id },
    select: { id: true },
  });
  if (existingSubEvent) return res.json({ processed: false, duplicate: true });

  const mapped = mapStripeSubscription(
    event.data.object as unknown as Parameters<typeof mapStripeSubscription>[0],
    config.prices,
  );

  try {
    await prisma.$transaction(async (tx) => {
      await tx.billingWebhookEvent.create({
        data: { providerEventId: event.id, type: event.type, payloadHash },
      });
      const organization = await tx.organization.findUnique({
        where: { id: mapped.organizationId },
        select: { id: true, plan: true },
      });
      if (!organization) throw new Error('Stripe webhook references an unknown organization');

      await tx.organizationBillingSubscription.upsert({
        where: { organizationId: organization.id },
        create: {
          organizationId: organization.id,
          provider: 'stripe',
          providerCustomerId: mapped.providerCustomerId,
          providerSubscriptionId: mapped.providerSubscriptionId,
          status: mapped.status,
          plan: mapped.plan,
          currentPeriodEnd: mapped.currentPeriodEnd,
          cancelAtPeriodEnd: mapped.cancelAtPeriodEnd,
        },
        update: {
          provider: 'stripe',
          providerCustomerId: mapped.providerCustomerId,
          providerSubscriptionId: mapped.providerSubscriptionId,
          status: mapped.status,
          plan: mapped.plan,
          currentPeriodEnd: mapped.currentPeriodEnd,
          cancelAtPeriodEnd: mapped.cancelAtPeriodEnd,
        },
      });
      await tx.organization.update({
        where: { id: organization.id },
        data: { plan: mapped.effectivePlan },
      });
      if (organization.plan !== mapped.effectivePlan) {
        await tx.organizationPlanChange.create({
          data: {
            organizationId: organization.id,
            fromPlan: organization.plan,
            toPlan: mapped.effectivePlan,
            source: 'stripe',
            reason: `${event.type}:${event.id}`,
          },
        });
      }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.json({ processed: false, duplicate: true });
    }
    throw error;
  }

  return res.json({ processed: true });
}

async function ownedOrganization(req: AuthenticatedRequest, res: Response) {
  const organizationId = typeof req.body?.organizationId === 'string'
    ? req.body.organizationId
    : '';
  if (!organizationId) {
    res.status(400).json({ error: 'organizationId is required.' });
    return null;
  }
  const prisma: PrismaClient = req.app.locals.prisma;
  const membership = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId: req.user!.id } },
    include: { organization: { include: { billingSubscription: true } } },
  });
  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    res.status(403).json({ error: 'Organization owner or admin access is required.' });
    return null;
  }
  return membership.organization;
}

router.post('/checkout', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  let plan: 'starter' | 'pro';
  try {
    plan = checkoutPlanFromInput(req.body?.plan);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid plan.' });
  }
  let config: ReturnType<typeof stripeRuntimeConfigFromEnv>;
  try {
    config = stripeRuntimeConfigFromEnv(process.env);
  } catch {
    return res.status(503).json({ error: 'Billing is not configured.' });
  }
  const organization = await ownedOrganization(req, res);
  if (!organization) return;
  if (organization.billingSubscription?.providerSubscriptionId
    && ['active', 'trialing', 'past_due'].includes(organization.billingSubscription.status)) {
    return res.status(409).json({ error: 'This organization already has a Stripe subscription. Use the billing portal.' });
  }

  const stripe = new Stripe(config.secretKey);
  const prisma: PrismaClient = req.app.locals.prisma;
  let customerId = organization.billingSubscription?.providerCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      name: organization.name,
      metadata: { organizationId: organization.id },
    });
    customerId = customer.id;
    await prisma.organizationBillingSubscription.upsert({
      where: { organizationId: organization.id },
      create: {
        organizationId: organization.id,
        provider: 'stripe',
        providerCustomerId: customerId,
        status: 'incomplete',
        plan,
      },
      update: { provider: 'stripe', providerCustomerId: customerId, plan },
    });
  }
  const priceId = plan === 'starter'
    ? process.env.STRIPE_STARTER_PRICE_ID!
    : process.env.STRIPE_PRO_PRICE_ID!;
  const publicUrl = publicAppUrlFromEnv(process.env);
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    client_reference_id: organization.id,
    line_items: [{ price: priceId, quantity: 1 }],
    automatic_tax: { enabled: true },
    subscription_data: { metadata: { organizationId: organization.id, plan } },
    success_url: `${publicUrl}/settings/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${publicUrl}/settings/billing?checkout=cancelled`,
  });
  return res.status(201).json({ url: session.url });
});

router.post('/portal', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  let config: ReturnType<typeof stripeRuntimeConfigFromEnv>;
  try {
    config = stripeRuntimeConfigFromEnv(process.env);
  } catch {
    return res.status(503).json({ error: 'Billing is not configured.' });
  }
  const organization = await ownedOrganization(req, res);
  if (!organization) return;
  const customerId = organization.billingSubscription?.providerCustomerId;
  if (!customerId) return res.status(409).json({ error: 'No Stripe customer exists for this organization.' });

  const stripe = new Stripe(config.secretKey);
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${publicAppUrlFromEnv(process.env)}/settings/billing`,
  });
  return res.status(201).json({ url: session.url });
});

export default router;
