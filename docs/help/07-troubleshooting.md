# Troubleshooting Guide

Common issues and solutions.

## Login & Access

### Cannot Sign In

**Issue**: Magic link email not received

**Solutions**:
1. Check spam/junk folder
2. Verify email address is correct
3. Request a new magic link
4. Wait 10 minutes before retrying

**Issue**: "Account is disabled"

**Solutions**:
- Contact your organization admin
- Account may be temporarily deactivated

### Permission Errors

**Issue**: "You don't have access to this tournament"

**Solutions**:
- Verify you're a member of the correct organization
- Ask admin to grant you tournament access
- Check your role (viewer, scorekeeper, director, admin)

## Competitor Import

### Import Fails

**Issue**: "Invalid date format"

**Solution**: Dates must be YYYY-MM-DD (e.g., 2015-03-20)

**Issue**: "Required field missing"

**Solution**: Ensure First Name, Last Name, Date of Birth, Gender, and Belt are filled for all rows

**Issue**: Excel file won't upload

**Solutions**:
- Save as .xlsx format (not .xls)
- Remove empty rows at bottom
- Check file size is under 10MB
- Try CSV format instead

## Division Generation

### Auto-Generate Errors

**Issue**: "Not enough competitors"

**Solution**: Need at least 2 registered competitors to generate divisions

**Issue**: "Too many small divisions"

**Solutions**:
- Adjust age range settings
- Enable cross-age grouping
- Manually merge divisions after generation

**Issue**: Competitor appears in wrong division

**Solutions**:
- Verify competitor's age, belt, weight are correct
- Move competitor manually to correct division
- Regenerate divisions if data was wrong

## Brackets

### Generation Issues

**Issue**: "Cannot generate bracket"

**Solutions**:
- Ensure division has at least 2 competitors
- Verify all competitors are checked in
- Check for duplicate competitor assignments

**Issue**: Bracket looks unbalanced

**Solutions**:
- Use bracket editor to swap competitors
- Regenerate with different seeding strategy
- Manually adjust after generation

### Match Progression

**Issue**: "Winner didn't advance"

**Solutions**:
- Refresh the page
- Check if match was properly completed
- Verify winner was correctly selected
- Contact support if issue persists

**Issue**: "Downstream match populated incorrectly"

**Solutions**:
- Use undo feature (Ctrl+Z within 5 minutes)
- Reset bracket and re-score affected matches
- Report bug if pattern repeats

## Day-of Operations

### Scorekeeper Issues

**Issue**: Match list is empty

**Solutions**:
- Select correct division from dropdown
- Verify brackets are generated for division
- Check filter settings (show all matches)

**Issue**: Cannot record result

**Solutions**:
- Verify you have scorekeeper role or higher
- Check match status is "Ready" or "In Progress"
- Ensure winner selection is valid

**Issue**: Scores not saving

**Solutions**:
- Check internet connection
- Offline mode will queue changes
- Verify you clicked "Submit"
- Check for error messages

### Public Scoreboard

**Issue**: Scoreboard not updating

**Solutions**:
- Refresh the page (auto-refresh every 10s)
- Verify public link is still valid
- Check tournament hasn't been deleted

**Issue**: Competitor can't find their name

**Solutions**:
- Use search function
- Check spelling of name
- Verify they're registered and checked in

## Network & Performance

### Slow Performance

**Solutions**:
- Clear browser cache
- Close unused tabs
- Use latest Chrome, Firefox, or Safari
- Check internet speed (minimum 5 Mbps recommended)

### Offline Mode

**Issue**: Working offline, need to sync

**Solution**: 
- Reconnect to internet
- System will auto-sync queued changes
- Check for sync indicator in UI

**Issue**: Offline changes lost

**Solutions**:
- Don't close browser tab while offline
- Don't clear browser data while offline
- Verify changes appear after reconnect

## Data & Export

### Missing Results

**Issue**: Results disappeared

**Solutions**:
- Check tournament hasn't been soft-deleted
- Verify correct tournament is selected
- Check if accidental undo was performed
- Contact support for data recovery

### Export Fails

**Issue**: PDF download doesn't work

**Solutions**:
- Allow pop-ups for this site
- Try different browser
- Check available disk space
- Use CSV export as alternative

## Support Escalation

If issue persists after troubleshooting:

1. **Document the issue**:
   - What were you trying to do?
   - What happened instead?
   - Any error messages?
   - Screenshots if applicable

2. **Check status page**: System-wide issues are reported at status.bowin.io

3. **Contact support**:
   - Email: support@bowin.io
   - Include tournament ID and timestamp
   - Describe steps to reproduce

4. **Emergency support** (tournament day only):
   - Use phone number provided in pre-event email
   - Have tournament details ready
