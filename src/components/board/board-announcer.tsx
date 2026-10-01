/** Screen-reader announcement for a card move; a polite live region that is read as a whole. */
export function BoardAnnouncer({ message }: { message: string }) {
  return (
    <div className="sr-only" aria-live="polite" aria-atomic="true">
      {message}
    </div>
  );
}
