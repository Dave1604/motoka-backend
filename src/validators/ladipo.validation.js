import { z } from 'zod';

const uuid = z.string().uuid();

export const ladipoOrderNumberParamSchema = z.object({
  orderNumber: z
    .string()
    .min(4)
    .max(80)
    .regex(/^[A-Za-z0-9_-]+$/),
});

export const ladipoCartItemIdParamSchema = z.object({
  id: uuid,
});

export const ladipoAddToCartBodySchema = z.object({
  product_id: uuid,
  quantity: z.coerce.number().int().min(1).max(99).optional().default(1),
});

export const ladipoUpdateCartItemBodySchema = z.object({
  quantity: z.coerce.number().int().min(1).max(99),
});

const deliverySchema = z
  .object({
    method: z.string().min(1).max(64),
    state: z.string().max(120).optional(),
  })
  .passthrough()
  .superRefine((d, ctx) => {
    const m = String(d.method || '')
      .trim()
      .toLowerCase();
    if (m !== 'pickup' && (!d.state || !String(d.state).trim())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'state is required when delivery method is not pickup',
        path: ['state'],
      });
    }
  });

const orderLineSchema = z.object({
  inventory_id: uuid,
  quantity: z.coerce.number().int().min(1).max(500),
});

export const ladipoCreateOrderBodySchema = z.object({
  items: z.array(orderLineSchema).min(1).max(100),
  delivery: deliverySchema,
});

export const ladipoPayOrderBodySchema = z.object({
  payment_gateway: z.enum(['paystack', 'monicredit']).optional().default('paystack'),
});

/** Paystack reference or Monicredit / Ladipo gateway reference string */
export const ladipoVerifyPaymentBodySchema = z.object({
  reference: z.string().trim().min(8).max(256),
});
