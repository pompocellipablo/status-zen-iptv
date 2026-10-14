// SAFETY: This file exists only on the isolated migration test branch.
// Never merge this test-only switch into the Lovable production main branch.
// A hosted preview must remain read-only even if env variables are missing.
export const IS_ISOLATED_READ_ONLY_PREVIEW = true;
