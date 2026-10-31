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

  let initialDigest: any = null;
  try {
    initialDigest = await compileWeeklyDigest();
  } catch (err) {
    console.error("[BoletimPage] Erro ao compilar resumo semanal:", err);
  }

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
