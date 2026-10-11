import studio from '@thehypertextstudio/web-config/prettier';

// Keep Docket's existing Tailwind class ordering after the company formatting baseline.
export default { ...studio, plugins: ['prettier-plugin-tailwindcss'] };
