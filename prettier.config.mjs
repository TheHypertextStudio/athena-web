import studio from '@thehypertextstudio/format-config/prettier';

export default {
  ...studio,
  plugins: [...(studio.plugins ?? []), 'prettier-plugin-tailwindcss'],
};
