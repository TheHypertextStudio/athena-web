export default {
  '*.{ts,tsx}': ['prettier --write', 'eslint --max-warnings=0'],
  '*.{json,md,yaml,yml}': ['prettier --write'],
};
