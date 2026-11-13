// Keyboard shortcuts of undo/redo. Pure functions on DOM events: no Angular.

export type UndoRedoCommand = 'undo' | 'redo';

/**
 * Command of a key event: Ctrl/Cmd+Z = undo, Ctrl/Cmd+Shift+Z and Ctrl+Y = redo; `null` for
 * other keys and for events in an editable element (form fields keep their own undo).
 */
export function undoRedoCommand(event: KeyboardEvent): UndoRedoCommand | null {
  if (event.altKey || isEditable(event.target)) {
    return null;
  }
  const key = event.key.toLowerCase();
  if (key === 'z' && (event.ctrlKey || event.metaKey)) {
    return event.shiftKey ? 'redo' : 'undo';
  }
  if (key === 'y' && event.ctrlKey && !event.metaKey && !event.shiftKey) {
    return 'redo';
  }
  return null;
}

/** Shortcut texts for the tooltips (macOS symbols on Apple platforms). */
export function undoRedoShortcutLabels(): Record<UndoRedoCommand, string> {
  return isApplePlatform() ? { undo: '⌘Z', redo: '⇧⌘Z' } : { undo: 'Ctrl+Z', redo: 'Ctrl+Shift+Z' };
}

/** True for text inputs, text areas, selects and contenteditable elements. */
function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.matches('input, textarea, select'))
  );
}

function isApplePlatform(): boolean {
  return /Mac|iPhone|iPad/.test(navigator.userAgent);
}
