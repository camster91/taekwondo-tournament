# Bowin Legal Publication Approval Checklist

This checklist is the gate between the approval drafts and public registration. Do not publish the drafts or change production legal URLs until every item below has an owner and approval.

## Required document inputs

- [ ] Legal operator name, postal address, privacy contact, and legal/support contact.
- [ ] Effective date and immutable consent version for both pages.
- [ ] Launch jurisdictions and counsel-approved governing law, venue, consumer terms, liability allocation, and insurance position.
- [ ] Signed organizer agreement or pilot terms defining privacy roles, event responsibilities, fees, support coverage, termination, and data return or deletion.
- [ ] Organizer-approved participant waiver, guardian authorization, optional publicity consent, and event rules.

## Required privacy evidence

- [ ] Verified subprocessor schedule with each provider, purpose, processing location, data categories, contract/DPA status, and transfer safeguard where required.
- [ ] Approved retention schedule for registrations, guardian contact details, sensitive event fields, support records, logs, backups, billing records, and deletion recovery.
- [ ] Verified incident-response owner, privacy request process, identity-verification process, and jurisdiction-specific response timelines.
- [ ] Confirmed AI-support provider configuration, data-use terms, processing location, and the exact categories allowed in support prompts.
- [ ] Confirmed public-scoreboard fields and the organizer's policy for minors.

## Required product release work after approval

- [ ] Convert the approved notices into versioned public pages served over HTTPS on `tkd.ashbi.ca`.
- [ ] Update `REGISTRATION_CONSENT_VERSION`, `PRIVACY_NOTICE_URL`, and `TOURNAMENT_TERMS_URL` to the approved production URLs.
- [ ] Replace the current staging legal URLs and fabricated consent version in production.
- [ ] Capture the approved document versions and acceptance timestamp in every registration flow.
- [ ] Validate the public registration flow, guardian path, legal links, production headers, and rollback before launch.
