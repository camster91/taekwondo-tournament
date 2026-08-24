import { useEffect } from 'react';
import {
  ArrowRight,
  Bot,
  Check,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  Network,
  Radio,
  ShieldCheck,
  Sparkles,
  Trophy,
  UserRoundCheck,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import './Marketing.css';

const workflow = [
  { number: '01', title: 'Collect', body: 'Public registration feeds the event workspace instead of a separate spreadsheet.', icon: UserRoundCheck },
  { number: '02', title: 'Organize', body: 'Build divisions and draws from the same operational control room.', icon: Network },
  { number: '03', title: 'Operate', body: 'Coordinate rings, assignments, and event-day changes as the tournament moves.', icon: Radio },
  { number: '04', title: 'Close', body: 'Publish results and preserve a usable event record after the final match.', icon: ClipboardCheck },
] as const;

const audiences = [
  { title: 'Organizer', body: 'Plan the event, monitor readiness, and resolve operational exceptions.', accent: 'rose' },
  { title: 'Official', body: 'Access the information needed for assigned event work without chasing updates.', accent: 'gold' },
  { title: 'Participant', body: 'Register through a public flow and follow the information shared for the event.', accent: 'blue' },
] as const;

const faqs = [
  { question: 'Who is Bowin for?', answer: 'Bowin is designed for martial arts tournament organizers and the people who support registration, operations, officiating, and participant communication.' },
  { question: 'Does the AI make changes automatically?', answer: 'Only organization-approved integrations can perform supported actions. The assistant explains, gathers context, and escalates when human review is appropriate.' },
  { question: 'Can participants register publicly?', answer: 'Yes. Bowin includes a public participant registration flow connected to the tournament workspace.' },
  { question: 'Where do we start?', answer: 'Open Bowin to review the product flow, or use the support assistant if you need help evaluating fit or setup.' },
] as const;

function useMarketingSeo() {
  useEffect(() => {
    const title = 'Bowin | Martial Arts Tournament Management Software';
    const description = 'Run martial arts tournament registration, divisions, brackets, rings, results, and event support in one operational workspace.';
    const canonicalUrl = 'https://tkd.ashbi.ca/';
    const previousTitle = document.title;
    const upsertMeta = (selector: string, attributes: Record<string, string>) => {
      let element = document.head.querySelector<HTMLMetaElement>(selector);
      const created = !element;
      if (!element) {
        element = document.createElement('meta');
        document.head.appendChild(element);
      }
      Object.entries(attributes).forEach(([name, value]) => element?.setAttribute(name, value));
      return { element, created };
    };

    document.title = title;
    const managedMeta = [
      upsertMeta('meta[name="description"]', { name: 'description', content: description }),
      upsertMeta('meta[property="og:title"]', { property: 'og:title', content: title }),
      upsertMeta('meta[property="og:description"]', { property: 'og:description', content: description }),
      upsertMeta('meta[property="og:url"]', { property: 'og:url', content: canonicalUrl }),
      upsertMeta('meta[name="twitter:title"]', { name: 'twitter:title', content: title }),
      upsertMeta('meta[name="twitter:description"]', { name: 'twitter:description', content: description }),
    ];
    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    const canonicalCreated = !canonical;
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.appendChild(canonical);
    }
    canonical.href = canonicalUrl;

    const structuredData = document.createElement('script');
    structuredData.type = 'application/ld+json';
    structuredData.dataset.bowinMarketing = 'true';
    structuredData.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'Bowin',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      url: canonicalUrl,
      description,
      featureList: ['Public participant registration', 'Tournament divisions and brackets', 'Ring and event operations', 'Results and reporting', 'AI-assisted support with escalation'],
    });
    document.head.appendChild(structuredData);

    return () => {
      document.title = previousTitle;
      managedMeta.forEach(({ element, created }) => created && element.remove());
      if (canonicalCreated) canonical?.remove();
      structuredData.remove();
    };
  }, []);
}

export default function Marketing() {
  useMarketingSeo();
  return (
    <div className="bowin-marketing">
      <a className="bowin-skip-link" href="#main-content">Skip to main content</a>
      <header className="bowin-header">
        <Link className="bowin-brand" to="/" aria-label="Bowin home"><span className="bowin-brand-mark" aria-hidden="true" /><span>BOWIN</span></Link>
        <nav className="bowin-nav" aria-label="Marketing navigation">
          <a href="#workflow">How it works</a><a href="#audiences">For organizers</a><a href="#support">AI support</a>
        </nav>
        <details className="bowin-mobile-nav">
          <summary><span>Explore</span><span aria-hidden="true">+</span></summary>
          <nav aria-label="Mobile marketing navigation">
            <a href="#workflow">How it works</a>
            <a href="#audiences">For organizers</a>
            <a href="#support">AI support</a>
            <a href="#product">Product screens</a>
          </nav>
        </details>
        <Link className="bowin-button bowin-button-dark bowin-button-compact" to="/login">Sign in</Link>
      </header>

      <main id="main-content">
        <section className="bowin-hero" aria-labelledby="bowin-hero-title">
          <div className="bowin-hero-copy bowin-reveal">
            <p className="bowin-eyebrow">Tournament operations, one control room</p>
            <h1 id="bowin-hero-title">Run the tournament.<span>Not the spreadsheet.</span></h1>
            <p className="bowin-hero-lede">Bowin connects registration, brackets, rings, results, and event-day support in one operational flow built for martial arts tournaments.</p>
            <div className="bowin-actions" aria-label="Get started">
              <a className="bowin-button bowin-button-primary" href="mailto:support@ashbi.ca?subject=Bowin%20organizer%20setup">Plan organizer setup <ArrowRight aria-hidden="true" /></a>
              <a className="bowin-button bowin-button-light" href="#workflow">See the workflow</a>
            </div>
            <ul className="bowin-proof-list" aria-label="Product capabilities">
              <li><Check aria-hidden="true" /> Public registration</li><li><Check aria-hidden="true" /> Event operations</li><li><Check aria-hidden="true" /> Results and reporting</li>
            </ul>
          </div>
          <div className="bowin-product-preview bowin-reveal bowin-reveal-delay" aria-label="Sample Bowin event workspace">
            <div className="bowin-preview-topline"><span>Sample event workspace</span><span className="bowin-preview-status"><i aria-hidden="true" /> Operational view</span></div>
            <h2>Everything that moves an event forward</h2>
            <ol className="bowin-preview-steps">
              {['Registration intake', 'Divisions and draws', 'Ring operations', 'Results and reporting'].map((label, index) => (
                <li key={label} className={index === 3 ? 'is-current' : ''}><span>{String(index + 1).padStart(2, '0')}</span><strong>{label}</strong></li>
              ))}
            </ol>
            <p className="bowin-sample-note">Illustrative interface, not live event data.</p>
          </div>
        </section>

        <section className="bowin-flow-section" id="workflow" aria-labelledby="workflow-title">
          <p className="bowin-section-kicker">One event, one source of truth</p>
          <div className="bowin-section-heading"><h2 id="workflow-title">From registration open to final result.</h2><p>Keep every handoff visible so the event team knows what needs attention next.</p></div>
          <ol className="bowin-workflow-grid">
            {workflow.map(({ number, title, body, icon: Icon }) => (
              <li key={number}><div className="bowin-workflow-card-top"><span>{number}</span><Icon aria-hidden="true" /></div><h3>{title}</h3><p>{body}</p></li>
            ))}
          </ol>
        </section>

        <section className="bowin-audiences" id="audiences" aria-labelledby="audiences-title">
          <p className="bowin-section-kicker">The same event, the right view</p><h2 id="audiences-title">One platform. Clear responsibilities.</h2>
          <div className="bowin-audience-grid">{audiences.map((audience) => <article key={audience.title} className={`bowin-audience-card bowin-accent-${audience.accent}`}><span aria-hidden="true" /><h3>{audience.title}</h3><p>{audience.body}</p></article>)}</div>
        </section>

        <section className="bowin-support-section" id="support" aria-labelledby="support-title">
          <div className="bowin-support-copy">
            <p className="bowin-section-kicker">Support that knows when to escalate</p><h2 id="support-title">Help at the point of confusion.</h2>
            <p>The support assistant can answer product questions, gather context, and route a clear problem report. Organization-approved API connections can be used only where an administrator enables them.</p>
            <ul><li><CircleHelp aria-hidden="true" /> Explain the next step</li><li><ClipboardCheck aria-hidden="true" /> Collect reproducible issue details</li><li><ShieldCheck aria-hidden="true" /> Escalate when human review is needed</li></ul>
          </div>
          <div className="bowin-chat-preview" aria-label="Example support conversation">
            <div className="bowin-chat-header"><span><Bot aria-hidden="true" /></span><div><strong>Bowin support</strong><small>AI assistance with human escalation</small></div></div>
            <p className="bowin-chat-user">A registration is not appearing in the event workspace. What should I check?</p>
            <div className="bowin-chat-response"><Sparkles aria-hidden="true" /><p>First, confirm the participant completed the public registration flow and note the event name. If the record is still missing, I can help prepare a support report.</p></div>
            <div className="bowin-chat-input" aria-hidden="true"><span>Ask about this event...</span><ArrowRight /></div>
          </div>
        </section>

        <section className="bowin-decision" aria-labelledby="decision-title">
          <div><p className="bowin-section-kicker">A practical first step</p><h2 id="decision-title">Evaluate Bowin with a real workflow.</h2></div>
          <div className="bowin-decision-actions"><a className="bowin-button bowin-button-primary" href="mailto:support@ashbi.ca?subject=Bowin%20organizer%20setup">Plan organizer setup <ArrowRight aria-hidden="true" /></a><a className="bowin-text-link" href="#product">See product screens <ChevronRight aria-hidden="true" /></a></div>
        </section>

        <section className="bowin-faq" aria-labelledby="faq-title">
          <div className="bowin-faq-intro"><p className="bowin-section-kicker">Before you move an event</p><h2 id="faq-title">Questions worth answering early.</h2></div>
          <div className="bowin-faq-list">{faqs.map((faq) => <details key={faq.question}><summary><span>{faq.question}</span><span aria-hidden="true">+</span></summary><p>{faq.answer}</p></details>)}</div>
        </section>

        <section className="bowin-final-cta" aria-labelledby="final-cta-title"><div><Trophy aria-hidden="true" /><h2 id="final-cta-title">Ready to replace event-day guesswork?</h2></div><a className="bowin-button bowin-button-white" href="mailto:support@ashbi.ca?subject=Bowin%20organizer%20setup">Plan organizer setup <ArrowRight aria-hidden="true" /></a></section>
      </main>

      <section className="bowin-product-gallery" id="product" aria-labelledby="product-gallery-title">
        <div className="bowin-section-kicker">Inside the control room</div>
        <div className="bowin-product-gallery__intro">
          <h2 id="product-gallery-title">See the whole tournament, not another disconnected tool.</h2>
          <p>Real Bowin screens shown with synthetic sample data. Move from the event overview into registration, divisions, brackets, and support without losing operational context.</p>
        </div>
        <div className="bowin-product-gallery__grid">
          <figure className="bowin-product-shot bowin-product-shot--wide">
            <div className="bowin-product-shot__frame">
              <img src="/brand-kit/sample-organizer-dashboard.png" alt="Sample Bowin organizer dashboard showing synthetic tournament data" loading="lazy" />
            </div>
            <figcaption><span>01</span> Organizer overview <em>Sample data</em></figcaption>
          </figure>
          <figure className="bowin-product-shot">
            <div className="bowin-product-shot__frame">
              <img src="/brand-kit/sample-tournament-operations.png" alt="Sample Bowin tournament operations screen using synthetic records" loading="lazy" />
            </div>
            <figcaption><span>02</span> Tournament operations <em>Sample data</em></figcaption>
          </figure>
          <figure className="bowin-product-shot bowin-product-shot--lifted">
            <div className="bowin-product-shot__frame">
              <img src="/brand-kit/sample-divisions-brackets.png" alt="Sample Bowin division and bracket screen using synthetic competitors" loading="lazy" />
            </div>
            <figcaption><span>03</span> Divisions and brackets <em>Sample data</em></figcaption>
          </figure>
        </div>
      </section>

      <footer className="bowin-footer">
        <Link className="bowin-brand bowin-brand-inverse" to="/" aria-label="Bowin home"><span className="bowin-brand-mark" aria-hidden="true" /><span>BOWIN</span></Link>
        <p>Tournament operations for martial arts events.</p>
        <nav aria-label="Footer navigation"><Link to="/register">Public registration</Link><a href="#support">Support</a><Link to="/login">Sign in</Link></nav>
      </footer>
    </div>
  );
}
