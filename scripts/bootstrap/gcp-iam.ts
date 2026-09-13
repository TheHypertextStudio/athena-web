export const API_RUNTIME_SA_ROLES = [
  'roles/secretmanager.secretAccessor',
  'roles/aiplatform.user',
] as const;

type CommandRunner = (command: string) => void;
type GrantReporter = (role: string) => void;

/** Grant each project role to one service account and report completed grants. */
export function grantProjectRoles(
  project: string,
  serviceAccount: string,
  roles: readonly string[],
  run: CommandRunner,
  report: GrantReporter,
): void {
  roles.forEach((role) => {
    run(`gcloud projects add-iam-policy-binding ${project} \
      --member="serviceAccount:${serviceAccount}" \
      --role="${role}" \
      --condition=None \
      --quiet`);
    report(role);
  });
}
