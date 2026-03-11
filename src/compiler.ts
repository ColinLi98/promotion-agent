import crypto from "node:crypto";

import { type OfferCard, type ProductDraft, OfferCardSchema } from "./domain.js";

const joinBullets = (bullets: string[]) => bullets.filter(Boolean).slice(0, 2).join("; ");

const buildRationalNarrative = (product: ProductDraft) => {
  const positioning = joinBullets(product.positioningBullets);
  return positioning
    ? `${product.name} focuses on measurable value: ${positioning}.`
    : `${product.name} focuses on measurable value and operational clarity.`;
};

const buildPremiumNarrative = (product: ProductDraft) => {
  const positioning = joinBullets(product.positioningBullets);
  return positioning
    ? `${product.name} delivers a polished buying experience with ${positioning}.`
    : `${product.name} delivers a polished buying experience for demanding buyers.`;
};

const buildSimpleNarrative = (product: ProductDraft) =>
  `${product.name} is a clear, structured option for ${product.intendedFor.join(" / ")} tasks.`;

export const compileOfferCard = (product: ProductDraft): OfferCard =>
  OfferCardSchema.parse({
    offerId: `offer_${crypto.randomUUID().slice(0, 8)}`,
    title: product.name,
    description: product.description,
    price: product.price,
    currency: product.currency,
    intendedFor: product.intendedFor,
    constraints: product.constraints,
    claims: product.claims,
    actionEndpoints: product.actionEndpoints,
    narrativeVariants: {
      rational: buildRationalNarrative(product),
      premium: buildPremiumNarrative(product),
      simple: buildSimpleNarrative(product),
    },
  });
