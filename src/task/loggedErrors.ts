/** WeakSet to track errors that have already been logged, replacing the unsafe `(error as any)._logged` pattern */
export const loggedErrors = new WeakSet<Error>()
