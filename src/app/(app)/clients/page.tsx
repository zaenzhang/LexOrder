import { listClients } from "@/server/clients/actions";
import { editableClientIds } from "@/server/clients/master-access";
import { requireSession } from "@/lib/auth/session";
import { hasCustomPermission } from "@/lib/roles/catalog";
import { ClientsView } from "./_components/clients-view";

type Props = {
  searchParams: Promise<{
    search?: string;
    type?: "INDIVIDUAL" | "COMPANY" | "ORGANIZATION";
    page?: string;
  }>;
};

export default async function ClientsPage({ searchParams }: Props) {
  const params = await searchParams;
  const session = await requireSession("clients.read");
  const initialData = await listClients({
    search: params.search,
    type: params.type,
    page: params.page ? Number(params.page) : 1
  });
  const editableIds = await editableClientIds(session.user, initialData.items.map((client) => client.id));

  return (
    <ClientsView
      initialData={initialData}
      canCreate={hasCustomPermission(session.user, "clients.write")}
      editableClientIds={editableIds}
      initialFilters={{
        search: params.search ?? "",
        type: params.type ?? "ALL"
      }}
    />
  );
}
