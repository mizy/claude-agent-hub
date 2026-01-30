/**
 * File-based storage
 * Re-exports from fileStore for backward compatibility
 */

import { getFileStore, resetFileStore, type FileStore } from './fileStore.js'

// Re-export with original names for compatibility
export type Store = FileStore
export const getStore = getFileStore
export const resetStore = resetFileStore
