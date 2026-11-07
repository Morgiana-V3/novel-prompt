// Current acceptance uses the running development host and its real services/data.
export const cases = {
  contracts: ['node', 'scripts/check-contracts.mjs', false],
  'tests:registration': ['node', 'scripts/check-test-registration.mjs', false],
  'mcp:readonly': ['node', 'tests/live/live-smoke.mjs', false, ['--read-only']],
  live: ['node', 'tests/live/live-smoke.mjs', false],
  'mcp:performance': ['node', 'tests/live/live-performance.mjs', false],
}

// Historical fixtures are inventoried, never selected by the current acceptance runner.
export const legacyCases = {
  'features:public': ['node', 'tests/unit/feature-public-contracts.cjs', false],
  'architecture:contracts': [
    'electron',
    'tests/integration/architecture-contracts-smoke.cjs',
    false,
  ],
  'tests:registration': ['node', 'scripts/check-test-registration.mjs', false],
  'app:identity': ['electron', 'tests/integration/app-identity-smoke.cjs', false],
  pricing: ['node', 'tests/unit/novelai-pricing.cjs', false],
  'task:notifications': ['node', 'tests/unit/task-notifications.cjs', false],
  confirmations: ['electron', 'tests/integration/confirmation-smoke.cjs', false],
  'operations:policy': ['electron', 'tests/integration/operation-policy-smoke.cjs', false],
  'images:clipboard': ['electron', 'tests/integration/image-clipboard-smoke.cjs', false],
  collections: ['electron', 'tests/integration/collections-smoke.cjs', false],
  statistics: ['electron', 'tests/integration/statistics-smoke.cjs', false],
  'chat:presets': ['electron', 'tests/integration/chat-presets-smoke.cjs', false],
  'vision:routing': ['electron', 'tests/integration/vision-routing-smoke.cjs', false],
  'mcp:library': ['electron', 'tests/integration/mcp-library-smoke.cjs', false],
  'creation:tabs': ['electron', 'tests/e2e/creation-tabs-smoke.cjs', true],
  'storage:snippets': ['electron', 'tests/integration/storage-snippets-smoke.cjs', false],
  'storage:recovery': ['electron', 'tests/integration/storage-recovery-smoke.cjs', false],
  'artists:catalog': ['node', 'tests/integration/artists-catalog-smoke.cjs', false],
  artists: ['electron', 'tests/e2e/artists-smoke.cjs', true],
  'tags:complete': ['electron', 'tests/integration/tag-complete-smoke.cjs', false],
  'data:tools': ['electron', 'tests/e2e/data-tools-smoke.cjs', true],
  artifacts: ['node', 'tests/unit/artifact-paths.cjs', false],
  'electron:errors': ['node', 'tests/unit/electron-errors-smoke.cjs', false],
  'reverse:models': ['node', 'tests/unit/reverse-models-smoke.cjs', false],
  'reverse:recommendations': ['electron', 'tests/e2e/reverse-recommendations-smoke.cjs', true],
  'mcp:launch': ['node', 'tests/unit/mcp-launch-smoke.cjs', false],
  'optimize:convergence': ['node', 'tests/unit/optimize-convergence-checks.cjs', false],
  'mcp:relay': ['node', 'tests/integration/mcp-relay-smoke.cjs', false],
  'mcp:recovery': ['electron', 'tests/integration/mcp-recovery-smoke.cjs', false],
  'mcp:context': ['electron', 'tests/integration/mcp-context-smoke.cjs', false],
  'mcp:index': ['electron', 'tests/integration/mcp-index-smoke.cjs', false],
  'mcp:preview-cache': ['electron', 'tests/integration/mcp-preview-cache-smoke.cjs', false],
  'mcp:host': ['node', 'tests/e2e/mcp-host-smoke.mjs', true],
  startup: ['node', 'tests/e2e/workspace-startup-smoke.mjs', true],
  desktop: ['electron', 'tests/e2e/desktop-mcp-smoke.cjs', true],
  'desktop:lifecycle': ['electron', 'tests/e2e/desktop-lifecycle-smoke.cjs', false],
  pages: ['electron', 'tests/e2e/page-workspace-smoke.cjs', true],
  inpaint: ['electron', 'tests/e2e/inpaint-smoke.cjs', true],
  favorites: ['electron', 'tests/e2e/favorites-smoke.cjs', true],
  'favorites:dev': ['node', 'tests/e2e/favorites-dev-smoke.mjs', true],
  settings: ['electron', 'tests/e2e/settings-save-smoke.cjs', true],
  'inpaint:mcp': ['electron', 'tests/integration/inpaint-mcp-smoke.cjs', false],
  retention: ['electron', 'tests/integration/retention-smoke.cjs', false],
  'workspace:cleanup': ['electron', 'tests/integration/workspace-cleanup-smoke.cjs', false],
  skills: ['electron', 'tests/integration/skill-packages-smoke.cjs', true],
  'skills:builtins': ['electron', 'tests/integration/builtin-skills-smoke.cjs', false],
  'skills:templates': ['electron', 'tests/integration/skill-templates-smoke.cjs', false],
  'discussion:tools': ['electron', 'tests/integration/discussion-tools-smoke.cjs', false],
  prompt: ['electron', 'tests/e2e/prompt-smoke.cjs', true],
  tasks: ['electron', 'tests/e2e/tasks-smoke.cjs', true],
  'tasks:background': ['electron', 'tests/integration/background-tasks-smoke.cjs', false],
  update: ['electron', 'tests/integration/update-smoke.cjs', false],
}
export const legacyOptionalCases = {
  'mcp:performance': ['electron', 'tests/integration/mcp-performance-smoke.cjs', false],
  isolation: ['node', 'tests/e2e/environment-isolation-smoke.mjs', true],
}

// Historical installer fixture retained for reference; not current acceptance.
export const manualCases = {
  'tests/e2e/installed-retention-smoke.mjs':
    'Requires two isolated acceptance installers as command arguments',
}
