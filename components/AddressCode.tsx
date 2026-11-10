export function AddressCode({
  value,
  prefix = 0,
  suffix = 0,
}: {
  value: string;
  prefix?: number;
  suffix?: number;
}) {
  const hex = /^0x/i.test(value);
  const head = hex ? value.slice(0, 2) : "";
  const body = hex ? value.slice(2) : value;
  if (prefix < 1 && suffix < 1) {
    return <code className="addr">{value}</code>;
  }
  const p = Math.min(prefix, body.length);
  const s = Math.min(suffix, Math.max(0, body.length - p));
  const midEnd = body.length - s;
  return (
    <code className="addr">
      {head}
      <span className="same">{body.slice(0, p)}</span>
      <span className="diff">{body.slice(p, midEnd)}</span>
      <span className="same">{body.slice(midEnd)}</span>
    </code>
  );
}
