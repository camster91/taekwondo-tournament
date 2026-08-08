function classNames(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

type BowinLogoProps = {
  className?: string;
  compact?: boolean;
  inverse?: boolean;
  showDescriptor?: boolean;
};

/** Canonical Bowin identity. Keep all product wordmarks and marks routed here. */
export function BowinLogo({
  className,
  compact = false,
  inverse = false,
  showDescriptor = false,
}: BowinLogoProps) {
  return (
    <span
      className={classNames('inline-flex items-center gap-2.5', className)}
      aria-label={compact ? 'Bowin' : undefined}
    >
      <span
        className={classNames(
          'relative grid shrink-0 place-items-center overflow-hidden rounded-[0.7rem]',
          compact ? 'h-9 w-9' : 'h-10 w-10',
          inverse ? 'bg-white ring-1 ring-white/20' : 'bg-brand-ink ring-1 ring-black/10',
        )}
        aria-hidden="true"
      >
        <svg viewBox="0 0 32 32" className="h-[68%] w-[68%]" fill="none">
          <path
            d="M5.5 7.5 16 24.5 26.5 7.5"
            stroke={inverse ? '#0B1220' : '#FFFFFF'}
            strokeWidth="3.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="16" cy="24.5" r="2.25" fill="#E11D48" />
        </svg>
      </span>

      {!compact && (
        <span className="flex min-w-0 flex-col leading-none">
          <span
            className={classNames(
              'brand-wordmark text-[1.05rem] font-bold tracking-[-0.035em]',
              inverse ? 'text-white' : 'text-brand-ink dark:text-white',
            )}
          >
            bowin
          </span>
          {showDescriptor && (
            <span
              className={classNames(
                'mt-1 text-[0.58rem] font-semibold uppercase tracking-[0.18em]',
                inverse ? 'text-white/50' : 'text-slate-500 dark:text-slate-400',
              )}
            >
              Tournament OS
            </span>
          )}
        </span>
      )}
    </span>
  );
}
