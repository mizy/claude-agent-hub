/**
 * MemScene file store
 *
 * Uses FileStore in file mode: each MemScene is a JSON file keyed by domain.
 */

import { FileStore } from './GenericFileStore.js'
import { MEMSCENE_DIR } from './paths.js'
import type { MemScene } from '../memory/types.js'

const memSceneStore = new FileStore<MemScene>({
  dir: MEMSCENE_DIR,
  mode: 'file',
  ext: '.json',
})

export function saveMemScene(scene: MemScene): void {
  memSceneStore.setSync(scene.domain, scene)
}

export function getMemScene(domain: string): MemScene | null {
  return memSceneStore.getSync(domain)
}

export function getAllMemScenes(): MemScene[] {
  return memSceneStore.getAllSync()
}

