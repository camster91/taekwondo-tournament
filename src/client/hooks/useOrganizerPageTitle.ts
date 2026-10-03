import { useEffect } from 'react';

/**
 * On a white-label plan the browser tab shows only the organizer's name,
 * not the default "Bowin | ..." title. Other plans keep the default title.
 */
export function useOrganizerPageTitle(title: string | null | undefined, hidePlatformBranding: boolean | undefined) {
  useEffect(() => {
    if (!hidePlatformBranding || !title) return;
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title, hidePlatformBranding]);
}
