# Tournament Settings & Configuration

Comprehensive guide to tournament settings and customization.

## Basic Settings

### Tournament Information

- **Name**: Full tournament name (e.g., "2026 Spring Championship")
- **Date**: Tournament date (used for age calculations)
- **Location**: Venue name and address
- **Status**: Draft, Registration Open, In Progress, Completed

### Sport Configuration

Select sport type:
- Taekwondo (default)
- Karate
- Judo
- Jiu-Jitsu
- Kickboxing
- Other martial arts

**Note**: Sport type affects:
- Scoring terminology
- Belt/rank options
- Event type labels (patterns vs. forms vs. kata)

## Registration Settings

### Public Registration

Enable/disable online registration:
- **Registration URL**: Shareable public link
- **QR Code**: Generate poster for venue
- **Deadline**: Auto-close registration at date/time
- **Capacity**: Set maximum competitors

### Registration Fields

Configure required fields:
- Parent/guardian contact (for minors)
- Emergency contact information
- Photo/video release consent
- Special needs accommodations
- T-shirt size (for merchandise)

### Payment Collection

Optional payment integration:
- Set registration fee amount
- Enable Stripe payment processing
- Configure refund policy
- Track payment status

## Division Configuration

### Age Groups

Customize age bands:
- Default: 6-7, 8-9, 10-11, 12-14, 15-17, 18+
- Custom: Define your own ranges
- Flexibility: Allow 3-year gap tolerance for merging

### Weight Classes

Sparring division weight limits:
- **Preset options**: Feather, Light, Middle, Heavy
- **Custom classes**: Define specific pound ranges
- **Gender-specific**: Different classes for male/female
- **Age-specific**: Adjust limits by age group

### Event Types

- **Patterns**: Forms/kata competition
- **Sparring**: Full-contact fighting
- **Both**: Competitor participates in both events

## Bracket Settings

### Default Format

Set default bracket type:
- Double Elimination (recommended 4-16 competitors)
- Single Elimination (17+ competitors)
- Round Robin (3-5 competitors)

### Seeding Strategy

Choose seeding approach:
- **School Spread**: Avoid early school-vs-school (default)
- **Skill Based**: Seed by past performance
- **Balanced**: Mix of experience levels
- **Manual**: Director assigns seeds

### Ring Configuration

- Total number of rings available
- Ring assignments by division
- Concurrent matches allowed
- Rest time between matches

## Scoring Rules

### Match Format

- Number of rounds (default: 2)
- Round duration (default: 2 minutes)
- Overtime rules
- Point system

### Scoring Options

- Track scores by round or total
- Sudden death overtime
- Decision-based scoring
- Penalties and deductions

### Match Timer

Configure built-in timer:
- Round duration
- Break duration
- Overtime duration
- Audio/visual alerts

## Branding & Customization

### Organization Branding

- **Logo**: Upload organization logo (appears on certificates, public pages)
- **Primary Color**: Accent color for public pages
- **Display Name**: "Hosted by [Your Organization]"

**Important**: Public pages show your organization's brand, NOT "Powered by Bowin"

### Public Pages

Customize appearance of:
- Public registration form
- Public scoreboard
- Results page
- QR code posters

### Certificate Settings

- Add signature lines
- Include sponsor logos
- Custom messages
- Template selection

## Public Scoreboard

### Access Control

- **Enable/Disable**: Toggle public access
- **Secure Link**: Generate unique shareable URL
- **Revoke Access**: Regenerate URL to invalidate old link

### Display Options

- Auto-refresh interval (default: 10 seconds)
- TV mode (4K-optimized, dark mode)
- Show/hide match scores
- Competitor search enabled

### QR Code Posters

Generate printable posters with QR codes linking to:
- Public registration
- Public scoreboard
- Results page

## Advanced Settings

### Data Retention

- Soft delete vs. hard delete tournaments
- Archive old tournaments
- Competitor data retention
- Export data before deletion

### Notification Preferences

- Email confirmations (registration, results)
- SMS notifications (optional)
- In-app notifications
- Director alerts (division delays, errors)

### API Access

For custom integrations:
- Generate API keys
- Configure webhooks
- Access tournament data programmatically

## Import/Export

### Import Options

- Competitor CSV/Excel
- Tournament templates
- Historical data migration

### Export Options

- Complete tournament data (Excel)
- Results (CSV, PDF)
- Brackets (PDF)
- Statistics reports

## Security & Access

### Tournament Access Control

Restrict who can view/edit:
- Private vs. organization-visible
- Team member permissions
- Public visibility settings

### Audit Log

Track all changes:
- Who made changes
- What was changed
- When it happened
- Revert capability (for eligible changes)

## Tournament Templates

### Saving Templates

Save settings as template for future events:
1. Configure all settings
2. Click **Save as Template**
3. Name your template
4. Use for next tournament

### Template Includes

- Division configuration
- Weight classes
- Scoring rules
- Registration fields
- Branding settings

## Best Practices

- **Configure early**: Finalize settings 2 weeks before tournament
- **Test public links**: Verify registration and scoreboard before sharing
- **Backup plan**: Export and print critical data as fallback
- **Review rules**: Walk through scoring rules with staff before event
- **Update branding**: Keep logo and colors current

## Troubleshooting

**"Settings not saving"**: Check for validation errors, ensure required fields are filled

**"Public link not working"**: Verify tournament status allows public access

**"Weight classes not appearing"**: Ensure weight classes are configured for correct gender/age

**"Certificate missing logo"**: Upload organization logo in branding settings
