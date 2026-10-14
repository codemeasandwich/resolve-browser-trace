/** @jsx h */
declare function h(tag: string, props: unknown, ...children: unknown[]): unknown

interface RowProps {
  label: string
}

function Row(props: RowProps) {
  if (props.label === '') {
    throw new Error('row label is blank')
  }
  return <li>{props.label}</li>
}

export function CartView(props: { labels: string[] }) {
  return <ul>{props.labels.map((label) => Row({ label }))}</ul>
}
