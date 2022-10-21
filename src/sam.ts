export type HeaderDataItem = {
  tag: string
  data: Array<{ tag: string; value: string }>
}

export function parseHeaderText(text: string): HeaderDataItem[] {
  const lines = text.split(/\r?\n/)
  const data: HeaderDataItem[] = []
  lines.forEach(line => {
    const [tag, ...fields] = line.split(/\t/)
    const parsedFields = fields.map(f => {
      const [fieldTag, value] = f.split(':', 2)
      return { tag: fieldTag, value }
    })
    if (tag) {
      data.push({ tag: tag.substr(1), data: parsedFields })
    }
  })
  return data
}
