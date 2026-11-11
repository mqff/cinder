import { HugeiconsIcon } from "@hugeicons/react";
import { ICON, type IconKey } from "@/lib/icons";

export function Glyph({ name, size = 16 }: { name: IconKey; size?: number }) {
  return <HugeiconsIcon icon={ICON[name]} size={size} strokeWidth={1.6} />;
}
