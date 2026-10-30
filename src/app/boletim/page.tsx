import { auth } from "@/lib/auth";
import { compileWeeklyDigest } from "@/lib/weeklyDigest";
import { redirect } from "next/navigation";
import BoletimClient from "./BoletimClient";

export const dynamic = "force-dynamic";

export default async function BoletimPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const initialDigest = await compileWeeklyDigest();

  return (
    <BoletimClient
      initialData={initialDigest}
      currentUser={{
        name: session.user.name || "Equipe Pedagógica",
        email: session.user.email || "",
        role: (session.user as any).role || "PEDAGOGA",
      }}
    />
  );
}
