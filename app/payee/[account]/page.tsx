import { ProfileApp } from "@/components/ProfileApp";

export default async function PayeePage({ params }: { params: Promise<{ account: string }> }) {
  const { account } = await params;
  return <ProfileApp accountId={decodeURIComponent(account)} />;
}
