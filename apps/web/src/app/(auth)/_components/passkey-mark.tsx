/**
 * `(auth)/_components/passkey-mark` — the passkey brand glyph for the auth screens.
 *
 * @remarks
 * A small, self-contained fingerprint mark used as the hero accent on the sign-in/sign-up
 * cards. The shared `@docket/ui/icons` barrel curates only the app-shell glyph set and does
 * not (yet) export a fingerprint, and `@mui/icons-material` is not a direct dependency of the
 * web app — so this auth-local SVG keeps the passkey-first identity visually first-class
 * without reaching across package boundaries. It is purely decorative: marked `aria-hidden`,
 * it carries no semantic meaning that a screen reader needs (the surrounding copy does).
 */
import type { JSX, SVGProps } from 'react';

/**
 * A decorative fingerprint glyph sized to the current font (`1em`) by default.
 *
 * @param props - Standard SVG props (e.g. `className` for Tailwind sizing/color).
 */
export function PasskeyMark(props: SVGProps<SVGSVGElement>): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      width="1em"
      height="1em"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4" />
      <path d="M14 13.12c0 2.38 0 6.38-1 8.88" />
      <path d="M17.29 21.02c.12-.6.43-2.3.5-3.02" />
      <path d="M2 12a10 10 0 0 1 18-6" />
      <path d="M2 16h.01" />
      <path d="M21.8 16c.2-2 .131-5.354 0-6" />
      <path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2" />
      <path d="M8.65 22c.21-.66.45-1.32.57-2" />
      <path d="M9 6.8a6 6 0 0 1 9 5.2v2" />
    </svg>
  );
}
