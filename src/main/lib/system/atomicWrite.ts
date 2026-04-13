import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

export async function atomicWrite(targetPath: string, content: string | Uint8Array): Promise<void> {
  const targetDirectory = dirname(targetPath)
  const tempPath = join(
    targetDirectory,
    `.${basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`
  )

  await mkdir(targetDirectory, { recursive: true })
  if (typeof content === 'string') {
    await writeFile(tempPath, content, 'utf8')
  } else {
    await writeFile(tempPath, content)
  }
  try {
    await rename(tempPath, targetPath)
  } catch (err) {
    await rm(tempPath, { force: true })
    throw err
  }
}
