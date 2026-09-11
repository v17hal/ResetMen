/**
 * RESETMEN Terms & Conditions — the client's wording of 11/09/2026, verbatim.
 *
 * One copy, here. The website renders it, the API serves it to the Android app, and the
 * booking request carries `TERMS.version` back so each booking records exactly which text
 * the customer agreed to.
 *
 * Changing a word means changing `version`. A booking made against the old text keeps the
 * old version on its row, which is the point: "what did they agree to?" has to have an
 * answer after the wording moves on.
 */
export const TERMS = {
  version: '2026-09-11',
  title: 'RESETMEN – Terms & Conditions',
  clauses: [
    'RESETMEN provides non-medical wellness, relaxation and body-care services only. We do not provide medical treatment, diagnosis or physiotherapy.',
    'Customers must inform RESETMEN of any relevant health condition, injury, allergy, recent surgery or other circumstance that may affect their session.',
    'Services are provided without removal of clothing. No sexual, intimate or inappropriate services are provided.',
    'Bookings, cancellations, rescheduling and refunds are subject to the RESETMEN Cancellation & Refund Policy.',
    'Individual experiences and results may vary. RESETMEN does not guarantee any specific medical or physical outcome.',
    'By making payment, you confirm that you have read and agreed to these Terms & Conditions and the applicable policies.',
  ],
  /** The checkbox label at checkout. */
  agreement:
    'I agree to the Terms & Conditions and understand that RESETMEN provides non-medical wellness services only',
} as const;

export type Terms = typeof TERMS;
