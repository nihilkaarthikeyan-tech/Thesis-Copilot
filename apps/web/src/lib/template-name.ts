/**
 * What a university template is called on screen. The seeded example's stored name is a code
 * ("EXAMPLE_IN_UNIVERSITY"), which the export dialog printed as it was (QA 2026-10-09).
 */
export function templateName(template: { name: string; isExample?: boolean }): string {
  if (template.isExample) return 'Example university template';
  return template.name;
}
