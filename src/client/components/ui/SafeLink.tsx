import { forwardRef } from 'react';
import { Link, type LinkProps } from 'react-router-dom';

/**
 * react-router-dom's <Link> does not auto-add `rel="noopener noreferrer"` when
 * `target="_blank"`. Forgetting those attributes leaves the new tab with a
 * `window.opener` reference back to the app, which is the textbook
 * reverse-tabnabbing setup. This wrapper injects the safe defaults whenever
 * `target="_blank"` is set, while still allowing callers to override `rel`
 * explicitly when they have a reason to.
 */
const SafeLink = forwardRef<HTMLAnchorElement, LinkProps>(function SafeLink(
  { target, rel, ...rest },
  ref,
) {
  const isExternal = target === '_blank';
  const safeRel = isExternal
    ? (rel ?? 'noopener noreferrer')
    : rel;
  return (
    <Link
      ref={ref}
      target={target}
      rel={safeRel}
      {...rest}
    />
  );
});

export default SafeLink;
