# Bowin privacy notice — operator/counsel draft

**DO NOT PUBLISH AS-IS.** This is a product-specific issue list and drafting baseline, not legal advice. The legal operator and qualified counsel must complete every bracketed field, select the lawful bases and jurisdictions, approve retention periods, and publish a versioned notice before real participant data is collected.

**Effective date:** [DATE]

**Controller/operator:** [LEGAL NAME AND ADDRESS]

**Privacy contact:** [EMAIL AND POSTAL CONTACT]

**Applicable jurisdiction(s):** [PROVINCE/STATE/COUNTRY]

## Scope and roles

Bowin helps tournament organizers register participants and operate Taekwondo events. The agreement must state when [OPERATOR] acts as a service provider/processor for an organizer and when either party acts as a controller. The organizer remains responsible for the legitimacy of the event, its rules, participant eligibility, safety decisions, notices, and consent unless the signed agreement states otherwise.

## Information handled

- Organizer and staff account information: name, email, role, organization membership, access status, and login timestamps.
- Competitor information: first/last name, date of birth, gender category, belt/rank, school, region, height, weight, reach, training/experience attributes, event selections, seeding, check-in status, and tournament history.
- Parent/guardian information: name, email, and phone.
- Potentially sensitive information: accommodation/special-needs notes, checked weight, and incident descriptions/actions.
- Tournament operations: divisions, schedules, brackets, match scores, results, audit events, public-display settings, and reports.
- Security and service information: hashed authentication/registration-management tokens, failed sign-in attempts, timestamps, IP-derived rate-limit activity, logs, diagnostics, and support communications.

Bowin must not request free-form medical diagnoses. Organizers should enter only the minimum operational accommodation or incident information they are authorized to record.

## Purposes and legal bases

Counsel must map each purpose to the applicable lawful basis: providing the contracted tournament service; authenticating users; operating registration, check-in, brackets and results; protecting account and tenant security; communicating service messages; responding to incidents/support; meeting organizer/legal obligations; and improving reliability using appropriately minimized diagnostics.

Bowin does not currently provide an advertising network, sell participant data, or use competitor data to train public AI models. Any future analytics, marketing, automated decision-making, or model training requires a new reviewed disclosure and, where required, consent.

## Sharing and subprocessors

Complete and publish the actual subprocessor table before launch:

| Provider | Purpose | Processing location | Data involved | Contract/DPA verified |
|---|---|---|---|---|
| [HOST/COOLIFY INFRASTRUCTURE PROVIDER] | Application hosting | [LOCATION] | Application and operational data | [YES/NO] |
| [POSTGRESQL/BACKUP PROVIDER] | Database and backup storage | [LOCATION] | Stored service data | [YES/NO] |
| Mailgun | Transactional email | [LOCATION] | Recipient, subject/content, delivery metadata | [YES/NO] |
| [ERROR/LOG MONITORING PROVIDER] | Reliability and security diagnostics | [LOCATION] | Minimized logs/errors | [YES/NO] |
| [PAYMENT PROVIDER, IF ADDED] | Payment processing | [LOCATION] | Billing/payment metadata | [YES/NO] |

Do not send special-needs notes, dates of birth, weights, incident narratives, session tokens, management tokens, or secrets to general-purpose logs/error monitoring.

## Public information

An organizer can enable a tokenized public scoreboard. The published fields and audience must be disclosed and approved. Rotating or disabling the link revokes access through the prior link, but recipients may have copied or photographed information already displayed.

## Retention and deletion

The approved schedule in `docs/legal/RETENTION-SCHEDULE-DRAFT.md` must replace placeholders here. Soft-deleted operational records are recoverable only during the configured window. Automatic permanent purge is disabled unless the production operator explicitly enables it. Backups may retain deleted records until their separately defined expiry and must not be restored except for recovery; deletions must be re-applied after restoration where required.

The notice must explain access, correction, deletion, restriction/objection, portability, consent withdrawal, complaint, and guardian requests available in each jurisdiction, how identity is verified, expected response times, and lawful retention exceptions.

## Security and incidents

Describe safeguards factually: role and tenant authorization, HTTPS, hashed limited-life tokens, HttpOnly sessions, CSRF protection, rate limits, encrypted backups [ONLY WHEN VERIFIED], restricted production access, audit records, monitoring, and incident response. Do not promise absolute security. Publish the incident contact and jurisdiction-specific breach-notification process.

## Children and guardians

The service is not designed for unsupervised child accounts. The organizer must identify when guardian authorization is required, present the approved notice/consent before collection, and provide a process for guardian requests. Counsel must define the applicable age threshold and whether public display of a minor's name, school, bracket, result, or schedule requires separate consent.

## International transfers and changes

Identify processing countries and the transfer mechanism required by each launch jurisdiction. Material changes require a new effective date and, where required, renewed notice or consent. Retain prior versions and the acceptance evidence tied to each registration.
