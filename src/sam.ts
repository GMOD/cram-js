export function parseHeaderText(text: string) {
  return text.split(/\r?\n/).map(line => {
    const [tag, ...fields] = line.split(/\t/)
    return {
      tag: tag.slice(1),
      data: fields.map(f => {
        const [fieldTag, value] = f.split(':', 2)
        return { tag: fieldTag, value }
      }),
    }
  })
}
