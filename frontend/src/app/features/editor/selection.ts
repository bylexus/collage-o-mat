// Selected element of the editor. Pure types and helpers: no Angular, no DOM.

/** The selected element on the canvas: one photo, one text, or nothing (`null`). */
export type EditorSelection = { kind: 'photo'; id: number } | { kind: 'text'; id: string } | null;

/** True if both selections name the same element (or both are empty). */
export function sameSelection(a: EditorSelection, b: EditorSelection): boolean {
  return a === b || (a !== null && b !== null && a.kind === b.kind && a.id === b.id);
}

/** Id of the selected photo, or `null` if no photo is selected. */
export function selectedPhotoIdOf(selection: EditorSelection): number | null {
  return selection?.kind === 'photo' ? selection.id : null;
}

/** Id of the selected text, or `null` if no text is selected. */
export function selectedTextIdOf(selection: EditorSelection): string | null {
  return selection?.kind === 'text' ? selection.id : null;
}
