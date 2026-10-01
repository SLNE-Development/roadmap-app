/** Screen-reader announcement for a card move; a polite live region that is read as a whole. */
export function BoardAnnouncer({ message }: { message: string }) {
  return (
    <div className="sr-only" aria-live="polite" aria-atomic="true">
      {message}
    </div>
  );
}

/** Announcement for a card that moved. */
export function moveMessage(title: string, columnName: string): string {
  return `Moved ${title} to ${columnName}.`;
}

/** Announcement for a card that snapped back, with the server's reason. */
export function refusedMessage(title: string, reason: string): string {
  return `${title} stayed put: ${reason}`;
}
