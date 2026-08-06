// Single source of truth for the donation / "support the site" link.
// A Stripe Payment Link ("Customers choose what to pay", CTA = Donate) — a
// plain hosted-checkout URL, so the on-site card and header pill stay fully
// styled in our own tokens until the moment the reader clicks through.
// This is the PLATO reader's own link — the bootstrap copy carried the
// Aristotle reader's, sending Plato donors to the wrong checkout.
export const SUPPORT_URL = 'https://buy.stripe.com/28E3cw7MD8FR4Kmh0v9fW01';
