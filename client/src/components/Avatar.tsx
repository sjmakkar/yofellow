const COLORS = ["#0f766e", "#b45309", "#7c3aed", "#be123c", "#1d4ed8", "#15803d", "#a16207"];

export default function Avatar({ name, size = 44 }: { name: string; size?: number }) {
  const color = COLORS[(name.charCodeAt(0) + name.length) % COLORS.length];
  return (
    <div className="avatar" style={{ width: size, height: size, background: color, fontSize: size * 0.42 }}>
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}
