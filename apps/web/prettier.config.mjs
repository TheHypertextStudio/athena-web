import studio from '@thehypertextstudio/web-config/prettier';

// Keep Docket's existing Tailwind class ordering after the company formatting baseline.
export default {
  ...studio,
  plugins: ['prettier-plugin-tailwindcss'],
  // The artifact assembler and release binding snapshot use strict JSON for these files.
  overrides: [
    ...(studio.overrides ?? []),
    {
      files: ['wrangler.jsonc', 'wrangler.site.jsonc'],
      options: { parser: 'json', trailingComma: 'none' },
    },
  ],
};
