import { extractText, getDocumentProxy } from 'unpdf'

export async function pdfText(bytes: Uint8Array): Promise<string> {
  // A copy: pdf.js refuses a Node `Buffer` and takes ownership of the memory it is given.
  const document = await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 })
  try {
    const { text } = await extractText(document, { mergePages: true })
    return text
  } finally {
    await document.loadingTask.destroy()
  }
}
