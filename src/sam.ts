export function parseHeaderText(text: string) {
  return text
    .split(/\r?\n/)
    .map(line => line.split('\t'))
    .filter(f => !!f[0])
    .map(([tag, ...fields]) => ({
      tag: tag.slice(1),
      data: fields.map(f => {
        const [fieldTag, value] = f.split(':', 2)
        return { tag: fieldTag, value }
      }),
    }))
}
