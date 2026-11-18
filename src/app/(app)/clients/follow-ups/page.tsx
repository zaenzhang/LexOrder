import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { personalFollowUpLocation } from "@/lib/clients/follow-ups";
import { readPersonalFollowUps } from "@/server/clients/follow-up-queue";
import { PersonalFollowUpQueue } from "@/components/clients/personal-follow-up-queue";

export default async function ClientFollowUpsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user } = await requireSession("clients.read");
  const location = personalFollowUpLocation(await searchParams);
  const data = await readPersonalFollowUps(prisma, user.id, location.query ?? {});
  return <PersonalFollowUpQueue initialData={data} initialTarget={location.error ? null : location.target} initialMode={location.mode} locationError={location.error} />;
}
