import { ulid } from 'ulid';

/** Slide identifiers are stable handles for the editor; they never reach the HTML. */
export function newSlideId(): string {
  return ulid();
}

/**
 * Identifier stamped onto every element when a slide is loaded into the edit
 * stage. Commands address elements by uid rather than by DOM node so they keep
 * resolving after an undo or a reload (docs/adr/0003-all-edits-as-commands.md).
 */
export const UID_ATTRIBUTE = 'data-hse-uid';

let uidCounter = 0;

export function newElementUid(): string {
  uidCounter += 1;
  return `e${uidCounter.toString(36)}`;
}
