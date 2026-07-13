import React from 'react';

/**
 * GiveawayRules
 *
 * Renders the official giveaway rules/terms page. Add a route for this in
 * App.js:
 *
 *   import GiveawayRules from '@/pages/GiveawayRules';
 *   ...
 *   <Route path="/giveaway-rules" element={<GiveawayRules />} />
 *
 * IMPORTANT: Fill in every [BRACKETED] placeholder below with your real
 * details before publishing (dates, address, contact email, governing
 * state/province). This is a general template, not reviewed by an attorney —
 * consider a quick legal review, especially since Canadian entrants are
 * included.
 */

const GiveawayRules = () => {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <a
          href="/"
          className="text-sm font-medium text-[#1a2947] hover:underline"
        >
          ← Back to Home
        </a>

        <h1 className="text-3xl font-bold text-[#1a2947] mt-6 mb-2">
          $200 Bahamas or Jamaica Giveaway — Official Rules
        </h1>
        <p className="text-slate-500 mb-10">
          Sky Unlimited Travel Inc.
        </p>

        <div className="prose prose-slate max-w-none space-y-6 text-slate-700">
          <p className="font-semibold text-slate-900">
            NO PURCHASE OR PAYMENT NECESSARY TO ENTER OR WIN. A PURCHASE WILL
            NOT INCREASE YOUR CHANCES OF WINNING.
          </p>

          <section>
            <h2 className="text-lg font-bold text-[#1a2947] mt-8 mb-2">
              1. Sponsor
            </h2>
            <p>
              This giveaway ("Giveaway") is sponsored by Sky Unlimited Travel
              Inc. ("Sponsor"), [ADDRESS TO BE ADDED].
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#1a2947] mt-8 mb-2">
              2. Eligibility
            </h2>
            <p>
              The Giveaway is open to legal residents of the United States and
              Canada (excluding Quebec) who are at least 18 years old at the
              time of entry. Employees of Sponsor and their immediate family
              members (spouse, parents, children, siblings) or household
              members are not eligible to enter. Void where prohibited by law.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#1a2947] mt-8 mb-2">
              3. Giveaway Period
            </h2>
            <p>
              Entries will be accepted starting <strong>Aug 10, 2026</strong>{' '}
              at 12:00 AM ET and ending <strong>Aug 21, 2026</strong> at 11:59
              PM ET ("Entry Period"). Entries received outside the Entry
              Period will not be eligible.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#1a2947] mt-8 mb-2">
              4. How to Enter
            </h2>
            <p>
              To enter, complete the entry form on Sponsor's website at
              skyunlimitedtravelinc.com, providing your name, email address,
              and destination preference (Bahamas or Jamaica). Limit{' '}
              <strong>one (1) entry per person / email address</strong> for
              the duration of the Entry Period. Multiple entries from the
              same person will be disqualified.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#1a2947] mt-8 mb-2">
              5. Prize
            </h2>
            <p>
              One (1) winner will receive a <strong>$200 credit</strong>{' '}
              ("Prize") toward the purchase of a Sky Unlimited Travel package
              to the Bahamas or Jamaica. The Prize:
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li>
                Has no cash value and cannot be exchanged, transferred, or
                redeemed for cash.
              </li>
              <li>
                Must be used toward a Sky Unlimited Travel booking within{' '}
                <strong>[X months]</strong> of the winner notification date,
                after which it expires.
              </li>
              <li>
                Does not cover the full cost of travel; the winner is
                responsible for any remaining balance, taxes, and fees.
              </li>
              <li>
                Is non-transferable and may not be combined with other offers
                or promotions unless stated otherwise by Sponsor.
              </li>
            </ul>
            <p className="mt-2">
              Approximate retail value of the Prize: $200 USD.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#1a2947] mt-8 mb-2">
              6. Winner Selection and Notification
            </h2>
            <p>
              The winner will be selected at random from all eligible entries
              received during the Entry Period, on or about{' '}
              <strong>[DRAW DATE]</strong>. The winner will be notified by
              email within <strong>[X business days]</strong> of the drawing.
              The winner must respond within <strong>[X days]</strong> of
              notification to claim the Prize; if unclaimed within that time,
              an alternate winner may be selected.
            </p>
            <p className="mt-2 italic text-slate-500">
              For Canadian entrants: to claim the Prize, the selected
              entrant will be required to correctly answer a time-limited,
              skill-testing mathematical question without assistance, in
              accordance with Canadian contest law.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#1a2947] mt-8 mb-2">
              7. Odds of Winning
            </h2>
            <p>
              Odds of winning depend on the total number of eligible entries
              received during the Entry Period.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#1a2947] mt-8 mb-2">
              8. General Conditions
            </h2>
            <p>
              Sponsor reserves the right to disqualify any entrant who
              tampers with the entry process, submits fraudulent or duplicate
              entries, or otherwise violates these Official Rules. Sponsor
              reserves the right to cancel, suspend, or modify the Giveaway
              if fraud, technical failure, or any other factor beyond
              Sponsor's reasonable control impairs the integrity of the
              Giveaway.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#1a2947] mt-8 mb-2">
              9. Use of Personal Information
            </h2>
            <p>
              Information collected through entry (name, email, destination
              preference) will be used by Sponsor to administer the
              Giveaway, contact the winner, and — unless you opt out — to
              send you occasional travel deals and promotions from Sky
              Unlimited Travel. You may unsubscribe from marketing
              communications at any time. Sponsor will not sell or share your
              information with unaffiliated third parties for their own
              marketing purposes.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#1a2947] mt-8 mb-2">
              10. Release and Limitation of Liability
            </h2>
            <p>
              By entering, participants agree to release and hold harmless
              Sponsor, its officers, employees, and agents from any
              liability, injury, loss, or damage arising from participation
              in the Giveaway or acceptance/use of the Prize.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#1a2947] mt-8 mb-2">
              11. Disputes
            </h2>
            <p>
              This Giveaway is governed by the laws of{' '}
              <strong>[YOUR STATE/PROVINCE]</strong>, without regard to
              conflict-of-law principles. Any disputes arising from this
              Giveaway shall be resolved individually, without resort to
              class action.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#1a2947] mt-8 mb-2">
              12. Not Affiliated with Social Media Platforms
            </h2>
            <p>
              If this Giveaway is promoted on Facebook, Instagram, or similar
              platforms, it is in no way sponsored, endorsed, administered
              by, or associated with those platforms. Any questions or
              entries must be directed to Sponsor, not the platform.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#1a2947] mt-8 mb-2">
              13. Winner List / Sponsor Contact
            </h2>
            <p>
              For questions about these Official Rules or to request the
              name of the winner after the Giveaway ends, contact:{' '}
              <strong>[SPONSOR EMAIL / CONTACT INFO]</strong>.
            </p>
          </section>

          <hr className="my-8 border-slate-200" />

          <p className="text-xs text-slate-400 italic">
            Fields in brackets [ ] need to be filled in with your specific
            details before publishing (dates, address, contact email,
            governing state/province, etc.). This document is a general
            template and has not been reviewed by an attorney — recommended
            before running any prize giveaway, particularly one open to
            Canadian residents.
          </p>
        </div>
      </div>
    </div>
  );
};

export default GiveawayRules;