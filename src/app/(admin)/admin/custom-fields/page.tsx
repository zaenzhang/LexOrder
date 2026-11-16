import { listCustomFieldDefs } from "@/server/custom-fields/actions";
import { requireWorkspaceConfiguration } from "@/lib/auth/session";
import { CustomFieldsView } from "./_components/custom-fields-view";

export default async function CustomFieldsPage() {
  await requireWorkspaceConfiguration();
  return <CustomFieldsView matterFields={await listCustomFieldDefs("MATTER")} />;
}
