// Public identifier, not a credential. Database RLS enforces this restriction.
// Revalidate this UUID when migrating authentication to another project.
export const PANEL_OWNER_ID = "c70b3e1f-e5d2-4caf-ae09-019964dbf30e";
export function isPanelOwner(id: string | undefined): boolean {
  return id === PANEL_OWNER_ID;
}
