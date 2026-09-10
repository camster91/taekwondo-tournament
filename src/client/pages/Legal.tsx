import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { BowinLogo } from '../components/brand/BowinLogo';

type LegalKind = 'privacy' | 'terms';

type LegalProps = {
  kind: LegalKind;
};

const effectiveDate = 'August 24, 2026';
const operator = 'I Design Stuff Ltd';
const contactEmail = 'cameron@ashbi.ca';

function LegalShell({ title, children }: { title: string; children: React.ReactNode }) {
  useEffect(() => {
    document.title = `${title} | Bowin`;
  }, [title]);

  return (
    <main className="min-h-screen bg-[#f7f5f0] text-surface-900">
      <div className="relative overflow-hidden border-b border-surface-900/10 bg-[#0c1d28] text-white">
        <div className="absolute inset-0 opacity-30" style={{ backgroundImage: 'radial-gradient(circle at 20% 20%, #e8a73c 0, transparent 30%), radial-gradient(circle at 85% 30%, #5b8c84 0, transparent 35%)' }} />
        <div className="relative mx-auto flex max-w-5xl items-center justify-between px-5 py-6 sm:px-8">
          <Link to="/" aria-label="Bowin home" className="rounded focus:outline-none focus:ring-2 focus:ring-warning/30">
            <BowinLogo inverse showDescriptor />
          </Link>
          <Link to="/" className="text-sm font-semibold text-white/85 transition hover:text-white focus:outline-none focus:ring-2 focus:ring-warning/30">
            Back to Bowin
          </Link>
        </div>
        <div className="relative mx-auto max-w-5xl px-5 pb-14 pt-8 sm:px-8 sm:pb-16">
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-warning/30">Legal</p>
          <h1 className="max-w-3xl font-serif text-4xl font-semibold tracking-tight sm:text-5xl">{title}</h1>
          <p className="mt-5 text-sm text-white/70">Effective {effectiveDate}</p>
        </div>
      </div>
      <article className="mx-auto max-w-4xl px-5 py-12 sm:px-8 sm:py-16">
        <div className="rounded-3xl border border-surface-900/10 bg-white px-6 py-8 shadow-[0_20px_70px_rgba(12,29,40,0.08)] sm:px-12 sm:py-12">
          {children}
        </div>
      </article>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-surface-200 py-8 first:border-t-0 first:pt-0">
      <h2 className="font-serif text-2xl font-semibold tracking-tight text-surface-950">{title}</h2>
      <div className="mt-4 space-y-4 text-[15px] leading-7 text-surface-700">{children}</div>
    </section>
  );
}

function LegalList({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc space-y-2 pl-5 marker:text-warning">{children}</ul>;
}

function PrivacyNotice() {
  return (
    <LegalShell title="Privacy Notice">
      <p className="mb-8 rounded-2xl bg-warning/10 px-5 py-4 text-sm leading-6 text-warning">
        Bowin is tournament-management software for martial-arts event organizers. This notice explains how {operator} handles personal information through Bowin.
      </p>
      <Section title="1. Scope and roles">
        <p>Bowin provides registration, check-in, division and bracket administration, schedules, scoring, results, public event displays, and support tools. The tournament organizer remains responsible for its event, eligibility rules, waivers, safety decisions, public-results policy, and the information it directs Bowin to handle. The agreement with an organizer determines the parties' privacy roles for that event.</p>
      </Section>
      <Section title="2. Information we handle">
        <p>Depending on how Bowin is used, we may handle:</p>
        <LegalList>
          <li>Organizer and staff details, including name, email address, role, organization membership, access status, and service activity.</li>
          <li>Competitor and registration details, including name, date of birth, gender category, belt or rank, school or dojang, event selections, check-in status, and registration confirmation details.</li>
          <li>Competition-operational details, including divisions, brackets, schedules, match scores, results, seeding, and audit history.</li>
          <li>Parent or guardian details supplied for a minor, including name, email address, phone number, and guardian attestation.</li>
          <li>Event-specific details an organizer chooses to collect, such as height, weight, accommodation notes, or incident information.</li>
          <li>Support details, including contact information, messages, page context, ticket status, and correspondence needed to respond.</li>
          <li>Security and service details, including limited-life authentication or registration-management tokens, timestamps, rate-limit activity, logs, diagnostics, and security records.</li>
        </LegalList>
        <p>Organizers should collect only the minimum information necessary for a legitimate event purpose and should not use free-text fields for medical diagnoses.</p>
      </Section>
      <Section title="3. Why we use information">
        <p>We use personal information to provide, secure, and operate Bowin; manage registrations, confirmations, brackets, schedules, scores, and results; verify access and prevent abuse; communicate about registrations and support; respond to incidents; and meet applicable legal, accounting, safety, contractual, and record-keeping obligations.</p>
        <p>We do not sell participant personal information or operate an advertising network using participant data. We do not use participant information for unrelated marketing without a separate lawful basis and, where required, a separate choice.</p>
      </Section>
      <Section title="4. AI-assisted support">
        <p>Bowin can be configured with an AI-assisted support provider. When enabled, a support message and the minimum context needed to answer it may be sent to the configured provider to generate a response or help classify an issue. The assistant may also create or escalate a support ticket when requested or when the message indicates a service issue.</p>
        <p>Do not enter passwords, payment-card data, government identifiers, medical diagnoses, or other unnecessary sensitive information into support messages.</p>
      </Section>
      <Section title="5. Children and guardians">
        <p>Bowin is not designed for unsupervised child accounts. When an organizer registers a minor, Bowin requires a parent or guardian to attest that they have authority to register that minor. The organizer is responsible for obtaining any additional guardian authorization, waiver, or separate consent required for its event and jurisdiction.</p>
        <p>Public display of a minor's name, school, schedule, bracket, or result is decided by the organizer under its approved event policy.</p>
      </Section>
      <Section title="6. Who receives information">
        <p>We may disclose personal information only as needed to provide and secure Bowin, including to the relevant organizer and its authorized staff; service providers that host the application, provide database or backup storage, deliver transactional email, support security and diagnostics, or provide configured AI-assisted support; and professional advisers, insurers, authorities, or other parties where required or permitted by law.</p>
        <p>A current subprocessor schedule is available upon request from {contactEmail}.</p>
      </Section>
      <Section title="7. Public tournament information">
        <p>An organizer may choose to publish event information, such as schedules, brackets, or results, through a public event or scoreboard link. The organizer controls whether this feature is enabled and which operational information is displayed. A published link can be disabled or changed, but information copied or captured by others may remain outside Bowin's control.</p>
      </Section>
      <Section title="8. Retention and deletion">
        <p>We keep information only for as long as reasonably necessary for the purposes described in this notice, the organizer's instructions, and applicable law. Retention periods for registrations, event records, guardian contact details, support records, security logs, and backups are managed under our retention schedule.</p>
        <p>Bowin may use a recoverable deletion period for operational records. Permanent deletion and backup expiry are subject to the applicable retention schedule and legal obligations.</p>
      </Section>
      <Section title="9. Security">
        <p>We use administrative, technical, and organizational safeguards appropriate to the sensitivity of the information we handle. These measures include access controls, tenant and role authorization, HTTPS, limited-life tokens, rate limiting, audit records, and restricted production access. No system can guarantee absolute security.</p>
      </Section>
      <Section title="10. Your choices and requests">
        <p>Subject to applicable law, you may ask to access or correct personal information about you, withdraw consent where consent is the applicable basis, or raise a privacy concern. A parent or guardian may make an appropriate request about a minor. We may need to verify identity and authority before acting on a request.</p>
        <p>To make a request, email <a className="font-semibold text-[#9a5a00] underline underline-offset-4" href={`mailto:${contactEmail}`}>{contactEmail}</a> with enough information to identify the relevant event and record.</p>
      </Section>
      <Section title="11. International processing and changes">
        <p>Bowin or its service providers may process information in locations other than the participant's province, state, or country. We use applicable safeguards for those transfers where required. We may update this notice when our practices or legal obligations change. Material changes will receive a new effective date and version.</p>
      </Section>
      <Section title="12. Contact and complaints">
        <p><strong>{operator}</strong><br />95 Ellesmere Road 1006<br />Scarborough, ON M1R 4B7<br />Canada<br /><a className="font-semibold text-[#9a5a00] underline underline-offset-4" href={`mailto:${contactEmail}`}>{contactEmail}</a></p>
      </Section>
    </LegalShell>
  );
}

function TournamentTerms() {
  return (
    <LegalShell title="Tournament Platform Terms">
      <p className="mb-8 rounded-2xl bg-warning/10 px-5 py-4 text-sm leading-6 text-warning">These terms govern an organizer's access to and use of Bowin. They are not a participant waiver or release.</p>
      <Section title="1. Agreement and scope">
        <p>These Tournament Platform Terms govern an organizer's access to and use of Bowin. By creating an organizer account, accepting an order form, or using Bowin for an event, the organizer agrees to these terms on behalf of itself and its authorized users.</p>
        <p>If an order form, pilot agreement, or other signed agreement conflicts with these terms, that signed agreement controls to the extent of the conflict.</p>
      </Section>
      <Section title="2. What Bowin provides">
        <p>Bowin provides tools for tournament registration, check-in, division and bracket administration, schedules, scoring, results, and support. Features may depend on the plan, configuration, and the organizer's approved event setup.</p>
        <p>Bowin is software for tournament administration. It does not provide medical care, emergency services, officiating, legal advice, insurance, event sanctioning, venue security, or a substitute for trained event staff and manual contingency procedures.</p>
      </Section>
      <Section title="3. Organizer responsibilities">
        <LegalList>
          <li>Ensure its event, rules, eligibility requirements, waivers, releases, insurance, sanctions, safety procedures, and communications comply with applicable requirements.</li>
          <li>Obtain participant, parent, guardian, and other authorizations needed for its event.</li>
          <li>Provide accurate information, approve divisions and brackets, and use trained staff to operate the event.</li>
          <li>Maintain secure administrator access, promptly remove former staff, and report suspected unauthorized access.</li>
          <li>Maintain reasonable internet, device, staffing, and manual fallback arrangements for event-day operations.</li>
          <li>Decide whether to make schedules, brackets, scores, results, schools, or other event information publicly available.</li>
        </LegalList>
      </Section>
      <Section title="4. Participant registrations and minors">
        <p>The organizer is responsible for the registration experience, participation waiver, guardian authority, and any required consent for a participant. Bowin records the acknowledgements configured in the service, including acceptance of the privacy notice and tournament rules, and guardian attestation when a minor is registered.</p>
        <p>An organizer must not treat consent for optional publicity, photography, video, livestreaming, or marketing as a condition of tournament administration where applicable law requires a separate choice.</p>
      </Section>
      <Section title="5. Privacy and AI-assisted support">
        <p>The <Link className="font-semibold text-[#9a5a00] underline underline-offset-4" to="/legal/privacy">Bowin Privacy Notice</Link> explains how Bowin handles personal information. The organizer must give participants the required notices and cooperate with verified privacy requests relating to its event.</p>
        <p>Bowin may offer AI-assisted support when configured by an authorized administrator. The assistant can answer operational questions, provide guidance, and assist with issue escalation. It is not a substitute for a qualified official, medical professional, legal adviser, or emergency response. An authorized person must review any eligibility, safety, disciplinary, medical, or other high-impact decision.</p>
      </Section>
      <Section title="6. Availability, changes, and support">
        <p>We use reasonable efforts to operate Bowin, but the service may be unavailable because of maintenance, security work, third-party services, internet failures, or circumstances outside our reasonable control. We may update, modify, or discontinue features where reasonably necessary to maintain security, reliability, legal compliance, or product operation.</p>
        <p>Support channels, support hours, response targets, and event-day coverage are binding only if stated in a signed agreement or order form.</p>
      </Section>
      <Section title="7. Fees, intellectual property, and feedback">
        <p>Fees, taxes, billing schedule, payment terms, cancellations, refunds, and event-specific implementation charges are stated in an approved order form or other signed agreement. Bowin and its licensors retain all rights in the service, software, documentation, branding, and related materials.</p>
        <p>The organizer retains rights in its event content and data. The organizer grants Bowin the limited rights needed to host, process, support, and secure that content. Feedback may be used to improve Bowin without compensation or attribution.</p>
      </Section>
      <Section title="8. Suspension and termination">
        <p>We may suspend or limit access if reasonably necessary to protect the service, participants, other customers, or Bowin; to investigate a suspected breach; or where required by law. Either party may terminate according to the applicable signed agreement. Data return or deletion after termination is handled under the applicable agreement and retention schedule, subject to legal obligations and backup-recovery limits.</p>
      </Section>
      <Section title="9. Disclaimers and liability">
        <p>Except where prohibited by applicable law, Bowin is provided on an "as is" and "as available" basis. We do not guarantee that the service will be uninterrupted, error-free, or suitable for a particular event outcome. The service does not replace the organizer's judgment, safety procedures, or event controls.</p>
        <p>To the maximum extent permitted by applicable law, {operator} will not be liable for indirect, incidental, special, consequential, exemplary, or punitive damages arising from or related to use of Bowin. Nothing in these terms excludes liability that cannot be excluded by law.</p>
      </Section>
      <Section title="10. Governing law and contact">
        <p>These terms are governed by the laws of Ontario and the federal laws of Canada applicable in Ontario, without regard to conflict-of-laws principles, except where applicable law requires otherwise.</p>
        <p><strong>{operator}</strong><br />95 Ellesmere Road 1006<br />Scarborough, ON M1R 4B7<br />Canada<br /><a className="font-semibold text-[#9a5a00] underline underline-offset-4" href={`mailto:${contactEmail}`}>{contactEmail}</a></p>
      </Section>
    </LegalShell>
  );
}

export default function Legal({ kind }: LegalProps) {
  return kind === 'privacy' ? <PrivacyNotice /> : <TournamentTerms />;
}
