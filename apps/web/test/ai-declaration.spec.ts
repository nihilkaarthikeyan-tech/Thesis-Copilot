/**
 * The AI declaration the "/" menu inserts. What is pinned is the shape the editor needs (a
 * level-2 heading — H1 is the chapter's — then plain paragraphs) and that the statement keeps to
 * what the product actually does and tells the student to make it theirs.
 */
import { describe, expect, it } from 'vitest';
import {
  AI_DECLARATION_HEADING,
  AI_DECLARATION_NOTE,
  aiDeclarationContent,
} from '../src/lib/ai-declaration';

describe('aiDeclarationContent', () => {
  const content = aiDeclarationContent();
  const text = content
    .flatMap((node) => node.content ?? [])
    .map((child) => child.text ?? '')
    .join('\n');

  it('is a level-2 heading followed by paragraphs', () => {
    expect(content[0]).toMatchObject({ type: 'heading', attrs: { level: 2 } });
    expect(content[0]?.content?.[0]?.text).toBe(AI_DECLARATION_HEADING);
    expect(content.slice(1).every((node) => node.type === 'paragraph')).toBe(true);
  });

  it('says what the tool did, that the author decided, and who is responsible', () => {
    expect(text).toContain('Thesis Copilot');
    expect(text).toContain('my own library');
    expect(text).toContain('accepted, edited or rejected');
    expect(text).toContain('full responsibility');
  });

  it('ends with a note telling the student to edit it to their use and their policy', () => {
    expect(content.at(-1)?.content?.[0]?.text).toBe(AI_DECLARATION_NOTE);
    expect(AI_DECLARATION_NOTE).toContain("university's policy");
  });
});
