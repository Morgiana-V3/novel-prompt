export default {
  extends: ['stylelint-config-standard'],
  overrides: [
    { files: ['**/*.vue'], customSyntax: 'postcss-html' },
    { files: ['**/*.less'], customSyntax: 'postcss-less' },
  ],
  rules: {
    'max-nesting-depth': 1,
    // Vue inline custom properties remain one attribute; Prettier owns whitespace.
    'custom-property-empty-line-before': null,
    'selector-pseudo-class-no-unknown': [
      true,
      { ignorePseudoClasses: ['deep', 'global', 'slotted'] },
    ],
    // Scoped feature selectors can end with the same element without sharing a DOM context.
    // Keep cascade order stable; review specificity with the component instead of sorting rules.
    'no-descending-specificity': null,
  },
}
