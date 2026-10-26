// Shrink a phone photo before upload: longest side 1600 px, JPEG. Falls back to the original.
export async function shrink(file: File, max = 1600, quality = 0.8): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
    const c = document.createElement('canvas')
    c.width = Math.round(bmp.width * scale)
    c.height = Math.round(bmp.height * scale)
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', quality))
    return blob ?? file
  } catch {
    return file
  }
}
export const uuid = () => crypto.randomUUID()
